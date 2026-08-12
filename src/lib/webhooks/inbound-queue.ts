import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// A fila de entrada do webhook.
//
// Duas responsabilidades, e só duas: quebrar o lote da Meta em eventos
// individuais e gravá-los; e devolver os que faltam processar.
//
// O que ela deliberadamente NÃO faz é processar. O payload é guardado
// no formato que o processador já conhece, então o caminho de
// processamento continua sendo exatamente um — dois processadores
// divergem, e o segundo diverge em silêncio.
// ============================================================

/** O `value` de um change, com um único evento dentro. */
export type WebhookEventPayload = Record<string, unknown>

export interface PendingWebhookEvent {
  id: string
  kind: string
  payload: WebhookEventPayload
  attempts: number
}

interface RawChange {
  field?: string
  value?: {
    metadata?: { phone_number_id?: string }
    contacts?: unknown[]
    messages?: Array<{ id?: string }>
    statuses?: Array<{ id?: string; status?: string }>
    [key: string]: unknown
  }
}

interface RawBody {
  entry?: Array<{ id?: string; changes?: RawChange[] }>
}

interface QueuedRow {
  phone_number_id: string
  dedupe_key: string
  kind: string
  payload: WebhookEventPayload
}

/**
 * Quantos eventos um lote pode trazer.
 *
 * A Meta agrega notificações em lotes de ATÉ 1.000 por entrega
 * (documentação do Graph API). Isso não é teto nosso, é o dela — e o
 * insert precisa aguentar o pior caso sem estourar o corpo da
 * requisição ao PostgREST, daí o envio em blocos.
 */
const INSERT_CHUNK = 200

/**
 * Quebra o corpo da Meta em linhas prontas para gravar.
 *
 * Exportada para poder ser testada sem banco: é aqui que mora a chave de
 * idempotência, e é a parte que, errada, duplica mensagem na conversa do
 * cliente ou faz o status parar de avançar.
 */
export function splitWebhookBody(body: unknown): QueuedRow[] {
  const rows: QueuedRow[] = []
  const entries = (body as RawBody)?.entry
  if (!Array.isArray(entries)) return rows

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change?.value
      const field = change?.field ?? 'unknown'
      const phoneNumberId = value?.metadata?.phone_number_id

      // Eventos de template não têm `metadata.phone_number_id`: eles
      // chegam por WABA, não por número. Sem a primeira metade da chave,
      // guardá-los aqui seria inventar uma. Seguem pelo caminho direto,
      // como hoje — são raros, não são do cliente, e perder um significa
      // um status de template desatualizado até o próximo sync.
      if (!phoneNumberId) continue

      if (Array.isArray(value?.messages)) {
        for (const message of value.messages) {
          if (!message?.id) continue
          rows.push({
            phone_number_id: phoneNumberId,
            dedupe_key: `msg:${message.id}`,
            kind: 'messages',
            // Um evento por linha, com os contatos junto: o processador
            // casa `messages[i].from` com `contacts[]` para descobrir o
            // nome do perfil, e separar os dois quebraria isso.
            payload: {
              ...value,
              messages: [message],
              contacts: value.contacts ?? [],
            } as WebhookEventPayload,
          })
        }
      }

      if (Array.isArray(value?.statuses)) {
        for (const status of value.statuses) {
          if (!status?.id) continue
          rows.push({
            phone_number_id: phoneNumberId,
            // O status ENTRA na chave. Uma mesma mensagem gera sent →
            // delivered → read, os três com o mesmo wamid: sem isso, os
            // dois últimos seriam descartados como duplicata e a
            // mensagem ficaria eternamente "enviada".
            dedupe_key: `st:${status.id}:${status.status ?? 'unknown'}`,
            kind: 'statuses',
            payload: {
              ...value,
              statuses: [status],
              messages: undefined,
            } as WebhookEventPayload,
          })
        }
      }

      // Um change sem mensagem e sem status não tem o que enfileirar.
      // Cair aqui é normal (a Meta manda eventos que não usamos).
      void field
    }
  }

  return rows
}

/**
 * Grava os eventos. Devolve quantos eram novos.
 *
 * `ON CONFLICT DO NOTHING` via `upsert(..., { ignoreDuplicates: true })`:
 * uma reentrega da Meta encontra a restrição e não vira mensagem
 * repetida. Isso acontece de verdade — ela reentrega por até 7 dias
 * quando acha que falhamos, e para todos os apps inscritos na WABA.
 */
export async function enqueueWebhookEvents(
  db: SupabaseClient,
  body: unknown,
): Promise<{ queued: number; total: number }> {
  const rows = splitWebhookBody(body)
  if (rows.length === 0) return { queued: 0, total: 0 }

  let queued = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const { data, error } = await db
      .from('webhook_events')
      .upsert(chunk, {
        onConflict: 'phone_number_id,dedupe_key',
        ignoreDuplicates: true,
      })
      .select('id')
    if (error) {
      // Deixa subir: quem chama precisa saber que NÃO gravou, para não
      // responder 200 a algo que se perdeu. É o único ponto deste
      // arquivo onde falhar em silêncio seria pior que falhar alto.
      throw error
    }
    queued += data?.length ?? 0
  }

  return { queued, total: rows.length }
}

/**
 * Reivindica um lote para processar.
 *
 * A reivindicação é feita no banco (`claim_webhook_events`), com
 * `FOR UPDATE SKIP LOCKED`, para o dreno da requisição e o do cron
 * poderem rodar ao mesmo tempo sem pegar a mesma linha.
 */
export async function claimWebhookEvents(
  db: SupabaseClient,
  limit: number,
): Promise<PendingWebhookEvent[]> {
  const { data, error } = await db.rpc('claim_webhook_events', {
    p_limit: limit,
  })
  if (error) throw error
  return ((data ?? []) as Array<{
    id: string
    kind: string
    payload: WebhookEventPayload
    attempts: number
  }>).map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    attempts: r.attempts,
  }))
}

/** Deu certo: sai da fila. */
export async function markProcessed(
  db: SupabaseClient,
  id: string,
): Promise<void> {
  await db
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString(), last_error: null })
    .eq('id', id)
}

/**
 * Falhou: solta a reivindicação para outro dreno tentar.
 *
 * Sem teto de tentativas de propósito — por ora. Um evento que falha
 * sempre fica visível na profundidade da fila, que a ronda de saúde
 * vigia; desistir dele em silêncio seria recriar, dentro da solução, o
 * mesmo modo de falha que ela veio consertar.
 */
export async function releaseWithError(
  db: SupabaseClient,
  id: string,
  message: string,
): Promise<void> {
  await db
    .from('webhook_events')
    .update({ claimed_at: null, last_error: message.slice(0, 500) })
    .eq('id', id)
}

/** Quantos eventos estão esperando. É a métrica que a saúde vigia. */
export async function pendingWebhookDepth(
  db: SupabaseClient,
): Promise<{ pending: number; oldestSeconds: number | null }> {
  const { count } = await db
    .from('webhook_events')
    .select('id', { count: 'exact', head: true })
    .is('processed_at', null)

  const { data } = await db
    .from('webhook_events')
    .select('received_at')
    .is('processed_at', null)
    .order('received_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ received_at: string }>()

  return {
    pending: count ?? 0,
    oldestSeconds: data
      ? Math.round((Date.now() - new Date(data.received_at).getTime()) / 1000)
      : null,
  }
}
