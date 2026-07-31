// ============================================================
// Public-API serialization + validation for appointments.
//
// Kept out of the route files because both the collection and the
// item routes need the same shape, and because the slot rules are
// worth unit-testing without spinning up a request.
// ============================================================

import type { ApiScope } from '@/lib/api-keys/scopes';

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'completed',
  'no_show',
  'cancelled',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export function isAppointmentStatus(v: unknown): v is AppointmentStatus {
  return (
    typeof v === 'string' &&
    (APPOINTMENT_STATUSES as readonly string[]).includes(v)
  );
}

export interface AppointmentRow {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  title: string | null;
  notes: string | null;
  google_event_id: string | null;
  google_calendar_id: string | null;
  created_via: string;
  created_at: string;
  updated_at: string;
}

export const APPOINTMENT_SELECT =
  'id, contact_id, conversation_id, starts_at, ends_at, status, title, notes, google_event_id, google_calendar_id, created_via, created_at, updated_at';

export function serializeAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    contact_id: row.contact_id,
    conversation_id: row.conversation_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    title: row.title,
    notes: row.notes,
    google_event_id: row.google_event_id,
    google_calendar_id: row.google_calendar_id,
    created_via: row.created_via,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Scope pair, exported so the routes can't drift from each other. */
export const APPOINTMENT_SCOPES: { read: ApiScope; write: ApiScope } = {
  read: 'appointments:read',
  write: 'appointments:write',
};

export interface ParsedSlot {
  startsAt: Date;
  endsAt: Date;
}

export type SlotError =
  | 'starts_at_invalid'
  | 'ends_at_invalid'
  | 'ends_before_starts'
  | 'too_long'
  | 'in_the_past';

/** Nobody books a consultation longer than this; a value beyond it is a
 *  caller bug (usually a unit mix-up), not a real appointment. */
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * Validate a requested slot.
 *
 * This is NOT availability — Google Calendar owns that, and this app
 * deliberately never second-guesses it (see migration 041). What this
 * catches is the class of nonsense an autonomous agent actually
 * produces: a malformed date, an end before a start, a duration that
 * means somebody passed seconds where milliseconds were expected, and
 * bookings in the past — which is what a model that has lost track of
 * today's date emits.
 */
export function parseSlot(
  startsAt: unknown,
  endsAt: unknown,
  now: Date = new Date(),
): { ok: true; slot: ParsedSlot } | { ok: false; error: SlotError } {
  if (typeof startsAt !== 'string' || Number.isNaN(Date.parse(startsAt))) {
    return { ok: false, error: 'starts_at_invalid' };
  }
  if (typeof endsAt !== 'string' || Number.isNaN(Date.parse(endsAt))) {
    return { ok: false, error: 'ends_at_invalid' };
  }

  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (end.getTime() <= start.getTime()) {
    return { ok: false, error: 'ends_before_starts' };
  }
  if (end.getTime() - start.getTime() > MAX_DURATION_MS) {
    return { ok: false, error: 'too_long' };
  }
  if (start.getTime() < now.getTime()) {
    return { ok: false, error: 'in_the_past' };
  }

  return { ok: true, slot: { startsAt: start, endsAt: end } };
}

export const SLOT_ERROR_MESSAGE: Record<SlotError, string> = {
  starts_at_invalid: "'starts_at' must be an ISO 8601 datetime",
  ends_at_invalid: "'ends_at' must be an ISO 8601 datetime",
  ends_before_starts: "'ends_at' must be after 'starts_at'",
  too_long: 'Appointment duration exceeds the 8 hour maximum',
  in_the_past: 'Appointment cannot start in the past',
};
