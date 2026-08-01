import { GoogleError } from './oauth'
import type { GoogleConnection } from './connection'

// ============================================================
// Google Calendar API — freebusy and events.
//
// Google is the source of truth for whether a time is taken. That is
// the decision the whole feature rests on: the optician blocks a day by
// creating an event in her own calendar, and the bot respects it
// without her touching a second system.
//
// So this module reads `freebusy` rather than listing events. We do not
// need to know WHAT is booked — only that something is. It is one call
// for a whole range, and it does not leak the content of the shop's
// calendar into our logs.
// ============================================================

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const REQUEST_TIMEOUT_MS = 15_000

/** A half-open interval `[start, end)` that is already taken. */
export interface BusyInterval {
  start: Date
  end: Date
}

async function callGoogle<T>(
  connection: GoogleConnection,
  path: string,
  init: RequestInit,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new GoogleError(`Could not reach Google Calendar: ${message}`, {
      code: 'network_error',
    })
  }

  if (res.status === 204) return undefined as T

  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string } }
    | T
    | null

  if (!res.ok) {
    const detail =
      (body as { error?: { message?: string } })?.error?.message ??
      `HTTP ${res.status}`
    // 401/403 here means the grant is gone (revoked in the Google
    // account, or the calendar was unshared). Name it so the caller can
    // say "reconnect" instead of "try again".
    const code =
      res.status === 401 || res.status === 403
        ? 'not_authorized'
        : res.status === 404
          ? 'not_found'
          : 'calendar_error'
    throw new GoogleError(`Google Calendar: ${detail}`, {
      code,
      status: code === 'not_authorized' ? 401 : 502,
    })
  }

  return body as T
}

interface FreeBusyResponse {
  calendars?: Record<string, { busy?: { start?: string; end?: string }[] }>
}

/**
 * Everything already taken on the account's calendar between two
 * instants. Intervals come back in Google's order, which is chronological
 * but not guaranteed non-overlapping — the availability calculator does
 * not assume either.
 */
export async function queryFreeBusy(
  connection: GoogleConnection,
  timeMin: Date,
  timeMax: Date,
): Promise<BusyInterval[]> {
  const data = await callGoogle<FreeBusyResponse>(connection, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: connection.calendarId }],
    }),
  })

  // Google keys the response by the calendar id it resolved, which for
  // 'primary' is the account's real address — so read whatever single
  // entry came back rather than looking up the id we sent.
  const entry = Object.values(data?.calendars ?? {})[0]
  return (entry?.busy ?? [])
    .map((b) => ({
      start: new Date(b.start ?? ''),
      end: new Date(b.end ?? ''),
    }))
    .filter(
      (b) => !Number.isNaN(b.start.getTime()) && !Number.isNaN(b.end.getTime()),
    )
}

export interface CalendarEventInput {
  summary: string
  description?: string
  startsAt: Date
  endsAt: Date
  /** IANA zone. Google stores the instant either way, but sending the
   *  zone makes the event render correctly in the shop's own calendar. */
  timezone: string
}

export interface CalendarEvent {
  id: string
  htmlLink: string | null
}

interface GoogleEvent {
  id?: string
  htmlLink?: string
}

function toEventBody(input: CalendarEventInput) {
  return {
    summary: input.summary,
    ...(input.description ? { description: input.description } : {}),
    start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone },
  }
}

export async function insertEvent(
  connection: GoogleConnection,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  const data = await callGoogle<GoogleEvent>(
    connection,
    `/calendars/${encodeURIComponent(connection.calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(toEventBody(input)) },
  )
  if (!data?.id) {
    throw new GoogleError('Google Calendar created no event.', {
      code: 'calendar_error',
    })
  }
  return { id: data.id, htmlLink: data.htmlLink ?? null }
}

export async function patchEvent(
  connection: GoogleConnection,
  eventId: string,
  input: CalendarEventInput,
): Promise<void> {
  await callGoogle<GoogleEvent>(
    connection,
    `/calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(toEventBody(input)) },
  )
}

/**
 * Remove an event. A 404/410 is success: the event is gone, which is
 * the state we wanted, and failing here would leave a cancelled booking
 * in our table that nobody can cancel again.
 */
export async function deleteEvent(
  connection: GoogleConnection,
  eventId: string,
): Promise<void> {
  try {
    await callGoogle<void>(
      connection,
      `/calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    )
  } catch (err) {
    if (err instanceof GoogleError && err.code === 'not_found') return
    throw err
  }
}
