# Vault, base de conhecimento e guardrails

Este subsistema é a memória e a coleira do agente de IA. São três coisas diferentes que costumam ser confundidas. O **Vault** é uma wiki interna da conta que o próprio sistema propõe sozinho: um programa chamado *keeper* lê conversas que já terminaram, escreve páginas em rascunho, e uma pessoa da equipe aprova ou recusa cada uma — só página aprovada chega ao cliente. A **base de conhecimento** é o texto que o operador cola à mão (FAQ, política de troca, descrição de produto); o sistema fatia esse texto em pedaços e busca os mais parecidos com a pergunta do cliente na hora de responder. Os **guardrails** (na tela: "Limites" / "Quando chamar uma pessoa") são a lista de assuntos e palavras que o bot não pode tratar: quando algum deles aparece, a conversa é transferida para uma pessoa.

Nada aqui é opcional na hora da resposta: as páginas do Vault do tipo regra e estado entram em **toda** resposta do agente, os trechos da base de conhecimento entram conforme a pergunta, e os guardrails entram por último no prompt ou são checados antes mesmo de chamar o provedor de IA.

---

## Para que serve (visão do cliente)

**O agente aprende sozinho, mas quem decide é você.**
Depois que uma conversa fica parada por um tempo, o sistema relê aquela conversa e, se encontrar algo que vale guardar ("a loja não faz entrega no sábado", "essa cliente é alérgica a níquel"), escreve uma página de rascunho. Essa página fica esperando na aba de aprovação. Enquanto você não aprovar, ela não muda em nada o que o agente responde. Quando você aprova, passa a valer.

**Você também pode escrever o que o agente precisa saber.**
Existem duas formas, e elas servem para coisas diferentes:

- **Página de Vault** (aba Vault → "Nova página"): coisas curtas e definitivas. Uma regra escrita aqui entra em toda resposta que o agente der, para qualquer cliente. Serve para "não damos desconto por WhatsApp", "prazo de entrega é 5 dias úteis".
- **Documento da base de conhecimento** (aba Configuração → card "Base de conhecimento"): textos longos. FAQ inteira, política de garantia, catálogo. O agente não lê tudo isso a cada resposta; ele procura os pedaços que têm a ver com a pergunta do cliente e usa só esses.

A regra prática: se é curto e vale sempre, é página de Vault do tipo Regra. Se é comprido e só interessa quando o cliente pergunta, é documento da base de conhecimento.

**Cinco tipos de página**, com o nome que aparece na tela:

| Tipo (tela) | Para que serve | Entra em toda resposta? |
|---|---|---|
| Regra | Vale para todo mundo e não muda toda semana | Sim |
| Estado atual | O que é verdade agora e vai mudar (promoção do mês, equipe reduzida) | Sim |
| Sobre um cliente | Fato sobre uma pessoa específica: preferência, restrição, o que comprou | Só na conversa daquele cliente |
| Sobre o negócio | O que vocês vendem, cobram, fazem e não fazem | Não — vai para a busca, aparece quando tem a ver com a pergunta |
| Conceito | Um termo do ramo que o agente precisa entender do seu jeito | Não — vai para a busca |

**Você decide o que o bot não pode tocar.**
Na aba Limites existem duas listas. "Por assunto" é interpretado pelo agente ("qualquer negociação de preço") — pega o cliente que negocia sem nunca escrever a palavra desconto, mas depende do julgamento do modelo e pode errar. "Por palavra" é conferido antes de o agente pensar: se a palavra aparece na mensagem, a conversa é transferida na hora, sem gastar nenhuma chamada de IA e sem chance de o modelo ser convencido do contrário. A conta já nasce com 8 regras prontas (5 assuntos e 3 palavras) que você pode desligar ou apagar.

**O agente nunca inventa uma página.**
Toda página do Vault precisa citar a evidência: o trecho de conversa ou a nota que a originou. Na tela de aprovação você vê o trecho citado sem precisar reabrir a conversa inteira.

**A wiki se auto-diagnostica.**
A sub-aba "Saúde" aponta páginas que se contradizem, páginas de "Estado atual" velhas, páginas duplicadas, páginas sem ligação com nenhuma outra e assuntos que aparecem muito e não têm página própria. Isso não consome IA nem custa nada.

---

## Como se usa, na prática

Tudo mora na tela **Agentes de IA** (menu: Agentes). As abas relevantes são **Vault**, **Limites**, **Configuração** e **Contexto**.

### Aprovar o que o agente propôs

1. Abra **Agentes de IA → Vault**. A aba tem cinco sub-abas: **Rede**, **Aprovação**, **Páginas**, **Saúde** e **Keeper**. A sub-aba Aprovação mostra um contador quando há rascunhos esperando.
2. Em **Aprovação**, cada rascunho traz título, conteúdo e a evidência que o originou.
3. Botão **Aprovar**: a página passa a valer imediatamente nas respostas. Aparece o aviso "Página aprovada — já vale nas respostas."
4. Botão **Recusar**: a página é arquivada e sai de circulação.
5. Botão **Editar**: você corrige o texto e salva. **Não existe "salvar como rascunho"** — salvar uma edição aprova a página com a sua versão. O texto de ajuda na tela diz isso: "Ao salvar, a página é aprovada com a sua versão".

### Aposentar uma página que já valia

Sub-aba **Páginas** lista as aprovadas. O botão **Arquivar** tira a página de circulação e, se ela estava no índice de busca, apaga os pedaços dela do índice.

### Escrever uma página à mão

1. Aba **Vault** → botão **Nova página**.
2. Escolha o **Tipo**, escreva **Título** e **Conteúdo**, clique em **Criar página**.
3. **Atenção**: o texto da tela diz "Entra aprovada e passa a valer nas respostas" e a mensagem de sucesso diz "Página criada e aprovada" — **isso é falso**. O código grava a página como rascunho, sem exceção. Ela vai para a sub-aba **Aprovação** e você precisa aprová-la lá. Um tutorial precisa instruir o cliente a ir na aba Aprovação depois de criar a página.
4. Se o título gerar um endereço já usado por outra página, a criação falha com a mensagem de que a página já existe — o caminho certo é editar a existente.

### Ver a wiki como um mapa

Sub-aba **Rede**: um grafo em que cada bolinha é uma página, colorida pelo tipo (Regra em âmbar, Cliente em azul-céu, Negócio em violeta, Conceito em ardósia, Agora/Estado em esmeralda). Bolinha vazada é rascunho. Arraste para mover, role para aproximar. O checkbox **Mostrar rascunhos no grafo** inclui as páginas ainda não aprovadas. Clicar numa bolinha leva para a sub-aba Aprovação ou Páginas com aquele item aberto.

### Rodar a leitura de conversas na hora

Sub-aba **Keeper**: mostra o histórico do que o keeper decidiu, inclusive quando a decisão foi não guardar nada. O botão **Rodar agora** dispara a varredura só para a sua conta (exige papel admin). O aviso que aparece depois distingue os casos:

| Situação | Mensagem |
|---|---|
| Achou coisa nova | "{n} página(s) proposta(s) — veja na aba de aprovação." |
| Leu e não achou nada durável | "Leu {n} conversa(s) e não achou nada durável para guardar." |
| Conversas ainda ativas | "Nenhuma conversa pronta: {n} ainda estão ativas. Ele só lê depois de 90 minutos de silêncio." |
| Já tinha lido tudo | "Nada novo — as {n} conversas da janela já foram lidas antes." |
| Sem conversas | "Nenhuma conversa nos últimos 7 dias para ler." |

### Configurar os limites

Aba **Limites** (título interno: "Quando chamar uma pessoa"). Duas listas separadas — **Por assunto** e **Por palavra**. Cada linha tem um interruptor para ligar/desligar e um botão para remover. As regras que vieram de fábrica têm a etiqueta "padrão". O card **Adicionar regra** pede o tipo (Assunto ou Palavra), o texto e um **Aviso para a atendente** opcional, que aparece na nota que a pessoa lê antes de abrir a conversa. Escrever exige papel admin; quem não tem vê a tela em modo leitura.

Nesta mesma aba aparece, acima das listas, o card de ferramentas do agente — é outro subsistema e não é coberto por este documento.

### Alimentar a base de conhecimento

1. Aba **Configuração** → card **Base de conhecimento**.
2. **Adicionar documento**: Título e Conteúdo (cole a FAQ, a política, o texto do produto) e **Salvar documento**. O sistema fatia e indexa na hora.
3. Editar e remover documentos pelos ícones da lista.
4. O card diz qual busca está ativa: "A busca semântica está ativa (chave de embeddings definida)" ou "Usando busca por palavras-chave — adicione uma chave de embeddings acima para busca semântica".
5. Botão **Reindexar**: regera os vetores de todos os documentos. O uso principal é logo depois de cadastrar a chave de embeddings, para que os documentos antigos passem a ser encontrados por sentido e não só por palavra.
6. Este card é a única porta para a base de conhecimento. Ele **não** aparece em Configurações.

### Conferir o que o agente está lendo

Aba **Contexto**: mostra o prompt final montado seção por seção com contagem de tokens, incluindo a seção do Vault e a seção dos guardrails. É onde o operador vê exatamente quais regras aprovadas estão entrando em cada resposta.

---

## O que dá para configurar

| Ajuste | Onde | O que muda | Exige admin |
|---|---|---|---|
| Aprovar / Recusar / Arquivar / Editar página | Agentes → Vault → Aprovação e Páginas | Só página aprovada é lida pelo agente | Não — papel agente basta |
| Escrever página à mão | Agentes → Vault → Nova página | Cria a página em **rascunho** (apesar do texto da tela) | Não — papel agente basta |
| Mostrar rascunhos no grafo | Agentes → Vault → Rede → checkbox | Só visual; não muda o que o agente lê | Não |
| Rodar keeper agora | Agentes → Vault → Keeper → "Rodar agora" | Varre as conversas paradas da sua conta e propõe páginas; gasta a chave de IA da conta | Sim |
| Regras de assunto e de palavra | Agentes → Limites | Assunto entra no prompt; palavra é checada antes da IA e transfere na hora | Sim para escrever; leitura é livre |
| Documentos da base de conhecimento | Agentes → Configuração → Base de conhecimento | O que o agente pode citar quando a pergunta bate | Sim |
| Reindexar base de conhecimento | Mesmo card, botão "Reindexar" | Regera os vetores de todos os documentos | Sim |
| Chave de embeddings (OpenAI) | Agentes → Configuração (campo de chave de embeddings; coluna `ai_configs.embeddings_api_key`) | Sem ela existe só busca por palavra. Depois de cadastrar é preciso Reindexar para os documentos antigos | Sim |
| Chave do provedor e interruptor `is_active` | Agentes → Configuração (`ai_configs`) | Com a configuração de IA inativa o keeper **não roda** | Sim |
| `AUTOMATION_CRON_SECRET` | Variável de ambiente | Segredo do agendador. Sem ela, `GET /api/ai/vault/keeper` responde 503 e o keeper nunca roda sozinho — só pelo botão | Servidor |
| `CRON_INTERVAL_SECONDS` (padrão 300) e `KEEPER_EVERY_TICKS` (padrão 6) | Variáveis de ambiente lidas pelo serviço `cron` do deploy | De quanto em quanto tempo o keeper roda sozinho. Padrão: a cada 30 minutos | Servidor |
| `ENCRYPTION_KEY` | Variável de ambiente | Se não bater, a chave de embeddings não descriptografa e a busca vira lexical em silêncio. O Reindexar, ao contrário, para e avisa | Servidor |
| `AI_MAX_TOOL_STEPS` / `ai_configs.max_tool_steps` | Variável de ambiente e aba Regras | **Não afetam o keeper**, que sobrescreve para 8 passos | Servidor |
| Ociosidade de 90 min, teto de 10 conversas por varredura, janela de 7 dias | Código (`src/lib/ai/vault/sweep.ts:28,33,36`) | Quando e quanto o keeper lê. Não há tela nem variável | Código |
| 20 regras, 2000 caracteres de regras, 5 páginas de estado | Código (`src/lib/ai/vault/retrieve.ts:20-22`) | Teto do bloco que entra em toda resposta | Código |
| Tipos indexados na busca (hoje `concept` e `entity_business`) | Código (`src/lib/ai/vault/store.ts:317`) | Quais páginas viram trechos buscáveis | Código |
| 5 trechos por resposta e 1200 caracteres por trecho | Código (`src/lib/ai/knowledge.ts:104`, `src/lib/ai/chunk.ts:11`) | Quanto da base de conhecimento entra em cada resposta | Código |
| 60 dias para "Estado atual" ficar velha; 3 páginas para virar "Lacuna" | Código (`src/lib/ai/vault/lint.ts:43` e `:229`) | Sensibilidade da sub-aba Saúde | Código |
| Lista de 8 guardrails de fábrica | Código (`src/lib/ai/guardrails.ts:46-87`) | Só o ponto de partida — depois de semeadas viram linhas editáveis pela tela | Código |
| Modelo e dimensão do embedding (`text-embedding-3-small`, 1536) | Código (`src/lib/ai/embeddings.ts:18-19`) casado com a coluna `vector(1536)` da migração 030:107 | Trocar um exige migrar o outro | Código |
| Todo o texto de prompt do Vault (guia de cada tipo, regra de fidelidade, enquadramento de regras vs. fatos) | Código (`src/lib/ai/vault/schema.ts:34-99`, `src/lib/ai/vault/retrieve.ts:138-166`) | Deliberadamente fora do alcance do operador | Código |

---

## Como funciona por dentro

### O caminho de uma resposta automática

1. `src/lib/ai/auto-reply.ts:144` carrega os guardrails ativos da conta (no máximo 200 — `src/lib/ai/guardrails.ts:109-114`).
2. `auto-reply.ts:150-153` casa os guardrails do tipo `keyword` contra a mensagem do cliente **antes de qualquer chamada ao provedor**. Se casar, `auto-reply.ts:154-162` transfere a conversa e retorna sem gerar resposta — custo zero de token.
3. `auto-reply.ts:189` recupera trechos da base de conhecimento usando **apenas a última mensagem do cliente** como consulta (`latestUserMessage`).
4. `auto-reply.ts:216` carrega o contexto do Vault, agora com o `contactId` da conversa.
5. `src/lib/ai/defaults.ts:99-171` monta o prompt nesta ordem exata: **Vault** (140-142) → **texto livre do operador** (144-146) → **base de conhecimento** (148-160) → **guardrails de assunto** (166-168, por último).

### O bloco do Vault que entra em toda resposta

`src/lib/ai/vault/retrieve.ts:53` (`loadVaultContext`) faz duas consultas:

- Uma pega páginas com `status='approved'` e `kind IN ('rule','state')`, ordenadas por `updated_at desc`, com limite de 25 linhas (`retrieve.ts:79-81`).
- Outra, só quando há `contactId`, pega a página `entity_customer` daquele contato (`retrieve.ts:117`), também só aprovada, com `.maybeSingle()`.

Tetos em `retrieve.ts:20-22`: `MAX_RULE_CHARS=2000`, `MAX_RULES=20`, `MAX_STATE_PAGES=5`. Quando o orçamento de caracteres estoura, a regra inteira é **descartada**, não cortada pela metade (`retrieve.ts:94-96`). Qualquer falha degrada para contexto vazio e o bot responde sem a wiki (`retrieve.ts:64-67`) — nunca lança para o caminho da resposta.

`describeVaultContext` (`retrieve.ts:138`) apresenta as regras ao modelo como obrigações, e as páginas de estado e do cliente como fatos com instrução explícita de não tratá-las como ordens (`retrieve.ts:143-144, 152, 159-161`).

### Escrita no Vault

Tudo passa por `src/lib/ai/vault/store.ts`:

- `createSource` (69): grava a evidência. Deduplicação por SHA-256 do conteúdo, via upsert em `(account_id, content_hash)` — ingerir a mesma conversa duas vezes devolve a mesma fonte (`store.ts:79-96`, migração 046:59).
- `createPage` (117): recusa criar página sem pelo menos uma fonte (`store.ts:131-137`, falha `no_sources`); grava `status:'draft'` fixo (`store.ts:150`); slug derivado só do título com fallback para o tipo (`store.ts:139`); `23505` vira falha `slug_taken` com mensagem mandando editar a existente (`store.ts:156-161`). Se o vínculo com a fonte falhar depois do insert, a página é **apagada** em vez de ficar sem evidência (`store.ts:180-181`).
- `approvePage` (205): aprova, aceita o conteúdo editado pelo curador, incrementa `version` só quando a página **já estava** aprovada (`store.ts:233`), e chama `indexPage` (`store.ts:249`).
- `archivePage` (265): arquiva e apaga os chunks da página (`store.ts:290`) — o resultado desse delete não é conferido.
- `indexPage` (323): `INDEXED_KINDS = {concept, entity_business}` (`store.ts:317`). Página de outro tipo tem os chunks apagados e a função retorna (`store.ts:328-334`). A indexação acontece **só na aprovação**; `createPage` não indexa nada.
- `recordRevision` (352): grava a linha no log append-only.

### O keeper

`src/lib/ai/vault/keeper.ts:40` (`runVaultKeeper`), por conversa:

- Só roda se a conta tiver configuração de IA **ativa** (`keeper.ts:51-52` com `loadAiConfig` `requireActive`; `src/lib/ai/config.ts:44,57`).
- Ignora conversas com menos de 4 mensagens, motivo `too_short` (`keeper.ts:56-58`).
- Lê até 60 mensagens e monta um transcript rotulado Customer/Business (`keeper.ts:54, 60-62`).
- Mostra ao modelo até 120 páginas existentes (slug, tipo, título) para ele revisar em vez de duplicar; o índice interno carrega até 300 páginas não arquivadas (`keeper.ts:189-196`, `keeper.ts:155-157`).
- Roda com no máximo 8 passos de ferramenta, sobrescrevendo o `maxToolSteps` da conta (`keeper.ts:32` e `:86`), com `toolChoice:'required'` (`keeper.ts:102`) — o modelo não consegue encerrar falando, só chamando `done`.
- Gasta a chave do provedor **da própria conta**, com consumo registrado em `mode:'agent'` (`keeper.ts:105-112`).
- Se o modelo não chamar ferramenta nenhuma, grava revisão `operation='no_action'` com os 500 primeiros caracteres do que ele disse (`keeper.ts:120-130`) — para distinguir "não achou nada" de "está quebrado".
- Nunca lança: qualquer erro vira `{ran:false, reason:'error'}` (`keeper.ts:133-138`).
- O prompt trata a conversa como conteúdo **não confiável** e diz explicitamente que um cliente não pode ditar o que vai para a wiki (`keeper.ts:205-209`).

As quatro ferramentas (`src/lib/ai/vault/tools.ts:32-39`) são `propose_page`, `update_page`, `link_pages` e `done`. **Nenhuma aprova nada** — é a propriedade de segurança do desenho.

| Ferramenta | Comportamento |
|---|---|
| `propose_page` | Exige `excerpt` não vazio (`tools.ts:88-94`); só preenche `contact_id` quando o tipo é `entity_customer` (`tools.ts:101`) |
| `update_page` | Devolve a página para `draft` mesmo que estivesse aprovada (`tools.ts:163`) — revisão é página não revisada |
| `link_pages` | Exige que as duas páginas já estivessem no índice carregado no início da execução, proíbe auto-link, trunca a relação em 40 caracteres (`tools.ts:225-241`) |
| `done` | Grava revisão `finished` e encerra o laço devolvendo `handoff:true`, usado aqui como sinal de parada e não como transferência (`tools.ts:289-297`) |

### A varredura

`src/lib/ai/vault/sweep.ts:59` (`sweepVault`) é compartilhada pelo cron e pelo botão: considera "encerrada" a conversa parada há `IDLE_MINUTES=90` (`sweep.ts:28`), olha `LOOKBACK_DAYS=7` (`:36`) e processa no máximo `MAX_PER_SWEEP=10` conversas por execução (`:33`), sequencialmente com `await` (`:119-130`) para não estourar o rate limit do provedor. Evita reprocessar consultando `ai_vault_sources` por `kind='conversation'` e `ref_id IN (…)` numa única query (`sweep.ts:100-114`). Devolve os motivos separados (`tooRecent`, `alreadyRead`) exatamente para que um zero não seja confundido com quebra (`sweep.ts:43-49, 132-137`).

O agendamento vem do sidecar `cron` do deploy (`deploy/docker-compose.app.yml:138`), que bate em `/api/ai/vault/keeper` a cada `KEEPER_EVERY_TICKS` (padrão 6) ticks de `CRON_INTERVAL_SECONDS` (padrão 300s) — a cada 30 minutos por padrão — com timeout de 900s (`docker-compose.app.yml:146,150,183-184`).

### O lint (sub-aba Saúde)

`src/lib/ai/vault/lint.ts:55` não chama modelo nenhum: as cinco diagnósticas são calculadas em SQL e código puro sobre páginas não arquivadas (limite 2000) e links (limite 5000) (`lint.ts:59-64, 74-78, 80-86`). Só páginas **aprovadas** são avaliadas (`lint.ts:72`).

| Diagnóstico | Nome na tela | Regra |
|---|---|---|
| `contradiction` | Contradição | Heurístico: pares de páginas aprovadas que compartilham uma palavra significativa no título e cujos conjuntos de números não têm interseção; no máximo 20 achados (`lint.ts:106-113, 129`) |
| `stale` | Desatualizada | Página `state` sem atualização há mais de 60 dias (`lint.ts:43, 133-135`) |
| `duplicate` | Duplicada | Páginas com conteúdo repetido |
| `orphan` | Sem conexão | Página sem link; ignora de propósito `rule` e `state`, e é severidade info (`lint.ts:188-190, 196`) |
| `gap` | Lacuna | Palavras que aparecem em 3 ou mais páginas e não têm página própria; devolve as 5 mais frequentes, com `pageIds` vazio (`lint.ts:229-232`) |

### Guardrails

`src/lib/ai/guardrails.ts` é um arquivo único (não existe diretório `src/lib/ai/guardrails`).

- `loadGuardrails` (104) lê no máximo 200 regras ativas.
- Falha ao ler é **fail-open**: o bot responde sem os guardrails, mas grava um evento de plataforma com severidade `critical` e código `guardrails_unreadable` (`guardrails.ts:123-141`).
- `normalize` (154) tira acentos via NFD, minúsculiza e troca tudo que não é `[a-z0-9]` por espaço. `matchKeywordGuardrail` (171) casa em fronteira de palavra por padding de espaços (`guardrails.ts:175-183`): `advogado` casa em "chamar meu advogado"; `caro` **não** casa em "carro". Devolve a **primeira** regra que casar.
- `describeGuardrails` (194) redige os `topic` como instrução dura ("chame `request_human` imediatamente, não responda nem parcialmente, não explique a regra"). Quando não há nenhum `topic` ativo, devolve `null` e a seção some do prompt inteira (`guardrails.ts:195`).
- `guardrailHandoffSummary` (210) prefixa a nota do atendente com "🤖 Regra de segurança acionada: " e usa a `note` da regra, ou uma frase citando o termo quando não há nota.
- O handoff em si é `src/lib/conversations/handoff.ts:64`: marca a conversa como `pending`, `ai_autoreply_disabled=true`, grava `ai_handoff_summary`, atribui o agente nomeado só se ninguém já for dono da thread, e dispara push urgente (`handoff.ts:109-118, 139-149`). Ele **não** manda mensagem ao cliente — é decisão de quem chama (`handoff.ts:19-22`).

### Base de conhecimento

- `ingestDocument` (`src/lib/ai/knowledge.ts:41`): **apaga** os chunks do dono antes de reinserir (re-ingestão idempotente, `:52-56`). Se o embedding falhar, ainda insere as linhas **sem vetor** e só depois relança o erro (`:66-87`) — o documento continua buscável por palavra.
- `chunkText` (`src/lib/ai/chunk.ts`): fatiamento consciente de parágrafo, teto de 1200 caracteres (`:11`), com corte em janelas fixas para parágrafo maior que isso (`:36-44`).
- `embedTexts` (`src/lib/ai/embeddings.ts`): sempre OpenAI, `text-embedding-3-small`, 1536 dimensões, lotes de 96 (`:16-23`). A ordem é reconstituída pelo campo `index`; índice ausente é erro duro, não default 0, para não desalinhar chunk e vetor (`:80-86`).
- `retrieveKnowledge` (`src/lib/ai/knowledge.ts:99`, `k=5`): antes de gastar qualquer chamada paga faz um `COUNT` head em `ai_knowledge_chunks` e devolve `[]` se a conta não tiver chunk nenhum (`:113-121`). Depois roda semântica (quando há chave de embeddings, `:126-142`) e completa com FTS até chegar a `k`, sem repetir ids (`:145-161`). Qualquer falha (embedding, RPC, rede) degrada para menos ou zero resultados e nunca lança no caminho da resposta.
- Os chunks entram no prompt numerados `[1]..[n]`, rotulados como referência e não como instrução, com ordem explícita de não chutar quando não cobrirem a pergunta — no auto-reply, respondendo com o sentinel de handoff (`src/lib/ai/defaults.ts:148-160`).
- A busca lexical usa a configuração `simple` do Postgres (sem stemming nem stopwords de idioma) tanto na coluna gerada quanto no `plainto_tsquery` — escolha explícita por neutralidade de idioma (migração 030:99-106 e 032:55-58).

### Isolamento entre contas

As duas funções de busca nasceram `SECURITY DEFINER` (030:155-193) e foram **recriadas como `SECURITY INVOKER`** em `032_fix_ai_knowledge_membership.sql:47-79` (correção GHSA-fg5p-2qc3-jmxr, severidade H2): corpo byte a byte idêntico, só o modo mudou. No estado atual, um usuário autenticado que chame o PostgREST com o `p_account_id` de outra conta recebe zero linhas (032:61, :79). O bot, que usa service-role, continua ignorando RLS.

---

## Limites e pegadinhas

**"Nova página" mente na tela.** O diálogo diz "Entra aprovada e passa a valer nas respostas" e a mensagem de sucesso diz "Página criada e aprovada". O código grava `status:'draft'` sem exceção (`store.ts:150`) e a rota humana chama o mesmo `createPage` (`src/app/api/ai/vault/route.ts:96-104`). A página criada à mão **não vale nada** até ser aprovada na sub-aba Aprovação. Qualquer tutorial que copie o texto da tela vai enganar o cliente.

**"Arquivar" fica registrado como recusa.** A rota distingue `archived` de `rejected` (`src/app/api/ai/vault/[id]/route.ts:86`), mas a interface nunca exercita o outro ramo: `decide(page, false)` em `src/components/agents/ai-vault.tsx:115-124` envia sempre `{status:'archived', operation:'rejected'}`, e é o handler tanto do botão **Recusar** (linha 271, aba Aprovação) quanto do botão **Arquivar** (linha 312, aba Páginas). Pelo dashboard, nenhum caminho grava `operation='archived'`. Não prometa que o histórico da página vai mostrar "arquivada".

**Não existe "salvar como rascunho".** Qualquer edição salva na tela vai com `status:'approved'` (`ai-vault.tsx:154`). Editar um rascunho aprova-o com a correção aplicada.

**Regra aprovada demais é regra invisível.** A consulta do bloco sempre-ligado tem limite de 25 linhas ordenadas por `updated_at desc` (`retrieve.ts:80-81`), e o teto é de 20 regras e 2000 caracteres. Uma conta com 30 regras aprovadas **nunca verá as mais antigas**. E quando o orçamento de caracteres estoura, a regra inteira some — o agente não recebe metade dela.

**Só dois dos cinco tipos vão para a busca.** `concept` e `entity_business` são fatiados e indexados; `rule`, `state` e `entity_customer` não. Isso é intencional: os três primeiros já entram por outro caminho. Mas significa que aprovar uma página `state` não a torna "pesquisável".

**Uma falha de indexação na aprovação é engolida.** A página fica aprovada e o erro só vai para o console (`store.ts:345-349`). Existe risco concreto disso acontecer com papel `agent`: a rota de curadoria exige apenas `agent` (`[id]/route.ts:67`) e roda com o cliente RLS do usuário, mas a policy de INSERT de `ai_knowledge_chunks` exige `admin` (030:135-136). Os dois fatos estão verificados no código; a consequência (página aprovada e não indexada) é dedução — **não foi medida contra um banco**. O mesmo vale para o delete de chunks no arquivamento, cujo resultado não é conferido (`store.ts:290`) e cuja policy também exige `admin` (030:143-144).

**Um erro na página do cliente derruba o Vault inteiro daquela resposta.** A leitura da página `entity_customer` relança o erro e cai no catch que zera o contexto **completo**, regras inclusive (`retrieve.ts:118-121` e `:59-67`). O agente responde sem nenhuma regra em vez de responder sem a página do cliente.

**O Playground não testa os guardrails.** `POST /api/ai/playground` monta o prompt com Vault e base de conhecimento, mas **não** passa guardrails para `buildSystemPrompt` (`playground/route.ts:109-115`). Um ensaio no Playground não exercita os assuntos proibidos. Não há comentário nem issue dizendo se é intencional.

**O rascunho sugerido ao atendente também não usa o Vault.** `POST /api/ai/draft` usa apenas a base de conhecimento (`draft/route.ts:104-108`). Nem Vault nem guardrails entram no prompt do rascunho.

**Guardrail de palavra não avisa o cliente.** No caminho da palavra-chave a função retorna antes do bloco que envia o aviso ao cliente (`auto-reply.ts:162` versus `:297-313`). O cliente escreve "vou chamar meu advogado" e simplesmente não recebe resposta nenhuma até uma pessoa abrir a conversa.

**A busca da base de conhecimento usa só a última mensagem.** Se o cliente escreve "quero saber sobre garantia" e depois "e o prazo?", a consulta que vai para a busca é apenas "e o prazo?" (`auto-reply.ts:189-194`).

**Sem chave de embeddings existe só busca por palavra.** E como a configuração de texto é `simple` (sem stemming), "cadeiras" não casa com "cadeira". Depois de cadastrar a chave, **é obrigatório clicar em Reindexar** para os documentos antigos ganharem vetor.

**Se a `ENCRYPTION_KEY` não bater, a busca semântica cai em silêncio.** O caminho de resposta degrada para lexical sem avisar ninguém (`src/lib/ai/config.ts:122-129`). O botão Reindexar, ao contrário, para e avisa (`reindex/route.ts:39-51`).

**As regras de fábrica são semeadas na primeira leitura da tela, não pela migração.** E se quem abre a aba Limites pela primeira vez **não** for admin, a semeadura falha na policy de INSERT, o erro só é registrado como warn, e a pessoa vê a lista vazia até um admin abrir a tela (`src/app/api/ai/guardrails/route.ts:53-58`, migração 048:78-79). O tutorial deve instruir que o primeiro acesso à aba Limites seja feito por um admin.

**As regras "padrão" podem ser apagadas.** Não há proteção no código contra apagar uma regra `is_builtin` (`guardrails/route.ts:168`). Apagadas, elas voltam se a conta ficar sem nenhuma regra e a tela for aberta de novo — porque a semeadura dispara quando o `COUNT` é zero.

**O keeper não roda se a IA estiver desligada.** Configuração de IA com `is_active=false` faz `loadAiConfig` devolver `null` e o keeper simplesmente não roda (`keeper.ts:51-52`).

**O keeper custa dinheiro da conta.** Ele usa a chave do provedor da própria conta e o consumo aparece como `mode:'agent'`. O botão "Rodar agora" exige admin justamente por isso.

**Nenhum teto de gasto é aplicado.** O `monthly_budget_usd` é exibido e entra na projeção de custo, mas **nunca** é aplicado — nem ao keeper, nem às respostas. A aba de projeção mostra um número, não um limite.

**A projeção de custo é estimativa, não medição.** Os números saem de uma heurística de caracteres por token em `cost-projection.ts`, não de um tokenizador. A base de conhecimento é dimensionada como 5 chunks do tamanho médio dos chunks reais da conta, com amostra de 20 (`cost-projection.ts:236-246`).

**O log não é editável, de propósito.** `ai_vault_revisions` não tem policy de UPDATE nem de DELETE (migração 046:304). Fontes (`ai_vault_sources`) também não têm policy de UPDATE — são imutáveis por desenho (046:246-247).

**Dois clientes com o mesmo nome colidem.** O slug vem só do título e é único por conta (`store.ts:139`, migração 046:114). Duas páginas de cliente com nomes iguais dão 409.

**O tipo de fonte `document` existe no banco e nunca é produzido.** O enum `vault_source_kind` prevê `('conversation','document','note')`, mas as duas únicas chamadas a `createSource` usam `conversation` (keeper) e `note` (rota humana). Não se sabe se é resquício de plano abandonado ou funcionalidade prevista.

**A policy de links olha só a página de origem.** `ai_vault_links` checa a associação apenas por `from_page_id` (046:288 e :294), nunca pelo destino. O lint e a rota do grafo consultam a tabela sem filtro de `account_id`, apoiando-se só nessa policy (`lint.ts:74-77`, `graph/route.ts:57-63`). Não foi testado se isso permite criar uma aresta apontando para página de outra conta.

**O que ainda não se sabe** (registrado como lacuna, não presumido):

- Não se verificou empiricamente o comportamento de um usuário `agent` aprovando ou arquivando página indexada — só o que o código faz.
- Não se confirmou se a extensão `pgvector` está instalada nesta instância nem se o índice HNSW foi criado; a migração 030:18-22 avisa que em Supabase hospedado a extensão pode viver no schema `extensions` e exigir comando manual.
- Não se sabe se o sidecar `cron` está rodando neste ambiente nem se `AUTOMATION_CRON_SECRET` está definido. Sem isso o keeper só roda pelo botão "Rodar agora".
- Não se sabe se alguma conta deste ambiente tem hoje dados de Vault, chunks ou guardrails.
- Não se conferiu se a `note` do guardrail é de fato renderizada no banner do inbox — só que ela entra em `ai_handoff_summary`.
- Não se conferiu a completude das traduções `en.json`/`ko.json` para as chaves `Agents.vault.*` e `Agents.guardrails.*`.
- Os testes `lint.test.ts` e `guardrails.test.ts` existem mas não foram executados.

---

## Referência

### Tabelas

| Tabela | Migração de origem | Papel para escrever | Observações |
|---|---|---|---|
| `ai_vault_sources` | `046_ai_vault.sql:45-65` | INSERT: `agent`; DELETE: `admin`; **sem policy de UPDATE** (imutável) | `kind` enum `('conversation','document','note')` (046:38-42); `ref_id` sem FK de propósito (046:49-52), para a fonte sobreviver à conversa apagada; único por `(account_id, content_hash)` (046:59) |
| `ai_vault_pages` | `046_ai_vault.sql:88-126` | INSERT/UPDATE: `agent`; DELETE: `admin` | `kind` enum `('rule','entity_customer','entity_business','concept','state')` (046:71-77); `status` enum `('draft','approved','archived')` default `draft` (046:81-85,95); `contact_id` só em `entity_customer` (046:99); único por `(account_id, slug)` (046:114); trigger de `updated_at` em 046:306-309 |
| `ai_vault_page_sources` | `046_ai_vault.sql:137-148` | Policy única FOR ALL; leitura por membro da conta da página, escrita exige `agent` (046:269-281) | Junção página↔fonte com `excerpt`; PK `(page_id, source_id)`; a tabela não tem `account_id` próprio; "pelo menos uma fonte" não é constraint — é aplicado em código (046:130-135, `store.ts:131-137`) |
| `ai_vault_links` | `046_ai_vault.sql:156-169` | Policy única FOR ALL; checa **só** a página de origem (046:288, :294) | `relation` texto livre default `mentions`; PK `(from_page_id, to_page_id, relation)`; CHECK proíbe auto-link (046:165) |
| `ai_vault_revisions` | `046_ai_vault.sql:174-192` | SELECT: membro; INSERT: `agent`; **sem UPDATE e sem DELETE** (append-only, 046:304) | `operation` é texto livre: o comentário 046:178 cita `proposed|approved|edited|rejected|archived`, e o código grava também `no_action` (`keeper.ts:127`) e `finished` (`tools.ts:292`); `actor_id` nulo quando foi o agente |
| `ai_knowledge_documents` | `030_ai_knowledge.sql:44-87` | SELECT: membro; INSERT/UPDATE/DELETE: `admin` | Um registro por texto colado pelo operador; trigger de `updated_at` em 030:83-87 |
| `ai_knowledge_chunks` | `030_ai_knowledge.sql:93-144`, alterada por `046_ai_vault.sql:203-221` | SELECT: membro; INSERT/UPDATE/DELETE: `admin` (030:135-144, nunca alteradas depois) | `document_id` nasceu NOT NULL (030:95) e teve o NOT NULL removido em 046:207-208; `vault_page_id` adicionada em 046:203-205; CHECK `num_nonnulls(document_id, vault_page_id) = 1` (046:213-217); `fts tsvector` gerada com config `simple` (030:99-106); `embedding vector(1536)` nulo quando não há chave; índices GIN em `fts` e HNSW em `embedding` — HNSW escolhido sobre IVFFlat porque bases começam vazias e IVFFlat precisa de treino (030:117-126) |
| `ai_handoff_guardrails` | `048_ai_guardrails.sql:34-94` | SELECT: membro; INSERT/UPDATE/DELETE: `admin` (048:74-88) | `kind` enum `('topic','keyword')` (048:31); `note` vai para a nota do handoff (048:44-46); `is_builtin` marca os semeados (048:49-52); único por `(account_id, kind, value)` (048:60), o que torna o re-seed um no-op; índice parcial em `(account_id, kind) WHERE is_active` (048:65-67) |
| `ai_configs.embeddings_api_key` | `030_ai_knowledge.sql:38-39` | Policies vêm da migração 029, fora deste subsistema | Coluna acrescentada aqui; guardada cifrada AES-256-GCM como a `api_key` (030:35-37); lida por `loadEmbeddingsKey` (`src/lib/ai/config.ts:112-130`) |

### Funções de banco

| Função | Assinatura | Estado final |
|---|---|---|
| `match_ai_knowledge_fts` | `(p_account_id, p_query, p_match_count)` → `(id, content, rank)` via `ts_rank` + `plainto_tsquery('simple')` | `SECURITY INVOKER` desde `032_fix_ai_knowledge_membership.sql:47-79`; `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated, service_role` (030:201-204, reafirmado em 032:83-86) |
| `match_ai_knowledge_semantic` | `(p_account_id, p_query_embedding text, p_match_count)` → `(id, content, distance)` via distância cosseno `<=>` | Idem. `p_query_embedding` é declarado `text` e convertido dentro para o PostgREST não ambiguizar o bind (030:174-178) |

### Rotas

| Método e caminho | Arquivo | Autenticação / papel | O que faz |
|---|---|---|---|
| `GET /api/ai/vault?status=&kind=` | `src/app/api/ai/vault/route.ts:21` | Sessão, qualquer membro (viewer+) | Lista até 500 páginas com join `contacts(name,phone)`, ordenadas por `updated_at desc`; filtros opcionais `status` e `kind`; devolve `draft_count` via COUNT head para o badge (route.ts:48-53) |
| `POST /api/ai/vault` | `src/app/api/ai/vault/route.ts:60` | Sessão, `agent` | Cria página à mão. Grava **primeiro** a nota humana como fonte `kind='note'` (83-88) e só então chama `createPage` com esse id, para a página nunca existir sem evidência. 201; 409 se o slug já existe |
| `GET /api/ai/vault/{id}` | `src/app/api/ai/vault/[id]/route.ts:17` | Sessão, qualquer membro | A página, suas evidências (com `excerpt` e a fonte completa) e as 20 últimas revisões daquela página |
| `PATCH /api/ai/vault/{id}` | `src/app/api/ai/vault/[id]/route.ts:62` | Sessão, `agent` | A única porta de curadoria. `status='approved'` → `approvePage` (aceita `content`/`title` do curador); `status='archived'` → `archivePage`, com `operation='rejected'` quando o corpo pede. Qualquer outro status → 400 |
| `GET /api/ai/vault/graph?drafts=1` | `src/app/api/ai/vault/graph/route.ts:31` | Sessão, qualquer membro | Nós = páginas não arquivadas (só aprovadas a menos que `drafts=1`, linha 46), limite 2000; arestas de `ai_vault_links` (limite 5000) filtradas ao conjunto visível; `degree` calculado no servidor |
| `GET /api/ai/vault/lint` | `src/app/api/ai/vault/lint/route.ts:14` | Sessão, qualquer membro | Roda `lintVault` na hora — nada é armazenado (linhas 8-11) — e devolve os achados e a contagem de `severity='warning'` |
| `GET /api/ai/vault/runs?limit=` | `src/app/api/ai/vault/runs/route.ts:25` | Sessão, qualquer membro | Histórico do keeper: revisões com `operation IN ('proposed','no_action','finished')` (linha 23); limite 1..50, padrão 20 |
| `GET /api/ai/vault/keeper` | `src/app/api/ai/vault/keeper/route.ts:28` | **Sem sessão.** Header `x-cron-secret` comparado em tempo constante com `AUTOMATION_CRON_SECRET` (33-41): 503 se a variável não existe, 401 se não bate. Depois usa service-role | Varredura do keeper em **todas** as contas. Devolve `{considered, ran, pages_proposed, skipped:{tooRecent, alreadyRead}}` |
| `POST /api/ai/vault/keeper` | `src/app/api/ai/vault/keeper/route.ts:56` | Sessão, `admin` (comentário 58-59: quem paga a conta decide quando gastar a chave). O corpo roda com service-role escopado pelo `accountId` (61-67) | Botão "Rodar agora": varre só a conta logada, mesmo payload com os motivos de cada zero |
| `GET /api/ai/guardrails` | `src/app/api/ai/guardrails/route.ts:29` | Sessão, qualquer membro | Lista ordenada por `is_builtin desc, created_at asc`. **Semeia** os 8 padrões na primeira leitura da conta quando o COUNT é zero, via upsert `onConflict 'account_id,kind,value'` com `ignoreDuplicates` (38-52). Escrita dentro de um GET, assumida no comentário 21-24 |
| `POST /api/ai/guardrails` | `src/app/api/ai/guardrails/route.ts:82` | Sessão, `admin` | Cria regra. `kind` deve ser `topic` ou `keyword`; `value` truncado em 200 caracteres, `note` em 300. 409 com `code:'duplicate'` no erro 23505 |
| `PATCH /api/ai/guardrails` | `src/app/api/ai/guardrails/route.ts:128` | Sessão, `admin` | Atualiza `is_active`, `value` e/ou `note` pelo `body.id`, sempre com `.eq('account_id', accountId)`. 400 quando nada mudaria |
| `DELETE /api/ai/guardrails?id=` | `src/app/api/ai/guardrails/route.ts:168` | Sessão, `admin` | Apaga a regra, inclusive as `is_builtin` — não há proteção no código |
| `GET /api/ai/knowledge` | `src/app/api/ai/knowledge/route.ts:19` | Sessão, qualquer membro | Lista `id`/`title`/`updated_at` dos documentos |
| `POST /api/ai/knowledge` | `src/app/api/ai/knowledge/route.ts:44` | Sessão, `admin` + rate limit `adminAction` por `userId` | Cria o documento e indexa via `ingestDocument`. Se a indexação falhar devolve 200 com `success:true` e um aviso — o documento fica salvo e buscável lexicalmente |
| `GET /api/ai/knowledge/{id}` | `src/app/api/ai/knowledge/[id]/route.ts:17` | Sessão, qualquer membro | Documento completo (`title`, `content`) |
| `PATCH /api/ai/knowledge/{id}` | `src/app/api/ai/knowledge/[id]/route.ts:41` | Sessão, `admin` + rate limit `adminAction` | Atualiza `title` e/ou `content`; re-indexa somente quando `content` mudou |
| `DELETE /api/ai/knowledge/{id}` | `src/app/api/ai/knowledge/[id]/route.ts:113` | Sessão, `admin` | Apaga o documento; os chunks caem por `ON DELETE CASCADE` |
| `POST /api/ai/knowledge/reindex` | `src/app/api/ai/knowledge/reindex/route.ts:17` | Sessão, `admin` + rate limit `adminAction` (chave `ai-kb-reindex`) | Re-fatia e re-embarca **todos** os documentos da conta. Se a chave estiver corrompida, para e avisa em vez de fazer passe lexical silencioso (39-51). Erro num documento aborta o lote e devolve quantos já foram |
| `GET /api/ai/context?conversation_id=` | `src/app/api/ai/context/route.ts:18` | Sessão, qualquer membro | Monta o preview do prompt seção por seção, incluindo `vault` (`describeVaultContext`) e `guardrails` (`describeGuardrails`) — `context-preview.ts:125,127` |
| `POST /api/ai/playground` | `src/app/api/ai/playground/route.ts:35` | Sessão, `agent` | Ensaio do agente. Usa `retrieveKnowledge` (86) e `loadVaultContext(…, contactId=null)` (107). **Não** passa guardrails (109-115) |
| `POST /api/ai/draft` | `src/app/api/ai/draft/route.ts:23` | Sessão, `agent` | Rascunho sugerido ao atendente. Usa `retrieveKnowledge` (97); **não** usa Vault nem guardrails (104-108) |
| `GET /api/ai/costs/projection` | `src/app/api/ai/costs/projection/route.ts:18` | Sessão, `admin` | Projeta o custo por resposta somando as seções reais, entre elas `vault` e `guardrails` (`cost-projection.ts:159-160`) e um `knowledge` dimensionado como 5 chunks médios da própria conta (`cost-projection.ts:230-249`) |

### Telas

| Tela (nome do menu) | Arquivo | Conteúdo |
|---|---|---|
| Agentes de IA → aba **Vault** | `src/app/(dashboard)/agents/page.tsx:34` e `:124-126`; `src/components/agents/ai-vault.tsx` | Tela de curadoria. Cinco sub-abas (`ai-vault.tsx:55` e `170-176`): Rede, Aprovação (badge âmbar com o nº de rascunhos), Páginas, Saúde (badge = nº de avisos), Keeper. Botões Aprovar / Recusar / Arquivar / Editar por página |
| Agentes de IA → Vault → sub-aba **Rede** | `src/components/agents/vault-graph.tsx` | Grafo em canvas com simulação de forças escrita à mão (sem d3). Cores por tipo em `vault-graph.tsx:51-57` (regra âmbar, cliente azul-céu, negócio violeta, conceito ardósia, estado esmeralda), cor padrão em `:59`. Checkbox "Mostrar rascunhos no grafo" repassa `?drafts=1` (`ai-vault.tsx:212-222`). Clicar num nó salta para Aprovação ou Páginas com o item expandido (`ai-vault.tsx:236-239`) |
| Agentes de IA → Vault → sub-aba **Keeper** | `src/components/agents/vault-keeper-panel.tsx` | Histórico de execuções (`GET /api/ai/vault/runs`) com ícone por operação `proposed`/`no_action`/`finished`, e o botão "Rodar agora" (`POST /api/ai/vault/keeper`). O aviso diferencia cada zero (linhas 84-95) |
| Agentes de IA → Vault → diálogo **Nova página** | `src/components/agents/vault-new-page.tsx` | Formulário: tipo, título, conteúdo → `POST /api/ai/vault`. O comentário do arquivo (42-43) e o texto da interface afirmam que a página nasce aprovada; o código grava rascunho (`store.ts:150`) |
| Agentes de IA → aba **Limites** | `src/app/(dashboard)/agents/page.tsx:35` e `:128-130`; `src/components/agents/ai-guardrails.tsx` | Duas listas — Por assunto e Por palavra — com interruptor de `is_active`, botão apagar e card de adicionar. Escrita bloqueada quando `!canEditSettings` (linha 149, modo leitura). A aba renderiza também o card de ferramentas do agente acima das listas (160-162), que é outro subsistema |
| Agentes de IA → aba **Configuração** → card **Base de conhecimento** | `page.tsx:140-142` renderiza `<AiConfig/>`; `src/components/settings/ai-config.tsx:612` renderiza `<AiKnowledgeCard/>`; `src/components/settings/ai-knowledge.tsx:28` | CRUD dos documentos e botão Reindexar. Recebe `hasEmbeddingsKey` do próprio campo de chave de embeddings do formulário (`ai-config.tsx:615-620`). É a única porta de interface da base vetorial — não aparece em Configurações |
| Agentes de IA → aba **Contexto** | `src/app/(dashboard)/agents/page.tsx:36` e `:136-138`; `src/components/agents/ai-context.tsx` | Prompt final seção por seção com contagem de tokens, incluindo `vault` e `guardrails` (`context-preview.ts:122-140`) |

### Guardrails de fábrica (`src/lib/ai/guardrails.ts:46-87`)

| Tipo | Valor | Nota que a atendente lê |
|---|---|---|
| Assunto | Reclamação, insatisfação ou pedido de reembolso | Cliente insatisfeito — atender pessoalmente antes de responder qualquer coisa. |
| Assunto | Negociação de preço, desconto ou condição de pagamento | Só uma pessoa decide preço. |
| Assunto | Orientação de saúde, diagnóstico ou interpretação de receita médica | Não é assunto de bot, em nenhuma hipótese. |
| Assunto | Assunto jurídico, cobrança ou dados pessoais de terceiros | Risco legal — encaminhar sempre. |
| Assunto | Qualquer coisa que o cliente peça para tratar com uma pessoa | Pedido explícito de humano. |
| Palavra | advogado | Menção a advogado — encaminhar imediatamente. |
| Palavra | procon | Menção ao Procon — encaminhar imediatamente. |
| Palavra | processar | Ameaça de processo — encaminhar imediatamente. |

### Arquivos-chave

| Arquivo | Papel |
|---|---|
| `src/lib/ai/vault/schema.ts` | Os cinco tipos (`VAULT_PAGE_KINDS`, 11-17), o texto de orientação de cada tipo que vai literal para o prompt do keeper (34-55), a regra de fidelidade (66-71), `buildVaultSchemaPrompt` (77-99) e o `slugify` (110-119, remove acentos por NFD, colapsa não-alfanuméricos em hífen, trunca em 80) |
| `src/lib/ai/vault/retrieve.ts` | `loadVaultContext` (53) e `describeVaultContext` (138); tetos em 20-22 |
| `src/lib/ai/vault/store.ts` | `createSource` (69), `createPage` (117), `approvePage` (205), `archivePage` (265), `indexPage` (323), `recordRevision` (352); `INDEXED_KINDS` (317) |
| `src/lib/ai/vault/keeper.ts` | `runVaultKeeper` (40), `loadPageIndex` (147), `buildKeeperPrompt` (175); `KEEPER_MAX_STEPS=8` (32) |
| `src/lib/ai/vault/tools.ts` | `buildKeeperTools` (32-39): `propose_page`, `update_page`, `link_pages`, `done`. Nenhuma aprova (comentário 18-21) |
| `src/lib/ai/vault/sweep.ts` | `sweepVault` (59); `IDLE_MINUTES=90` (28), `MAX_PER_SWEEP=10` (33), `LOOKBACK_DAYS=7` (36) |
| `src/lib/ai/vault/lint.ts` | `lintVault` (55); `STATE_STALE_DAYS=60` (43) |
| `src/lib/ai/guardrails.ts` | Arquivo único: `BUILTIN_GUARDRAILS` (46-87), `loadGuardrails` (104), `normalize` (154), `matchKeywordGuardrail` (171), `describeGuardrails` (194), `guardrailHandoffSummary` (210) |
| `src/lib/ai/knowledge.ts` | `ingestDocument` (41) e `retrieveKnowledge` (99, k=5); o tipo `ChunkOwner` (23) faz o mesmo pipeline servir documento e página de Vault |
| `src/lib/ai/chunk.ts` | `chunkText`, `DEFAULT_MAX_CHARS=1200` (11) |
| `src/lib/ai/embeddings.ts` | `embedTexts` contra `https://api.openai.com/v1/embeddings` (16), `text-embedding-3-small` (18), 1536 dims (19), lotes de 96 (23), `toVectorLiteral` para o formato do pgvector |
| `src/lib/ai/defaults.ts` | `buildSystemPrompt` (99-171): a ordem exata das seções no prompt |
| `src/lib/ai/auto-reply.ts` | O consumidor de produção: guardrails (144), match de palavra antes do modelo (150-163), conhecimento (189), Vault com `contactId` (216) |
| `src/lib/conversations/handoff.ts` | `handOffConversation` (64) — único lugar que marca `pending` / `ai_autoreply_disabled` e dispara o push; não manda mensagem ao cliente (19-22) |
| `supabase/migrations/046_ai_vault.sql` | Cria as tabelas `ai_vault_*`, os dois enums, altera `ai_knowledge_chunks` e escreve todas as policies do Vault |
| `supabase/migrations/030_ai_knowledge.sql` | `CREATE EXTENSION vector`, documentos e chunks, coluna `fts` gerada, índice HNSW e as duas funções de match |
| `supabase/migrations/032_fix_ai_knowledge_membership.sql` | Estado final das funções: `SECURITY INVOKER`, corrigindo leitura entre contas (GHSA-fg5p-2qc3-jmxr) |
| `supabase/migrations/048_ai_guardrails.sql` | Cria `ai_handoff_guardrails`, o enum `guardrail_kind` e as policies de escrita para admin |
| `deploy/docker-compose.app.yml` | O sidecar `cron` (138) que bate em `/api/ai/vault/keeper` a cada `KEEPER_EVERY_TICKS` ticks (176-185), com timeout de 900s |
| `src/lib/ai/vault/retrieve.test.ts`, `src/lib/ai/vault/lint.test.ts`, `src/lib/ai/guardrails.test.ts` | Testes do subsistema. O de `retrieve` fixa que só páginas aprovadas são lidas, que regras são descartadas inteiras e que o contexto degrada a vazio |
| `docs/ajustes-do-agente.md` | Documento voltado ao operador que descreve Agentes → Vault (linha 33) e Agentes → Guardrails (linha 43) |
