import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { resumeHandoffPause } from '@/lib/flows/engine'

/**
 * POST /api/flows/runs/resume  — body: `{ contactId }`
 *
 * Devolve ao roteiro uma conversa que um fluxo pausou num `handoff`. É o
 * botão que a atendente aperta quando termina de resolver o que o robô
 * não sabia: sem ele, "quero negociar" tira a pessoa do fluxo e nada a
 * traz de volta — que era o buraco da cobrança.
 *
 * Endereçado pelo CONTATO, e não pelo id do run: quem clica está olhando
 * uma conversa e não sabe o que é um run. O índice parcial de um run
 * ativo por contato garante que existe no máximo um para devolver.
 *
 * `agent` basta. Quem atende a conversa é quem sabe que ela acabou; pedir
 * admin aqui empurraria a operação para quem não está na tela.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('agent')

    const body = (await request.json().catch(() => null)) as {
      contactId?: unknown
    } | null
    const contactId = typeof body?.contactId === 'string' ? body.contactId.trim() : ''
    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
    }

    const result = await resumeHandoffPause({ accountId, contactId })
    if (!result.resumed) {
      // "Não havia nada pausado" é 404 e não 500: é o estado normal de
      // uma conversa que nunca passou por um fluxo, e a tela precisa
      // distinguir isso de uma falha nossa.
      const status = result.reason === 'no_paused_run' ? 404 : 500
      return NextResponse.json({ error: result.reason }, { status })
    }
    return NextResponse.json({ ok: true, flow_run_id: result.flowRunId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
