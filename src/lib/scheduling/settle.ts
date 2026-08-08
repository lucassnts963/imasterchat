import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// O agendamento que já passou deixa de ser "agendado".
//
// `idx_appointments_one_live_per_contact` é UNIQUE (contact_id) WHERE
// status = 'scheduled'. A intenção é "um compromisso VIVO por cliente",
// e ela está certa — impede o modelo de marcar dois para a mesma
// pessoa. O que faltava era alguém aposentar os que já aconteceram.
//
// Sem isso, o primeiro agendamento de um cliente vira permanente: passa
// a hora, a linha continua `scheduled`, e toda tentativa futura de
// marcar bate no índice. O bot responde "você já tem um agendamento" —
// sobre um compromisso da semana passada. Verificado em produção: um
// INSERT para daqui a dois dias foi recusado por causa de uma linha de
// cinco dias atrás.
//
// Não dá para resolver no índice. `WHERE starts_at > now()` não é
// aceito num índice parcial: `now()` não é imutável, e o Postgres se
// recusa a indexar algo cuja condição muda sozinha com o tempo. Então a
// transição precisa ser um ato, e um ato precisa de alguém que o faça.
//
// `completed` e não `no_show`: a diferença entre "veio" e "não veio" é
// informação que só a equipe tem, e inventá-la seria pior do que não
// registrá-la. `completed` aqui significa "o horário passou", que é a
// única coisa que o servidor sabe de fato.
// ============================================================

/**
 * Folga depois do fim antes de aposentar.
 *
 * Um compromisso que termina às 15:00 não é passado às 15:00 — a equipe
 * pode estar terminando, e remarcar durante o próprio atendimento é um
 * caso real. Uma hora é o suficiente para não atrapalhar e curto o
 * bastante para não travar o cliente que quer remarcar no mesmo dia.
 */
const GRACE_MINUTES = 60

export interface SettleResult {
  settled: number
}

/**
 * Aposenta os compromissos cujo horário já passou.
 *
 * Roda no ciclo do cron, junto da ronda de saúde. Idempotente: mexe só
 * no que ainda está `scheduled`, então repetir não custa nada e perder
 * um ciclo só adia.
 */
export async function settlePastAppointments(
  db: SupabaseClient,
  options: { accountId?: string; now?: Date } = {},
): Promise<SettleResult> {
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - GRACE_MINUTES * 60_000)

  let query = db
    .from('appointments')
    .update({ status: 'completed' })
    .eq('status', 'scheduled')
    .lt('ends_at', cutoff.toISOString())
    .select('id')
  if (options.accountId) query = query.eq('account_id', options.accountId)

  const { data, error } = await query
  if (error) {
    // Não lança: quem chama é o cron, e uma varredura que falha não
    // pode derrubar as outras do mesmo ciclo. O log é o sinal.
    console.error('[scheduling] settle past appointments failed:', error)
    return { settled: 0 }
  }
  return { settled: (data ?? []).length }
}
