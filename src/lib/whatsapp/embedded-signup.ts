/**
 * Embedded Signup — the Tech Provider onboarding path.
 *
 * Instead of asking a client to create a Meta app, generate a permanent
 * token and paste a Phone Number ID (the manual path, still supported),
 * the client clicks a button in our Settings screen, authorises through
 * Meta's popup, and we finish the wiring server-side.
 *
 * The exchange is: browser gets a short-lived `code` → this module
 * trades it for a business access token → reads which WABA and phone
 * number that token grants → subscribes our app to the WABA's webhooks.
 *
 * The code exchange MUST happen server-side: it needs META_APP_SECRET,
 * which can never reach the browser. Same named-parameters convention as
 * meta-api.ts, and for the same reason (swapped-args bugs).
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(
  response: Response,
  fallback: string,
): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// Step 1 — code → business access token
// ============================================================

export interface ExchangeCodeArgs {
  /** The short-lived code the Facebook JS SDK handed the browser. */
  code: string
  appId: string
  appSecret: string
}

/**
 * Trade the Embedded Signup `code` for the client's business access
 * token.
 *
 * Note there is no `redirect_uri` here: the Embedded Signup flow is not
 * a plain OAuth redirect, and sending one makes Meta reject the
 * exchange with a redirect-mismatch error.
 */
export async function exchangeCodeForToken(
  args: ExchangeCodeArgs,
): Promise<string> {
  const url = new URL(`${META_API_BASE}/oauth/access_token`)
  url.searchParams.set('client_id', args.appId)
  url.searchParams.set('client_secret', args.appSecret)
  url.searchParams.set('code', args.code)

  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) {
    await throwMetaError(response, 'Could not exchange the signup code')
  }

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error('Meta returned no access token for this signup code')
  }
  return data.access_token
}

// ============================================================
// Step 2 — what does this token grant?
// ============================================================

export interface SharedWaba {
  wabaId: string
  wabaName: string | null
  businessId: string | null
}

/**
 * List the WABAs the freshly-issued token was granted access to.
 *
 * `debug_token` is the reliable source here. The alternative —
 * `/me/businesses` then walking each business's owned WABAs — needs
 * broader permissions than Embedded Signup grants and returns
 * everything the user can see rather than what they just shared with
 * us, which is a real over-collection risk.
 */
export async function listSharedWabas(args: {
  businessToken: string
  appId: string
  appSecret: string
}): Promise<SharedWaba[]> {
  const url = new URL(`${META_API_BASE}/debug_token`)
  url.searchParams.set('input_token', args.businessToken)
  url.searchParams.set('access_token', `${args.appId}|${args.appSecret}`)

  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) {
    await throwMetaError(response, 'Could not inspect the signup token')
  }

  const data = (await response.json()) as {
    data?: {
      granular_scopes?: { scope: string; target_ids?: string[] }[]
    }
  }

  const scopes = data.data?.granular_scopes ?? []
  const wabaIds = new Set<string>()
  for (const scope of scopes) {
    if (
      scope.scope === 'whatsapp_business_management' ||
      scope.scope === 'whatsapp_business_messaging'
    ) {
      for (const id of scope.target_ids ?? []) wabaIds.add(id)
    }
  }

  // debug_token gives ids only; one lookup each fills in the names the
  // settings screen shows. A client shares one WABA in the common case,
  // so this is a single extra call in practice.
  return Promise.all(
    [...wabaIds].map(async (wabaId) => {
      const meta = await getWabaDetails({
        wabaId,
        accessToken: args.businessToken,
      }).catch(() => null)
      return {
        wabaId,
        wabaName: meta?.name ?? null,
        businessId: meta?.businessId ?? null,
      }
    }),
  )
}

export async function getWabaDetails(args: {
  wabaId: string
  accessToken: string
}): Promise<{ name: string | null; businessId: string | null }> {
  const url = new URL(`${META_API_BASE}/${args.wabaId}`)
  url.searchParams.set('fields', 'name,owner_business_info')

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, 'Could not read the WhatsApp account')
  }

  const data = (await response.json()) as {
    name?: string
    owner_business_info?: { id?: string }
  }
  return {
    name: data.name ?? null,
    businessId: data.owner_business_info?.id ?? null,
  }
}

export interface WabaPhoneNumber {
  phoneNumberId: string
  displayPhoneNumber: string
  verifiedName: string | null
  /** Meta's own verification state for the number. */
  codeVerificationStatus: string | null
}

/** List the phone numbers under a WABA. */
export async function listWabaPhoneNumbers(args: {
  wabaId: string
  accessToken: string
}): Promise<WabaPhoneNumber[]> {
  const url = new URL(`${META_API_BASE}/${args.wabaId}/phone_numbers`)
  url.searchParams.set(
    'fields',
    'id,display_phone_number,verified_name,code_verification_status',
  )

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, 'Could not list the phone numbers')
  }

  const data = (await response.json()) as {
    data?: {
      id: string
      display_phone_number?: string
      verified_name?: string
      code_verification_status?: string
    }[]
  }

  return (data.data ?? []).map((p) => ({
    phoneNumberId: p.id,
    displayPhoneNumber: p.display_phone_number ?? '',
    verifiedName: p.verified_name ?? null,
    codeVerificationStatus: p.code_verification_status ?? null,
  }))
}
