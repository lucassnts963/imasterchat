-- ============================================================
-- 043 — Google Calendar connection + scheduling rules
--
-- Two tables, and the split between them is the whole design.
--
-- `google_calendar_connections` is the credential. One per account —
-- the shop serves one customer per slot, so there is one calendar and
-- the "one live booking per slot" index from 041 is already the right
-- constraint. (Per-professional scheduling would add a resource_id
-- here and to appointments; that is a data migration later, not a
-- rewrite.)
--
-- `ai_scheduling_settings` is the RULE — opening hours, appointment
-- length, how much notice is required, how far ahead bookings are
-- taken. It exists as a table rather than as prose in the agent's
-- prompt because a rule in a prompt is a suggestion: the model that
-- reads "seg a sex, 9h às 18h" will eventually offer Saturday. Here
-- the server checks it and the model cannot argue.
--
-- What is NOT modelled: availability. Google Calendar owns that
-- (`freebusy`), which is what lets the optician block a day by putting
-- an event in her own calendar without touching a second system.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- The connection
-- ============================================================
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE, not just a FK: one calendar per account is the decision,
  -- and the database should be the one enforcing it.
  account_id  uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- AES-256-GCM, same ENCRYPTION_KEY and same helper as the WhatsApp
  -- tokens (src/lib/whatsapp/encryption.ts). No second mechanism.
  refresh_token text NOT NULL,
  -- Cached so a booking does not pay a token round-trip every call.
  -- Nullable: a fresh connection has none until the first refresh.
  access_token  text,
  access_token_expires_at timestamptz,

  -- Which calendar to read and write. 'primary' covers the common case
  -- of the owner using her own; a shop with a dedicated calendar sets
  -- its id here.
  calendar_id  text NOT NULL DEFAULT 'primary',
  -- Shown in settings so the operator can tell WHICH Google account is
  -- connected — the failure we want to prevent is booking into a
  -- personal calendar nobody looks at.
  google_email text,
  scope        text,

  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

-- Settings-class, mirroring ai_configs and whatsapp_config: any member
-- may see that a calendar is connected (the agenda screen needs it);
-- only admin+ may connect or disconnect one.
DROP POLICY IF EXISTS google_calendar_connections_select ON public.google_calendar_connections;
CREATE POLICY google_calendar_connections_select ON public.google_calendar_connections
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS google_calendar_connections_insert ON public.google_calendar_connections;
CREATE POLICY google_calendar_connections_insert ON public.google_calendar_connections
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS google_calendar_connections_update ON public.google_calendar_connections;
CREATE POLICY google_calendar_connections_update ON public.google_calendar_connections
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS google_calendar_connections_delete ON public.google_calendar_connections;
CREATE POLICY google_calendar_connections_delete ON public.google_calendar_connections
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_google_calendar_connections_updated_at
  ON public.google_calendar_connections;
CREATE TRIGGER set_google_calendar_connections_updated_at
  BEFORE UPDATE ON public.google_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- The rules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_scheduling_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- IANA zone. Everything the model is told, and every slot it is
  -- offered, is rendered in this zone. Without it "quinta às 14h" is
  -- ambiguous by three hours.
  timezone    text NOT NULL DEFAULT 'America/Sao_Paulo',

  -- How long one appointment takes, and therefore the grid the day is
  -- cut into.
  slot_minutes      integer NOT NULL DEFAULT 60
    CHECK (slot_minutes > 0 AND slot_minutes <= 480),
  -- Minimum notice. Stops the bot offering a slot 5 minutes out that
  -- nobody can reach in time.
  lead_time_minutes integer NOT NULL DEFAULT 120
    CHECK (lead_time_minutes >= 0),
  -- How far ahead bookings are taken. Bounds both the freebusy query
  -- and a model that would happily book next April.
  max_advance_days  integer NOT NULL DEFAULT 30
    CHECK (max_advance_days > 0 AND max_advance_days <= 365),

  -- Opening hours, as local wall-clock windows per weekday. Keys are
  -- '0'..'6' with 0 = Sunday, matching JS getDay(); values are
  -- [start, end] pairs in 'HH:MM'. A missing key or an empty array is
  -- a closed day, which is how "seg a sex" is expressed.
  --
  --   {"1": [["09:00","12:00"], ["14:00","18:00"]], ...}
  --
  -- jsonb rather than a rows-per-window table: it is always read whole,
  -- always written whole, and never queried by window.
  weekly_hours jsonb NOT NULL DEFAULT '{
    "1": [["09:00","12:00"], ["14:00","18:00"]],
    "2": [["09:00","12:00"], ["14:00","18:00"]],
    "3": [["09:00","12:00"], ["14:00","18:00"]],
    "4": [["09:00","12:00"], ["14:00","18:00"]],
    "5": [["09:00","12:00"], ["14:00","18:00"]]
  }'::jsonb,

  -- The master switch for autonomous booking. Off means the scheduling
  -- tools are not in the model's catalog at all — a tool it cannot see
  -- is a tool it cannot misuse, and it costs no prompt tokens.
  is_active   boolean NOT NULL DEFAULT false,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_scheduling_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_scheduling_settings_select ON public.ai_scheduling_settings;
CREATE POLICY ai_scheduling_settings_select ON public.ai_scheduling_settings
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS ai_scheduling_settings_insert ON public.ai_scheduling_settings;
CREATE POLICY ai_scheduling_settings_insert ON public.ai_scheduling_settings
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_scheduling_settings_update ON public.ai_scheduling_settings;
CREATE POLICY ai_scheduling_settings_update ON public.ai_scheduling_settings
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_scheduling_settings_delete ON public.ai_scheduling_settings;
CREATE POLICY ai_scheduling_settings_delete ON public.ai_scheduling_settings
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_ai_scheduling_settings_updated_at
  ON public.ai_scheduling_settings;
CREATE TRIGGER set_ai_scheduling_settings_updated_at
  BEFORE UPDATE ON public.ai_scheduling_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- `appointments` gains a cancellation reason
--
-- 041 modelled cancellation as a status with no room for why. The
-- agenda screen shows cancelled bookings on purpose — they explain a
-- gap in the day — and "cancelled" alone explains nothing.
-- ============================================================
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
