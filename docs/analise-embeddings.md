# Embeddings — situação atual e a decisão

> Levantamento do que existe hoje no nosso código, do que os provedores
> realmente oferecem (verificado, não de memória), e das opções reais.
> Complementa a §B.3 de [`analise-deskcommcrm.md`](./analise-deskcommcrm.md).

---

## 1. Como funciona hoje

### 1.1 O desenho é melhor do que a §B.3 deixou parecer

A base de conhecimento tem **recuperação híbrida com degradação graciosa em
três níveis**, e isso muda o tamanho do problema:

| Situação | O que acontece |
|---|---|
| Conta **sem** chave de embeddings | Busca lexical pura (Postgres FTS, `ts_rank`). Funciona para todo mundo, sem credencial nenhuma |
| Conta **com** chave | Semântico primeiro (cosseno), **completado** com lexical até fechar `k` resultados |
| Chave configurada mas a chamada **falha** | `console.error` e cai no lexical. Nunca lança para o caminho de resposta |

Está em `src/lib/ai/knowledge.ts:110-146`. As consequências para a decisão são
grandes:

- **Embeddings nunca foi dependência dura.** É melhoria, não requisito. Se
  amanhã a OpenAI cair, o assistente continua respondendo com busca lexical.
- **Não bloqueia nada.** Podemos fazer `M-1`/`M-2`/`M-4` (chat multi-provedor)
  sem tocar em uma linha de embeddings, e nada quebra.

Há também um atalho de custo bem feito em `knowledge.ts:98-106`: antes de
qualquer coisa, um `COUNT` indexado verifica se a conta tem KB. Sem KB, não
paga chamada de embedding nenhuma no caminho quente.

### 1.2 Os três pontos de acoplamento à OpenAI

O acoplamento é menor do que parece — **três lugares**, não espalhado:

| # | Onde | O que está fixo |
|---|---|---|
| 1 | `src/lib/ai/embeddings.ts:16-19` | `OPENAI_EMBEDDINGS_URL` hard-coded, `EMBEDDING_MODEL = 'text-embedding-3-small'`, `EMBEDDING_DIMENSIONS = 1536` |
| 2 | `030_ai_knowledge.sql:107` + `:125` | Coluna `embedding vector(1536)` e índice HNSW sobre ela |
| 3 | `030_ai_knowledge.sql:187` e `:191` | A RPC `match_ai_knowledge_semantic` faz `::vector(1536)` **duas vezes**, literal no SQL |

O ponto 3 é o mais fácil de esquecer numa migração de dimensão. Não basta
alterar a coluna: a função de busca também carrega o número.

### 1.3 Uma imprecisão que vale corrigir de graça

Tanto o tipo (`src/lib/ai/types.ts:29`) quanto a migration (`030:35`) dizem que
a chave é *"OpenAI-compatible"*. **Não é** — com a URL hard-coded, ela só
funciona com a OpenAI mesmo. É intenção documentada que nunca foi implementada.
O `M-2` (base_url configurável) torna a frase verdadeira sem trabalho extra.

### 1.4 O dado que baixa o risco de tudo

**Chunks são artefato derivado. Documentos são a fonte.**

`ai_knowledge_documents` guarda o texto que o usuário colou.
`ai_knowledge_chunks` é inteiramente reconstruível a partir dele — e a rota
`POST /api/ai/knowledge/reindex` já faz exatamente isso: relê todos os
documentos, re-chunka e re-embeda (`reindex/route.ts:54-73`), documento por
documento, tolerando falha parcial.

Ou seja: **trocar de modelo de embedding não perde dado nenhum.** O pior caso é
um reindex. A infraestrutura para isso já está escrita e testada — foi feita
para o caso "adicionei a chave depois", que é o mesmo movimento.

---

## 2. O que os provedores realmente oferecem

Verifiquei, porque minha suposição anterior estava errada em dois pontos.

### 2.1 DeepSeek não tem embeddings

Confirmado na issue [#1124 do repo oficial DeepSeek-V3](https://github.com/deepseek-ai/DeepSeek-V3/issues/1124):
a tabela de comparação do próprio pedido marca **❌ Embedding API** para o
DeepSeek, e a issue foi fechada como *not planned*.

> Isso importa para o seu plano: o provedor que você mais quer para chat **não
> resolve embeddings**. Os dois eixos precisam de credenciais diferentes.

O mesmo vale para os serverless focados em velocidade de inferência de chat —
eles servem chat e áudio, não embeddings. **Chat e embeddings são listas de
provedores diferentes.**

### 2.2 A OpenRouter passou a ter embeddings — e isso muda a recomendação

Eu tinha registrado que a OpenRouter era só chat. Não é mais: ela padronizou um
endpoint `/api/v1/embeddings`, **no formato da OpenAI**, servindo modelos de
vários fabricantes — `text-embedding-3-small`, `Qwen3 Embedding 8B` e outros.
([anúncio](https://openrouter.ai/blog/insights/every-modality-one-api/) ·
[coleção de modelos](https://openrouter.ai/collections/embedding-models))

Consequência prática: **uma chave OpenRouter cobre chat e embeddings**, os dois
por base_url compatível. É o caminho de menor atrito para o que você quer.

### 2.3 Os modelos abertos convergiram em 1024 dimensões

A DeepInfra serve embeddings [pela API compatível com a OpenAI](https://deepinfra.com/models/embeddings),
e os dois modelos abertos que interessam para nós têm a **mesma** dimensão:

| Modelo | Dims | Contexto | Idiomas |
|---|---|---|---|
| [`BAAI/bge-m3`](https://deepinfra.com/BAAI/bge-m3/api) | **1024** | 8192 tokens | 100+ |
| [`intfloat/multilingual-e5-large`](https://deepinfra.com/intfloat/multilingual-e5-large) | **1024** | 512 tokens | 100 |
| `text-embedding-3-small` (atual) | 1536 | 8191 tokens | multilíngue fraco |

**1024 é o padrão de fato dos bons modelos abertos multilíngues.** Se formos
escolher uma dimensão-alvo para o mundo aberto, é essa.

### 2.4 A restrição técnica que ninguém lembra

O índice HNSW do pgvector **suporta no máximo 2000 dimensões**. O tipo `vector`
vai a 16.000, mas o índice não. Então:

- 1024 (bge-m3, e5-large) → ok
- 1536 (atual) → ok
- 3072 (`text-embedding-3-large` na dimensão cheia) → **não indexa com HNSW**

Vale saber antes de alguém "melhorar" para o modelo grande da OpenAI e
descobrir que a busca virou varredura sequencial.

### 2.5 Uma saída que existe: dimensão truncável

Os modelos `text-embedding-3-*` da OpenAI aceitam um parâmetro `dimensions` que
trunca o vetor (Matryoshka) — dá para pedir o modelo grande em 1536, ou o
pequeno em 1024. Alguns abertos também suportam. Mas **`bge-m3` e
`multilingual-e5-large` são 1024 fixos**, então isso não é uma ponte universal;
é um recurso a considerar se um dia quisermos uma dimensão única para todos.

---

## 3. O argumento que eu não tinha feito: qualidade em português

Custo não é o motivo para mudar. A conta é irrisória dos dois lados —
`text-embedding-3-small` custa ~US$ 0,02 por milhão de tokens; uma base de 500
documentos de 1200 caracteres dá cerca de 150 mil tokens, ou **menos de um
centavo** para indexar tudo. Custo não deve pesar nesta decisão.

O motivo real é **qualidade de recuperação em pt-BR**. O
`text-embedding-3-small` é um modelo multilíngue fraco; `bge-m3` e
`multilingual-e5-large` foram treinados explicitamente para 100+ idiomas e são
bem melhores em português.

E aqui há um agravante do nosso lado que torna isso mais relevante do que
parece: nossa busca lexical usa a configuração `'simple'` do Postgres
(`030:106`), escolhida de propósito para ser neutra de idioma — ela **não faz
stemming nem remove stopwords em português**. O comentário na migration admite
isso e diz que contas que querem casamento por morfologia ou paráfrase devem
adicionar uma chave de embeddings.

> Traduzindo: para uma operação brasileira, o caminho lexical é o mais fraco
> justamente onde o português mais precisa — e o caminho semântico está preso ao
> modelo que menos entende português. Trocar o modelo de embedding é um ganho de
> qualidade, não uma concessão à abertura.

---

## 4. A variável que decide tudo: quanto dado existe hoje

Esta é a pergunta que fecha a decisão, e você é quem sabe:

**Existe base de conhecimento em produção com dados reais?**

- **Não (deploy novo na VPS)** → o custo de escolher a dimensão é **zero**.
  Escolha 1024 agora, antes de subir, e nunca mais toque no assunto. Esta é a
  janela barata, e ela fecha no dia do deploy.
- **Sim, pouca coisa** → `ALTER TABLE` + recriar índice + `POST /reindex`.
  Minutos. Nenhum dado perdido, porque os documentos são a fonte.
- **Sim, muita coisa em várias contas** → aí sim vale a coluna por dimensão, ou
  aceitar reindex agendado por conta.

---

## 5. As opções, revisadas

| # | Opção | O que muda | Custo | Quando faz sentido |
|---|---|---|---|---|
| **A** | **Não mexer agora** | Nada. Chat abre com `M-1`/`M-2`/`M-4`; embeddings segue OpenAI ou lexical | Zero | Se quiser destravar chat esta semana sem abrir outra frente |
| **B** | **`base_url` + modelo configuráveis, mantendo 1536** | Ponto 1 da §1.2 vira config. Aceita qualquer modelo de 1536 dims (OpenRouter servindo `text-embedding-3-small`, etc.) | Pequeno | Tira o lock-in da OpenAI sem tocar em banco. Mas **não** libera `bge-m3` |
| **C** | **B + mudar a dimensão-alvo para 1024** | Ponto 1, 2 e 3. `ALTER TABLE`, recriar HNSW, corrigir o cast da RPC, reindex | Pequeno **se não houver dado**; médio se houver | Libera os modelos abertos multilíngues. **Ganho real de qualidade em pt-BR** |
| **D** | **Dimensão por documento** (coluna/índice por dimensão) | Schema genérico, várias colunas ou tabela por dimensão | Grande | Só se um dia formos multi-tenant com contas escolhendo modelos diferentes |

---

## 6. Recomendação

**Faça A agora e C junto, se a base estiver vazia.**

O raciocínio:

1. **Embeddings não bloqueia o chat.** Solte `M-1`/`M-2`/`M-4` já — é o que você
   pediu primeiro e não depende disto.
2. **Se não há dado em produção, C custa quase o mesmo que B** e entrega bem
   mais: acesso aos modelos abertos e um ganho concreto de qualidade em
   português. A diferença entre B e C é uma migration de três linhas *hoje*, e
   uma migração com reindex coordenado *depois*.
3. **Uma chave OpenRouter cobre os dois eixos.** Chat e embeddings pelo mesmo
   cadastro, ambos por base_url — é a configuração mais simples de explicar para
   quem for instalar.
4. **D não entra agora.** É a resposta certa para um problema que ainda não
   temos, e o custo dela não se justifica antes de existir mais de uma conta
   querendo modelos diferentes.

Concretamente, `C` é: tornar URL e modelo configuráveis em `embeddings.ts`,
`ALTER TABLE ai_knowledge_chunks ALTER COLUMN embedding TYPE vector(1024)`,
recriar o índice HNSW, trocar os dois `::vector(1536)` da RPC, e rodar o reindex
que já existe. Mais a lista de presets de embedding na tela, espelhando a de
chat.

**O que eu preciso de você para fechar:** existe base de conhecimento com dados
reais hoje? Se a resposta for "não, vou subir agora", o caminho é C e a janela é
antes do deploy.
