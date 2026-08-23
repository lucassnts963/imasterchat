// ============================================================
// GET   /api/v1/appointments/{id} — read   (scope: appointments:read)
// PATCH /api/v1/appointments/{id} — update (scope: appointments:write)
//
// PATCH covers both reschedule (new starts_at/ends_at) and cancel
// (status: 'cancelled'). There is no DELETE: a cancelled appointment is
// history the optician wants to keep — who cancelled, when, and whether
// the customer came back. Deleting it would erase the one record that
// explains a gap in the calendar.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  APPOINTMENT_SELECT,
  APPOINTMENT_SCOPES,
  isAppointmentStatus,
  parseSlot,
  serializeAppointment,
  SLOT_ERROR_MESSAGE,
  type AppointmentRow,
} from '@/lib/api/v1/appointments';

const MAX_TITLE_LEN = 200;
const MAX_NOTES_LEN = 2000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, APPOINTMENT_SCOPES.read);
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/appointments] read error:', error);
      return fail('internal', 'Failed to read the appointment', 500);
    }
    if (!data) return fail('not_found', 'Appointment not found', 404);

    return ok(serializeAppointment(data as AppointmentRow));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, APPOINTMENT_SCOPES.write);
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return fail('bad_request', 'Invalid JSON body', 400);

    const update: Record<string, unknown> = {};

    // Reschedule: both ends must move together. Accepting one alone
    // would let a caller invert the slot or silently change the
    // duration, and the CHECK constraint would surface it as a 500.
    if (body.starts_at !== undefined || body.ends_at !== undefined) {
      if (body.starts_at === undefined || body.ends_at === undefined) {
        return fail(
          'bad_request',
          "'starts_at' and 'ends_at' must be sent together",
          400,
        );
      }
      const slot = parseSlot(body.starts_at, body.ends_at);
      if (!slot.ok) {
        return fail('bad_request', SLOT_ERROR_MESSAGE[slot.error], 400);
      }
      update.starts_at = slot.slot.startsAt.toISOString();
      update.ends_at = slot.slot.endsAt.toISOString();
    }

    if (body.status !== undefined) {
      if (!isAppointmentStatus(body.status)) {
        return fail('bad_request', `Unknown status '${String(body.status)}'`, 400);
      }
      update.status = body.status;
    }

    if (body.title !== undefined) {
      update.title =
        typeof body.title === 'string'
          ? body.title.slice(0, MAX_TITLE_LEN)
          : null;
    }
    if (body.notes !== undefined) {
      update.notes =
        typeof body.notes === 'string'
          ? body.notes.slice(0, MAX_NOTES_LEN)
          : null;
    }
    if (body.google_event_id !== undefined) {
      update.google_event_id =
        typeof body.google_event_id === 'string' ? body.google_event_id : null;
    }

    if (Object.keys(update).length === 0) {
      return fail('bad_request', 'Nothing to update', 400);
    }

    const { data, error } = await ctx.supabase
      .from('appointments')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(APPOINTMENT_SELECT)
      .maybeSingle();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return fail('bad_request', 'That time slot is already booked', 409);
      }
      console.error('[api/v1/appointments] update error:', error);
      return fail('internal', 'Failed to update the appointment', 500);
    }
    if (!data) return fail('not_found', 'Appointment not found', 404);

    return ok(serializeAppointment(data as AppointmentRow));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
