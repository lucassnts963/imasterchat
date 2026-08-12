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
  queue: { id: string; name: string; sla_seconds: number | null } | null
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
): Promise<{ checked: number; alerted: number }> {
  const result = { checked: 0, alerted: 0 }

  const { data, error } = await db
    .from('conversation_queue_stays')
    .select(
      'id, account_id, conversation_id, entered_at, queue:queues!inner(id, name, sla_seconds)',
    )
    .is('left_at', null)
    .is('sla_alerted_at', null)
    .not('queues.sla_seconds', 'is', null)
    .order('entered_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[sla] leitura das estadas falhou:', error)
    return result
  }

  const now = Date.now()

  for (const stay of (data ?? []) as unknown as StayRow[]) {
    const sla = stay.queue?.sla_seconds
    if (!sla) continue
    result.checked++

    const waited = Math.round(
      (now - new Date(stay.entered_at).getTime()) / 1000,
    )
    if (waited < sla) continue

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
      message: `Conversa esperando há ${Math.round(waited / 60)} min na fila "${stay.queue?.name ?? '?'}".`,
      context: {
        queueId: stay.queue?.id ?? null,
        waitedSeconds: waited,
        slaSeconds: sla,
      },
    })
    result.alerted++
  }

  return result
}
