import { generateReply } from './generate'
import type { AiConfig } from './types'
import { AiError } from './types'
import { getPreset, resolveChatBaseUrl } from './providers/catalog'
import { pingProviderKey, KEY_PING_TIMEOUT_MS } from './providers/validate-key'

/**
 * Liveness + auth check for a candidate config, in two steps so the
 * failure the operator sees names the right thing:
 *
 *   1. Ping `GET /models` with the key. Costs no tokens, and a 401 here
 *      is conclusive — the key is bad, and no amount of fixing the model
 *      id will help.
 *   2. Generate one tiny reply. This is what proves the *model* id is
 *      real and usable, which the ping cannot tell us.
 *
 * Before the split, a typo in the model id came back as "the provider
 * rejected your key", and the operator would go rotate a perfectly good
 * key. The ping only ever narrows the diagnosis: anything short of an
 * explicit auth rejection falls through to step 2, so a minimal
 * OpenAI-compatible host that implements no `/models` route still
 * validates.
 *
 * Throws `AiError` (invalid_key / rate_limited / network / timeout) on
 * failure, resolves on success. Used by the settings "Test key" button
 * and before persisting a config — the same "verify before save"
 * discipline the WhatsApp config uses with Meta.
 */
export async function validateAiCredentials(config: AiConfig): Promise<void> {
  const preset = getPreset(config.provider)
  if (!preset) {
    throw new AiError(`Unsupported AI provider: ${config.provider}`, {
      code: 'unsupported_provider',
      status: 400,
    })
  }

  const baseUrl = resolveChatBaseUrl(config)
  if (baseUrl) {
    const ping = await pingProviderKey({
      apiKey: config.apiKey,
      baseUrl,
      wire: preset.wire,
      providerLabel: preset.label,
      timeoutMs: KEY_PING_TIMEOUT_MS,
    })
    if (ping.verdict === 'rejected') throw ping.error

    // The key is good and the provider told us what it can reach, so a
    // model id that isn't on the list is a typo we can name precisely
    // instead of letting it come back as a generic 404 from the
    // generation call. Only when the list is non-empty: plenty of
    // gateways return `{data: []}` or omit models they still serve.
    if (ping.verdict === 'ok' && ping.models.length > 0) {
      if (!ping.models.includes(config.model)) {
        throw new AiError(
          `${preset.label} accepted the key but does not list a model called "${config.model}". Check the model id.`,
          { code: 'unknown_model', status: 400 },
        )
      }
    }
  }

  await generateReply({
    config,
    systemPrompt: 'You are a connectivity check. Reply with the single word: OK.',
    messages: [{ role: 'user', content: 'ping' }],
  })
}
