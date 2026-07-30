import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { estimateCostUsd } from '@/lib/ai/pricing'

// Same in-process aggregation cap as /api/ai/usage — a calendar month
// of an active account sits comfortably under it, and `truncated`
// tells the UI when it doesn't.
const MAX_ROWS = 10_000

interface UsageRow {
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/**
 * GET /api/ai/costs  (admin+)
 *
 * Month-to-date estimated USD spend on the account's BYO provider key,
 * plus the optional monthly budget (ai_configs.monthly_budget_usd,
 * migration 040). Providers bill in USD and expose no balance API, so
 * cost is estimated from `ai_usage_log` tokens × published list prices
 * (src/lib/ai/pricing.ts). `estimated` flags that at least one row was
 * priced by class fallback rather than a known model family. Feeds the
 * dashboard cost card and its budget-nearly-exhausted warning.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config, error: cfgError } = await supabase
      .from('ai_configs')
      .select('monthly_budget_usd')
      .eq('account_id', accountId)
      .maybeSingle()

    if (cfgError) {
      console.error('[ai/costs GET] config fetch error:', cfgError)
      return NextResponse.json(
        { error: 'Failed to load AI costs' },
        { status: 500 },
      )
    }

    // No AI config → nothing to report; the card hides itself.
    if (!config) return NextResponse.json({ configured: false })

    // Calendar-month window (server-local), matching how a monthly
    // budget is naturally read — "spent this month", not a rolling 30d.
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const { data, error } = await supabase
      .from('ai_usage_log')
      .select('provider, model, prompt_tokens, completion_tokens, total_tokens')
      .eq('account_id', accountId)
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS + 1)

    if (error) {
      console.error('[ai/costs GET] usage fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load AI costs' },
        { status: 500 },
      )
    }

    const all = (data ?? []) as UsageRow[]
    const truncated = all.length > MAX_ROWS
    const rows = truncated ? all.slice(0, MAX_ROWS) : all

    let spendUsd = 0
    let anyFallback = false
    const modelMap = new Map<
      string,
      { model: string; provider: string; cost_usd: number; tokens: number }
    >()

    for (const r of rows) {
      const { usd, fallback } = estimateCostUsd(
        r.model,
        r.prompt_tokens,
        r.completion_tokens,
      )
      spendUsd += usd
      anyFallback ||= fallback

      const mk = `${r.provider}:${r.model}`
      const m =
        modelMap.get(mk) ??
        { model: r.model, provider: r.provider, cost_usd: 0, tokens: 0 }
      m.cost_usd += usd
      m.tokens += r.total_tokens
      modelMap.set(mk, m)
    }

    const budget =
      config.monthly_budget_usd === null
        ? null
        : Number(config.monthly_budget_usd)

    return NextResponse.json({
      configured: true,
      truncated,
      estimated: anyFallback,
      month_spend_usd: spendUsd,
      budget_usd: budget,
      by_model: [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
