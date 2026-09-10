import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadMessagePrices } from '@/lib/whatsapp/message-prices'
import { summarizeCosts, type CostRow } from '@/lib/whatsapp/cost-report'

// O mesmo teto de agregação em processo de `/api/ai/costs`: um mês de
// uma conta ativa cabe folgado, e `truncated` avisa quando não coube.
const MAX_ROWS = 50_000

/**
 * GET /api/whatsapp/costs  (admin+)
 *
 * O gasto do mês com MENSAGENS da Meta, ao lado do gasto com IA que
 * `/api/ai/costs` já respondia. A partir de 1º/10/2026 existem dois
 * custos por conversa, e o operador precisa ver os dois antes da fatura,
 * não depois.
 *
 * Três números, e cada um responde uma pergunta diferente:
 *
 *   `billed`    o que já saiu da conta
 *   `forecast`  o que ISSO teria custado sob as regras de outubro — é o
 *               que a captura desde agosto (migração 075) permite dizer
 *   `by_origin` o que cortar, quando o total assusta
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const since = new Date()
    since.setUTCDate(1)
    since.setUTCHours(0, 0, 0, 0)

    const [costsRes, prices, configRes, blockedRes] = await Promise.all([
      supabase
        .from('whatsapp_message_costs')
        .select('message_id, billable, pricing_type, pricing_category')
        .eq('account_id', accountId)
        .gte('recorded_at', since.toISOString())
        .limit(MAX_ROWS),
      loadMessagePrices(supabase),
      supabase
        .from('ai_configs')
        .select('whatsapp_monthly_budget_usd')
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('whatsapp_blocked_sends')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .gte('blocked_at', since.toISOString()),
    ])

    if (costsRes.error) {
      return NextResponse.json({ error: costsRes.error.message }, { status: 500 })
    }
    const raw = (costsRes.data ?? []) as Array<CostRow & { message_id: string }>

    // A origem mora em `messages`, escrita no envio (migração 080). O
    // custo vem do webhook de status, que só conhece o id da Meta — daí
    // a junção ser feita aqui e não no banco: são duas tabelas com
    // tenancy diferente, e uma consulta só as amarraria por um caminho
    // que o RLS não cobre igual.
    const originByMessage = new Map<string, string>()
    const ids = raw.map((r) => r.message_id).filter(Boolean)
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await supabase
        .from('messages')
        .select('message_id, origin')
        .in('message_id', ids.slice(i, i + 500))
      for (const m of (data ?? []) as { message_id: string; origin: string | null }[]) {
        if (m.origin) originByMessage.set(m.message_id, m.origin)
      }
    }

    const summary = summarizeCosts(
      raw.map((r) => ({ ...r, origin: originByMessage.get(r.message_id) ?? null })),
      prices,
    )

    return NextResponse.json({
      month: since.toISOString().slice(0, 7),
      count: summary.count,
      billed_usd: round(summary.billedUsd),
      forecast_usd: round(summary.forecastUsd),
      free_entry_point_count: summary.freeEntryPointCount,
      by_category: mapBuckets(summary.byCategory),
      by_origin: mapBuckets(summary.byOrigin),
      budget_usd:
        (configRes.data as { whatsapp_monthly_budget_usd?: number } | null)
          ?.whatsapp_monthly_budget_usd ?? null,
      blocked_count: blockedRes.count ?? 0,
      /** Nenhum override de preço lido: os valores vêm das constantes. */
      using_fallback_prices: prices.usingFallback,
      truncated: raw.length >= MAX_ROWS,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function mapBuckets(
  buckets: Record<string, { count: number; billedUsd: number; forecastUsd: number }>,
) {
  return Object.entries(buckets)
    .map(([key, b]) => ({
      key,
      count: b.count,
      billed_usd: round(b.billedUsd),
      forecast_usd: round(b.forecastUsd),
    }))
    .sort((a, b) => b.forecast_usd - a.forecast_usd || b.count - a.count)
}

/** Centavos de dólar não ajudam ninguém; seis casas escondem o total. */
function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000
}
