import { describe, it, expect, vi } from 'vitest'
import { buildEnvironment, formatInZone } from './environment'

/**
 * Minimal chainable Supabase stand-in: filters return `this`, and the
 * chain resolves to whatever the table was seeded with.
 */
function db(tables: Record<string, { data: unknown; error?: unknown }>) {
  return {
    from(table: string) {
      const result = () => tables[table] ?? { data: null, error: null }
      const c: Record<string, unknown> = {}
      Object.assign(c, {
        select: () => c,
        eq: () => c,
        gte: () => c,
        order: () => c,
        limit: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(ok, err),
      })
      return c
    },
  } as never
}

const SP = 'America/Sao_Paulo'

describe('formatInZone', () => {
  it('renders the weekday and an ISO-ordered date in the business zone', () => {
    // 02:30 UTC on Aug 1 is still July 31 in São Paulo — exactly the
    // off-by-one a model makes when nobody tells it the zone.
    const at = new Date('2026-08-01T02:30:00Z')
    expect(formatInZone(at, SP)).toBe('Friday, 2026-07-31 23:30')
    expect(formatInZone(at, 'UTC')).toBe('Saturday, 2026-08-01 02:30')
  })
})

describe('buildEnvironment', () => {
  const now = new Date('2026-08-01T14:00:00Z')

  it('always states the date, even with no contact', async () => {
    const out = await buildEnvironment({
      db: db({}),
      accountId: 'acct',
      contactId: null,
      timezone: SP,
      now,
    })
    expect(out).toContain('Saturday, 2026-08-01 11:00')
    expect(out).toContain(SP)
    expect(out).toContain('Never guess the date')
    // Says what production would supply, so the Playground doesn't
    // rehearse a conversation where the customer is a stranger.
    expect(out).toContain('test run')
    expect(out).toContain('WhatsApp number')
  })

  it('names the customer and lists their tags', async () => {
    const out = await buildEnvironment({
      db: db({
        contacts: {
          data: {
            name: 'Maria Souza',
            phone: '+5511999990000',
            contact_tags: [{ tags: { name: 'cliente-vip' } }, { tags: { name: 'lentes' } }],
          },
        },
        appointments: { data: [] },
      }),
      accountId: 'acct',
      contactId: 'c1',
      timezone: SP,
      now,
    })
    expect(out).toContain('Maria Souza')
    expect(out).toContain('+5511999990000')
    expect(out).toContain('cliente-vip, lentes')
    // Asking for a number it is already being messaged from reads as not
    // paying attention, and costs a round-trip the dialogue cannot spare.
    expect(out).toContain('Never ask for it')
    expect(out).not.toContain('test run')
  })

  it('warns about a booking the customer already has', async () => {
    const out = await buildEnvironment({
      db: db({
        contacts: { data: { name: 'João', phone: null, contact_tags: [] } },
        appointments: {
          data: [
            {
              starts_at: '2026-08-06T17:00:00Z',
              ends_at: '2026-08-06T18:00:00Z',
              title: 'exame de vista',
            },
          ],
        },
      }),
      accountId: 'acct',
      contactId: 'c1',
      timezone: SP,
      now,
    })
    expect(out).toContain('exame de vista')
    expect(out).toContain('Thursday, 2026-08-06 14:00')
    expect(out).toContain('Do not book a second one')
  })

  it('keeps the date line when a lookup blows up', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await buildEnvironment({
      db: db({
        contacts: { data: null, error: new Error('column does not exist') },
        appointments: { data: null, error: new Error('relation does not exist') },
      }),
      accountId: 'acct',
      contactId: 'c1',
      timezone: SP,
      now,
    })
    // Degrades to just the facts we still have — a missing tag list must
    // never cost the customer their reply.
    expect(out).toContain('Saturday, 2026-08-01 11:00')
    expect(out).not.toContain('You are talking to')
    err.mockRestore()
  })
})
