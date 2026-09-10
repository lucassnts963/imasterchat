import type { PriceTable } from './message-prices'

// ============================================================
// De contagem para dinheiro — fase 3, R-15.
//
// A `whatsapp_message_costs` guarda a decisão da PRÓPRIA META por
// mensagem. Esta função transforma isso em três números que o operador
// consegue usar:
//
//   cobrado    o que já saiu da conta
//   previsão   o que ISSO teria custado sob as regras de outubro
//   por origem o que cortar, quando o total assusta
//
// A previsão é a razão de o PR #3 ter sido feito antes de outubro: toda
// mensagem que hoje chega `free_customer_service` é exatamente uma que
// passa a custar em 1º/10. Quem começou a capturar em agosto chega na
// virada com um número real em vez de uma surpresa na fatura.
// ============================================================

export interface CostRow {
  billable: boolean
  /** regular | free_customer_service | free_entry_point */
  pricing_type: string | null
  /** marketing | utility | service | authentication */
  pricing_category: string | null
  /** De onde veio, quando soubemos. Ver `message-origin.ts`. */
  origin?: string | null
}

export interface CostBucket {
  count: number
  billedUsd: number
  /** Cobrado + o que passará a ser cobrado sob as regras de outubro. */
  forecastUsd: number
}

export interface CostSummary extends CostBucket {
  byCategory: Record<string, CostBucket>
  byOrigin: Record<string, CostBucket>
  /** Mensagens que entraram pela janela de 72h de anúncio. Continuam
   *  grátis DEPOIS de outubro — é a única entrada que sobrevive, e a
   *  alavanca comercial que o operador precisa enxergar. */
  freeEntryPointCount: number
}

const emptyBucket = (): CostBucket => ({ count: 0, billedUsd: 0, forecastUsd: 0 })

/**
 * Uma mensagem grátis hoje passa a ser cobrada em outubro?
 *
 * `free_customer_service` sim: é a política que acaba. `free_entry_point`
 * não: a janela de 72 horas por anúncio Click-to-WhatsApp sobrevive
 * intacta, para todos os tipos de mensagem. Tratar as duas como iguais
 * inflaria a previsão justamente para o cliente que tem tráfego pago —
 * que é o que menos vai sentir a mudança.
 */
function willBeBilled(row: CostRow): boolean {
  if (row.billable) return true
  return row.pricing_type === 'free_customer_service'
}

export function summarizeCosts(
  rows: CostRow[],
  prices: PriceTable,
): CostSummary {
  const summary: CostSummary = {
    ...emptyBucket(),
    byCategory: {},
    byOrigin: {},
    freeEntryPointCount: 0,
  }

  for (const row of rows) {
    const price = prices.priceOf(row.pricing_category)
    const billed = row.billable ? price : 0
    const forecast = willBeBilled(row) ? price : 0
    // Origem desconhecida é o normal para toda mensagem gravada antes da
    // migração 080. Agrupar sob um rótulo próprio é mais honesto que
    // espalhá-la entre as outras.
    const origin = row.origin ?? 'unknown'
    const category = row.pricing_category ?? 'unknown'

    if (row.pricing_type === 'free_entry_point') summary.freeEntryPointCount += 1

    for (const bucket of [
      summary,
      (summary.byCategory[category] ??= emptyBucket()),
      (summary.byOrigin[origin] ??= emptyBucket()),
    ]) {
      bucket.count += 1
      bucket.billedUsd += billed
      bucket.forecastUsd += forecast
    }
  }

  return summary
}
