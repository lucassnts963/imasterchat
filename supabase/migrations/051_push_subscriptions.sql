-- ============================================================
-- 051 — Push subscriptions
--
-- Supabase Realtime already delivers new messages to an open tab, so
-- what a PWA adds is exactly one thing: reaching the attendant when
-- the app is CLOSED. That is what this table is for and all it is for.
--
-- One row per browser, not per user: the same attendant on a phone and
-- a desktop is two subscriptions, and each carries its own preference.
-- Someone may want everything on the phone in their pocket and only
-- the urgent ones on the machine they walk away from.
--
-- The endpoint is the identity — the browser mints it and it is unique
-- per (browser, site). Re-subscribing on the same device returns the
-- same endpoint, so upsert on it rather than accumulating dead rows.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.push_notify_mode AS ENUM (
    -- Every inbound customer message.
    'all',
    -- Only when a conversation needs a person: the agent handed off,
    -- a guardrail fired, or the thread was assigned to this user.
    'human_needed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The push service URL the browser gave us. Unique on its own: it
  -- already identifies one browser on one site, and a device that
  -- re-subscribes must update its row instead of creating a second.
  endpoint   text NOT NULL UNIQUE,
  -- The browser's public key and auth secret, used to encrypt the
  -- payload so the push service (Google, Apple, Mozilla) relays it
  -- without being able to read it.
  p256dh     text NOT NULL,
  auth       text NOT NULL,

  notify_mode public.push_notify_mode NOT NULL DEFAULT 'human_needed',

  -- Free text from the browser, only so the settings screen can say
  -- "Chrome no Android" instead of listing three identical rows.
  user_agent text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Bumped on every successful send. A subscription that has not been
  -- reachable for months is one to clean up.
  last_used_at  timestamptz
);

-- The send path's only query: every subscription for this account,
-- filtered by mode.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account
  ON public.push_subscriptions (account_id, notify_mode);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A subscription is personal, not shared: it names a device someone
-- carries. Even an account admin has no business reading or deleting a
-- colleague's, so every policy is scoped to the owner rather than to
-- account membership.
DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert ON public.push_subscriptions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND public.is_account_member(account_id)
  );

DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update ON public.push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

-- The sender runs under the service-role client (the webhook has no
-- auth.uid()) and bypasses all of the above; these policies guard the
-- dashboard.
