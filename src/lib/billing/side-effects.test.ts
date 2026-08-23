import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The webhook keeps PERSISTING inbound messages for a gated account —
// that's the whole point, so unblocking loses nothing — and only stops
// the paid surface (flows, automations, AI auto-replies). This file
// guards which statuses stop it, and that a lookup failure fails OPEN
// so a transient DB error can't silence a paying customer's
// automations.

let queued: { data: unknown; error: unknown } = { data: null, error: null }
let lastTable: string | null = null
let lastEq: [string, unknown] | null = null

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      lastTable = table
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          lastEq = [col, val]
          return builder
        },
        maybeSingle: () => Promise.resolve(queued),
      }
      return builder
    },
  }),
}))

const { accountAllowsSideEffects } = await import('./side-effects')

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  queued = { data: null, error: null }
  lastTable = null
  lastEq = null
})

afterEach(() => vi.clearAllMocks())

describe('accountAllowsSideEffects', () => {
  it.each(['pending', 'blocked'])(
    'blocks flows/automations/AI for a %s account',
    async (billing_status) => {
      queued = { data: { billing_status }, error: null }
      await expect(accountAllowsSideEffects('acct-1')).resolves.toBe(false)
      expect(lastTable).toBe('accounts')
      expect(lastEq).toEqual(['id', 'acct-1'])
    },
  )

  it.each(['active', 'past_due'])(
    'allows side effects for an %s account',
    async (billing_status) => {
      queued = { data: { billing_status }, error: null }
      await expect(accountAllowsSideEffects('acct-1')).resolves.toBe(true)
    },
  )

  it('fails open when the billing lookup errors', async () => {
    // A paying customer's automations must not stop because the status
    // query glitched — the accepted failure mode is serving a gated
    // account for one message, not breaking every account.
    queued = { data: null, error: { code: '42703' } }
    await expect(accountAllowsSideEffects('acct-1')).resolves.toBe(true)
  })

  it('fails open when the account row has no billing_status yet', async () => {
    // Pre-037 schema, or a hand-inserted row.
    queued = { data: { billing_status: null }, error: null }
    await expect(accountAllowsSideEffects('acct-1')).resolves.toBe(true)
  })
})
