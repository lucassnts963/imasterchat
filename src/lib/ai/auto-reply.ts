import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { runAgent } from './agent'
import { buildEnvironment } from './environment'
import {
  describeGuardrails,
  guardrailHandoffSummary,
  loadGuardrails,
  matchKeywordGuardrail,
} from './guardrails'
import { describeVaultContext, loadVaultContext } from './vault/retrieve'
import { buildToolCatalog, resolveSchedulingContext } from './tools/registry'
import { describeWeeklyHours } from '@/lib/scheduling/settings'
import { recordAgentSteps } from './steps'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { handOffConversation } from '@/lib/conversations/handoff'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    // The customer just spoke, so the reply budget starts over (045).
    // It bounds a bot talking when nobody is talking to it — not a long
    // back-and-forth the customer is driving. Done before the read below
    // so the cap check sees the reset value, and filtered on `gt` so a
    // conversation already at zero costs no write.
    //
    // This also un-sticks a thread that hit the cap once and went mute:
    // the next message from that customer wakes the bot up again.
    await db
      .from('conversations')
      .update({ ai_reply_count: 0 })
      .eq('id', conversationId)
      .gt('ai_reply_count', 0)

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_reply_total',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // The shop's own list of what the bot must not touch. Loaded before
    // anything is spent, because half of it is enforced right here.
    const guardrails = await loadGuardrails(db, accountId)

    // Keyword guardrails run BEFORE the model — no provider call, no
    // chance of the model being argued out of it. A customer who says
    // "advogado" gets a person, and gets one whether or not the LLM
    // would have agreed that this counts.
    const tripped = matchKeywordGuardrail(
      latestUserMessage(messages),
      guardrails.keywords,
    )
    if (tripped) {
      await handOffConversation({
        db,
        accountId,
        conversationId,
        summary: guardrailHandoffSummary(tripped),
        assignTo: config.handoffAgentId,
      })
      return
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Resolved once and shared: the tool catalog needs it to decide
    // whether booking exists, and the environment block needs the shop's
    // timezone and hours.
    const scheduling = await resolveSchedulingContext(db, accountId)

    // Who we're talking to and what day it is. Cheap, and it removes a
    // whole class of confidently-wrong answers about dates.
    const environment = await buildEnvironment({
      db,
      accountId,
      contactId,
      timezone: scheduling?.settings.timezone,
      openingHours: scheduling ? describeWeeklyHours(scheduling.settings) : null,
    })

    // The wiki the account maintains: approved rules, what is true
    // right now, and this customer's own page. Only approved pages —
    // a draft is a proposal, not something to answer a customer with.
    const vault = await loadVaultContext(db, accountId, contactId)

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      environment,
      vault: describeVaultContext(vault),
      guardrails: describeGuardrails(guardrails),
    })

    // The tools this account actually has. `request_human` is always
    // there; scheduling appears only when it is switched on.
    const tools = await buildToolCatalog({
      db,
      accountId,
      conversationId,
      scheduling,
    })

    const { text, handoff, handoffSource, usage, steps } = await runAgent({
      config,
      systemPrompt,
      messages,
      tools,
      ctx: { db, accountId, conversationId, contactId, config },
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way. A run that used tools is logged as 'agent' so the cost of the
    // loop is separable from a plain reply.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: steps.length > 0 ? 'agent' : 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    // Same treatment for the audit trail — never on the critical path.
    if (steps.length > 0) {
      void recordAgentSteps(db, { accountId, conversationId, steps })
    }

    if (handoff || !text) {
      // The model can't (or shouldn't) answer. `request_human` already
      // wrote the handoff, with a reason better than anything we could
      // reconstruct here — don't overwrite it. Otherwise record it now:
      // pause the bot on this thread (sticky until re-enabled), route to
      // the configured agent (null leaves it in the shared queue), and
      // leave a note for whoever picks it up. Assigning fires the
      // `on_conversation_assigned` trigger, which notifies the agent.
      if (handoffSource !== 'tool') {
        await handOffConversation({
          db,
          accountId,
          conversationId,
          summary: buildHandoffSummary({
            messages,
            // The lifetime tally, not the per-turn budget: "handed off
            // after 6 replies" tells the attendant how long the bot had
            // been at this, which the reset counter no longer can.
            replyCount: conv.ai_reply_total ?? 0,
          }),
          assignTo: config.handoffAgentId,
        })
      }
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
