import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pingProviderKey } from './validate-key'

function res(status: number, json: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  } as unknown as Response
}

const ARGS = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  wire: 'openai' as const,
  providerLabel: 'Example',
  timeoutMs: 5_000,
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('pingProviderKey', () => {
  it('lists the models a working key can reach', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res(200, { data: [{ id: 'a' }, { id: 'b' }] })),
    )
    await expect(pingProviderKey(ARGS)).resolves.toEqual({
      verdict: 'ok',
      models: ['a', 'b'],
    })
  })

  it('calls GET /models on the configured origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await pingProviderKey(ARGS)

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/models')
    expect(opts.method).toBe('GET')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('uses Anthropic auth headers for the anthropic wire', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await pingProviderKey({ ...ARGS, wire: 'anthropic' })

    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers['x-api-key']).toBe('sk-test')
    expect(opts.headers['anthropic-version']).toBe('2023-06-01')
    expect(opts.headers.Authorization).toBeUndefined()
  })

  it.each([401, 403])('treats %i as a conclusive rejection', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res(status, { error: { message: 'nope' } })),
    )
    const out = await pingProviderKey(ARGS)
    expect(out.verdict).toBe('rejected')
    if (out.verdict === 'rejected') expect(out.error.code).toBe('invalid_key')
  })

  // The property that keeps this check from ever making validation
  // stricter than it was: everything short of an auth rejection defers.
  it.each([404, 405, 429, 500])('defers on %i rather than failing', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status, {})))
    await expect(pingProviderKey(ARGS)).resolves.toEqual({ verdict: 'unknown' })
  })

  it('defers when the host is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(pingProviderKey(ARGS)).resolves.toEqual({ verdict: 'unknown' })
  })

  it('tolerates a malformed model list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res(200, { data: [{ id: 'a' }, {}, { id: 42 }] })),
    )
    await expect(pingProviderKey(ARGS)).resolves.toEqual({
      verdict: 'ok',
      models: ['a'],
    })
  })
})
