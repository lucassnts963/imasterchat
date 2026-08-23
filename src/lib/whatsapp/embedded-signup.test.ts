import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  exchangeCodeForToken,
  readSignupMessage,
  listSharedWabas,
  listWabaPhoneNumbers,
} from './embedded-signup'

// The Embedded Signup exchange is the one place a client's WhatsApp
// credentials are minted, and every call here is server-to-Meta, so the
// tests pin the request shapes rather than mock at a higher level: a
// wrong query param surfaces as an opaque Meta rejection in production.

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => vi.unstubAllGlobals())

function jsonOnce(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  })
}

describe('exchangeCodeForToken', () => {
  it('sends the app credentials and returns the business token', async () => {
    jsonOnce({ access_token: 'biz-token' })

    const token = await exchangeCodeForToken({
      code: 'the-code',
      appId: 'app-1',
      appSecret: 'secret-1',
    })

    expect(token).toBe('biz-token')
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toContain('/oauth/access_token')
    expect(url.searchParams.get('client_id')).toBe('app-1')
    expect(url.searchParams.get('client_secret')).toBe('secret-1')
    expect(url.searchParams.get('code')).toBe('the-code')
    // Embedded Signup is not a plain OAuth redirect — sending a
    // redirect_uri makes Meta reject the exchange.
    expect(url.searchParams.has('redirect_uri')).toBe(false)
  })

  it('surfaces Meta error messages verbatim', async () => {
    jsonOnce({ error: { message: 'This authorization code has expired.' } }, false, 400)

    await expect(
      exchangeCodeForToken({ code: 'old', appId: 'a', appSecret: 's' }),
    ).rejects.toThrow('This authorization code has expired.')
  })

  it('rejects a 200 that carries no token', async () => {
    jsonOnce({})
    await expect(
      exchangeCodeForToken({ code: 'c', appId: 'a', appSecret: 's' }),
    ).rejects.toThrow(/no access token/i)
  })
})

describe('listSharedWabas', () => {
  it('reads WABA ids from the granular scopes the user just granted', async () => {
    // debug_token, then one detail lookup per WABA found.
    jsonOnce({
      data: {
        granular_scopes: [
          { scope: 'whatsapp_business_management', target_ids: ['waba-1'] },
          { scope: 'whatsapp_business_messaging', target_ids: ['waba-1'] },
          // Unrelated grants must not be treated as WABAs.
          { scope: 'public_profile', target_ids: ['page-9'] },
        ],
      },
    })
    jsonOnce({ name: 'Loja da Maria', owner_business_info: { id: 'biz-1' } })

    const wabas = await listSharedWabas({
      businessToken: 'biz-token',
      appId: 'app-1',
      appSecret: 'secret-1',
    })

    // waba-1 appears under two scopes but is one account.
    expect(wabas).toEqual([
      { wabaId: 'waba-1', wabaName: 'Loja da Maria', businessId: 'biz-1' },
    ])

    const debugUrl = new URL(fetchMock.mock.calls[0][0])
    expect(debugUrl.pathname).toContain('/debug_token')
    // The app token — not the business token — authorises debug_token.
    expect(debugUrl.searchParams.get('access_token')).toBe('app-1|secret-1')
    expect(debugUrl.searchParams.get('input_token')).toBe('biz-token')
  })

  it('still returns the WABA when the detail lookup fails', async () => {
    // A failed name lookup must not sink the whole connection — the id
    // is the part we actually need to wire webhooks.
    jsonOnce({
      data: {
        granular_scopes: [
          { scope: 'whatsapp_business_management', target_ids: ['waba-1'] },
        ],
      },
    })
    jsonOnce({ error: { message: 'nope' } }, false, 403)

    const wabas = await listSharedWabas({
      businessToken: 't',
      appId: 'a',
      appSecret: 's',
    })
    expect(wabas).toEqual([
      { wabaId: 'waba-1', wabaName: null, businessId: null },
    ])
  })

  it('returns an empty list when nothing WhatsApp-related was shared', async () => {
    jsonOnce({ data: { granular_scopes: [] } })
    await expect(
      listSharedWabas({ businessToken: 't', appId: 'a', appSecret: 's' }),
    ).resolves.toEqual([])
  })
})

describe('listWabaPhoneNumbers', () => {
  it('maps Meta’s snake_case payload to the app’s shape', async () => {
    jsonOnce({
      data: [
        {
          id: 'phone-1',
          display_phone_number: '+55 91 99999-9999',
          verified_name: 'Loja da Maria',
          code_verification_status: 'VERIFIED',
        },
      ],
    })

    const numbers = await listWabaPhoneNumbers({
      wabaId: 'waba-1',
      accessToken: 'biz-token',
    })

    expect(numbers).toEqual([
      {
        phoneNumberId: 'phone-1',
        displayPhoneNumber: '+55 91 99999-9999',
        verifiedName: 'Loja da Maria',
        codeVerificationStatus: 'VERIFIED',
      },
    ])
  })

  it('returns an empty list for a WABA with no numbers yet', async () => {
    jsonOnce({})
    await expect(
      listWabaPhoneNumbers({ wabaId: 'w', accessToken: 't' }),
    ).resolves.toEqual([])
  })
})

describe('readSignupMessage', () => {
  const wrap = (event: string, data: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data })

  it.each([
    'FINISH',
    'FINISH_ONLY_WABA',
    // The coexistence flow's own name. This repo asks for coexistence
    // via `featureType`, so this is THE event it receives in practice —
    // and the one that used to be ignored.
    'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  ])('reads the WABA and number out of %s', (event) => {
    expect(
      readSignupMessage(wrap(event, { phone_number_id: '123', waba_id: '456' })),
    ).toEqual({ kind: 'finish', phoneNumberId: '123', wabaId: '456' })
  })

  it('keeps what Meta said when its own dialog refused', () => {
    expect(
      readSignupMessage(
        wrap('CANCEL', {
          current_step: 'WABA_ONBOARDING',
          error_message: '103860505700201 is not a valid business id',
        }),
      ),
    ).toEqual({
      kind: 'cancel',
      step: 'WABA_ONBOARDING',
      errorMessage: '103860505700201 is not a valid business id',
    })
  })

  it('reports a plain close as a cancel with nothing to show', () => {
    // Distinguishing this from the case above is the whole point: one
    // deserves a red toast, the other is just someone closing a window.
    expect(readSignupMessage(wrap('CANCEL'))).toEqual({
      kind: 'cancel',
      step: undefined,
      errorMessage: undefined,
    })
  })

  it.each([
    ['a message from another sender', JSON.stringify({ type: 'SOMETHING_ELSE' })],
    ['an unknown event', JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'PING' })],
    ['non-JSON chatter', 'not json at all'],
    ['a non-string payload', { type: 'WA_EMBEDDED_SIGNUP' }],
  ])('ignores %s', (_label, payload) => {
    expect(readSignupMessage(payload)).toBeNull()
  })
})
