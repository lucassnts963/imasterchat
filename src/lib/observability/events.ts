import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/admin/client'
import { esc, isTelegramConfigured, sendTelegramAlert } from './telegram'

// ============================================================
// Gravar que algo falhou — e avisar, quando vale acordar alguém.
//
// O contrato tem uma regra e ela não é negociável: NUNCA LANÇA. Isto é
// chamado de dentro de blocos catch, no caminho de uma falha que já
// aconteceu. Um gravador que lança transforma uma falha em duas e
// derruba o handler que estava tratando a primeira.
//
// A mesma promessa que `logAiUsage` e `recordAgentStep` já fazem. A
// diferença é que aqui ela tem um preço documentado: se o INSERT
// falhar, o evento some. O único jeito de saber disso é o stdout, e
// isso é aceito conscientemente — a alternativa seria fazer o
// tratamento de erro depender do banco estar de pé, que é exatamente o
// tipo de coisa que quebra quando tudo já está quebrando.
// ============================================================

export type EventSource =
  | 'ai'
  | 'whatsapp'
  | 'google'
  | 'cron'
  | 'billing'
  | 'scheduling'
  // Filas de atendimento: hoje só o alerta de SLA. Fonte própria e não
  // 'app' porque é o que permite filtrar "problemas de operação" —
  // conversa parada é assunto de quem atende, não de quem mantém o
  // sistema, e misturar as duas caixas faz as duas serem ignoradas.
  | 'queue'
  | 'app'

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface RecordEventInput {
  /** Nulo quando o evento não pertence a conta nenhuma — um webhook
   *  com phone_number_id desconhecido é o caso clássico. */
  accountId?: string | null
  source: EventSource
  /** Slug estável. Use o `code` que a origem já produziu tipado
   *  (`AiError.code`, `GoogleError.code`) em vez de inventar um. */
  code: string
  message: string
  severity?: EventSeverity
  context?: Record<string, unknown>
  conversationId?: string | null
  /** Cliente já disponível no call site; senão abre um service-role. */
  db?: SupabaseClient
}

/** Quanto tempo o mesmo (conta, code) fica em silêncio depois de um
 *  alerta. Sem isto, um provedor fora do ar por meia hora vira
 *  centenas de mensagens no celular — e um celular que apita demais é
 *  um celular que se ignora, que é o mesmo que não ter alerta. */
const ALERT_WINDOW_MS = 15 * 60 * 1000

/** Abaixo disso o evento é gravado mas não interrompe ninguém. */
const ALERT_FROM: EventSeverity = 'error'

const RANK: Record<EventSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
}

const EMOJI: Record<EventSeverity, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '🔴',
  critical: '🚨',
}

export async function recordEvent(input: RecordEventInput): Promise<void> {
  const severity = input.severity ?? 'error'

  // O stdout continua, e continua de propósito: é o que sobra quando o
  // Postgres é justamente quem caiu.
  const tag = `[event ${severity}] ${input.source}/${input.code}`
  if (RANK[severity] >= RANK.error) console.error(tag, input.message)
  else console.warn(tag, input.message)

  try {
    const db = input.db ?? supabaseAdmin()

    const shouldAlert =
      RANK[severity] >= RANK[ALERT_FROM] &&
      isTelegramConfigured() &&
      !(await recentlyAlerted(db, input.accountId ?? null, input.code))

    const { data, error } = await db
      .from('platform_events')
      .insert({
        account_id: input.accountId ?? null,
        kind: 'error',
        severity,
        source: input.source,
        code: input.code,
        message: input.message.slice(0, 2000),
        context: input.context ?? {},
        conversation_id: input.conversationId ?? null,
        // Marcado ANTES de o Telegram responder, de propósito: se duas
        // falhas chegam ao mesmo tempo, a segunda precisa ver que a
        // primeira já assumiu a janela. Perder um alerta é melhor que
        // mandar cem.
        alerted_at: shouldAlert ? new Date().toISOString() : null,
      })
      .select('id')
      .single<{ id: string }>()

    if (error) throw error

    if (shouldAlert) {
      void alert(db, { ...input, severity }, data.id)
    }
  } catch (err) {
    console.error('[event] não foi possível gravar o evento:', err)
  }
}

/**
 * Já avisamos sobre este mesmo problema nesta mesma conta há pouco?
 *
 * Deduplica por (conta, code) e não pelo texto: "invalid_key" da conta
 * A e da conta B são dois problemas, e merecem dois alertas. Duzentas
 * mensagens falhando na conta A com o mesmo motivo são um problema só.
 */
async function recentlyAlerted(
  db: SupabaseClient,
  accountId: string | null,
  code: string,
): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_WINDOW_MS).toISOString()
  let q = db
    .from('platform_events')
    .select('id')
    .eq('code', code)
    .not('alerted_at', 'is', null)
    .gte('created_at', since)
    .limit(1)

  q = accountId ? q.eq('account_id', accountId) : q.is('account_id', null)

  const { data, error } = await q
  // Em caso de erro, assume que NÃO avisamos. Um alerta a mais é
  // ruído; um alerta a menos é o telefonema do cliente.
  if (error) return false
  return (data?.length ?? 0) > 0
}

async function alert(
  db: SupabaseClient,
  input: RecordEventInput & { severity: EventSeverity },
  eventId: string,
): Promise<void> {
  const account = await accountLabel(db, input.accountId ?? null)
  const lines = [
    `${EMOJI[input.severity]} <b>${esc(input.code)}</b>`,
    `<b>Conta:</b> ${esc(account)}`,
    `<b>Onde:</b> ${esc(input.source)}`,
    '',
    esc(input.message.slice(0, 600)),
  ]

  const ctx = input.context ?? {}
  const extra = Object.entries(ctx)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 6)
  if (extra.length > 0) {
    lines.push('')
    for (const [k, v] of extra) {
      lines.push(`<b>${esc(k)}:</b> <code>${esc(v).slice(0, 120)}</code>`)
    }
  }

  lines.push('')
  lines.push(
    `<i>Silenciado por 15min para este mesmo erro nesta conta.</i>`,
    `<code>${esc(eventId)}</code>`,
  )

  await sendTelegramAlert(lines.join('\n'))
}

/** Nome da conta para o alerta. "a conta 8f3a-…" não diz a ninguém
 *  qual cliente está fora do ar; "Ótica Visão" diz. */
async function accountLabel(
  db: SupabaseClient,
  accountId: string | null,
): Promise<string> {
  if (!accountId) return 'plataforma (sem conta)'
  try {
    const { data } = await db
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .maybeSingle<{ name: string }>()
    return data?.name ? `${data.name}` : accountId
  } catch {
    return accountId
  }
}
