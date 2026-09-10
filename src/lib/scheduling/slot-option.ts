import { formatDayMonthForDisplay, formatTimeInZone } from '@/lib/time/zone'
import type { Slot } from './availability'

// ============================================================
// Um horário livre, como opção de menu.
//
// Separado de `describeSlots`, que escreve para o MODELO ("HOW TO OFFER
// THESE: name at most 3 times…"). Aqui o leitor é o cliente, tocando
// numa lista do WhatsApp, e os limites são outros: a Meta corta título
// de linha em 24 caracteres e descrição em 72, sem avisar — corta e
// entrega.
// ============================================================

/** Limites da Meta para uma linha de lista interativa. */
const ROW_TITLE_MAX = 24
const ROW_DESCRIPTION_MAX = 72

/** `10/09 14:00` — dia e hora, que é tudo que cabe num título. */
export function slotOptionTitle(
  slot: Slot,
  timezone: string,
  locale = 'pt-BR',
): string {
  const day = formatDayMonthForDisplay(slot.startsAt, timezone, locale)
  const time = formatTimeInZone(slot.startsAt, timezone)
  return `${day} ${time}`.slice(0, ROW_TITLE_MAX)
}

/** `quinta-feira · até 15:00` — o dia da semana, que é como as pessoas
 *  pensam a agenda, mais o fim do horário. */
export function slotOptionDescription(
  slot: Slot,
  timezone: string,
  locale = 'pt-BR',
): string {
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: 'long',
  }).format(slot.startsAt)
  const until = formatTimeInZone(slot.endsAt, timezone)
  return `${weekday} · até ${until}`.slice(0, ROW_DESCRIPTION_MAX)
}

/**
 * O id que volta quando o cliente toca.
 *
 * Índice, e não o instante: o horário escolhido é lido de
 * `flow_runs.vars._offered_slots`, que é o registro do que REALMENTE foi
 * oferecido. Se o id carregasse a data, um cliente curioso poderia
 * responder com outra — e o fluxo tentaria marcar um horário que ninguém
 * ofereceu. O índice não é falsificável em nada útil: ou aponta para uma
 * oferta que fizemos, ou não aponta para nada.
 */
export function slotReplyId(index: number): string {
  return `slot:${index}`
}

/** O índice de volta, ou null quando o id não é nosso. */
export function parseSlotReplyId(replyId: string): number | null {
  const match = /^slot:(\d+)$/.exec(replyId.trim())
  if (!match) return null
  const index = Number(match[1])
  return Number.isSafeInteger(index) && index >= 0 ? index : null
}

/** Como um horário oferecido fica guardado no run. */
export interface OfferedSlot {
  starts_at: string
  ends_at: string
}

/** Lê de volta a oferta guardada, tolerando lixo. */
export function readOfferedSlots(vars: Record<string, unknown>): OfferedSlot[] {
  const raw = vars._offered_slots
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (s): s is OfferedSlot =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as OfferedSlot).starts_at === 'string' &&
      typeof (s as OfferedSlot).ends_at === 'string',
  )
}
