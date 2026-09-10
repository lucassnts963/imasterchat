// ============================================================
// POST /api/v1/cobrancas/{id_externo}/pagamento — a baixa.
//
// O endpoint irmão do webhook genérico, e o que dá parada em SEGUNDOS a
// quem não tem webhook de plataforma. Sem ele existe uma janela de erro
// igual ao intervalo de varredura: alguém que pagou às 9h05 ainda pode
// receber cobrança às 9h30. Aceitável a uma hora, constrangedor a 24.
//
// O id na URL é o do SISTEMA DE ORIGEM, não o nosso: quem chama é ele, e
// ele não conhece o nosso.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { registrarPagamento } from '@/lib/integrations/upsert'
import { parseValor, parseVencimento } from '@/lib/integrations/normalize'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, 'cobrancas:write')
    const { id } = await context.params
    const idExterno = decodeURIComponent(id ?? '').trim()
    if (!idExterno) return fail('bad_request', 'id is required', 400)

    const body = (await request.json().catch(() => null)) as {
      origem?: unknown
      pago_em?: unknown
      valor_pago?: unknown
    } | null

    const origem =
      typeof body?.origem === 'string' && body.origem.trim()
        ? body.origem.trim().slice(0, 60)
        : 'webhook'

    const baixou = await registrarPagamento(ctx.supabase, {
      accountId: ctx.accountId,
      origem,
      idExterno,
      pagoEm: parseVencimento(body?.pago_em),
      valorPago: parseValor(body?.valor_pago),
    })

    // 404 e não 500: "não existe aqui" é uma resposta legítima — a
    // cobrança pode nunca ter sido empurrada — e quem chama precisa
    // distinguir isso de uma falha nossa.
    if (!baixou) return fail('not_found', 'cobranca not found', 404)

    return ok({ id_externo: idExterno, origem, status: 'paga' })
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
