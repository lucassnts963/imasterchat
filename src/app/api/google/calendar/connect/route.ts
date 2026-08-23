import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildConsentUrl, googleOAuthEnv } from '@/lib/google/oauth'

// ============================================================
// GET /api/google/calendar/connect  (admin+)
//
// Starts the consent flow. Redirects the operator to Google, having
// first parked a random value in an httpOnly cookie: the callback only
// accepts a `state` that matches it, so an attacker cannot get a
// victim's browser to complete a flow the attacker started and attach
// the attacker's calendar to the victim's account.
//
// The state carries no account id. The callback reads the account from
// the session, which is the only source that cannot be forged.
// ============================================================

export const OAUTH_STATE_COOKIE = 'imasterchat_google_oauth_state'

export async function GET() {
  try {
    await requireRole('admin')

    const env = googleOAuthEnv()
    if (!env) {
      return NextResponse.json(
        {
          error:
            'Google Calendar is not set up on this deployment. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and NEXT_PUBLIC_SITE_URL.',
          code: 'google_not_configured',
        },
        { status: 400 },
      )
    }

    const state = crypto.randomBytes(32).toString('base64url')
    const jar = await cookies()
    jar.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // must survive the top-level redirect back from Google
      path: '/api/google/calendar',
      maxAge: 10 * 60,
    })

    return NextResponse.redirect(buildConsentUrl(env, state))
  } catch (err) {
    return toErrorResponse(err)
  }
}
