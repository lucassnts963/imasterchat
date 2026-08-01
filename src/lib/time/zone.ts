// ============================================================
// Wall-clock time in a named zone, without a date library.
//
// The project has date-fns but not its timezone companion, and the
// scheduling rules are wall-clock by nature: "seg a sex, 9h às 18h" is
// a statement about the shop's clock, not about UTC. Turning that into
// instants is the one piece of real date math the feature needs, so it
// lives here, tested, instead of being open-coded per caller.
//
// Everything is built on `Intl.DateTimeFormat`, which knows the IANA
// database the runtime ships. No offset is ever hard-coded — Brazil
// dropped DST in 2019, but this code must not be the reason a shop in
// a zone that still has it books an appointment an hour off.
// ============================================================

export interface ZonedParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number
  /** 0 = Sunday, matching JS `getDay()` and the `weekly_hours` keys. */
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/** Break an instant into the calendar fields a reader in `timezone` sees. */
export function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)

  const value = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  const num = (type: string): number => Number(value(type))

  // `hour12: false` renders midnight as 24 in some ICU versions — the
  // classic off-by-a-day if you take it at face value.
  const hour = num('hour') % 24

  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour,
    minute: num('minute'),
    weekday: WEEKDAY_INDEX[value('weekday')] ?? 0,
  }
}

/** How far `timezone` is from UTC at this instant, in milliseconds. */
export function zoneOffsetMs(date: Date, timezone: string): number {
  const p = zonedParts(date, timezone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  // Seconds and below are identical in every IANA zone, so comparing at
  // minute resolution is exact — as long as we drop them from both
  // sides, which flooring the source instant does.
  const flooredSource = Math.floor(date.getTime() / 60_000) * 60_000
  return asUtc - flooredSource
}

/**
 * The instant at which the clock in `timezone` reads the given wall time.
 *
 * Two passes, because the offset we need is the one *at the answer*, not
 * the one at the guess: near a DST change those differ, and a single
 * pass lands an hour out. The second pass re-reads the offset at the
 * candidate instant and corrects.
 *
 * Ambiguous and skipped times (the hour that happens twice, or not at
 * all) resolve to one of the plausible instants rather than throwing —
 * a shop whose opening hour lands exactly on a DST change gets a
 * booking one hour off at worst, which beats no availability at all.
 */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  const firstGuess = new Date(asUtc - zoneOffsetMs(new Date(asUtc), timezone))
  const corrected = asUtc - zoneOffsetMs(firstGuess, timezone)
  return new Date(corrected)
}

/**
 * Render an instant as `Saturday, 2026-08-01 19:30` in a zone.
 *
 * `en-CA` is the shortest route to ISO-ordered date parts, and ISO order
 * is what a reader — human or model — cannot misread: `01/08/2026` is
 * ambiguous to anyone who has met both conventions.
 */
export function formatInZone(date: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(date)
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `${day}, ${ymd} ${hm}`
}

/** Just the clock, `14:30`, for listing slots compactly. */
export function formatTimeInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/** `2026-08-01` in the zone — the key a day is grouped under. */
export function formatDateInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Parse `'HH:MM'` from `weekly_hours`. Returns null on anything else. */
export function parseWallClock(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}
