import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  checkWhatsappBudget,
  monthToDateMessageSpendUsd,
  resetBudgetCache,
} from './budget-gate'

const h = vi.hoisted(() => ({ prices: { service: 0.01 } }))

vi.mock('./message-prices', () => ({
  loadMessagePrices: async () => ({
    usingFallback: false,
    priceOf: () => h.prices.service,
  }),
}))

interface FakeState {
  budget: number | null
  costs: Array<{ billable: boolean; pricing_category: string | null }>
}

function fakeDb(state: FakeState) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        gte: () => b,
        limit: () =>
          Promise.resolve({
            data: table === 'whatsapp_message_costs' ? state.costs : [],
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'ai_configs'
                ? { whatsapp_monthly_budget_usd: state.budget }
                : null,
            error: null,
          }),
        insert: () => Promise.resolve({ data: null, error: null }),
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(ok),
      }
      return b
    },
  } as never
}

const billed = (n: number) =>
  Array.from({ length: n }, () => ({ billable: true, pricing_category: 'service' }))

beforeEach(() => resetBudgetCache())

describe('monthToDateMessageSpendUsd', () => {
  it('counts only what Meta actually billed', async () => {
    const db = fakeDb({
      budget: null,
      costs: [
        ...billed(3),
        { billable: false, pricing_category: 'service' },
      ],
    })
    await expect(monthToDateMessageSpendUsd(db, 'acct-1')).resolves.toBeCloseTo(0.03)
  })
})

describe('checkWhatsappBudget', () => {
  // A regra que manda em tudo neste módulo. Calar uma pessoa que está
  // respondendo um cliente para economizar quatro centavos é pior que a
  // fatura que o teto existe para evitar.
  it('never blocks the human agent, however far over budget', async () => {
    const db = fakeDb({ budget: 0.01, costs: billed(500) })
    await expect(
      checkWhatsappBudget({ db, accountId: 'acct-1', origin: 'inbox' }),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('blocks a robot once the cap is reached', async () => {
    const db = fakeDb({ budget: 0.02, costs: billed(2) })
    await expect(
      checkWhatsappBudget({ db, accountId: 'acct-1', origin: 'automation' }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'whatsapp_budget_exceeded',
    })
  })

  it('lets a robot through while there is room', async () => {
    const db = fakeDb({ budget: 1, costs: billed(2) })
    await expect(
      checkWhatsappBudget({ db, accountId: 'acct-1', origin: 'flow' }),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('does not even count when there is no cap set', async () => {
    const db = fakeDb({ budget: null, costs: billed(9999) })
    await expect(
      checkWhatsappBudget({ db, accountId: 'acct-1', origin: 'broadcast' }),
    ).resolves.toMatchObject({ allowed: true, budgetUsd: null })
  })

  // Um teto que derruba o atendimento quando o banco tosse troca um
  // problema de conta por um problema de cliente, e o segundo é pior.
  it('fails open when the query throws', async () => {
    const db = {
      from() {
        throw new Error('database is on fire')
      },
    } as never
    await expect(
      checkWhatsappBudget({ db, accountId: 'acct-1', origin: 'ai' }),
    ).resolves.toMatchObject({ allowed: true })
  })
})
