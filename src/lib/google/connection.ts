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
  /** A linha em `google_calendar_connections`. Desde a migração 082 uma
   *  conta tem N; é isto que diz de qual estamos falando. */
  id: string
  accountId: string
  refreshToken: string
  calendarId: string
  googleEmail: string | null
  /** Como o cliente chama esta agenda — "Dra. Ana", "Sala 2". Null nas
   *  conexões anteriores à 082, e aí a conta tem uma agenda só. */
  rotulo: string | null
  isDefault: boolean
  /** Cached access token, already checked for freshness. */
  accessToken: string
  env: GoogleOAuthEnv
}

interface ConnectionRow {
  id: string
  refresh_token: string
  access_token: string | null
  access_token_expires_at: string | null
  calendar_id: string
  google_email: string | null
  rotulo: string | null
  is_default: boolean
}

const CONNECTION_COLUMNS =
  'id, refresh_token, access_token, access_token_expires_at, calendar_id, google_email, rotulo, is_default'

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
  /** Qual agenda. Ausente = a padrão da conta, que é exatamente o que a
   *  única conexão respondia antes da migração 082. */
  connectionId?: string | null,
): Promise<GoogleConnection | null> {
  const env = googleOAuthEnv()
  if (!env) return null

  let query = db
    .from('google_calendar_connections')
    .select(CONNECTION_COLUMNS)
    .eq('account_id', accountId)
    .eq('is_active', true)

  if (connectionId) query = query.eq('id', connectionId)
  // Sem agenda pedida: a padrão primeiro. `is_default` desc põe a padrão
  // no topo, e a mais antiga desempata — para uma conta que nunca marcou
  // padrão continuar respondendo a mesma coisa a cada chamada.
  const { data, error } = await query
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[google connection] lookup failed:', error)
    return null
  }
  const row = ((data as ConnectionRow[] | null) ?? [])[0]
  if (!row) return null

  return hydrate(db, accountId, row, env)
}

/**
 * Todas as agendas ativas da conta.
 *
 * Usada por quem precisa OFERECER a escolha — o menu do fluxo, o
 * argumento da ferramenta da IA, a tela de configuração. Cada uma vem
 * com o token já renovado, porque quem lista costuma consultar em
 * seguida.
 */
export async function loadGoogleConnections(
  db: SupabaseClient,
  accountId: string,
): Promise<GoogleConnection[]> {
  const env = googleOAuthEnv()
  if (!env) return []

  const { data, error } = await db
    .from('google_calendar_connections')
    .select(CONNECTION_COLUMNS)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    console.error('[google connection] list failed:', error)
    return []
  }

  const out: GoogleConnection[] = []
  for (const row of (data as ConnectionRow[] | null) ?? []) {
    try {
      out.push(await hydrate(db, accountId, row, env))
    } catch (err) {
      // Uma agenda que não abre não pode derrubar as outras: o
      // consultório com dois médicos continua agendando com um deles
      // enquanto o outro reconecta.
      console.error(
        '[google connection] agenda inutilizável, seguindo sem ela:',
        row.id,
        err instanceof Error ? err.message : err,
      )
    }
  }
  return out
}

async function hydrate(
  db: SupabaseClient,
  accountId: string,
  data: ConnectionRow,
  env: GoogleOAuthEnv,
): Promise<GoogleConnection> {
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

  const base = {
    id: data.id,
    accountId,
    refreshToken,
    calendarId: data.calendar_id,
    googleEmail: data.google_email,
    rotulo: data.rotulo,
    isDefault: data.is_default,
    env,
  }

  const cached = readCachedToken(data)
  if (cached) return { ...base, accessToken: cached }

  const { accessToken, expiresAt } = await refreshAccessToken(env, refreshToken)

  // Best-effort cache write: a failure here costs one extra refresh
  // next time, which is not worth failing a customer's booking over.
  const { error: upErr } = await db
    .from('google_calendar_connections')
    .update({
      access_token: encrypt(accessToken),
      access_token_expires_at: expiresAt.toISOString(),
    })
    .eq('id', data.id)
  if (upErr) {
    console.error('[google connection] could not cache the access token:', upErr)
  }

  return { ...base, accessToken }
}

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
