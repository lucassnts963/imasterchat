import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  loadSchedulingSettings,
  parseWeeklyHours,
  serializeWeeklyHours,
  DEFAULT_TIMEZONE,
} from '@/lib/scheduling/settings'
import { sanitizeAppointmentLabel } from '@/lib/scheduling/label'

// ============================================================
// GET /api/scheduling/settings   (any member)
// PUT /api/scheduling/settings   (admin+)
//
// The rules the server enforces when the agent books. They live here
// rather than in the agent's prompt because a rule in a prompt is a
// suggestion — the model that reads "seg a sex" will eventually offer
// Saturday, and only a check can say no.
// ============================================================

/** Defaults for an account that has never opened this panel. */
const DEFAULTS = {
  timezone: DEFAULT_TIMEZONE,
  slot_minutes: 60,
  lead_time_minutes: 120,
  max_advance_days: 30,
  weekly_hours: {
    '1': [['09:00', '12:00'], ['14:00', '18:00']],
    '2': [['09:00', '12:00'], ['14:00', '18:00']],
    '3': [['09:00', '12:00'], ['14:00', '18:00']],
    '4': [['09:00', '12:00'], ['14:00', '18:00']],
    '5': [['09:00', '12:00'], ['14:00', '18:00']],
  },
  is_active: false,
  appointment_label: null as string | null,
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const settings = await loadSchedulingSettings(supabase, accountId)

    if (!settings) return NextResponse.json({ settings: DEFAULTS, configured: false })

    return NextResponse.json({
      settings: {
        timezone: settings.timezone,
        slot_minutes: settings.slotMinutes,
        lead_time_minutes: settings.leadTimeMinutes,
        max_advance_days: settings.maxAdvanceDays,
        weekly_hours: serializeWeeklyHours(settings.weeklyHours),
        is_active: settings.isActive,
        appointment_label: settings.appointmentLabel,
      },
      configured: true,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** Bounds mirror the CHECK constraints in migration 043. */
function readInt(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** A zone the runtime does not know would make every slot wrong. */
function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
      return NextResponse.json(
        { error: 'Unknown timezone', code: 'invalid_timezone' },
        { status: 400 },
      )
    }

    // Round-trip through the parser so anything malformed is rejected
    // here, while the operator is looking at the form — not silently
    // dropped later when a customer is waiting for a slot.
    const weeklyHours = serializeWeeklyHours(parseWeeklyHours(body.weekly_hours))

    const payload = {
      account_id: accountId,
      timezone: isValidTimezone(body.timezone) ? body.timezone : DEFAULT_TIMEZONE,
      slot_minutes: readInt(body.slot_minutes, { min: 5, max: 480, fallback: 60 }),
      lead_time_minutes: readInt(body.lead_time_minutes, {
        min: 0,
        max: 60 * 24 * 30,
        fallback: 120,
      }),
      max_advance_days: readInt(body.max_advance_days, {
        min: 1,
        max: 365,
        fallback: 30,
      }),
      weekly_hours: weeklyHours,
      is_active: Boolean(body.is_active),
      // Saneado aqui, e não só no banco: o CHECK da 054 limita o
      // tamanho, mas quebra de linha e caractere de controle passariam
      // por ele — e este texto vai para o contexto do agente.
      appointment_label: sanitizeAppointmentLabel(body.appointment_label),
    }

    const { error } = await supabase
      .from('ai_scheduling_settings')
      .upsert(payload, { onConflict: 'account_id' })

    if (error) {
      console.error('[scheduling/settings PUT] error:', error)
      return NextResponse.json(
        { error: 'Failed to save the scheduling rules' },
        { status: 500 },
      )
    }

    return NextResponse.json({ settings: payload, configured: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
