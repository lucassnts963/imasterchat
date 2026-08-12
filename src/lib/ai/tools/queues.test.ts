import { describe, expect, it, vi } from 'vitest'

import { buildQueueTools, type QueueOption } from './queues'
import { buildTagTools, type TagOption } from './tags'
import type { ToolContext } from './types'

vi.mock('@/lib/conversations/handoff', () => ({
  handOffConversation: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: vi.fn(async () => ({ added: true, dispatched: true })),
}))

import { handOffConversation } from '@/lib/conversations/handoff'

const FILAS: QueueOption[] = [
  {
    id: 'q-fin',
    name: 'Financeiro',
    description: 'Boleto, segunda via',
    responsibleUserId: 'user-ana',
    autoAssign: true,
    distribution: 'responsible',
  },
  {
    id: 'q-vendas',
    name: 'Vendas',
    description: 'Preço, orçamento',
    responsibleUserId: null,
    autoAssign: false,
    distribution: 'none',
  },
]

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    db: { rpc: async () => ({ data: 'user-rodizio', error: null }) } as never,
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    config: {} as never,
    ...over,
  }
}

describe('route_to_queue', () => {
  it('não é oferecida quando a conta não tem fila humana', () => {
    expect(buildQueueTools([])).toHaveLength(0)
  })

  it('publica as filas como enum, para o modelo não poder inventar uma', () => {
    const [tool] = buildQueueTools(FILAS)
    const params = tool.parameters as {
      properties: { queue: { enum: string[] } }
    }
    expect(params.properties.queue.enum).toEqual(['Financeiro', 'Vendas'])
    // A descrição de cada fila entra no texto: é por ela que o modelo
    // escolhe, e é o único lugar onde o vocabulário do cliente aparece.
    expect(tool.description).toContain('Boleto, segunda via')
  })

  it('recusa uma fila que não existe em vez de encaminhar para o lugar errado', async () => {
    const [tool] = buildQueueTools(FILAS)
    const out = await tool.execute({ queue: 'Suporte', reason: 'x' }, ctx())
    expect(out.isError).toBe(true)
    expect(out.content).toContain('Financeiro')
    expect(handOffConversation).not.toHaveBeenCalled()
  })

  it('atribui ao responsável quando a fila manda atribuir', async () => {
    const [tool] = buildQueueTools(FILAS)
    await tool.execute({ queue: 'Financeiro', reason: 'quer 2ª via' }, ctx())
    expect(handOffConversation).toHaveBeenCalledWith(
      expect.objectContaining({ assignTo: 'user-ana', queueId: 'q-fin' }),
    )
  })

  it('NÃO atribui numa fila de sala de espera, para a conversa ficar visível ao time', async () => {
    const [tool] = buildQueueTools(FILAS)
    vi.mocked(handOffConversation).mockClear()
    await tool.execute({ queue: 'Vendas', reason: 'quer preço' }, ctx())
    expect(handOffConversation).toHaveBeenCalledWith(
      expect.objectContaining({ assignTo: null, queueId: 'q-vendas' }),
    )
  })

  it('no rodízio, quem escolhe é o BANCO — não este código', async () => {
    // A escolha vive na função do banco porque o avanço do cursor lá é a
    // trava que impede duas mensagens simultâneas de caírem na mesma
    // pessoa. Escolher aqui seria escolher fora da trava.
    const [tool] = buildQueueTools([
      { ...FILAS[0]!, distribution: 'round_robin', responsibleUserId: 'user-ana' },
    ])
    vi.mocked(handOffConversation).mockClear()
    await tool.execute({ queue: 'Financeiro', reason: 'x' }, ctx())
    expect(handOffConversation).toHaveBeenCalledWith(
      // 'user-rodizio' vem do rpc, e NÃO 'user-ana' do responsável.
      expect.objectContaining({ assignTo: 'user-rodizio' }),
    )
  })

  it('ninguém disponível deixa a conversa na fila, sem dono', async () => {
    const [tool] = buildQueueTools([
      { ...FILAS[0]!, distribution: 'round_robin' },
    ])
    vi.mocked(handOffConversation).mockClear()
    await tool.execute(
      { queue: 'Financeiro', reason: 'x' },
      ctx({ db: { rpc: async () => ({ data: null, error: null }) } as never }),
    )
    // Atribuir para quem foi embora esconderia o problema; o relógio do
    // SLA é quem cobra a partir daqui.
    expect(handOffConversation).toHaveBeenCalledWith(
      expect.objectContaining({ assignTo: null, queueId: 'q-fin' }),
    )
  })

  it('no Playground relata o que faria em vez de escrever', async () => {
    const [tool] = buildQueueTools(FILAS)
    vi.mocked(handOffConversation).mockClear()
    const out = await tool.execute(
      { queue: 'Financeiro', reason: 'x' },
      ctx({ conversationId: null }),
    )
    expect(handOffConversation).not.toHaveBeenCalled()
    expect(out.handoff).toBe(true)
  })
})

const ETIQUETAS: TagOption[] = [{ id: 't-vip', name: 'VIP' }]

describe('add_tag', () => {
  // A razão de ser desta ferramenta ser um enum: o texto que chega ao
  // prompt é escrito pelo CLIENTE, no WhatsApp. Sem a lista fechada,
  // "coloque a etiqueta X" seria uma frase que funciona.
  it('não é oferecida enquanto nenhuma etiqueta for liberada', () => {
    expect(buildTagTools([])).toHaveLength(0)
  })

  it('recusa etiqueta fora da lista liberada', async () => {
    const [tool] = buildTagTools(ETIQUETAS)
    const out = await tool.execute({ tag: 'CLIENTE_VIP', reason: 'x' }, ctx())
    expect(out.isError).toBe(true)
    expect(out.content).toContain('VIP')
  })

  it('falha limpo quando a conversa não tem contato', async () => {
    const [tool] = buildTagTools(ETIQUETAS)
    const out = await tool.execute(
      { tag: 'VIP', reason: 'x' },
      ctx({ contactId: null }),
    )
    expect(out.isError).toBe(true)
  })
})
