import { describe, it, expect } from 'vitest'
import {
  PROVIDERS,
  getPreset,
  resolveChatBaseUrl,
  resolveEmbeddingsTarget,
  validateProviderSelection,
  type WireFormat,
} from './catalog'

/** The wire formats `generateReply` actually has an adapter for. */
const IMPLEMENTED_WIRES: readonly WireFormat[] = ['openai', 'anthropic']

describe('provider catalog', () => {
  it('has a unique id per preset', () => {
    const ids = PROVIDERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The pair this repo is most likely to let drift: a preset added to
  // the list the UI reads, with no branch in the switch that executes
  // it. That ships a dropdown entry which fails at reply time.
  it('only offers providers whose wire format has an adapter', () => {
    for (const preset of PROVIDERS) {
      expect(IMPLEMENTED_WIRES).toContain(preset.wire)
    }
  })

  it('gives every non-custom preset a base URL and a default model', () => {
    for (const preset of PROVIDERS) {
      if (preset.requiresBaseUrl) continue
      expect(preset.baseUrl, `${preset.id} baseUrl`).toMatch(/^https?:\/\//)
      expect(preset.baseUrl, `${preset.id} baseUrl`).not.toMatch(/\/$/)
      expect(preset.defaultModel, `${preset.id} defaultModel`).not.toBe('')
    }
  })

  it('marks the providers that genuinely have no embeddings endpoint', () => {
    // Anthropic has never had one, and DeepSeek closed the request as
    // not-planned — an account on either needs a second key for
    // semantic search, and the UI depends on this being honest.
    expect(getPreset('anthropic')?.embeddings).toBeNull()
    expect(getPreset('deepseek')?.embeddings).toBeNull()
    expect(getPreset('openrouter')?.embeddings).not.toBeNull()
    expect(getPreset('openai')?.embeddings).not.toBeNull()
  })
})

describe('resolveChatBaseUrl', () => {
  it('falls back to the preset when the account set no override', () => {
    expect(resolveChatBaseUrl({ provider: 'deepseek', baseUrl: null })).toBe(
      'https://api.deepseek.com/v1',
    )
  })

  it('prefers the account override', () => {
    expect(
      resolveChatBaseUrl({ provider: 'openai', baseUrl: 'https://gateway.internal/v1' }),
    ).toBe('https://gateway.internal/v1')
  })

  it('strips a trailing slash so the joined path has no double slash', () => {
    expect(
      resolveChatBaseUrl({ provider: 'custom', baseUrl: 'https://llm.local/v1/' }),
    ).toBe('https://llm.local/v1')
  })

  it('is empty for an unconfigured custom provider', () => {
    expect(resolveChatBaseUrl({ provider: 'custom', baseUrl: null })).toBe('')
  })
})

describe('resolveEmbeddingsTarget', () => {
  const base = {
    provider: 'openai',
    embeddingsApiKey: 'sk-emb',
    embeddingsBaseUrl: null,
    embeddingsModel: null,
  }

  it('is null without a key — the signal to stay on lexical search', () => {
    expect(resolveEmbeddingsTarget({ ...base, embeddingsApiKey: null })).toBeNull()
  })

  it("falls back to the chat provider's embeddings preset", () => {
    expect(resolveEmbeddingsTarget(base)).toEqual({
      apiKey: 'sk-emb',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
    })
  })

  it('lets embeddings run on a different provider than chat', () => {
    // The DeepSeek case: chat has no embeddings endpoint, so the
    // account points semantic search somewhere else entirely.
    expect(
      resolveEmbeddingsTarget({
        provider: 'deepseek',
        embeddingsApiKey: 'sk-or',
        embeddingsBaseUrl: 'https://openrouter.ai/api/v1',
        embeddingsModel: 'baai/bge-m3',
      }),
    ).toEqual({
      apiKey: 'sk-or',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'baai/bge-m3',
    })
  })

  it('is null when the provider has no preset and nothing was overridden', () => {
    // A key with nowhere to send it must not guess an origin.
    expect(
      resolveEmbeddingsTarget({ ...base, provider: 'deepseek' }),
    ).toBeNull()
  })
})

describe('validateProviderSelection', () => {
  it('rejects a provider that is not in the catalog', () => {
    const r = validateProviderSelection('mistral', null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('mistral')
  })

  it('stores null for a preset provider so preset changes still apply', () => {
    const r = validateProviderSelection('openai', '')
    expect(r).toMatchObject({ ok: true, baseUrl: null })
  })

  it('requires an endpoint for the custom provider', () => {
    const r = validateProviderSelection('custom', null)
    expect(r.ok).toBe(false)
  })

  it('rejects a malformed endpoint at save time, not at reply time', () => {
    expect(validateProviderSelection('custom', 'llm.local/v1').ok).toBe(false)
    expect(validateProviderSelection('custom', 'ftp://llm.local').ok).toBe(false)
  })

  it('allows http for a self-hosted model on a private network', () => {
    expect(validateProviderSelection('custom', 'http://10.0.0.4:8000/v1')).toMatchObject({
      ok: true,
      baseUrl: 'http://10.0.0.4:8000/v1',
    })
  })
})
