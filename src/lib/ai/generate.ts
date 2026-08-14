import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { getPreset, resolveChatBaseUrl } from './providers/catalog'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 *
 * Dispatch is on the provider's WIRE FORMAT, not its name: every
 * OpenAI-compatible host (DeepSeek, OpenRouter, a self-hosted model)
 * runs through the same adapter with a different origin. Adding a
 * provider is a row in `providers/catalog.ts`, never a branch here.
 *
 * Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()

  const preset = getPreset(config.provider)
  if (!preset) {
    throw new AiError(`Unsupported AI provider: ${config.provider}`, {
      code: 'unsupported_provider',
      status: 400,
    })
  }

  const baseUrl = resolveChatBaseUrl(config)
  if (!baseUrl) {
    // Only reachable for `custom` — the config route requires a base URL
    // before saving one, so this is the defensive half of that pair.
    throw new AiError(
      `${preset.label} needs an endpoint URL. Set it in Settings → AI Assistant.`,
      { code: 'missing_base_url', status: 400 },
    )
  }

  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    baseUrl,
    providerLabel: preset.label,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (preset.wire) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default: {
      // Exhaustiveness guard: a WireFormat added to the catalog without
      // an adapter here fails loudly at the call, not silently at build.
      const unreachable: never = preset.wire
      throw new AiError(`Unsupported wire format: ${String(unreachable)}`, {
        code: 'unsupported_provider',
        status: 400,
      })
    }
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
