import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'
import type { EmbeddingsTarget } from './embeddings'
import { resolveEmbeddingsTarget } from './providers/catalog'

interface AiConfigRow {
  provider: string
  model: string
  api_key: string
  base_url: string | null
  system_prompt: string | null
  is_active: boolean
  monthly_budget_usd: number | null
  ai_concurrency_limit: number | null
  ai_max_wait_seconds: number | null
  budget_exceeded_action: string | null
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  embeddings_base_url: string | null
  embeddings_model: string | null
  max_tool_steps: number | null
  context_timestamps: boolean
  handoff_notice_enabled: boolean
  handoff_notice_text: string | null
  new_session_hours: number
  context_message_limit: number | null
  audio_policy: string
  transcription_vocabulary: string | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key, embeddings_base_url, embeddings_model, max_tool_steps, context_timestamps, handoff_notice_enabled, handoff_notice_text, new_session_hours, context_message_limit, audio_policy, transcription_vocabulary, monthly_budget_usd, ai_concurrency_limit, ai_max_wait_seconds, budget_exceeded_action'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    baseUrl: row.base_url,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    monthlyBudgetUsd: row.monthly_budget_usd,
    aiConcurrencyLimit: row.ai_concurrency_limit ?? 5,
    aiMaxWaitSeconds: row.ai_max_wait_seconds ?? 300,
    budgetExceededAction: row.budget_exceeded_action ?? 'block_and_handoff',
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    embeddingsBaseUrl: row.embeddings_base_url,
    embeddingsModel: row.embeddings_model,
    maxToolSteps: row.max_tool_steps,
    contextTimestamps: row.context_timestamps,
    handoffNoticeEnabled: row.handoff_notice_enabled,
    handoffNoticeText: row.handoff_notice_text,
    newSessionHours: row.new_session_hours,
    contextMessageLimit: row.context_message_limit,
    audioPolicy: row.audio_policy,
    transcriptionVocabulary: row.transcription_vocabulary,
  }
}

/**
 * Load + decrypt the embeddings target, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ target, corrupt }`: `target` is null when there's no key,
 * the key can't be decrypted, or there's nowhere to send it; `corrupt`
 * distinguishes the undecryptable case so callers can warn ("a key is
 * set but unusable") rather than silently indexing lexical-only and
 * reporting success.
 */
export async function loadEmbeddingsTarget(
  db: SupabaseClient,
  accountId: string,
): Promise<{ target: EmbeddingsTarget | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('provider, embeddings_api_key, embeddings_base_url, embeddings_model')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { target: null, corrupt: false }

  let apiKey: string
  try {
    apiKey = decrypt(data.embeddings_api_key)
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { target: null, corrupt: true }
  }

  return {
    target: resolveEmbeddingsTarget({
      provider: data.provider,
      embeddingsApiKey: apiKey,
      embeddingsBaseUrl: data.embeddings_base_url,
      embeddingsModel: data.embeddings_model,
    }),
    corrupt: false,
  }
}
