import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

// ============================================================
// GET   /api/admin/events        (platform admin) — a linha do tempo
// GET   /api/admin/events?id=…   (platform admin) — um evento, com print
// PATCH /api/admin/events        (platform admin) — marcar como visto/resolvido
//
// Falhas detectadas pelo código e relatos digitados por clientes, na
// mesma lista e na mesma ordem de tempo. É o cruzamento que dá a
// resposta: a cliente escreveu "o bot parou" às 9h12; três linhas
// acima, catorze `invalid_key` na conta dela desde as 6h.
// ============================================================

async function requirePlatformAdmin() {
  const ctx = await getCurrentAccount({ allowBlocked: true })
  if (!ctx.isPlatformAdmin) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
  return ctx
}

/** Colunas da listagem. `screenshot` fica DE FORA de propósito: são
 *  centenas de KB por linha e a lista não mostra imagem. Só a busca
 *  por id traz. */
const LIST_COLUMNS =
  'id, account_id, kind, severity, status, source, code, message, context, conversation_id, user_id, alerted_at, resolved_at, resolution_note, created_at'

export async function GET(request: Request) {
  try {
    const { supabase } = await requirePlatformAdmin()
    const params = new URL(request.url).searchParams

    const id = params.get('id')
    if (id) {
      const { data, error } = await supabase
        .from('platform_events')
        .select(`${LIST_COLUMNS}, screenshot`)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json({ event: data })
    }

    const kind = params.get('kind') // 'error' | 'report'
    const status = params.get('status') // 'open' | 'resolved'
    const accountId = params.get('account_id')
    const days = Math.min(90, Math.max(1, Number(params.get('days')) || 7))

    let q = supabase
      .from('platform_events')
      .select(LIST_COLUMNS)
      .gte(
        'created_at',
        new Date(Date.now() - days * 86_400_000).toISOString(),
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (kind === 'error' || kind === 'report') q = q.eq('kind', kind)
    if (status === 'open') q = q.neq('status', 'resolved')
    if (status === 'resolved') q = q.eq('status', 'resolved')
    if (accountId) q = q.eq('account_id', accountId)

    const { data, error } = await q
    if (error) throw error

    const events = data ?? []

    // Os nomes das contas numa consulta só. Sem isto a tela mostra
    // UUIDs, e "8f3a-…" não diz a ninguém qual cliente está fora do
    // ar — que é justamente a informação que importa.
    const ids = [
      ...new Set(
        events
          .map((e) => (e as { account_id: string | null }).account_id)
          .filter((v): v is string => Boolean(v)),
      ),
    ]
    const names: Record<string, string> = {}
    if (ids.length > 0) {
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name')
        .in('id', ids)
      for (const a of (accounts ?? []) as { id: string; name: string }[]) {
        names[a.id] = a.name
      }
    }

    return NextResponse.json({ events, accountNames: names })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, userId } = await requirePlatformAdmin()

    const body = (await request.json().catch(() => null)) as {
      id?: unknown
      status?: unknown
      resolution_note?: unknown
    } | null

    const id = typeof body?.id === 'string' ? body.id : ''
    const status = body?.status
    if (!id || !['open', 'ack', 'resolved'].includes(String(status))) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    }

    const resolved = status === 'resolved'
    const { error } = await supabase
      .from('platform_events')
      .update({
        status,
        // Reabrir limpa o carimbo. Um evento "aberto" com data de
        // resolução mente para quem olhar depois.
        resolved_at: resolved ? new Date().toISOString() : null,
        resolved_by: resolved ? userId : null,
        resolution_note:
          typeof body?.resolution_note === 'string'
            ? body.resolution_note.slice(0, 1000)
            : null,
      })
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
