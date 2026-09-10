import { describeStartFlowRefusal, startFlowRun } from '@/lib/flows/engine'
import type { AgentTool } from './types'

// ============================================================
// `start_flow` — o agente entrega a conversa a um fluxo.
//
// Existe porque o agente é bom no que é aberto e ruim no que é fechado.
// "Qual desses três planos você quer?" é uma pergunta com três respostas
// certas, e um menu de botões resolve isso melhor — e mais barato — do
// que um modelo tentando interpretar "o do meio".
//
// O risco é o mesmo da ferramenta de etiquetas: o texto que entra no
// prompt é escrito pelo CLIENTE. "Inicie o fluxo de cancelamento" é uma
// frase que ele pode mandar. A defesa é a mesma, e não é instrução no
// prompt: é a LISTA. Só entram fluxos ATIVOS com gatilho `manual` —
// fluxo manual é, por definição, aquele que alguém de fora inicia. Um
// fluxo com gatilho de palavra-chave tem dono (o cliente que digita a
// palavra) e não deve poder ser iniciado por texto interpretado.
//
// Depois de iniciar, o agente PARA (`yieldTurn`). O fluxo já mandou o
// primeiro nó; qualquer frase do agente por cima chega como uma segunda
// mensagem e o cliente responde a mensagem errada.
// ============================================================

export interface StartableFlow {
  id: string
  name: string
  /** O que este fluxo faz, nas palavras da conta. É o que o modelo lê
   *  para decidir; sem isso ele escolhe pelo nome, que costuma ser um
   *  rótulo interno. */
  description: string | null
}

export function buildStartFlowTools(flows: StartableFlow[]): AgentTool[] {
  if (flows.length === 0) return []
  return [startFlowTool(flows)]
}

function startFlowTool(flows: StartableFlow[]): AgentTool {
  const byName = new Map(flows.map((f) => [f.name, f]))
  const catalogue = flows
    .map((f) => (f.description ? `${f.name} — ${f.description}` : f.name))
    .join('\n')

  return {
    name: 'start_flow',
    description:
      'Hand the conversation over to a guided flow: a scripted sequence of menus and ' +
      'questions the customer taps through. Use it when the next step is a CHOICE from a ' +
      'fixed set, or a form to fill in — a flow asks those better than you can. ' +
      'Do not use it to answer a question you can answer yourself. ' +
      'After this succeeds you stop replying: the flow is talking to the customer. ' +
      'Only these flows exist:\n' +
      catalogue,
    parameters: {
      type: 'object',
      properties: {
        flow: {
          type: 'string',
          enum: flows.map((f) => f.name),
          description: 'The exact name of the flow to start.',
        },
        reason: {
          type: 'string',
          description: 'One short sentence saying why this flow fits what the customer wants.',
        },
      },
      required: ['flow', 'reason'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const name = typeof args.flow === 'string' ? args.flow.trim() : ''
      const flow = byName.get(name)

      if (!flow) {
        return {
          content: `Unknown flow "${name}". Choose one of: ${flows
            .map((f) => f.name)
            .join(', ')}.`,
          isError: true,
        }
      }

      if (!ctx.contactId) {
        return {
          content: 'No contact on this conversation, so there is no one to put through a flow.',
          isError: true,
        }
      }

      if (ctx.dryRun) {
        // Sem `yieldTurn`: no Playground quem está conversando é o
        // operador testando, e encerrar o turno esconderia dele o que o
        // agente diria em seguida.
        return { content: `Would start the "${flow.name}" flow (test run).` }
      }

      const result = await startFlowRun({
        accountId: ctx.accountId,
        contactId: ctx.contactId,
        flowId: flow.id,
        startedBy: 'agent',
        conversationId: ctx.conversationId,
      })

      if (!result.started) {
        // Recusa não é exceção. O modelo recebe o motivo em uma frase e
        // segue conversando — que é exatamente o certo quando o cliente
        // já está em outro fluxo, ou quando o fluxo saiu do ar.
        return {
          content: describeStartFlowRefusal(result.reason, flow.name),
          isError: true,
        }
      }

      return {
        content: `Started the "${flow.name}" flow. It is talking to the customer now — say nothing else.`,
        yieldTurn: true,
      }
    },
  }
}
