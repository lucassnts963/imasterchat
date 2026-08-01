import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  exchangeCode,
  fetchGoogleEmail,
  GoogleError,
  googleOAuthEnv,
} from '@/lib/google/oauth'
import { OAUTH_STATE_COOKIE } from '../connect/route'

// ============================================================
// GET /api/google/calendar/callback  (admin+)
//
// Where Google sends the operator back. Verifies the state cookie,
// trades the code for tokens, and stores them encrypted.
//
// Always redirects to the settings screen rather than returning JSON —
// this URL is loaded by the browser, not by fetch, so an error has to
// arrive as something the page can render.
// ============================================================

/** Where the operator lands, with the outcome in the query string. */
function settingsUrl(request: Request, params: Record<string, string>): URL {
  const url = new URL('/settings', request.url)
  url.searchParams.set('panel', 'google-calendar')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url
}

export async function GET(request: Request) {
  const jar = await cookies()
  const expectedState = jar.get(OAUTH_STATE_COOKIE)?.value ?? null
  // One-shot: consume it whatever happens, so a leaked state cannot be
  // replayed and a failed attempt cannot be retried with a stale value.
  jar.delete({ name: OAUTH_STATE_COOKIE, path: '/api/google/calendar' })

  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const url = new URL(request.url)

    // The operator pressed "cancel" on Google's consent screen.
    const denied = url.searchParams.get('error')
    if (denied) {
      return NextResponse.redirect(settingsUrl(request, { google: denied }))
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state) {
      return NextResponse.redirect(settingsUrl(request, { google: 'invalid_response' }))
    }
    // Constant-time-ish comparison is overkill for a value we generated
    // and are about to discard, but a strict equality check on a
    // *present* cookie is not: without it, any page could start the flow.
    if (!expectedState || state !== expectedState) {
      return NextResponse.redirect(settingsUrl(request, { google: 'state_mismatch' }))
    }

    const env = googleOAuthEnv()
    if (!env) {
      return NextResponse.redirect(settingsUrl(request, { google: 'not_configured' }))
    }

    const tokens = await exchangeCode(env, code)
    const email = await fetchGoogleEmail(tokens.accessToken)

    // Upsert on account_id: reconnecting replaces the credentials in
    // place, which keeps `calendar_id` and every appointment already
    // pointing at it intact.
    const { error } = await supabase.from('google_calendar_connections').upsert(
      {
        account_id: accountId,
        refresh_token: encrypt(tokens.refreshToken),
        access_token: encrypt(tokens.accessToken),
        access_token_expires_at: tokens.expiresAt.toISOString(),
        google_email: email,
        scope: tokens.scope,
        connected_by: userId,
      },
      { onConflict: 'account_id' },
    )

    if (error) {
      console.error('[google callback] could not store the connection:', error)
      return NextResponse.redirect(settingsUrl(request, { google: 'store_failed' }))
    }

    return NextResponse.redirect(settingsUrl(request, { google: 'connected' }))
  } catch (err) {
    if (err instanceof GoogleError) {
      console.error('[google callback] exchange failed:', err)
      return NextResponse.redirect(settingsUrl(request, { google: err.code }))
    }
    return toErrorResponse(err)
  }
}
