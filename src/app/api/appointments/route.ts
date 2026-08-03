import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { GoogleError } from '@/lib/google/oauth'
import { loadGoogleConnection } from '@/lib/google/connection'
import {
  loadSchedulingSettings,
  DEFAULT_TIMEZONE,
} from '@/lib/scheduling/settings'
import { bookAppointment } from '@/lib/scheduling/store'
import { parseSlot, SLOT_ERROR_MESSAGE } from '@/lib/api/v1/appointments'

// ============================================================
// GET  /api/appointments?from=&to=   (any member) — the agenda screen
// POST /api/appointments             (agent+)     — book by hand
//
// Session-authenticated sibling of /api/v1/appointments, which is
// key-authenticated for external callers. Both write through
// `scheduling/store`, so a booking made here obeys the same rules and
// lands on the same calendar as one the agent makes. The only thing
// that differs is `created_via`.
// ============================================================

const APPOINTMENT_SELECT =
  'id, contact_id, conversation_id, starts_at, ends_at, status, title, notes, google_event_id, created_via, cancellation_reason, contacts(name, phone)'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)

    let query = supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('account_id', accountId)
      .order('starts_at', { ascending: true })
      .limit(500)

    // The screen always asks for a visible range — a week or a day.
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (from && !Number.isNaN(Date.parse(from))) query = query.gte('starts_at', from)
    if (to && !Number.isNaN(Date.parse(to))) query = query.lt('starts_at', to)

    const { data, error } = await query
    if (error) {
      console.error('[appointments GET] error:', error)
      return NextResponse.json(
        { error: 'Failed to load appointments' },
        { status: 500 },
      )
    }

    const settings = await loadSchedulingSettings(supabase, accountId)
    return NextResponse.json({
      appointments: data ?? [],
      timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const contactId = typeof body.contact_id === 'string' ? body.contact_id : null
    if (!contactId) {
      return NextResponse.json(
        { error: "'contact_id' is required" },
        { status: 400 },
      )
    }

    const slot = parseSlot(body.starts_at, body.ends_at)
    if (!slot.ok) {
      return NextResponse.json(
        { error: SLOT_ERROR_MESSAGE[slot.error], code: slot.error },
        { status: 400 },
      )
    }

    const settings = await loadSchedulingSettings(supabase, accountId)
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE

    // A human booking deliberately does NOT go through
    // `computeAvailableSlots`: the attendant can see the calendar and
    // may have a reason to book outside the usual hours. The database
    // still refuses a genuine double-booking, which is the part that
    // protects the customer rather than the policy.
    let connection = null
    try {
      connection = await loadGoogleConnection(supabase, accountId)
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err
      console.error('[appointments POST] calendar unusable:', err)
    }

    const result = await bookAppointment({
      db: supabase,
      accountId,
      contactId,
      conversationId:
        typeof body.conversation_id === 'string' ? body.conversation_id : null,
      startsAt: slot.slot.startsAt,
      endsAt: slot.slot.endsAt,
      title: typeof body.title === 'string' ? body.title.slice(0, 200) : null,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null,
      createdVia: 'manual',
      connection,
      timezone,
      appointmentLabel: settings?.appointmentLabel ?? null,
    })

    if (!result.ok) {
      const status =
        result.failure === 'slot_taken' || result.failure === 'already_booked'
          ? 409
          : 500
      return NextResponse.json(
        { error: result.message, code: result.failure },
        { status },
      )
    }

    return NextResponse.json(
      { appointment: result.appointment, calendar_synced: result.calendarSynced },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
