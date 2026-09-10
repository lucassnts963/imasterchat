import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { JANELA_PADRAO } from '@/lib/cobranca/janela'

/**
 * GET/PUT /api/cobrancas/regua — a régua da conta.
 *
 * Uma régua ativa por conta neste corte. Mais de uma (por faixa de
 * valor, por tag) é o R-19 B2 e entra quando o segundo cliente pedir —
 * o schema já suporta, a tela é que ainda escolhe a primeira.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const { data: regua } = await supabase
      .from('reguas')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!regua) {
      return NextResponse.json({ regua: null, janela_padrao: JANELA_PADRAO })
    }

    const { data: degraus } = await supabase
      .from('regua_degraus')
      .select('*')
      .eq('regua_id', (regua as { id: string }).id)
      .order('offset_dias', { ascending: true })

    return NextResponse.json({
      regua,
      degraus: degraus ?? [],
      janela_padrao: JANELA_PADRAO,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

interface DegrauBody {
  offset_dias?: unknown
  template_name?: unknown
  template_language?: unknown
  template_vars?: unknown
  hora_do_dia?: unknown
  flow_id?: unknown
  is_active?: unknown
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as {
      nome?: unknown
      is_active?: unknown
      janela?: unknown
      max_contatos_periodo?: unknown
      periodo_dias?: unknown
      intervalo_minimo_dias?: unknown
      pausa_apos_resposta_dias?: unknown
      degraus?: unknown
    } | null
    if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 })

    const degrausBody = Array.isArray(body.degraus) ? (body.degraus as DegrauBody[]) : []
    // O template é obrigatório: um degrau sem template não é um degrau,
    // é uma linha na tela que nunca vai mandar nada.
    for (const d of degrausBody) {
      if (typeof d.template_name !== 'string' || !d.template_name.trim()) {
        return NextResponse.json(
          { error: 'every degrau needs a template' },
          { status: 400 },
        )
      }
      if (!Number.isInteger(Number(d.offset_dias))) {
        return NextResponse.json(
          { error: 'offset_dias must be a whole number of days' },
          { status: 400 },
        )
      }
    }

    const patch = {
      account_id: accountId,
      nome: typeof body.nome === 'string' && body.nome.trim() ? body.nome.trim() : 'Régua',
      is_active: body.is_active === true,
      janela: typeof body.janela === 'object' && body.janela !== null ? body.janela : {},
      max_contatos_periodo: posInt(body.max_contatos_periodo, 4),
      periodo_dias: posInt(body.periodo_dias, 30),
      intervalo_minimo_dias: posInt(body.intervalo_minimo_dias, 2, 0),
      pausa_apos_resposta_dias: posInt(body.pausa_apos_resposta_dias, 3, 0),
    }

    const { data: existente } = await supabase
      .from('reguas')
      .select('id')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle()

    let reguaId = (existente as { id: string } | null)?.id ?? null
    if (reguaId) {
      const { error } = await supabase.from('reguas').update(patch).eq('id', reguaId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { data, error } = await supabase
        .from('reguas')
        .insert(patch)
        .select('id')
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      reguaId = (data as { id: string }).id
    }

    // Substituição inteira dos degraus. Um `delete` + `insert` em vez de
    // reconciliar por id: os disparos apontam para o degrau, então
    // apagar um degrau apagaria o histórico dele por cascata — e por
    // isso a troca preserva os ids que vieram do cliente.
    const idsMantidos = degrausBody
      .map((d) => (d as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string')

    let apagar = supabase.from('regua_degraus').delete().eq('regua_id', reguaId)
    if (idsMantidos.length > 0) apagar = apagar.not('id', 'in', `(${idsMantidos.join(',')})`)
    await apagar

    if (degrausBody.length > 0) {
      const linhas = degrausBody.map((d) => ({
        ...(typeof (d as { id?: unknown }).id === 'string'
          ? { id: (d as { id: string }).id }
          : {}),
        regua_id: reguaId,
        offset_dias: Number(d.offset_dias),
        template_name: String(d.template_name).trim(),
        template_language:
          typeof d.template_language === 'string' ? d.template_language : null,
        template_vars:
          typeof d.template_vars === 'object' && d.template_vars !== null
            ? d.template_vars
            : {},
        hora_do_dia: typeof d.hora_do_dia === 'string' ? d.hora_do_dia : '09:00',
        flow_id: typeof d.flow_id === 'string' && d.flow_id ? d.flow_id : null,
        is_active: d.is_active !== false,
      }))
      const { error } = await supabase
        .from('regua_degraus')
        .upsert(linhas, { onConflict: 'id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, regua_id: reguaId })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function posInt(raw: unknown, padrao: number, minimo = 1): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= minimo ? n : padrao
}
