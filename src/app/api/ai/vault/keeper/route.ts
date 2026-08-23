import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sweepVault } from '@/lib/ai/vault/sweep'

// ============================================================
// GET  /api/ai/vault/keeper   (cron, todas as contas)
// POST /api/ai/vault/keeper   (a conta logada, sob demanda)
//
// Varre conversas que ficaram caladas e deixa o keeper decidir o que o
// wiki aprende de cada uma.
//
// Uma varredura, e não um gancho em "conversa encerrada", porque a
// maioria das conversas nunca é encerrada — elas só param. Esperar o
// encerramento explícito seria aprender com a minoria organizada e
// perder o resto, que é quase tudo.
//
// O GET compartilha o AUTOMATION_CRON_SECRET com as outras rotas
// agendadas, para o operador guardar um segredo e não uma coleção.
//
// O POST existe porque "não gerou nenhuma página" e "está quebrado" são
// indistinguíveis de fora quando a única execução é de madrugada. Ele
// roda na hora, só na conta de quem clicou, e devolve por que o número
// deu no que deu.
// ============================================================

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sweepVault(supabaseAdmin())
    return NextResponse.json({
      considered: result.considered,
      ran: result.ran,
      pages_proposed: result.pagesProposed,
      skipped: result.skipped,
    })
  } catch {
    return NextResponse.json({ error: 'query failed' }, { status: 500 })
  }
}

export async function POST() {
  try {
    // `admin`: a varredura gasta a chave de provedor da conta, e quem
    // paga a conta é quem decide quando gastá-la.
    const { accountId } = await requireRole('admin')

    // Cliente de serviço, não o do usuário: o keeper escreve em
    // `ai_vault_sources` e `ai_vault_revisions` por conta própria, e
    // amarrá-lo às políticas de quem clicou faria o resultado depender
    // do papel do clicador. O `accountId` acima é o que limita o
    // alcance — a varredura nunca sai desta conta.
    const result = await sweepVault(supabaseAdmin(), { accountId })

    return NextResponse.json({
      considered: result.considered,
      ran: result.ran,
      pages_proposed: result.pagesProposed,
      skipped: result.skipped,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
