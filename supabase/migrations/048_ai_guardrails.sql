-- ============================================================
-- 048 — Guardrails: when the agent must stop and call a person
--
-- The agent already has `request_human` and a prompt telling it to
-- prefer handing off over guessing. What it does not have is the
-- shop's own list of subjects it must never handle — and "never" is
-- not something a prompt written once by us can know: a complaint is
-- off-limits everywhere, but "convênio", "receita médica" or
-- "desconto" are the optician's call, not ours.
--
-- Two kinds, because they are enforced in genuinely different ways:
--
--   topic    — described in words, injected into the prompt. Flexible,
--              catches paraphrase, and is a SUGGESTION: the model
--              decides whether the customer is on that subject.
--
--   keyword  — matched against the incoming message in code, BEFORE
--              the model runs. Rigid, blind to paraphrase, and
--              certain: a match hands off without a provider call, so
--              it cannot be talked out of it.
--
-- Both exist because neither is enough. The same "prompt plus a check"
-- split the scheduling feature uses, for the same reason: a rule that
-- only lives in a prompt is a rule the model can decide it does not
-- apply this time.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.guardrail_kind AS ENUM ('topic', 'keyword');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ai_handoff_guardrails (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind       public.guardrail_kind NOT NULL,

  -- For `topic`, the subject in the shop's own words ("negociação de
  -- desconto"). For `keyword`, the term to match, case- and
  -- accent-insensitively, on word boundaries.
  value      text NOT NULL,
  -- Optional: what the attendant should know when this fires. Ends up
  -- in the handoff note, which is what they read before opening the
  -- thread.
  note       text,

  is_active  boolean NOT NULL DEFAULT true,
  -- True for the ones seeded from our defaults. The operator may edit
  -- or switch them off — the flag exists so the UI can say "this came
  -- with the product" and so re-seeding never duplicates them.
  is_builtin boolean NOT NULL DEFAULT false,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One rule per phrase per kind. Re-seeding defaults is then a no-op
  -- rather than a growing pile of identical rules.
  CONSTRAINT ai_handoff_guardrails_unique UNIQUE (account_id, kind, value)
);

-- The read the auto-reply path makes on every inbound message: active
-- rules for this account. Small tables, but it is the hot path.
CREATE INDEX IF NOT EXISTS idx_ai_handoff_guardrails_active
  ON public.ai_handoff_guardrails (account_id, kind)
  WHERE is_active;

ALTER TABLE public.ai_handoff_guardrails ENABLE ROW LEVEL SECURITY;

-- Settings-class, like ai_configs: any member may see the rules the bot
-- follows; only admin+ may change what the bot is allowed to handle.
DROP POLICY IF EXISTS ai_handoff_guardrails_select ON public.ai_handoff_guardrails;
CREATE POLICY ai_handoff_guardrails_select ON public.ai_handoff_guardrails
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS ai_handoff_guardrails_insert ON public.ai_handoff_guardrails;
CREATE POLICY ai_handoff_guardrails_insert ON public.ai_handoff_guardrails
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_handoff_guardrails_update ON public.ai_handoff_guardrails;
CREATE POLICY ai_handoff_guardrails_update ON public.ai_handoff_guardrails
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_handoff_guardrails_delete ON public.ai_handoff_guardrails;
CREATE POLICY ai_handoff_guardrails_delete ON public.ai_handoff_guardrails
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_ai_handoff_guardrails_updated_at
  ON public.ai_handoff_guardrails;
CREATE TRIGGER set_ai_handoff_guardrails_updated_at
  BEFORE UPDATE ON public.ai_handoff_guardrails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
