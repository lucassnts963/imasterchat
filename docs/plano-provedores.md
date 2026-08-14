# Plano — abrir os provedores de modelo (M-1, M-2, M-4 + embeddings)

> Fecha os itens `M-1`, `M-2`, `M-4` de [`analise-deskcommcrm.md`](./analise-deskcommcrm.md)
> e a opção **C** de [`analise-embeddings.md`](./analise-embeddings.md).
>
> **Premissa confirmada:** não há base de conhecimento com dados. O deploy na VPS
> ainda não aconteceu. Isso torna a mudança de dimensão gratuita — e é por isso
> que ela entra agora, junto, em vez de virar migração coordenada depois.

---

## 1. A ideia central

Hoje o código pensa em **provedor**. Deveria pensar em **formato de fio**.

Existem só dois formatos no nosso código: *OpenAI chat-completions* e
*Anthropic messages*. DeepSeek, Groq, Together, Fireworks, DeepInfra e
OpenRouter são todos o primeiro formato apontando para outra URL. Então:

```
provedor  →  (formato de fio, base_url, modelo padrão)
             ↓
       adapter existente
```

`providers/openai.ts` e `providers/anthropic.ts` continuam sendo os dois únicos
adapters. Nenhum adapter novo é escrito neste plano.

---

## 2. O catálogo de provedores

Arquivo novo: **`src/lib/ai/providers/catalog.ts`**. É a lista única — o que a
tela oferece e o que o dispatch executa saem daqui, para não divergirem.

```ts
export type WireFormat = 'openai' | 'anthropic'

export interface ProviderPreset {
  id: string
  label: string
  wire: WireFormat
  baseUrl: string
  defaultModel: string
  keyPlaceholder: string
  keysUrl: string
  /** Uma frase sobre quando escolher este. */
  whenToUse: string
  /** null = o provedor não serve embeddings. */
  embeddings: { baseUrl: string; defaultModel: string } | null
}
```

Provedores da primeira leva:

| id | Formato | Embeddings | Nota |
|---|---|---|---|
| `openai` | openai | ✅ | como hoje |
| `anthropic` | anthropic | — | como hoje |
| `deepseek` | openai | **não** | confirmado: sem endpoint de embeddings |
| `openrouter` | openai | ✅ | **uma chave cobre chat + embeddings** |
| `groq` | openai | não | inferência rápida |
| `together` | openai | ✅ | modelos abertos |
| `deepinfra` | openai | ✅ | serve `BAAI/bge-m3` (1024 dims) |
| `fireworks` | openai | — | |
| `custom` | openai | — | `base_url` digitada pelo operador |

> **Verificar na implementação:** confirmei em fonte primária o DeepSeek (não
> tem embeddings), a OpenRouter (tem, formato OpenAI) e a DeepInfra (bge-m3,
> 1024 dims, API compatível). As **base URLs e os IDs de modelo padrão dos
> demais** eu não verifiquei um a um — eles mudam, e um preset errado vira erro
> de conexão na cara do operador. Confirmar cada um antes do merge.
>
> O campo `model` permanece **texto livre na tela**, como já é hoje
> (`defaults.ts:8-12` explica o porquê: IDs de modelo mudam rápido). Preset é
> ponto de partida, nunca allow-list.

---

## 3. Banco

### Migration `037_ai_open_providers.sql`

```sql
-- 1. provider deixa de ser enum de dois valores e vira vocabulário aberto.
--    A garantia de que a tela não oferece opção inválida passa para
--    src/lib/ai/providers/catalog.ts; o dispatch falha com erro tipado.
--    Nome da constraint resolvido em runtime — não confiar no auto-nome.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'ai_configs'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE ai_configs DROP CONSTRAINT %I', c);
  END LOOP;

  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'ai_usage_log'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE ai_usage_log DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

-- 2. Endpoint próprio. NULL = usar a base_url do preset.
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS base_url            text;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS embeddings_base_url text;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS embeddings_model    text;
```

Não há backfill: `provider` e `model` existentes seguem válidos, e `base_url`
nulo já significa "use o preset". A migration é aditiva e idempotente.

### Migration `038_embeddings_1024.sql`

```sql
-- Alvo passa a ser 1024 — a dimensão de bge-m3 e multilingual-e5-large,
-- os modelos abertos que entendem português de verdade. O HNSW do pgvector
-- suporta até 2000 dims, então 1024 e 1536 cabem; 3072 não.
DROP INDEX IF EXISTS ai_knowledge_chunks_embedding_idx;

-- USING NULL em vez de DELETE: os chunks continuam existindo, então a busca
-- LEXICAL segue funcionando durante a janela entre esta migration e o reindex.
-- Só o vetor é descartado — e ele é derivável de ai_knowledge_documents.
ALTER TABLE ai_knowledge_chunks
  ALTER COLUMN embedding TYPE vector(1024) USING NULL::vector(1024);

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_embedding_idx
  ON ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- O cast literal aparece DUAS vezes na função — no SELECT e no ORDER BY.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id      uuid,
  p_query_embedding text,
  p_match_count     integer
)
RETURNS TABLE (id uuid, content text, distance real) AS $$
  SELECT c.id, c.content,
         (c.embedding <=> p_query_embedding::vector(1024)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1024)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer)
  TO authenticated, service_role;
```

> **Para nós é inócua** (zero linhas). Para um fork que já tenha KB embedada,
> ela zera os vetores e exige um `POST /api/ai/knowledge/reindex` — que já
> existe e foi feito exatamente para isso. Isso vai no cabeçalho da migration,
> em texto, não só aqui.

---

## 4. Código, arquivo por arquivo

### PR 1 — dispatch por formato de fio (`M-1` + `M-2`)

| Arquivo | Mudança |
|---|---|
| `providers/catalog.ts` | **novo** — presets + `getPreset(id)` + `resolveBaseUrl(config)` |
| `types.ts:9` | `AiProvider` deixa de ser união de dois literais e vira `string`; `AiConfig` ganha `baseUrl`, `embeddingsBaseUrl`, `embeddingsModel` |
| `providers/shared.ts:7` | `ProviderArgs` ganha `baseUrl: string` |
| `providers/openai.ts:11,32` | `OPENAI_URL` sai; usa `${baseUrl}/chat/completions` |
| `providers/anthropic.ts:11,47` | idem, `${baseUrl}/messages` |
| `generate.ts:37-49` | `switch (config.provider)` → `switch (preset.wire)`; preset desconhecido continua caindo no `AiError('unsupported_provider')` que já existe |
| `defaults.ts:13-16` | `AI_PROVIDER_DEFAULT_MODEL` derivado do catálogo |
| `config.ts:5-18` | linha e `CONFIG_COLUMNS` incluem as três colunas novas |

Sem mudança de UI neste PR — a tela segue oferecendo dois provedores, e tudo
continua funcionando. É deliberado: se algo quebrar, quebra aqui, com o
comportamento antigo ainda selecionado.

### PR 2 — validação de chave por ping (`M-4`)

Arquivo novo `providers/validate-key.ts`: `GET {baseUrl}/models` com timeout de
5 s, distinguindo 401/403 de erro de rede, devolvendo a lista de modelos que a
chave enxerga.

Ganho concreto sobre o que temos: hoje `validate.ts` valida gerando uma
resposta de verdade — gasta tokens e falha se o *modelo* estiver errado, mesmo
com a chave certa, sem dizer qual dos dois é o problema. O ping separa as duas
perguntas. Anthropic também expõe `/v1/models`, então serve para os dois
formatos.

`validateAiCredentials` passa a: ping primeiro (chave), geração depois
(modelo) — com mensagens distintas.

### PR 3 — tela

| Arquivo | Mudança |
|---|---|
| `settings/ai-config.tsx:42-48` | `PROVIDER_LABEL` e `KEY_PLACEHOLDER` saem; vêm do catálogo |
| `:280-282` | `<SelectItem>` gerado por `map` sobre os presets, com `whenToUse` como descrição |
| — | campo **URL do endpoint**, visível quando `provider === 'custom'` ou sob "avançado" |
| — | link "onde pegar a chave" por provedor |
| `messages/en.json` · `ko.json` | chaves novas |
| `api/ai/config/route.ts:81` | valida contra o catálogo em vez do `if` de dois valores |

### PR 4 — embeddings configuráveis + dimensão 1024

| Arquivo | Mudança |
|---|---|
| `embeddings.ts:16-19` | URL e modelo viram parâmetros; `EMBEDDING_DIMENSIONS = 1024` |
| `embeddings.ts:41` | `embedTexts(cfg, inputs)` onde `cfg = { apiKey, baseUrl, model }` |
| `knowledge.ts:55,113` | passa a config de embeddings em vez da chave solta |
| `config/route.ts:187` | **guarda de dimensão** (abaixo) |
| `types.ts:29` | corrigir o comentário que diz "OpenAI-compatible" — agora é verdade |
| migration `038` | acima |

**A guarda de dimensão** é a peça que evita a falha silenciosa. O probe de
validação já existe; falta uma linha de asserção:

```ts
const [probe] = await embedTexts(embCfg, ['ping'])
if (probe.length !== EMBEDDING_DIMENSIONS) {
  return bad(
    `Esse modelo devolve vetores de ${probe.length} dimensões e a base está ` +
    `configurada para ${EMBEDDING_DIMENSIONS}. Escolha um modelo de ` +
    `${EMBEDDING_DIMENSIONS} dimensões (ex.: BAAI/bge-m3).`
  )
}
```

Sem isso, um modelo de dimensão errada só falha lá na frente, no insert do
Postgres, no meio de um reindex — com mensagem que não ajuda ninguém.

---

## 5. Testes

Os arquivos já existem; é ampliar.

| Arquivo | O que cobrir |
|---|---|
| `generate.test.ts` | preset `openai`/`deepseek`/`groq` batem no `baseUrl` certo com o mesmo adapter; `anthropic` mantém o formato dele; provider fora do catálogo → `AiError('unsupported_provider')` |
| `catalog.test.ts` **novo** | todo preset tem `wire` que existe; `embeddings: null` para quem não serve; ids únicos |
| `embeddings.test.ts` | `baseUrl` e modelo respeitados; resposta com dimensão errada é recusada com mensagem |
| `config.test.ts` | as três colunas novas carregam e decifram; `base_url` nulo cai no preset |

Um teste que vale a pena, no espírito do `pontos-de-ia-completude` deles: **um
teste que falha se alguém adicionar preset sem entrada correspondente no
dispatch**. Barato agora, evita o par que diverge em silêncio.

---

## 6. Ordem e sequenciamento com o deploy

```
037 + PR 1 ──► PR 2 ──► PR 3 ──► 038 + PR 4 ──► deploy VPS
   (dispatch)   (ping)   (tela)   (embeddings)
```

Duas regras de sequenciamento:

1. **`038` precisa entrar antes do primeiro deploy com uso real.** Enquanto a
   base está vazia ela é gratuita; no dia em que a primeira conta colar um
   documento e embedar, ela vira migração com reindex. É a única parte deste
   plano com prazo.
2. **PR 1 sozinho já é seguro em produção.** Ele não muda comportamento
   nenhum — só troca constante por config, mantendo os dois provedores atuais
   selecionados. Se você quiser subir a VPS antes do resto, pode.

---

## 7. O que este plano deliberadamente não faz

- **Múltiplas credenciais por conta (`M-3`).** Continua uma chave de chat e uma
  de embeddings por conta. É o próximo passo natural, mas não é pré-requisito.
- **Catálogo de modelos sincronizado, custo e orçamento (`M-5`…`M-7`).** Bloco
  próprio, coerente entre si, sem dependência deste.
- **Modelo por ponto de uso (`M-9`).** Depende deste plano; vem depois.
- **pt-BR (`P-13`).** Independente e barato — as strings novas de tela deste
  plano vão nascer em `en.json`, então fazer o pt-BR *depois* custa o mesmo que
  fazer junto. Só não deixe passar do deploy, porque o operador é brasileiro.

---

## 8. Estimativa

| PR | Escopo | Estimativa |
|---|---|---|
| 1 | catálogo + dispatch por wire + `base_url` + migration 037 | 1 dia |
| 2 | validação por ping | ½ dia |
| 3 | tela | 1 dia |
| 4 | embeddings configuráveis + 1024 + guarda de dimensão + migration 038 | 1 dia |

**~3,5 dias**, com os quatro PRs independentes o suficiente para revisar
separado.

---

## 9. Antes de eu começar

Duas confirmações:

1. **Quais provedores entram na primeira leva?** A lista da §2 são nove. Se
   você só quer OpenAI, Anthropic, DeepSeek, OpenRouter e `custom`, o PR 3
   encolhe e a verificação de base URLs também.
2. **`bge-m3` na DeepInfra é o alvo de embeddings, ou a OpenRouter?** As duas
   servem 1024. A OpenRouter tem a vantagem de ser a mesma chave do chat; a
   DeepInfra tende a sair mais barata. Não muda o código — muda só o preset
   padrão que a tela sugere.
