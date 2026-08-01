// ============================================================
// POST /api/v1/conversations/{id}/handoff — hand a thread to a human
// (scope: conversations:handoff). Account-scoped: a foreign id → 404.
//
// Why this exists
// ---------------
// The app already has a good handoff mechanism, but it is reachable
// only from two places: the in-app AI (which emits the [[HANDOFF]]
// sentinel) and the inbox banner (session-authenticated). An external
// brain — today the n8n booking agent, see
// docs/agendamento-google-calendar.md — has neither. Without this route
// "call a human" degrades to tagging the contact and hoping somebody
// looks, which defeats the point of an autonomous bot that knows when
// to stop.
//
// It performs exactly what the native handoff does, so the attendant's
// experience is identical no matter which brain asked for help:
//   - status → 'pending'      (lands in the pending queue)
//   - ai_autoreply_disabled   (the in-app bot stays quiet on this thread
//                              even if it is later switched on)
//   - ai_handoff_summary      (the note rendered by the inbox banner)
//   - assigned_agent_id       (optional, when the caller names someone)
//
// Deliberately NOT here: sending a WhatsApp message to the customer.
// Telling them "let me get someone" is the bot's job and it already has
// messages:send — coupling it in would send a message the caller may
// have already sent.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { handOffConversation } from '@/lib/conversations/handoff';

/** Matches the inbox banner's note column; longer notes are truncated. */
const MAX_REASON_LEN = 500;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:handoff');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      reason?: unknown;
      assign_to?: unknown;
    } | null;

    // `reason` is what the attendant reads before opening the thread, so
    // it is required — a handoff with no explanation makes the human
    // re-read the whole conversation to find out why they were called.
    const rawReason = body?.reason;
    if (typeof rawReason !== 'string' || !rawReason.trim()) {
      return fail('bad_request', "'reason' is required", 400);
    }
    const reason = rawReason.trim().slice(0, MAX_REASON_LEN);

    const assignTo =
      typeof body?.assign_to === 'string' && body.assign_to
        ? body.assign_to
        : null;

    const result = await handOffConversation({
      db: ctx.supabase,
      accountId: ctx.accountId,
      conversationId: id,
      summary: `🤖 ${reason}`,
      assignTo,
    });

    if (!result.ok) {
      if (result.failure === 'not_found') {
        return fail('not_found', result.message, 404);
      }
      if (result.failure === 'invalid_assignee') {
        return fail('bad_request', "'assign_to' is not a member of this account", 400);
      }
      return fail('internal', result.message, 500);
    }

    return ok({
      conversation_id: id,
      status: 'pending',
      assigned_agent_id: result.assignedAgentId,
      reason,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
