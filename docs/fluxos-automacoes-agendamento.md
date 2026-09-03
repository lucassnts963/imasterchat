# Fluxos, automações e agendamento — o que cada um faz, e como se combinam

> Levantado no código em `main @ 52dbf11`. Responde três perguntas: como o
> agendamento se liga aos fluxos hoje, qual a diferença real entre fluxo e
> automação, e o que só sai combinando os dois.

---

## 1. Agendamento e fluxos: não se conectam

Direto ao ponto: **não existe nenhuma ligação.**

O agendamento vive inteiramente como **ferramenta de IA**. `buildSchedulingTools`
(`src/lib/ai/tools/scheduling.ts`) devolve quatro `AgentTool` —
`check_availability`, `book_appointment`, `reschedule_appointment`,
`cancel_appointment` — e quem as consome é o `runAgent`. Um fluxo não tem nó de
agendamento; uma automação não tem passo de agendamento.

A consequência é a que interessa comercialmente:

> **Hoje, cliente que não quer pagar IA não tem agendamento.** Não é uma questão
> de qualidade menor — é ausência total. O menu do fluxo consegue perguntar
> "qual dia você prefere?", e depois não tem como consultar a agenda nem marcar.

Isso reforça o que levantei em
[`posicionamento-cobranca.md`](./posicionamento-cobranca.md) §4: o caminho sem IA
está incompleto em duas pontas, não uma. Falta o template (para iniciar) e falta
o agendamento (para resolver).

---

## 2. A diferença real entre os dois

Não é "um é visual e o outro é lista". É de natureza:

| | **Automação** | **Fluxo** |
|---|---|---|
| O que é | uma **reação**: gatilho → sequência de passos → fim | uma **conversa com estado**: pergunta, **suspende**, retoma na resposta |
| Guarda estado? | não | sim — `flow_runs.current_node_key`, um run ativo por contato |
| Espera resposta? | não. O `wait` é **relógio**, não "aguardar o cliente" | sim, é a razão de existir |

### 2.1 O que a automação faz e o fluxo não

| Passo | Por que importa |
|---|---|
| **`send_template`** | **inicia conversa.** Fora da janela de 24h é o único jeito de falar |
| `wait` (min/horas/dias) | espera de relógio entre passos |
| `send_webhook` | chama sistema externo |
| `update_contact_field` · `create_deal` | escreve no CRM |
| `assign_conversation` · `close_conversation` | mexe no atendimento |
| `remove_tag` | fluxo só sabe pôr tag, não tirar |

E gatilhos que o fluxo não tem: **`time_based`**, `tag_added`,
`new_contact_created`, `conversation_assigned`.

### 2.2 O que o fluxo faz e a automação não

| Nó | Por que importa |
|---|---|
| **`collect_input`** | captura o que o cliente **digitou livremente** numa variável. A automação não tem como perguntar e guardar |
| `send_media` | imagem, vídeo, documento |
| `handoff` | passa para humano de dentro do roteiro |
| **Política de fallback** | resposta que não casa com nenhuma opção: `reprompt` · `handoff` · `end` · `ignore` |
| **Varredura de abandono** | `on_timeout_hours` por fluxo, para o contato não ficar travado para sempre |
| Editor visual | o operador desenha o menu |

> Resumindo em uma linha: **a automação age no mundo mas não sabe conversar; o
> fluxo conversa mas não sabe agir nem começar.**

---

## 3. Como se interligam hoje

### 3.1 A precedência no webhook

Quando chega mensagem, **o fluxo roda primeiro**. Se ele *consome* a mensagem, os
gatilhos de conteúdo da automação — `new_message_received`, `keyword_match`,
`interactive_reply` — são **suprimidos**. O cliente está navegando o menu, não
mandando palavra-chave nova.

Os gatilhos de relacionamento (`new_contact_created`, `first_inbound_message`)
disparam mesmo assim, porque são sobre *quem* mandou, não sobre *o que* disse.

E o fallback `ignore` **de propósito não consome** — o comentário no código diz
"let automations have a shot at it". É a válvula de escape.

### 3.2 A ponte

| Direção | Funciona? | Por quê |
|---|---|---|
| **Fluxo → automação** | **sim** | o `set_tag` do fluxo chama `addContactTagAndDispatch`, que **dispara os `tag_added`** |
| **Automação → automação** | **sim** | o `add_tag` da automação também despacha `tag_added`, com o mesmo teto `MAX_TAG_CHAIN_DEPTH` |
| **Automação → fluxo** | **sim** | passo `start_flow` (fase 1, R-1) |
| **IA → fluxo** | **sim** | ferramenta `start_flow`, restrita a fluxos ativos com gatilho `manual` |

> **Duas correções ao que este documento dizia antes (03/09/2026).**
>
> 1. Eu havia registrado que a ponte era **de mão única** e que o `add_tag` da
>    automação não despachava `tag_added`. Verificando o código: ele despacha,
>    com proteção de profundidade — a `main` já tinha fechado essa assimetria.
>    O que sobra ali não é falta de comportamento, é **duplicação**: o motor de
>    automações reimplementa `addContactTagAndDispatch` em vez de chamá-la.
> 2. "Automação → fluxo não existe" deixou de valer: `startFlowRun` é a segunda
>    entrada pública do motor de fluxos, e o passo `start_flow` e a ferramenta
>    homônima são os dois adaptadores em cima dela.

---

## 4. O que só sai combinando os dois

### 4.1 Cobrança sem IA — funciona hoje

O caso que você descreveu, montado com o que já existe:

1. **Automação `time_based`** dispara no vencimento e manda o **template** de
   cobrança. *(Só automação envia template.)*
2. Cliente responde. **Fluxo** por palavra-chave assume e oferece menu:
   *já paguei · vou pagar · falar com atendente*. *(Só fluxo conversa.)*
3. Em "vou pagar", **`collect_input`** captura a data prometida.
   *(Só fluxo captura texto livre.)*
4. Fluxo faz **`set_tag` "promessa-pagamento"** → dispara automação que faz
   `update_contact_field` com a data, `create_deal` e `assign_conversation`.
   *(Só automação escreve no CRM.)*

**Nenhum dos dois sozinho entrega isso.** A automação não pergunta; o fluxo não
manda template nem escreve no CRM.

### 4.2 Onde a corrente arrebenta

O elo 1→2 é frágil. O fluxo só pode ser iniciado por **palavra-chave**,
**primeira mensagem** ou **manual**. Se o cliente responder à cobrança com "ok"
ou "já paguei ontem", nenhuma palavra-chave casa e o fluxo não assume — a
resposta vai para o vazio, ou para a IA, que é justo o que o cliente não quer
pagar.

---

## 5. O que eu recomendo construir, em ordem de alavancagem

| # | O quê | Destrava |
|---|---|---|
| **1** | **Passo `start_flow` na automação** (ou gatilho `tag_added` no fluxo) | fecha a corrente nos dois sentidos. É o item de maior alavancagem do documento inteiro, e é **P** — a automação já tem o `contact_id` e o `conversation_id` que o runner do fluxo precisa |
| **2** | **Nó `send_template` no fluxo** | fluxo passa a **iniciar** conversa. Já apontado como bloqueante do GA |
| **3** | **Nós de agendamento no fluxo** — `check_availability` e `book_appointment` como nós | agendamento sem IA. A lógica já existe em `src/lib/scheduling/`; hoje só a IA alcança |
| 4 | Nó de espera no fluxo | "se não responder em 1h, insista" |
| 5 | `send_webhook` como nó de fluxo | integrar sem sair do roteiro |

Os itens 1 a 3 juntos entregam **agendamento e cobrança completos, sem uma linha
de IA** — que é exatamente o produto que você quer poder vender para quem recusa
o custo do modelo.

E vale notar: os itens 2 e 3 **reaproveitam código que já existe**
(`engineSendTemplate` e `src/lib/scheduling/`). Não é motor novo, é expor ao
fluxo o que hoje só a IA e a automação alcançam.

---

## 6. Uma observação de arquitetura

Fluxo e automação estão convergindo. A automação ganhou `condition` e `wait`; o
fluxo ganhou fallback e timeout. Se os itens 2 a 5 entrarem, o fluxo passa a
fazer quase tudo que a automação faz, **mais** conversar.

Não estou propondo unificar agora — a automação é mais simples de configurar para
casos simples, e há fluxos e automações em produção. Mas vale decidir
conscientemente se o destino é **dois motores que se compõem** (e então o item 1
é permanente, não paliativo) ou **um motor só** com a automação virando um fluxo
linear. Escolher isso agora evita construir a mesma coisa duas vezes nos
próximos meses.
