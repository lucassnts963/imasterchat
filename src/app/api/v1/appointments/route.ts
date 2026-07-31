// ============================================================
// GET  /api/v1/appointments — list  (scope: appointments:read)
// POST /api/v1/appointments — book  (scope: appointments:write)
//
// The CRM-side booking record. Availability is NOT decided here —
// Google Calendar owns that (see migration 041 and
// docs/agendamento-google-calendar.md). The caller checks the calendar,
// creates the event, then records it here so the history lives in the
// product regardless of which brain drove the dialogue.
//
// List supports `?contact_id=`, `?status=`, `?from=` / `?to=` (ISO
// datetimes on starts_at) and is keyset-paginated like every other v1
// collection.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
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

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, APPOINTMENT_SCOPES.read);
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);

    let query = ctx.supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('account_id', ctx.accountId);

    const contactId = url.searchParams.get('contact_id');
    if (contactId) query = query.eq('contact_id', contactId);

    const status = url.searchParams.get('status');
    if (status) {
      if (!isAppointmentStatus(status)) {
        return fail('bad_request', `Unknown status '${status}'`, 400);
      }
      query = query.eq('status', status);
    }

    // `from`/`to` filter the SLOT, not the row's creation time — "what
    // is booked next week" is the question this endpoint gets asked.
    const from = url.searchParams.get('from');
    if (from) {
      if (Number.isNaN(Date.parse(from))) {
        return fail('bad_request', "'from' must be an ISO 8601 datetime", 400);
      }
      query = query.gte('starts_at', from);
    }
    const to = url.searchParams.get('to');
    if (to) {
      if (Number.isNaN(Date.parse(to))) {
        return fail('bad_request', "'to' must be an ISO 8601 datetime", 400);
      }
      query = query.lte('starts_at', to);
    }

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/appointments] list error:', error);
      return fail('internal', 'Failed to list appointments', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<AppointmentRow & { created_at: string; id: string }>,
      limit,
    );
    return okList(items.map(serializeAppointment), nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, APPOINTMENT_SCOPES.write);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return fail('bad_request', 'Invalid JSON body', 400);

    if (typeof body.contact_id !== 'string' || !body.contact_id) {
      return fail('bad_request', "'contact_id' is required", 400);
    }

    const slot = parseSlot(body.starts_at, body.ends_at);
    if (!slot.ok) {
      return fail('bad_request', SLOT_ERROR_MESSAGE[slot.error], 400);
    }

    // The contact must belong to this account. The key is account-scoped
    // but contact_id is caller-supplied, so without this a valid key
    // could attach a booking to another tenant's contact.
    const { data: contact, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', body.contact_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (contactErr) {
      console.error('[api/v1/appointments] contact lookup error:', contactErr);
      return fail('internal', 'Failed to verify the contact', 500);
    }
    if (!contact) return fail('bad_request', 'Unknown contact_id', 400);

    if (body.conversation_id !== undefined && body.conversation_id !== null) {
      if (typeof body.conversation_id !== 'string') {
        return fail('bad_request', "'conversation_id' must be a string", 400);
      }
      const { data: conv, error: convErr } = await ctx.supabase
        .from('conversations')
        .select('id')
        .eq('id', body.conversation_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (convErr) {
        console.error('[api/v1/appointments] conversation lookup error:', convErr);
        return fail('internal', 'Failed to verify the conversation', 500);
      }
      if (!conv) return fail('bad_request', 'Unknown conversation_id', 400);
    }

    const insert = {
      account_id: ctx.accountId,
      contact_id: body.contact_id,
      conversation_id: (body.conversation_id as string | null) ?? null,
      starts_at: slot.slot.startsAt.toISOString(),
      ends_at: slot.slot.endsAt.toISOString(),
      title:
        typeof body.title === 'string'
          ? body.title.slice(0, MAX_TITLE_LEN)
          : null,
      notes:
        typeof body.notes === 'string'
          ? body.notes.slice(0, MAX_NOTES_LEN)
          : null,
      google_event_id:
        typeof body.google_event_id === 'string' ? body.google_event_id : null,
      google_calendar_id:
        typeof body.google_calendar_id === 'string'
          ? body.google_calendar_id
          : null,
      // Anything booked through the public API is, by definition, not a
      // human clicking in the dashboard.
      created_via: body.created_via === 'native' ? 'native' : 'n8n',
    };

    const { data, error } = await ctx.supabase
      .from('appointments')
      .insert(insert)
      .select(APPOINTMENT_SELECT)
      .single();

    if (error) {
      // 23505 = unique violation. Three partial indexes can raise it
      // (one live booking per slot, one per contact, one per Google
      // event) and each means something different to the caller, so
      // they get distinct codes instead of a generic 500. A retried
      // workflow hitting the same slot is the expected case, not a bug.
      if ((error as { code?: string }).code === '23505') {
        const detail = String((error as { message?: string }).message ?? '');
        if (detail.includes('one_live_per_contact')) {
          return fail(
            'bad_request',
            'This contact already has a scheduled appointment',
            409,
          );
        }
        if (detail.includes('google_event')) {
          return fail(
            'bad_request',
            'This Google Calendar event is already recorded',
            409,
          );
        }
        return fail('bad_request', 'That time slot is already booked', 409);
      }
      console.error('[api/v1/appointments] insert error:', error);
      return fail('internal', 'Failed to create the appointment', 500);
    }

    return ok(serializeAppointment(data as AppointmentRow), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
