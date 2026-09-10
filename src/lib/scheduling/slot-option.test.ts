import { describe, expect, it } from 'vitest'
import {
  parseSlotReplyId,
  readOfferedSlots,
  slotOptionDescription,
  slotOptionTitle,
  slotReplyId,
} from './slot-option'
import type { Slot } from './availability'

const SP = 'America/Sao_Paulo'

function slot(startsAt: string, endsAt: string): Slot {
  return { startsAt: new Date(startsAt), endsAt: new Date(endsAt) }
}

describe('slotOptionTitle', () => {
  it('names the day and the hour in the business timezone', () => {
    // 13:00 UTC is 10:00 in São Paulo — the customer must see the
    // second one, or they turn up three hours late.
    expect(
      slotOptionTitle(slot('2026-09-10T13:00:00Z', '2026-09-10T14:00:00Z'), SP),
    ).toBe('10/09 10:00')
  })

  // Meta truncates a row title past 24 characters without telling
  // anyone. Cutting it here keeps what we send and what we meant equal.
  it('stays inside the row-title limit', () => {
    const title = slotOptionTitle(
      slot('2026-09-10T13:00:00Z', '2026-09-10T14:00:00Z'),
      SP,
    )
    expect(title.length).toBeLessThanOrEqual(24)
  })
})

describe('slotOptionDescription', () => {
  it('gives the weekday, which is how people think about a diary', () => {
    const text = slotOptionDescription(
      slot('2026-09-10T13:00:00Z', '2026-09-10T14:00:00Z'),
      SP,
    )
    expect(text).toContain('quinta')
    expect(text).toContain('11:00')
    expect(text.length).toBeLessThanOrEqual(72)
  })
})

describe('slot reply ids', () => {
  it('round-trips an index', () => {
    expect(parseSlotReplyId(slotReplyId(3))).toBe(3)
  })

  // The id carries an INDEX, not an instant. A customer who edits it
  // can only point at another offer we actually made, or at nothing —
  // never at a time nobody offered.
  it.each(['slot:-1', 'slot:', 'slot:abc', 'row_1', '', 'slot:1x'])(
    'refuses %j',
    (raw) => {
      expect(parseSlotReplyId(raw)).toBeNull()
    },
  )
})

describe('readOfferedSlots', () => {
  it('reads back what was offered', () => {
    const vars = {
      _offered_slots: [{ starts_at: 'a', ends_at: 'b' }],
    }
    expect(readOfferedSlots(vars)).toEqual([{ starts_at: 'a', ends_at: 'b' }])
  })

  // `vars` is a JSONB column an operator can edit by hand and an older
  // build may have written differently. Reading it must never throw
  // mid-conversation.
  it.each([
    [{}],
    [{ _offered_slots: null }],
    [{ _offered_slots: 'nope' }],
    [{ _offered_slots: [{ starts_at: 1 }, null, 'x'] }],
  ])('tolerates %j', (vars) => {
    expect(readOfferedSlots(vars as Record<string, unknown>)).toEqual([])
  })
})
