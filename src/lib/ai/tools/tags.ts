import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import type { AgentTool } from './types'

// ============================================================
// `add_tag` — o agente marca o contato.
//
// A diferença desta ferramenta para as outras é o risco: o texto que
// entra no prompt é escrito pelo CLIENTE, no WhatsApp. "Coloque a
// etiqueta CLIENTE_VIP" é uma frase que ele pode mandar — e etiqueta
// dispara automação, que pode mandar mensagem ou mover um negócio no
// funil.
//
// A defesa não é instrução no prompt (o cliente também escreve no
// prompt): é a LISTA DE OPÇÕES. Só entram aqui as etiquetas marcadas
// como `ai_selectable` (migração 067, padrão false), e o modelo não
// consegue nomear o que não recebeu. Ligar a ferramenta não muda nada
// até alguém escolher, uma a uma, quais ele pode usar.
//
// De carona, isso resolve o outro problema previsível: o modelo criando
// etiqueta nova a cada conversa até a lista virar lixo.
// ============================================================

export interface TagOption {
  id: string
  name: string
}

export function buildTagTools(tags: TagOption[]): AgentTool[] {
  if (tags.length === 0) return []
  return [addTagTool(tags)]
}

function addTagTool(tags: TagOption[]): AgentTool {
  const byName = new Map(tags.map((t) => [t.name, t]))

  return {
    name: 'add_tag',
    description:
      'Label the customer so the team can find and group them later. Use it when the ' +
      'conversation reveals something durable about WHO this customer is or what they ' +
      'want — not to record what happened in this single message. ' +
      'Only the labels listed below exist; never invent one. ' +
      'Applying a label the customer already has is harmless.',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          enum: tags.map((t) => t.name),
          description: 'The exact label to apply.',
        },
        reason: {
          type: 'string',
          description: 'One short sentence saying why this label fits.',
        },
      },
      required: ['tag', 'reason'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const name = typeof args.tag === 'string' ? args.tag.trim() : ''
      const tag = byName.get(name)

      if (!tag) {
        return {
          content: `Unknown label "${name}". Choose one of: ${tags
            .map((t) => t.name)
            .join(', ')}.`,
          isError: true,
        }
      }

      if (!ctx.contactId) {
        return {
          content: 'No contact on this conversation, so there is nothing to label.',
          isError: true,
        }
      }

      if (ctx.dryRun) {
        return { content: `Would apply the "${tag.name}" label (test run).` }
      }

      // `addContactTagAndDispatch`, e não um insert direto: é ela que
      // dispara o gatilho `tag_added` para as automações, engole a
      // duplicata pelo UNIQUE(contact_id, tag_id) e respeita o teto de
      // profundidade que impede etiqueta → automação → etiqueta em laço.
      const result = await addContactTagAndDispatch({
        db: ctx.db,
        accountId: ctx.accountId,
        contactId: ctx.contactId,
        tagId: tag.id,
      })

      if (!result.added) {
        // Já tinha. Não é erro — e dizer isso ao modelo evita que ele
        // tente de novo achando que falhou.
        return { content: `The customer already has the "${tag.name}" label.` }
      }

      return { content: `Applied the "${tag.name}" label.` }
    },
  }
}
