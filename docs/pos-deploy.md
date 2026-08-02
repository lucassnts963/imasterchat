# Checklist pós-deploy

Ordem importa: cada item pressupõe o anterior. Tudo aqui é verificável
em minutos, e a maioria tem uma tela que responde sozinha.

O princípio que guia a lista: **tela vazia não é prova de saúde.** Toda
verificação abaixo tem uma resposta positiva esperada, nunca "não
apareceu erro".

---

## 1. O básico subiu

```bash
docker compose -f supabase/docker/docker-compose.yml \
               -f deploy/docker-compose.app.yml ps
```

- [ ] `app`, `cron` e a stack do Supabase em `running`
- [ ] `app` com healthcheck em `healthy` (leva ~15s depois de subir)

## 2. Migrações

```bash
bash deploy/apply-migrations.sh
```

- [ ] Terminou em `✓ N migrations applied`
- [ ] A última listada é a mais alta em `supabase/migrations/`

Esta é também a etapa que cria `applied_migrations`. Sem ela a
verificação de migrações acusa `ledger_unreadable` — corretamente.

## 3. O cron está falando com o app

```bash
docker compose -f deploy/docker-compose.app.yml logs cron --tail 20
```

- [ ] Aparece `[cron] every 300s; keeper every 6; health every 12`
- [ ] **Não** aparece `AUTOMATION_CRON_SECRET is empty`
- [ ] **Não** aparece `[cron] ... failed` repetido

O loop foi testado com `docker compose` de verdade contra um servidor
real: 15 ticks, todas as rotas na cadência certa, todas 200. O que
**não** dá para testar fora do compose é a resolução do nome `app` na
rede interna — é justamente o que estes logs respondem.

## 4. A faixa de saúde

Abra `/admin` → aba **Eventos**. A faixa no topo responde sozinha o que
os logs acima só sugerem.

- [ ] **Não** diz "A ronda de verificação nunca rodou"
- [ ] **Não** diz "A última ronda foi há N minutos" (limite: 2h)
- [ ] `Migrações do banco` não aparece em vermelho
- [ ] Se `Token do WhatsApp` ou `Chave da IA` aparecerem em vermelho,
      é problema real — não ruído de primeira execução

Na primeira hora a ronda pode ainda não ter rodado. Aí a faixa diz
exatamente isso, em vez de fingir que está tudo bem.

## 5. O alerta chega

- [ ] Uma falha real (ou forçada) produz mensagem no Telegram
- [ ] O evento aparece em `/admin` → Eventos

Para forçar sem quebrar nada, zere a linha de saúde de uma verificação
e espere a próxima ronda:

```sql
UPDATE public.account_health
   SET status = 'ok', failing_since = NULL, last_alerted_at = NULL
 WHERE check_name = 'migrations' AND account_id IS NULL;
```

Se a verificação estiver falhando de verdade, a transição dispara um
alerta. Se estiver ok, nada acontece — que também é a resposta certa.

## 6. WhatsApp de ponta a ponta

- [ ] Mandar uma mensagem para o número da ótica de um celular qualquer
- [ ] A conversa aparece na caixa de entrada
- [ ] O agente responde (se `auto_reply_enabled` estiver ligado)
- [ ] `/admin` → Eventos **não** mostra `unknown_phone_number_id`

Este é o teste que nenhum dos anteriores substitui. Se a mensagem não
chegar e não houver evento nenhum, o problema está ANTES do app — DNS,
TLS, ou algo bloqueando a Meta na borda. Ver a seção sobre Cloudflare
em [`seguranca.md`](./seguranca.md).

## 7. PWA e notificações

- [ ] Instalar o app pelo navegador (celular e desktop)
- [ ] O ícone aparece, não um print da página
- [ ] Configurações → **Avisos no celular** não mostra "servidor não
      configurado"
- [ ] Escolher "Só o que precisa de gente" e permitir no navegador
- [ ] Provocar um handoff (mandar "quero falar com um advogado" pelo
      WhatsApp — é guardrail de palavra-chave) e o celular apitar

No iPhone é preciso instalar na tela de início ANTES de as notificações
funcionarem. iOS 16.4 ou mais novo.

## 8. Agenda

- [ ] Conectar o Google em Configurações → Agendamento
- [ ] Criar um evento manualmente na agenda do Google
- [ ] Pedir um horário pelo WhatsApp e conferir que o agente **não**
      oferece o horário ocupado
- [ ] Agendar pelo bot e ver o evento aparecer no Google e em `/agenda`

## 9. Widget de feedback

- [ ] O botão aparece no canto inferior direito
- [ ] Um relato de teste chega no Telegram
- [ ] E aparece em `/admin` → Eventos → Relatos

---

## O que ainda não tem verificação automática

Registrado para não virar surpresa:

**Webhook que para de chegar.** Se algo na borda bloquear a Meta, o app
nunca vê a requisição — então nenhum evento é gravado e a faixa de saúde
continua verde (o token do WhatsApp está válido; ninguém está usando
ele). O sintoma é "nenhuma mensagem hoje", indistinguível de um dia
parado. Hoje só o item 6 pega isso, e só quando alguém testa.

**O grafo do vault** e **o ciclo de aprendizado** (aprovar uma página e
a resposta do bot mudar) nunca foram observados funcionando.
