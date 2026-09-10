import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// What Meta billed for an outbound message.
//
// Every `statuses[]` entry on the webhook can carry a `pricing` object:
//
//   { billable, pricing_model, type, category }
//
// which is Meta's OWN determination, not an inference of ours. Reading
// it is the difference between a counter that is exact and one that
// guesses — see docs/cobranca-whatsapp-out-2026.md.
//
// Parsing lives here, apart from the webhook route, because the shape is
// the part that can surprise us and it deserves tests that need no HTTP.
// ============================================================

/** The values Meta documents today. Not enforced — see below. */
const KNOWN_TYPES = ['regular', 'free_customer_service', 'free_entry_point']
const KNOWN_CATEGORIES = ['marketing', 'utility', 'service', 'authentication']

export interface MessagePricing {
  billable: boolean
  pricingModel: string | null
  /** regular | free_customer_service | free_entry_point */
  type: string | null
  /** marketing | utility | service | authentication */
  category: string | null
}

/**
 * Pull the pricing block out of one status update.
 *
 * Returns null when there is none — which is normal: not every status
 * carries pricing, and an install still on the old model may never send
 * it. A missing block must mean "nothing to record", never "free", or
 * the forecast this feeds would read as zero on the day it matters most.
 *
 * `billable` is required for the same reason. Defaulting it either way
 * invents a billing fact; without it there is no row worth writing.
 */
export function parseMessagePricing(status: unknown): MessagePricing | null {
  if (typeof status !== 'object' || status === null) return null
  const pricing = (status as { pricing?: unknown }).pricing
  if (typeof pricing !== 'object' || pricing === null) return null

  const p = pricing as Record<string, unknown>
  if (typeof p.billable !== 'boolean') return null

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null

  return {
    billable: p.billable,
    pricingModel: str(p.pricing_model),
    type: str(p.type),
    category: str(p.category),
  }
}

/**
 * Warn once per unrecognised value, so Meta adding a category shows up
 * in logs instead of silently landing in a bucket nobody reads.
 *
 * Deliberately a warning and not a rejection: the row is still worth
 * storing, and a throw here would drop the whole status update — taking
 * the delivery receipt with it.
 */
const warned = new Set<string>()
function warnUnknown(field: string, value: string | null, known: string[]): void {
  if (!value || known.includes(value)) return
  const key = `${field}:${value}`
  if (warned.has(key)) return
  warned.add(key)
  console.warn(
    `[whatsapp cost] unknown pricing ${field} "${value}" — Meta may have added one; ` +
      `check docs/cobranca-whatsapp-out-2026.md and widen the reader if needed.`,
  )
}

/**
 * Record what Meta billed. Best-effort by design: this is bookkeeping
 * riding along on the delivery-receipt path, and a failure here must
 * never cost the account a status update.
 */
export async function recordMessageCost(
  db: SupabaseClient,
  args: { accountId: string; messageId: string; pricing: MessagePricing },
): Promise<void> {
  const { accountId, messageId, pricing } = args

  warnUnknown('type', pricing.type, KNOWN_TYPES)
  warnUnknown('category', pricing.category, KNOWN_CATEGORIES)

  // Verification hatch for the first days in production: the format here
  // was confirmed from secondary sources because Meta's own docs were
  // unreachable when this was written. Set WHATSAPP_LOG_PRICING=true to
  // see the parsed block once against real traffic. Only the pricing
  // fields are logged — never the recipient, which is a phone number.
  if (process.env.WHATSAPP_LOG_PRICING === 'true') {
    console.log('[whatsapp cost] pricing:', JSON.stringify(pricing))
  }

  const { error } = await db.from('whatsapp_message_costs').upsert(
    {
      account_id: accountId,
      message_id: messageId,
      billable: pricing.billable,
      pricing_model: pricing.pricingModel,
      pricing_type: pricing.type,
      pricing_category: pricing.category,
    },
    // Pricing can ride on more than one status for the same message;
    // the first one wins rather than double-counting it.
    { onConflict: 'account_id,message_id', ignoreDuplicates: true },
  )

  if (error) {
    console.error('[whatsapp cost] could not record message cost:', error)
  }
}
