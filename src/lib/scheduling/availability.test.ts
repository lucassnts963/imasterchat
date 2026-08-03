import { describe, it, expect } from 'vitest'
import { computeAvailableSlots, describeSlots, overlapsAny } from './availability'
import { parseWeeklyHours, describeWeeklyHours, type SchedulingSettings } from './settings'

const SP = 'America/Sao_Paulo'

/** Mon-Fri, 09:00-12:00 and 14:00-18:00, 60-minute slots. */
function settings(overrides: Partial<SchedulingSettings> = {}): SchedulingSettings {
  return {
    timezone: SP,
    slotMinutes: 60,
    leadTimeMinutes: 120,
    maxAdvanceDays: 30,
    appointmentLabel: null,
    weeklyHours: parseWeeklyHours({
      '1': [['09:00', '12:00'], ['14:00', '18:00']],
      '2': [['09:00', '12:00'], ['14:00', '18:00']],
      '3': [['09:00', '12:00'], ['14:00', '18:00']],
      '4': [['09:00', '12:00'], ['14:00', '18:00']],
      '5': [['09:00', '12:00'], ['14:00', '18:00']],
    }),
    isActive: true,
    ...overrides,
  }
}

/** Monday 2026-08-03, 08:00 São Paulo (11:00 UTC). */
const MONDAY_0800_SP = new Date('2026-08-03T11:00:00Z')
const day = (d: string) => new Date(d)

describe('parseWeeklyHours', () => {
  it('indexes windows by weekday, Sunday first', () => {
    const parsed = parseWeeklyHours({ '1': [['09:00', '12:00']] })
    expect(parsed[0]).toEqual([])
    expect(parsed[1]).toEqual([
      { startHour: 9, startMinute: 0, endHour: 12, endMinute: 0 },
    ])
  })

  it('drops malformed entries rather than letting them through', () => {
    const parsed = parseWeeklyHours({
      '1': [['09:00'], ['bad', '12:00'], ['09:00', '12:00']],
      '9': [['09:00', '12:00']],
      nope: [['09:00', '12:00']],
    })
    expect(parsed[1]).toHaveLength(1)
  })

  it('drops a window that crosses midnight instead of silently yielding nothing', () => {
    // 22:00-02:00 is not representable as a same-day window. Keeping it
    // would produce a window whose end precedes its start, which the
    // slot walk skips — the operator would see "no availability" with
    // no explanation. Dropping it shows the day as closed, which is at
    // least an honest, visible state. Overnight hours would need a
    // second window on the following day.
    expect(parseWeeklyHours({ '1': [['22:00', '02:00']] })[1]).toEqual([])
  })

  it('sorts windows by start time', () => {
    const parsed = parseWeeklyHours({
      '1': [['14:00', '18:00'], ['09:00', '12:00']],
    })
    expect(parsed[1][0].startHour).toBe(9)
  })
})

describe('computeAvailableSlots', () => {
  it('offers only slots inside the opening hours, on the local grid', () => {
    const slots = computeAvailableSlots({
      settings: settings(),
      busy: [],
      from: MONDAY_0800_SP,
      to: day('2026-08-04T02:00:00Z'), // through end of Monday in SP
      now: MONDAY_0800_SP,
    })

    // 09,10,11 then 14,15,16,17 — 12:00 and 13:00 are the lunch gap,
    // and 18:00 would end after closing.
    const local = slots.map((s) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: SP,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(s.startsAt),
    )
    expect(local).toEqual([
      '10:00',
      '11:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
    ])
    // 09:00 is missing on purpose: at 08:00 it is inside the 2h notice.
  })

  it('skips the weekend entirely', () => {
    const slots = computeAvailableSlots({
      settings: settings(),
      busy: [],
      // Saturday 2026-08-08 through Sunday.
      from: day('2026-08-08T11:00:00Z'),
      to: day('2026-08-10T02:00:00Z'),
      now: day('2026-08-08T11:00:00Z'),
    })
    expect(slots).toEqual([])
  })

  it('respects the minimum notice', () => {
    const slots = computeAvailableSlots({
      settings: settings({ leadTimeMinutes: 300 }), // 5h
      busy: [],
      from: MONDAY_0800_SP,
      to: day('2026-08-04T02:00:00Z'),
      now: MONDAY_0800_SP,
    })
    // Nothing before 13:00 local; the first bookable window is 14:00.
    expect(slots[0].startsAt.toISOString()).toBe('2026-08-03T17:00:00.000Z')
  })

  it('stops at the booking horizon', () => {
    const slots = computeAvailableSlots({
      settings: settings({ maxAdvanceDays: 1 }),
      busy: [],
      from: MONDAY_0800_SP,
      to: day('2026-08-30T00:00:00Z'),
      now: MONDAY_0800_SP,
    })
    const last = slots[slots.length - 1].startsAt
    expect(last.getTime()).toBeLessThanOrEqual(
      MONDAY_0800_SP.getTime() + 24 * 60 * 60_000,
    )
  })

  it('drops a slot the calendar says is busy — the hand-blocked day', () => {
    const slots = computeAvailableSlots({
      settings: settings(),
      busy: [
        // The optician blocked all Monday afternoon in her own calendar.
        { start: day('2026-08-03T17:00:00Z'), end: day('2026-08-03T21:00:00Z') },
      ],
      from: MONDAY_0800_SP,
      to: day('2026-08-04T02:00:00Z'),
      now: MONDAY_0800_SP,
    })
    expect(slots.every((s) => s.startsAt < day('2026-08-03T17:00:00Z'))).toBe(true)
  })

  it('keeps a slot that merely touches a booking — intervals are half-open', () => {
    const slots = computeAvailableSlots({
      settings: settings(),
      busy: [
        { start: day('2026-08-03T12:00:00Z'), end: day('2026-08-03T13:00:00Z') },
      ],
      from: MONDAY_0800_SP,
      to: day('2026-08-04T02:00:00Z'),
      now: MONDAY_0800_SP,
    })
    // 13:00Z (10:00 local) starts exactly when the booking ends.
    expect(
      slots.some((s) => s.startsAt.toISOString() === '2026-08-03T13:00:00.000Z'),
    ).toBe(true)
  })

  it('honours the result limit', () => {
    const slots = computeAvailableSlots({
      settings: settings(),
      busy: [],
      from: MONDAY_0800_SP,
      to: day('2026-08-20T00:00:00Z'),
      now: MONDAY_0800_SP,
      limit: 5,
    })
    expect(slots).toHaveLength(5)
  })

  it('returns nothing when the window is already past the horizon', () => {
    expect(
      computeAvailableSlots({
        settings: settings({ maxAdvanceDays: 1 }),
        busy: [],
        from: day('2026-09-01T11:00:00Z'),
        to: day('2026-09-02T11:00:00Z'),
        now: MONDAY_0800_SP,
      }),
    ).toEqual([])
  })
})

describe('overlapsAny', () => {
  it('is half-open on both ends', () => {
    const busy = [{ start: day('2026-08-03T14:00:00Z'), end: day('2026-08-03T15:00:00Z') }]
    expect(overlapsAny(day('2026-08-03T13:00:00Z'), day('2026-08-03T14:00:00Z'), busy)).toBe(false)
    expect(overlapsAny(day('2026-08-03T15:00:00Z'), day('2026-08-03T16:00:00Z'), busy)).toBe(false)
    expect(overlapsAny(day('2026-08-03T14:30:00Z'), day('2026-08-03T15:30:00Z'), busy)).toBe(true)
  })
})

describe('describeSlots', () => {
  it('groups by day in local time so the model speaks in local time', () => {
    const out = describeSlots(
      [
        { startsAt: day('2026-08-03T13:00:00Z'), endsAt: day('2026-08-03T14:00:00Z') },
        { startsAt: day('2026-08-03T17:00:00Z'), endsAt: day('2026-08-03T18:00:00Z') },
        { startsAt: day('2026-08-04T13:00:00Z'), endsAt: day('2026-08-04T14:00:00Z') },
      ],
      SP,
    )
    expect(out).toContain('2026-08-03: 10:00, 14:00')
    expect(out).toContain('2026-08-04: 10:00')
  })

  it('says so plainly when nothing is free', () => {
    expect(describeSlots([], SP)).toContain('No free slots')
  })
})

describe('describeWeeklyHours', () => {
  it('states the rule the way the model should read it', () => {
    const out = describeWeeklyHours(settings())
    expect(out).toContain('Monday 09:00-12:00, 14:00-18:00')
    expect(out).toContain('Friday')
    expect(out).not.toContain('Saturday')
    expect(out).toContain('60 minutes')
  })

  it('reports a shop that is never open', () => {
    expect(describeWeeklyHours(settings({ weeklyHours: parseWeeklyHours({}) }))).toBe(
      'closed every day',
    )
  })
})
