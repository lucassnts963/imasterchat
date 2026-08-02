-- ============================================================
-- 050 — Model prices and the exchange rate, both editable
--
-- Prices lived in `src/lib/ai/pricing.ts` as a constant. When a
-- provider reprices, that number goes wrong IN SILENCE: the cost
-- projection stays confident and starts lying, and nothing in the code
-- can know it has aged. Changing it meant editing source and
-- redeploying.
--
-- Both tables are GLOBAL — no account_id. A model's list price is the
-- same fact for everybody, and so is the dollar. Letting each account
-- edit them would let one shop's typo become another shop's budget.
-- Writes are therefore platform-admin only, using the helper 037
-- already installed.
--
-- The code table stays as the seed and the fallback. A deployment that
-- never touches these tables behaves exactly as it does today, which
-- is what makes this safe to ship.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- Model prices
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_model_prices (
  -- The prefix matched against the stored model id, longest first —
  -- the same matching the code does, so "gpt-4o-mini" still wins over
  -- "gpt-4o". Not the full id: providers append dates
  -- ("claude-haiku-4-5-20251001") and a table of exact ids would need
  -- a new row every release.
  model_prefix text PRIMARY KEY,
  provider     text NOT NULL CHECK (provider IN ('openai', 'anthropic')),

  -- USD per 1M tokens, as the providers publish them.
  input_usd    numeric(10, 4) NOT NULL CHECK (input_usd >= 0),
  output_usd   numeric(10, 4) NOT NULL CHECK (output_usd >= 0),

  -- Who last touched it and when. A price nobody can date is a price
  -- nobody can distrust.
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_model_prices ENABLE ROW LEVEL SECURITY;

-- Everyone signed in may read: the cost screens need it, and a list
-- price is public information anyway.
DROP POLICY IF EXISTS ai_model_prices_select ON public.ai_model_prices;
CREATE POLICY ai_model_prices_select ON public.ai_model_prices
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ai_model_prices_write ON public.ai_model_prices;
CREATE POLICY ai_model_prices_write ON public.ai_model_prices
  FOR ALL USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP TRIGGER IF EXISTS set_ai_model_prices_updated_at ON public.ai_model_prices;
CREATE TRIGGER set_ai_model_prices_updated_at
  BEFORE UPDATE ON public.ai_model_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Exchange rate
--
-- One row per currency. The product bills in USD because the providers
-- do; this exists so a Brazilian shop owner can see roughly what that
-- means in the money they actually think in.
--
-- `source` and `fetched_at` are the point. A stale rate is the failure
-- mode here — the dollar moves daily, and a three-month-old figure is
-- wrong with no symptom. Storing where it came from and when lets the
-- screen show its age instead of presenting it as fact.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  currency   text PRIMARY KEY CHECK (currency ~ '^[A-Z]{3}$'),
  -- How many units of `currency` one USD buys.
  usd_rate   numeric(12, 6) NOT NULL CHECK (usd_rate > 0),
  -- 'auto' when the scheduled fetch wrote it, 'manual' when a platform
  -- admin did. A manual value stands until the next successful fetch —
  -- the override is a correction, not a permanent pin.
  source     text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exchange_rates_select ON public.exchange_rates;
CREATE POLICY exchange_rates_select ON public.exchange_rates
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS exchange_rates_write ON public.exchange_rates;
CREATE POLICY exchange_rates_write ON public.exchange_rates
  FOR ALL USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
