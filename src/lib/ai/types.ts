// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

/**
 * A provider id from `providers/catalog.ts`. Deliberately `string` and
 * not a union: the database column carries no CHECK either (migration
 * 037), because pinning the set in two places meant every new provider
 * needed a migration — and the two copies drifted. The catalog is the
 * single list; unknown ids fail with a typed `AiError`, not a constraint
 * violation the operator would read as a product bug.
 */
export type AiProvider = string

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  /** Overrides the preset origin — a gateway, or a self-hosted model.
   *  Null means "use the catalog's base URL for this provider". */
  baseUrl: string | null
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional key for an OpenAI-compatible embeddings endpoint. When
   *  set, the knowledge base is embedded and semantic retrieval turns
   *  on; when null, retrieval falls back to lexical full-text search.
   *  Independent of the chat provider — DeepSeek and Anthropic have no
   *  embeddings endpoint, so those accounts point this at someone else. */
  embeddingsApiKey: string | null
  /** Origin + model for embeddings. Null falls back to the chat
   *  provider's embeddings preset, when it has one. */
  embeddingsBaseUrl: string | null
  embeddingsModel: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
