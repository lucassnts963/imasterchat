-- ============================================================
-- 047 — Usage mode: 'playground'
--
-- The Playground has always spent the account's own provider key and
-- never recorded it, so the cost screen understated real spend and the
-- operator had no way to see it. That mattered little when a test was
-- one call; with the agent loop a single rehearsed booking dialogue is
-- several calls per turn, and tuning a dialogue is dozens of turns.
--
-- A distinct mode rather than folding it into 'auto_reply', for the same
-- reason 'agent' is distinct: mixing rehearsal into production spend
-- makes "what does a customer reply cost" unanswerable, which is the
-- number the monthly budget is set from.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'agent', 'playground'));
