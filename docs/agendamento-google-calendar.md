# Agendamento com Google Agenda — análise e plano

Cliente: ótica. Quer que a IA agende consultas sozinha pelo WhatsApp, de segunda a
sexta, em horários definidos, com a Google Agenda mandando na disponibilidade.

Decisões já tomadas:

- **Google Agenda é a fonte da verdade** — antes de oferecer horário, consulta os
  eventos ocupados. Se a cliente marcar algo direto no Google, a IA respeita.
- **IA confirma sozinha, com limites** — dentro das regras (horário comercial,
  janela de dias, 1 agendamento por cliente); fora disso, handoff para humano.
- **Uma agenda só** — a loja atende um cliente por vez no horário.
- **O cérebro é nativo** — o agendamento é feature do produto, não workflow
  externo. Ver [Decisão tomada](#decisão-tomada); as duas abordagens comparadas
  abaixo ficam registradas porque explicam o formato do que foi construído.

---

## O achado que decide o tamanho do trabalho

**A IA do iMasterChat não tem tool calling.** Não é "tem parcial" — é zero:

- `src/lib/ai/providers/openai.ts` monta `{model, messages, max_completion_tokens}`.
  Sem `tools`, sem `tool_choice`.
- `src/lib/ai/providers/anthropic.ts` monta `{model, system, max_tokens, messages}`.
  Sem `tools`. E o parser filtra `b.type === 'text'` — um bloco `tool_use` seria
  descartado silenciosamente e a chamada quebraria com `empty_response`.
- `ChatMessage` em `src/lib/ai/types.ts` é `{role: 'user'|'assistant', content: string}`.
  Não existe papel `tool`, não existe bloco de conteúdo.
- `generateReply` é chamada **uma vez**. Não há laço de agente.

A única ação do modelo hoje é emitir `[[HANDOFF]]`, um sentinela de string. Esse
é o vocabulário inteiro.

Some-se a isso: **não existe nada de agendamento no banco** (nenhuma tabela de
appointments/slots/calendars) e **nenhuma infraestrutura de OAuth** no projeto
(`package.json` não tem `googleapis`, nem `next-auth`, nem lib de OAuth).

Então "IA agenda na Google Agenda" **direto no app é uma feature grande**, não
média. O que já existe e é reaproveitável é a volta toda: chave BYO por conta
criptografada, pipeline de inbound→LLM→WhatsApp, base de conhecimento, handoff
com banner na caixa de entrada, contabilidade de tokens e um playground que roda
exatamente o mesmo caminho da produção.

---

## Abordagem A — direto no app

Construir tool calling e a integração nativa.

### O que precisa ser feito

| # | Item | Tamanho |
|---|---|---|
| 1 | **Tool calling na camada de provider** — `tools` no request, parse de blocos de tool nos dois providers, papel `tool` no `ChatMessage`, laço de agente com teto de iterações | Grande |
| 2 | **Google Agenda** — OAuth2 do zero, storage de refresh token criptografado, renovação, `freebusy`, criar/cancelar evento | Grande |
| 3 | **Tabela `appointments`** — RLS por conta, `starts_at timestamptz`, `google_event_id`, ciclo de status, idempotência contra duplo agendamento | Média |
| 4 | **Motor de disponibilidade** — seg–sex, definição de slots, timezone do negócio, feriados, resolução de conflito contra a agenda ao vivo | Média |
| 5 | **Data/hora no contexto** — hoje o modelo **não sabe que dia é hoje**. `buildConversationContext` devolve só texto: sem data, sem timezone, sem nome do contato | Pequena, obrigatória |
| 6 | **Guardrails de escrita autônoma** — turno de confirmação, teto de agendamentos por conversa, log de auditoria, kill switch | Média |
| 7 | `ai_usage_log.mode` só aceita `('auto_reply','draft')` — migração para logar turnos de tool | Trivial |

### Armadilhas específicas

- **O teto de respostas mata a conversa.** `auto_reply_max_per_conversation`
  tem default 3 e é reivindicado atomicamente por `claim_ai_reply_slot`. Um
  diálogo de agendamento gasta mais que isso e morre no meio. Precisa de um
  contador separado ou de teto maior.
- **A IA se cala se existir automação.** `auto-reply.ts:61-68`: se a conta tiver
  qualquer automação ativa com gatilho `new_message_received` ou `keyword_match`,
  a IA **se desliga inteira** para não duplicar mensagem. Isso é relevante para
  as duas abordagens.
- **Escrita autônoma não é recuperável.** Uma resposta de texto errada se
  corrige com outra mensagem; um horário gravado na agenda de um cliente real,
  não. O servidor — não o modelo — tem que ser dono da validade do slot, da
  regra seg–sex e da prevenção de duplo agendamento. As tools devem ter
  assinatura estreita e validação server-side.

### Prazo realista

3 a 5 semanas de trabalho focado, sendo que os itens 1 e 2 são os que dominam.
Nenhum deles tem atalho: tool calling é feito na mão (não há SDK no projeto, os
dois providers são `fetch` cru) e OAuth do Google é greenfield.

---

## Abordagem B — n8n

Deixar o n8n ser o cérebro do agendamento; o iMasterChat continua sendo a caixa
de entrada, o histórico e o painel.

### A restrição que define o desenho

**n8n e iMasterChat não podem escutar o mesmo número por apps Meta separados.**
O nó WhatsApp Trigger do n8n registra a própria assinatura de webhook na Meta, e
a Meta entrega os eventos de um número para o app que o reivindicou. Ligar o
WhatsApp Trigger no número da ótica **derruba a caixa de entrada do iMasterChat**.

Logo, o fluxo tem que ser: iMasterChat recebe → repassa para o n8n → n8n
responde chamando a API pública do iMasterChat. Nunca n8n escutando a Meta
direto.

### O caminho de ida e volta já existe

| Peça | Onde | Estado |
|---|---|---|
| POST para o n8n a partir de uma automação | passo `send_webhook`, `src/lib/automations/engine.ts:587` | Existe, com proteção SSRF, headers custom, timeout 10s |
| Webhook de saída assinado | `src/lib/webhooks/**`, HMAC-SHA256 | Existe — evento `message.received` |
| n8n manda mensagem de volta | `POST /api/v1/messages`, escopo `messages:send` | Existe — acha-ou-cria contato e conversa por E.164 |
| n8n lê a conversa | `GET /api/v1/conversations/{id}/messages` | Existe |
| IA + Google Agenda como ferramenta | nó `AI Agent` + `googleCalendarTool` | Nativo do n8n: `calendar:availability` e `event:create` |

O `googleCalendarTool` é exatamente o que a decisão "Google Agenda é a verdade"
pede — o agente checa o slot livre e cria o evento sem código de cola.

### Duas armadilhas reais

- **`send_webhook` descarta a resposta.** `runStep` devolve só a string de
  status. Não dá para trazer "aqui estão os horários livres" de volta para
  dentro da automação. A confirmação tem que voltar como chamada separada na API
  v1 — o que funciona, mas significa que o n8n conduz o diálogo inteiro, não o app.
- **Adicionar a automação de repasse desliga a IA nativa.** Como o gatilho é
  `new_message_received`, o `auto-reply.ts` se cala. Neste desenho isso é
  desejável (o cérebro é o n8n, não queremos dois respondendo), mas precisa ser
  uma decisão consciente: a ótica passa a ter a IA do n8n, não a do app.

### Desenho do workflow

```
Webhook Trigger (recebe message.received do iMasterChat, valida HMAC)
  → AI Agent
      ├── Chat Model (OpenAI — credencial já existe)
      ├── Simple Memory (sessionKey = telefone do contato)
      ├── Google Calendar Tool → calendar:availability
      ├── Google Calendar Tool → event:create
      └── HTTP Request Tool → POST /api/v1/messages (responder no WhatsApp)
```

Responder **como ferramenta do agente**, não pela saída dele — assim o agente
pode fazer várias falas e continuar raciocinando (é a recomendação do próprio
n8n para chatbots).

Regras seg–sex e janela de horário: no system prompt **e** validadas por um nó
`IF` antes do `event:create`. Prompt sozinho não é garantia.

### O que falta montar

- Credencial de Google Calendar no n8n (**hoje não existe** — há Sheets, Drive,
  YouTube, Telegram, OpenAI e WhatsApp).
- Chave de API do iMasterChat com escopo `messages:send`.
- A automação de repasse no app + o workflow no n8n.
- Injetar data/hora atual no prompt (mesmo problema da abordagem A, mas aqui
  resolve com um nó `Set`).

### Prazo realista

3 a 5 dias. A maior parte é ajuste de prompt e teste do diálogo, não código.

---

## Comparação

| | Direto no app | n8n |
|---|---|---|
| Prazo | 3–5 semanas | 3–5 dias |
| Risco de quebrar o que já funciona | Médio — mexe no caminho de auto-reply que já está em produção | Baixo — o app só ganha uma automação |
| Vira produto para outros clientes | Sim, é o ponto | Não — cada cliente precisaria do seu workflow |
| Custo por cliente novo | Zero (é feature) | Trabalho manual de clonar e reconfigurar workflow |
| Dono da regra de negócio | Servidor (validável, testável) | Prompt + nós do n8n |
| Onde a ótica vê a conversa | Caixa de entrada do iMasterChat | Caixa de entrada do iMasterChat (igual) |
| Dependência externa | Só Google | Google + instância n8n de pé |

---

## Decisão tomada

**O cérebro é nativo. O n8n não entra.**

A comparação acima recomendava o caminho inverso — n8n primeiro, port depois — e
o argumento dela continua válido *para o problema que ela enxergava*: só
agendamento, prazo curto, diálogo desconhecido. A decisão mudou porque o escopo
mudou. O tool calling deixou de ser custo do agendamento e virou base de duas
outras coisas que a ótica não é a última a precisar:

- **vault por conta** — a IA mantém uma wiki do negócio e do cliente, que cresce a
  cada conversa (metodologia LLM Wiki de Karpathy);
- **laço de agente auditável** — cada passo persistido, contexto de ambiente
  injetado, teto de passos e orçamento.

Construir isso no n8n seria construir fora do produto o que precisa estar dentro
dele. E o argumento de prazo se inverte: o laço nativo é pago uma vez e serve
toda conta nova; o workflow do n8n é pago de novo a cada cliente.

Decisões de desenho que acompanham:

| Decisão | Escolha |
|---|---|
| Agenda | Uma por conta — um calendário Google |
| Confirmação de agendamento | O bot confirma sozinho; a regra é validada no servidor |
| Vault | O agente propõe rascunho; humano aprova antes de virar resposta |

O que já está construído e continua valendo integralmente:

| Peça | Onde |
|---|---|
| Tabela `appointments`, account-scoped, com trava contra duplo agendamento | `supabase/migrations/041_appointments.sql` |
| `POST /api/v1/conversations/{id}/handoff` | `src/app/api/v1/conversations/[id]/handoff/route.ts` |
| `GET`/`POST /api/v1/appointments` e `GET`/`PATCH /api/v1/appointments/{id}` | `src/app/api/v1/appointments/**` |
| Validação de slot (data inválida, passado, duração absurda) | `src/lib/api/v1/appointments.ts` |
| Escopos `conversations:handoff`, `appointments:read`, `appointments:write` | `src/lib/api-keys/scopes.ts` |

Nada disso foi trabalho perdido com a virada. A tabela, os escopos e a rota de
handoff foram desenhados justamente para sobreviver à troca de cérebro — e
sobreviveram, só que a troca aconteceu antes de o n8n existir. A API v1 continua
sendo a porta para qualquer cérebro externo que um cliente queira plugar.

A coluna `created_via` mantém os três valores (`manual` / `n8n` / `native`): o
`native` é o caminho do produto, o `manual` é a tela de agenda, e o `n8n` fica
disponível para quem já tenha automação própria.

**O que a decisão custa, e vale registrar**: o diálogo certo de agendamento ainda
é desconhecido — quantas idas e vindas, o que fazer quando não tem vaga, como o
cliente remarca. Afinar isso num prompt do n8n custaria minutos. Aqui o harness
equivalente é o Playground, que roda o mesmo caminho de código da produção; por
isso ele renderizar os passos de tool não é enfeite, é o que torna a iteração
barata.

---

## Como funciona na prática

### A conversa, passo a passo

```
Cliente:  "oi, queria marcar um exame de vista"
            │
            ├─ Meta entrega no webhook do iMasterChat
            ├─ App grava contato, conversa e mensagem (sempre)
            └─ `after()` → dispatchInboundToAiReply → runAgent
                        │
runAgent:   monta o prompt: ambiente (hoje é terça, fuso, nome do contato),
            regras do vault, histórico da conversa, catálogo de tools
            │
            ├─ passo 1: check_availability(quinta, sexta)
            │           servidor cruza horário comercial × freebusy × appointments
            └─ passo 2: o modelo escreve a resposta com os slots que recebeu
Bot:      "Claro! Tenho quinta 14h, quinta 16h ou sexta 09h. Qual fica melhor?"

Cliente:  "quinta de tarde"
            │
runAgent:   entende "quinta 14h ou 16h" — sabe que hoje é terça porque a data
            está no bloco de ambiente, não porque o modelo adivinhou
Bot:      "Quinta às 14h ou às 16h?"

Cliente:  "14h"
            │
runAgent:   book_appointment(quinta 14h, quinta 15h)
            └─ servidor revalida a regra, cria o evento no Google,
               grava em `appointments` (created_via = 'native')
               as travas da 041 barram duplo agendamento mesmo sob retry
Bot:      "Pronto! Exame marcado para quinta, 14h. Te espero aqui 😊"
```

Cada passo desses fica gravado em `ai_agent_steps` — dá para abrir a conversa
depois e ver qual tool foi chamada, com quais argumentos e o que voltou.

A atendente vê **toda** essa conversa na caixa de entrada do iMasterChat, em
tempo real, sem precisar fazer nada. O bot não é um canal paralelo — as
mensagens dele são gravadas como mensagens da conversa, marcadas como geradas
por IA.

### Quem garante a regra de negócio

Duas camadas, e as duas são necessárias:

1. **O prompt** diz o comportamento: tom, o que fazer quando não há vaga, quando
   parar e chamar gente.
2. **O servidor, dentro da tool**, valida o que o modelo decidiu: é dia útil?
   está na janela de antecedência? o slot ainda está livre? — reusando `parseSlot`
   (`src/lib/api/v1/appointments.ts`) e `availability.ts`.

A segunda camada existe porque prompt não é garantia. Modelo alucina data,
inventa horário, confunde "quinta que vem". Validação falhou → não grava, e o
erro volta para o modelo como `tool_result`, que então se corrige ou chama
humano. É a diferença entre o modelo *escolher a ação* e o modelo *decidir a
regra*: só a primeira é dele.

### Os casos em que o humano é acionado

Essa é a outra metade da autonomia: o bot precisa saber **quando parar**.

| Situação | O que o bot faz |
|---|---|
| Fora do horário comercial pedido, ou data muito à frente | Explica e chama humano |
| Cliente já tem consulta marcada e quer remarcar/cancelar | Chama humano (mexer em agendamento existente é mais arriscado que criar) |
| Não entendeu depois de 2 tentativas | Chama humano em vez de insistir |
| Cliente reclama, cita preço fora de tabela, assunto sensível | Chama humano |
| Cliente pede explicitamente falar com atendente | Chama humano na hora |
| Erro na Google Agenda (token expirado, API fora) | Chama humano — nunca finge que agendou |

### O que "chamar humano" significa dentro do app

O iMasterChat **já tem esse mecanismo pronto**, e é bom. Quando um handoff
acontece:

- A conversa vira `status = 'pending'` (aparece na fila de pendentes).
- `ai_autoreply_disabled = true` na conversa — o bot **para de responder aquela
  thread para sempre**, mesmo que o cliente mande mais mensagens. Sem isso o bot
  ficaria atropelando a atendente.
- Uma nota interna é escrita em `ai_handoff_summary`, com a última fala do
  cliente citada — a atendente entende o contexto sem ler tudo
  (`src/lib/ai/handoff.ts`).
- Opcionalmente atribui a um atendente específico (`handoff_agent_id`).
- Um banner aparece na conversa dentro da caixa de entrada
  (`src/components/inbox/ai-thread-banner.tsx`), com botão para assumir e, depois,
  para devolver a conversa ao bot.

### A lacuna que existia — e como ficou resolvida

Esse mecanismo nasceu preso à IA nativa: `/api/v1/conversations` só tinha `GET`, e
o único endpoint que mexia em `assigned_agent_id` era
`/api/ai/autoreply/[conversationId]`, autenticado por **sessão de usuário**. Um
cérebro externo não tinha como dizer "para tudo, chama gente" — sobrava marcar o
contato com uma etiqueta e torcer para alguém olhar.

`POST /api/v1/conversations/{id}/handoff` fechou isso, com escopo próprio e
fazendo exatamente o que o handoff nativo faz (status pendente, silêncio da IA na
thread, nota interna, atribuição opcional).

Com o cérebro nativo, a tool `request_human(reason)` produz **o mesmo efeito pela
mesma função** — a rota e a tool chamam `src/lib/conversations/handoff.ts`. A
atendente não tem como saber qual dos dois pediu ajuda, e é esse o ponto.

### Onde a atendente vive

Na caixa de entrada do iMasterChat, como já vive hoje. Ela vê a conversa inteira
(bot e cliente), a fila de pendentes, o banner de handoff com o resumo, e assume
com um clique. **Nada disso muda entre as duas abordagens** — muda só quem gera a
resposta do bot.

### O que a ótica configura, e onde

| O quê | Onde |
|---|---|
| Horários de atendimento, duração da consulta, antecedência | Tela "Regras de agendamento" em Configurações — regra validável, não texto livre |
| Bloquear um dia (feriado, viagem) | Direto na Google Agenda — o bot respeita na hora |
| Desligar o bot numa conversa específica | Botão "assumir conversa" na caixa de entrada |
| Desligar o bot inteiro | Chave `is_active` na configuração de IA |

O bloqueio por evento na Google Agenda é consequência direta da decisão "Google
Agenda é a verdade" — a ótica não precisa aprender uma segunda ferramenta para
bloquear horário.

## Próximos passos

1. ~~Rota de handoff na API v1~~ — feita.
2. ~~Migração `appointments`~~ — feita (041).
3. **Laço de agente com tool calling** — o pré-requisito de tudo abaixo.
4. Credencial OAuth do Google Calendar (Google Cloud Console) para o app.
5. Definir com a cliente: duração da consulta, horários exatos seg–sex, janela de
   antecedência, política de remarcação/cancelamento — agora vira configuração de
   tela, não prompt.
6. Afinar o diálogo no Playground antes de encostar no número de teste.

---

## O plano: agendamento nativo

O que falta para o iMasterChat agendar sozinho. A ordem abaixo é de dependência,
não de preferência.

### 1. Tool calling na camada de IA

O maior item, e pré-requisito de todo o resto. Hoje `generateReply` é chamada uma
vez e devolve texto. Precisa virar um laço de agente:

- `ChatMessage` ganha o papel `tool` e blocos de conteúdo
  (`src/lib/ai/types.ts`).
- `ProviderArgs` ganha `tools` (`src/lib/ai/providers/shared.ts`).
- `openai.ts` manda `tools`/`tool_choice` e lê `tool_calls`.
- `anthropic.ts` manda `tools` e para de filtrar blocos que não sejam texto — o
  filtro atual descartaria um `tool_use` em silêncio.
- `generate.ts` ganha o laço: chama, executa a tool, realimenta o resultado,
  repete até resposta final ou teto de iterações.
- `auto-reply.ts` passa o catálogo de tools e trata turnos intermediários.

Feito na mão: não há SDK no projeto, os dois providers são `fetch` cru. Isso é
uma escolha do codebase, não um descuido — manter assim.

### 2. OAuth do Google

Também greenfield: não há `googleapis`, `next-auth`, nem qualquer lib de OAuth.
Precisa de fluxo de consentimento por conta, refresh token criptografado com
`ENCRYPTION_KEY` (mesmo mecanismo dos tokens de WhatsApp), renovação, e uma tela
de "conectar Google Agenda" em Configurações.

### 3. As tools em si

Assinatura estreita e validação **no servidor**:

- `check_availability(date_from, date_to)` → horário comercial × `freebusy` ×
  `appointments` → slots livres já filtrados pela regra.
- `book_appointment(starts_at, ends_at, title?)` → valida, cria evento, grava.
- `reschedule_appointment(appointment_id, starts_at, ends_at)`.
- `cancel_appointment(appointment_id, reason?)`.
- `request_human(reason)` → o mesmo efeito da rota de handoff, pela mesma função.

O modelo escolhe **qual** ferramenta usar e **quando**. Ele não decide se o slot
é válido — isso é do servidor. `src/lib/api/v1/appointments.ts` já tem essa
validação e deve ser reaproveitada.

### 4. Ajustes no que já existe

- **Data e hora no contexto.** `buildConversationContext` devolve só texto: o
  modelo não sabe que dia é hoje, nem o fuso do negócio, nem o nome do contato.
  `src/lib/ai/environment.ts` resolve isso, e vale **por si só** — mesmo sem tool
  alguma, corrige o bot que promete "amanhã" sem saber que dia é hoje.
- **Teto de respostas por conversa.** `auto_reply_max_per_conversation` tem
  default 3 e é reivindicado por `claim_ai_reply_slot`. Um diálogo de
  agendamento gasta mais e morre no meio. O teto continua contando **mensagens
  enviadas ao cliente**, não passos de tool — o que muda é o default subir para
  12 quando a conta tem agendamento ativo. Contador paralelo seria inventar um
  conceito onde já existe um correto.
- **`ai_usage_log.mode`** só aceita `('auto_reply','draft')` — migração para
  logar turnos de agente distintamente.
- **Playground** (`src/components/agents/ai-playground.tsx`) precisa renderizar
  chamadas de tool para dar para testar o diálogo sem WhatsApp. É o harness certo
  e já roda o mesmo caminho da produção.

### 5. Configuração pela ótica

Horário de funcionamento, duração da consulta e antecedência viram tela de
configuração (`ai_scheduling_settings`) — e aí a regra passa a ser validável e
testável, não texto livre num prompt.

### 6. A tela de agenda

Semana, dia e lista dos próximos, em `/agenda`. Criar, remarcar e cancelar
manualmente pela mesma `scheduling/store.ts` que a tool usa. Cada card mostra a
origem (`native` / `manual`) e leva à conversa que originou.

Um caso que a tela **precisa** mostrar em vez de esconder: agendamento com
`google_event_id` nulo. É a linha gravada cujo evento no Google falhou — a 041
deixou a coluna nullable justamente para esse estado ser visível. Ele precisa de
gente.

### O que NÃO muda

A tabela `appointments`, os escopos, a rota de handoff e a experiência da
atendente na caixa de entrada. Foram construídos para sobreviver à troca de
cérebro, e sobreviveram.
