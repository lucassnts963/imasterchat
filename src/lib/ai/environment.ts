import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// What the model is allowed to know before it starts talking.
//
// `buildConversationContext` returns text and nothing else, so today a
// model asked "pode ser amanhã?" has to guess what day it is. It
// guesses wrong — training-cutoff wrong, sometimes by a year. Every
// promise it makes about a date is unfounded.
//
// This block fixes that, and is worth having with no tools at all: a
// bot that knows the date, the customer's name and whether they already
// have an appointment answers better even when it can only reply.
//
// Only facts go in here. No instructions, no persona — those belong in
// the system prompt the operator writes.
// ============================================================

/** Where the business is, until scheduling settings supply the real
 *  one (043). Brazil is where the product is sold. */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo'

export interface EnvironmentArgs {
  db: SupabaseClient
  accountId: string
  /** Null in the Playground — the customer block is simply omitted. */
  contactId: string | null
  /** IANA zone. Everything time-shaped is rendered in it. */
  timezone?: string
  /** Injectable for tests. */
  now?: Date
}

interface ContactRow {
  name: string | null
  phone: string | null
  contact_tags?: { tags: { name: string | null } | null }[] | null
}

interface AppointmentRow {
  starts_at: string
  ends_at: string
  title: string | null
}

/**
 * Render an instant in a given zone as `Saturday, 2026-08-01 19:30`.
 * `en-CA` is the shortest route to ISO-ordered date parts, which is
 * what we want the model to see — `01/08/2026` is ambiguous to a reader
 * that has met both conventions.
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

/**
 * Build the environment block appended to the system prompt.
 *
 * Best-effort throughout: every lookup that fails is simply left out.
 * A missing tag list must never cost the customer their reply.
 */
export async function buildEnvironment(args: EnvironmentArgs): Promise<string> {
  const {
    db,
    accountId,
    contactId,
    timezone = DEFAULT_TIMEZONE,
    now = new Date(),
  } = args

  const lines: string[] = [
    `Current date and time: ${formatInZone(now, timezone)} (${timezone}).`,
    'Use this for anything relative — "today", "tomorrow", "next Thursday". Never guess the date.',
  ]

  if (contactId) {
    const [contact, appointment] = await Promise.all([
      loadContact(db, accountId, contactId),
      loadNextAppointment(db, accountId, contactId, now),
    ])

    if (contact) {
      const facts: string[] = []
      if (contact.name?.trim()) facts.push(`name: ${contact.name.trim()}`)
      if (contact.phone?.trim()) facts.push(`phone: ${contact.phone.trim()}`)
      const tags = (contact.contact_tags ?? [])
        .map((j) => j.tags?.name?.trim())
        .filter((n): n is string => Boolean(n))
      if (tags.length > 0) facts.push(`tags: ${tags.join(', ')}`)
      if (facts.length > 0) {
        lines.push(`You are talking to — ${facts.join('; ')}.`)
      }
    }

    if (appointment) {
      const what = appointment.title?.trim() || 'an appointment'
      lines.push(
        `This customer already has ${what} booked for ${formatInZone(
          new Date(appointment.starts_at),
          timezone,
        )}. Do not book a second one — if they want to change it, reschedule that booking.`,
      )
    }
  }

  return lines.join('\n')
}

async function loadContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ContactRow | null> {
  try {
    const { data, error } = await db
      .from('contacts')
      .select('name, phone, contact_tags(tags(name))')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle<ContactRow>()
    if (error) throw error
    return data
  } catch (err) {
    console.error('[ai environment] contact lookup failed:', err)
    return null
  }
}

/**
 * The customer's next live booking. Scoped to `scheduled` and to the
 * future on purpose: a cancelled or past appointment must not stop the
 * bot from booking a new one.
 */
async function loadNextAppointment(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  now: Date,
): Promise<AppointmentRow | null> {
  try {
    const { data, error } = await db
      .from('appointments')
      .select('starts_at, ends_at, title')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'scheduled')
      .gte('starts_at', now.toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
    if (error) throw error
    return (data as AppointmentRow[] | null)?.[0] ?? null
  } catch (err) {
    // Expected on an account whose DB predates migration 041 — degrade
    // to "no appointment known" rather than losing the whole block.
    console.error('[ai environment] appointment lookup failed:', err)
    return null
  }
}
