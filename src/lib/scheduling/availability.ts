import {
  formatDateInZone,
  formatTimeInZone,
  zonedParts,
  zonedTimeToUtc,
} from '@/lib/time/zone'
import type { SchedulingSettings } from './settings'

// ============================================================
// Which slots are actually free.
//
// Four filters, and the order matters less than the fact that all four
// are applied on the server. The model asks "what is free on Thursday";
// it does not get to decide the answer.
//
//   1. opening hours   — the shop's own weekly windows
//   2. lead time       — no slot sooner than the minimum notice
//   3. booking horizon — no slot further out than max_advance_days
//   4. busy            — Google's freebusy, plus our own live bookings
//
// Google is the authority on (4). That is what lets the optician block
// a day by creating an event in her own calendar. Our `appointments`
// rows are checked too, as a belt to Google's braces: a booking whose
// calendar insert failed still holds its slot.
// ============================================================

/** A half-open interval `[start, end)` that is unavailable. */
export interface BusyInterval {
  start: Date
  end: Date
}

export interface Slot {
  startsAt: Date
  endsAt: Date
}

export interface AvailabilityArgs {
  settings: SchedulingSettings
  /** From Google freebusy, and from our own scheduled appointments. */
  busy: BusyInterval[]
  /** Window the caller asked about; clamped by lead time and horizon. */
  from: Date
  to: Date
  now?: Date
  /** Bound the answer — a tool result the model has to read, and a
   *  hundred slots is noise it will summarise badly. */
  limit?: number
}

// 12, e não 40. Com 40 o modelo recebeu seis dias × sete horários e
// colou os 42 no WhatsApp — uma parede que o cliente não lê e não
// responde. Menos vagas por consulta forçam a conversa a afunilar, que
// é como uma pessoa marcaria: oferece algumas, pergunta, oferece de
// novo. Uma chamada a mais é barata; um cliente que desiste, não.
const DEFAULT_LIMIT = 12
/** Refuse to walk a silly number of days if `to` is far out. */
const MAX_DAYS_SCANNED = 400

export function computeAvailableSlots(args: AvailabilityArgs): Slot[] {
  const { settings, busy, from, to, now = new Date(), limit = DEFAULT_LIMIT } = args
  const { timezone, slotMinutes, weeklyHours } = settings

  const earliest = new Date(
    Math.max(from.getTime(), now.getTime() + settings.leadTimeMinutes * 60_000),
  )
  const horizon = new Date(
    now.getTime() + settings.maxAdvanceDays * 24 * 60 * 60_000,
  )
  const latest = new Date(Math.min(to.getTime(), horizon.getTime()))
  if (earliest >= latest) return []

  const slotMs = slotMinutes * 60_000
  const slots: Slot[] = []

  // Walk local calendar days. Anchored at noon UTC and advanced a day at
  // a time so a DST shift can never skip or repeat a date — the parts
  // are re-read in the zone for each step.
  let cursorDay = new Date(
    Date.UTC(
      zonedParts(earliest, timezone).year,
      zonedParts(earliest, timezone).month - 1,
      zonedParts(earliest, timezone).day,
      12,
    ),
  )
  const lastDayKey = formatDateInZone(latest, timezone)

  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned++) {
    const day = zonedParts(cursorDay, timezone)
    const dayKey = formatDateInZone(cursorDay, timezone)

    for (const window of weeklyHours[day.weekday] ?? []) {
      const windowStart = zonedTimeToUtc(
        {
          year: day.year,
          month: day.month,
          day: day.day,
          hour: window.startHour,
          minute: window.startMinute,
        },
        timezone,
      )
      const windowEnd = zonedTimeToUtc(
        {
          year: day.year,
          month: day.month,
          day: day.day,
          hour: window.endHour,
          minute: window.endMinute,
        },
        timezone,
      )

      for (
        let start = windowStart.getTime();
        start + slotMs <= windowEnd.getTime();
        start += slotMs
      ) {
        if (slots.length >= limit) return slots
        const startsAt = new Date(start)
        const endsAt = new Date(start + slotMs)
        if (startsAt < earliest || startsAt >= latest) continue
        if (overlapsAny(startsAt, endsAt, busy)) continue
        slots.push({ startsAt, endsAt })
      }
    }

    if (dayKey >= lastDayKey) break
    cursorDay = new Date(cursorDay.getTime() + 24 * 60 * 60_000)
  }

  return slots
}

/** Half-open overlap: a slot ending exactly when a booking starts is free. */
export function overlapsAny(
  start: Date,
  end: Date,
  intervals: BusyInterval[],
): boolean {
  return intervals.some((b) => start < b.end && end > b.start)
}

/**
 * Render slots for the model: grouped by day, times only.
 *
 * A wall of ISO timestamps is technically complete and practically
 * unreadable — the model paraphrases it badly and the customer gets
 * "2026-08-06T17:00:00Z". Give it the shape it should speak in.
 */
export function describeSlots(
  slots: Slot[],
  timezone: string,
  /** Passe as regras para a lista poder explicar o que ela mesma
   *  cortou. Sem isto o modelo só vê a ausência de 09:00 e 10:00, e
   *  "ausente" ele traduz como "ocupado" — que é mentira quando quem
   *  tirou foi a antecedência mínima. */
  settings?: { leadTimeMinutes: number },
  now: Date = new Date(),
): string {
  if (slots.length === 0) return 'No free slots in that range.'

  const byDay = new Map<string, string[]>()
  for (const slot of slots) {
    const key = formatDateInZone(slot.startsAt, timezone)
    const times = byDay.get(key) ?? []
    times.push(formatTimeInZone(slot.startsAt, timezone))
    byDay.set(key, times)
  }

  const lines = [...byDay.entries()].map(
    ([day, times]) => `${day}: ${times.join(', ')}`,
  )
  const notes: string[] = [
    // A instrução vai JUNTO da lista, e não no andaime, porque é aqui
    // que o modelo está prestes a errar: com uma lista na mão, a
    // tentação é colá-la inteira.
    'HOW TO OFFER THESE: name at most 3 times, in one short line, and ask the customer ' +
      'to pick or to say what suits them better. Never paste the whole list — a wall of ' +
      'times reads as a form to fill in, not as an offer. If they are vague ("qualquer ' +
      'dia", "semana que vem"), ask ONE narrowing question first (morning or afternoon? ' +
      'which day?) and only then name times.',
  ]
  if (settings && settings.leadTimeMinutes > 0) {
    const earliest = new Date(now.getTime() + settings.leadTimeMinutes * 60_000)
    // Só quando o corte realmente mordeu hoje: dizer "a antecedência é
    // de 2h" numa consulta sobre semana que vem é ruído que o modelo
    // repassaria ao cliente sem motivo.
    if (formatDateInZone(earliest, timezone) === formatDateInZone(now, timezone)) {
      notes.push(
        `Note: this business needs ${settings.leadTimeMinutes} minutes of notice, so anything ` +
          `before ${formatTimeInZone(earliest, timezone)} today is unavailable even if the ` +
          'calendar is empty. If the customer asks for an earlier time, explain the notice rule ' +
          'rather than saying it is taken.',
      )
    }
  }

  return [
    `Free slots (times are local to ${timezone}):`,
    ...lines,
    ...notes,
    'To book one, call book_appointment with the exact ISO start and end.',
  ].join('\n')
}
