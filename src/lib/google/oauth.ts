// ============================================================
// Google OAuth — the consent dance, by hand.
//
// No `googleapis`, no `next-auth`: the codebase talks to Meta and to
// both LLM providers with raw `fetch`, and one more SDK to keep current
// buys nothing here. Three endpoints and a token refresh is the whole
// surface.
//
// We ask for `calendar` (read + write events) and `userinfo.email`.
// The email is not decoration: the failure worth preventing is an
// operator connecting the wrong Google account and the shop's bookings
// landing in a personal calendar nobody opens.
// ============================================================

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

const REQUEST_TIMEOUT_MS = 15_000

/** Typed failure so routes can tell "not set up" from "Google said no". */
export class GoogleError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'GoogleError'
    this.code = opts.code ?? 'google_error'
    this.status = opts.status ?? 502
  }
}

export interface GoogleOAuthEnv {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/**
 * Read the OAuth credentials from the environment.
 *
 * The redirect URI must match one registered in the Google Cloud
 * console byte for byte, so it is configuration, never derived from the
 * request — a Host header an attacker controls must not be able to
 * shape it.
 */
export function googleOAuthEnv(): GoogleOAuthEnv | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null

  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim()?.replace(/\/+$/, '')
  const redirectUri = explicit || (site ? `${site}/api/google/calendar/callback` : '')
  if (!redirectUri) return null

  return { clientId, clientSecret, redirectUri }
}

/** True when the deployment can offer a "Connect Google Calendar" button. */
export function isGoogleOAuthConfigured(): boolean {
  return googleOAuthEnv() !== null
}

/**
 * The URL to send the operator to.
 *
 * `access_type=offline` + `prompt=consent` is what makes Google return
 * a refresh token. Without the explicit consent prompt it only issues
 * one on the *first* ever authorization, so an operator who reconnects
 * after disconnecting would come back with no refresh token and a
 * connection that dies in an hour.
 */
export function buildConsentUrl(env: GoogleOAuthEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new GoogleError(`Could not reach Google: ${message}`, {
      code: 'network_error',
    })
  }

  const data = (await res.json().catch(() => null)) as TokenResponse | null
  if (!res.ok || !data || data.error) {
    const detail = data?.error_description || data?.error || `HTTP ${res.status}`
    // `invalid_grant` is the one worth naming: it means the refresh
    // token was revoked (the operator removed access in their Google
    // account, or the password changed), and the fix is reconnecting,
    // not retrying.
    const code = data?.error === 'invalid_grant' ? 'invalid_grant' : 'token_error'
    throw new GoogleError(`Google rejected the token request: ${detail}`, {
      code,
      status: code === 'invalid_grant' ? 401 : 502,
    })
  }
  return data
}

export interface ExchangeResult {
  refreshToken: string
  accessToken: string
  expiresAt: Date
  scope: string | null
}

/** Trade the one-time code from the callback for tokens. */
export async function exchangeCode(
  env: GoogleOAuthEnv,
  code: string,
): Promise<ExchangeResult> {
  const data = await postToken(
    new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: 'authorization_code',
    }),
  )

  if (!data.refresh_token || !data.access_token) {
    // Reachable when Google decides consent was already granted and
    // withholds the refresh token. Without it the connection is useless
    // in an hour, so refuse to store a half-connection.
    throw new GoogleError(
      'Google did not return a refresh token. Remove iMasterChat from your Google account permissions and connect again.',
      { code: 'no_refresh_token', status: 400 },
    )
  }

  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: expiryFrom(data.expires_in),
    scope: data.scope ?? null,
  }
}

export interface RefreshResult {
  accessToken: string
  expiresAt: Date
}

/** Mint a fresh access token from the stored refresh token. */
export async function refreshAccessToken(
  env: GoogleOAuthEnv,
  refreshToken: string,
): Promise<RefreshResult> {
  const data = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: 'refresh_token',
    }),
  )
  if (!data.access_token) {
    throw new GoogleError('Google returned no access token.', {
      code: 'token_error',
    })
  }
  return { accessToken: data.access_token, expiresAt: expiryFrom(data.expires_in) }
}

/** Which Google account this is, for the settings screen. */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { email?: string }
    return data.email ?? null
  } catch {
    // Cosmetic — never fail a connection because the label is missing.
    return null
  }
}

/**
 * Expiry, minus a minute of slack. Treating a token as expired slightly
 * early costs one extra refresh; treating it as valid slightly late
 * costs a customer-facing 401 mid-booking.
 */
function expiryFrom(expiresIn: number | undefined): Date {
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600
  return new Date(Date.now() + (seconds - 60) * 1000)
}
