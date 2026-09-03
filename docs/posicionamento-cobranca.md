# Cobrança como foco — avaliação de posicionamento, módulo e o que falta

> Avaliado contra `main @ 52dbf11` em 02/09/2026. A mudança da Meta entra em
> **1º de outubro** — quatro semanas.

---

## 1. Antes de tudo: a premissa precisa de um ajuste

Você concluiu que agendamento perde atratividade e cobrança ganha. **Metade
disso está certa, e a metade errada é justamente a dos seus dois casos.**

A janela gratuita de 72h por anúncio **não muda em outubro**. Conversa que entra
por Click-to-WhatsApp ou por botão de CTA da página continua com entrega
gratuita — e não é só para resposta livre: [marketing, utilidade, autenticação e
serviço, todos saem de graça dentro dessas 72h](https://help.sleekflow.io/en_US/whatsapp/understanding-click-to-whatsapp-ads-ctwa-and-the-72-hour-free-window).

Então o quadro real é:

| Origem da conversa | Antes | Depois de 01/10 |
|---|---|---|
| **Anúncio da Meta (CTWA / CTA)** | grátis 72h | **grátis 72h — sem mudança** |
| Cliente manda mensagem espontânea | grátis na janela de 24h | **cobrada por mensagem** |
| Nós iniciamos (template) | cobrada | cobrada |

**A Raissa e a Hotka são exatamente o caso que sobrevive melhor**, porque o
contato nasce de anúncio. Agendamento vindo de tráfego pago continua barato;
quem encarece é atendimento receptivo orgânico.

> Isso não derruba a ideia de focar em cobrança — reforça. Só corrige o motivo:
> não é "agendamento morreu", é **"o que se paga por mensagem precisa de retorno
> por mensagem"**. Cobrança tem o melhor retorno possível: uma mensagem de
> R$ 0,04 que recupera uma mensalidade de R$ 80 é ROI de 2.000×. Agendamento por
> anúncio continua ótimo porque não paga nada.

**Recomendação:** posicionar cobrança como a ponta de lança comercial, **sem
tirar agendamento do discurso** — vendê-lo para quem tem tráfego pago, que é o
recorte onde ele continua imbatível.

---

## 2. O que falta no módulo de cobrança além do que já levantamos

Em [`avaliacao-agendas-e-cobranca.md`](./avaliacao-agendas-e-cobranca.md) §2.3
levantei espelho de cobranças, régua configurável, registro de disparo e worker
diário. A pesquisa acrescentou coisas que **não são polimento — são requisito**.

### 2.1 Restrição legal (o achado mais importante)

Cobrar por WhatsApp é legal no Brasil, mas o CDC e a autorregulação bancária
impõem limites que precisam estar **no código**, não no bom senso do operador:

| Regra | Origem | Vira o quê no sistema |
|---|---|---|
| Nada de madrugada, fim de semana ou feriado | CDC art. 42 + [SARB 27/2023](https://zenvia.com/blog/cobranca-whatsapp/) | **janela de contato** por conta: seg–sex 8h–20h, sáb 8h–14h, e uma **tabela de feriados** |
| Sem contato repetido em curto intervalo (assédio) | CDC art. 42 | **teto de contatos por título**, e intervalo mínimo entre degraus |
| Sem expor a ridículo, ameaçar ou constranger | CDC art. 42 | revisão do texto dos templates; nada de "negativação" como ameaça |
| Nunca falar da dívida com terceiros | CDC | a régua só fala com o titular — nunca com outro número da conta |
| Identificar credor, valor, vencimento e como pagar | boas práticas | **campos obrigatórios** no template, validados ao salvar |

Um degrau que dispara domingo às 22h não é um bug de UX: é exposição jurídica do
cliente. **A janela e o teto precisam ser impostos pelo worker**, não sugeridos
na tela.

> Nota prática: isso encarece pouco e vende muito. "A régua respeita CDC e
> horário legal" é argumento comercial direto contra quem manda mensagem por
> script de planilha.

### 2.2 O resto do que falta

| Peça | Por quê |
|---|---|
| **Parar na resposta** | Cliente respondeu — negociando, contestando ou avisando que pagou — a régua **pausa** e vira atendimento humano. Continuar disparando por cima é o caminho mais rápido para virar reclamação |
| **Promessa de pagamento** | "Pago sexta" precisa reagendar o próximo degrau, não repetir a mesma cobrança quinta |
| **Agrupar por titular** | Quem tem três títulos vencidos recebe **uma** mensagem, não três. Sem isso a régua vira assédio por construção |
| **Link de pagamento na mensagem** | PIX copia-e-cola ou boleto. Sem isso, a mensagem gera trabalho em vez de resolver |
| **Baixa e parada automática** | O gancho de §2.4 do outro documento: quem pagou sai da régua |
| **Trilha de auditoria** | O que foi enviado, para quem, quando, com qual texto. É a defesa se o cliente for questionado |
| **Métrica por degrau** | Qual degrau recupera mais dinheiro. É o que permite ao cliente cortar o degrau que só gasta — e é o relatório que justifica a mensalidade |

---

## 3. O módulo de integrações

### 3.1 O desenho

A boa notícia é que **já construímos esse padrão duas semanas atrás**. O catálogo
de provedores de IA (`src/lib/ai/providers/catalog.ts`) é exatamente a forma:
uma lista única do que o sistema sabe falar, um adaptador por formato, e a tela
lendo da mesma lista que o executor.

```
src/lib/integrations/
  catalog.ts          ← a lista: id, rótulo, o que faz, onde pegar a chave
  types.ts            ← a interface que todo adaptador implementa
  asaas/              ← um diretório por sistema
  clube-associados/
```

A interface precisa ser pequena, e é o que mantém a régua ignorante de quem
manda os dados:

- `listarCobrancasAbertas(desde)` — o que está em aberto
- `consultarCobranca(idExterno)` — pagou?
- `verificarWebhook(req)` — quando o sistema empurra (opcional)

Mais uma tabela `integrations` por conta: provedor, credenciais cifradas com o
mesmo AES-256-GCM do resto, status, último sync. Nenhum mecanismo novo.

### 3.2 Quais sistemas integrar, e em que ordem

| Sistema | Por que | Prioridade |
|---|---|---|
| **Asaas** | [Documentação pública em docs.asaas.com](https://docs.asaas.com/), webhooks de cobrança gerada, paga, falha e cancelada. Enorme entre PMEs brasileiras. É o que dá para construir **hoje**, sem depender de ninguém | **1ª** |
| **Genérico por webhook + CSV** | Um endpoint nosso que qualquer sistema chama, e importação de planilha. Atende **todo cliente cujo sistema não tem API** — que vai ser a maioria | **2ª** |
| **Clube de Associados** | O caso concreto, mas ainda sem documentação em mãos | 3ª |
| Iugu · Vindi · Superlógica | Recorrência e assinaturas, APIs e webhooks documentados; Superlógica é forte em condomínio e imobiliária | depois |
| Conta Azul · Omie · Bling | ERPs com API; entram quando aparecer cliente pedindo | depois |

**A 2ª linha é a mais importante comercialmente.** Um importador de planilha
mais um webhook genérico faz o módulo funcionar para qualquer cliente no primeiro
dia, sem integração nenhuma. É o que tira o produto da dependência de terceiros
— inclusive do Clube de Associados, que segue sem API em mãos.

---

## 4. Tirar os fluxos do beta (o caminho sem IA)

### 4.1 Está mais maduro do que o rótulo sugere

5.419 linhas, 5 arquivos de teste, e as partes difíceis já resolvidas:

- **Dez tipos de nó**, incluindo `send_buttons`, `send_list`, `collect_input`,
  `condition`, `set_tag` e `handoff` — o "digite 1, digite 2" completo
- **Política de fallback** para resposta que não casa com nenhuma opção:
  `reprompt` · `handoff` · `end` · `ignore`
- **Varredura de abandono** por cron, com `on_timeout_hours` por fluxo, para o
  índice parcial de "um run ativo por contato" não travar o contato para sempre
- Runs e eventos gravados para auditoria

~~O beta é ligado por perfil, via array `beta_features` em `profiles` — trocar por
GA é remover a checagem em 7 arquivos.~~

> **Correção (03/09/2026).** Isto estava desatualizado. O gate por conta **já foi
> removido** — o PR #134 levou fluxos a soft-GA, e as rotas (`/api/flows`,
> `/api/flows/[id]`) e a página estão abertas a qualquer usuário autenticado. O
> que resta de "beta" são dois chips na interface (`sidebar.tsx:102` e a lista de
> fluxos). Ver [`plano/02-fase-2-fluxos-ga.md`](./plano/02-fase-2-fluxos-ga.md) §2.

### 4.2 O que realmente falta

| Lacuna | Impacto | Esforço |
|---|---|---|
| **Fluxo não envia template** — só automação envia | **Bloqueante.** Um fluxo só sabe *reagir*; não sabe *iniciar*. Fora da janela de 24h ele não fala. Para cobrança isso é fatal, e mesmo para reengajamento | M |
| **Não existe nó de espera** | Automação tem `wait` em minutos/horas/dias; fluxo não. Sem isso não há "se não responder em 1h, insista" | P |
| **Timeout é só do run inteiro** | Não dá para dizer "este menu expira em 10 min" — só o run inteiro em 24h | P |
| Nó de webhook / chamada externa | Automação tem `send_webhook`; fluxo não. Limita integrar sem sair do fluxo | P |
| Teste de ponta a ponta do motor | Há teste de validação e de fallback; falta um que rode um fluxo inteiro | M |

**O template é o item que decide.** Com ele, o fluxo vira o motor sem IA para
cobrança também — cada degrau da régua é um template, e a resposta do cliente cai
num menu. Sem ele, cobrança obriga a IA ou a automações, e o cliente que não quer
pagar IA fica sem caminho.

### 4.3 Recomendação

Sair do beta é **M**, não G: nó de template + nó de espera + timeout por nó +
um teste de ponta a ponta, e remover o gate. Duas semanas com folga.

E vale fazer **antes** da régua, não depois: se o fluxo souber mandar template e
esperar, boa parte da régua vira configuração de fluxo em vez de motor novo.

---

## 5. A ordem que eu proponho

1. **Contador de mensagens** (PR #3 já aberto) — sem ele não há como precificar
   cobrança, e o prazo é outubro.
2. **Fluxos para GA** — destrava o caminho sem IA e vira a base da régua.
3. **Núcleo da régua** com janela legal, teto anti-assédio e agrupamento por
   titular, alimentado por **planilha + webhook genérico**.
4. **Adaptador Asaas**, que é o que dá para construir sem depender de ninguém.
5. **Clube de Associados** quando a documentação chegar.

Os itens 3 e 4 não dependem da API que você ainda não tem — que era o risco que
eu queria tirar do caminho crítico.

---

## 6. O que eu ainda não sei

- **A tarifa exata de serviço.** A Meta prometia publicar até 1º/09, que foi
  ontem. Vale conferir agora — muda a conta de precificação da régua.
- **Se o Clube de Associados tem mesmo API.** Segue sem confirmação; o site está
  bloqueado neste ambiente.
- **Qual o ticket e o volume da carteira do cliente.** Sem isso a régua é
  desenhada no escuro: 50 associados e 5.000 pedem decisões diferentes de
  agrupamento e de horário de disparo.
