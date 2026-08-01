import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { isGoogleOAuthConfigured } from '@/lib/google/oauth'

// ============================================================
// GET    /api/google/calendar/status      (any member)
// DELETE /api/google/calendar/status      (admin+) — disconnect
//
// The status shape drives the settings panel AND the agenda screen's
// "not connected" state. It never returns a token — only whether one
// exists, and which Google account it belongs to, because connecting
// the wrong account is the mistake worth surfacing.
// ============================================================

interface ConnectionRow {
  calendar_id: string
  google_email: string | null
  created_at: string
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('google_calendar_connections')
      .select('calendar_id, google_email, created_at')
      .eq('account_id', accountId)
      .maybeSingle<ConnectionRow>()

    if (error) {
      console.error('[google/status] lookup failed:', error)
      return NextResponse.json(
        { error: 'Failed to load the calendar connection' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      // False means the deployment has no OAuth credentials at all —
      // the UI should explain that rather than offer a button that
      // cannot work.
      available: isGoogleOAuthConfigured(),
      connected: Boolean(data),
      calendar_id: data?.calendar_id ?? null,
      google_email: data?.google_email ?? null,
      connected_at: data?.created_at ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { error } = await supabase
      .from('google_calendar_connections')
      .delete()
      .eq('account_id', accountId)

    if (error) {
      console.error('[google/status] disconnect failed:', error)
      return NextResponse.json(
        { error: 'Failed to disconnect Google Calendar' },
        { status: 500 },
      )
    }

    // Appointments keep their `google_event_id`: the events still exist
    // on the calendar, and erasing the link would strand them. If the
    // account reconnects, the history still points at the right events.
    return NextResponse.json({ connected: false })
  } catch (err) {
    return toErrorResponse(err)
  }
}
