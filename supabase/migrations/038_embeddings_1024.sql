-- ============================================================
-- 038_embeddings_1024.sql — retarget the knowledge base to 1024 dims
--
-- Migration 030 sized the vector column for OpenAI's
-- text-embedding-3-small (1536). That number, hard-coded in three
-- places, is what pinned semantic search to a single vendor: no open
-- embedding model emits 1536, so "bring your own embeddings provider"
-- could not actually be honoured.
--
-- 1024 is where the good open multilingual models sit natively —
-- `baai/bge-m3` and `intfloat/multilingual-e5-large` — and this CRM's
-- knowledge bases are mostly not in English. The lexical fallback runs
-- Postgres' language-neutral 'simple' config (no stemming, no
-- stopwords), so non-English accounts lean hardest on the semantic path,
-- which was exactly the path stuck on the weakest multilingual model.
-- Models with Matryoshka support (text-embedding-3-*) still work: the
-- client sends `dimensions: 1024`.
--
-- pgvector's HNSW index caps at 2000 dimensions, so 1024 and 1536 are
-- both indexable but the 3072-dim tier is not — worth knowing before
-- anyone "upgrades" to a larger model and silently loses the index.
--
-- ============================================================
-- ⚠️  DESTRUCTIVE TO A DERIVED COLUMN — READ BEFORE RUNNING
--
-- This discards every stored embedding. It does NOT lose data:
-- `ai_knowledge_chunks` is derived from `ai_knowledge_documents`, which
-- is untouched, and `POST /api/ai/knowledge/reindex` rebuilds the whole
-- thing from those documents.
--
-- Chunk rows are kept and only the vector is nulled (rather than
-- deleting and re-chunking here), so LEXICAL search keeps answering
-- during the window between this migration and the reindex. The
-- assistant degrades, it does not go dark.
--
-- If you are running this on an install with an existing knowledge base:
--   1. apply this migration
--   2. call POST /api/ai/knowledge/reindex (admin) for each account
-- Until step 2, `retrieveKnowledge` finds no vectors and falls back to
-- full-text search on its own — the same path accounts without an
-- embeddings key have always used.
-- ============================================================

-- The index must go before the type change; it is rebuilt below.
DROP INDEX IF EXISTS ai_knowledge_chunks_embedding_idx;

ALTER TABLE ai_knowledge_chunks
  ALTER COLUMN embedding TYPE vector(1024) USING NULL::vector(1024);

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_embedding_idx
  ON ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- The dimension is written into the function body twice — once in the
-- SELECT list and once in the ORDER BY. Altering the column without
-- replacing the function leaves every semantic query failing on a
-- dimension mismatch, so the two travel together.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id      uuid,
  p_query_embedding text,
  p_match_count     integer
)
RETURNS TABLE (id uuid, content text, distance real) AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1024)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1024)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- CREATE OR REPLACE resets neither ownership nor grants, but 030's
-- lockdown is repeated here so the function is never briefly reachable
-- by the anon role if it is ever created fresh from this file.
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer)
  TO authenticated, service_role;
