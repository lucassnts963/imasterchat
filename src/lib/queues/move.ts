import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Mover uma conversa de fila.
//
// A parte difícil — abrir e fechar a ESTADA que registra a passagem —
// não está aqui: está num gatilho do banco (migração 066). E está lá
// por um motivo concreto, não por gosto.
//
// `conversations` é escrita de muitos lugares, e um deles é o
// NAVEGADOR: o dropdown de atribuição e o seletor de status do inbox
// fazem UPDATE direto na tabela, autorizados só pela RLS. Somando
// automações, fluxos, webhook e API pública, manter o histórico em
// TypeScript exigiria lembrar de chamar o mesmo helper em todos esses
// lugares, para sempre, inclusive nos que ainda não existem. O primeiro
// esquecido abre um buraco permanente no relatório — e um buraco que só
// aparece meses depois, quando alguém pergunta quanto tempo o
// Financeiro levou em julho.
//
// Então este módulo faz UMA coisa: escreve `queue_id`. O gatilho vê a
// mudança e registra a passagem, venha ela de onde vier.
// ============================================================

interface MoveArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  queueId: string
}

/**
 * Põe a conversa numa fila.
 *
 * Best-effort: nenhuma falha aqui pode derrubar o atendimento. Perder
 * uma linha de histórico é ruim; deixar de transferir uma conversa
 * porque o histórico falhou é pior.
 *
 * Não mexe em `assigned_agent_id` — quem decide dono é quem chama.
 */
export async function moveConversationToQueue(args: MoveArgs): Promise<void> {
  try {
    const { error } = await args.db
      .from('conversations')
      .update({ queue_id: args.queueId, updated_at: new Date().toISOString() })
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
    if (error) throw error
  } catch (err) {
    console.error('[queues] falha ao mover de fila:', err)
  }
}

/**
 * A fila padrão da conta — a do robô, onde a conversa começa.
 *
 * Devolve `null` quando não há (conta criada antes da 065 e não
 * migrada, ou fila apagada à mão). Quem chama trata como "sem fila",
 * que é exatamente o estado anterior a esta funcionalidade: degradar
 * para o comportamento antigo é melhor que falhar.
 */
export async function defaultQueueId(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data } = await db
    .from('queues')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_default', true)
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
}

/** Uma fila, como as telas precisam dela. */
export interface Queue {
  id: string
  name: string
  description: string | null
  attended_by: 'ai' | 'humans'
  responsible_user_id: string | null
  auto_assign: boolean
  is_default: boolean
  position: number
  active: boolean
}

/** As filas ativas da conta, na ordem em que a tela as mostra. */
export async function listQueues(
  db: SupabaseClient,
  accountId: string,
): Promise<Queue[]> {
  const { data } = await db
    .from('queues')
    .select(
      'id, name, description, attended_by, responsible_user_id, auto_assign, is_default, position, active',
    )
    .eq('account_id', accountId)
    .eq('active', true)
    .order('position', { ascending: true })
    .order('name', { ascending: true })
  return (data ?? []) as Queue[]
}
