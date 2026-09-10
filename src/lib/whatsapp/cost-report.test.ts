import { describe, expect, it } from 'vitest'
import { summarizeCosts, type CostRow } from './cost-report'

const prices = {
  usingFallback: false,
  priceOf: (category: string | null) =>
    category === 'marketing' ? 0.06 : 0.01,
}

const row = (over: Partial<CostRow> = {}): CostRow => ({
  billable: false,
  pricing_type: 'free_customer_service',
  pricing_category: 'service',
  origin: 'ai',
  ...over,
})

describe('summarizeCosts', () => {
  it('separates what was billed from what will be', () => {
    const out = summarizeCosts(
      [row(), row({ billable: true, pricing_type: 'regular' })],
      prices,
    )
    expect(out.count).toBe(2)
    expect(out.billedUsd).toBeCloseTo(0.01)
    expect(out.forecastUsd).toBeCloseTo(0.02)
  })

  // A janela de 72h por anúncio sobrevive a outubro intacta. Tratá-la
  // como as outras gratuitas inflaria a previsão justamente para o
  // cliente com tráfego pago — que é quem menos vai sentir a mudança.
  it('does not forecast a cost for the ad entry point', () => {
    const out = summarizeCosts([row({ pricing_type: 'free_entry_point' })], prices)
    expect(out.forecastUsd).toBe(0)
    expect(out.freeEntryPointCount).toBe(1)
  })

  it('breaks the bill down by what to cut', () => {
    const out = summarizeCosts(
      [
        row({ origin: 'ai' }),
        row({ origin: 'ai' }),
        row({ origin: 'broadcast', pricing_category: 'marketing', billable: true }),
      ],
      prices,
    )
    expect(out.byOrigin.ai.count).toBe(2)
    expect(out.byOrigin.broadcast.billedUsd).toBeCloseTo(0.06)
    expect(out.byCategory.marketing.count).toBe(1)
  })

  // Toda mensagem gravada antes da migração 080 não tem origem. Agrupar
  // sob um rótulo próprio é mais honesto que espalhá-la entre as outras.
  it('keeps messages with no known origin in their own bucket', () => {
    const out = summarizeCosts([row({ origin: null })], prices)
    expect(out.byOrigin.unknown.count).toBe(1)
  })

  it('is zero for a month with nothing sent', () => {
    const out = summarizeCosts([], prices)
    expect(out).toMatchObject({ count: 0, billedUsd: 0, forecastUsd: 0 })
  })
})
