import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runAgent } from './agent'
import type { AiConfig } from './types'
import type { AgentTool, ToolContext } from './tools/types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    baseUrl: null,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    embeddingsBaseUrl: null,
    embeddingsModel: null,
    ...overrides,
  }
}

const ctx = {
  db: {} as never,
  accountId: 'acct',
  conversationId: 'conv',
  contactId: 'contact',
  config: config(),
} satisfies ToolContext

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

/** An OpenAI response asking for one tool call. */
function toolCallResponse(
  name: string,
  args: string,
  opts: { id?: string; text?: string } = {},
) {
  return okResponse({
    choices: [
      {
        message: {
          content: opts.text ?? null,
          tool_calls: [{ id: opts.id ?? 'call_1', function: { name, arguments: args } }],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  })
}

/** An OpenAI response with a final answer. */
function textResponse(text: string) {
  return okResponse({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  })
}

function tool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'check_availability',
    description: 'List free slots',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: 'quinta 14h, quinta 16h' }),
    ...overrides,
  }
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('runAgent without tools', () => {
  it('makes exactly one call and returns the text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse('Olá!'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res).toEqual({
      text: 'Olá!',
      handoff: false,
      handoffSource: null,
      yielded: false,
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      steps: [],
    })
  })

  it('still honours the handoff sentinel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textResponse('[[HANDOFF]]')))
    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'quero falar com atendente' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('refuses to run with tools but no context', async () => {
    await expect(
      runAgent({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'oi' }],
        tools: [tool()],
      }),
    ).rejects.toMatchObject({ code: 'agent_misconfigured' })
  })
})

describe('runAgent with tools', () => {
  it('runs the tool, feeds the result back, and answers on the next call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse('check_availability', '{"date_from":"2026-08-03"}'))
      .mockResolvedValueOnce(textResponse('Tenho quinta 14h ou 16h. Qual prefere?'))
    vi.stubGlobal('fetch', fetchMock)

    const execute = vi.fn().mockResolvedValue({ content: 'quinta 14h, quinta 16h' })
    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'quero marcar' }],
      tools: [tool({ execute })],
      ctx,
    })

    expect(execute).toHaveBeenCalledWith({ date_from: '2026-08-03' }, ctx)
    expect(res.text).toBe('Tenho quinta 14h ou 16h. Qual prefere?')
    expect(res.handoff).toBe(false)
    expect(res.steps).toEqual([
      {
        toolName: 'check_availability',
        arguments: { date_from: '2026-08-03' },
        result: 'quinta 14h, quinta 16h',
        isError: false,
        durationMs: expect.any(Number),
      },
    ])

    // The second request carries the assistant's tool call and its result.
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    const roles = second.messages.map((m: { role: string }) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(second.messages[3]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'quinta 14h, quinta 16h',
    })
  })

  it('sums usage across every call in the run', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(toolCallResponse('check_availability', '{}'))
        .mockResolvedValueOnce(textResponse('pronto')),
    )
    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [tool()],
      ctx,
    })
    // 10+2+12 from the tool turn, 5+3+8 from the answer.
    expect(res.usage).toEqual({
      promptTokens: 15,
      completionTokens: 5,
      totalTokens: 20,
    })
  })

  it('turns a thrown tool into an error result and keeps going', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse('check_availability', '{}'))
      .mockResolvedValueOnce(textResponse('Não consegui ver a agenda agora.'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [
        tool({
          execute: async () => {
            throw new Error('Google timed out')
          },
        }),
      ],
      ctx,
    })

    expect(res.text).toBe('Não consegui ver a agenda agora.')
    expect(res.steps[0].isError).toBe(true)
    expect(res.steps[0].result).toContain('Google timed out')
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second.messages[3].content).toContain('Google timed out')
  })

  it('reports an unknown tool name without executing anything', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(toolCallResponse('book_appointment', '{}'))
        .mockResolvedValueOnce(textResponse('ok')),
    )
    const execute = vi.fn()
    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [tool({ execute })],
      ctx,
    })
    expect(execute).not.toHaveBeenCalled()
    expect(res.steps[0].isError).toBe(true)
    expect(res.steps[0].result).toContain('book_appointment')
  })

  it('reports malformed arguments instead of calling the tool with garbage', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(toolCallResponse('check_availability', '{"date_from":'))
        .mockResolvedValueOnce(textResponse('ok')),
    )
    const execute = vi.fn()
    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [tool({ execute })],
      ctx,
    })
    expect(execute).not.toHaveBeenCalled()
    expect(res.steps[0].isError).toBe(true)
  })

  it('stops immediately when a tool asks for a human, keeping the text already written', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse('request_human', '{"reason":"reclamação"}', {
          text: 'Vou chamar alguém para te ajudar.',
        }),
      )
      .mockResolvedValueOnce(textResponse('não deveria acontecer'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'quero reclamar' }],
      tools: [
        tool({
          name: 'request_human',
          execute: async () => ({ content: 'Handed off.', handoff: true }),
        }),
      ],
      ctx,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('Vou chamar alguém para te ajudar.')
    expect(res.steps).toHaveLength(1)
  })

  it('hands off when the model keeps calling tools past the step cap', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(toolCallResponse('check_availability', '{}'))
    vi.stubGlobal('fetch', fetchMock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await runAgent({
      config: config({ maxToolSteps: 3 }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [tool()],
      ctx,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(res.handoff).toBe(true)
    // No half-finished answer goes to the customer.
    expect(res.text).toBe('')
    expect(res.steps).toHaveLength(3)
    warn.mockRestore()
  })

  it('truncates a huge tool result before paying to send it back', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse('check_availability', '{}'))
      .mockResolvedValueOnce(textResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [tool({ execute: async () => ({ content: 'x'.repeat(10_000) }) })],
      ctx,
    })

    expect(res.steps[0].result.length).toBeLessThan(10_000)
    expect(res.steps[0].result).toContain('truncated')
  })

  it('runs every call of a multi-tool turn, in order', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          okResponse({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'a', function: { name: 'check_availability', arguments: '{"d":1}' } },
                    { id: 'b', function: { name: 'check_availability', arguments: '{"d":2}' } },
                  ],
                },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(textResponse('ok')),
    )

    const seen: unknown[] = []
    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [
        tool({
          execute: async (a) => {
            seen.push(a)
            return { content: `slot ${String(a.d)}` }
          },
        }),
      ],
      ctx,
    })

    expect(seen).toEqual([{ d: 1 }, { d: 2 }])
    expect(res.steps.map((s) => s.result)).toEqual(['slot 1', 'slot 2'])
  })
})

describe('a tool that yields the turn', () => {
  // `yieldTurn` and `handoff` both stop the loop and mean opposite
  // things: one leaves the customer talking to a flow, the other calls
  // a person. Conflating them would have auto-reply paging an attendant
  // every time a flow started.
  it('stops the loop without calling a human', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse('start_flow', '{"flow":"Planos"}'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'quero ver os planos' }],
      tools: [
        tool({
          name: 'start_flow',
          execute: async () => ({ content: 'started', yieldTurn: true }),
        }),
      ],
      ctx,
    })

    expect(res.yielded).toBe(true)
    expect(res.handoff).toBe(false)
    expect(res.handoffSource).toBeNull()
    // One call: the loop must not go back to the model for a closing
    // line, which would cost a round trip to produce text we discard.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // The flow has already sent its first node. Anything the model wrote
  // alongside the call would land on top of it and the customer would
  // answer the wrong message.
  it('drops whatever the model wrote alongside the call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        toolCallResponse('start_flow', '{"flow":"Planos"}', {
          text: 'Claro, vou te mostrar!',
        }),
      ),
    )

    const res = await runAgent({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'planos' }],
      tools: [
        tool({
          name: 'start_flow',
          execute: async () => ({ content: 'started', yieldTurn: true }),
        }),
      ],
      ctx,
    })

    expect(res.text).toBe('')
  })
})
