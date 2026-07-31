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

## Próximos passos

1. Criar a credencial de Google Calendar no n8n e a chave de API do iMasterChat.
2. Definir com a cliente: duração da consulta, horários exatos seg–sex, janela de
   antecedência, política de remarcação/cancelamento.
3. Montar o workflow do n8n e testar o diálogo no número de teste.
4. Migração `appointments` no app (tabela + endpoint de escrita na API v1) para o
   histórico já nascer no produto.
5. Depois de rodar com a ótica: decidir se o volume justifica a versão nativa.
