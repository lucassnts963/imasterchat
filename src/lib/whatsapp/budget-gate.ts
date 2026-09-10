import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMessagePrices } from './message-prices'
import { isBlockableOrigin, type MessageOrigin } from './message-origin'

// ============================================================
// O segundo teto — fase 3, R-16.
//
// `monthly_budget_usd` protege o gasto de LLM. A partir de 1º/10/2026
// existem DOIS custos por conversa, e um teto que enxerga só um não é
// teto: a fatura da Meta cresce sem ninguém ver enquanto o operador olha
// um número que está sob controle.
//
// Uma regra manda em tudo aqui: **estourar o teto NUNCA cala o
// atendente**. Calar uma pessoa que está respondendo um cliente para
// economizar quatro centavos é pior que a fatura que o teto existe para
// evitar. Só robô é barrado — ver `BLOCKABLE_ORIGINS`.
// ============================================================

/** Quanto tempo o gasto do mês fica em memória antes de ser relido. */
const CACHE_TTL_MS = 30_000

interface CachedSpend {
  usd: number
  budgetUsd: number | null
  at: number
}

const cache = new Map<string, CachedSpend>()

/** Só para teste — o cache é por processo e sobreviveria entre casos. */
export function resetBudgetCache(): void {
  cache.clear()
}

interface CostRow {
  billable: boolean
  pricing_category: string | null
}

/**
 * Gasto do mês corrente com mensagens, em dólares.
 *
 * Conta só o que a META marcou como cobrável. Antes de outubro isso é
 * quase zero, e é exatamente o ponto: a previsão do que VAI custar é
 * outra consulta (ver `/api/whatsapp/costs`), e misturar as duas faria o
 * teto barrar hoje por um custo que ainda não existe.
 */
export async function monthToDateMessageSpendUsd(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  const since = new Date()
  since.setUTCDate(1)
  since.setUTCHours(0, 0, 0, 0)

  const [{ data }, prices] = await Promise.all([
    db
      .from('whatsapp_message_costs')
      .select('billable, pricing_category')
      .eq('account_id', accountId)
      .gte('recorded_at', since.toISOString())
      .limit(50_000),
    loadMessagePrices(db),
  ])

  if (!Array.isArray(data)) return 0
  let total = 0
  for (const row of data as CostRow[]) {
    if (!row.billable) continue
    total += prices.priceOf(row.pricing_category)
  }
  return total
}

export interface BudgetVerdict {
  allowed: boolean
  /** Só quando barrado. */
  reason?: 'whatsapp_budget_exceeded'
  spentUsd: number
  budgetUsd: number | null
}

/**
 * Este envio pode sair?
 *
 * Falha ABERTO: se a consulta não responde, a mensagem vai. Um teto que
 * derruba o atendimento quando o banco tosse troca um problema de conta
 * por um problema de cliente, e o segundo é pior.
 */
export async function checkWhatsappBudget(args: {
  db: SupabaseClient
  accountId: string
  origin: MessageOrigin | string | null | undefined
}): Promise<BudgetVerdict> {
  const { db, accountId } = args

  // O atendente nunca é barrado. Checar antes de qualquer consulta
  // também poupa a ida ao banco no caminho mais quente do produto.
  if (!isBlockableOrigin(args.origin)) {
    return { allowed: true, spentUsd: 0, budgetUsd: null }
  }

  try {
    const cached = cache.get(accountId)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return verdict(cached.usd, cached.budgetUsd)
    }

    const { data: config } = await db
      .from('ai_configs')
      .select('whatsapp_monthly_budget_usd')
      .eq('account_id', accountId)
      .maybeSingle()

    const budgetUsd = toNumberOrNull(
      (config as { whatsapp_monthly_budget_usd?: unknown } | null)
        ?.whatsapp_monthly_budget_usd,
    )
    // Sem teto configurado não há o que checar, e a conta do mês não
    // precisa ser feita.
    if (budgetUsd === null) {
      cache.set(accountId, { usd: 0, budgetUsd: null, at: Date.now() })
      return { allowed: true, spentUsd: 0, budgetUsd: null }
    }

    const usd = await monthToDateMessageSpendUsd(db, accountId)
    cache.set(accountId, { usd, budgetUsd, at: Date.now() })
    return verdict(usd, budgetUsd)
  } catch (err) {
    console.error('[whatsapp budget] check failed, allowing send:', err)
    return { allowed: true, spentUsd: 0, budgetUsd: null }
  }
}

function verdict(spentUsd: number, budgetUsd: number | null): BudgetVerdict {
  if (budgetUsd === null || spentUsd < budgetUsd) {
    return { allowed: true, spentUsd, budgetUsd }
  }
  return {
    allowed: false,
    reason: 'whatsapp_budget_exceeded',
    spentUsd,
    budgetUsd,
  }
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Registra que uma mensagem NÃO saiu, e por quê.
 *
 * Mensagem barrada não pode sumir em silêncio: sem isto, "o cliente não
 * recebeu" vira indepurável e o operador culpa a Meta por uma decisão
 * que foi nossa.
 */
export async function recordBlockedSend(args: {
  db: SupabaseClient
  accountId: string
  conversationId?: string | null
  origin?: MessageOrigin | string | null
  reason: string
}): Promise<void> {
  try {
    await args.db.from('whatsapp_blocked_sends').insert({
      account_id: args.accountId,
      conversation_id: args.conversationId ?? null,
      origin: args.origin ?? null,
      reason: args.reason,
    })
  } catch (err) {
    // Não pode derrubar quem chamou: o envio já foi barrado, e falhar
    // aqui só perderia o registro.
    console.error('[whatsapp budget] could not record blocked send:', err)
  }
}

/** Erro que os remetentes lançam quando o teto barra. */
export class WhatsappBudgetError extends Error {
  readonly code = 'whatsapp_budget_exceeded'
  constructor(spentUsd: number, budgetUsd: number) {
    super(
      `Monthly WhatsApp message budget reached (US$ ${spentUsd.toFixed(2)} of US$ ${budgetUsd.toFixed(2)}).`,
    )
    this.name = 'WhatsappBudgetError'
  }
}
