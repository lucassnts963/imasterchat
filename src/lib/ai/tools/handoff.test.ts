import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from '../types'
import type { ToolContext } from './types'

const h = vi.hoisted(() => ({ handOffConversation: vi.fn() }))
vi.mock('@/lib/conversations/handoff', () => ({
  handOffConversation: h.handOffConversation,
}))

import { requestHumanTool } from './handoff'

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    db: {} as never,
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    config: { handoffAgentId: 'agent-7' } as AiConfig,
    ...overrides,
  }
}

beforeEach(() => {
  h.handOffConversation.mockReset()
  h.handOffConversation.mockResolvedValue({ ok: true, assignedAgentId: 'agent-7' })
})

describe('request_human', () => {
  it('flags the conversation and stops the loop', async () => {
    const out = await requestHumanTool.execute({ reason: 'cliente irritado' }, ctx())

    expect(h.handOffConversation).toHaveBeenCalledWith({
      db: expect.anything(),
      accountId: 'acct-1',
      conversationId: 'conv-1',
      summary: '🤖 cliente irritado',
      assignTo: 'agent-7',
    })
    expect(out.handoff).toBe(true)
    expect(out.isError).toBeFalsy()
  })

  it('rejects an empty reason without writing anything', async () => {
    const out = await requestHumanTool.execute({ reason: '  ' }, ctx())
    expect(h.handOffConversation).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
    // Not a handoff — the model should retry with an actual reason.
    expect(out.handoff).toBeFalsy()
  })

  it('still stops in the Playground, where there is no thread to flag', async () => {
    const out = await requestHumanTool.execute(
      { reason: 'teste' },
      ctx({ conversationId: null }),
    )
    expect(h.handOffConversation).not.toHaveBeenCalled()
    expect(out.handoff).toBe(true)
    expect(out.content).toContain('test run')
  })

  it('stops anyway when the write fails — the reason to stop did not go away', async () => {
    h.handOffConversation.mockResolvedValue({
      ok: false,
      failure: 'internal',
      message: 'Failed to hand off the conversation',
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    const out = await requestHumanTool.execute({ reason: 'erro grave' }, ctx())
    expect(out.handoff).toBe(true)
    expect(out.isError).toBe(true)
    err.mockRestore()
  })
})
