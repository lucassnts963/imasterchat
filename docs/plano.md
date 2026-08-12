# Plano de trabalho

Duas frentes: fechar o que a auditoria e o estudo de carga acharam, e
construir **filas de verdade** com o agente sabendo encaminhar.

Ordenado por retorno. Cada item diz o que muda, onde, e o que pode dar
errado.

---

# Parte A — o que já está decidido

Detalhes em [`auditoria-seguranca.md`](./auditoria-seguranca.md) e
[`carga-3000-mensagens.md`](./carga-3000-mensagens.md).

| # | item | tipo | risco |
|---|---|---|---|
| A1 | **Paginar os destinatários do disparo** | código | baixo |
| A2 | Papel exigido no `PATCH`/`DELETE` de templates | código | baixo |
| A3 | Allowlist de `Content-Type` no proxy de mídia | código | baixo |
| A4 | Quatro índices + `phone_normalized` no webhook | migração | baixo |
| A5 | Timeout em todo `fetch` para a Graph API | código | baixo |

**A1 é o mais urgente.** Enquanto ele não sair, um disparo para 3.000
contatos envia para 1.000 e a barra marca 100%. Nenhuma conversa sobre
volume faz sentido antes disso.

A2 e A3 exigem rebuild e deploy. A4 é uma migração isolada.

---

# Parte B — filas de verdade

## O que existe hoje

Nada. A "fila" é uma convenção: `status = 'pending'` com
`assigned_agent_id IS NULL`. Não há tabela de fila, de time ou de
departamento — o levantamento está em
[`atribuicao-fila-e-tags.md`](./atribuicao-fila-e-tags.md).

O agente não tem como encaminhar: o catálogo dele é `request_human` mais
as quatro de agendamento, e `request_human` manda sempre para o mesmo
`handoff_agent_id` da conta. Não existe "manda para o financeiro".

## O desenho

### B1. A tabela `queues`

```sql
create table public.queues (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references accounts(id) on delete cascade,
  name                text not null,
  -- A descrição NÃO é enfeite: é o que o modelo lê para escolher a fila.
  -- "Financeiro — cobrança, boleto, segunda via, renegociação."
  description         text,
  -- Quem RESPONDE pela fila. Um só, e um usuário pode responder por
  -- várias — a cardinalidade usuário → filas sai de graça de a coluna
  -- ser simples. É accountability, não distribuição (ver `distribution`).
  responsible_user_id uuid references auth.users(id) on delete set null,
  auto_assign         boolean not null default true,
  -- Como escolher a pessoa quando a conversa entra na fila.
  distribution        text not null default 'responsible'
                      check (distribution in ('responsible','round_robin','least_busy','none')),
  -- Cursor do rodízio. Vive na linha da fila de propósito: é a trava
  -- que serializa dois encaminhamentos simultâneos (ver B7).
  rr_cursor           bigint not null default 0,
  -- Pular quem está offline. Atribuir para quem foi embora é pior que
  -- não atribuir: o cliente espera até amanhã sem ninguém saber.
  skip_offline        boolean not null default true,
  position            integer not null default 0,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index queues_account_name on public.queues (account_id, lower(name));

-- Quem RECEBE da fila. Separado do responsável porque as duas perguntas
-- são diferentes: "quem responde por isto" tem uma resposta, "entre
-- quem eu reparto" tem várias.
create table public.queue_members (
  queue_id  uuid not null references public.queues(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  position  integer not null default 0,
  active    boolean not null default true,
  primary key (queue_id, user_id)
);
```

`responsible_user_id` é anulável de propósito: uma fila sem dono é a
sala de espera compartilhada, que é o caso mais comum no começo.

Com `queue_members` vazio e `distribution = 'responsible'`, o
comportamento é exatamente o que você descreveu no começo: a fila tem um
dono e tudo cai nele. As outras modalidades só entram em jogo quando
você põe gente na fila.

E `conversations` ganha um ponteiro:

```sql
alter table public.conversations
  add column queue_id uuid references public.queues(id) on delete set null;

create index idx_conversations_account_queue
  on public.conversations (account_id, queue_id, status);
```

**RLS**, seguindo o padrão que já existe para `tags`: ler é de qualquer
membro; criar, editar e apagar exige `admin`. Encaminhar uma conversa
para uma fila exige `agent` — mesma separação de hoje entre "criar tag"
e "aplicar tag".

### B2. A decisão que muda tudo: `auto_assign`

Quando o agente encaminha para uma fila, duas coisas podem acontecer:

| `auto_assign` | o que acontece | quando usar |
|---|---|---|
| **`true`** (padrão) | a conversa é atribuída ao responsável da fila | a fila é uma pessoa: "Financeiro = Ana" |
| `false` | só `queue_id` é gravado; a conversa fica sem dono, em `pending` | a fila é uma sala de espera que vários atendem |

Isso importa por causa do portão em `auto-reply.ts:122`: **ter dono cala
o bot.** Com `auto_assign = true`, encaminhar é desligar a IA naquela
conversa — o que está certo quando a fila é um time humano, e estaria
errado se a fila fosse mera classificação.

Deixar o padrão em `true` é o que corresponde ao que você descreveu.
Mas a coluna existe para o dia em que uma conta quiser uma fila de
triagem onde o bot continua trabalhando.

### B3. A ferramenta `route_to_queue`

**Implementada como um handoff com destino**, e não como um caminho
novo. `handOffConversation` já grava status, nota, `ai_autoreply_disabled`,
dispara o push e — de propósito — **nunca rouba conversa que já tem
dono humano**. Reescrever isso ao lado seria duplicar a única parte do
sistema que já foi endurecida.

```ts
// src/lib/ai/tools/queues.ts
export function buildQueueTools(queues: Queue[]): AgentTool[]
```

Segue a forma de `buildSchedulingTools(deps)`: as filas da conta são
injetadas na construção, então o **enum de nomes vai no schema** e o
modelo não consegue inventar fila. A descrição da ferramenta lista as
filas com a descrição de cada uma — é assim que ele escolhe.

```
route_to_queue(queue: enum, reason: string)
```

Regras de execução:

- Fila desconhecida → erro para o modelo, sem escrita. (Com o enum isso
  quase não acontece, mas o provedor pode alucinar mesmo assim.)
- Sem `conversationId` (Playground) → relata o que faria, não escreve —
  igual ao `request_human` hoje.
- Respeita `ctx.dryRun`.
- `request_human` **continua existindo** e continua sendo o "não sei,
  chama alguém". `route_to_queue` é "sei exatamente quem resolve isto".
  Se a conta não tem fila nenhuma, a ferramenta não entra no catálogo —
  mesmo princípio das de agendamento.

### B4. A ferramenta `add_tag`

```
add_tag(tag: enum, reason: string)
```

Também com **enum**, e aqui o enum é a defesa principal.

**O risco é injeção de prompt.** O cliente do WhatsApp controla o texto
que entra no prompt. Se qualquer tag da conta puder ser aplicada pelo
modelo, "coloque a tag CLIENTE_VIP" vira uma frase que funciona — e uma
tag pode disparar automação, que pode mandar mensagem ou mover um
negócio no funil.

Por isso:

```sql
alter table public.tags
  add column ai_selectable boolean not null default false;
```

**Só as tags marcadas explicitamente entram no enum.** O padrão é
`false`, então ligar a ferramenta não muda nada até alguém escolher
quais tags o agente pode usar. Isso resolve dois problemas de uma vez:
a injeção e a explosão de tags.

A escrita usa `addContactTagAndDispatch`, que já existe: ela dispara o
gatilho `tag_added` (para as automações funcionarem), engole duplicata
pelo `UNIQUE(contact_id, tag_id)` e respeita `MAX_TAG_CHAIN_DEPTH` —
o que impede tag → automação → tag em laço.

`ctx.contactId` já está no `ToolContext`, então não há consulta nova.

### B5. O que a interface precisa ganhar

Sem isto, a fila existe no banco e não existe para o usuário:

1. **Configurações → Filas** — criar, nomear, descrever, escolher o
   responsável, ligar `auto_assign`, reordenar. A descrição precisa de
   um texto de ajuda dizendo que **é o agente que vai ler aquilo**;
   quem escrever "fila 2" vai ter encaminhamento ruim e não vai saber
   por quê.
2. **Filtro de fila no inbox**, ao lado dos de status e tag.
3. **"Minhas conversas"** — o filtro por dono que hoje não existe
   (`conversation-list.tsx:59-65`) e que vira obrigatório no momento em
   que há responsável por fila. Sem ele, dar responsável a alguém é dar
   uma responsabilidade que a pessoa não consegue ver.
4. **A fila no item da lista**, junto do status.
5. **Agentes → Ferramentas**: as duas novas entram no liga/desliga que
   já existe (`ai_disabled_tools`).
6. **Agentes → Regras** ou a tela de tags: a marcação `ai_selectable`.

### B7. O rodízio, de verdade

Hoje o modo `round_robin` do passo `assign_conversation` faz
`SELECT user_id FROM profiles WHERE account_id = X LIMIT 1` — sem
`ORDER BY` e sem estado (`automations/engine.ts:487-497`). Não é rodízio:
é "qualquer um", e na prática quase sempre o mesmo.

Fazer de verdade tem três problemas, e o segundo é o que costuma ser
esquecido.

#### 1. Quem entra na roda

`queue_members` com `active = true`, ordenados por `(position, user_id)`
— ordem **determinística**, senão o rodízio muda de sequência a cada
consulta e deixa de ser rodízio.

Sem membros ativos, cai para `responsible_user_id`. Sem responsável,
fica sem dono na fila — visível e esperando, que é honesto.

#### 2. Dois encaminhamentos ao mesmo tempo pegam a mesma pessoa

Duas mensagens entram no mesmo instante para a mesma fila. Ambas leem
"o último foi a Ana", ambas escolhem o Bruno. O rodízio some no primeiro
pico — que é justamente quando ele importa.

A correção não é bloqueio na aplicação: é fazer o avanço do cursor ser
**a própria trava**, numa instrução só.

```sql
create or replace function public.next_queue_assignee(p_queue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n      bigint;
  v_user   uuid;
begin
  -- O UPDATE trava a LINHA da fila. Um segundo chamador espera aqui até
  -- o primeiro commitar, então nunca leem o mesmo cursor. É isto que
  -- torna o rodízio correto sob concorrência — e é de graça, porque o
  -- avanço do cursor já precisava acontecer.
  update public.queues
     set rr_cursor = rr_cursor + 1
   where id = p_queue_id
  returning rr_cursor into v_n;

  if v_n is null then return null; end if;

  select qm.user_id into v_user
    from public.queue_members qm
   where qm.queue_id = p_queue_id
     and qm.active
   order by qm.position, qm.user_id
   offset (v_n - 1) % greatest((select count(*) from public.queue_members
                                 where queue_id = p_queue_id and active), 1)
   limit 1;

  return v_user;
end $$;

revoke execute on function public.next_queue_assignee(uuid) from public, anon, authenticated;
grant  execute on function public.next_queue_assignee(uuid) to service_role;
```

O `REVOKE`/`GRANT` explícito não é zelo excessivo: é exatamente a lição
da migração 063 — função `SECURITY DEFINER` nova nasce fechada, senão o
próximo `GRANT ALL` a reabre e ninguém percebe.

> Entrar e sair gente da fila desloca a sequência, porque o cursor é uma
> posição e não um ponteiro para pessoa. É aceitável: o efeito é uma
> volta ligeiramente desigual, uma vez, quando a equipe muda.

#### 3. Rodízio justo em contagem não é justo em trabalho

Cinco conversas para cada um parece justo até uma delas ser uma
negociação de quarenta mensagens e a outra ser "obrigado". Depois de
algumas horas, alguém está enterrado.

Daí a modalidade irmã, `least_busy`: escolhe quem tem **menos conversas
abertas atribuídas**.

```sql
select p.user_id
  from queue_members qm
  join profiles p on p.user_id = qm.user_id
  left join conversations c
         on c.assigned_agent_id = qm.user_id
        and c.status in ('open','pending')
 where qm.queue_id = $1 and qm.active
 group by p.user_id
 order by count(c.id) asc, p.user_id
 limit 1;
```

Precisa do índice `conversations(assigned_agent_id, status)`, que não
existe hoje — entra junto com os de A4.

**Qual usar como padrão?** `round_robin`. O `least_busy` tem um incentivo
perverso que só aparece semanas depois: quem fecha conversa rápido
recebe mais trabalho, e quem deixa tudo aberto para de receber. O
rodízio não tem esse problema, e é o que a pessoa consegue prever — o
que importa quando ela precisa confiar na distribuição.

Deixe `least_busy` disponível para quem tiver conversas de duração muito
desigual.

#### 4. Quem está offline

Presença é confiável aqui: batida a cada 30 s e offline após 75 s
(`lib/presence.ts:16,23`). Com `skip_offline = true`, o candidato é
pulado e o rodízio anda.

Uma regra importa mais que as outras: **se ninguém da fila está online,
a conversa NÃO é atribuída** — ela fica na fila, sem dono, visível como
esperando. Atribuir para quem foi embora esconde o problema; deixar na
fila mostra que falta gente.

Isso significa que o cursor pode avançar sem atribuir a ninguém.
Aceitável, e melhor que a alternativa.

#### 5. O que fazer com o passo de automação que já existe

O modo `round_robin` do `assign_conversation` passa a aceitar um
`queue_id` e a chamar `next_queue_assignee`. Sem `queue_id`, ele deixa de
mentir: ou vira "responsável da fila padrão da conta", ou some da
interface. **Manter o rótulo "Rodízio" sobre o `LIMIT 1` atual não é
opção depois desta implementação.**

> E há um defeito ali que precisa sair junto: o passo atualiza **todas**
> as conversas daquele contato (`.eq('contact_id', …)` sem filtrar a
> conversa), não só a que disparou. Com fila e responsável, isso deixa de
> ser detalhe e vira conversa trocando de dono sem motivo.

### B6. O que isto custa em token

Cada ferramenta paga o próprio schema em **toda** requisição, e a tela
de Contexto já mostra que o catálogo é uma fatia grande do prompt. Com
dez filas de descrição longa, `route_to_queue` fica caro.

Duas defesas: limitar a descrição por fila (~120 caracteres, validado no
formulário) e não montar a ferramenta quando a conta tem zero filas
ativas.

Depois de implementar, a própria tela **Agentes → Contexto** mostra o
antes e o depois — é para isso que ela existe.

---

## Ordem de trabalho

| passo | entrega | depende de |
|---|---|---|
| 1 | Migração `064_queues.sql` + `065_tags_ai_selectable.sql` | — |
| 2 | Tela de Filas em Configurações (CRUD + responsável) | 1 |
| 3 | Filtro de fila e **"minhas conversas"** no inbox | 1 |
| 4 | `route_to_queue`, reusando `handOffConversation` | 1, 2 |
| 5 | `add_tag` com `ai_selectable` | 1 |
| 6 | Marcação de `ai_selectable` na tela de tags | 5 |

Os passos 2 e 3 vêm **antes** das ferramentas de propósito: uma fila que
o agente preenche e que ninguém consegue ver é pior que não ter fila.
Dá para operar com 1–3 e sem 4–5, atribuindo à mão; o contrário não.

---

## O que este plano NÃO resolve

- **SLA / tempo de espera na fila.** Não há relógio, não há alerta de
  conversa parada há duas horas. É o pedido seguinte mais provável
  depois que as filas existirem — e o desenho já deixa o caminho pronto,
  porque `queue_id` + `status` + `updated_at` é tudo de que uma ronda de
  SLA precisaria.
- **Transbordo entre filas.** "Ninguém no Financeiro há 30 min → manda
  para o Geral" não existe. Depende do relógio acima.
- **Histórico de quem passou pela fila.** `queue_id` guarda onde a
  conversa **está**, não por onde andou. Se um dia a pergunta for
  "quantas passaram pelo Financeiro este mês", precisa de uma tabela de
  eventos — não dá para responder depois sobre o passado que não foi
  gravado. Vale decidir isso ANTES de rodar em produção, porque é o tipo
  de dado que não se recupera.
- **Rodízio ponderado.** Todo mundo na roda recebe igual. Um estagiário
  recebe tanto quanto o sênior. Se precisar, o caminho é um `weight` em
  `queue_members` — barato de acrescentar depois.

---

## Apêndice — filas sugeridas por segmento

Sugestões, não receita. A regra que vale para os três: **comece com três
ou quatro.** Fila vazia confunde o modelo (ele tem que escolher entre
opções que nunca são usadas) e custa token em toda resposta. É fácil
acrescentar depois; é constrangedor tirar depois de treinar a equipe.

A descrição é o que o agente lê — escreva com as **palavras que o
cliente usa**, não com o nome interno do departamento.

### Ótica (o cliente de hoje)

| fila | descrição para o agente | distribuição |
|---|---|---|
| **Vendas e orçamento** | Preço de armação e lente, orçamento, promoção, o que está disponível na loja | rodízio |
| **Financeiro** | Boleto, segunda via, pagamento, parcelamento, nota fiscal | responsável |
| **Convênio** | Plano de saúde, autorização, reembolso, quais convênios são aceitos | responsável |
| **Assistência** | Óculos quebrado, ajuste, troca de lente, garantia, conserto | rodízio |

Agendamento **não vira fila**: já é ferramenta do agente, e ele marca
sozinho. Só cai em fila quando a ferramenta falha — e aí é `request_human`.

### Loja de bicicletas elétricas

| fila | descrição para o agente | distribuição |
|---|---|---|
| **Vendas** | Modelos, preço, autonomia, test-ride, financiamento | rodízio |
| **Oficina** | Revisão, defeito, bateria não carrega, freio, orçamento de conserto | rodízio |
| **Garantia** | Produto com defeito dentro da garantia, troca, peça que quebrou sozinha | responsável |
| **Peças e acessórios** | Capacete, bagageiro, câmara, peça avulsa, disponibilidade | responsável |

Separar **Oficina** de **Garantia** parece pedantismo e não é: quem paga
o conserto muda, e a conversa começa diferente.

### Energia solar fotovoltaica

| fila | descrição para o agente | distribuição |
|---|---|---|
| **Novo projeto** | Quer instalar, quer simulação, quanto economiza, quanto custa, conta de luz | rodízio |
| **Visita técnica** | Agendar ou remarcar a visita de avaliação do telhado, endereço, acesso | responsável |
| **Homologação** | Documentação, prazo da concessionária, parecer de acesso, troca de medidor | responsável |
| **Pós-venda** | Sistema gerando menos, inversor com erro, monitoramento, limpeza | rodízio |

**Homologação** é a que mais surpreende quem não é do ramo: o processo
com a concessionária arrasta semanas e gera muita mensagem de "e aí,
saiu?". Sem fila própria, isso entope Vendas.

### Um padrão que vale para os três

Repare que **Financeiro é sempre `responsible`** e **Vendas é sempre
rodízio**. Não é coincidência:

- Vendas se reparte porque qualquer vendedor atende qualquer cliente, e
  repartir é literalmente o objetivo.
- Financeiro concentra porque quem responde precisa de acesso ao sistema
  de cobrança, contexto do histórico e autoridade para negociar. Repartir
  ali cria conversa que a pessoa não consegue terminar.

Quando estiver em dúvida sobre uma fila nova, a pergunta é essa:
**qualquer pessoa da equipe consegue terminar sozinha essa conversa?**
Se sim, rodízio. Se não, responsável.

## Uma decisão sua, antes do passo 4

Quando o agente encaminha para uma fila cujo responsável está definido, a
conversa é atribuída àquela pessoa e **o bot para de responder**.

Isso é o certo quando a fila é um time humano ("Financeiro"). Mas se
você quiser uma fila de *triagem* — onde o agente classifica e continua
atendendo — ela precisa nascer com `auto_assign = false`.

Vale decidir quais filas você quer no primeiro cliente antes de eu
escrever a tela, porque isso muda o texto de ajuda do formulário.
