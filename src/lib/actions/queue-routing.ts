import type { SupabaseClient } from '@supabase/supabase-js'
import { handOffConversation } from '@/lib/conversations/handoff'

// ============================================================
// Encaminhar para a fila certa — fase 1, R-8.
//
// É um HANDOFF COM DESTINO, e não um caminho novo: reusa
// `handOffConversation`, que já grava status e nota, dispara o aviso, e
// — de propósito — nunca rouba conversa que já tem dono humano.
//
// Extraído da ferramenta do agente para cá porque encaminhar não é uma
// decisão de modelo: é uma regra de atendimento, e o fluxo e a automação
// precisam da mesma. Quem escolhe QUEM recebe continua sendo o banco.
// ============================================================

export interface RoutableQueue {
  id: string
  name: string
  description: string | null
  /** Quem recebe ao chegar, quando a fila tem responsável. */
  responsibleUserId: string | null
  autoAssign: boolean
  /** 'responsible' | 'none' | 'round_robin' | 'least_busy' */
  distribution: string
}

/**
 * As filas para as quais dá para encaminhar.
 *
 * Só as HUMANAS: mandar para a fila do robô seria encaminhar para si
 * mesmo. Só as ativas, e nunca a padrão — a conversa já está nela.
 */
export async function loadRoutableQueues(
  db: SupabaseClient,
  accountId: string,
): Promise<RoutableQueue[]> {
  try {
    const { data } = await db
      .from('queues')
      .select('id, name, description, responsible_user_id, auto_assign, distribution')
      .eq('account_id', accountId)
      .eq('active', true)
      .eq('attended_by', 'humans')
      .order('position')
    // `Array.isArray`, e não `data ?? []`: uma resposta malformada não é
    // nula, é um objeto — e o `.map` logo abaixo estouraria FORA do
    // try/catch, derrubando quem montou a lista por causa de uma
    // consulta acessória.
    if (!Array.isArray(data)) return []
    return (data as Array<{
      id: string
      name: string
      description: string | null
      responsible_user_id: string | null
      auto_assign: boolean
      distribution: string
    }>).map((q) => ({
      id: q.id,
      name: q.name,
      description: q.description,
      responsibleUserId: q.responsible_user_id,
      autoAssign: q.auto_assign,
      distribution: q.distribution ?? 'responsible',
    }))
  } catch (err) {
    console.error('[queues] filas indisponíveis:', err)
    return []
  }
}

export async function loadQueue(
  db: SupabaseClient,
  accountId: string,
  queueId: string,
): Promise<RoutableQueue | null> {
  const queues = await loadRoutableQueues(db, accountId)
  return queues.find((q) => q.id === queueId) ?? null
}

export interface RouteResult {
  ok: boolean
  message: string
  /** Para quem foi, ou null quando ficou na fila sem dono. */
  assignedTo?: string | null
}

/**
 * Manda a conversa para a fila e deixa a nota de quem for pegar.
 *
 * Quem recebe depende do modo da fila. No rodízio quem escolhe é o
 * BANCO (`next_queue_assignee`), e não este código: o avanço do cursor
 * lá é a trava que impede duas mensagens simultâneas de caírem na mesma
 * pessoa. Escolher aqui seria escolher fora da trava.
 *
 * `null` é uma resposta legítima — ninguém disponível. A conversa fica
 * NA FILA, visível, e o relógio do SLA cobra. Atribuir para quem foi
 * embora esconderia o problema.
 */
export async function routeConversationToQueue(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  queue: RoutableQueue
  /** A nota que quem pegar vai ler. */
  summary: string
}): Promise<RouteResult> {
  const { db, accountId, conversationId, queue } = args

  let assignTo: string | null = null
  if (queue.autoAssign) {
    if (queue.distribution === 'round_robin' || queue.distribution === 'least_busy') {
      const { data, error } = await db.rpc('next_queue_assignee', {
        p_queue_id: queue.id,
      })
      if (error) console.error('[queues] next_queue_assignee falhou:', error)
      assignTo = (data as string | null) ?? null
    } else if (queue.distribution === 'responsible') {
      assignTo = queue.responsibleUserId
    }
  }

  const result = await handOffConversation({
    db,
    accountId,
    conversationId,
    summary: args.summary,
    assignTo,
    queueId: queue.id,
  })

  if (!result.ok) {
    // Quem chamou para MESMO assim: a escrita ter falhado não faz o
    // motivo de encaminhar desaparecer, e um bot que continua falando
    // depois de decidir encaminhar é pior que um que fica quieto.
    console.error('[queues] encaminhamento falhou ao gravar:', result.message)
    return { ok: false, message: result.message ?? 'routing write failed', assignedTo: assignTo }
  }
  return { ok: true, message: `routed to "${queue.name}"`, assignedTo: assignTo }
}
