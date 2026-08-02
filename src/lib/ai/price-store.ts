import type { SupabaseClient } from '@supabase/supabase-js'
import type { PriceOverrides } from './pricing'

// ============================================================
// Prices as the platform admin has them, laid over the code table.
//
// Read-only helper: every cost screen calls this, gets whatever the
// admin has set, and falls back to the constants when the table is
// empty or unreachable. A missing table must never break a cost
// figure — showing a slightly stale price beats showing an error where
// a number should be.
// ============================================================

interface PriceRow {
  model_prefix: string
  input_usd: number | string
  output_usd: number | string
}

export async function loadPriceOverrides(
  db: SupabaseClient,
): Promise<PriceOverrides> {
  try {
    const { data, error } = await db
      .from('ai_model_prices')
      .select('model_prefix, input_usd, output_usd')
      .limit(500)
    if (error) throw error

    const overrides: PriceOverrides = {}
    for (const row of (data ?? []) as PriceRow[]) {
      // numeric() comes back as a string from PostgREST; a silent NaN
      // here would price everything at zero and look like great news.
      const input = Number(row.input_usd)
      const output = Number(row.output_usd)
      if (!Number.isFinite(input) || !Number.isFinite(output)) continue
      overrides[row.model_prefix.trim().toLowerCase()] = { input, output }
    }
    return overrides
  } catch (err) {
    console.error('[ai pricing] overrides unreadable, using the code table:', err)
    return {}
  }
}

export interface ExchangeRate {
  currency: string
  rate: number
  source: 'manual' | 'auto'
  fetchedAt: string
  /** Whole days since it was last refreshed — what the UI shows so a
   *  stale rate is visible rather than presented as fact. */
  ageDays: number
}

export async function loadExchangeRate(
  db: SupabaseClient,
  currency = 'BRL',
): Promise<ExchangeRate | null> {
  try {
    const { data, error } = await db
      .from('exchange_rates')
      .select('currency, usd_rate, source, fetched_at')
      .eq('currency', currency)
      .maybeSingle<{
        currency: string
        usd_rate: number | string
        source: 'manual' | 'auto'
        fetched_at: string
      }>()
    if (error || !data) return null

    const rate = Number(data.usd_rate)
    if (!Number.isFinite(rate) || rate <= 0) return null

    return {
      currency: data.currency,
      rate,
      source: data.source,
      fetchedAt: data.fetched_at,
      ageDays: Math.floor(
        (Date.now() - Date.parse(data.fetched_at)) / (24 * 60 * 60_000),
      ),
    }
  } catch (err) {
    console.error('[ai pricing] exchange rate unreadable:', err)
    return null
  }
}

/**
 * Fetch USD→BRL from AwesomeAPI.
 *
 * Chosen because it is Brazilian, free, needs no key, and publishes the
 * commercial dollar — the rate a Brazilian actually recognises. It is
 * still a third party: every failure returns null and the caller keeps
 * whatever it had, because a rate that is a day old beats no rate.
 */
export async function fetchUsdToBrl(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://economia.awesomeapi.com.br/json/last/USD-BRL',
      { signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { USDBRL?: { bid?: string } }
    const rate = Number(data?.USDBRL?.bid)
    // Sanity-check the value, not just the request. A malformed payload
    // that parses to 0.02 would quietly make every price look free.
    if (!Number.isFinite(rate) || rate < 1 || rate > 50) return null
    return rate
  } catch (err) {
    console.error('[exchange] fetch failed:', err)
    return null
  }
}
