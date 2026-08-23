import { createClient } from '@supabase/supabase-js'

// ============================================================
// Billing gate for inbound side effects.
//
// A gated account (`pending` awaiting approval, or `blocked` for
// non-payment) still RECEIVES WhatsApp messages: the webhook keeps
// persisting contacts, conversations, and messages, so approving or
// unblocking the account restores a complete history and nothing the
// customer sent is lost. That is a deliberate product decision — a
// billing dispute must not turn into data loss.
//
// What a gated account does NOT get is anything that acts on the
// operator's behalf: automations, flow runs, AI auto-replies, and
// outbound sends. Those are the paid surface, and letting them run
// would mean serving an unpaid account.
//
// Outbound API routes are already covered by the 402 in
// `getCurrentAccount`; this helper covers the webhook path, which
// runs service-role and has no user session to gate.
// ============================================================

let _client: ReturnType<typeof createClient> | null = null

function admin() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _client
}

/**
 * True when the account may run automations / flows / AI replies.
 *
 * Fails OPEN: if the status can't be read (query error, or a column
 * missing because migration 037 hasn't been applied yet), side effects
 * are allowed. A billing lookup glitch must not silently stop a paying
 * customer's automations — the failure mode we accept is serving a
 * gated account for one message, not breaking every account.
 */
export async function accountAllowsSideEffects(
  accountId: string,
): Promise<boolean> {
  const { data, error } = await admin()
    .from('accounts')
    .select('billing_status')
    .eq('id', accountId)
    .maybeSingle<{ billing_status: string | null }>()

  if (error) {
    console.error('[billing] side-effect gate lookup failed:', error)
    return true
  }

  const status = data?.billing_status
  return status !== 'pending' && status !== 'blocked'
}
