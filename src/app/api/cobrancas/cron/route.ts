import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/cobranca/admin-client'
import { runReguaForAccount } from '@/lib/cobranca/worker'

/**
 * GET /api/cobrancas/cron — a rodada da régua.
 *
 * Roda de hora em hora, não uma vez por dia, e a razão é a janela legal:
 * um degrau cuja hora cai fora dela é **adiado**, e quem o retoma é a
 * rodada seguinte. Uma rodada diária às 3h da manhã não mandaria nada,
 * nunca — a janela está fechada.
 *
 * Rodar várias vezes no mesmo dia é seguro por construção: a unicidade
 * parcial de `regua_disparos` garante um envio por (cobrança, degrau), e
 * a marca é gravada ANTES do envio.
 *
 * Auth: o mesmo `AUTOMATION_CRON_SECRET` das outras duas rondas, para o
 * operador ter um segredo só para provisionar.
 */
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

  const admin = supabaseAdmin()

  // Só as contas com régua ATIVA. Varrer todas as contas para descobrir
  // que quase nenhuma cobra seria pagar, de hora em hora, por uma
  // resposta que quase sempre é "nada a fazer".
  const { data: reguas, error } = await admin
    .from('reguas')
    .select('account_id')
    .eq('is_active', true)

  if (error) {
    console.error('[cobranca-cron] active ruler scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const contas = [...new Set(((reguas ?? []) as { account_id: string }[]).map((r) => r.account_id))]
  let enviados = 0
  let suprimidos = 0
  const porMotivo: Record<string, number> = {}

  for (const accountId of contas) {
    try {
      const out = await runReguaForAccount(admin, accountId)
      enviados += out.enviados
      suprimidos += out.suprimidos
      for (const [motivo, n] of Object.entries(out.porMotivo)) {
        porMotivo[motivo] = (porMotivo[motivo] ?? 0) + n
      }
    } catch (err) {
      // Uma conta que falha não pode levar as outras junto: a régua de um
      // cliente parar porque a de outro tem um template inválido seria o
      // pior tipo de acoplamento entre inquilinos.
      console.error('[cobranca-cron] account failed:', accountId, err)
    }
  }

  return NextResponse.json({
    contas: contas.length,
    enviados,
    suprimidos,
    por_motivo: porMotivo,
  })
}
