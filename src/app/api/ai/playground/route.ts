import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { runAgent } from '@/lib/ai/agent'
import { buildEnvironment } from '@/lib/ai/environment'
import {
  buildToolCatalog,
  resolveSchedulingContext,
} from '@/lib/ai/tools/registry'
import { describeWeeklyHours } from '@/lib/scheduling/settings'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider — so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )
    const scheduling = await resolveSchedulingContext(supabase, accountId)

    // No contact here — the environment block still carries the date and
    // the shop hours, which is most of what makes a booking dialogue
    // testable at all.
    const environment = await buildEnvironment({
      db: supabase,
      accountId,
      contactId: null,
      timezone: scheduling?.settings.timezone,
      openingHours: scheduling ? describeWeeklyHours(scheduling.settings) : null,
    })
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      environment,
    })

    // Same catalog the live bot gets. Tools that need a conversation
    // report that they can't act rather than silently no-op'ing, so the
    // operator sees where the dialogue would have taken a real action.
    const tools = await buildToolCatalog({
      db: supabase,
      accountId,
      conversationId: null,
      scheduling,
    })

    const { text, handoff, steps } = await runAgent({
      config,
      systemPrompt,
      messages,
      tools,
      ctx: {
        db: supabase,
        accountId,
        conversationId: null,
        contactId: null,
        config,
        // Validate everything, write nothing. A rehearsal that booked
        // for real would leave rehearsal events in the shop's own Google
        // Calendar; one that could not book at all would stop short of
        // the step most worth rehearsing.
        dryRun: true,
      },
    })
    return NextResponse.json({
      reply: text,
      handoff,
      // What the agent actually did, so the dialogue can be tuned here
      // instead of on a real customer.
      steps: steps.map((s) => ({
        tool: s.toolName,
        arguments: s.arguments,
        result: s.result,
        is_error: s.isError,
        duration_ms: s.durationMs,
      })),
    })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
