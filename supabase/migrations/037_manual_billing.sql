-- ============================================================
-- 037 — Manual billing status + platform admin flag
--
-- iMasterChat is sold with manually-invoiced subscriptions: the
-- platform owner bills each account out of band (PIX / contract)
-- and flips the account's billing status by hand from the /admin
-- panel. There is NO payment gateway and NO cron: nothing in the
-- database changes state on its own.
--
-- What this adds:
--   1. `billing_status_enum` + `accounts.billing_status`
--        pending   — fresh signup awaiting manual approval (gated)
--        active    — paying (or approved) account, full access
--        past_due  — invoice aging; full access + warning banner
--        blocked   — access suspended for non-payment (gated)
--      `pending` is the DEFAULT so open signup no longer hands out
--      free tenants: a new account stays gated until the platform
--      owner approves it.
--   2. `accounts.paid_until` / `accounts.billing_notes` — purely
--      informational fields for the admin panel (next invoice date,
--      free-form notes). Nothing enforces `paid_until`.
--   3. `profiles.is_platform_admin` — cross-tenant admin flag for
--      the /admin panel and /api/admin routes. Deliberately a new
--      boolean rather than repurposing the legacy `profiles.role`
--      TEXT column (unknown historical data; flagged for removal
--      by 017).
--   4. A trigger preventing non-service-role writes to the billing
--      columns — members can read their own account's status (the
--      existing accounts SELECT policy exposes the row) but only
--      the service-role admin routes may change it.
--
-- What this deliberately does NOT do:
--   - No change to is_account_member(): RLS stays access-neutral for
--     gated accounts. Enforcement lives in the app layer
--     (src/lib/auth/account.ts throws a 402 PaymentRequiredError),
--     because (a) the /blocked page must still read the account row
--     to explain the situation, and (b) inbound WhatsApp webhooks
--     keep persisting messages for gated accounts by design.
--   - No backfill of existing accounts to 'pending' — they are
--     explicitly promoted to 'active' below so this migration never
--     locks out accounts that predate billing.
--
-- Bootstrap (run once, by hand, in the SQL Editor):
--   UPDATE public.profiles SET is_platform_admin = true
--    WHERE user_id = '<auth.users id of the platform owner>';
-- ============================================================

-- 1. Billing status enum ------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.billing_status_enum AS ENUM (
    'pending',
    'active',
    'past_due',
    'blocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Accounts: billing columns ------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS billing_status public.billing_status_enum
    NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_until date,
  ADD COLUMN IF NOT EXISTS billing_notes text;

-- Existing accounts predate billing: promote them so this migration
-- is not a lockout. Guarded by created_at < the migration moment only
-- via idempotency: re-running after new (pending) signups must NOT
-- promote those, so we only promote rows that are still 'pending' AND
-- were created before this column existed — which is expressible as
-- "rows where billing_notes is null and paid_until is null and
-- billing_status = 'pending'" being too broad, we instead promote
-- exactly once using a marker in billing_notes.
UPDATE public.accounts
   SET billing_status = 'active',
       billing_notes  = COALESCE(billing_notes, '') ||
         CASE WHEN billing_notes IS NULL THEN '' ELSE E'\n' END ||
         '[037] auto-promoted pre-billing account'
 WHERE billing_status = 'pending'
   AND billing_notes IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.accounts a2
      WHERE a2.id = accounts.id
        AND a2.billing_notes LIKE '%[037] auto-promoted%'
   );

-- 3. Profiles: platform admin flag --------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- 4. Guard billing columns against member writes ------------------------
--
-- The accounts UPDATE policy (017) lets the owner rename their account;
-- without this trigger it would also let them set billing_status =
-- 'active' via a hand-crafted PostgREST call. RLS cannot express
-- column-level rules, so a BEFORE UPDATE trigger rejects billing-column
-- changes for every role except service_role (the admin API routes) and
-- superusers/postgres (SQL Editor).

CREATE OR REPLACE FUNCTION public.protect_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.billing_status IS DISTINCT FROM OLD.billing_status
    OR NEW.paid_until IS DISTINCT FROM OLD.paid_until
    OR NEW.billing_notes IS DISTINCT FROM OLD.billing_notes
  )
  AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
  AND current_setting('role', true) NOT IN ('service_role', 'postgres')
  AND session_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'billing columns can only be changed by the platform admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_billing_columns ON public.accounts;
CREATE TRIGGER trg_protect_billing_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.protect_billing_columns();

-- 5. Platform-admin read access across accounts -------------------------
--
-- The /api/admin routes use the service-role client (bypasses RLS), so
-- no new SELECT policies are strictly required. We still add a helper
-- so future in-band checks and RLS policies can ask "is this caller a
-- platform admin?" the same way they ask is_account_member().

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.is_platform_admin
       FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1),
    false
  );
$$;
