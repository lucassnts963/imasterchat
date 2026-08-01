import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWallClock } from '@/lib/time/zone'

// ============================================================
// The account's scheduling rules, loaded and sanitised.
//
// These live in a table rather than in the agent's prompt because a
// rule in a prompt is a suggestion. The model that reads "seg a sex,
// 9h às 18h" will eventually offer Saturday; the server that checks
// `weekly_hours` will not.
// ============================================================

/** A `[start, end)` window on the shop's own clock. */
export interface DayWindow {
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}

export interface SchedulingSettings {
  timezone: string
  slotMinutes: number
  leadTimeMinutes: number
  maxAdvanceDays: number
  /** Indexed 0-6, Sunday first. An empty array is a closed day. */
  weeklyHours: DayWindow[][]
  isActive: boolean
}

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo'

interface SettingsRow {
  timezone: string
  slot_minutes: number
  lead_time_minutes: number
  max_advance_days: number
  weekly_hours: unknown
  is_active: boolean
}

const SETTINGS_COLUMNS =
  'timezone, slot_minutes, lead_time_minutes, max_advance_days, weekly_hours, is_active'

/**
 * Load the rules. Returns null when the account has none — which means
 * autonomous booking is not set up, not that it is broken.
 */
export async function loadSchedulingSettings(
  db: SupabaseClient,
  accountId: string,
): Promise<SchedulingSettings | null> {
  const { data, error } = await db
    .from('ai_scheduling_settings')
    .select(SETTINGS_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle<SettingsRow>()

  if (error) {
    console.error('[scheduling] settings lookup failed:', error)
    return null
  }
  if (!data) return null

  return {
    timezone: data.timezone?.trim() || DEFAULT_TIMEZONE,
    slotMinutes: data.slot_minutes,
    leadTimeMinutes: data.lead_time_minutes,
    maxAdvanceDays: data.max_advance_days,
    weeklyHours: parseWeeklyHours(data.weekly_hours),
    isActive: data.is_active,
  }
}

/**
 * Turn the stored `{"1": [["09:00","12:00"]]}` into seven ordered lists.
 *
 * Anything malformed is dropped rather than throwing. The stakes are
 * asymmetric: a bad window that survives could have the bot offering a
 * time the shop is shut, while a dropped one only costs availability
 * the operator will notice and fix.
 */
export function parseWeeklyHours(raw: unknown): DayWindow[][] {
  const byDay: DayWindow[][] = [[], [], [], [], [], [], []]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return byDay

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(key)
    if (!Number.isInteger(day) || day < 0 || day > 6) continue
    if (!Array.isArray(value)) continue

    for (const pair of value) {
      if (!Array.isArray(pair) || pair.length !== 2) continue
      const start = parseWallClock(pair[0])
      const end = parseWallClock(pair[1])
      if (!start || !end) continue
      // A window that ends before it starts would silently produce no
      // slots; drop it so the operator sees the day as closed instead
      // of debugging why nothing is offered.
      const startMin = start.hour * 60 + start.minute
      const endMin = end.hour * 60 + end.minute
      if (endMin <= startMin) continue

      byDay[day].push({
        startHour: start.hour,
        startMinute: start.minute,
        endHour: end.hour,
        endMinute: end.minute,
      })
    }
    byDay[day].sort(
      (a, b) =>
        a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute),
    )
  }

  return byDay
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/**
 * The opening hours as one readable line, for the model's environment
 * block: `Monday 09:00-12:00, 14:00-18:00; Tuesday …`.
 *
 * Telling it the rule up front is cheaper than letting it offer Saturday
 * and be refused: the refusal costs a provider round-trip and reads to
 * the customer as the bot changing its mind.
 */
export function describeWeeklyHours(settings: SchedulingSettings): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const days = settings.weeklyHours
    .map((windows, day) =>
      windows.length === 0
        ? null
        : `${WEEKDAY_NAMES[day]} ${windows
            .map(
              (w) =>
                `${pad(w.startHour)}:${pad(w.startMinute)}-${pad(w.endHour)}:${pad(w.endMinute)}`,
            )
            .join(', ')}`,
    )
    .filter((line): line is string => line !== null)

  if (days.length === 0) return 'closed every day'
  return `${days.join('; ')}. Appointments last ${settings.slotMinutes} minutes, need at least ${settings.leadTimeMinutes} minutes' notice, and can be booked up to ${settings.maxAdvanceDays} days ahead.`
}

/** Back to the stored shape, for the settings form. */
export function serializeWeeklyHours(
  weeklyHours: DayWindow[][],
): Record<string, [string, string][]> {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const out: Record<string, [string, string][]> = {}
  weeklyHours.forEach((windows, day) => {
    if (windows.length === 0) return
    out[String(day)] = windows.map((w) => [
      `${pad(w.startHour)}:${pad(w.startMinute)}`,
      `${pad(w.endHour)}:${pad(w.endMinute)}`,
    ])
  })
  return out
}
