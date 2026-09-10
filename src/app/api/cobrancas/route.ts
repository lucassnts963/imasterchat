import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/cobrancas — a carteira, para a tela.
 *
 * `?status=aberta|paga|cancelada|orfas` e `?q=` por descrição ou
 * telefone. `orfas` é um filtro próprio, e não um status: são as
 * cobranças que **não casaram com nenhum contato** e por isso não
 * disparam nada. Sem uma fila para elas, a carteira do sistema diverge
 * da do cliente e ninguém descobre até alguém reclamar de não ter sido
 * cobrado.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const q = url.searchParams.get('q')?.trim()

    let query = supabase
      .from('cobrancas')
      .select(
        'id, contact_id, titular_ref, telefone_bruto, origem, id_externo, descricao, valor, vencimento, status, pago_em, sincronizado_em, contact:contacts(id, name, phone)',
      )
      .eq('account_id', accountId)
      .order('vencimento', { ascending: true })
      .limit(500)

    if (status === 'orfas') query = query.is('contact_id', null)
    else if (status) query = query.eq('status', status)
    if (q) query = query.or(`descricao.ilike.%${q}%,telefone_bruto.ilike.%${q}%`)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ cobrancas: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
