import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Quanto custa uma mensagem da Meta.
//
// A `whatsapp_message_costs` (migração 075) grava o que a Meta COBROU —
// categoria, tipo, e a decisão dela sobre ser cobrável. O que falta para
// virar dinheiro é a tarifa, e é isso que mora aqui.
//
// Mesmo padrão de `ai/price-store.ts`: constantes no código, com
// override do administrador da plataforma por cima. Tabela vazia ou
// inacessível cai nas constantes — mostrar preço levemente defasado é
// melhor que mostrar erro onde devia haver número.
// ============================================================

/** As quatro categorias que a Meta usa hoje. */
export type MessageCategory =
  | 'marketing'
  | 'utility'
  | 'service'
  | 'authentication'

/**
 * Tarifas por conversa→mensagem no Brasil, em dólares, a partir de
 * 1º/10/2026. Serviço passou a valer o mesmo que utilidade — que é a
 * mudança inteira.
 *
 * **Confira na página oficial de pricing antes de decidir preço.** Estes
 * números vêm de fontes secundárias que concordam entre si; a página da
 * Meta está bloqueada pelo proxy deste ambiente. Ver
 * `docs/cobranca-whatsapp-out-2026.md`.
 */
const FALLBACK_PRICES_USD: Record<MessageCategory, number> = {
  marketing: 0.0625,
  utility: 0.0068,
  service: 0.0068,
  authentication: 0.0068,
}

export interface PriceTable {
  /** Preço em dólares por categoria. */
  priceOf(category: string | null): number
  /** Verdadeiro quando nenhum override foi lido e tudo veio do código. */
  usingFallback: boolean
}

interface PriceRow {
  country_code: string
  category: string
  price_usd: number | string
  effective_from: string
}

/**
 * Carrega a tabela de preços vigente para uma data.
 *
 * `on` existe para o histórico continuar sendo lido pelo preço da época:
 * a virada de outubro muda a tarifa de serviço, e converter setembro com
 * o preço de outubro reescreveria o passado.
 */
export async function loadMessagePrices(
  db: SupabaseClient,
  opts: { countryCode?: string; on?: Date } = {},
): Promise<PriceTable> {
  const country = (opts.countryCode ?? 'BR').toUpperCase()
  const on = (opts.on ?? new Date()).toISOString().slice(0, 10)

  let rows: PriceRow[] = []
  try {
    const { data, error } = await db
      .from('whatsapp_message_prices')
      .select('country_code, category, price_usd, effective_from')
      .in('country_code', [country, '*'])
      .lte('effective_from', on)
      .order('effective_from', { ascending: true })
      .limit(500)
    if (error) throw error
    if (Array.isArray(data)) rows = data as PriceRow[]
  } catch (err) {
    // Uma tela de custo que quebra porque a tabela de preços não leu é
    // pior que uma que mostra o preço do código.
    console.error('[whatsapp prices] override list unreadable:', err)
  }

  // Vigência mais recente vence, e o país específico vence o curinga.
  // As linhas vêm em ordem crescente de vigência, então sobrescrever em
  // sequência já deixa a última por cima.
  const specific: Partial<Record<string, number>> = {}
  const wildcard: Partial<Record<string, number>> = {}
  for (const row of rows) {
    const price = Number(row.price_usd)
    if (!Number.isFinite(price) || price < 0) continue
    if (row.country_code === country) specific[row.category] = price
    else wildcard[row.category] = price
  }

  const usingFallback = rows.length === 0

  return {
    usingFallback,
    priceOf(category) {
      const key = (category ?? 'service') as MessageCategory
      return (
        specific[key] ??
        wildcard[key] ??
        FALLBACK_PRICES_USD[key] ??
        FALLBACK_PRICES_USD.service
      )
    },
  }
}

/** Exposto para teste e para a tela de administração da plataforma. */
export { FALLBACK_PRICES_USD }
