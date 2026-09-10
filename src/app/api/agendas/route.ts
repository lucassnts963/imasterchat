import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/agendas — as agendas conectadas, para os seletores.
 *
 * Só id, rótulo e qual é a padrão. **Nenhum token sai daqui**, nem
 * cifrado: quem monta um fluxo precisa escolher entre "Dra. Ana" e
 * "Dr. Bruno", não ler credencial.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const { data, error } = await supabase
      .from('google_calendar_connections')
      .select('id, rotulo, google_email, is_default, is_active')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      agendas: ((data ?? []) as Array<{
        id: string
        rotulo: string | null
        google_email: string | null
        is_default: boolean
      }>).map((a) => ({
        id: a.id,
        // O mesmo desempate de `rotuloDaAgenda`: uma conta que conectou
        // duas e não rotulou nenhuma ainda precisa de duas opções
        // distinguíveis, e o e-mail distingue melhor que "Agenda 2".
        label: a.rotulo?.trim() || a.google_email || 'Agenda',
        is_default: a.is_default,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
