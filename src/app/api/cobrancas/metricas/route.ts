import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadMessagePrices } from '@/lib/whatsapp/message-prices'

/**
 * GET /api/cobrancas/metricas — o retorno por degrau.
 *
 * É o relatório que justifica a mensalidade, e o que permite ao cliente
 * **cortar o degrau que só gasta**. Sem ele a régua é um gerador de
 * mensagens sem prestação de contas.
 *
 * A atribuição é por janela temporal: um título pago dentro de 72h de um
 * disparo conta para aquele degrau. Isso **não é prova de causalidade** —
 * quem pagaria de qualquer jeito também entra — e a tela diz isso com
 * todas as letras. Um número honesto e ressalvado vale mais que um
 * número bonito em que ninguém confia depois da primeira conferência.
 */
const JANELA_ATRIBUICAO_MS = 72 * 3_600_000

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const { data: disparos } = await supabase
      .from('regua_disparos')
      .select('degrau_id, cobranca_id, resultado, motivo, disparado_em, message_id')
      .eq('account_id', accountId)
      .limit(50_000)

    const linhas = (disparos ?? []) as Array<{
      degrau_id: string
      cobranca_id: string
      resultado: string
      motivo: string | null
      disparado_em: string
      message_id: string | null
    }>

    if (linhas.length === 0) return NextResponse.json({ degraus: [] })

    const cobrancaIds = [...new Set(linhas.map((l) => l.cobranca_id))]
    const pagas = new Map<string, { pago_em: string | null; valor: number }>()
    for (let i = 0; i < cobrancaIds.length; i += 500) {
      const { data } = await supabase
        .from('cobrancas')
        .select('id, status, pago_em, valor')
        .in('id', cobrancaIds.slice(i, i + 500))
      for (const c of (data ?? []) as {
        id: string
        status: string
        pago_em: string | null
        valor: number | string
      }[]) {
        if (c.status === 'paga') {
          pagas.set(c.id, { pago_em: c.pago_em, valor: Number(c.valor) })
        }
      }
    }

    // O custo real das mensagens da régua, para o retorno não ser
    // estimado dos dois lados.
    const messageIds = linhas.map((l) => l.message_id).filter(Boolean) as string[]
    const custoPorMensagem = new Map<string, string | null>()
    for (let i = 0; i < messageIds.length; i += 500) {
      const { data } = await supabase
        .from('whatsapp_message_costs')
        .select('message_id, billable, pricing_category')
        .eq('account_id', accountId)
        .in('message_id', messageIds.slice(i, i + 500))
      for (const c of (data ?? []) as {
        message_id: string
        billable: boolean
        pricing_category: string | null
      }[]) {
        custoPorMensagem.set(c.message_id, c.billable ? c.pricing_category : null)
      }
    }
    const prices = await loadMessagePrices(supabase)

    const porDegrau = new Map<
      string,
      {
        degrau_id: string
        enviados: number
        suprimidos: number
        recuperados: number
        valor_recuperado: number
        custo_usd: number
      }
    >()

    for (const l of linhas) {
      const b = porDegrau.get(l.degrau_id) ?? {
        degrau_id: l.degrau_id,
        enviados: 0,
        suprimidos: 0,
        recuperados: 0,
        valor_recuperado: 0,
        custo_usd: 0,
      }
      if (l.resultado === 'suprimido') {
        b.suprimidos += 1
      } else {
        b.enviados += 1
        const paga = pagas.get(l.cobranca_id)
        if (paga?.pago_em) {
          const dt = Date.parse(`${paga.pago_em}T12:00:00Z`) - Date.parse(l.disparado_em)
          if (dt >= 0 && dt <= JANELA_ATRIBUICAO_MS) {
            b.recuperados += 1
            b.valor_recuperado += paga.valor
          }
        }
        if (l.message_id) {
          const categoria = custoPorMensagem.get(l.message_id)
          if (categoria) b.custo_usd += prices.priceOf(categoria)
        }
      }
      porDegrau.set(l.degrau_id, b)
    }

    return NextResponse.json({
      degraus: [...porDegrau.values()].sort((a, b) => b.enviados - a.enviados),
      janela_atribuicao_horas: 72,
      ressalva:
        'Atribuição por janela temporal: um título pago em até 72h de um disparo conta para aquele degrau. Não é prova de causalidade — quem pagaria de qualquer jeito também entra na conta.',
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
