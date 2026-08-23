import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Reaching an attendant whose phone is in their pocket.
//
// Realtime already covers the open tab. This covers the closed one,
// which is the only thing installing the app actually buys.
//
// `web-push` is a dependency rather than hand-rolled, and that is a
// deliberate exception to how the rest of this codebase talks to the
// outside world. The providers and Meta get raw `fetch` because they
// are HTTP and JSON. Web Push is not: the payload must be encrypted
// with ECDH + HKDF + AES128GCM and the request signed with a VAPID
// JWT. Hand-rolling cryptography to save one dependency is how you
// ship something that looks like it works and silently protects
// nothing.
// ============================================================

export type NotifyMode = 'all' | 'human_needed'

export interface PushPayload {
  title: string
  body: string
  /** Where the notification takes them. Defaults to the inbox. */
  url?: string
  /** Collapse key — several messages from one thread become one. */
  tag?: string
  /** Vibrates, and re-alerts over a collapsed notification. */
  urgent?: boolean
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  user_id: string
}

let configured: boolean | null = null

/**
 * Whether this deployment can send at all.
 *
 * Cached after the first call: it is read on every inbound message and
 * the answer cannot change without a restart.
 */
export function isPushConfigured(): boolean {
  if (configured !== null) return configured

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@imasterchat.app'

  if (!publicKey || !privateKey) {
    configured = false
    return false
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configured = true
  } catch (err) {
    // A malformed key pair is a configuration mistake, and one that
    // would otherwise show up as "notifications just never arrive".
    console.error('[push] VAPID keys are present but unusable:', err)
    configured = false
  }
  return configured
}

/**
 * Send to every subscription in an account that asked for this class of
 * notification.
 *
 * Never throws. This runs inside the WhatsApp webhook's `after()`, on
 * the same path as delivering a customer's message — a push service
 * being slow or down must not touch that.
 */
export async function sendPushToAccount(
  db: SupabaseClient,
  args: {
    accountId: string
    payload: PushPayload
    /** `human_needed` reaches both modes; `all` only reaches 'all'. */
    urgency: NotifyMode
    /** Skip this user — usually whoever caused the event. */
    exceptUserId?: string | null
  },
): Promise<{ sent: number; pruned: number }> {
  if (!isPushConfigured()) return { sent: 0, pruned: 0 }

  try {
    let query = db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, user_id')
      .eq('account_id', args.accountId)

    // A subscriber on 'human_needed' hears only the urgent class; one
    // on 'all' hears everything. So an urgent event goes to both, and
    // an ordinary one goes to 'all' alone.
    if (args.urgency === 'all') query = query.eq('notify_mode', 'all')

    const { data, error } = await query.limit(200)
    if (error) throw error

    const subs = ((data ?? []) as SubscriptionRow[]).filter(
      (s) => !args.exceptUserId || s.user_id !== args.exceptUserId,
    )
    if (subs.length === 0) return { sent: 0, pruned: 0 }

    const body = JSON.stringify(args.payload)
    const dead: string[] = []
    let sent = 0

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
            { TTL: 60 * 60 },
          )
          sent += 1
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          // 404/410 mean the browser threw the subscription away —
          // uninstalled, permission revoked, profile wiped. Keeping it
          // would mean retrying a dead endpoint on every message
          // forever.
          if (status === 404 || status === 410) {
            dead.push(sub.id)
          } else {
            console.error('[push] send failed', status, err)
          }
        }
      }),
    )

    if (dead.length > 0) {
      await db.from('push_subscriptions').delete().in('id', dead)
    } else if (sent > 0) {
      await db
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .in(
          'id',
          subs.map((s) => s.id),
        )
    }

    return { sent, pruned: dead.length }
  } catch (err) {
    console.error('[push] dispatch failed:', err)
    return { sent: 0, pruned: 0 }
  }
}

/** Trim a message for a notification body. */
export function previewText(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}
