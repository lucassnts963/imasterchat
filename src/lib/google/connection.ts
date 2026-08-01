import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  GoogleError,
  googleOAuthEnv,
  refreshAccessToken,
  type GoogleOAuthEnv,
} from './oauth'

// ============================================================
// The account's Google connection, and keeping its access token alive.
//
// Access tokens last an hour. Refreshing on every call would add a
// round-trip to every availability check the customer is waiting on, so
// the token is cached in the row and only re-minted when it is close to
// expiring. The cache is encrypted at rest like the refresh token —
// a stolen access token is an hour of calendar access, which is plenty.
// ============================================================

export interface GoogleConnection {
  accountId: string
  refreshToken: string
  calendarId: string
  googleEmail: string | null
  /** Cached access token, already checked for freshness. */
  accessToken: string
  env: GoogleOAuthEnv
}

interface ConnectionRow {
  refresh_token: string
  access_token: string | null
  access_token_expires_at: string | null
  calendar_id: string
  google_email: string | null
}

const CONNECTION_COLUMNS =
  'refresh_token, access_token, access_token_expires_at, calendar_id, google_email'

/**
 * Is a calendar connected? Cheap enough for the tool catalog, which
 * asks on every inbound message.
 */
export async function hasGoogleConnection(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  if (!googleOAuthEnv()) return false
  try {
    const { count, error } = await db
      .from('google_calendar_connections')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    return !error && Boolean(count)
  } catch {
    return false
  }
}

/**
 * Load the connection with a usable access token, refreshing and
 * persisting a new one when the cached one is spent.
 *
 * Returns null when the account has no connection or the deployment has
 * no OAuth credentials — both mean "scheduling is not available here",
 * which callers treat identically. Throws `GoogleError` only when a
 * connection exists but cannot be used, because that is a state the
 * operator has to fix (reconnect) rather than one to paper over.
 */
export async function loadGoogleConnection(
  db: SupabaseClient,
  accountId: string,
): Promise<GoogleConnection | null> {
  const env = googleOAuthEnv()
  if (!env) return null

  const { data, error } = await db
    .from('google_calendar_connections')
    .select(CONNECTION_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle<ConnectionRow>()

  if (error) {
    console.error('[google connection] lookup failed:', error)
    return null
  }
  if (!data) return null

  let refreshToken: string
  try {
    refreshToken = decrypt(data.refresh_token)
  } catch {
    // A rotated ENCRYPTION_KEY. Loud, because the symptom otherwise is
    // "booking silently stopped working" with nothing in the logs.
    console.error(
      `[google connection] refresh token for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; the calendar must be reconnected.`,
    )
    throw new GoogleError(
      'The stored Google credentials could not be read. Reconnect Google Calendar.',
      { code: 'credentials_unreadable', status: 400 },
    )
  }

  const cached = readCachedToken(data)
  if (cached) {
    return {
      accountId,
      refreshToken,
      calendarId: data.calendar_id,
      googleEmail: data.google_email,
      accessToken: cached,
      env,
    }
  }

  const { accessToken, expiresAt } = await refreshAccessToken(env, refreshToken)

  // Best-effort cache write: a failure here costs one extra refresh
  // next time, which is not worth failing a customer's booking over.
  const { error: upErr } = await db
    .from('google_calendar_connections')
    .update({
      access_token: encrypt(accessToken),
      access_token_expires_at: expiresAt.toISOString(),
    })
    .eq('account_id', accountId)
  if (upErr) {
    console.error('[google connection] could not cache the access token:', upErr)
  }

  return {
    accountId,
    refreshToken,
    calendarId: data.calendar_id,
    googleEmail: data.google_email,
    accessToken,
    env,
  }
}

/** The cached token, if it exists and is still comfortably valid. */
function readCachedToken(row: ConnectionRow): string | null {
  if (!row.access_token || !row.access_token_expires_at) return null
  const expiresAt = Date.parse(row.access_token_expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null
  try {
    return decrypt(row.access_token)
  } catch {
    // Undecryptable cache is not fatal — mint a fresh one.
    return null
  }
}
