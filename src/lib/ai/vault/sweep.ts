import type { SupabaseClient } from '@supabase/supabase-js'
import { runVaultKeeper } from './keeper'

// ============================================================
// A varredura do keeper — a mesma para o cron e para o botão.
//
// Estava dentro da rota do cron. Saiu de lá quando a tela ganhou um
// "Rodar agora": duas cópias da regra de quais conversas entram seriam
// duas respostas diferentes para "por que não gerou nada", que é
// justamente a pergunta que o botão existe para responder.
//
// ------------------------------------------------------------
// POR QUE O RESULTADO DIZ TANTO
//
// A versão anterior devolvia `{considered, ran, pages_proposed}`. Com
// tudo em zero — que é o caso comum e correto — isso é indistinguível
// de "quebrado". E foi exatamente essa a leitura: "não rodou nada e já
// temos conversas".
//
// Então o retorno separa os motivos: quantas conversas ainda estão
// ativas demais para ler, quantas o vault já leu, e quantas sobraram.
// Zero com motivo é uma resposta; zero sem motivo é um mistério.
// ============================================================

/** Uma conversa está "encerrada" depois de tanto tempo calada. Curto o
 *  bastante para aprender no mesmo dia, longo o bastante para não
 *  ingerir a conversa de quem só saiu para almoçar. */
export const IDLE_MINUTES = 90

/** Teto por varredura: cada conversa custa chamadas na chave do próprio
 *  cliente, e uma fila represada é melhor drenada em vários ciclos do
 *  que numa conta-surpresa. */
export const MAX_PER_SWEEP = 10

/** Não varrer a história inteira na primeira execução. */
const LOOKBACK_DAYS = 7

export interface SweepResult {
  considered: number
  ran: number
  pagesProposed: number
  /** Por que as outras ficaram de fora. É o que transforma um zero numa
   *  resposta. */
  skipped: {
    /** Ainda conversando, ou caladas há menos de `IDLE_MINUTES`. */
    tooRecent: number
    /** O vault já leu esta conversa antes. */
    alreadyRead: number
  }
}

interface ConversationRow {
  id: string
  account_id: string
  contact_id: string | null
  updated_at: string
}

export async function sweepVault(
  db: SupabaseClient,
  options: { accountId?: string } = {},
): Promise<SweepResult> {
  const now = Date.now()
  const idleBefore = new Date(now - IDLE_MINUTES * 60_000).toISOString()
  const lookbackFrom = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString()

  // A janela inteira primeiro, sem o filtro de ociosidade: é o que
  // permite dizer "5 conversas, mas 3 ainda estão ativas" em vez de um
  // zero mudo.
  let query = db
    .from('conversations')
    .select('id, account_id, contact_id, updated_at')
    .gt('updated_at', lookbackFrom)
    .order('updated_at', { ascending: false })
    .limit(MAX_PER_SWEEP * 6)
  if (options.accountId) query = query.eq('account_id', options.accountId)

  const { data, error } = await query
  if (error) {
    console.error('[vault sweep] conversation query failed:', error)
    throw error
  }

  const inWindow = (data ?? []) as ConversationRow[]
  const idle = inWindow.filter((c) => c.updated_at < idleBefore)
  const tooRecent = inWindow.length - idle.length

  if (idle.length === 0) {
    return {
      considered: 0,
      ran: 0,
      pagesProposed: 0,
      skipped: { tooRecent, alreadyRead: 0 },
    }
  }

  // Quais o vault já leu. Uma consulta e não uma por conversa — e o
  // `ref_id` é o que torna a ingestão idempotente mesmo se uma
  // varredura for repetida no meio.
  const { data: seenRows } = await db
    .from('ai_vault_sources')
    .select('ref_id')
    .eq('kind', 'conversation')
    .in(
      'ref_id',
      idle.map((c) => c.id),
    )
  const seen = new Set(
    ((seenRows ?? []) as { ref_id: string | null }[])
      .map((r) => r.ref_id)
      .filter(Boolean),
  )

  const fresh = idle.filter((c) => !seen.has(c.id))
  const pending = fresh.slice(0, MAX_PER_SWEEP)

  let ran = 0
  let pagesProposed = 0
  for (const conversation of pending) {
    // Sequencial de propósito. Todas dividem uma chave de provedor por
    // conta, e uma rajada é exatamente o que estoura um limite de taxa
    // — este trabalho tem todo o tempo do mundo.
    const result = await runVaultKeeper(db, {
      accountId: conversation.account_id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
    })
    if (result.ran) ran += 1
    pagesProposed += result.pagesProposed
  }

  return {
    considered: pending.length,
    ran,
    pagesProposed,
    skipped: { tooRecent, alreadyRead: idle.length - fresh.length },
  }
}
