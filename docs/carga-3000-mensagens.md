# 3.000 mensagens: o que quebra, em que ordem

Estudo motivado por um cliente em prospecção que relata picos de ~3.000
mensagens derrubando o bot atual dele.

Três frentes levantadas de forma independente — o caminho crítico de uma
mensagem, o banco sob volume, e os tetos externos — e depois conferidas
contra esta VPS. Complementa a seção "Volume alto de mensagens" de
[`pendencias.md`](./pendencias.md), que continua valendo e **não** é
repetida aqui.

Onde um número não pôde ser confirmado em fonte oficial, isso está
dito. Limite de fornecedor envelhece: reconfira antes de vender.

---

## O que quebra primeiro

Não é a Meta, não é a OpenAI, não é o Postgres. Em ordem:

| # | o que | quando aparece | sintoma |
|---|---|---|---|
| 1 | **Disparo corta em 1.000** | já, hoje | 2.000 clientes não recebem e a barra marca 100% |
| 2 | **Disparo morre com a aba** | já, hoje | fecha o navegador, para o envio |
| 3 | **Webhook serial dentro de 60 s** | pico real | mensagem perdida **sem reentrega** |
| 4 | **Thread trava nas 1.000 primeiras** | conversa longa | atendente para de ver o que o cliente escreveu |
| 5 | **Índices faltando** | dezenas de milhares de linhas | tudo fica lento junto |
| 6 | **429 do provedor** | pico com IA | cliente sem resposta, em silêncio |

Os dois primeiros são bug, não limite de escala — e são exatamente o
cenário de 3.000.

---

## 1. O teto invisível de 1.000 linhas

`PGRST_DB_MAX_ROWS=1000` está valendo nesta VPS
(`infra/services/supabase/.env:149`). É um **teto global e silencioso**
em toda resposta do PostgREST: a consulta não falha, ela devolve 1.000 e
pronto. Nenhuma consulta do app confere `Content-Range`, então o código
não tem como saber que foi truncado.

### O disparo em massa é o caso grave

`src/hooks/use-broadcast-sending.ts:424` lê os destinatários assim:

```ts
.select('*, contact:contacts(*)')
.eq('broadcast_id', broadcast.id);      // sem limit, sem range, sem paginação
```

**Um disparo para 3.000 contatos insere 3.000 linhas e lê 1.000 de
volta.** Os outros 2.000 nunca são enviados. O `sent_count` bate 1.000,
a barra de progresso chega a 100% e o relatório concorda com o erro.

Ninguém é avisado. É a pior forma de falha que existe: silenciosa e com
a interface confirmando que deu certo.

### E a thread de conversa

A lista de mensagens carrega a conversa **inteira**, ordenada do mais
antigo para o mais novo, sem limite. Passando de 1.000 mensagens naquela
conversa, o atendente passa a ver permanentemente as **1.000 primeiras**
e nunca as recentes.

Não é degradação gradual — é um corte. E antes disso, cada troca de
conversa transfere o histórico completo pela rede.

### O medidor de custo mente por cima

Em `/api/ai/costs` a flag `truncated` é `all.length > 10000` — que nunca
dispara, porque `all.length` nunca passa de 1.000. Acima de 1.000
chamadas de IA no mês, a tela mostra o gasto das 1.000 mais recentes
como se fosse o total.

---

## 2. O disparo roda no navegador do atendente

`use-broadcast-sending.ts` é um hook `'use client'`. O laço que envia
está na máquina de quem clicou.

Consequências: fechar a aba interrompe o disparo pela metade; a
qualidade da rede do atendente vira variável do produto; e não há
retomada. Somado ao teto de 1.000, um disparo grande é hoje uma operação
que **não se pode prometer a cliente**.

Levado para o servidor, ele encontra o próximo teto: 3.000 destinatários
em série, a 200-400 ms por chamada à Graph API, são **10 a 20 minutos**
numa requisição só.

---

## 3. O caminho de uma mensagem

Contado consulta a consulta:

| cenário | idas ao banco |
|---|---|
| texto simples, IA desligada, sem automação | **16** (17 com push) |
| a mesma, gerando resposta de IA | **35** |
| primeira mensagem de um contato novo | **+8** |

O piso de 16 não é evitável por configuração: mesmo com IA, flows,
automações, push e webhooks todos desligados, continua 16.

**Nada disso acontece antes do 200.** Antes do ack há apenas: ler o
corpo, calcular o HMAC e dar `JSON.parse`. Todo o resto roda no
`after()`, com `maxDuration = 60`.

E é aí que dói: **o ack já foi dado, então a reentrega de 7 dias da Meta
nunca é acionada.** O que não couber nos 60 s é perdido em silêncio.
Esse é o item 1 de `pendencias.md`, agora com números.

O agravante que faltava: **a Meta agrega notificações em lotes de até
1.000 updates** por entrega (documentação oficial do Graph API, que
ainda avisa que o lote "não é garantido" e que cada webhook deve ser
tratado individualmente). Um lote grande entra num único POST e é
processado **em fila, uma mensagem por vez**, dentro de 60 s. Com
auto-reply ligado, uma única mensagem já pode consumir o orçamento
inteiro — o teto de parede do agente também é 60 s.

Muita coisa é serial sem precisar. `accountAllowsSideEffects` só depende
do `accountId`, que já existe muito antes, e é aguardada sozinha; no
caminho da IA são nove blocos seriais antes de o modelo ser chamado,
quase todos independentes.

---

## 4. O banco

### Quatro índices faltando, todos no caminho quente

| falta | onde dói |
|---|---|
| `messages(conversation_id, created_at)` | toda leitura de thread varre e **ordena na memória** — e `work_mem` é 4 MB, então conversa longa vai para disco |
| `broadcast_recipients(contact_id)` | o webhook consulta essa tabela **em toda mensagem recebida**; ela cresce 3.000 linhas por disparo |
| `conversations(account_id, last_message_at)` | a lista do inbox |
| `contacts.phone_normalized` no webhook | ver abaixo |

O de `broadcast_recipients` tem um efeito perverso: **o custo de receber
uma mensagem cresce com o número de disparos já feitos.** Dez disparos
de 3.000 e são 30 mil linhas varridas por mensagem que chega.

### A busca de contato por telefone

Roda em **toda** mensagem recebida e usa `LIKE` com curinga à esquerda —
que nenhum índice atende. Existe uma coluna gerada `phone_normalized`
com índice único que resolveria, e ela não é usada nesse caminho.

O comentário no código diz que o pré-filtro evita "puxar todo contato a
cada mensagem". Ele evita o tráfego, não a varredura.

### Realtime sem filtro

As inscrições `postgres_changes` não têm `filter`: todo navegador recebe
toda mudança de `messages`, `conversations` e `notifications` da conta —
e `conversations` chega **duas vezes**, porque há dois canais ouvindo. O
canal do inbox tem nome fixo, não derivado da conta. **Toda a separação
entre contas nessa entrega depende exclusivamente da RLS avaliada dentro
do Realtime.**

### Nenhuma tabela de log tem retenção

Nenhuma. Não há `pg_cron`, não há job de purga, não há `DELETE` agendado
em lugar nenhum: `messages`, `ai_usage_log`, `platform_events`,
`automation_logs`, `flow_run_events`.

O pior caso é `platform_events`, que guarda `screenshot text` — um data
URL de print inteiro, dentro da linha.

### Conexões

`PGRST_DB_POOL=30`, `max_connections=100` (97 úteis), Supavisor com
`POOLER_MAX_CLIENT_CONN=100` e pool de 20 em modo transaction. Em
repouso, 30 conexões em uso. Não é o gargalo hoje, mas é o teto que se
encontra ao escalar o app horizontalmente.

---

## 5. Os tetos de fora

Números oficiais, com a ressalva de cada um:

| limite | valor | confiança |
|---|---|---|
| Vazão por número (Cloud API) | **80 msg/s**, com upgrade automático até 1.000/s; excedeu, erro **130429** | documentado |
| Reentrega de webhook | qualquer resposta ≠ 200 → retentativa decrescente por **até 7 dias**; a doc geral do Graph API diz **36 h** para o mesmo comportamento | as duas fontes discordam |
| Lote de webhook | até **1.000 updates** por entrega | documentado |
| Mensagens iniciadas pelo negócio | degraus de 250 → 2.000 → 10.000 → 100.000 → ilimitado por 24 h | documentado |
| Ritmo para o **mesmo** usuário | ~1 msg / 6 s, rajada de até 45 | **não confirmado** — apareceu numa página e não na de throughput |
| Requisições de metadados por WABA | 200/h (padrão), 5.000/h (ativa) | fonte única |

E um que precisa ser dito: **o comentário do nosso webhook afirma um
timeout de ~20 s da Meta que não foi encontrado em nenhuma página
oficial.** A decisão mais cara do subsistema — responder 200 antes de
processar, que é o que torna a perda irrecuperável — está apoiada num
número sem fonte confirmada. Vale reconfirmar antes de tratá-lo como
restrição de projeto.

### Os provedores de IA

Uma mensagem recebida custa até **8 idas a fornecedores**: 1 transcrição
(se áudio) + 1 de embeddings + 1 a 6 de chat (`maxToolSteps`, padrão 6)
+ 1 envio à Meta.

3.000 mensagens com auto-reply e média de 2 passos ≈ **3.000 requisições
de embeddings + 6.000 de chat**. No degrau de entrada isso roda colado no
teto por muitos minutos.

Três agravantes:

- **Nenhuma chamada de saída lê `Retry-After` nem tenta de novo.** O 429
  vira erro tipado e a resposta é **perdida**, não adiada. Tanto a OpenAI
  quanto a Anthropic dizem exatamente quanto esperar.
- **As embeddings usam sempre a OpenAI**, mesmo quando o chat é
  Anthropic. Uma conta sem cota de OpenAI perde a busca semântica e
  **cai para busca lexical em silêncio** — a única evidência é um
  `console.error`.
- **O código 130429 da Meta não é reconhecido como rate limit** em lugar
  nenhum; a regex que tentaria detectá-lo não casa com o formato real.
  No disparo, o destinatário é marcado `failed` e **nunca mais é
  tentado**.

### Nenhum dos 17 `fetch` para a Graph API tem timeout

Uma conexão lenta com a Meta segura o orçamento inteiro. E como o
processamento é serial, **um envio pendurado bloqueia todas as mensagens
seguintes daquele lote**.

### O timeout da transcrição é o dobro do orçamento da rota

120 s para transcrever, dentro de um `after()` de 60 s. Um áudio que
espere na fila nunca consegue terminar. Isso conversa diretamente com o
mutex medido em [`whisper-escala.md`](./whisper-escala.md): a fila
existe, e o orçamento para esperá-la não.

---

## O plano, em ordem de retorno

**Agora, antes de qualquer conversa sobre escala** — são bugs, e baratos:

1. Paginar a leitura de destinatários do disparo (ou `range()` em laço).
   Sem isso, prometer 3.000 mensagens é prometer 1.000.
2. Limitar a thread às N mensagens mais recentes, com "carregar mais".
3. Os quatro índices. Uma migração, sem risco.
4. Usar `phone_normalized` na busca do webhook.
5. Timeout em todo `fetch` para a Graph API.

**Antes de atender um cliente de alto volume:**

6. Persistir antes de confirmar, com idempotência `(phone_number_id, wamid)`
   — o item 1 de `pendencias.md`, agora com o agravante do lote de 1.000.
7. Mover o disparo para o servidor, em lotes retomáveis.
8. Retentativa com backoff lendo `Retry-After`, e reconhecer o 130429.
9. Teto de concorrência de IA por conta.
10. Retenção nas tabelas de log, começando por `platform_events`.

**O que dá para dizer ao cliente hoje, com honestidade:** o sistema
recebe e responde bem no volume de uma operação normal; o que ainda não
está pronto é o pico — e a diferença entre nós e o bot que cai é que
aqui a fila e a idempotência são um caminho conhecido, medido e
orçado, não uma reescrita.
