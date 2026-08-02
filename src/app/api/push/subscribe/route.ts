import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { isPushConfigured } from '@/lib/push/send'

// ============================================================
// GET    /api/push/subscribe   — this device's current state
// POST   /api/push/subscribe   — register or change the mode
// DELETE /api/push/subscribe   — stop notifying this device
//
// Any member, not admin: a subscription names a device somebody
// carries, and deciding whether your own phone buzzes is not a
// settings-class decision.
//
// Switching off deletes the row rather than storing an 'off' mode. The
// browser permission stays granted, so turning it back on is one click
// with no prompt — and meanwhile there is no row for the sender to skip
// and no dead subscription to reason about.
// ============================================================

export async function GET(request: Request) {
  try {
    const { supabase, userId } = await getCurrentAccount()
    const endpoint = new URL(request.url).searchParams.get('endpoint')

    if (!endpoint) {
      return NextResponse.json({
        available: isPushConfigured(),
        subscribed: false,
      })
    }

    const { data } = await supabase
      .from('push_subscriptions')
      .select('notify_mode')
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .maybeSingle<{ notify_mode: 'all' | 'human_needed' }>()

    return NextResponse.json({
      available: isPushConfigured(),
      subscribed: Boolean(data),
      notify_mode: data?.notify_mode ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()

    if (!isPushConfigured()) {
      return NextResponse.json(
        {
          error:
            'Este servidor não tem as chaves de notificação configuradas (VAPID).',
          code: 'push_not_configured',
        },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => null)) as {
      endpoint?: unknown
      keys?: { p256dh?: unknown; auth?: unknown }
      notify_mode?: unknown
      user_agent?: unknown
    } | null

    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : ''
    const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : ''
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: 'Assinatura de push incompleta.' },
        { status: 400 },
      )
    }

    const mode =
      body?.notify_mode === 'all' || body?.notify_mode === 'human_needed'
        ? body.notify_mode
        : 'human_needed'

    // Upsert on the endpoint: a device that re-subscribes keeps one row
    // rather than accumulating one per visit. It also re-homes the
    // subscription if the user switched accounts on the same browser.
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        account_id: accountId,
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        notify_mode: mode,
        user_agent:
          typeof body?.user_agent === 'string'
            ? body.user_agent.slice(0, 200)
            : null,
      },
      { onConflict: 'endpoint' },
    )

    if (error) {
      console.error('[push/subscribe] save failed:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ subscribed: true, notify_mode: mode })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, userId } = await getCurrentAccount()
    const endpoint = new URL(request.url).searchParams.get('endpoint')
    if (!endpoint) {
      return NextResponse.json({ error: "'endpoint' is required" }, { status: 400 })
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint)

    if (error) {
      console.error('[push/subscribe] delete failed:', error)
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    }
    return NextResponse.json({ subscribed: false })
  } catch (err) {
    return toErrorResponse(err)
  }
}
