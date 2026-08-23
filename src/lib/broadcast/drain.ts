import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { MetaError, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import type { Contact, MessageTemplate } from '@/types'
import {
  fetchCustomValueIndex,
  resolveVariables,
  type VariableMapping,
} from './variables'

// ============================================================
// O disparo passa a sair do SERVIDOR.
//
// Ele rodava inteiro no navegador de quem clicou: um laço dentro de um
// hook `'use client'`. Isso significava que fechar a aba interrompia o
// envio pela metade, que a rede do atendente virava variável do produto,
// e que não havia retomada — os destinatários que faltavam simplesmente
// não recebiam, sem nada dizer.
//
// Agora o navegador cria o disparo e os destinatários, marca como
// `sending`, e vai embora. Quem envia é este dreno, chamado pelo cron a
// cada 5 minutos. Fechar a aba deixou de significar nada.
//
// Retomar é de graça e é a razão do desenho: o estado do envio já está
// em `broadcast_recipients.status`. "O que falta" é uma consulta —
// `status = 'pending'` — e não um ponteiro guardado em algum lugar que
// pode se perder.
// ============================================================

/**
 * Quantos destinatários por execução do cron.
 *
 * O par 10-por-lote + 1s de pausa (abaixo) é o mesmo ritmo que o
 * navegador usava e que mantém a conta longe do teto de 80 msg/s da
 * Meta. 200 por rodada, a cada 5 minutos, drena 3.000 destinatários em
 * pouco mais de uma hora — sem ninguém precisar ficar com a aba aberta.
 */
const PER_RUN = 200
const SEND_BATCH = 10
const BATCH_PAUSE_MS = 1000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface BroadcastRow {
  id: string
  account_id: string
  template_name: string
  template_language: string
  template_variables: Record<string, VariableMapping> | null
}

interface RecipientRow {
  id: string
  contact: Contact | null
}

/**
 * Envia o próximo lote de cada disparo em andamento.
 *
 * Best-effort por disparo: um que falhe não impede os outros. Devolve o
 * que fez para o cron registrar.
 */
export async function drainBroadcasts(
  db: SupabaseClient,
): Promise<{ broadcasts: number; sent: number; failed: number }> {
  const summary = { broadcasts: 0, sent: 0, failed: 0 }

  const { data: active } = await db
    .from('broadcasts')
    .select('id, account_id, template_name, template_language, template_variables')
    .eq('status', 'sending')
    .order('created_at', { ascending: true })
    .limit(5)

  for (const broadcast of (active ?? []) as BroadcastRow[]) {
    summary.broadcasts++
    try {
      const result = await drainOne(db, broadcast)
      summary.sent += result.sent
      summary.failed += result.failed
    } catch (err) {
      console.error(`[broadcast] disparo ${broadcast.id} falhou:`, err)
    }
  }

  return summary
}

async function drainOne(
  db: SupabaseClient,
  broadcast: BroadcastRow,
): Promise<{ sent: number; failed: number }> {
  const { data: pending } = await db
    .from('broadcast_recipients')
    .select('id, contact:contacts(*)')
    .eq('broadcast_id', broadcast.id)
    .eq('status', 'pending')
    // Ordem estável: sem ela duas execuções podem pegar a mesma linha e
    // o mesmo cliente recebe duas vezes.
    .order('id', { ascending: true })
    .limit(PER_RUN)

  const rows = (pending ?? []) as unknown as RecipientRow[]

  if (rows.length === 0) {
    // Acabou. Fecha o disparo — é isto que faz a tela parar de dizer
    // "enviando" para sempre depois de um envio concluído.
    await db
      .from('broadcasts')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', broadcast.id)
      .eq('status', 'sending')
    return { sent: 0, failed: 0 }
  }

  const { data: config } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', broadcast.account_id)
    .maybeSingle<{ phone_number_id: string; access_token: string }>()

  if (!config) {
    // Sem WhatsApp configurado não há como continuar, e deixar em
    // `sending` para sempre esconderia o problema.
    await db
      .from('broadcasts')
      .update({ status: 'failed' })
      .eq('id', broadcast.id)
    return { sent: 0, failed: 0 }
  }

  const accessToken = decrypt(config.access_token)

  const { data: templateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', broadcast.account_id)
    .eq('name', broadcast.template_name)
    .maybeSingle<MessageTemplate>()

  const contactIds = rows
    .map((r) => r.contact?.id)
    .filter((id): id is string => Boolean(id))
  const customValues = await fetchCustomValueIndex(db, contactIds)

  let sent = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += SEND_BATCH) {
    const batch = rows.slice(i, i + SEND_BATCH)

    for (const row of batch) {
      const phone = row.contact?.phone
      if (!phone) {
        await markFailed(db, row.id, 'Contato sem telefone.')
        failed++
        continue
      }

      const params = broadcast.template_variables
        ? resolveVariables(
            broadcast.template_variables,
            row.contact as Contact,
            customValues.get(row.contact!.id),
          )
        : []

      try {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          templateName: broadcast.template_name,
          language: broadcast.template_language,
          template: templateRow ?? undefined,
          params,
        })
        await db
          .from('broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            whatsapp_message_id: result.messageId,
            error_message: null,
          })
          .eq('id', row.id)
        sent++
      } catch (err) {
        // Limite de vazão da Meta NÃO é falha do destinatário: a linha
        // fica `pending` e a próxima rodada do cron tenta de novo. Marcar
        // `failed` aqui — que era o comportamento antigo — significava
        // alguém não receber porque mandamos rápido demais, e nunca mais
        // ser tentado.
        if (err instanceof MetaError && err.isRateLimit) {
          console.warn(
            `[broadcast] limite da Meta no disparo ${broadcast.id}; o resto fica para a próxima rodada`,
          )
          return { sent, failed }
        }
        await markFailed(
          db,
          row.id,
          err instanceof Error ? err.message : 'Erro desconhecido',
        )
        failed++
      }
    }

    if (i + SEND_BATCH < rows.length) await sleep(BATCH_PAUSE_MS)
  }

  return { sent, failed }
}

async function markFailed(
  db: SupabaseClient,
  recipientId: string,
  message: string,
): Promise<void> {
  await db
    .from('broadcast_recipients')
    .update({ status: 'failed', error_message: message.slice(0, 500) })
    .eq('id', recipientId)
}
