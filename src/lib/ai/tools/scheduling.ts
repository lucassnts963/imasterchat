import { GoogleError } from '@/lib/google/oauth'
import type { GoogleConnection } from '@/lib/google/connection'
import { parseSlot, SLOT_ERROR_MESSAGE } from '@/lib/api/v1/appointments'
import { formatInZone, zonedParts, zonedTimeToUtc } from '@/lib/time/zone'
import {
  computeAvailableSlots,
  describeSlots,
} from '@/lib/scheduling/availability'
import type { SchedulingSettings } from '@/lib/scheduling/settings'
import {
  bookAppointment,
  cancelAppointment,
  describeAppointment,
  loadBusyIntervals,
  rescheduleAppointment,
  type Appointment,
} from '@/lib/scheduling/store'
import type { AgentTool, ToolContext, ToolOutcome } from './types'

// ============================================================
// The scheduling tools.
//
// The model picks WHICH tool and WHEN. It does not pick whether a slot
// is legal — opening hours, notice, horizon and collisions are all
// decided here, on the server, and the 041 indexes stand behind that as
// the last line against a retrying agent.
//
// Note what these signatures do NOT take: an appointment id. The
// customer has at most one live booking (enforced by
// `idx_appointments_one_live_per_contact`), so "their appointment" is
// unambiguous — and a model that never sees a UUID is a model that
// cannot invent one and cancel a stranger's slot.
// ============================================================

/** How far ahead `check_availability` will look when asked for "soon". */
const DEFAULT_LOOKAHEAD_DAYS = 14

export interface SchedulingToolDeps {
  settings: SchedulingSettings
  /** Null when no calendar is connected: bookings still record, but
   *  availability is then based only on our own table. */
  connection: GoogleConnection | null
}

export function buildSchedulingTools(deps: SchedulingToolDeps): AgentTool[] {
  return [
    checkAvailabilityTool(deps),
    bookAppointmentTool(deps),
    rescheduleAppointmentTool(deps),
    cancelAppointmentTool(deps),
  ]
}

// ------------------------------------------------------------
// check_availability
// ------------------------------------------------------------

function checkAvailabilityTool(deps: SchedulingToolDeps): AgentTool {
  const { settings, connection } = deps
  return {
    name: 'check_availability',
    description:
      'List appointment slots that are actually free. Call this BEFORE offering any time — ' +
      'never invent or guess availability. Returns times already filtered by the shop hours, ' +
      'the minimum notice and everything already booked.',
    parameters: {
      type: 'object',
      properties: {
        date_from: {
          type: 'string',
          description:
            'First day to look at, as YYYY-MM-DD in the shop timezone. Defaults to today.',
        },
        date_to: {
          type: 'string',
          description: `Last day to look at, as YYYY-MM-DD. Defaults to ${DEFAULT_LOOKAHEAD_DAYS} days after date_from.`,
        },
      },
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const now = new Date()
      const from = parseDayStart(args.date_from, settings.timezone) ?? now
      const to =
        parseDayEnd(args.date_to, settings.timezone) ??
        new Date(from.getTime() + DEFAULT_LOOKAHEAD_DAYS * 24 * 60 * 60_000)

      if (to <= from) {
        return { content: 'date_to must be after date_from.', isError: true }
      }

      try {
        const busy = await loadBusyIntervals(
          ctx.db,
          ctx.accountId,
          connection,
          from,
          to,
        )
        const slots = computeAvailableSlots({ settings, busy, from, to, now })
        return { content: describeSlots(slots, settings.timezone) }
      } catch (err) {
        return calendarFailure(err, 'read the calendar')
      }
    },
  }
}

// ------------------------------------------------------------
// book_appointment
// ------------------------------------------------------------

function bookAppointmentTool(deps: SchedulingToolDeps): AgentTool {
  const { settings, connection } = deps
  return {
    name: 'book_appointment',
    description:
      'Book one of the free slots for this customer, after they have chosen it. Use an exact ' +
      'start and end taken from check_availability — do not adjust them. Only call this once ' +
      'the customer has confirmed a specific time.',
    parameters: {
      type: 'object',
      properties: {
        starts_at: {
          type: 'string',
          description: 'ISO 8601 start instant, exactly as offered.',
        },
        ends_at: {
          type: 'string',
          description: 'ISO 8601 end instant, exactly as offered.',
        },
        title: {
          type: 'string',
          description:
            'Short description of what the appointment is for, in the customer’s words.',
        },
      },
      required: ['starts_at', 'ends_at'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      if (!ctx.dryRun && !ctx.contactId) {
        return {
          content: 'No customer is attached to this conversation, so nothing can be booked.',
          isError: true,
        }
      }

      const slot = parseSlot(args.starts_at, args.ends_at)
      if (!slot.ok) {
        return { content: SLOT_ERROR_MESSAGE[slot.error], isError: true }
      }

      // Re-check against live state. The customer took time to answer,
      // and the slot the model offered may have gone in the meantime.
      const stillFree = await isSlotStillFree(ctx, deps, slot.slot.startsAt, slot.slot.endsAt)
      if (stillFree !== true) return stillFree

      // Everything above ran for real — the slot rules, the shop hours,
      // the collision check against Google and our own bookings. Only
      // the write is withheld, so a rehearsal proves the dialogue books
      // the RIGHT time without putting a rehearsal in the shop's diary.
      if (ctx.dryRun) {
        return {
          content:
            `Test run: this would book ${formatInZone(slot.slot.startsAt, settings.timezone)} ` +
            `(${settings.timezone}) and the slot is genuinely free. Nothing was written. ` +
            'Confirm to the customer as you normally would.',
        }
      }

      const result = await bookAppointment({
        db: ctx.db,
        accountId: ctx.accountId,
        contactId: ctx.contactId!,
        conversationId: ctx.conversationId,
        startsAt: slot.slot.startsAt,
        endsAt: slot.slot.endsAt,
        title: typeof args.title === 'string' ? args.title.slice(0, 200) : null,
        createdVia: 'native',
        connection,
        timezone: settings.timezone,
      })

      if (!result.ok) {
        return { content: result.message, isError: true }
      }
      if (!result.calendarSynced) {
        // Recorded here but not on the shop's calendar — which is the
        // one they actually work from. Do not tell the customer it is
        // confirmed; get a person.
        return {
          content:
            'The appointment was recorded but could NOT be written to the shop calendar. ' +
            'Do not confirm it to the customer — a human must check.',
          isError: true,
          handoff: true,
        }
      }

      return {
        content: `Booked: ${describeAppointment(result.appointment, settings.timezone)}. Confirm it to the customer.`,
      }
    },
  }
}

// ------------------------------------------------------------
// reschedule_appointment
// ------------------------------------------------------------

function rescheduleAppointmentTool(deps: SchedulingToolDeps): AgentTool {
  const { settings, connection } = deps
  return {
    name: 'reschedule_appointment',
    description:
      'Move this customer’s existing appointment to a different free slot. Check availability ' +
      'first and use an exact slot from it.',
    parameters: {
      type: 'object',
      properties: {
        starts_at: { type: 'string', description: 'New ISO 8601 start instant.' },
        ends_at: { type: 'string', description: 'New ISO 8601 end instant.' },
      },
      required: ['starts_at', 'ends_at'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const existing = await liveAppointmentFor(ctx)
      if (!existing && ctx.dryRun) {
        return {
          content:
            'Test run: there is no customer attached, so there is no existing appointment to work ' +
            'from. Rehearse booking instead.',
          isError: true,
        }
      }
      if (!existing) {
        return {
          content:
            'This customer has no appointment booked, so there is nothing to move. Book one instead.',
          isError: true,
        }
      }

      const slot = parseSlot(args.starts_at, args.ends_at)
      if (!slot.ok) {
        return { content: SLOT_ERROR_MESSAGE[slot.error], isError: true }
      }

      const stillFree = await isSlotStillFree(
        ctx,
        deps,
        slot.slot.startsAt,
        slot.slot.endsAt,
        existing.id,
      )
      if (stillFree !== true) return stillFree

      const result = await rescheduleAppointment({
        db: ctx.db,
        accountId: ctx.accountId,
        appointmentId: existing.id,
        startsAt: slot.slot.startsAt,
        endsAt: slot.slot.endsAt,
        connection,
        timezone: settings.timezone,
      })

      if (!result.ok) return { content: result.message, isError: true }
      if (!result.calendarSynced) {
        return {
          content:
            'The appointment was moved in the system but the shop calendar was not updated. ' +
            'Do not confirm it to the customer — a human must check.',
          isError: true,
          handoff: true,
        }
      }
      return {
        content: `Moved to ${describeAppointment(result.appointment, settings.timezone)}. Confirm it to the customer.`,
      }
    },
  }
}

// ------------------------------------------------------------
// cancel_appointment
// ------------------------------------------------------------

function cancelAppointmentTool(deps: SchedulingToolDeps): AgentTool {
  const { settings, connection } = deps
  return {
    name: 'cancel_appointment',
    description:
      'Cancel this customer’s existing appointment, freeing the slot. Only after they clearly ' +
      'asked to cancel.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why the customer cancelled, in one short sentence.',
        },
      },
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const existing = await liveAppointmentFor(ctx)
      if (!existing && ctx.dryRun) {
        return {
          content:
            'Test run: there is no customer attached, so there is no existing appointment to work ' +
            'from. Rehearse booking instead.',
          isError: true,
        }
      }
      if (!existing) {
        return {
          content: 'This customer has no appointment booked — nothing to cancel.',
          isError: true,
        }
      }

      const result = await cancelAppointment({
        db: ctx.db,
        accountId: ctx.accountId,
        appointmentId: existing.id,
        reason: typeof args.reason === 'string' ? args.reason.slice(0, 500) : null,
        connection,
      })

      if (!result.ok) return { content: result.message, isError: true }
      if (!result.calendarSynced) {
        return {
          content:
            'Cancelled in the system, but the event is still on the shop calendar. A human must remove it.',
          isError: true,
          handoff: true,
        }
      }
      return {
        content: `Cancelled the appointment that was on ${describeAppointment(
          { ...result.appointment, startsAt: existing.startsAt },
          settings.timezone,
        )}. Confirm the cancellation to the customer.`,
      }
    },
  }
}

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

/** The customer's single live booking, if any. */
async function liveAppointmentFor(ctx: ToolContext): Promise<Appointment | null> {
  if (!ctx.contactId) return null
  const { data, error } = await ctx.db
    .from('appointments')
    .select(
      'id, contact_id, conversation_id, starts_at, ends_at, status, title, notes, google_event_id, created_via',
    )
    .eq('account_id', ctx.accountId)
    .eq('contact_id', ctx.contactId)
    .eq('status', 'scheduled')
    .order('starts_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[ai tools] live appointment lookup failed:', error)
    return null
  }
  const row = (data ?? [])[0] as
    | {
        id: string
        contact_id: string
        conversation_id: string | null
        starts_at: string
        ends_at: string
        status: string
        title: string | null
        notes: string | null
        google_event_id: string | null
        created_via: string
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    title: row.title,
    notes: row.notes,
    googleEventId: row.google_event_id,
    createdVia: row.created_via,
  }
}

/**
 * Is the slot the model picked still legal and still free?
 *
 * `computeAvailableSlots` is the authority, so this asks it rather than
 * re-deriving the rules: a slot counts only if it comes back as one of
 * the free ones. That catches all four filters at once — a time outside
 * opening hours, inside the notice window, past the horizon, or taken
 * since it was offered.
 *
 * Returns `true`, or the outcome to hand straight back to the model.
 */
async function isSlotStillFree(
  ctx: ToolContext,
  deps: SchedulingToolDeps,
  startsAt: Date,
  endsAt: Date,
  ignoreAppointmentId?: string,
): Promise<true | ToolOutcome> {
  const { settings, connection } = deps
  try {
    const busy = (
      await loadBusyIntervals(ctx.db, ctx.accountId, connection, startsAt, endsAt)
    ).filter(() => true)

    // When moving an existing booking, its own slot must not count
    // against it — otherwise "same day, one hour later" is impossible
    // whenever the two overlap.
    const filtered = ignoreAppointmentId
      ? await withoutOwnInterval(ctx, ignoreAppointmentId, busy)
      : busy

    const slots = computeAvailableSlots({
      settings,
      busy: filtered,
      from: startsAt,
      to: endsAt,
      limit: 1,
    })
    const match = slots.find(
      (s) =>
        s.startsAt.getTime() === startsAt.getTime() &&
        s.endsAt.getTime() === endsAt.getTime(),
    )
    if (match) return true

    return {
      content:
        'That slot is not available — it is outside the shop hours, too soon, too far ahead, ' +
        'or has just been taken. Call check_availability again and offer what is actually free.',
      isError: true,
    }
  } catch (err) {
    return calendarFailure(err, 'check the calendar')
  }
}

async function withoutOwnInterval(
  ctx: ToolContext,
  appointmentId: string,
  busy: { start: Date; end: Date }[],
): Promise<{ start: Date; end: Date }[]> {
  const { data } = await ctx.db
    .from('appointments')
    .select('starts_at, ends_at')
    .eq('id', appointmentId)
    .eq('account_id', ctx.accountId)
    .maybeSingle<{ starts_at: string; ends_at: string }>()
  if (!data) return busy
  const ownStart = new Date(data.starts_at).getTime()
  const ownEnd = new Date(data.ends_at).getTime()
  return busy.filter(
    (b) => !(b.start.getTime() === ownStart && b.end.getTime() === ownEnd),
  )
}

/**
 * A calendar we cannot read is not a calendar with nothing in it.
 * Offering slots computed without Google would double-book the shop, so
 * these failures stop the bot rather than degrading.
 */
function calendarFailure(err: unknown, what: string): ToolOutcome {
  const reconnect =
    err instanceof GoogleError &&
    (err.code === 'not_authorized' ||
      err.code === 'invalid_grant' ||
      err.code === 'credentials_unreadable')

  console.error(`[ai tools] could not ${what}:`, err)
  return {
    content: reconnect
      ? 'The shop calendar is no longer connected. Do not offer or confirm any time.'
      : `Could not ${what} right now. Do not offer or confirm any time.`,
    isError: true,
    handoff: true,
  }
}

// ------------------------------------------------------------
// Day-boundary parsing for check_availability
// ------------------------------------------------------------

function parseYmd(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function parseDayStart(value: unknown, timezone: string): Date | null {
  const ymd = parseYmd(value)
  if (!ymd) return null
  return zonedMidnight(ymd, timezone, 0)
}

function parseDayEnd(value: unknown, timezone: string): Date | null {
  const ymd = parseYmd(value)
  if (!ymd) return null
  // End of the named day, i.e. midnight at the start of the next one.
  return zonedMidnight(ymd, timezone, 1)
}

function zonedMidnight(
  ymd: { year: number; month: number; day: number },
  timezone: string,
  addDays: number,
): Date {
  // Build the date in UTC first so month/year rollover is the runtime's
  // problem, then resolve that calendar day's midnight in the zone.
  const rolled = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + addDays, 12))
  const parts = zonedParts(rolled, 'UTC')
  return zonedTimeToUtc(
    { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0 },
    timezone,
  )
}
