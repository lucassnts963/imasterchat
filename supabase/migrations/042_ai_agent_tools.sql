-- ============================================================
-- 042 — Agent loop: tool steps, step cap, usage mode
--
-- The AI stopped being a single call that returns text and became a
-- loop that can act (src/lib/ai/agent.ts). Three things follow from
-- that, and they are all about being able to answer "why did the bot
-- do that?" after the fact.
--
-- `ai_agent_steps` is the audit trail. One row per tool the model
-- actually ran, with the arguments IT chose and what came back. When
-- an optician opens a booking she did not expect, this is the record
-- that explains it. It is also what the Playground renders while the
-- dialogue is being tuned.
--
-- Deliberately NOT a foreign key to a "run": there is no run table,
-- and inventing one would buy nothing — the pair (conversation_id,
-- created_at) already groups a turn, and `step_index` orders it.
-- ============================================================

-- ============================================================
-- Tool audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_agent_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Nullable: the Playground has no thread, and deleting a conversation
  -- should not erase the record that the bot acted.
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,

  -- Position within the turn, so a multi-tool turn reads in order.
  step_index      integer NOT NULL,
  tool_name       text NOT NULL,
  -- What the model passed. jsonb because the shape is per-tool and we
  -- want to be able to ask questions like "which slots did it try?".
  arguments       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- What the model was told back — stored as the text it actually saw,
  -- already truncated by the loop. Reconstructing the prompt from a
  -- richer structure would risk showing something the model never read.
  result          text,
  is_error        boolean NOT NULL DEFAULT false,
  duration_ms     integer,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- "What did the bot do on this thread" — the only read pattern that
-- matters, and the one the inbox and Playground both make.
CREATE INDEX IF NOT EXISTS idx_ai_agent_steps_conversation
  ON public.ai_agent_steps (conversation_id, created_at DESC);
-- "What went wrong across the account this week" — for diagnosing a
-- tool that started failing, without scanning every row.
CREATE INDEX IF NOT EXISTS idx_ai_agent_steps_account_created
  ON public.ai_agent_steps (account_id, created_at DESC);

ALTER TABLE public.ai_agent_steps ENABLE ROW LEVEL SECURITY;

-- Member-wide read, unlike ai_usage_log's admin-only: this is
-- operational, not billing. The attendant who takes over a thread is
-- exactly the person who needs to see what the bot already tried.
DROP POLICY IF EXISTS ai_agent_steps_select ON public.ai_agent_steps;
CREATE POLICY ai_agent_steps_select ON public.ai_agent_steps FOR SELECT
  USING (public.is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policies on purpose. Writes come from the
-- service-role client in the auto-reply path (which has no auth.uid()),
-- and an audit trail nobody can edit from the dashboard is the point.

-- ============================================================
-- Per-account step cap
--
-- How many provider round-trips one reply may take before the loop
-- gives up and hands off. A FAQ bot never needs more than a couple; a
-- booking dialogue that checks availability, books, and confirms needs
-- room. NULL = fall back to AI_MAX_TOOL_STEPS, then the built-in 6.
-- ============================================================
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS max_tool_steps integer
    CHECK (max_tool_steps IS NULL OR (max_tool_steps > 0 AND max_tool_steps <= 20));

-- ============================================================
-- Usage mode: 'agent'
--
-- A run that used tools costs several provider calls, not one. Logging
-- it as 'auto_reply' would quietly make the per-reply cost look like it
-- tripled overnight. A distinct mode keeps the loop's cost separable
-- from a plain reply's — which is the number to watch when deciding
-- whether autonomous booking pays for itself.
-- ============================================================
ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'agent'));
