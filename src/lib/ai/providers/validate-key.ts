import type { AiError } from '../types'
import { providerHttpError } from './shared'
import type { WireFormat } from './catalog'

// ============================================================
// Cheap auth check: GET {baseUrl}/models with the account's key.
//
// Why this exists alongside `validateAiCredentials`, which already
// proves the setup works by generating a reply: that check answers
// "does this whole configuration work?" with one bit. When it fails on
// a bad model id it still reads as "the provider rejected your key",
// which sends the operator to rotate a key that was fine.
//
// The ping separates the two questions — key first, model second — and
// costs no tokens.
// ============================================================

/**
 * The ping is a PRECISION layer, never a new failure mode. Only an
 * explicit auth rejection (401/403) is treated as conclusive; anything
 * else — success, 404 from a host that doesn't implement /models, a 500,
 * a network blip — returns `null` so the caller falls through to the
 * authoritative generation check. That way pointing at a minimal
 * OpenAI-compatible server that only implements /chat/completions still
 * validates, exactly as it did before this check existed.
 */
export type KeyPing =
  /** The key is definitively bad. */
  | { verdict: 'rejected'; error: AiError }
  /** The key works; `models` is what it can see (may be empty). */
  | { verdict: 'ok'; models: string[] }
  /** Inconclusive — defer to the generation check. */
  | { verdict: 'unknown' }

interface ModelsResponse {
  data?: { id?: string }[]
}

function authHeaders(wire: WireFormat, apiKey: string): Record<string, string> {
  if (wire === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  }
  return { Authorization: `Bearer ${apiKey}` }
}

export async function pingProviderKey(args: {
  apiKey: string
  baseUrl: string
  wire: WireFormat
  providerLabel: string
  timeoutMs: number
}): Promise<KeyPing> {
  const { apiKey, baseUrl, wire, providerLabel, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: authHeaders(wire, apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    // Network trouble here proves nothing about the key. The generation
    // call is about to hit the same host and will report it properly.
    return { verdict: 'unknown' }
  }

  if (res.status === 401 || res.status === 403) {
    return { verdict: 'rejected', error: await providerHttpError(providerLabel, res) }
  }
  if (!res.ok) return { verdict: 'unknown' }

  const data = (await res.json().catch(() => null)) as ModelsResponse | null
  const models = (data?.data ?? [])
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  return { verdict: 'ok', models }
}

/**
 * Shorter timeout than a generation: listing models is a metadata call,
 * and this runs while an admin waits on a "Test key" button.
 */
export const KEY_PING_TIMEOUT_MS = 5_000
