import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/admin/client'
import {
  checkAccount,
  checkPlatform,
  persistCheck,
} from '@/lib/observability/health'
import { settlePastAppointments } from '@/lib/scheduling/settle'
import { purgeExpiredLogs } from '@/lib/observability/retention'

// ============================================================
// GET /api/health/cron — a ronda
//
// Roda de hora em hora pelo mesmo sidecar que já chama as outras
// rotas agendadas, com o MESMO segredo: um operador guarda um
// segredo, não uma coleção deles.
//
// Isto é o que separa "descubro quando alguém tenta" de "descubro
// antes". A chave da IA que vence às 3h da manhã e o Google revogado
// no domingo não geram falha nenhuma até segunda-feira, quando o
// primeiro a descobrir é o cliente.
//
// Em série e com teto por execução. Não há pressa nenhuma aqui, e a
// verificação disparando dezenas de chamadas simultâneas a APIs de
// terceiros seria o tipo de coisa que vira o motivo do rate limit que
// ela deveria detectar.
// ============================================================

/** Teto por execução. De hora em hora, cobre 600 contas por dia com
 *  folga, e mantém uma execução dentro do tempo de vida da requisição. */
const MAX_ACCOUNTS_PER_RUN = 25

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

  const db = supabaseAdmin()

  try {
    // Antes das verificações: um compromisso que já passou e continua
    // `scheduled` trava o índice de "um vivo por cliente" e impede
    // aquele contato de agendar de novo — para sempre. Aposentar é
    // barato e a ronda já roda de hora em hora.
    const settled = await settlePastAppointments(db)

    // A faxina pega carona nesta ronda em vez de virar um agendador
    // novo: mais um endpoint agendado é mais uma coisa para alguém
    // esquecer de configurar num deploy novo, e a periodicidade de hora
    // em hora é folgada para o que ela faz.
    const retention = await purgeExpiredLogs(db)

    const platform = await checkPlatform(db)

    // Ordem de rodízio: a conta verificada há mais tempo vai primeiro.
    // Com mais contas que o teto, todas acabam sendo cobertas em vez
    // de as primeiras da lista monopolizarem a ronda.
    const { data: accounts, error } = await db
      .from('accounts')
      .select('id')
      .limit(500)
    if (error) throw error

    const { data: health } = await db
      .from('account_health')
      .select('account_id, checked_at')
      .not('account_id', 'is', null)

    const lastSeen = new Map<string, number>()
    for (const row of (health ?? []) as {
      account_id: string
      checked_at: string
    }[]) {
      const at = new Date(row.checked_at).getTime()
      // A verificação mais ANTIGA da conta define a posição dela: uma
      // conta cujo Google foi checado agora mas cuja chave de IA não é
      // olhada há um dia continua sendo uma conta atrasada.
      const current = lastSeen.get(row.account_id)
      if (current === undefined || at < current) {
        lastSeen.set(row.account_id, at)
      }
    }

    const queue = ((accounts ?? []) as { id: string }[])
      .sort((a, b) => (lastSeen.get(a.id) ?? 0) - (lastSeen.get(b.id) ?? 0))
      .slice(0, MAX_ACCOUNTS_PER_RUN)

    let failing = 0
    for (const account of queue) {
      const results = await checkAccount(db, account.id)
      failing += Object.values(results).filter(
        (r) => r.status === 'failing',
      ).length
    }

    // O carimbo que prova que a ronda aconteceu. É lido na tela de
    // admin, e é o único jeito de detectar um cron que parou — porque
    // um cron parado não consegue relatar a própria ausência.
    // Pelo mesmo helper das outras, e não por upsert: a linha de
    // plataforma tem `account_id` nulo, e ON CONFLICT não enxerga o
    // índice parcial que garante a unicidade dela.
    await persistCheck(db, null, 'cron', {
      status: 'ok',
      detail: `${queue.length} conta(s) verificada(s).`,
    })

    return NextResponse.json({
      checked: queue.length,
      pending: Math.max(0, (accounts?.length ?? 0) - queue.length),
      failing,
      platform,
      appointments_settled: settled.settled,
      retention,
    })
  } catch (err) {
    console.error('[health cron] varredura falhou:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
