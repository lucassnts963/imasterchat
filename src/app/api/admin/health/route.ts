import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

// ============================================================
// GET /api/admin/health (platform admin) — como está tudo agora
//
// Duas coisas que valem explicar:
//
// A FRESCURA DO CRON É CALCULADA AQUI, na leitura, e não gravada pela
// própria ronda. Um cron que parou não consegue relatar a própria
// ausência: se ele é quem escreve "estou vivo", o silêncio dele é
// indistinguível de nunca ter sido configurado. Comparar o carimbo
// contra o relógio no momento em que ALGUÉM OLHA é o único lugar onde
// existe quem receba a resposta.
//
// E "nunca rodou" é reportado como problema, não como vazio. Uma tela
// sem linhas parece saudável, e é exatamente o que se vê quando a
// verificação nunca foi ligada.
// ============================================================

/** A ronda é de hora em hora; com o dobro de folga, atrasou. */
const STALE_MS = 2 * 60 * 60 * 1000

interface HealthRow {
  account_id: string | null
  check_name: string
  status: 'ok' | 'failing' | 'skipped'
  code: string | null
  detail: string | null
  checked_at: string
  failing_since: string | null
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount({ allowBlocked: true })
    if (!ctx.isPlatformAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { supabase } = ctx

    const { data, error } = await supabase
      .from('account_health')
      .select(
        'account_id, check_name, status, code, detail, checked_at, failing_since',
      )
      .order('checked_at', { ascending: false })
      .limit(500)
    if (error) throw error

    const rows = (data ?? []) as HealthRow[]

    const ids = [
      ...new Set(rows.map((r) => r.account_id).filter((v): v is string => !!v)),
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

    const cronRow = rows.find(
      (r) => r.check_name === 'cron' && r.account_id === null,
    )
    const cronAge = cronRow
      ? Date.now() - new Date(cronRow.checked_at).getTime()
      : null

    const cron =
      cronAge === null
        ? {
            status: 'failing' as const,
            code: 'never_ran',
            detail:
              'A ronda de verificação nunca rodou. Sem ela, nada é detectado antes de alguém tentar usar — confira o sidecar de cron e AUTOMATION_CRON_SECRET.',
          }
        : cronAge > STALE_MS
          ? {
              status: 'failing' as const,
              code: 'stale',
              detail: `A última ronda foi há ${Math.round(cronAge / 60000)} minutos. Deveria ser de hora em hora.`,
            }
          : { status: 'ok' as const, detail: cronRow?.detail ?? null }

    return NextResponse.json({
      // A ronda em si não entra na lista: ela vira o objeto `cron`,
      // avaliado contra o relógio acima.
      checks: rows.filter((r) => r.check_name !== 'cron'),
      accountNames: names,
      cron: { ...cron, checked_at: cronRow?.checked_at ?? null },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
