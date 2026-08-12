import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { drainWebhookEvents } from '@/app/api/whatsapp/webhook/route'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { drainBroadcasts } from '@/lib/broadcast/drain'
import { sweepQueueSla } from '@/lib/queues/sla'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
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

  // A rede para o que ficou para trás.
  //
  // O dreno acontece na própria requisição do webhook; isto aqui só pega
  // o que sobrou quando uma execução morreu no meio, ou um evento que
  // falhou e foi solto para nova tentativa. Roda ANTES das automações
  // porque mensagem parada na fila é mais urgente que automação
  // atrasada — e porque um evento drenado agora pode ser justamente o
  // gatilho de uma automação.
  let drained = { processed: 0, failed: 0 }
  try {
    drained = await drainWebhookEvents(200)
    if (drained.processed || drained.failed) {
      console.log(
        `[cron] fila de webhook: ${drained.processed} drenados, ${drained.failed} falharam`,
      )
    }
  } catch (err) {
    // Não derruba o resto do cron: as automações não dependem disto.
    console.error('[cron] dreno da fila de webhook falhou:', err)
  }

  // A fila de espera da IA.
  //
  // Conversas que não couberam no teto de concorrência estão marcadas
  // com `ai_pending_since`. Reprocessar é só chamar o mesmo dispatch de
  // novo: ele relê tudo da conversa, e o portão decide outra vez —
  // agora talvez com vaga, ou já com espera demais, e aí transfere.
  //
  // É esta varredura que transforma "não coube" em "vai ser respondido
  // de um jeito ou de outro". Sem ela, a marcação seria só um carimbo
  // bonito numa conversa esquecida.
  let retried = 0
  try {
    const { data: waiting } = await admin
      .from('conversations')
      .select('id, account_id, contact_id, user_id')
      .not('ai_pending_since', 'is', null)
      .order('ai_pending_since', { ascending: true })
      .limit(100)

    for (const c of (waiting ?? []) as Array<{
      id: string
      account_id: string
      contact_id: string
      user_id: string
    }>) {
      await dispatchInboundToAiReply({
        accountId: c.account_id,
        conversationId: c.id,
        contactId: c.contact_id,
        configOwnerUserId: c.user_id,
      })
      retried++
    }
    if (retried) console.log(`[cron] fila da IA: ${retried} conversa(s) retomada(s)`)
  } catch (err) {
    console.error('[cron] varredura da fila da IA falhou:', err)
  }

  // O disparo em massa, agora do lado do servidor.
  //
  // Antes ele rodava no navegador de quem clicou: fechar a aba
  // interrompia o envio pela metade, sem retomada e sem aviso. Retomar é
  // de graça aqui porque o estado já está em broadcast_recipients.status
  // — "o que falta" é uma consulta, não um ponteiro que pode se perder.
  let broadcastRun = { broadcasts: 0, sent: 0, failed: 0 }
  try {
    broadcastRun = await drainBroadcasts(admin)
    if (broadcastRun.sent || broadcastRun.failed) {
      console.log(
        `[cron] disparos: ${broadcastRun.sent} enviados, ${broadcastRun.failed} falharam`,
      )
    }
  } catch (err) {
    console.error('[cron] dreno de disparos falhou:', err)
  }

  // O relógio das filas humanas.
  //
  // A fila da IA já se resolve sozinha (espera, e passando do prazo vira
  // gente). Do lado das pessoas não havia nada: uma conversa no
  // Financeiro podia ficar a tarde inteira e o sistema estava
  // tecnicamente correto o tempo todo.
  let sla = { checked: 0, alerted: 0 }
  try {
    sla = await sweepQueueSla(admin)
    if (sla.alerted) console.log(`[cron] SLA: ${sla.alerted} conversa(s) parada(s)`)
  } catch (err) {
    console.error('[cron] varredura de SLA falhou:', err)
  }

  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0)
    return NextResponse.json({ processed: 0, webhook_queue: drained, ai_retried: retried, broadcasts: broadcastRun, sla })

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  return NextResponse.json({ processed })
}
