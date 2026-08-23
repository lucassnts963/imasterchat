-- ============================================================
-- 039 — Default currency: BRL
--
-- iMasterChat targets the Brazilian market (pt-BR UI, PIX billing),
-- so new accounts should start in BRL instead of the upstream USD
-- default. The per-account picker (Settings → Deals, migration 021)
-- is unchanged — any account can still switch to any ISO-4217 code.
--
-- Existing accounts are NOT touched: an account that deliberately
-- runs in USD (or already changed its currency) keeps it. Only the
-- column DEFAULT — what a brand-new account gets — changes.
-- ============================================================

ALTER TABLE public.accounts
  ALTER COLUMN default_currency SET DEFAULT 'BRL';
