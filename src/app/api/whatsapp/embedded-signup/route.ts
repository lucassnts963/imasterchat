// ============================================================
// POST /api/whatsapp/embedded-signup
//
// Finishes the Tech Provider onboarding the browser started: takes the
// short-lived `code` from Meta's Embedded Signup popup and wires the
// client's WhatsApp up end to end.
//
//   1. code → business access token          (needs META_APP_SECRET)
//   2. which WABA did they just share?       (debug_token)
//   3. which phone number is under it?
//   4. subscribe OUR app to that WABA's webhooks
//   5. store the token encrypted on the caller's account
//
// Step 4 is what makes inbound messages arrive: without it Meta accepts
// the connection but never delivers anything, which is the single most
// common "it connected but nothing happens" report on the manual path.
//
// Requires the 'admin' role — connecting WhatsApp is an account-level
// change, same bar as the manual config route.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  exchangeCodeForToken,
  listSharedWabas,
  listWabaPhoneNumbers,
} from '@/lib/whatsapp/embedded-signup'
import { registerPhoneNumber, subscribeWabaToApp } from '@/lib/whatsapp/meta-api'
import { supabaseAdmin } from '@/lib/admin/client'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(
      `embedded-signup:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    if (!appId || !appSecret) {
      console.error('[embedded-signup] META_APP_ID / META_APP_SECRET missing')
      return NextResponse.json(
        { error: 'server_not_configured' },
        { status: 500 },
      )
    }

    const body = (await request.json().catch(() => null)) as {
      code?: unknown
      // Optional hints from the popup's session-info message. When the
      // client's WABA hosts several numbers, the popup already knows
      // which one they picked — trusting our own lookup instead would
      // pick the wrong number for a multi-number WABA.
      phoneNumberId?: unknown
      wabaId?: unknown
      pin?: unknown
    } | null

    if (!body || typeof body.code !== 'string' || !body.code.trim()) {
      return NextResponse.json({ error: 'missing_code' }, { status: 400 })
    }

    // ---- 1. code → token ----
    let businessToken: string
    try {
      businessToken = await exchangeCodeForToken({
        code: body.code,
        appId,
        appSecret,
      })
    } catch (err) {
      console.error('[embedded-signup] code exchange failed:', err)
      return NextResponse.json(
        { error: 'code_exchange_failed', message: (err as Error).message },
        { status: 400 },
      )
    }

    // ---- 2. which WABA ----
    const hintedWabaId =
      typeof body.wabaId === 'string' && body.wabaId ? body.wabaId : null
    let wabaId = hintedWabaId
    let wabaName: string | null = null
    let businessId: string | null = null

    const shared = await listSharedWabas({
      businessToken,
      appId,
      appSecret,
    }).catch((err) => {
      console.error('[embedded-signup] waba lookup failed:', err)
      return []
    })

    if (hintedWabaId) {
      const match = shared.find((w) => w.wabaId === hintedWabaId)
      wabaName = match?.wabaName ?? null
      businessId = match?.businessId ?? null
    } else if (shared.length === 1) {
      wabaId = shared[0].wabaId
      wabaName = shared[0].wabaName
      businessId = shared[0].businessId
    } else if (shared.length > 1) {
      // Ambiguous without the popup's hint. Fail loudly rather than
      // guessing — connecting the wrong WABA silently routes another
      // business's messages into this account.
      return NextResponse.json(
        { error: 'multiple_wabas', wabas: shared },
        { status: 409 },
      )
    }

    if (!wabaId) {
      return NextResponse.json({ error: 'no_waba_shared' }, { status: 400 })
    }

    // ---- 3. which phone number ----
    let phoneNumberId =
      typeof body.phoneNumberId === 'string' && body.phoneNumberId
        ? body.phoneNumberId
        : null
    let displayPhoneNumber: string | null = null
    let verifiedName: string | null = null

    const numbers = await listWabaPhoneNumbers({
      wabaId,
      accessToken: businessToken,
    }).catch((err) => {
      console.error('[embedded-signup] phone lookup failed:', err)
      return []
    })

    if (phoneNumberId) {
      const match = numbers.find((n) => n.phoneNumberId === phoneNumberId)
      displayPhoneNumber = match?.displayPhoneNumber ?? null
      verifiedName = match?.verifiedName ?? null
    } else if (numbers.length === 1) {
      phoneNumberId = numbers[0].phoneNumberId
      displayPhoneNumber = numbers[0].displayPhoneNumber
      verifiedName = numbers[0].verifiedName
    } else if (numbers.length > 1) {
      return NextResponse.json(
        { error: 'multiple_phone_numbers', phoneNumbers: numbers },
        { status: 409 },
      )
    }

    if (!phoneNumberId) {
      return NextResponse.json({ error: 'no_phone_number' }, { status: 400 })
    }

    // A phone number can only feed one account: inbound webhooks are
    // routed by phone_number_id, so two accounts claiming the same
    // number would cross-deliver messages. Needs the service role —
    // RLS hides other accounts' rows from the caller's session.
    const { data: claimed } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle<{ account_id: string }>()

    if (claimed && claimed.account_id !== ctx.accountId) {
      return NextResponse.json(
        { error: 'phone_number_already_claimed' },
        { status: 409 },
      )
    }

    // ---- 4. subscribe our app to the WABA ----
    // Without this Meta never delivers inbound events. Non-fatal: the
    // config is still worth saving (outbound works, and the settings
    // screen's registration check will surface the gap), but the client
    // must be told inbound isn't live yet.
    let subscribed = true
    let subscribedAppsAt: string | null = null
    try {
      await subscribeWabaToApp({ wabaId, accessToken: businessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      subscribed = false
      console.error('[embedded-signup] waba subscribe failed:', err)
    }

    // Registering the number completes inbound wiring. It needs the
    // two-step PIN when the client set one; Embedded Signup numbers
    // usually have none, so a failure here is expected and reported
    // rather than fatal.
    let registered = true
    let registeredAt: string | null = null
    let registrationError: string | null = null
    try {
      await registerPhoneNumber({
        phoneNumberId,
        accessToken: businessToken,
        pin: typeof body.pin === 'string' ? body.pin : '',
      })
      registeredAt = new Date().toISOString()
    } catch (err) {
      registered = false
      registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] phone register failed:', err)
    }

    // ---- 5. persist ----
    const { error: upsertErr } = await supabaseAdmin()
      .from('whatsapp_config')
      .upsert(
        {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          access_token: encrypt(businessToken),
          status: 'connected',
          connected_at: new Date().toISOString(),
          onboarded_via: 'embedded_signup',
          meta_business_id: businessId,
          waba_name: wabaName,
          onboarded_at: new Date().toISOString(),
          registered_at: registeredAt,
          subscribed_apps_at: subscribedAppsAt,
          last_registration_error: registrationError,
        },
        // whatsapp_config carries UNIQUE constraints on BOTH account_id
        // (017: one number per account) and phone_number_id (013: one
        // account per number). Conflict on account_id, so reconnecting
        // with a different number updates the account's existing row
        // instead of failing. The cross-account case is already ruled
        // out by the phone_number_already_claimed check above.
        { onConflict: 'account_id' },
      )

    if (upsertErr) {
      console.error('[embedded-signup] config upsert failed:', upsertErr)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    }

    return NextResponse.json({
      connected: true,
      wabaId,
      wabaName,
      phoneNumberId,
      displayPhoneNumber,
      verifiedName,
      subscribed,
      registered,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
