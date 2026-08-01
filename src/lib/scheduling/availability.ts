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

const DEFAULT_LIMIT = 40
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
export function describeSlots(slots: Slot[], timezone: string): string {
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
  return [
    `Free slots (times are local to ${timezone}):`,
    ...lines,
    'To book one, call book_appointment with the exact ISO start and end.',
  ].join('\n')
}
