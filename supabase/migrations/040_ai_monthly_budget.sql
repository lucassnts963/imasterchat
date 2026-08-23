-- ============================================================
-- 040 — AI monthly budget
--
-- The AI assistant is BYO-key: each account pays OpenAI/Anthropic
-- directly, and neither provider exposes a "remaining balance" API.
-- So the app tracks spend itself: `ai_usage_log` (033) already
-- records tokens per call, and the dashboard estimates month-to-date
-- cost from published per-model prices (src/lib/ai/pricing.ts).
--
-- This adds the other half of that picture: an optional per-account
-- monthly budget in USD (the currency both providers bill in). The
-- dashboard cost card compares month-to-date estimated spend against
-- it and warns as the budget nears exhaustion. NULL = no budget set;
-- nothing is enforced — the budget is a signal, not a circuit
-- breaker (an auto-reply that suddenly stops mid-conversation would
-- be worse than a warning).
--
-- RLS: no change needed. `ai_configs` SELECT is member-wide and
-- INSERT/UPDATE/DELETE are admin+ (029), which is exactly the
-- read/write split a budget needs.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS monthly_budget_usd numeric(10, 2)
    CHECK (monthly_budget_usd IS NULL OR monthly_budget_usd > 0);
