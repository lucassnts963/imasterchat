# Fase 2 — Fluxos para GA (o caminho sem IA)

> Especificação. **Nenhum código escrito.** Estado verificado por inspeção em
> `main` em 03/09/2026.
>
> Depende da fase 1 blocos B e C. Fundamentação em
> [`../posicionamento-cobranca.md`](../posicionamento-cobranca.md) §4.

---

## 1. Objetivo

Entregar o **caminho sem inteligência artificial**: o cliente que não quer pagar
modelo consegue atender, agendar e cobrar por menu — "digite 1, digite 2" — com a
mesma solidez de quem usa IA.

Hoje isso quase existe. O que falta não é o motor: é um punhado de capacidades e
uma decisão de rótulo.

---

## 2. Correção de estado — o gate já não existe

A análise anterior dizia que sair do beta era "remover a checagem em 7 arquivos".
**Isso está desatualizado.** A verificação em código diz outra coisa:

| Superfície | Estado real |
|---|---|
| `GET/POST /api/flows` | aberto a qualquer usuário autenticado — *"the previous per-account beta gate was removed when Flows went to soft-GA"* |
| `/api/flows/[id]` | idem, *"the beta gate that previously 404'd non-beta accounts is [gone]"* |
| `/(dashboard)/flows` | aberto; o comentário aponta o PR #134 como quem removeu |
| Sidebar | ainda mostra o chip `beta` (`sidebar.tsx:102`) |
| Cabeçalho da lista de fluxos | ainda mostra o chip `beta` (`page.tsx:209`) |

**Fluxos estão em soft-GA.** O `beta_features` de `profiles` continua existindo
para outras coisas, mas não gateia fluxo nenhum.

Consequência para o plano: **tirar o rótulo é trabalho de minutos.** O que
justifica esta fase é o que está por trás do rótulo — o motor precisa merecê-lo
antes de a gente prometer GA a um cliente que vai depender dele para cobrar.

---

## 3. O que o motor já tem

Verificado em `src/lib/flows/`: 5 arquivos de teste, dez tipos de nó.

| Nó | Existe |
|---|:--:|
| `start` · `end` | ✅ |
| `send_message` | ✅ |
| `send_buttons` · `send_list` | ✅ |
| `send_media` | ✅ |
| `collect_input` | ✅ |
| `condition` | ✅ |
| `set_tag` | ✅ |
| `handoff` | ✅ |

Mais: política de fallback para resposta que não casa (`reprompt` · `handoff` ·
`end` · `ignore`), varredura de abandono por cron com `on_timeout_hours` por
fluxo, um run ativo por contato garantido por índice parcial, e runs e eventos
gravados para auditoria.

**Isso é um motor de menu completo.** O "digite 1, digite 2" funciona hoje.

---

## 4. O que falta, e o que a fase 1 já resolve

| Lacuna | Quem resolve | Sobra para esta fase |
|---|---|---|
| Fluxo não envia template | **fase 1, R-7 G1** | nada |
| Fluxo não agenda | **fase 1, R-4** | nada |
| Não existe nó de espera (relógio) | **fase 1, R-9 I1** | nada |
| Não existe nó de webhook | **fase 1, R-9 I2** | nada |
| Ações de CRM (remover tag, campo, negócio, fila) | **fase 1, R-6 e R-8** | nada |
| **Timeout por nó** | ninguém | **R-10** |
| **Teste de ponta a ponta do motor** | ninguém | **R-11** |
| **Retomada explícita depois do handoff** | ninguém | **R-12** |
| **O rótulo de beta** | ninguém | **R-13** |

> Esta é a razão de a fase 2 vir depois da 1 e ser barata: **seis das dez
> lacunas somem sozinhas.** Se a ordem fosse invertida, tudo isso seria escopo
> daqui.

---

## 5. Requisitos

`P` = 1–2 dias · `M` = 3–7 dias.

### R-10 · Timeout por nó — `P`

Hoje o timeout é do run inteiro (`on_timeout_hours`). Não dá para dizer "este
menu expira em 10 minutos, mas a coleta do CPF pode levar uma hora".

- **A1** `timeout_minutes` opcional na configuração de qualquer nó que suspende
  (`collect_input`, `send_buttons`, `send_list`).
- **A2** Estourado o prazo, o run segue por uma **aresta de timeout** própria. Sem
  aresta configurada, cai na política de fallback do fluxo — o comportamento de
  hoje, para não mudar fluxo em produção.
- **A3** O timeout do run inteiro continua existindo como teto. O menor dos dois
  vence.
- **A4** A varredura de abandono passa a considerar o prazo do nó, não só o do run.

**Como ficou.** O prazo do nó reusa o relógio que o R-9 construiu — `resume_at`
mais o cron — em vez de inventar um segundo. O que precisou nascer foi
`resume_kind` (migração 079), porque **três motivos diferentes** levam um run a
ter hora marcada e a varredura de abandono trata cada um de um jeito:

| `resume_kind` | O que é | A varredura de abandono |
|---|---|---|
| `wait` | o fluxo decidiu dormir | **não pode matá-lo** — um "espera 3 dias" seria varrido em 24h |
| `node_timeout` | o **cliente** está calado num menu | continua valendo: é exatamente o que ela mede, e o menor prazo vence |
| `handoff_pause` | uma pessoa assumiu a conversa | continua valendo, para não segurar o contato para sempre |

Sem essa coluna, a varredura teria de escolher entre matar quem dorme ou nunca
cobrar quem se calou.

Duas sutilezas que o teste cobre:

- **Responder limpa o prazo.** Sem isso o cron acordaria um run que já andou e o
  mandaria pela aresta de "ninguém respondeu" — depois de alguém ter respondido.
- **O conector de prazo só aparece quando o nó tem prazo.** Mostrar "ninguém
  respondeu" em todo menu encheria a tela de pontas soltas que nunca disparam, e
  o operador aprenderia a ignorá-las.

### R-11 · Teste de ponta a ponta do motor — `M`

Existe teste de validação, de arestas, de fallback e de layout. **Não existe um
que rode um fluxo inteiro do gatilho ao `end`.** Sem ele, GA é promessa sem
prova.

- **B1** Um teste que dispara por palavra-chave, passa por menu, coleta entrada,
  ramifica em condição, marca tag e termina — verificando `flow_runs` e
  `flow_run_events` em cada passo.
- **B2** Um teste do caminho de recusa: resposta que não casa com nenhuma opção,
  em cada uma das quatro políticas de fallback.
- **B3** Um teste do caminho de abandono: run que estoura o prazo e é encerrado
  pela varredura, liberando o índice de "um run ativo por contato".
- **B4** Um teste da ponte da fase 1: automação inicia fluxo, fluxo termina,
  automação de `tag_added` dispara. *(Coberto por `start-run.test.ts` e
  `engine.test.ts` das automações; o teste de ponta a ponta cobre o motor.)*

**Como ficou.** `end-to-end.test.ts` monta um banco duplo **com estado de
verdade** — `flow_runs` e `flow_run_events` guardam o que foi escrito e as
consultas leem de volta. É o que permite afirmar "o run avançou para X" em vez
de "a função foi chamada", e foi o que permitiu cobrir a idempotência contra
reentrega da Meta, que um mock de chamadas não alcança.

Um dos testes verifica que o texto cru do cliente **não** entra no histórico: um
`collect_input` que pergunta o cartão deixaria o número em `flow_run_events`
para sempre.

### R-12 · Retomada depois do handoff — `P`

Hoje `handoff` entrega a conversa e o run acaba. Para cobrança isso é um buraco:
o cliente diz "quero negociar", vai para um humano, o humano resolve — e nada
devolve a pessoa ao roteiro.

- **C1** `handoff` ganha modo **"pausa"**: o run fica suspenso em vez de encerrado,
  e o índice de run ativo continua respeitado.
- **C2** Uma ação (botão na inbox, e passo de automação) **retoma** o run pausado
  no nó seguinte.
- **C3** Run pausado tem prazo próprio; estourado, encerra como abandono. Nunca
  um run pendurado para sempre segurando o contato.
- **C4** O modo atual (encerrar no handoff) continua sendo o padrão.

**Como ficou.** `handoff` ganhou `mode: 'end' | 'pause'`. Em `pause` o run fica
**ativo**, parado no nó, com prazo próprio — e três caminhos o devolvem ao
roteiro: `POST /api/flows/runs/resume`, o passo **Retomar fluxo pausado** da
automação, e o vencimento do prazo (que encerra em vez de retomar).

A devolução é endereçada pelo **contato**, não pelo id do run: quem clica é uma
atendente olhando uma conversa, e ela não sabe o que é um run. O índice parcial
de um run ativo por contato garante que existe no máximo um para devolver.

Ao retomar, a conversa **volta a ser do robô** — `ai_autoreply_disabled` volta a
falso. Sem isso o fluxo retomaria falando enquanto a inbox continua marcando a
conversa como transferida.

### R-13 · Tirar o rótulo — `P`

- **D1** Remover o chip `beta` da sidebar e do cabeçalho da lista.
- **D2** Manter a chave de tradução até a próxima limpeza — remover string em três
  idiomas por causa de um chip é ruído de diff.
- **D3** Só depois de R-10 a R-12 e da fase 1 estarem verdes. **O rótulo é a
  última coisa, não a primeira.**

Feito nessa ordem: os chips saíram depois de o motor ter prazo por nó, retomada
depois do handoff, e um teste que atravessa o motor inteiro — do gatilho por
palavra-chave ao `end`, passando por menu, coleta, condição e etiqueta.

---

## 6. Critérios de aceite

1. Um cliente é atendido, escolhe serviço por menu, agenda um horário e recebe
   confirmação — **sem uma única chamada de modelo**.
2. Uma régua de cobrança de quatro degraus roda inteira como fluxo + automação,
   com template em cada degrau.
3. Um menu que ninguém responde expira no prazo do nó e desvia, sem derrubar o
   run inteiro.
4. Uma conversa entregue a humano volta ao roteiro quando o atendente devolve.
5. O teste de ponta a ponta cobre gatilho → menu → coleta → condição → tag → fim.
6. Nenhuma tela diz "beta".

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| **Mudar comportamento de fluxo em produção** | todo requisito aqui é opt-in: timeout por nó é opcional, handoff-pausa não é o padrão |
| **GA prometido antes do motor merecer** | R-13 é explicitamente o último requisito, e depende da fase 1 fechada |
| **Run pausado segurando o contato** | C3: prazo próprio e encerramento por abandono |

---

## 8. Estimativa

| Requisito | Esforço |
|---|---|
| R-10 timeout por nó | ~2 dias |
| R-11 teste ponta a ponta | ~4 dias |
| R-12 retomada pós-handoff | ~2 dias |
| R-13 rótulo | ~1 hora |

**Total ~1,5 semana**, contando que a fase 1 entregou template, espera,
agendamento, webhook e ações de CRM.
