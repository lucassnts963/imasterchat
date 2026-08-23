-- ============================================================
-- 073_ai_open_providers.sql — provider becomes open vocabulary
--
-- Migration 029 pinned `provider` to ('openai', 'anthropic') with a
-- CHECK, and 033 repeated the same CHECK on the usage log. That made
-- every new provider a migration, and it made DeepSeek / OpenRouter /
-- any OpenAI-compatible host impossible to configure at all — even
-- though the existing OpenAI adapter already speaks their wire format
-- and only needed a different origin.
--
-- The guarantee that the settings screen never offers an unusable
-- provider moves to `src/lib/ai/providers/catalog.ts`, and the guarantee
-- that an unusable provider never executes moves to `generateReply`,
-- which throws a typed AiError. A constraint violation here would have
-- surfaced to the operator as a 500 with no explanation; a typed error
-- says which provider and what to do.
--
-- Also adds the three columns that make an endpoint configurable:
--   base_url             — chat origin override (gateway / local model)
--   embeddings_base_url  — embeddings origin, independent of chat
--   embeddings_model     — embeddings model, independent of chat
--
-- Embeddings are a separate axis on purpose: Anthropic and DeepSeek
-- have no embeddings endpoint at all, so those accounts must be able to
-- point semantic search at a different provider entirely.
--
-- Additive and idempotent — no backfill needed. Existing rows keep their
-- provider and model, and a NULL base_url already means "use the
-- catalog's default origin for this provider".
-- ============================================================

-- Constraint names are resolved at runtime rather than assumed: 029 and
-- 033 declared these inline, so the names are whatever Postgres derived,
-- and a hard-coded DROP CONSTRAINT would silently no-op on a database
-- that named them differently (leaving the column still pinned).
DO $$
DECLARE
  t text;
  c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_configs', 'ai_usage_log'] LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    FOR c IN
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = t::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%provider%'
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c);
      RAISE NOTICE 'dropped provider CHECK %.%', t, c;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS base_url            text;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS embeddings_base_url text;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS embeddings_model    text;

COMMENT ON COLUMN ai_configs.base_url IS
  'Chat endpoint origin, no trailing slash. NULL = use the provider preset in src/lib/ai/providers/catalog.ts. Set for a gateway, a self-hosted model, or the "custom" provider.';
COMMENT ON COLUMN ai_configs.embeddings_base_url IS
  'Embeddings endpoint origin. Independent of the chat provider — Anthropic and DeepSeek have no embeddings endpoint, so those accounts point this elsewhere.';
COMMENT ON COLUMN ai_configs.embeddings_model IS
  'Embeddings model id. Must return vectors of the dimension the knowledge base is built for (see migration 074); the config route rejects a mismatch at save time.';
