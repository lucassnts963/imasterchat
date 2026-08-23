import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { GoogleError } from '@/lib/google/oauth'
import { loadGoogleConnection } from '@/lib/google/connection'
import {
  loadSchedulingSettings,
  DEFAULT_TIMEZONE,
} from '@/lib/scheduling/settings'
import { cancelAppointment, rescheduleAppointment } from '@/lib/scheduling/store'
import { parseSlot, SLOT_ERROR_MESSAGE } from '@/lib/api/v1/appointments'

// ============================================================
// PATCH /api/appointments/{id}  (agent+)
//
// Move it or call it off. No DELETE: a cancelled appointment is history
// the shop wants — who cancelled, when, and whether the customer came
// back. Deleting it would erase the one record that explains a gap in
// the day.
// ============================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const settings = await loadSchedulingSettings(supabase, accountId)
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE

    let connection = null
    try {
      connection = await loadGoogleConnection(supabase, accountId)
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err
      console.error('[appointments PATCH] calendar unusable:', err)
    }

    const result =
      body.status === 'cancelled'
        ? await cancelAppointment({
            db: supabase,
            accountId,
            appointmentId: id,
            reason:
              typeof body.cancellation_reason === 'string'
                ? body.cancellation_reason.slice(0, 500)
                : null,
            connection,
          })
        : await rescheduleOrFail(
            { supabase, accountId, id, connection, timezone },
            body,
          )

    if ('response' in result) return result.response
    if (!result.ok) {
      const status =
        result.failure === 'not_found'
          ? 404
          : result.failure === 'slot_taken' || result.failure === 'already_booked'
            ? 409
            : 500
      return NextResponse.json(
        { error: result.message, code: result.failure },
        { status },
      )
    }

    return NextResponse.json({
      appointment: result.appointment,
      calendar_synced: result.calendarSynced,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

type PatchContext = {
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase']
  accountId: string
  id: string
  connection: Awaited<ReturnType<typeof loadGoogleConnection>>
  timezone: string
}

/** Reschedule, or hand back the 400 the caller earned. */
async function rescheduleOrFail(
  ctx: PatchContext,
  body: Record<string, unknown>,
): Promise<
  Awaited<ReturnType<typeof rescheduleAppointment>> | { response: NextResponse }
> {
  const slot = parseSlot(body.starts_at, body.ends_at)
  if (!slot.ok) {
    return {
      response: NextResponse.json(
        { error: SLOT_ERROR_MESSAGE[slot.error], code: slot.error },
        { status: 400 },
      ),
    }
  }

  return rescheduleAppointment({
    db: ctx.supabase,
    accountId: ctx.accountId,
    appointmentId: ctx.id,
    startsAt: slot.slot.startsAt,
    endsAt: slot.slot.endsAt,
    connection: ctx.connection,
    timezone: ctx.timezone,
  })
}
