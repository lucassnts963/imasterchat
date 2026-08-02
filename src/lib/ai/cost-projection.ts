import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { buildSystemPrompt, maxToolSteps } from './defaults'
import { buildEnvironment } from './environment'
import { describeVaultContext, loadVaultContext } from './vault/retrieve'
import { describeGuardrails, loadGuardrails } from './guardrails'
import { buildToolCatalog, resolveSchedulingContext } from './tools/registry'
import { describeWeeklyHours } from '@/lib/scheduling/settings'
import { estimateCostUsd } from './pricing'

// ============================================================
// What one reply costs, and where the cost is.
//
// The number that matters is not "tokens per month" — it is that EVERY
// reply re-sends the whole prompt. Rules, guardrails, environment,
// knowledge, tool schemas: all of it, every message, and once per step
// of the agent loop. A section that looks small is paid for on every
// message of every conversation forever, which is a different kind of
// small.
//
// So the breakdown is the point. A total tells you it is expensive; a
// breakdown tells you what to cut, and cutting is the only thing that
// actually lowers it.
//
// TOKENS ARE ESTIMATED. There is no tokenizer here, and adding one
// would be a heavy per-provider dependency that goes stale. Characters
// per token is a decent approximation and a poor guarantee, so every
// caller must label the result an estimate — and once `ai_usage_log`
// has rows, the measured average is reported beside it so the operator
// can see how far off this is rather than trusting it.
// ============================================================

/**
 * Characters per token, Portuguese.
 *
 * English lands near 4. Portuguese is worse — accented characters cost
 * more than one byte and tokenizers split them, and the language uses
 * longer words. 3.5 is deliberately pessimistic: over-estimating cost
 * makes an operator cautious, under-estimating makes them surprised by
 * a bill.
 */
const CHARS_PER_TOKEN = 3.5

/** Typical WhatsApp message, in characters. Used to size the transcript
 *  when the account has no history to measure. */
const FALLBACK_MESSAGE_CHARS = 120

export interface CostSection {
  key: string
  chars: number
  tokens: number
}

export interface CostProjection {
  /** Per section of the assembled prompt, largest first. */
  sections: CostSection[]
  promptTokens: number
  completionTokens: number
  /** Provider round-trips a single reply may take. */
  steps: number
  costPerReplyUsd: number
  /** Inbound customer messages in the last 30 days. 0 when brand new. */
  messagesLast30Days: number
  projectedMonthlyUsd: number
  /** True when any price came from the class fallback rather than a
   *  known model family. */
  priceEstimated: boolean
  /** Measured average from `ai_usage_log`, when there is any. This is
   *  what tells the operator whether to believe the estimate. */
  measured: {
    calls: number
    avgPromptTokens: number
    avgCompletionTokens: number
  } | null
}

/**
 * Assemble the same prompt a real reply would carry and measure each
 * piece.
 *
 * Built from the real builders rather than from guesses: if the vault
 * grows or a guardrail is added, this moves, because it is the same
 * code the customer-facing path runs.
 */
export async function projectReplyCost(
  db: SupabaseClient,
  accountId: string,
  config: AiConfig,
): Promise<CostProjection> {
  const scheduling = await resolveSchedulingContext(db, accountId)

  const [environment, vault, guardrails, tools] = await Promise.all([
    buildEnvironment({
      db,
      accountId,
      contactId: null,
      timezone: scheduling?.settings.timezone,
      openingHours: scheduling ? describeWeeklyHours(scheduling.settings) : null,
    }),
    loadVaultContext(db, accountId, null),
    loadGuardrails(db, accountId),
    buildToolCatalog({ db, accountId, conversationId: null, scheduling }),
  ])

  // The fixed scaffold, measured by building the prompt with nothing in
  // it — so the number is whatever the scaffold actually is today, not
  // a constant somebody forgot to update.
  const scaffold = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })

  const vaultParts = describeVaultContext(vault)
  const guardrailText = describeGuardrails(guardrails) ?? ''

  // The knowledge base contributes whatever `retrieveKnowledge` would
  // return: up to five chunks. Sized from the real chunks rather than
  // fetched, because the projection must not depend on a query.
  const knowledgeChars = await averageKnowledgeChars(db, accountId)

  const [avgMessageChars, messagesLast30Days] = await Promise.all([
    averageMessageChars(db, accountId),
    countInboundLast30Days(db, accountId),
  ])

  // Tool schemas ride on every request too, and are easy to forget:
  // they are JSON, so they are dense, and they grow with every tool.
  const toolsJson = JSON.stringify(
    tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
  )

  const transcriptChars = avgMessageChars * 20 // aiContextMessageLimit default

  const sections: CostSection[] = [
    section('scaffold', scaffold.length),
    section('system_prompt', (config.systemPrompt ?? '').length),
    section('environment', environment.length),
    section('vault', vaultParts.join('\n\n').length),
    section('guardrails', guardrailText.length),
    section('knowledge', knowledgeChars),
    section('tools', toolsJson.length),
    section('transcript', transcriptChars),
  ]
    .filter((s) => s.chars > 0)
    .sort((a, b) => b.tokens - a.tokens)

  const promptTokens = sections.reduce((sum, s) => sum + s.tokens, 0)

  const measured = await measuredAverages(db, accountId)
  // Prefer what the provider actually reported for completions — a
  // reply's length is the one part we cannot infer from configuration.
  const completionTokens = measured?.avgCompletionTokens || 180

  // A reply that uses tools pays the prompt once per step. Without
  // tools it is one call, which is why an account with scheduling off
  // costs a fraction of one with it on.
  const steps = tools.length > 1 ? Math.min(maxToolSteps(config), 3) : 1

  const cost = estimateCostUsd(
    config.model,
    promptTokens * steps,
    completionTokens * steps,
  )

  return {
    sections,
    promptTokens,
    completionTokens,
    steps,
    costPerReplyUsd: cost.usd,
    messagesLast30Days,
    projectedMonthlyUsd: cost.usd * messagesLast30Days,
    priceEstimated: cost.fallback,
    measured,
  }
}

function section(key: string, chars: number): CostSection {
  return { key, chars, tokens: Math.ceil(chars / CHARS_PER_TOKEN) }
}

/** Five chunks is what `retrieveKnowledge` asks for; size them from the
 *  account's own chunks so a shop with long documents sees that. */
async function averageKnowledgeChars(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  try {
    const { data } = await db
      .from('ai_knowledge_chunks')
      .select('content')
      .eq('account_id', accountId)
      .limit(20)
    const rows = (data ?? []) as { content: string }[]
    if (rows.length === 0) return 0
    const avg =
      rows.reduce((sum, r) => sum + (r.content?.length ?? 0), 0) / rows.length
    return Math.round(avg * Math.min(5, rows.length))
  } catch {
    return 0
  }
}

async function averageMessageChars(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  try {
    const { data } = await db
      .from('messages')
      .select('content_text, conversations!inner(account_id)')
      .eq('conversations.account_id', accountId)
      .eq('content_type', 'text')
      .order('created_at', { ascending: false })
      .limit(200)
    const rows = (data ?? []) as { content_text: string | null }[]
    const lengths = rows
      .map((r) => r.content_text?.length ?? 0)
      .filter((n) => n > 0)
    if (lengths.length === 0) return FALLBACK_MESSAGE_CHARS
    return Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
  } catch {
    return FALLBACK_MESSAGE_CHARS
  }
}

/** What the monthly projection multiplies by. Inbound only: the bot
 *  answers customer messages, not its own. */
async function countInboundLast30Days(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()
    const { count } = await db
      .from('messages')
      .select('id, conversations!inner(account_id)', {
        count: 'exact',
        head: true,
      })
      .eq('conversations.account_id', accountId)
      .eq('sender_type', 'customer')
      .gte('created_at', since)
    return count ?? 0
  } catch {
    return 0
  }
}

/**
 * The measured average, which is the only honest check on everything
 * above. Reported beside the estimate rather than replacing it: the
 * estimate answers "what will this cost", the measurement answers "was
 * the estimate any good".
 */
async function measuredAverages(
  db: SupabaseClient,
  accountId: string,
): Promise<CostProjection['measured']> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()
    const { data } = await db
      .from('ai_usage_log')
      .select('prompt_tokens, completion_tokens')
      .eq('account_id', accountId)
      .in('mode', ['auto_reply', 'agent'])
      .gte('created_at', since)
      .limit(2000)

    const rows = (data ?? []) as {
      prompt_tokens: number
      completion_tokens: number
    }[]
    if (rows.length === 0) return null

    return {
      calls: rows.length,
      avgPromptTokens: Math.round(
        rows.reduce((s, r) => s + r.prompt_tokens, 0) / rows.length,
      ),
      avgCompletionTokens: Math.round(
        rows.reduce((s, r) => s + r.completion_tokens, 0) / rows.length,
      ),
    }
  } catch {
    return null
  }
}
