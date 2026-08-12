# Plano de trabalho

Ordenado por **custo e risco crescentes**. As primeiras ondas são horas
de trabalho e quase nenhum risco; as últimas mexem no caminho por onde
toda mensagem entra.

Cada item diz o que muda, onde, e o que pode dar errado.

---

## Antes de tudo: o rodízio, explicado

Você pediu para entender a finalidade antes de decidir. Ela é estreita.

**O que é.** Quando uma conversa precisa de gente e existem *várias*
pessoas que poderiam pegar, o rodízio decide qual — revezando. Ana,
Bruno, Carla, Ana de novo.

**Para que serve.** Um problema só, e ele é humano, não técnico: quando
ninguém é designado, ou todo mundo acha que outro vai pegar e ninguém
pega, ou a pessoa mais diligente pega tudo e afunda enquanto os outros
ficam ociosos. O rodízio tira essa decisão das pessoas.

**Quando NÃO serve para nada.** Com **um** atendente. Rodízio de uma
pessoa é sempre a mesma pessoa — cerimônia pura. Com dois, já é
discutível: eles se organizam sozinhos, olhando a tela.

Ele começa a valer com **três ou mais pessoas na mesma fila**.

**Como está hoje: mentindo.** O modo existe na interface, chamado
"Rodízio", e faz isto:

```ts
// automations/engine.ts:487-497
.select('user_id').eq('account_id', …).limit(1)   // sem ORDER BY, sem estado
```

Sem ordenação e sem memória do último. O Postgres devolve a linha que
quiser — na prática, quase sempre a mesma pessoa. **Está pior do que
não existir**, porque quem liga acredita que a equipe está sendo
revezada.

### A recomendação

**Não implemente rodízio agora.** A ótica tem uma ou duas pessoas; ele
resolveria um problema que ela não tem, e é o item mais caro de fazer
direito (a parte difícil é a corrida entre dois encaminhamentos
simultâneos — detalhada na Onda 5).

O que fazer agora, em minutos: **tirar o rótulo "Rodízio" da tela**. O
desenho de fila abaixo já deixa o lugar dele pronto — quando aparecer um
cliente com quatro atendentes no mesmo balcão, é uma coluna e uma
função.

---

## E a fila ajuda com a sobrecarga?

Ajuda — mas não do jeito que a palavra sugere, e vale separar bem porque
são **duas filas diferentes com o mesmo nome**:

| | fila de atendimento | fila de processamento |
|---|---|---|
| o que é | onde a conversa espera por quem atende | onde a mensagem crua espera para ser processada |
| resolve | ninguém ficar sem resposta | mensagem não se perder num pico |
| onde está | este plano, Onda 3 | `pendencias.md` item 1, Onda 6 |

A **fila de atendimento não acrescenta vazão**. Botar conversa em fila
não faz o sistema responder mais rápido.

O que ela faz, e que é exatamente o seu problema:

**1. Transforma perda silenciosa em espera visível.** Hoje uma conversa
que vai para `pending` sem dono é indistinguível de uma que ninguém
percebeu. Com fila e hora de entrada, "7 conversas esperando há mais de
20 minutos no Financeiro" vira um número que alguém pode ver — e do qual
dá para disparar alerta.

**2. Dá um lugar natural para o teto de concorrência da IA.** Este é o
ponto forte, e nasce da sua ideia da fila atendida pelo agente.

Hoje, 3.000 mensagens viram 3.000 chamadas simultâneas na chave do
cliente. O provedor recusa a maioria, **cada recusa é um cliente sem
resposta**, e nada disso aparece em lugar nenhum (`pendencias.md`,
item 2).

Com uma fila atendida pela IA, o teto tem casa: a fila drena N por vez.
O excedente vira **espera visível** em vez de **falha invisível**. É a
mesma quantidade de trabalho, com a diferença de que você enxerga a
fila crescendo e pode agir — mandar para humano, avisar o cliente,
aumentar o teto.

Sem a fila, o teto de concorrência precisaria de uma estrutura própria.
Com ela, é uma consulta.

---

## O desenho de fila

Sua ideia muda o modelo para melhor: **toda conversa está sempre em
exatamente uma fila**, e a fila diz quem atende — o robô ou um time.

```sql
create table public.queues (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references accounts(id) on delete cascade,
  name                text not null,
  -- O que o MODELO lê para escolher. Escreva com as palavras do cliente.
  description         text,

  -- Quem atende. É isto que unifica o desenho: o robô é uma fila como
  -- qualquer outra, e o handoff deixa de ser um estado especial para
  -- virar "mudou de fila".
  attended_by         text not null default 'humans'
                      check (attended_by in ('ai','humans')),

  -- Quem RESPONDE pela fila: um, e um usuário pode responder por várias.
  responsible_user_id uuid references auth.users(id) on delete set null,
  auto_assign         boolean not null default true,

  -- Teto de conversas sendo atendidas ao mesmo tempo. Só faz sentido
  -- na fila da IA hoje; é onde o controle de sobrecarga mora.
  concurrency_limit   integer,

  is_default          boolean not null default false,
  position            integer not null default 0,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index queues_account_name on public.queues (account_id, lower(name));
create unique index queues_one_default   on public.queues (account_id) where is_default;
```

Toda conta nasce com **uma fila padrão `attended_by = 'ai'`** —
"Atendimento automático". As conversas entram nela. Um handoff move para
uma fila humana. Se a conta não tem fila humana nenhuma, move para a
fila padrão de espera, que é o comportamento de hoje com um nome.

```sql
alter table public.conversations
  add column queue_id uuid references public.queues(id) on delete set null;

create index idx_conversations_account_queue
  on public.conversations (account_id, queue_id, status);
```

### O histórico: por onde passou e quanto tempo ficou

**Não é uma tabela de eventos.** Já existem `platform_events` e
`flow_run_events` com significados diferentes, e um terceiro `*_events`
seria confusão garantida — foi o seu alerta, e ele estava certo.

É um registro de **estadas**: uma linha por passagem, aberta na entrada
e fechada na saída.

```sql
create table public.conversation_queue_stays (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  queue_id      uuid not null references queues(id) on delete cascade,
  entered_at    timestamptz not null default now(),
  left_at       timestamptz,
  -- Quem estava com ela nesta passagem, se alguém.
  assigned_user_id uuid references auth.users(id) on delete set null,
  -- Por que saiu: 'handoff', 'resolved', 'reopened', 'manual', 'closed'.
  exit_reason   text
);

-- Uma conversa só pode ter UMA estada aberta.
create unique index conversation_queue_stays_open
  on public.conversation_queue_stays (conversation_id) where left_at is null;

create index idx_stays_queue_open
  on public.conversation_queue_stays (queue_id, entered_at) where left_at is null;
```

Modelar como estada, e não como evento, faz o tempo virar subtração
(`left_at - entered_at`) em vez de uma agregação sobre pares de eventos.
E o índice parcial de "estada aberta" é o que responde barato à pergunta
que interessa: **o que está esperando agora, e há quanto tempo.**

> **Decida antes de subir:** isto só responde sobre o que foi gravado a
> partir do dia em que existir. Não há como recuperar o passado. Se
> "quantas passaram pelo Financeiro em julho" for pergunta de negócio,
> a tabela precisa nascer junto com a fila — não depois.

---

# As ondas

## Onda 0 — CONCLUÍDA (12/08/2026)

| # | item | onde | estado |
|---|---|---|---|
| 0.1 | Rótulo "Rodízio" → "Qualquer pessoa da equipe" | `pt-BR/en/ko.json`, `automations/engine.ts` | ✅ |
| 0.2 | Deep link `?conversation=` → `?c=` | 5 geradores + a tela aceita as duas | ✅ |
| 0.3 | `requireRole('admin')` no PATCH/DELETE de templates | `templates/[id]/route.ts` | ✅ |
| 0.4 | Allowlist de `Content-Type` no proxy de mídia | `media/[mediaId]/route.ts` | ✅ |
| 0.5 | Timeout em toda chamada à Graph API | `meta-api.ts` (17), `embedded-signup.ts` (4) | ✅ |
| 0.6 | Índices do caminho quente + busca por sufixo indexado | `064_hot_path_indexes.sql`, `contacts/dedupe.ts` | ✅ aplicada |

Detalhes de cada uma nas seções correspondentes de
[`auditoria-seguranca.md`](./auditoria-seguranca.md),
[`carga-3000-mensagens.md`](./carga-3000-mensagens.md) e
[`atribuicao-fila-e-tags.md`](./atribuicao-fila-e-tags.md).

Verificação: `tsc --noEmit` limpo e **913 testes passando** (dois novos,
sobre a busca de contato). A 064 foi validada em transação com
`ROLLBACK` antes de ser aplicada, e o plano de consulta foi conferido —
o índice novo é usado (`Index Scan using idx_contacts_account_phone_suffix`).

## Onda 1 — CONCLUÍDA (12/08/2026)

| # | item | onde |
|---|---|---|
| 1.1 | Destinatários do disparo paginados **e** o público "todos os contatos" junto | `use-broadcast-sending.ts` |
| 1.2 | Thread carrega as 100 mais recentes + "Carregar mensagens anteriores" | `message-thread.tsx` |
| 1.3 | Retenção em `platform_events`, em dois tempos | `observability/retention.ts` |

**1.1 rendeu mais do que o previsto.** O teto de 1.000 do PostgREST não
cortava só a leitura dos destinatários — cortava também a montagem do
público quando a audiência é "todos os contatos", e esse corte acontecia
**antes** de as linhas serem gravadas, então nem a contagem no banco
denunciava. Os dois foram paginados, e o envio agora aborta se o número
de destinatários carregados não bater com o de inseridos.

**1.2:** a thread pede em ordem decrescente com limite e inverte no
cliente. Resolve o corte e, de carona, para de transferir a conversa
inteira a cada clique. O "carregar anteriores" se ancora no `created_at`
da mensagem mais antiga já carregada, e não num deslocamento — com
deslocamento, uma mensagem nova entre dois cliques faz repetir ou pular
linha.

**1.3:** política em dois tempos, e não uma só. O `screenshot` sai aos
**7 dias**, o evento aos **90**. O print é o que pesa e o que é dado de
terceiro (é a caixa de entrada de um cliente da ótica); o evento em si é
pequeno e é o que faz o histórico valer. Pega carona na ronda de saúde,
que já roda de hora em hora, em vez de virar mais um agendador para
alguém esquecer de configurar.

## Onda 2 — CONCLUÍDA (12/08/2026)

| # | item | decisão tomada |
|---|---|---|
| 2.1 | **Responder assume a conversa** | sim, **e o botão "Assumir" continua** |
| 2.2 | Handoff de fluxo desliga a IA | feito, mais a nota na tarja |
| 2.3 | Áudio respeita o agente desligado | sim — desliga tudo, inclusive a transcrição |
| 2.4 | Filtro "Minhas" no inbox | feito |

**2.1** é um `UPDATE` separado com `.is('assigned_agent_id', null)` — um
compare-and-set. Quem já tem dono não é roubado, e não há
leitura-antes-de-escrita para duas abas correrem entre si. É a mesma
regra do handoff, que nunca toma conversa de humano. O botão "Assumir"
continua sendo como se pega uma conversa **sem responder**, e o único
jeito de tomar uma que já é de outra pessoa.

**2.2** também passou a gravar a nota do nó em `ai_handoff_summary`:
antes ela só ia para o log do fluxo, onde a atendente não olha, e a
tarja do inbox aparecia sem motivo nenhum.

**2.3** desliga **tudo**, inclusive a transcrição. É a leitura direta do
interruptor, e a que não gasta a chave da ElevenLabs de quem acha que
parou o sistema. Quem quiser transcrição sem resposta automática tem o
caminho certo: agente ligado, resposta automática desligada.

## Onda 3 — as filas (fundação PRONTA, telas pendentes)

| # | entrega | estado |
|---|---|---|
| 3.1 | `queues`, `queue_members`, `conversation_queue_stays`, `conversations.queue_id` | ✅ migração 065, aplicada |
| 3.2 | Fila padrão `attended_by='ai'` por conta + backfill | ✅ 065 |
| 3.5 | Registro das passagens em todo caminho | ✅ migração 066, aplicada |
| 3.3 | Tela **Configurações → Filas** | ⬜ pendente |
| 3.4 | Filtro de fila no inbox + a fila no item da lista | ⬜ pendente |

### O 3.5 mudou de lugar: saiu do TypeScript e foi para o banco

A ideia original era um helper que todo caminho chamaria. Ela não
sobrevive ao primeiro olhar em quem escreve `conversations`: **o
navegador escreve direto na tabela** — o dropdown de atribuição e o
seletor de status do inbox fazem `UPDATE` autorizados só pela RLS.
Somando automações, fluxos, webhook e API pública, o helper dependeria
de todo caminho lembrar de chamá-lo, para sempre, inclusive os que ainda
não existem.

O primeiro esquecido abre um buraco **permanente** no relatório, e um
buraco que só aparece meses depois. Um gatilho não tem como ser
esquecido.

O preço, registrado honestamente: o **motivo** da saída passa a ser
derivado da transição (`closed`, `reopened`, `handoff` quando a IA é
desligada na mesma escrita, `manual` no resto) em vez de informado por
quem move. Motivo aproximado com histórico completo vale mais que motivo
preciso com falhas.

Foram precisos **três** gatilhos, e o banco é que obrigou: `queue_id` só
pode ser escrito antes da linha existir (`BEFORE`), e a estada só pode
ser criada depois (`AFTER`), porque tem chave estrangeira para
`conversations`. As duas coisas juntas num `BEFORE INSERT` falham com
violação de FK — o teste em transação pegou isso antes de a migração ser
aplicada.

### O que já vale hoje, sem nenhuma tela

Toda conversa nova cai sozinha em "Atendimento automático" e abre uma
estada. Fechar a conversa fecha a passagem; reabrir abre outra. **O
histórico começou a ser gravado** — que é o único item desta onda que
não podia esperar, porque passado não gravado não volta.

## Onda 4 — o agente operando as filas

| # | entrega | cuidado |
|---|---|---|
| 4.1 | `route_to_queue`, como handoff **com destino**, reusando `handOffConversation` | filas no schema como enum, para o modelo não inventar |
| 4.2 | `add_tag` + `tags.ai_selectable` (padrão `false`) | injeção de prompt: o cliente controla o texto, e tag dispara automação |
| 4.3 | As duas no liga/desliga de **Agentes → Ferramentas** | cada ferramenta paga o próprio schema em toda resposta |

## Onda 5 — sobrecarga de verdade

Aqui mora o cliente das 3.000 mensagens. É a onda cara e a de maior
risco: é o caminho por onde toda mensagem entra, e a falha é silenciosa.

| # | entrega |
|---|---|
| 5.1 | **Persistir antes de confirmar**, idempotência `(phone_number_id, wamid)` — `pendencias.md` item 1 |
| 5.2 | **Teto de concorrência da IA ancorado na fila da IA** (`concurrency_limit`) |
| 5.3 | Retentativa com backoff lendo `Retry-After`; reconhecer o 130429 da Meta |
| 5.4 | Disparo no servidor, em lotes retomáveis |
| 5.5 | Aplicar `monthly_budget_usd`, que hoje é só exibido |

5.2 fica quase de graça depois de 3.1 — é o argumento a favor de fazer
as filas antes.

## Onda 6 — o que só faz sentido depois

| # | entrega | quando |
|---|---|---|
| 6.1 | Alerta de SLA: "esperando há mais de X na fila Y" | quando houver fila com espera real |
| 6.2 | **Rodízio de verdade** | quando um cliente tiver 3+ pessoas na mesma fila |
| 6.3 | Transbordo entre filas | depende de 6.1 |
| 6.4 | Tela de tutoriais | `tela-de-tutoriais.md` |

### 6.2 — quando chegar a hora, o difícil é a corrida

Duas mensagens entram no mesmo instante, ambas leem "o último foi a
Ana", ambas escolhem o Bruno. O rodízio some no primeiro pico.

A correção não é trava na aplicação: é fazer **o avanço do cursor ser a
trava**, numa instrução só.

```sql
update public.queues set rr_cursor = rr_cursor + 1
 where id = p_queue_id returning rr_cursor into v_n;
```

O `UPDATE` trava a linha; o segundo chamador espera ali. Sai de graça,
porque o cursor já precisava avançar. A ordem dos membros precisa ser
determinística (`position, user_id`), senão a sequência muda a cada
consulta e deixa de ser rodízio.

Duas regras que decidem se funciona na prática:

- **Quem está offline é pulado**, e se ninguém está online a conversa
  **não é atribuída** — fica na fila, visível. Atribuir para quem foi
  embora esconde o problema.
- Existe o irmão `least_busy` (menos conversas abertas), que parece mais
  justo e tem incentivo perverso: quem fecha rápido recebe mais, quem
  deixa aberto para de receber. **Rodízio simples é o padrão certo.**

A função nasce com `REVOKE`/`GRANT` explícito — lição da 063, onde um
`GRANT ALL` reabriu o que sete migrações tinham fechado.

---

## Fora do escopo, registrado

- **Rodízio ponderado** (o sênior recebe mais que o estagiário): uma
  coluna `weight` em `queue_members`, barata de acrescentar depois.
- **Fila com vários responsáveis**: `queue_members` já é a junção; falta
  só a interface.
- **Métrica de tempo médio por fila**: sai de `conversation_queue_stays`
  com uma consulta, mas precisa de tela.

---

## O que ainda depende de você

1. **Quais filas no primeiro cliente.** Sugestões por segmento no
   apêndice abaixo.
2. **2.1 — responder assume a conversa?** É a mudança de comportamento
   mais sensível da Onda 2.
3. **O histórico de estadas entra junto com as filas?** Recomendo sim,
   pelo motivo do quadro acima: passado não gravado não volta.

---

## Apêndice — filas sugeridas

Comece com **três ou quatro humanas**, além da fila da IA que toda conta
tem. Fila vazia confunde o modelo e custa token em toda resposta.

A descrição é o que o agente lê: escreva com as **palavras que o cliente
usa**, não com o nome interno do departamento.

### Ótica

| fila | descrição para o agente |
|---|---|
| Atendimento automático (IA) | *padrão, toda conta tem* |
| Vendas e orçamento | Preço de armação e lente, orçamento, promoção, o que tem na loja |
| Financeiro | Boleto, segunda via, pagamento, parcelamento, nota fiscal |
| Convênio | Plano de saúde, autorização, reembolso, quais convênios são aceitos |
| Assistência | Óculos quebrado, ajuste, troca de lente, garantia, conserto |

Agendamento **não vira fila**: já é ferramenta, o agente marca sozinho.
Só cai em fila quando a ferramenta falha.

### Bicicletas elétricas

| fila | descrição para o agente |
|---|---|
| Vendas | Modelos, preço, autonomia, test-ride, financiamento |
| Oficina | Revisão, defeito, bateria não carrega, freio, orçamento de conserto |
| Garantia | Defeito dentro da garantia, troca, peça que quebrou sozinha |
| Peças e acessórios | Capacete, bagageiro, câmara, peça avulsa, disponibilidade |

Separar Oficina de Garantia parece pedantismo e não é: muda quem paga, e
a conversa começa diferente.

### Energia solar

| fila | descrição para o agente |
|---|---|
| Novo projeto | Quer instalar, simulação, quanto economiza, conta de luz |
| Visita técnica | Agendar ou remarcar a avaliação do telhado, endereço, acesso |
| Homologação | Documentação, prazo da concessionária, parecer de acesso, medidor |
| Pós-venda | Gerando menos, inversor com erro, monitoramento, limpeza |

Homologação é a que surpreende quem não é do ramo: o processo com a
concessionária arrasta semanas e gera muito "e aí, saiu?". Sem fila
própria, entope Vendas.

### O critério para qualquer fila nova

**Qualquer pessoa da equipe consegue terminar sozinha essa conversa?**
Se sim, a fila pode ser repartida. Se não, ela tem um responsável.

É por isso que Financeiro tende a ter dono e Vendas tende a ser
repartida: quem responde por cobrança precisa de acesso ao sistema,
histórico e autoridade para negociar.
