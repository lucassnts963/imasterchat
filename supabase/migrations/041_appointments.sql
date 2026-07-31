-- ============================================================
-- 041 — Appointments
--
-- Booking history lives in the product from day one, even while the
-- booking BRAIN lives outside it (n8n drives the dialogue and talks to
-- Google Calendar; see docs/agendamento-google-calendar.md). n8n writes
-- here through the public API, so when the native agent replaces it
-- later only the writer changes — the history, the RLS and the UI stay.
--
-- Google Calendar is the source of truth for AVAILABILITY: nothing here
-- is consulted to decide whether a slot is free. This table is the
-- CRM-side record — who booked, for when, through which conversation,
-- and which calendar event it maps to. That split is deliberate: the
-- optician blocks a day by creating an event in her own Google
-- Calendar, and the bot must respect it without anyone updating a
-- second system.
--
-- `google_event_id` is nullable on purpose. A booking written here
-- whose calendar insert then failed is a real state we want visible
-- (it needs a human), not a row we refuse to store.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.appointment_status_enum AS ENUM (
    'scheduled',   -- confirmed with the customer and on the calendar
    'completed',   -- customer showed up
    'no_show',     -- customer didn't
    'cancelled'    -- called off by either side
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.appointments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Which thread produced the booking. Nullable so an appointment
  -- created from the dashboard (no chat) is still representable, and
  -- SET NULL so deleting a conversation never destroys the booking.
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,

  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  status       public.appointment_status_enum NOT NULL DEFAULT 'scheduled',

  title        text,
  notes        text,

  -- Google Calendar linkage. NULL = not (yet) on the calendar.
  google_event_id  text,
  google_calendar_id text,

  -- 'n8n' while the automation owns the dialogue, 'native' once the
  -- in-app agent does, 'manual' for a human booking from the dashboard.
  -- Lets us measure the migration instead of guessing at it.
  created_via  text NOT NULL DEFAULT 'manual'
    CHECK (created_via IN ('manual', 'n8n', 'native')),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT appointments_ends_after_starts CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_appointments_account_starts
  ON public.appointments (account_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_contact
  ON public.appointments (contact_id, starts_at DESC);

-- One live booking per slot per account. Double-booking is the failure
-- mode that costs the client a real customer, and an autonomous agent
-- retrying a request is exactly how it happens — so the database
-- refuses it rather than trusting the caller to check first. Cancelled
-- and past bookings are excluded so a freed slot can be re-sold.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_per_slot
  ON public.appointments (account_id, starts_at)
  WHERE status = 'scheduled';

-- One live booking per contact, mirroring the "1 agendamento por
-- cliente" limit the operator chose for autonomous booking. A customer
-- who wants a second slot goes through a human.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_live_per_contact
  ON public.appointments (contact_id)
  WHERE status = 'scheduled';

-- Idempotency for the calendar link: the same Google event must never
-- map to two rows (a retried workflow would otherwise duplicate).
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_google_event
  ON public.appointments (google_event_id)
  WHERE google_event_id IS NOT NULL;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Account-scoped from the start, via the same helper every table added
-- since 017 uses — NOT the legacy `auth.uid() = user_id` shape that
-- deals and custom fields still carry. Reading is member-wide (any
-- attendant needs to see the schedule); writing needs 'agent', the
-- same bar as sending a message.
DROP POLICY IF EXISTS appointments_select ON public.appointments;
CREATE POLICY appointments_select ON public.appointments
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS appointments_insert ON public.appointments;
CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointments_update ON public.appointments;
CREATE POLICY appointments_update ON public.appointments
  FOR UPDATE USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointments_delete ON public.appointments;
CREATE POLICY appointments_delete ON public.appointments
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

-- Keep updated_at honest. Reuses the trigger function 001 installed.
DROP TRIGGER IF EXISTS set_appointments_updated_at ON public.appointments;
CREATE TRIGGER set_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
