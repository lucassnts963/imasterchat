import type { SupabaseClient } from '@supabase/supabase-js'

import { recordEvent } from '@/lib/observability/events'

// ============================================================
// O vigia da fila.
//
// A fila da IA já garante que ninguém fica sem resposta do lado do robô:
// espera, e passando do prazo vira gente. Do lado das PESSOAS não havia
// nada — uma conversa transferida para o Financeiro podia ficar ali a
// tarde inteira, e o sistema estava tecnicamente correto o tempo todo.
//
// Este arquivo é o relógio que faltava. Ele não resolve o atraso; ele o
// torna impossível de não notar, que é a única coisa que software pode
// fazer a respeito.
// ============================================================

interface StayRow {
  id: string
  account_id: string
  conversation_id: string
  entered_at: string
  entered_by_overflow: boolean
  queue: {
    id: string
    name: string
    sla_seconds: number | null
    overflow_queue_id: string | null
    overflow_after_seconds: number | null
  } | null
}

/**
 * Avisa sobre conversas paradas além do SLA da fila.
 *
 * Um aviso por PASSAGEM, não por conversa: quem passa duas vezes pelo
 * Financeiro merece dois avisos. E um por passagem também é o teto — o
 * `sla_alerted_at` impede que a mesma espera vire um alerta a cada
 * cinco minutos até alguém atender, que é como se ensina uma equipe a
 * ignorar alertas.
 */
export async function sweepQueueSla(
  db: SupabaseClient,
): Promise<{ checked: number; alerted: number; overflowed: number }> {
  const result = { checked: 0, alerted: 0, overflowed: 0 }

  const { data, error } = await db
    .from('conversation_queue_stays')
    .select(
      'id, account_id, conversation_id, entered_at, entered_by_overflow, sla_alerted_at, queue:queues!inner(id, name, sla_seconds, overflow_queue_id, overflow_after_seconds)',
    )
    .is('left_at', null)
    .order('entered_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[sla] leitura das estadas falhou:', error)
    return result
  }

  const now = Date.now()

  for (const stay of (data ?? []) as unknown as StayRow[]) {
    const q = stay.queue
    if (!q) continue
    result.checked++

    const waited = Math.round(
      (now - new Date(stay.entered_at).getTime()) / 1000,
    )

    // TRANSBORDO primeiro.
    //
    // Avisar e mover são decisões diferentes, e a ordem entre elas
    // importa: se a conversa já passou do prazo de transbordo, movê-la é
    // mais útil que avisar sobre uma fila de onde ela está saindo.
    //
    // Um salto só. Com A → B e B → A configurados, uma conversa ficaria
    // circulando para sempre — movimento que parece atendimento e é
    // abandono.
    if (
      q.overflow_queue_id &&
      q.overflow_after_seconds &&
      waited >= q.overflow_after_seconds &&
      !stay.entered_by_overflow
    ) {
      const moved = await overflow(db, stay, q.overflow_queue_id)
      if (moved) {
        result.overflowed++
        continue
      }
    }

    const sla = q.sla_seconds
    if (!sla) continue
    if (waited < sla) continue
    if ((stay as { sla_alerted_at?: string | null }).sla_alerted_at) continue

    // Carimba ANTES de avisar.
    //
    // Se o aviso falhar (Telegram fora do ar, por exemplo), o pior que
    // acontece é um atraso não avisado. Na ordem inversa, um erro depois
    // do aviso deixaria a estada sem carimbo e o mesmo alerta sairia a
    // cada cinco minutos — e alerta repetido é alerta ignorado.
    const { error: stampErr } = await db
      .from('conversation_queue_stays')
      .update({ sla_alerted_at: new Date().toISOString() })
      .eq('id', stay.id)
      .is('sla_alerted_at', null)

    if (stampErr) {
      console.error('[sla] falha ao carimbar a estada:', stampErr)
      continue
    }

    await recordEvent({
      db,
      accountId: stay.account_id,
      conversationId: stay.conversation_id,
      source: 'queue',
      code: 'sla_breached',
      // `warning` de propósito: é um problema de operação, não do
      // sistema. Como `error` entraria na mesma caixa de "algo quebrou",
      // e uma fila cheia num dia movimentado não é defeito.
      severity: 'warning',
      message: `Conversa esperando há ${Math.round(waited / 60)} min na fila "${q.name}".`,
      context: {
        queueId: q.id,
        waitedSeconds: waited,
        slaSeconds: sla,
      },
    })
    result.alerted++
  }

  return result
}

/**
 * Move a conversa para a fila de transbordo.
 *
 * Quem grava a PASSAGEM é o gatilho da 066, que vê `queue_id` mudar —
 * um caminho só para o histórico, venha o movimento de onde vier. Aqui
 * só marcamos a passagem nova como vinda de transbordo, que é o que
 * impede o segundo salto.
 *
 * Devolve `false` quando não deu; o alerta de SLA segue seu curso, para
 * a conversa não ficar sem transbordo E sem aviso.
 */
async function overflow(
  db: SupabaseClient,
  stay: StayRow,
  targetQueueId: string,
): Promise<boolean> {
  try {
    const { error } = await db
      .from('conversations')
      .update({ queue_id: targetQueueId, updated_at: new Date().toISOString() })
      .eq('id', stay.conversation_id)
      .eq('account_id', stay.account_id)
    if (error) throw error

    // A passagem nova já existe (o gatilho a criou). Marcá-la é o que
    // garante o salto único.
    await db
      .from('conversation_queue_stays')
      .update({ entered_by_overflow: true })
      .eq('conversation_id', stay.conversation_id)
      .is('left_at', null)

    await recordEvent({
      db,
      accountId: stay.account_id,
      conversationId: stay.conversation_id,
      source: 'queue',
      code: 'overflowed',
      severity: 'warning',
      message: `Ninguém pegou na fila "${stay.queue?.name ?? '?'}" — a conversa foi passada adiante.`,
      context: { fromQueueId: stay.queue?.id ?? null, toQueueId: targetQueueId },
    })
    return true
  } catch (err) {
    console.error('[sla] transbordo falhou:', err)
    return false
  }
}
