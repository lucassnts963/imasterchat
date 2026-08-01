import type { SupabaseClient } from '@supabase/supabase-js'
import { GoogleError } from '@/lib/google/oauth'
import {
  deleteEvent,
  insertEvent,
  patchEvent,
  queryFreeBusy,
} from '@/lib/google/calendar'
import type { GoogleConnection } from '@/lib/google/connection'
import { formatInZone } from '@/lib/time/zone'
import type { BusyInterval } from './availability'

// ============================================================
// Creating, moving and cancelling a booking — the one implementation.
//
// Three callers use it: the agent's tools, the agenda screen, and (via
// the same rules) anything else that books. They must not drift, because
// a rule enforced in two places is a rule enforced in one and a half.
//
// Write order is deliberate: OUR row first, then Google.
//
// The database is what makes concurrency safe — migration 041's partial
// unique indexes reject a second live booking for the same slot, the
// same contact, or the same calendar event, which is exactly how a
// retrying agent double-books. Writing to Google first would mean
// discovering the clash afterwards, with an orphan event already in the
// shop's calendar and no clean way to take it back.
//
// The cost of this order is the reverse failure: a row written, a
// calendar insert that failed, `google_event_id` left null. That state
// is deliberate too — 041 made the column nullable so a booking the
// optician cannot see is VISIBLE to us rather than rejected. It needs a
// human, and both the tool and the screen say so.
// ============================================================

export interface Appointment {
  id: string
  contactId: string
  conversationId: string | null
  startsAt: string
  endsAt: string
  status: string
  title: string | null
  notes: string | null
  googleEventId: string | null
  createdVia: string
}

const APPOINTMENT_COLUMNS =
  'id, contact_id, conversation_id, starts_at, ends_at, status, title, notes, google_event_id, created_via'

interface AppointmentRow {
  id: string
  contact_id: string
  conversation_id: string | null
  starts_at: string
  ends_at: string
  status: string
  title: string | null
  notes: string | null
  google_event_id: string | null
  created_via: string
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    title: row.title,
    notes: row.notes,
    googleEventId: row.google_event_id,
    createdVia: row.created_via,
  }
}

export type SchedulingFailure =
  | 'slot_taken'
  | 'already_booked'
  | 'not_found'
  | 'calendar_failed'
  | 'internal'

export type SchedulingResult =
  | { ok: true; appointment: Appointment; calendarSynced: boolean }
  | { ok: false; failure: SchedulingFailure; message: string }

/** Postgres unique-violation. The 041 indexes speak through it. */
const UNIQUE_VIOLATION = '23505'

function classifyInsertError(error: { code?: string; message?: string }):
  | { failure: SchedulingFailure; message: string }
  | null {
  if (error.code !== UNIQUE_VIOLATION) return null
  const detail = error.message ?? ''
  if (detail.includes('one_live_per_contact')) {
    return {
      failure: 'already_booked',
      message:
        'This customer already has an appointment booked. Reschedule the existing one instead of creating a second.',
    }
  }
  return {
    failure: 'slot_taken',
    message: 'That time was just taken. Offer another slot.',
  }
}

export interface BookArgs {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId?: string | null
  startsAt: Date
  endsAt: Date
  title?: string | null
  notes?: string | null
  /** 'native' when the agent booked it, 'manual' from the agenda screen. */
  createdVia: 'native' | 'manual'
  /** Null when the account has no calendar connected — the booking is
   *  still recorded, it just lives only in the CRM. */
  connection: GoogleConnection | null
  timezone: string
  /** Shown on the calendar event so the shop knows who is coming. */
  contactName?: string | null
}

export async function bookAppointment(args: BookArgs): Promise<SchedulingResult> {
  const { db, accountId, contactId, startsAt, endsAt, connection, timezone } = args

  const { data, error } = await db
    .from('appointments')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: args.conversationId ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'scheduled',
      title: args.title ?? null,
      notes: args.notes ?? null,
      created_via: args.createdVia,
    })
    .select(APPOINTMENT_COLUMNS)
    .single<AppointmentRow>()

  if (error) {
    const classified = classifyInsertError(error)
    if (classified) return { ok: false, ...classified }
    console.error('[scheduling] insert failed:', error)
    return { ok: false, failure: 'internal', message: 'Could not record the appointment.' }
  }

  const appointment = toAppointment(data)
  if (!connection) return { ok: true, appointment, calendarSynced: false }

  try {
    const event = await insertEvent(connection, {
      summary: args.title?.trim() || `Atendimento — ${args.contactName ?? 'cliente'}`,
      description: args.notes ?? undefined,
      startsAt,
      endsAt,
      timezone,
    })
    await db
      .from('appointments')
      .update({ google_event_id: event.id, google_calendar_id: connection.calendarId })
      .eq('id', appointment.id)
    return {
      ok: true,
      appointment: { ...appointment, googleEventId: event.id },
      calendarSynced: true,
    }
  } catch (err) {
    // The row stands, without an event. Reported, not swallowed: the
    // shop works from Google, so a booking that never reached it is
    // not a booking as far as they are concerned.
    console.error('[scheduling] calendar insert failed after the row was written:', err)
    return { ok: true, appointment, calendarSynced: false }
  }
}

export interface RescheduleArgs {
  db: SupabaseClient
  accountId: string
  appointmentId: string
  startsAt: Date
  endsAt: Date
  connection: GoogleConnection | null
  timezone: string
}

export async function rescheduleAppointment(
  args: RescheduleArgs,
): Promise<SchedulingResult> {
  const { db, accountId, appointmentId, startsAt, endsAt, connection, timezone } = args

  const existing = await loadAppointment(db, accountId, appointmentId)
  if (!existing) {
    return { ok: false, failure: 'not_found', message: 'Appointment not found.' }
  }

  const { data, error } = await db
    .from('appointments')
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'scheduled',
    })
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .select(APPOINTMENT_COLUMNS)
    .single<AppointmentRow>()

  if (error) {
    const classified = classifyInsertError(error)
    if (classified) return { ok: false, ...classified }
    console.error('[scheduling] reschedule failed:', error)
    return { ok: false, failure: 'internal', message: 'Could not move the appointment.' }
  }

  const appointment = toAppointment(data)
  if (!connection || !appointment.googleEventId) {
    return { ok: true, appointment, calendarSynced: false }
  }

  try {
    await patchEvent(connection, appointment.googleEventId, {
      summary: appointment.title?.trim() || 'Atendimento',
      startsAt,
      endsAt,
      timezone,
    })
    return { ok: true, appointment, calendarSynced: true }
  } catch (err) {
    console.error('[scheduling] calendar patch failed:', err)
    return { ok: true, appointment, calendarSynced: false }
  }
}

export interface CancelArgs {
  db: SupabaseClient
  accountId: string
  appointmentId: string
  reason?: string | null
  connection: GoogleConnection | null
}

export async function cancelAppointment(
  args: CancelArgs,
): Promise<SchedulingResult> {
  const { db, accountId, appointmentId, connection } = args

  const existing = await loadAppointment(db, accountId, appointmentId)
  if (!existing) {
    return { ok: false, failure: 'not_found', message: 'Appointment not found.' }
  }

  const { data, error } = await db
    .from('appointments')
    .update({
      status: 'cancelled',
      cancellation_reason: args.reason?.trim() || null,
    })
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .select(APPOINTMENT_COLUMNS)
    .single<AppointmentRow>()

  if (error) {
    console.error('[scheduling] cancel failed:', error)
    return { ok: false, failure: 'internal', message: 'Could not cancel the appointment.' }
  }

  const appointment = toAppointment(data)
  if (!connection || !existing.googleEventId) {
    return { ok: true, appointment, calendarSynced: false }
  }

  try {
    // Delete rather than mark cancelled on Google: the shop reads that
    // calendar to know its day, and a cancelled event still occupying
    // the row is exactly the confusion we are here to avoid. Our own
    // table keeps the history, with the reason.
    await deleteEvent(connection, existing.googleEventId)
    return { ok: true, appointment, calendarSynced: true }
  } catch (err) {
    console.error('[scheduling] calendar delete failed:', err)
    return { ok: true, appointment, calendarSynced: false }
  }
}

export async function loadAppointment(
  db: SupabaseClient,
  accountId: string,
  appointmentId: string,
): Promise<Appointment | null> {
  const { data, error } = await db
    .from('appointments')
    .select(APPOINTMENT_COLUMNS)
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .maybeSingle<AppointmentRow>()
  if (error || !data) return null
  return toAppointment(data)
}

/**
 * Everything occupying the calendar in a range: Google's own busy
 * intervals plus our live bookings.
 *
 * Both, not either. Google alone would miss a booking whose event
 * insert failed; our table alone would miss the day the optician
 * blocked by hand, which is the whole reason Google is the source of
 * truth. A time is free only if neither claims it.
 */
export async function loadBusyIntervals(
  db: SupabaseClient,
  accountId: string,
  connection: GoogleConnection | null,
  from: Date,
  to: Date,
): Promise<BusyInterval[]> {
  const busy: BusyInterval[] = []

  if (connection) {
    try {
      busy.push(...(await queryFreeBusy(connection, from, to)))
    } catch (err) {
      // Availability computed without Google would offer slots the shop
      // has already filled, so this must NOT degrade quietly.
      if (err instanceof GoogleError) throw err
      throw new GoogleError('Could not read the calendar.', {
        code: 'calendar_error',
      })
    }
  }

  const { data, error } = await db
    .from('appointments')
    .select('starts_at, ends_at')
    .eq('account_id', accountId)
    .eq('status', 'scheduled')
    .lt('starts_at', to.toISOString())
    .gt('ends_at', from.toISOString())

  if (error) {
    console.error('[scheduling] busy lookup failed:', error)
  } else {
    for (const row of (data ?? []) as { starts_at: string; ends_at: string }[]) {
      busy.push({ start: new Date(row.starts_at), end: new Date(row.ends_at) })
    }
  }

  return busy
}

/** How a booking reads back to the model and in a confirmation. */
export function describeAppointment(
  appointment: Appointment,
  timezone: string,
): string {
  return `${appointment.title?.trim() || 'Appointment'} on ${formatInZone(
    new Date(appointment.startsAt),
    timezone,
  )} (${timezone})`
}
