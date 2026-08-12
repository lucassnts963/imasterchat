import type { SupabaseClient } from '@supabase/supabase-js'

import { estimateCostUsd } from './pricing'

// ============================================================
// O portão de entrada da IA: cabe agora, espera, ou vira gente?
//
// A regra que este arquivo implementa foi dita assim por quem opera:
// "melhor uma mensagem que demorou a ser respondida do que alguém que
// ficou sem resposta". Daí as três saídas, nesta ordem:
//
//   coube      responde agora
//   não coube  espera na fila, e o cron tenta de novo
//   esperou    demais → chama uma pessoa
//
// O que NÃO é uma saída: desistir. Uma conversa que entra aqui sai por
// uma das três, sempre.
// ============================================================

export type GateOutcome =
  | { kind: 'go' }
  | { kind: 'wait'; waitedSeconds: number }
  | { kind: 'handoff'; waitedSeconds: number; reason: 'timeout' | 'budget' }

export interface GateInput {
  db: SupabaseClient
  accountId: string
  conversationId: string
  concurrencyLimit: number
  maxWaitSeconds: number
  /** Já estourou o orçamento do mês? */
  budgetExceeded: boolean
  /** 'block_and_handoff' | 'notify_only' */
  budgetAction: string
  /** `conversations.ai_pending_since`, se já estava esperando. */
  pendingSince: string | null
}

/**
 * Decide, e reserva a vaga quando a resposta é "pode ir".
 *
 * Quem chama é responsável por soltar a vaga (`releaseAiSlot`) quando
 * terminar — inclusive em erro. Uma vaga não devolvida some sozinha
 * depois de 2 minutos, mas contar com isso deixaria o teto menor do que
 * o configurado durante esse tempo.
 */
export async function passAiGate(input: GateInput): Promise<GateOutcome> {
  const waitedSeconds = input.pendingSince
    ? Math.max(
        0,
        Math.round((Date.now() - new Date(input.pendingSince).getTime()) / 1000),
      )
    : 0

  // O orçamento vem primeiro: não adianta entrar na fila para gastar o
  // que já acabou. E o padrão é bloquear porque a alternativa é o
  // cliente descobrir o limite pela fatura.
  if (input.budgetExceeded && input.budgetAction === 'block_and_handoff') {
    return { kind: 'handoff', waitedSeconds, reason: 'budget' }
  }

  // Esperou o bastante? Vira assunto de gente. Esta checagem vem ANTES
  // da tentativa de vaga de propósito: numa fila que anda devagar,
  // tentar de novo antes de conferir o relógio faria a conversa passar
  // do prazo por mais uma rodada.
  if (waitedSeconds >= input.maxWaitSeconds) {
    return { kind: 'handoff', waitedSeconds, reason: 'timeout' }
  }

  const { data, error } = await input.db.rpc('claim_ai_slot', {
    p_account_id: input.accountId,
    p_conversation_id: input.conversationId,
    p_limit: input.concurrencyLimit,
  })

  if (error) {
    // Falha ao consultar o teto não pode virar silêncio. Deixa passar:
    // o risco é um 429 do provedor, que é ruim; o risco de barrar é
    // cliente sem resposta, que é pior.
    console.error('[ai gate] claim_ai_slot falhou, liberando:', error)
    return { kind: 'go' }
  }

  return data === true ? { kind: 'go' } : { kind: 'wait', waitedSeconds }
}

export async function releaseAiSlot(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  try {
    await db.rpc('release_ai_slot', { p_conversation_id: conversationId })
  } catch (err) {
    // A vaga expira sozinha em 2 minutos; registrar basta.
    console.error('[ai gate] release_ai_slot falhou:', err)
  }
}

/**
 * Entra na fila de espera.
 *
 * Só carimba quem ainda não estava marcado (`.is(..., null)`).
 * Sobrescrever o carimbo a cada tentativa zeraria o relógio da espera, e
 * a conversa nunca atingiria o prazo — ficaria esperando para sempre,
 * que é exatamente o que este mecanismo existe para impedir.
 */
export async function markPending(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  try {
    await db
      .from('conversations')
      .update({ ai_pending_since: new Date().toISOString() })
      .eq('id', conversationId)
      .is('ai_pending_since', null)
  } catch (err) {
    console.error('[ai gate] markPending falhou:', err)
  }
}

/** Sai da fila — respondeu, transferiu, ou desistiu. */
export async function clearPending(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  try {
    await db
      .from('conversations')
      .update({ ai_pending_since: null })
      .eq('id', conversationId)
      .not('ai_pending_since', 'is', null)
  } catch (err) {
    console.error('[ai gate] clearPending falhou:', err)
  }
}

/**
 * Quanto a conta já gastou no mês corrente, em dólares.
 *
 * `ai_usage_log` guarda TOKENS, não custo — o preço muda e reescrever o
 * histórico a cada mudança seria pior. O dólar sai de `estimateCostUsd`,
 * a MESMA função que a tela de Custos usa: duas fórmulas divergiriam, e
 * a divergência apareceria como "a tela diz que sobra e o bot parou".
 *
 * Paginado porque o teto de linhas do PostgREST corta em 1000 sem
 * avisar. Foi exatamente assim que a tela de Custos passou a mostrar o
 * gasto das 1000 chamadas mais recentes como se fosse o total do mês —
 * e um bloqueio de orçamento com esse defeito nunca dispararia numa
 * conta movimentada, que é justamente a que precisa dele.
 */
export async function monthSpendUsd(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)

  let total = 0
  const PAGE = 500
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('ai_usage_log')
      .select('model, prompt_tokens, completion_tokens')
      .eq('account_id', accountId)
      .gte('created_at', start.toISOString())
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    for (const row of data as Array<{
      model: string
      prompt_tokens: number
      completion_tokens: number
    }>) {
      total += estimateCostUsd(row.model, row.prompt_tokens, row.completion_tokens).usd
    }
    if (data.length < PAGE) break
  }
  return total
}
