import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  runAgent: vi.fn(),
  engineSendText: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    inserted: [] as { table: string; rows: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./agent', () => ({ runAgent: h.runAgent }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
// `handOffConversation` is deliberately NOT mocked: the handoff write is
// the behaviour under test, and it is now shared with the API v1 route.
vi.mock('./admin-client', () => {
  /**
   * A chainable stand-in for the query builder: every filter returns
   * itself, and the chain resolves to `result()` whether the caller ends
   * with `.maybeSingle()`, `.limit()`, or just awaits it.
   */
  const chain = (result: () => unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c,
      eq: () => c,
      in: () => c,
      limit: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve(result()),
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(ok, err),
    })
    return c
  }

  return {
    supabaseAdmin: () => ({
      from: (table: string) => {
        const rows = () => {
          if (table === 'automations') {
            return { data: h.state.autoResponders, error: null }
          }
          if (table === 'profiles') {
            return { data: { user_id: 'agent-7' }, error: null }
          }
          return { data: h.state.conv, error: null }
        }
        return {
          ...chain(rows),
          update: (payload: Record<string, unknown>) => {
            h.state.updatePayload = payload
            return chain(() => ({ error: null }))
          },
          insert: (r: unknown) => {
            h.state.inserted.push({ table, rows: r })
            return chain(() => ({ error: null }))
          },
        }
      },
      rpc: (name: string, args: unknown) => {
        h.state.rpcCalls.push({ name, args })
        return Promise.resolve({ data: h.state.claim, error: null })
      },
    }),
  }
})

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.inserted = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.runAgent.mockResolvedValue({
    text: 'Hello!',
    handoff: false,
    handoffSource: null,
    usage: null,
    steps: [],
  })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.runAgent.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

/** What `runAgent` returns when the model bails via the sentinel. */
function sentinelHandoff() {
  return {
    text: '',
    handoff: true,
    handoffSource: 'sentinel' as const,
    usage: null,
    steps: [],
  }
}

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.runAgent.mockResolvedValue(sentinelHandoff())
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      // Shared with the API v1 route: a handoff lands in the queue the
      // inbox built for "a human must look at this".
      status: 'pending',
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.runAgent.mockResolvedValue(sentinelHandoff())
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('leaves the note alone when request_human already wrote it', async () => {
    h.runAgent.mockResolvedValue({
      text: 'Vou chamar alguém.',
      handoff: true,
      handoffSource: 'tool',
      usage: null,
      steps: [
        {
          toolName: 'request_human',
          arguments: { reason: 'cliente irritado' },
          result: 'A human agent has been notified.',
          isError: false,
          durationMs: 3,
        },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    // The tool's own reason is better than anything we could rebuild —
    // no second write to overwrite it.
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('records executed tool steps for the audit trail', async () => {
    h.runAgent.mockResolvedValue({
      text: 'Tenho quinta 14h.',
      handoff: false,
      handoffSource: null,
      usage: null,
      steps: [
        {
          toolName: 'check_availability',
          arguments: { date_from: '2026-08-03' },
          result: 'quinta 14h',
          isError: false,
          durationMs: 12,
        },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    const steps = h.state.inserted.find((i) => i.table === 'ai_agent_steps')
    expect(steps?.rows).toMatchObject([
      { tool_name: 'check_availability', step_index: 0, is_error: false },
    ])
  })
})
