# Agendamento com Google Agenda — análise e plano

Cliente: ótica. Quer que a IA agende consultas sozinha pelo WhatsApp, de segunda a
sexta, em horários definidos, com a Google Agenda mandando na disponibilidade.

Decisões já tomadas:

- **Google Agenda é a fonte da verdade** — antes de oferecer horário, consulta os
  eventos ocupados. Se a cliente marcar algo direto no Google, a IA respeita.
- **IA confirma sozinha, com limites** — dentro das regras (horário comercial,
  janela de dias, 1 agendamento por cliente); fora disso, handoff para humano.
- **Uma agenda só** — a loja atende um cliente por vez no horário.

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

## Recomendação

**n8n primeiro, app depois** — e não como gambiarra, como sequência deliberada.

O motivo não é só prazo. É que ninguém sabe ainda qual é o diálogo certo de
agendamento para essa ótica: como o cliente pede horário, quantas idas e vindas,
o que acontece quando não tem vaga, quando ele quer remarcar. Descobrir isso
mexendo em prompt no n8n custa minutos; descobrir construindo tool calling na
mão custa semanas — e você construiria a feature errada.

Quando o diálogo estiver provado com clientes reais, aí a Abordagem A vira um
port do que já funciona, com requisito conhecido.

**A condição para isso não virar dívida**: o contrato entre app e n8n hoje
(webhook de saída para fora, API v1 para dentro) precisa ser o mesmo contrato que
a feature nativa usaria depois. Migrar deve ser trocar o cérebro, não reescrever
o corpo. Concretamente: a tabela `appointments` (item 3 da Abordagem A) vale
construir **agora**, com o n8n gravando nela via API — assim o histórico de
agendamentos já nasce dentro do produto, e a versão nativa só troca quem escreve.

---

## Como funciona na prática

### A conversa, passo a passo

```
Cliente:  "oi, queria marcar um exame de vista"
            │
            ├─ Meta entrega no webhook do iMasterChat
            ├─ App grava contato, conversa e mensagem (sempre)
            └─ Automação `new_message_received` → POST para o n8n
                        │
IA (n8n):   lê o histórico da conversa (memória por telefone)
            usa a tool `calendar:availability` na agenda da ótica
            │
            └─ responde via POST /api/v1/messages
Bot:      "Claro! Tenho quinta 14h, quinta 16h ou sexta 09h. Qual fica melhor?"

Cliente:  "quinta de tarde"
            │
IA:         entende "quinta 14h ou 16h", já sabe que hoje é terça
            (a data atual é injetada no prompt — o modelo não sabe sozinho)
Bot:      "Quinta às 14h ou às 16h?"

Cliente:  "14h"
            │
IA:         valida a regra seg–sex e o horário comercial
            usa a tool `event:create` → grava na Google Agenda
            grava também em `appointments` no app (histórico no produto)
Bot:      "Pronto! Exame marcado para quinta, 14h. Te espero aqui 😊"
```

A atendente vê **toda** essa conversa na caixa de entrada do iMasterChat, em
tempo real, sem precisar fazer nada. O bot não é um canal paralelo — as
mensagens dele são gravadas como mensagens da conversa, marcadas como geradas
por IA.

### Quem garante a regra de negócio

Duas camadas, e as duas são necessárias:

1. **O prompt** diz o comportamento: horário de funcionamento, duração da
   consulta, tom, o que fazer quando não há vaga.
2. **Um nó `IF` antes de gravar** valida o que o modelo decidiu: é dia útil? está
   dentro da janela? o slot ainda está livre?

A segunda camada existe porque prompt não é garantia. Modelo alucina data,
inventa horário, confunde "quinta que vem". Se a validação falhar, não grava —
vira handoff.

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

### A lacuna: o n8n não consegue disparar isso hoje

Esse mecanismo está ligado à IA nativa. Com o n8n sendo o cérebro, ele precisa de
um jeito de dizer "para tudo, chama gente" — e **não existe**:

- `/api/v1/conversations` só tem `GET`. Não há `PATCH`, não há atribuição.
- O único endpoint que mexe em `assigned_agent_id` é
  `/api/ai/autoreply/[conversationId]`, autenticado por **sessão de usuário** —
  o n8n não tem sessão, tem chave de API.

Então **falta uma rota**: `POST /api/v1/conversations/{id}/handoff`, com escopo
próprio, que faça exatamente o que o handoff nativo faz (status pendente, nota
interna, atribuição opcional). É trabalho pequeno — meio dia — e é justamente o
contrato que a versão nativa usaria depois. Sem ela, o "chama humano" vira
gambiarra: marcar o contato com uma etiqueta e torcer para alguém olhar.

### Onde a atendente vive

Na caixa de entrada do iMasterChat, como já vive hoje. Ela vê a conversa inteira
(bot e cliente), a fila de pendentes, o banner de handoff com o resumo, e assume
com um clique. **Nada disso muda entre as duas abordagens** — muda só quem gera a
resposta do bot.

### O que a ótica configura, e onde

| O quê | Onde |
|---|---|
| Horários de atendimento, duração da consulta, antecedência | Prompt do agente no n8n (depois: tela de configuração no app) |
| Bloquear um dia (feriado, viagem) | Direto na Google Agenda — o bot respeita na hora |
| Desligar o bot numa conversa específica | Botão "assumir conversa" na caixa de entrada |
| Desligar o bot inteiro | Chave `is_active` na configuração de IA |

O bloqueio por evento na Google Agenda é consequência direta da decisão "Google
Agenda é a verdade" — a ótica não precisa aprender uma segunda ferramenta para
bloquear horário.

## Próximos passos

1. Criar a credencial de Google Calendar no n8n e a chave de API do iMasterChat.
2. Definir com a cliente: duração da consulta, horários exatos seg–sex, janela de
   antecedência, política de remarcação/cancelamento.
3. **Rota de handoff na API v1** (`POST /api/v1/conversations/{id}/handoff`) — sem
   ela o n8n não consegue acionar humano de forma decente. Meio dia de trabalho,
   e é o mesmo contrato que a versão nativa usa depois.
4. Migração `appointments` no app (tabela + endpoint de escrita na API v1) para o
   histórico já nascer no produto.
5. Montar o workflow do n8n e testar o diálogo no número de teste.
6. Depois de rodar com a ótica: decidir se o volume justifica a versão nativa.
