/**
 * Estimated per-model API prices, in USD per 1M tokens.
 *
 * Used by GET /api/ai/costs to turn the token counts in `ai_usage_log`
 * into a month-to-date cost estimate for the dashboard cost card.
 * Providers bill the account's own key directly and expose no billing
 * or balance API, so an in-app estimate from published list prices is
 * the best signal available.
 *
 * Model IDs churn fast and forks can type any model into the settings
 * form, so this is a longest-prefix match over known families with a
 * class-based fallback (mini/nano/haiku-style names get the cheap-tier
 * fallback) rather than a hard allow-list. Every row priced by
 * fallback flips `estimated` in the API response so the UI can say
 * "estimativa" honestly. Prices drift — when a provider changes list
 * price, update the table; nothing else needs to change.
 */

export interface ModelPrice {
  /** USD per 1M prompt (input) tokens. */
  input: number
  /** USD per 1M completion (output) tokens. */
  output: number
}

/**
 * Known families, matched by longest prefix against the stored model
 * string (which may carry a date suffix, e.g. "gpt-4o-2024-08-06" or
 * "claude-haiku-4-5-20251001").
 */
const PRICES: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5': { input: 1.25, output: 10 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'o3': { input: 2, output: 8 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  // Anthropic
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },
}

/** Cheap-tier fallback for unknown small models (…mini/nano/haiku…). */
const FALLBACK_SMALL: ModelPrice = { input: 0.5, output: 2 }
/** Standard-tier fallback for every other unknown model. */
const FALLBACK_STANDARD: ModelPrice = { input: 3, output: 15 }

/**
 * The families this table knows, for the settings picker.
 *
 * Derived from the price table rather than kept as a second list:
 * a model offered in the dropdown but absent here would be priced by
 * class fallback, so the two would drift into the operator picking
 * something whose cost we then guess at.
 *
 * It stays a suggestion, never an allow-list — model IDs churn fast
 * and a forker must be able to type one this table has never heard
 * of.
 */
export function knownModels(
  provider: 'openai' | 'anthropic',
  overrides?: PriceOverrides,
): {
  id: string
  price: ModelPrice
}[] {
  const isAnthropic = (id: string) => id.startsWith('claude')
  return Object.entries(overrides ? { ...PRICES, ...overrides } : PRICES)
    .filter(([id]) => (provider === 'anthropic') === isAnthropic(id))
    .map(([id, price]) => ({ id, price }))
    .sort((a, b) => a.price.input - b.price.input)
}

// Longest prefix first so "gpt-4o-mini" wins over "gpt-4o".
const PREFIXES = Object.keys(PRICES).sort((a, b) => b.length - a.length)

export interface CostEstimate {
  /** Estimated USD cost for the given token counts. */
  usd: number
  /** True when no known family matched and a class fallback priced it. */
  fallback: boolean
}

/**
 * Prices as they stand right now: the code table with any
 * platform-admin overrides laid on top.
 *
 * The code table remains the seed AND the fallback, so a deployment
 * that never edits a price behaves exactly as it did before this
 * existed — which is what makes the override safe to ship.
 */
export type PriceOverrides = Record<string, ModelPrice>

/** Estimate the USD cost of one logged call. */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  overrides?: PriceOverrides,
): CostEstimate {
  const normalized = model.trim().toLowerCase()
  const table = overrides ? { ...PRICES, ...overrides } : PRICES
  // Re-sort only when overrides added a prefix the constant list
  // does not carry; otherwise reuse the precomputed order.
  const prefixes = overrides
    ? Object.keys(table).sort((a, b) => b.length - a.length)
    : PREFIXES
  const prefix = prefixes.find((p) => normalized.startsWith(p))
  const price = prefix
    ? table[prefix]
    : /mini|nano|haiku|lite|flash/.test(normalized)
      ? FALLBACK_SMALL
      : FALLBACK_STANDARD
  const usd =
    (Math.max(0, promptTokens) * price.input +
      Math.max(0, completionTokens) * price.output) /
    1_000_000
  return { usd, fallback: !prefix }
}

/** The built-in table, for seeding the editable one. */
export function defaultPrices(): { model_prefix: string; provider: 'openai' | 'anthropic'; input_usd: number; output_usd: number }[] {
  return Object.entries(PRICES).map(([model_prefix, price]) => ({
    model_prefix,
    provider: model_prefix.startsWith('claude')
      ? ('anthropic' as const)
      : ('openai' as const),
    input_usd: price.input,
    output_usd: price.output,
  }))
}
