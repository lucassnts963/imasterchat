import { describe, it, expect } from 'vitest'
import {
  formatInZone,
  parseWallClock,
  zoneOffsetMs,
  zonedParts,
  zonedTimeToUtc,
} from './zone'

const SP = 'America/Sao_Paulo'
/** Still on DST, so it exercises the two-pass offset correction. */
const NY = 'America/New_York'

describe('zonedParts', () => {
  it('reads the calendar fields a local reader sees', () => {
    const p = zonedParts(new Date('2026-08-01T02:30:00Z'), SP)
    expect(p).toEqual({
      year: 2026,
      month: 7,
      day: 31,
      hour: 23,
      minute: 30,
      weekday: 5, // Friday
    })
  })

  it('renders local midnight as hour 0, not 24', () => {
    // 03:00Z is exactly midnight in São Paulo (UTC-3). Some ICU builds
    // report hour "24" under hour12:false — taking that at face value
    // moves the appointment a day.
    const p = zonedParts(new Date('2026-08-01T03:00:00Z'), SP)
    expect(p.hour).toBe(0)
    expect(p.day).toBe(1)
  })
})

describe('zoneOffsetMs', () => {
  it('is -3h for São Paulo year round', () => {
    const hours = (ms: number) => ms / 3_600_000
    expect(hours(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), SP))).toBe(-3)
    expect(hours(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), SP))).toBe(-3)
  })

  it('tracks a zone that still observes DST', () => {
    const hours = (ms: number) => ms / 3_600_000
    expect(hours(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), NY))).toBe(-5)
    expect(hours(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), NY))).toBe(-4)
  })
})

describe('zonedTimeToUtc', () => {
  it('resolves a wall time to the right instant', () => {
    const at = zonedTimeToUtc(
      { year: 2026, month: 8, day: 6, hour: 14, minute: 0 },
      SP,
    )
    expect(at.toISOString()).toBe('2026-08-06T17:00:00.000Z')
  })

  it('round-trips through zonedParts', () => {
    const wall = { year: 2026, month: 3, day: 8, hour: 9, minute: 30 }
    const p = zonedParts(zonedTimeToUtc(wall, NY), NY)
    expect({ year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute })
      .toEqual(wall)
  })

  it('lands on the correct side of a DST spring-forward', () => {
    // US DST starts 2026-03-08. 09:00 local that morning is already
    // EDT (-4), so a single-pass conversion using the pre-jump offset
    // would be an hour out.
    const at = zonedTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 9, minute: 0 },
      NY,
    )
    expect(at.toISOString()).toBe('2026-03-08T13:00:00.000Z')
  })
})

describe('formatInZone', () => {
  it('uses ISO order so the date cannot be misread', () => {
    expect(formatInZone(new Date('2026-08-06T17:00:00Z'), SP)).toBe(
      'Thursday, 2026-08-06 14:00',
    )
  })
})

describe('parseWallClock', () => {
  it('accepts HH:MM', () => {
    expect(parseWallClock('09:30')).toEqual({ hour: 9, minute: 30 })
    expect(parseWallClock('9:05')).toEqual({ hour: 9, minute: 5 })
  })

  it('rejects anything else', () => {
    expect(parseWallClock('25:00')).toBeNull()
    expect(parseWallClock('09:60')).toBeNull()
    expect(parseWallClock('0930')).toBeNull()
    expect(parseWallClock(930)).toBeNull()
    expect(parseWallClock(null)).toBeNull()
  })
})
