import { describe, expect, it } from 'vitest'
import { loadMessagePrices, FALLBACK_PRICES_USD } from './message-prices'

function fakeDb(result: { data?: unknown; error?: unknown } | Error) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    in: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: () =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  }
  return { from: () => builder } as never
}

const row = (over: Record<string, unknown> = {}) => ({
  country_code: 'BR',
  category: 'service',
  price_usd: 0.01,
  effective_from: '2026-10-01',
  ...over,
})

describe('loadMessagePrices', () => {
  it('uses the code table when the admin set nothing', async () => {
    const prices = await loadMessagePrices(fakeDb({ data: [] }))
    expect(prices.usingFallback).toBe(true)
    expect(prices.priceOf('utility')).toBe(FALLBACK_PRICES_USD.utility)
  })

  // Uma tela de custo que quebra porque a tabela de preços não leu é
  // pior que uma que mostra o preço do código.
  it('survives an unreadable price table', async () => {
    const prices = await loadMessagePrices(fakeDb(new Error('boom')))
    expect(prices.priceOf('marketing')).toBe(FALLBACK_PRICES_USD.marketing)
  })

  it('prefers the admin override', async () => {
    const prices = await loadMessagePrices(fakeDb({ data: [row({ price_usd: 0.02 })] }))
    expect(prices.priceOf('service')).toBe(0.02)
    expect(prices.usingFallback).toBe(false)
  })

  // A virada de outubro muda a tarifa de serviço. Converter setembro com
  // o preço de outubro reescreveria o passado.
  it('takes the newest vigência that has already started', async () => {
    const prices = await loadMessagePrices(
      fakeDb({
        data: [
          row({ price_usd: 0.005, effective_from: '2026-01-01' }),
          row({ price_usd: 0.0068, effective_from: '2026-10-01' }),
        ],
      }),
    )
    expect(prices.priceOf('service')).toBe(0.0068)
  })

  it('lets a country price beat the wildcard', async () => {
    const prices = await loadMessagePrices(
      fakeDb({
        data: [
          row({ country_code: '*', price_usd: 0.9 }),
          row({ country_code: 'BR', price_usd: 0.01 }),
        ],
      }),
    )
    expect(prices.priceOf('service')).toBe(0.01)
  })

  it('falls back to the service price for a category Meta has not shipped to us', async () => {
    const prices = await loadMessagePrices(fakeDb({ data: [] }))
    expect(prices.priceOf('categoria_nova_da_meta')).toBe(
      FALLBACK_PRICES_USD.service,
    )
  })

  it('ignores a malformed price rather than showing NaN', async () => {
    const prices = await loadMessagePrices(
      fakeDb({ data: [row({ price_usd: 'grátis' })] }),
    )
    expect(prices.priceOf('service')).toBe(FALLBACK_PRICES_USD.service)
  })
})
