import { handOffConversation } from '@/lib/conversations/handoff'
import type { AgentTool } from './types'

// ============================================================
// `route_to_queue` — o agente encaminha para o time certo.
//
// É um HANDOFF COM DESTINO, e não um caminho novo: reusa
// `handOffConversation`, que já grava status e nota, dispara o aviso, e
// — de propósito — nunca rouba conversa que já tem dono humano.
// Reescrever isso ao lado duplicaria a única parte deste sistema que já
// foi endurecida.
//
// A diferença para `request_human`, que continua existindo:
//
//   request_human    "não sei resolver, chama alguém"
//   route_to_queue   "sei exatamente quem resolve isto"
//
// As filas entram no schema como ENUM. É isso que impede o modelo de
// inventar fila — e é mais confiável que pedir por favor no texto da
// descrição.
// ============================================================

export interface QueueOption {
  id: string
  name: string
  description: string | null
  /** Quem recebe a conversa ao chegar, quando a fila tem responsável. */
  responsibleUserId: string | null
  autoAssign: boolean
}

/**
 * Monta a ferramenta a partir das filas HUMANAS da conta.
 *
 * Devolve lista vazia quando não há nenhuma — e aí a ferramenta não
 * entra no catálogo. Mesmo princípio das de agendamento: uma ferramenta
 * que não pode funcionar não deve ser oferecida, senão o modelo promete
 * ao cliente e descobre depois que não dá.
 */
export function buildQueueTools(queues: QueueOption[]): AgentTool[] {
  if (queues.length === 0) return []
  return [routeToQueueTool(queues)]
}

function routeToQueueTool(queues: QueueOption[]): AgentTool {
  const byName = new Map(queues.map((q) => [q.name, q]))

  const catalogue = queues
    .map((q) => `- "${q.name}": ${q.description?.trim() || 'sem descrição'}`)
    .join('\n')

  return {
    name: 'route_to_queue',
    description:
      'Send this conversation to the team that handles it, and stop replying. ' +
      'Use it when the customer needs something a specific team owns — not when you ' +
      'simply cannot help (use request_human for that). Pick the queue whose ' +
      'description matches what the customer actually wants.\n' +
      'Available queues:\n' +
      catalogue,
    parameters: {
      type: 'object',
      properties: {
        // O enum é a defesa: o modelo escolhe entre estas, e só estas.
        queue: {
          type: 'string',
          enum: queues.map((q) => q.name),
          description: 'The exact name of the queue to route to.',
        },
        reason: {
          type: 'string',
          description:
            'One short sentence for the person who picks this up, saying what the ' +
            'customer needs. Write it in the language the business uses.',
        },
      },
      required: ['queue', 'reason'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const name = typeof args.queue === 'string' ? args.queue.trim() : ''
      const reason = typeof args.reason === 'string' ? args.reason.trim() : ''

      if (!reason) {
        return {
          content: "A 'reason' is required — say briefly what the customer needs.",
          isError: true,
        }
      }

      // Mesmo com enum, um provedor pode alucinar um nome. Recusar com a
      // lista é melhor que encaminhar para o lugar errado.
      const queue = byName.get(name)
      if (!queue) {
        return {
          content: `Unknown queue "${name}". Choose one of: ${queues
            .map((q) => q.name)
            .join(', ')}.`,
          isError: true,
        }
      }

      if (!ctx.conversationId || ctx.dryRun) {
        // Playground: relata o que faria em vez de escrever. Ainda para
        // o laço, porque quem testa precisa ver que ELE encaminharia aqui.
        return {
          content: `No real conversation (test run). In production this would go to the "${queue.name}" queue.`,
          handoff: true,
        }
      }

      const result = await handOffConversation({
        db: ctx.db,
        accountId: ctx.accountId,
        conversationId: ctx.conversationId,
        summary: `🤖 ${queue.name}: ${reason}`,
        // Só atribui quando a fila manda atribuir. Numa fila sem
        // responsável — a sala de espera compartilhada — a conversa
        // fica visível para o time em vez de cair num nome só.
        assignTo: queue.autoAssign ? queue.responsibleUserId : null,
        queueId: queue.id,
      })

      if (!result.ok) {
        // Para mesmo assim: a escrita ter falhado não faz o motivo de
        // parar desaparecer, e um bot que continua falando depois de
        // decidir encaminhar é pior que um que fica quieto.
        console.error('[ai tools] route_to_queue falhou ao gravar:', result.message)
      }

      return {
        content: `Routed to "${queue.name}". Say nothing further.`,
        handoff: true,
      }
    },
  }
}
