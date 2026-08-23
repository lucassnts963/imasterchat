import type { AiConfig, AiProvider } from '../types'

// ============================================================
// The providers this CRM knows how to talk to.
//
// Two things live here on purpose, because when they lived apart they
// drifted: what the settings screen OFFERS, and what `generateReply`
// EXECUTES. A provider missing from this list is rejected by the config
// route with a typed error; a provider present here always resolves to a
// wire format that has an adapter.
//
// The key insight is that "provider" is not the axis that matters to the
// code — WIRE FORMAT is. There are only two request/response shapes in
// this codebase (OpenAI chat-completions and Anthropic messages), and
// DeepSeek, OpenRouter and every other OpenAI-compatible host is the
// first shape pointed at a different origin. So adding a provider is a
// row in this table, never a new adapter.
// ============================================================

/** The request/response shape, i.e. which adapter runs the call. */
export type WireFormat = 'openai' | 'anthropic'

export interface EmbeddingsPreset {
  /** Origin for `POST {baseUrl}/embeddings`. */
  baseUrl: string
  /** Starting point, not an allow-list — the field stays free text. */
  defaultModel: string
}

export interface ProviderPreset {
  id: AiProvider
  label: string
  wire: WireFormat
  /**
   * Origin the adapter appends its path to (`/chat/completions`,
   * `/messages`). No trailing slash. For `custom` this is empty and the
   * operator supplies it — see `resolveChatBaseUrl`.
   */
  baseUrl: string
  defaultModel: string
  keyPlaceholder: string
  /** Shown in the UI so the operator knows where to get a key. */
  keysUrl: string
  /** One line, for someone who doesn't follow the model market. */
  whenToUse: string
  /**
   * null = this provider has no embeddings endpoint. DeepSeek is the
   * live example: its embeddings request was closed as not-planned, so
   * an account on DeepSeek still needs a second key for semantic search.
   */
  embeddings: EmbeddingsPreset | null
  /** The operator must supply `base_url` themselves. */
  requiresBaseUrl?: boolean
}

export const PROVIDERS: readonly ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4-mini',
    keyPlaceholder: 'sk-...',
    keysUrl: 'https://platform.openai.com/api-keys',
    whenToUse:
      'The broadest model range, and the one option that also covers embeddings for your knowledge base with the same key.',
    embeddings: {
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'text-embedding-3-small',
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-haiku-4-5-20251001',
    keyPlaceholder: 'sk-ant-...',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    whenToUse:
      'Best at following long instructions and staying on tone. Has no embeddings endpoint, so semantic search needs a second key.',
    embeddings: null,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    wire: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    // The `deepseek-chat` / `deepseek-reasoner` aliases were retired on
    // 2026-07-24 and now return an HTTP error, so they are deliberately
    // not the default here. `-pro` is the long-context/reasoning tier.
    defaultModel: 'deepseek-v4-flash',
    keyPlaceholder: 'sk-...',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    whenToUse:
      'Strong quality for a fraction of the cost. Chat only — it has no embeddings endpoint.',
    embeddings: null,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    wire: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-haiku-4.5',
    keyPlaceholder: 'sk-or-...',
    keysUrl: 'https://openrouter.ai/keys',
    whenToUse:
      'One key reaches hundreds of models from dozens of makers — and it is the only option here that covers both chat and embeddings, including open multilingual ones.',
    embeddings: {
      baseUrl: 'https://openrouter.ai/api/v1',
      // Natively 1024-dimensional and explicitly multilingual, which is
      // what the knowledge base is sized for (migration 074).
      defaultModel: 'baai/bge-m3',
    },
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    wire: 'openai',
    baseUrl: '',
    defaultModel: '',
    keyPlaceholder: 'sk-...',
    keysUrl: '',
    whenToUse:
      'Any host that speaks the OpenAI API — a self-hosted model, a gateway of your own, or a provider not listed above.',
    embeddings: null,
    requiresBaseUrl: true,
  },
]

const BY_ID = new Map<string, ProviderPreset>(PROVIDERS.map((p) => [p.id, p]))

export function getPreset(id: string): ProviderPreset | undefined {
  return BY_ID.get(id)
}

export function isSupportedProvider(id: string): boolean {
  return BY_ID.has(id)
}

/** Ids in the order the settings screen should list them. */
export const PROVIDER_IDS: readonly AiProvider[] = PROVIDERS.map((p) => p.id)

/** Trailing slashes would produce `//chat/completions` once joined. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * The origin to call for chat. The account's own `baseUrl` wins when set
 * (that is what makes a gateway or a self-hosted model possible); the
 * preset is the fallback. Empty means "not configured" — only reachable
 * for `custom`, and the config route rejects it before it gets here.
 */
export function resolveChatBaseUrl(
  config: Pick<AiConfig, 'provider' | 'baseUrl'>,
): string {
  if (config.baseUrl?.trim()) return trimTrailingSlash(config.baseUrl.trim())
  return trimTrailingSlash(getPreset(config.provider)?.baseUrl ?? '')
}

/**
 * Validate what the settings form sent for provider + endpoint. Shared
 * by `/api/ai/config` and `/api/ai/test` so the two can't disagree about
 * what is configurable — they previously carried the same two-value `if`
 * in duplicate, which is exactly the pair that drifts.
 *
 * Returns the normalized base URL to store: null for a preset provider
 * (so a later change to the preset applies without a data migration),
 * the trimmed string when the operator overrode it.
 */
export function validateProviderSelection(
  provider: string,
  rawBaseUrl: unknown,
):
  | { ok: true; preset: ProviderPreset; baseUrl: string | null }
  | { ok: false; error: string } {
  const preset = getPreset(provider)
  if (!preset) {
    const known = PROVIDERS.map((p) => p.id).join(', ')
    return { ok: false, error: `Unknown provider "${provider}". Choose one of: ${known}.` }
  }

  const typed = typeof rawBaseUrl === 'string' ? rawBaseUrl.trim() : ''
  if (!typed) {
    if (preset.requiresBaseUrl) {
      return {
        ok: false,
        error: `${preset.label} needs the endpoint URL of the server you want to call.`,
      }
    }
    return { ok: true, preset, baseUrl: null }
  }

  // A bad URL here becomes a confusing fetch failure at reply time, so
  // it is rejected at save time instead. http is allowed on purpose: a
  // self-hosted model on the same private network is a real case.
  let parsed: URL
  try {
    parsed = new URL(typed)
  } catch {
    return { ok: false, error: `"${typed}" is not a valid URL. Include the scheme, e.g. https://…` }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'The endpoint URL must start with https:// or http://.' }
  }

  return { ok: true, preset, baseUrl: trimTrailingSlash(typed) }
}

/**
 * The origin + model to call for embeddings. Independent of the chat
 * provider on purpose: an account can run chat on DeepSeek (no
 * embeddings endpoint at all) and embeddings on OpenRouter. Returns null
 * when the account has no embeddings key, which is the signal to stay on
 * lexical search.
 */
export function resolveEmbeddingsTarget(
  config: Pick<
    AiConfig,
    'provider' | 'embeddingsApiKey' | 'embeddingsBaseUrl' | 'embeddingsModel'
  >,
): { apiKey: string; baseUrl: string; model: string } | null {
  if (!config.embeddingsApiKey) return null

  const preset = getPreset(config.provider)?.embeddings
  const baseUrl = config.embeddingsBaseUrl?.trim() || preset?.baseUrl || ''
  const model = config.embeddingsModel?.trim() || preset?.defaultModel || ''
  // A key with nowhere to send it is a misconfiguration, not a default —
  // treat it as "no semantic search" rather than guessing an origin.
  if (!baseUrl || !model) return null

  return {
    apiKey: config.embeddingsApiKey,
    baseUrl: trimTrailingSlash(baseUrl),
    model,
  }
}
