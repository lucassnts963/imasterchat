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

    // "Existe linha" e "o token funciona" são coisas diferentes, e a
    // tela mostrava a primeira como se fosse a segunda.
    //
    // O sintoma que isso produziu: o refresh token do Google expira a
    // cada 7 dias enquanto a tela de consentimento estiver em "Testing".
    // Quando expirava, as ferramentas de agendamento saíam do catálogo
    // do agente — e Configurações continuava dizendo "conectado". O
    // operador não tinha por onde desconfiar, e o cliente pedia horário
    // para um bot que já não sabia agendar.
    //
    // A verdade vem da ronda de saúde, que já testa o token de hora em
    // hora e grava o resultado. Ler daqui é barato; validar o token a
    // cada carregamento da tela gastaria uma troca com o Google só para
    // desenhar um rótulo.
    let health: { status: string; code: string | null; checked_at: string } | null =
      null
    if (data) {
      const { data: row } = await supabase
        .from('account_health')
        .select('status, code, checked_at')
        .eq('account_id', accountId)
        .eq('check_name', 'google_calendar')
        .order('checked_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ status: string; code: string | null; checked_at: string }>()
      health = row ?? null
    }

    return NextResponse.json({
      // False means the deployment has no OAuth credentials at all —
      // the UI should explain that rather than offer a button that
      // cannot work.
      available: isGoogleOAuthConfigured(),
      connected: Boolean(data),
      /**
       * O token está utilizável na última verificação?
       *
       * `null` = ainda não verificado (conexão recém-feita, antes da
       * primeira ronda). A tela deve tratar nulo como "conectado", e
       * não como "quebrado" — acusar problema em algo que só não foi
       * olhado ainda seria pior que o silêncio de antes.
       */
      usable: data ? (health ? health.status !== 'failing' : null) : null,
      health_code: health?.code ?? null,
      health_checked_at: health?.checked_at ?? null,
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
