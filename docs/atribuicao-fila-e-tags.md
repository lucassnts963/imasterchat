# Como uma conversa chega a uma pessoa

Quem atribui, quando, para quem — e o que o sistema **não** faz.

Levantado lendo o código, com citação em cada afirmação. Onde algo não
existe, a ausência está citada também: é mais fácil confiar em "não
existe" quando se vê onde se procurou.

---

## A resposta curta

**Não existe fila. Não existe distribuição automática. Uma conversa
chega sem dono e fica sem dono até alguém clicar.**

A "fila" do produto é uma convenção, não uma estrutura: uma conversa em
`status = 'pending'` com `assigned_agent_id IS NULL` é o que na prática
significa "esperando alguém pegar". Não há tabela de fila, de time, de
departamento ou de habilidade em nenhuma das 62 migrações — a palavra
`queue` só aparece em comentário, descrevendo justamente essa convenção
(`033_ai_reply_polish.sql:15`).

E o agente de IA **não distribui**: ele não tem ferramenta para atribuir
conversa, pôr tag, mudar status ou criar negócio. O catálogo dele é
`request_human` mais, no máximo, as quatro de agendamento
(`src/lib/ai/tools/registry.ts:137,143`).

---

## Os seis caminhos que escrevem um dono

`assigned_agent_id` na tabela `conversations` é o campo do dono. Exatamente
seis lugares o escrevem:

| # | quem | onde | o que faz |
|---|---|---|---|
| 1 | atendente, dropdown "Atribuir" | `inbox/message-thread.tsx:835` | escolhe qualquer membro |
| 2 | atendente, botão "Assumir" | `api/ai/autoreply/[id]/route.ts:68` | põe a si mesmo e cala o bot |
| 3 | handoff do agente | `conversations/handoff.ts:117` | só se ninguém for dono ainda |
| 4 | passo `assign_conversation` de automação | `automations/engine.ts:501` | ver a ressalva abaixo |
| 5 | nó de handoff de fluxo | `flows/engine.ts:445` | campo não editável na tela |
| 6 | reabertura de conversa fechada | `conversations/reopen.ts:64` | **zera** o dono |

Na chegada, nada acontece: o webhook cria a conversa com `account_id`,
`user_id` e `contact_id`, e mais nada — `assigned_agent_id` nasce nulo
(`api/whatsapp/webhook/route.ts:1227`).

### A atribuição manual não passa por rota de API

O dropdown do inbox faz `UPDATE` direto do navegador na tabela. Quem
autoriza é a RLS — e ela só exige ser membro com papel `agent`:

```sql
-- 017_account_sharing.sql:416
CREATE POLICY conversations_update ON conversations
  FOR UPDATE USING (is_account_member(account_id, 'agent'))
```

Consequência: **qualquer atendente pode tomar qualquer conversa de
qualquer colega.** A política não olha o dono atual nem o valor que está
sendo gravado. Para uma equipe pequena e de confiança isso é
simplicidade, não falha — mas é bom saber antes de vender para uma
operação com dez atendentes e comissão por atendimento.

E `assigned_agent_id` **não tem chave estrangeira nem CHECK**
(`001_initial_schema.sql:145`). A validação de "essa pessoa é mesmo da
conta" existe só em código, e só no caminho do handoff
(`handoff.ts:88-107`).

---

## O "Rodízio" que não roda

O passo de automação `assign_conversation` oferece o modo `round_robin`,
e a interface o chama de **"Rodízio"** em português
(`messages/pt-BR.json:1200`).

Ele não faz rodízio. A implementação é:

```ts
// automations/engine.ts:487-497
// "Pick any member of the account. The existing implementation only ever
//  returned the automation's author; preserving that shape until a real
//  round-robin algorithm replaces it."
.select('user_id').eq('account_id', …).limit(1)
```

Sem `ORDER BY` e sem estado de rodízio. O Postgres devolve a linha que
quiser — na prática, quase sempre a mesma pessoa.

**Isto era uma promessa quebrada na interface, não só uma limitação.**

**Resolvido em 12/08/2026 pelo lado honesto:** o rótulo passou a ser
**"Qualquer pessoa da equipe"** (`Any team member` / `팀원 아무나`), que
é o que a consulta faz. A chave `round_robin` continua no banco para não
quebrar as automações já salvas.

O rodízio de verdade — por fila, com cursor travado na própria linha —
está desenhado na onda 6 do [`plano.md`](./plano.md), e entra quando
houver cliente com três ou mais pessoas na mesma fila. Antes disso ele
resolve um problema que ninguém tem.

---

## O handoff: quando o bot solta a conversa

Três caminhos levam ao handoff, e só o primeiro passa pelo modelo:

1. **O modelo chama `request_human`.** O destinatário é sempre o
   `handoff_agent_id` da conta — o modelo não escolhe pessoa e não recebe
   a lista de atendentes; o único parâmetro é `reason`
   (`ai/tools/handoff.ts:24-36,58`).
2. **Guardrail de palavra-chave.** Casou, transfere **antes** de qualquer
   chamada ao provedor (`ai/auto-reply.ts:150-163`). Não custa token e
   não há como argumentar com ela.
3. **Desistência sem texto.** Se o modelo termina sem produzir resposta,
   o próprio código grava o handoff com uma nota montada localmente
   (`ai/auto-reply.ts:264-285`).

Um handoff faz quatro coisas: `status` vira `pending`,
`ai_autoreply_disabled` vira `true`, `ai_handoff_summary` recebe a nota,
e o dono é escrito **apenas se a conversa ainda não tiver um**
(`handoff.ts:109-118`). O comentário no código é explícito: *"Never steal
a thread a human already owns"*.

Ele **não** manda mensagem ao cliente, a menos que a conta ligue
`handoff_notice_enabled` — e aí quem envia é o caminho de auto-reply,
depois de a transferência já estar gravada (`ai/auto-reply.ts:297-307`).

### O handoff de fluxo é mais fraco — e isso surpreende

O nó de handoff dos **fluxos** só mudava o `status` para `pending`. Não
escrevia a nota e **não ligava `ai_autoreply_disabled`**: a tarja do
inbox aparecia sem motivo, e se ninguém fosse atribuído o bot continuava
elegível — o fluxo dizia "vou chamar uma pessoa" e a IA respondia por
cima da promessa.

**✅ Corrigido em 12/08/2026**, nos dois caminhos (o nó e o fallback
esgotado): ambos passaram a desligar a resposta automática, e a nota
interna do nó agora vira o motivo que a tarja mostra.

Pior, o campo `assign_to` desse nó existe no motor e no tipo, mas **não
existe no formulário**: a tela só oferece a nota interna
(`flows/forms/node-config-form.tsx:212-220`). Não dá para escolher a
pessoa pela interface.

---

## O portão que decide se o bot fala

Antes de responder, o auto-reply verifica, entre outros:

```ts
// ai/auto-reply.ts:122-123
if (conv.assigned_agent_id) return   // uma pessoa é dona desta conversa
if (conv.ai_autoreply_disabled) return
```

Ter dono cala o bot. É por isso que "atribuir" e "assumir" são, na
prática, o botão de desligar a IA naquela conversa — e a tarja da tela
reflete isso, sumindo quando há dono (`ai-thread-banner.tsx:159`).

### A pegadinha que mais vai gerar chamado

**Responder pelo inbox não cala o bot e não atribui a conversa a quem
respondeu.** O envio só atualiza a prévia da última mensagem e pausa
fluxos ativos — não toca em `assigned_agent_id`, `status` nem
`ai_autoreply_disabled` (`whatsapp/send-message.ts:483-504`).

Ou seja: **o atendente responde, e a IA responde de novo na próxima
mensagem do cliente**, porque para o sistema nada mudou. Só clicar em
"Atribuir" ou "Assumir" muda.

**✅ Mudou em 12/08/2026.** Responder pelo painel passou a atribuir a
conversa a quem respondeu — mas só quando ela **ainda não tem dono**. É
um compare-and-set (`.is('assigned_agent_id', null)`), a mesma regra do
handoff: nunca tomar conversa de outra pessoa.

O botão "Assumir" continua e continua necessário: é como se pega uma
conversa **sem responder**, e é o único jeito de tomar uma que já é de
alguém.

A API pública v1 **não** atribui, de propósito — ali não há pessoa para
receber a conversa.

### E o "Retomar IA" solta qualquer dono

O botão devolve a conversa ao bot, e ao fazê-lo **libera o dono seja
quem for** — inclusive o atendente para quem um handoff havia roteado a
conversa. Também zera o orçamento de respostas e apaga a nota
(`api/ai/autoreply/[id]/route.ts:70-84`; o comentário assume: *"release
ANY assignment, not just the caller's own"*).

### A reabertura é o único gesto que solta o dono sozinho

Cliente escreve numa conversa `closed` → status volta a `open`, dono é
zerado, bot reabilitado, nota apagada (`conversations/reopen.ts:60-70`).

Só vale para `closed`. Conversas em `pending` (a tal fila) e `open` com
dono **não** são liberadas por mensagem nova, de propósito: não tirar a
conversa da atendente no meio do atendimento.

---

## Tags: são do contato, nunca da conversa

Não existe `conversation_tags` nem coluna de tag em `conversations`. A
tag mora em `contact_tags`, e o inbox só a usa como **filtro**,
carregando-a junto da conversa (`inbox/conversations.ts:9-10`).

Duas consequências que um tutorial precisa dizer:

- Marcar "orçamento enviado" marca **o cliente**, não aquele atendimento.
  Na conversa seguinte a tag continua lá.
- O filtro por tag do inbox é **OU** (passa quem tiver qualquer uma das
  marcadas) e roda **no navegador**, sobre as conversas já carregadas —
  não é consulta ao banco (`inbox/conversations.ts:61-64`). Com histórico
  grande, filtra só o que já veio.

E a ficha do contato **dentro do inbox é só leitura** para tags: mostra
os chips, mas não tem como adicionar nem remover
(`inbox/contact-sidebar.tsx:186-210`). Para mexer em tag é preciso ir à
tela de Contatos.

### Os cinco caminhos que põem tag — e o que dispara automação

| # | caminho | dispara `tag_added`? |
|---|---|---|
| 1 | tela de Contatos | sim |
| 2 | passo `add_tag` de automação | sim (com teto de profundidade) |
| 3 | API pública v1 | sim |
| 4 | remoção (automação ou DELETE) | não se aplica |
| 5 | **importação de CSV** | **não** |

A quinta é a que engana: `resolve-import-tags.ts:131` grava em lote e
não dispara nada. **Um tutorial não pode prometer que "toda tag nova
aciona a automação"** — as vindas de importação não acionam.

Tag repetida também não dispara: o `UNIQUE(contact_id, tag_id)` engole,
e o código devolve `duplicate` (`contacts/tag-events.ts:35-41`).

Permissões diferentes de propósito: **criar ou apagar** uma tag exige
`admin`; **aplicar** uma tag a um contato exige `agent`
(`017_account_sharing.sql:394-396` contra `:491-495`).

---

## Presença: informativa, e só

`member_presence` guarda online/away (offline é derivado da idade do
`last_seen_at`). Ela aparece em dois lugares: o dropdown "Atribuir" e o
roster de membros nas configurações.

**Nenhuma decisão de atribuição consulta a presença.** Nenhum dos seis
escritores de `assigned_agent_id` toca nessa tabela. Ela informa o
humano que está escolhendo; não escolhe.

---

## Defeitos encontrados neste levantamento

Em ordem do que eu consertaria primeiro:

1. **Responder não assume a conversa** — a IA volta a falar por cima do
   atendente. É o de maior chance de virar reclamação de cliente.
2. **"Rodízio" não distribui** — a interface promete o que o código não
   faz.
3. **Handoff de fluxo não desliga a IA** e não deixa escolher a pessoa
   pela tela.
4. ~~**Deep link de push quebrado**~~ — ✅ corrigido em 12/08/2026.
   Os cinco geradores passaram a emitir `?c=`, **e a tela passou a
   aceitar as duas grafias**. A segunda metade importa mais do que
   parece: os avisos JÁ ENTREGUES no celular de alguém carregam a
   grafia antiga para sempre, e quem tocar num push de semana passada
   precisa cair na conversa certa.
5. ~~**A lista do inbox não mostra nem filtra por dono**~~ — ✅ o filtro
   **"Minhas"** entrou em 12/08/2026. Mostrar o dono no item da lista
   continua pendente.
6. **`assigned_agent_id` sem chave estrangeira** — nada no banco impede
   gravar um usuário de outra conta ali.

Os itens 4 e 1 são baratos. O 2 é uma decisão de produto (implementar ou
renomear). O 5 é o que uma equipe de mais de dois atendentes vai pedir
no primeiro dia.

---

## Se um dia houver fila de verdade

O que hoje não existe e precisaria existir: uma noção de disponibilidade
que a atribuição consulte (a presença já está lá, só não é usada),
estado de rodízio por conta, e provavelmente um filtro "minhas
conversas" antes de tudo isso — porque distribuir sem que a pessoa
consiga ver o que é dela resolve metade do problema.

Nada disso é urgente enquanto o cliente típico tem um ou dois
atendentes. Vira urgente no primeiro cliente com cinco.
