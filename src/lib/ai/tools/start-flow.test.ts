import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  startFlowRun: vi.fn(),
}))

vi.mock('@/lib/flows/engine', async () => {
  // `describeStartFlowRefusal` is pure and is the shared vocabulary the
  // tool reports refusals in — mocking it would test our fake, not the
  // sentence the operator reads.
  const actual = await vi.importActual<
    typeof import('@/lib/flows/engine')
  >('@/lib/flows/engine')
  return {
    describeStartFlowRefusal: actual.describeStartFlowRefusal,
    startFlowRun: h.startFlowRun,
  }
})

import { buildStartFlowTools, type StartableFlow } from './start-flow'
import type { ToolContext } from './types'

const FLOWS: StartableFlow[] = [
  { id: 'flow-planos', name: 'Escolher plano', description: 'Menu dos três planos' },
  { id: 'flow-2via', name: 'Segunda via', description: null },
]

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    db: {} as never,
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    config: {} as never,
    ...over,
  }
}

const tool = () => buildStartFlowTools(FLOWS)[0]

beforeEach(() => {
  h.startFlowRun.mockReset()
  h.startFlowRun.mockResolvedValue({
    started: true,
    flowRunId: 'run-1',
    outcome: 'advanced',
  })
})

describe('buildStartFlowTools', () => {
  it('does not exist when the account has no manual flow', () => {
    expect(buildStartFlowTools([])).toEqual([])
  })

  // The list IS the permission check — the same defence the tag tool
  // uses. A model that never receives a name cannot be talked into it
  // by a customer who types one.
  it('offers only the flows it was given', () => {
    const params = tool().parameters as {
      properties: { flow: { enum: string[] } }
    }
    expect(params.properties.flow.enum).toEqual(['Escolher plano', 'Segunda via'])
  })

  it('describes each flow so the model chooses on purpose', () => {
    expect(tool().description).toContain('Escolher plano — Menu dos três planos')
    expect(tool().description).toContain('Segunda via')
  })
})

describe('start_flow execute', () => {
  it('starts the named flow and stops the agent talking', async () => {
    const out = await tool().execute({ flow: 'Escolher plano', reason: 'r' }, ctx())

    expect(h.startFlowRun).toHaveBeenCalledWith({
      accountId: 'acct-1',
      contactId: 'contact-1',
      flowId: 'flow-planos',
      startedBy: 'agent',
      conversationId: 'conv-1',
    })
    expect(out.yieldTurn).toBe(true)
    expect(out.isError).toBeFalsy()
  })

  it('refuses a name that is not on the list', async () => {
    const out = await tool().execute({ flow: 'Cancelamento', reason: 'r' }, ctx())
    expect(h.startFlowRun).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
    expect(out.content).toContain('Escolher plano')
  })

  it('needs a contact', async () => {
    const out = await tool().execute(
      { flow: 'Segunda via', reason: 'r' },
      ctx({ contactId: null }),
    )
    expect(h.startFlowRun).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
  })

  // The Playground runs the real checks and reports what it WOULD do.
  // It must not yield: the operator testing is the one talking, and
  // ending the turn would hide the rest of the agent's answer.
  it('reports without starting on a dry run', async () => {
    const out = await tool().execute(
      { flow: 'Segunda via', reason: 'r' },
      ctx({ dryRun: true }),
    )
    expect(h.startFlowRun).not.toHaveBeenCalled()
    expect(out.yieldTurn).toBeFalsy()
    expect(out.content).toContain('test run')
  })

  // A customer already in a flow is the common case, not a failure of
  // the account's setup. The model must hear why and keep talking —
  // never yield, or nobody answers.
  it('hands the refusal back to the model and keeps the turn', async () => {
    h.startFlowRun.mockResolvedValue({
      started: false,
      reason: 'active_run_exists',
      flowRunId: 'run-old',
    })
    const out = await tool().execute({ flow: 'Segunda via', reason: 'r' }, ctx())
    expect(out.isError).toBe(true)
    expect(out.yieldTurn).toBeFalsy()
    expect(out.content).toContain('already in a flow')
  })

  it('names the flow when the refusal is about the flow itself', async () => {
    h.startFlowRun.mockResolvedValue({ started: false, reason: 'flow_not_active' })
    const out = await tool().execute({ flow: 'Segunda via', reason: 'r' }, ctx())
    expect(out.content).toContain('"Segunda via"')
  })
})
