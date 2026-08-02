import type { SupabaseClient } from '@supabase/supabase-js'
import { previewText, sendPushToAccount } from '@/lib/push/send'

// ============================================================
// Handing a conversation to a human — the one implementation.
//
// Three callers need this and must not drift apart, because the
// attendant's experience should be identical no matter who asked:
//   - the in-app agent's `request_human` tool
//   - `dispatchInboundToAiReply`, when the model bails
//   - `POST /api/v1/conversations/{id}/handoff`, for an external brain
//
// What a handoff does:
//   status → 'pending'        the queue built for "a human must look"
//   ai_autoreply_disabled     the bot stays quiet here, permanently
//   ai_handoff_summary        the note the inbox banner renders
//   assigned_agent_id         only when named AND nobody owns it yet
//
// What it deliberately does NOT do: message the customer. Telling them
// "let me get someone" is the caller's decision — the auto-reply path
// stays silent, while a bot that already promised a human should not
// send it twice.
// ============================================================

export type HandoffFailure = 'not_found' | 'invalid_assignee' | 'internal'

export interface HandoffArgs {
  /** Service-role client from the webhook, or the RLS-scoped client
   *  from a route — both work, the account filter does the scoping. */
  db: SupabaseClient
  accountId: string
  conversationId: string
  /**
   * The note the attendant reads before opening the thread. Passed in
   * fully composed (see `buildHandoffSummary`) rather than built here:
   * the auto-reply path summarizes the transcript, while an API caller
   * states its own reason.
   */
  summary: string
  /** Agent to park the thread on. Null leaves it in the shared queue. */
  assignTo?: string | null
}

export type HandoffResult =
  | { ok: true; assignedAgentId: string | null }
  | { ok: false; failure: HandoffFailure; message: string }

/** Longest note stored — matches what the inbox banner can show. */
export const MAX_HANDOFF_SUMMARY_LEN = 500

export async function handOffConversation(
  args: HandoffArgs,
): Promise<HandoffResult> {
  const { db, accountId, conversationId, assignTo = null } = args
  const summary = args.summary.trim().slice(0, MAX_HANDOFF_SUMMARY_LEN)

  const { data: conv, error: convErr } = await db
    .from('conversations')
    .select('id, assigned_agent_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle<{ id: string; assigned_agent_id: string | null }>()

  if (convErr) {
    console.error('[handoff] conversation lookup error:', convErr)
    return { ok: false, failure: 'internal', message: 'Failed to load conversation' }
  }
  if (!conv) {
    return { ok: false, failure: 'not_found', message: 'Conversation not found' }
  }

  // A named assignee must belong to THIS account. The caller is already
  // account-scoped, but `assignTo` comes from outside — without this
  // check a valid key could park a thread on a stranger's user id.
  if (assignTo) {
    const { data: member, error: memberErr } = await db
      .from('profiles')
      .select('user_id')
      .eq('user_id', assignTo)
      .eq('account_id', accountId)
      .maybeSingle()

    if (memberErr) {
      console.error('[handoff] member lookup error:', memberErr)
      return { ok: false, failure: 'internal', message: 'Failed to verify the assignee' }
    }
    if (!member) {
      return {
        ok: false,
        failure: 'invalid_assignee',
        message: 'The assignee is not a member of this account',
      }
    }
  }

  const update: Record<string, unknown> = {
    status: 'pending',
    ai_autoreply_disabled: true,
    ai_handoff_summary: summary,
  }
  // Never steal a thread a human already owns. When someone is on it,
  // the handoff still flags the queue and leaves the note.
  if (assignTo && !conv.assigned_agent_id) {
    update.assigned_agent_id = assignTo
  }

  const { error: upErr } = await db
    .from('conversations')
    .update(update)
    .eq('id', conversationId)
    .eq('account_id', accountId)

  if (upErr) {
    console.error('[handoff] update error:', upErr)
    return { ok: false, failure: 'internal', message: 'Failed to hand off the conversation' }
  }

  // The one event that always deserves a phone buzzing. Every route
  // into a handoff passes through here — request_human, a keyword
  // guardrail, the model giving up — so this is the single place that
  // knows a conversation now needs a person.
  //
  // Fire-and-forget: `sendPushToAccount` swallows its own errors, and a
  // push service being slow must not delay the write that just marked
  // the thread pending.
  void sendPushToAccount(db, {
    accountId,
    urgency: 'human_needed',
    payload: {
      title: 'Atendimento precisa de você',
      body: previewText(summary.replace(/^🤖\s*/, '')),
      url: `/inbox?conversation=${conversationId}`,
      tag: `handoff:${conversationId}`,
      urgent: true,
    },
  })

  return {
    ok: true,
    assignedAgentId:
      (update.assigned_agent_id as string | undefined) ?? conv.assigned_agent_id,
  }
}
