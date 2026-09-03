import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  listAvailability: vi.fn(),
  bookForContact: vi.fn(),
  rescheduleForContact: vi.fn(),
  cancelForContact: vi.fn(),
  checkSlotFree: vi.fn(),
  liveAppointmentForContact: vi.fn(),
}))

vi.mock('@/lib/actions/scheduling', async () => {
  // The day-boundary parsers are pure and shared; mocking them would
  // test the fake instead of the timezone maths.
  const actual = await vi.importActual<typeof import('@/lib/actions/scheduling')>(
    '@/lib/actions/scheduling',
  )
  return {
    parseDayStart: actual.parseDayStart,
    parseDayEnd: actual.parseDayEnd,
    listAvailability: h.listAvailability,
    bookForContact: h.bookForContact,
    rescheduleForContact: h.rescheduleForContact,
    cancelForContact: h.cancelForContact,
    checkSlotFree: h.checkSlotFree,
    liveAppointmentForContact: h.liveAppointmentForContact,
  }
})

import { buildSchedulingTools } from './scheduling'
import type { ToolContext } from './types'
import type { SchedulingSettings } from '@/lib/scheduling/settings'

const SETTINGS = {
  isActive: true,
  timezone: 'America/Sao_Paulo',
  slotMinutes: 60,
  leadTimeMinutes: 120,
  maxAdvanceDays: 30,
  lookaheadDays: 7,
  openingHours: {},
  appointmentLabel: 'consulta',
  slotFetchLimit: 50,
  offerSlotsMax: 3,
} as unknown as SchedulingSettings

const APPOINTMENT = {
  id: 'appt-1',
  contactId: 'contact-1',
  conversationId: 'conv-1',
  startsAt: '2026-09-10T13:00:00.000Z',
  endsAt: '2026-09-10T14:00:00.000Z',
  status: 'scheduled',
  title: null,
  notes: null,
  googleEventId: 'g-1',
  createdVia: 'native',
}

const tools = () => buildSchedulingTools({ settings: SETTINGS, connection: null })
const tool = (name: string) => tools().find((t) => t.name === name)!

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    db: {} as never,
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    config: {} as never,
    ...over,
  }
}

const SLOT = { starts_at: '2026-09-10T13:00:00.000Z', ends_at: '2026-09-10T14:00:00.000Z' }

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.listAvailability.mockResolvedValue({ ok: true, data: [] })
  h.bookForContact.mockResolvedValue({ ok: true, data: APPOINTMENT })
  h.rescheduleForContact.mockResolvedValue({ ok: true, data: APPOINTMENT })
  h.cancelForContact.mockResolvedValue({
    ok: true,
    data: { appointment: APPOINTMENT, previousStartsAt: APPOINTMENT.startsAt },
  })
  h.checkSlotFree.mockResolvedValue({
    ok: true,
    data: { startsAt: new Date(SLOT.starts_at), endsAt: new Date(SLOT.ends_at) },
  })
  h.liveAppointmentForContact.mockResolvedValue(APPOINTMENT)
})

// The Playground exists to run the production code path without writing
// production data. Before the R-3 extraction only `book_appointment`
// honoured that: a rehearsal of reschedule or cancel really moved — or
// really cancelled — a live customer's appointment.
describe('a rehearsal writes nothing', () => {
  it('does not book', async () => {
    await tool('book_appointment').execute(SLOT, ctx({ dryRun: true }))
    expect(h.bookForContact).not.toHaveBeenCalled()
    expect(h.checkSlotFree).toHaveBeenCalled()
  })

  it('does not reschedule', async () => {
    const out = await tool('reschedule_appointment').execute(SLOT, ctx({ dryRun: true }))
    expect(h.rescheduleForContact).not.toHaveBeenCalled()
    expect(out.content).toContain('Test run')
  })

  it('does not cancel', async () => {
    const out = await tool('cancel_appointment').execute({}, ctx({ dryRun: true }))
    expect(h.cancelForContact).not.toHaveBeenCalled()
    expect(out.content).toContain('Test run')
  })

  // Moving a booking must not count its own slot against it, or "same
  // day, one hour later" is impossible whenever the two overlap.
  it('ignores the appointment being moved when checking the slot', async () => {
    await tool('reschedule_appointment').execute(SLOT, ctx({ dryRun: true }))
    expect(h.checkSlotFree).toHaveBeenCalledWith(
      expect.anything(),
      SLOT.starts_at,
      SLOT.ends_at,
      'appt-1',
    )
  })

  it('says so plainly when there is no customer to rehearse with', async () => {
    h.liveAppointmentForContact.mockResolvedValue(null)
    const out = await tool('cancel_appointment').execute(
      {},
      ctx({ dryRun: true, contactId: null }),
    )
    expect(out.isError).toBe(true)
    expect(out.content).toContain('no customer attached')
  })
})

// A calendar we cannot read is not a calendar with nothing in it.
// Offering slots computed without Google would double-book the shop.
describe('translating a refusal for the model', () => {
  it('stops the bot when the calendar is unreadable', async () => {
    h.listAvailability.mockResolvedValue({
      ok: false,
      reason: 'calendar_unreadable',
      message: 'The business calendar is no longer connected.',
      reconnect: true,
    })
    const out = await tool('check_availability').execute({}, ctx())
    expect(out.handoff).toBe(true)
    expect(out.content).toContain('Do not offer or confirm any time')
  })

  it('stops the bot when the booking did not reach the calendar', async () => {
    h.bookForContact.mockResolvedValue({
      ok: false,
      reason: 'calendar_not_synced',
      message: 'The appointment was recorded but could not be written to the business calendar.',
    })
    const out = await tool('book_appointment').execute(SLOT, ctx())
    expect(out.handoff).toBe(true)
    expect(out.content).toContain('a human must check')
  })

  // An unavailable slot is a conversation, not an incident: the model
  // explains which rule ruled it out and the customer picks again.
  it('keeps talking when the slot is merely unavailable', async () => {
    h.bookForContact.mockResolvedValue({
      ok: false,
      reason: 'slot_unavailable',
      message: 'Preciso de 2h de antecedência; o mais cedo hoje é 11:00.',
    })
    const out = await tool('book_appointment').execute(SLOT, ctx())
    expect(out.isError).toBe(true)
    expect(out.handoff).toBeFalsy()
    expect(out.content).toContain('antecedência')
  })

  it('tells the model to book instead when there is nothing to move', async () => {
    h.rescheduleForContact.mockResolvedValue({
      ok: false,
      reason: 'no_appointment',
      message: 'This customer has no appointment booked.',
    })
    const out = await tool('reschedule_appointment').execute(SLOT, ctx())
    expect(out.content).toContain('Book one instead')
    expect(out.handoff).toBeFalsy()
  })
})

describe('check_availability', () => {
  it('refuses an inverted range in its own words', async () => {
    h.listAvailability.mockResolvedValue({
      ok: false,
      reason: 'bad_slot',
      message: 'The end of the range must be after its start.',
    })
    const out = await tool('check_availability').execute({}, ctx())
    expect(out.content).toBe('date_to must be after date_from.')
    expect(out.isError).toBe(true)
  })

  it('needs a contact before booking', async () => {
    const out = await tool('book_appointment').execute(SLOT, ctx({ contactId: null }))
    expect(h.bookForContact).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
  })
})
