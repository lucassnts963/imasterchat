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
  /** How many provider round-trips one reply may take when the account
   *  has tools. Optional on purpose: it is a tuning knob, not part of
   *  what makes a config valid, so callers that build one by hand (the
   *  "test key" route, the config preview) need not care. Unset falls
   *  back to `AI_MAX_TOOL_STEPS`, then the built-in default. */
  maxToolSteps?: number | null
  /** Marcar cada mensagem do transcript com quando foi dita. Ver
   *  `./transcript-stamp.ts` — é o que separa ontem de hoje. */
  contextTimestamps?: boolean
  /** Avisar o cliente quando a conversa for passada para uma pessoa.
   *  Desligado por padrão — ligar faz o bot enviar uma mensagem a mais. */
  handoffNoticeEnabled?: boolean
  /** O texto do aviso, nas palavras da conta. Nulo usa o padrão. */
  handoffNoticeText?: string | null
  /** Teto de gasto do mês, em dólares. Nulo = sem teto. */
  monthlyBudgetUsd?: number | null
  /** Quantas respostas a IA gera em paralelo nesta conta. */
  aiConcurrencyLimit?: number
  /** Quanto uma conversa pode esperar na fila antes de virar gente. */
  aiMaxWaitSeconds?: number
  /** 'block_and_handoff' (padrão) | 'notify_only' */
  budgetExceededAction?: string
  /** A partir de quantas horas de silêncio um retorno é conversa nova. */
  newSessionHours?: number
  /** Mensagens do histórico enviadas ao modelo. Null cai na variável de
   *  ambiente e, na falta dela, no padrão — mesma regra de
   *  `maxToolSteps`. */
  contextMessageLimit?: number | null
  /** O que a conta faz com áudio. Só `transcribe` muda o prompt. */
  audioPolicy?: string
  /** Jargão do ramo para enviesar o transcritor local. */
  transcriptionVocabulary?: string | null
}

/**
 * A tool as the *provider* needs to see it: a name, a description the
 * model reads to decide when to call it, and a JSON Schema for the
 * arguments. Deliberately separate from the executable tool (see
 * `AgentTool` in `tools/registry.ts`) — the wire format has no business
 * knowing how the work gets done.
 */
export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the arguments object (`{ type: 'object', ... }`). */
  parameters: Record<string, unknown>
}

/** The model asking for a tool to run. */
export interface ToolCall {
  /** Provider-assigned id — pairs this call with its result. */
  id: string
  name: string
  /**
   * Parsed arguments. OpenAI sends a JSON *string* the model wrote
   * freehand, so it can be malformed; when parsing fails this is `{}`
   * and `argumentsError` explains why. The loop then feeds the error
   * back as a tool result instead of throwing — a model that emits bad
   * JSON should get a chance to fix it, not kill the conversation.
   */
  arguments: Record<string, unknown>
  argumentsError?: string
}

/**
 * A single conversation turn in the shape both providers accept.
 *
 * `content` stays a plain string for the common case (a text turn), so
 * every existing call site — `buildConversationContext`, the playground,
 * `buildHandoffSummary` — keeps working untouched. The optional fields
 * carry the agent loop's extra turns.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** `assistant` only: tools the model asked to run on this turn. */
  toolCalls?: ToolCall[]
  /** `tool` only: which call this result answers. */
  toolCallId?: string
  /** `tool` only: the tool failed. The model should recover or hand off. */
  isError?: boolean
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
  /** Tools the model wants run before it can answer. Empty when it just
   *  replied — which is every call for an account with no tools. */
  toolCalls: ToolCall[]
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
  /**
   * Quanto o PROVEDOR pediu para esperar, em ms — o `Retry-After` de um
   * 429. Mutável porque é preenchido logo após a construção, em
   * `providerHttpError`, que é quem tem a resposta HTTP em mãos.
   *
   * `null` quando ele não disse nada; aí quem tenta de novo escolhe o
   * próprio intervalo.
   */
  retryAfterMs: number | null = null
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
