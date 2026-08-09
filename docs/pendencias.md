# Pendências

O que ficou para depois, com o motivo. Ordenado por risco de dar
problema, não por tamanho.

Nada aqui está implementado.

---

## Barato e de risco baixo

Cabem junto de qualquer outra entrega.

### Papel exigido em `POST /api/whatsapp/config`

**A rota não checa papel nenhum.** Ela confere sessão e conta, e segue.
Qualquer membro — inclusive `viewer` — pode substituir
`phone_number_id`, `waba_id` e o token de acesso da conta inteira.

A inconsistência está escancarada: `POST /api/whatsapp/embedded-signup`
exige `requireRole('admin')` para fazer **a mesma coisa** por outro
caminho. Duas portas para o mesmo cômodo, uma com fechadura e outra sem.

Conserto: trocar o bloco de auth manual por `requireRole('admin')`.
Uma linha, e alinha as duas rotas.

### `PGRST_DB_POOL`

Não está definido, então o PostgREST usa o padrão de **10 conexões** —
o gargalo de escrita do sistema inteiro. O Postgres tem 100 e usa ~31.

Conserto: `PGRST_DB_POOL: 30` no `services/supabase/compose.yml` do
repo de infra. Uma linha, e triplica a vazão antes de a fila começar.

### Retentativa com backoff no `rate_limited`

O provedor devolve 429 dizendo "tente de novo", e a informação é
descartada: o erro sobe, vira `platform_event`, **e o cliente não
recebe resposta nenhuma**.

Conserto: 2 ou 3 tentativas com espera crescente na camada de provedor
(`lib/ai/providers/shared.ts`), só para `rate_limited` e erro de rede —
nunca para `invalid_key` ou `quota_exceeded`, que não melhoram com
insistência.

Sozinho já muda o comportamento sob pico, e é bem menor que o teto de
concorrência.

### Seletor de conversa na tela de Contexto

`GET /api/ai/context` já aceita `?conversation_id=`, e a tela não usa —
então o transcript aparece sempre vazio. Falta o seletor.

### Tela de re-aceite dos termos

`GET /api/terms/accept` já responde se a pessoa aceitou a versão em
vigor, e nada consome isso. Consequências hoje:

- os usuários criados antes da 057 não têm aceite registrado
- bumpar `TERMS_VERSION` não se manifesta em lugar nenhum

Conserto: um aviso bloqueante na entrada para quem não aceitou a versão
atual.

---

## Volume alto de mensagens

Motivado por um possível cliente que relata pico de ~3.000 mensagens
derrubando o bot atual dele (que roda em API não oficial).

### 1. Persistir antes de confirmar — o mais importante

**O problema:** o webhook responde 200 à Meta e só então processa, em
`after()`. É correto para o timeout de ~20s deles, e tem um custo que
só aparece sob carga: se o container morrer no meio do processamento —
que é exatamente o que um pico provoca — **aquelas mensagens somem**. Já
dissemos à Meta que recebemos; ela não reentrega.

E o `message_id` **não é único**, então uma reentrega que aconteça gera
mensagem duplicada na conversa.

**A correção:**

```
hoje:     valida → responde 200 → processa na memória
proposto: valida → grava evento cru → responde 200 → drena do banco
```

Detalhes que não podem ser esquecidos:

- **A chave de idempotência é `(phone_number_id, wamid)`, não `wamid`
  sozinho.** A migração 009 registra por quê: *"Meta IDs aren't unique
  across phone numbers"*. Um índice único global funcionaria com um
  cliente e rejeitaria mensagem legítima do segundo.
- **A tabela `messages` não é tocada.** A idempotência mora na tabela
  nova de eventos crus. Vira mudança aditiva, não alteração de
  restrição na tabela mais quente do sistema.
- **Gravar e drenar na mesma requisição**, com o poller do cron apenas
  como rede para o que ficou para trás. A durabilidade vem de a linha já
  estar no banco — não de esperar o ciclo. Assim a latência de hoje não
  muda.
- **Drenar em série por conversa.** Em paralelo, duas mensagens da mesma
  conversa entram fora de ordem, o que bagunça a tela e o contexto do
  agente.
- **Verificação de profundidade da fila na ronda de saúde, desde o
  primeiro dia.** Se o dreno parar, o sintoma é caixa de entrada quieta
  — idêntico ao do sequestro de webhook pelo n8n, que ninguém percebeu
  por dias.

**Risco:** é o caminho por onde toda mensagem entra, e a falha dele é
silenciosa. Fazer numa janela de atenção, não antes de uma demonstração.
Validar com webhook assinado em produção, como foi feito com a
reabertura de conversa.

**Sobre Redis:** não é necessário e seria pior. Com fila no Redis e
dados no Postgres, "recebi" e "guardei" viram dois commits em sistemas
diferentes, sem ordem correta possível — confirma antes e perde na
queda, confirma depois e duplica. Com a fila no Postgres é um commit só.
`SELECT … FOR UPDATE SKIP LOCKED` sustenta ordens de grandeza mais do
que este produto vai ver. (Nota: o app hoje sequer alcança o Redis — ele
está só na rede `edge`, e o Redis na `data`, que é `--internal`.)

### 2. Teto de concorrência de IA por conta

Sem ele, 3.000 mensagens de 3.000 contatos viram 3.000 chamadas
simultâneas na chave do cliente. O provedor limita a maioria, e **cada
recusa é um cliente sem resposta**, em silêncio.

Vira quase de graça depois do item 1: se há fila no banco, o ritmo de
drenagem já é o teto.

Decisão que falta e é do negócio, não técnica: **qual a espera máxima
antes de desistir e chamar uma pessoa?** Uma resposta que chega 5
minutos depois pode ser pior que um handoff imediato.

### 3. Aplicar o orçamento mensal

`ai_configs.monthly_budget_usd` é gravado, exibido em Custos e usado na
projeção — **e nenhum código impede o gasto quando estoura**. Conferi
todos os usos: é só leitura.

Um cliente que receba um pico inesperado descobre o limite pela fatura.

---

## Depende de terceiros

- **`client_id` próprio do rclone** — o compartilhado será aposentado
  durante 2026 e o backup para de subir, com o erro só no log
- **SMTP** — ainda os valores falsos do upstream; "Esqueci a senha"
  falha em silêncio. Plano B: trocar pelo Studio
- **Terms of Service URL no painel da Meta** — a página existe
  (`/termos`), o campo ainda aponta para `facebook.com`
- **Site do portfólio de negócio** — está `elucas.dev`, que não menciona
  a marca. É a causa provável das recusas do nome de exibição
