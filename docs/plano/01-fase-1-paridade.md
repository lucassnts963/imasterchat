# Fase 1 — Paridade e conexão entre os três motores

> Especificação. **Nenhum código escrito.** Estado verificado por inspeção em
> `main @ 52dbf11`.
>
> Contexto e diferença de natureza entre os motores em
> [`../fluxos-automacoes-agendamento.md`](../fluxos-automacoes-agendamento.md).

---

## 1. Objetivo

Fechar as arestas entre **agente de IA**, **fluxos** e **automações**, de modo
que o operador não esbarre em "isso aqui não dá porque você escolheu o motor
errado".

Duas consequências que justificam a fase sozinha:

- **Agendamento hoje só existe na IA.** Cliente que recusa o custo do modelo não
  tem agendamento — não é versão pior, é ausência.
- **Automação não consegue iniciar um fluxo.** Depois de mandar um template de
  cobrança, nada assume a conversa com estado se o cliente responder "ok".

---

## 2. Matriz atual — verificada, não lembrada

`✅` existe · `❌` não existe · `➖` não se aplica

| Capacidade | Agente IA | Fluxo | Automação |
|---|:--:|:--:|:--:|
| Enviar texto | ✅ | ✅ | ✅ |
| Enviar botões | ❌ | ✅ | ✅ |
| Enviar lista | ❌ | ✅ | ✅ |
| Enviar mídia | ❌ | ✅ | ❌ |
| **Enviar template** | ❌ | ❌ | ✅ |
| **Coletar entrada livre** | ✅ | ✅ | ❌ |
| Condição / ramificação | ✅ | ✅ | ✅ |
| Adicionar tag | ✅ | ✅ | ✅ |
| Remover tag | ❌ | ❌ | ✅ |
| Atualizar campo do contato | ❌ | ❌ | ✅ |
| Criar negócio | ❌ | ❌ | ✅ |
| Atribuir conversa | ❌ | ❌ | ✅ |
| Encerrar conversa | ❌ | ❌ | ✅ |
| Passar para humano | ✅ | ✅ | ❌ |
| **Rotear para fila** | ✅ | ❌ | ❌ |
| Webhook de saída | ❌ | ❌ | ✅ |
| Esperar (relógio) | ❌ | ❌ | ✅ |
| **Consultar disponibilidade** | ✅ | ❌ | ❌ |
| **Agendar / remarcar / cancelar** | ✅ | ❌ | ❌ |
| **Iniciar fluxo** | ✅ | ❌ | ✅ |
| Disparar automação | ✅ (via tag) | ✅ (via tag) | ✅ (via tag) |

**Vinte e uma capacidades, e apenas quatro existem nos três motores.**

> **Revisão de 03/09/2026, com R-1 e R-2 implementados.** Duas linhas mudaram, e
> uma delas por correção e não por trabalho:
>
> - **Iniciar fluxo** passou a existir no agente de IA e na automação (R-1). No
>   fluxo continua `❌` de propósito: um fluxo que inicia outro fluxo esbarraria
>   no índice de um run ativo por contato, e a composição certa ali é a aresta
>   entre nós, não um segundo run.
> - **Disparar automação** já era `✅` nos três. Eu havia registrado que o
>   `add_tag` da automação não despachava `tag_added`; ele despacha, com o mesmo
>   teto de profundidade. O que R-2 encontrou não foi comportamento faltando, e
>   sim a mesma lógica escrita duas vezes — ver o requisito.

---

## 3. O princípio de implementação

Sem isso, esta fase triplica a manutenção para sempre.

> **Uma capacidade, uma implementação, três adaptadores finos.**

Hoje "adicionar tag" existe três vezes: ferramenta de IA (`tools/tags.ts`), nó de
fluxo (`set_tag`) e passo de automação (`add_tag`) — e as três **já divergem**:
só a do fluxo dispara `tag_added`.

**Requisito estrutural:** extrair `src/lib/actions/` — um módulo por capacidade,
com assinatura própria e testes próprios, sem saber quem chama. Cada motor vira
tradutor: nó/passo/ferramenta → chamada de ação.

O agendamento já está assim (`src/lib/scheduling/`), e é a prova de que funciona:
por isso os requisitos de agendamento abaixo são **M** e não **G**.

---

## 4. Onde a paridade é por ponte, e não por cópia

Três células não devem ser preenchidas por duplicação. Preencher pioraria o
produto, e a necessidade é atendida por composição.

| Célula | Por que não duplicar | Como fica atendida |
|---|---|---|
| **Coletar entrada livre na automação** | automação não guarda estado. Coletar exige suspender e retomar, que é a definição de fluxo. Fazer isso na automação é reescrever o motor de fluxo dentro dela | `iniciar_fluxo` (R-1): a automação delega a coleta ao fluxo |
| **Botões e lista como ferramenta da IA** | o agente compõe a resposta em texto; forçá-lo a "chamar uma ferramenta para desenhar um menu" troca a força dele por rigidez | `iniciar_fluxo` disponível como ferramenta: o agente entrega ao fluxo quando o menu for melhor |
| **Esperar (relógio) na IA** | um turno de agente é síncrono; um agente "esperando 3 dias" é um processo pendurado. É automação, não agente | agente chama `iniciar_fluxo`/tag; a automação faz a espera |

> Isto não reduz o escopo pedido — todo caminho continua existindo em qualquer
> motor. Muda **como**: por composição explícita em vez de três motores
> reimplementando uns aos outros.

**Aprovado em 03/09** (decisão 4.3 do plano geral).

---

## 5. Requisitos

Ordenados por dependência. `P` = 1–2 dias · `M` = 3–7 dias.

### Bloco A — A ponte

#### R-1 · Iniciar fluxo a partir de automação e de IA — `P` — **feito**
- **A1** Passo `iniciar_fluxo` na automação, com o fluxo alvo como parâmetro.
- **A2** Ferramenta equivalente para o agente de IA.
- **A3** Se já houver run ativo para o contato, **não** cria outro — o índice
  parcial `idx_one_active_run_per_contact` é a fonte da verdade. Resultado
  registrado como recusa explícita, nunca silêncio.
- **A4** Proteção contra laço: fluxo que inicia automação que reinicia o mesmo
  fluxo. Reusar `MAX_TAG_CHAIN_DEPTH` ou um contador equivalente.
- **A5** Registro em `flow_run_events` de quem iniciou (automação, agente, humano).

> **Maior alavancagem da fase.** A automação já tem `contact_id` e
> `conversation_id` — que é tudo que o runner precisa.

**Como ficou.** `startFlowRun` em `src/lib/flows/engine.ts` é a segunda entrada
pública do motor, ao lado de `dispatchInboundToFlows`, e os dois motores são
adaptadores finos por cima dela — traduzem a própria forma para
`StartFlowRunInput` e traduzem a resposta de volta. Três decisões que valem
registrar:

- **Nunca lança.** Os dois chamadores são caminhos de fire-and-forget onde uma
  exceção derrubaria uma execução de automação ou um turno do agente. Toda
  falha volta como recusa **nomeada** — e `describeStartFlowRefusal` dá a
  mesma frase para o log da automação e para o resultado da ferramenta, para
  os dois não divergirem.
- **Recusa não é falha de passo.** "O cliente já está em um fluxo" é o
  resultado correto de uma automação bem construída cujo cliente está no meio
  de um menu. Lançar marcaria a execução inteira como falha e mataria todos os
  passos seguintes.
- **A ferramenta do agente encerra o turno** (`yieldTurn`, novo em
  `ToolOutcome`). O fluxo já mandou o primeiro nó; qualquer frase do agente por
  cima vira uma segunda mensagem e o cliente responde a errada. É deliberadamente
  distinto de `handoff`, que chama gente: aqui ninguém é chamado, e sem essa
  distinção a resposta automática abriria uma transferência a cada fluxo
  iniciado.
- **A lista é a permissão.** O agente só enxerga fluxos **ativos com gatilho
  `manual`** — mesma defesa da ferramenta de etiquetas. Fluxo com gatilho de
  palavra-chave já tem quem o inicie, e deixá-lo na lista significaria que uma
  frase do cliente, interpretada, dispara um roteiro por um caminho que ninguém
  configurou.

#### R-2 · Simetria no disparo de tag — **já existia**

Verificado em `src/lib/automations/engine.ts`: o `add_tag` da automação chama
`addContactTagIfAbsent` e **despacha `tag_added`** logo em seguida, com
`MAX_TAG_CHAIN_DEPTH`. A assimetria que este requisito ia corrigir não existe
mais — a `main` a fechou antes.

**O que sobra é duplicação, não comportamento.** O motor de automações
reimplementa `addContactTagAndDispatch` em vez de chamá-la, e as duas cópias
concordam hoje por coincidência de manutenção. A causa é um ciclo de imports
(`tag-events` → `automations/engine`), e desfazê-lo é mexer em caminho quente de
produção para ganhar limpeza, não comportamento.

- **B1** ~~passar a despachar~~ — feito na `main`.
- **B2** Deduplicar as duas cópias fica registrado como dívida, **fora do bloco
  A**: o risco de tocar nisso agora é maior que o de deixar, e um teste que
  prove que os dois caminhos concordam vale mais do que a fusão.

### Bloco B — Agendamento nos três motores

#### R-3 · Agendamento como ação de domínio — `P`
- **C1** Extrair de `tools/scheduling.ts` a lógica que não é da IA, para
  `src/lib/actions/scheduling.ts`: consultar disponibilidade, agendar, remarcar,
  cancelar.
- **C2** As ferramentas da IA passam a chamar a ação. **Comportamento idêntico**
  — os testes atuais devem passar sem alteração.

#### R-4 · Nós de agendamento no fluxo — `M`
- **D1** Nó `consultar_horarios`: consulta e apresenta as opções como lista.
- **D2** Nó `agendar`: marca o horário escolhido.
- **D3** Nós `remarcar` e `cancelar`.
- **D4** Sem agenda conectada, o nó falha com desvio próprio no roteiro — nunca
  trava o run nem mente para o cliente.
- **D5** Fuso e horário de funcionamento vêm de `ai_scheduling_settings`, a mesma
  fonte da IA. Sem segunda configuração.

#### R-5 · Agendamento na automação — `M`
- **E1** Passos `agendar`, `remarcar`, `cancelar`.
- **E2** `consultar_horarios` **não** vira passo de automação: apresentar
  horários exige esperar a escolha, que é fluxo. A automação que precisa disso
  usa `iniciar_fluxo`.

### Bloco C — Encher a matriz

#### R-6 · Ações de CRM no fluxo — `M`
- **F1** Nós: `remover_tag`, `atualizar_campo`, `criar_negocio`,
  `atribuir_conversa`, `encerrar_conversa`.
- **F2** Todos sobre `src/lib/actions/`, compartilhados com a automação.

#### R-7 · Template e mídia — `M`
- **G1** Nó `enviar_template` no fluxo — **destrava o GA dos fluxos e a régua de
  cobrança**.
- **G2** Passo `enviar_midia` na automação.

#### R-8 · Fila e humano — `P`
- **H1** `rotear_para_fila` como nó de fluxo e passo de automação.
- **H2** `passar_para_humano` como passo de automação.

#### R-9 · Espera e webhook no fluxo — `P`
- **I1** Nó `esperar` (relógio), distinto de suspender aguardando resposta.
- **I2** Nó `chamar_webhook`.

---

## 6. O que fica de fora desta fase

Registrado para não virar escopo por engano:

- Múltiplos agentes de IA e seletor de turno
- Skills
- Múltiplas agendas do Google (fase 6)
- Qualquer coisa de cobrança (fases 3 a 5)

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| **Regressão no que está em produção** | R-3 exige que os testes de agendamento passem sem alteração; R-2 mantém o padrão atual |
| **Laço entre motores** | fluxo → automação → fluxo. R-1 A4 e R-2 B1 tratam, e o teste tem de cobrir o ciclo, não só o caminho feliz |
| **Explosão da matriz** | é o que o §3 existe para evitar. Se os requisitos forem implementados sem `src/lib/actions/`, a fase entrega o pedido e cria um problema maior |
| **Fluxo e automação viram a mesma coisa** | resolvido: decisão 4.1 do plano geral fixou **dois motores que se compõem**. A automação continua sendo reação sem estado; o fluxo, conversa com estado. Nenhum requisito desta fase dá memória à automação |

---

## 8. Critérios de aceite

1. Um agendamento pode ser marcado **sem nenhuma chamada de modelo**, ponta a
   ponta, por um fluxo.
2. Uma automação inicia um fluxo, e o fluxo retoma a conversa com estado.
3. Um fluxo, ao terminar, dispara automação — e o caminho inverso também existe.
4. Toda capacidade da matriz da §2 está `✅` nos três motores, ou está na tabela
   da §4 com justificativa.
5. Nenhuma capacidade tem duas implementações: cada uma tem um módulo em
   `src/lib/actions/` e três adaptadores.
6. Teste de laço fluxo → automação → fluxo termina, e termina registrando por quê.

---

## 9. Estimativa

| Bloco | Requisitos | Esforço |
|---|---|---|
| A — a ponte | R-1, R-2 | ~3 dias |
| B — agendamento | R-3, R-4, R-5 | ~2 semanas |
| C — matriz | R-6 a R-9 | ~2 semanas |

**Total ~5 semanas**, com o bloco A entregando valor na primeira.

A ordem importa: **A antes de tudo**, porque é o que permite resolver por ponte
em vez de duplicar — e portanto encolhe os blocos B e C.
