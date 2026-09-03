-- ============================================================
-- 075_whatsapp_message_costs.sql — what Meta actually billed
--
-- From 1 October 2026 Meta ends the free service-message policy: every
-- free-form reply inside the 24-hour window, and every utility template
-- inside it, becomes billable per message. For an inbound-service CRM
-- with an auto-reply bot that is not a percentage rise on an existing
-- bill — it is a cost line that is zero today.
--
-- The system could not see it. `ai_usage_log` counts LLM tokens and
-- `monthly_budget_usd` caps LLM spend; nothing counted a sent message.
--
-- We do not have to estimate. Meta already sends a `pricing` object on
-- every status webhook:
--
--   "pricing": { "billable": false, "pricing_model": "PMP",
--                "type": "free_customer_service", "category": "utility" }
--
-- so this table records META'S OWN determination rather than our guess.
-- The price table is then only needed to turn a count into money.
--
-- Recording this BEFORE October is the point. Every message arriving
-- today as `free_customer_service` is exactly one that starts costing on
-- 1 October, so an account that starts capturing now reaches the change
-- with a real forecast instead of a surprise invoice — and the switchover
-- shows up in this table as those rows start arriving `regular` /
-- `service`.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_message_costs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Meta's message id (wamid). Not globally unique across numbers
  -- (migration 009), which is why the uniqueness below is per account.
  message_id        text NOT NULL,
  -- Meta's own answer to "did this cost money?".
  billable          boolean NOT NULL,
  -- 'PMP' (per-message) — 'CBP' only on installs still seeing the old model.
  pricing_model     text,
  -- regular | free_customer_service | free_entry_point
  pricing_type      text,
  -- marketing | utility | service | authentication
  pricing_category  text,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

-- One row per message per account. Pricing can ride along on more than
-- one status (sent, delivered, read), and counting the same message
-- twice would inflate the forecast — which is the one number this table
-- exists to get right. The writer upserts and ignores the conflict.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_message_costs_account_message_idx
  ON whatsapp_message_costs (account_id, message_id);

-- The only read pattern: this account, newest first, filtered by month.
CREATE INDEX IF NOT EXISTS whatsapp_message_costs_account_recorded_idx
  ON whatsapp_message_costs (account_id, recorded_at DESC);

-- Deliberately NO CHECK on pricing_type / pricing_category. Meta adds
-- values to both (service messaging itself arrived this way), and a
-- CHECK here would turn "Meta shipped a new category" into a webhook
-- that throws — dropping the status update, and with it the delivery
-- receipt the inbox depends on. The application warns on an unknown
-- value instead, which is visible without being destructive.

ALTER TABLE whatsapp_message_costs ENABLE ROW LEVEL SECURITY;

-- Spend visibility is settings/billing-class, same bar as ai_usage_log.
-- Writes come from the webhook under the service role, which bypasses
-- RLS, so there is no INSERT policy for `authenticated`.
DROP POLICY IF EXISTS whatsapp_message_costs_select ON whatsapp_message_costs;
CREATE POLICY whatsapp_message_costs_select ON whatsapp_message_costs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

COMMENT ON TABLE whatsapp_message_costs IS
  'One row per outbound message Meta reported pricing for, carrying Meta''s own billable/category determination from the status webhook. Populated from 1 Oct 2026 onward with billable=true for service replies; before that, rows with type=free_customer_service are the forecast of what will start costing.';
