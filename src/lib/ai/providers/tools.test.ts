import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateAnthropic } from './anthropic'
import { generateOpenAi } from './openai'
import { mergeConsecutive, parseToolArguments, type ProviderArgs } from './shared'
import type { ChatMessage, ToolSpec } from '../types'

// ============================================================
// Tool calling at the provider boundary: what goes out on the wire and
// what comes back off it. The loop that *uses* these lives in
// `agent.ts` and is tested separately.
// ============================================================

const TOOL: ToolSpec = {
  name: 'check_availability',
  description: 'List free slots',
  parameters: {
    type: 'object',
    properties: { date_from: { type: 'string' } },
    required: ['date_from'],
  },
}

function args(overrides: Partial<ProviderArgs> = {}): ProviderArgs {
  return {
    apiKey: 'k',
    model: 'm',
  baseUrl: 'https://api.example.com/v1',
  providerLabel: 'Example',
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'Hi' }],
    timeoutMs: 1000,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

/** The parsed request body of the first fetch call. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, never> {
  return JSON.parse(fetchMock.mock.calls[0][1].body)
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('mergeConsecutive with tool turns', () => {
  it('merges plain text but never folds a tool turn into its neighbour', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 't', arguments: {} }] },
      { role: 'tool', content: 'r1', toolCallId: '1' },
      { role: 'tool', content: 'r2', toolCallId: '2' },
    ]
    const merged = mergeConsecutive(messages)
    expect(merged).toHaveLength(4)
    expect(merged[0]).toMatchObject({ role: 'user', content: 'a\n\nb' })
    // Both results survive as distinct turns — folding them would break
    // the id pairing the provider uses to match call to result.
    expect(merged[2].toolCallId).toBe('1')
    expect(merged[3].toolCallId).toBe('2')
  })

  it('does not mutate the caller’s messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]
    mergeConsecutive(messages)
    expect(messages[0].content).toBe('a')
  })
})

describe('parseToolArguments', () => {
  it('passes an object through', () => {
    expect(parseToolArguments({ a: 1 })).toEqual({ arguments: { a: 1 } })
  })

  it('parses a JSON string', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ arguments: { a: 1 } })
  })

  it('treats absent arguments as an empty object (zero-parameter tool)', () => {
    expect(parseToolArguments(undefined)).toEqual({ arguments: {} })
    expect(parseToolArguments('')).toEqual({ arguments: {} })
  })

  it('reports malformed JSON instead of throwing', () => {
    const out = parseToolArguments('{"a":')
    expect(out.arguments).toEqual({})
    expect(out.argumentsError).toBeTruthy()
  })

  it('rejects a JSON array — arguments must be an object', () => {
    const out = parseToolArguments('[1,2]')
    expect(out.arguments).toEqual({})
    expect(out.argumentsError).toBeTruthy()
  })
})

describe('Anthropic tool calling', () => {
  it('reads a tool_use block instead of dropping it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          content: [
            { type: 'text', text: 'Let me check.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'check_availability',
              input: { date_from: '2026-08-03' },
            },
          ],
        }),
      ),
    )

    const res = await generateAnthropic(args({ tools: [TOOL] }))
    expect(res.text).toBe('Let me check.')
    expect(res.toolCalls).toEqual([
      {
        id: 'toolu_1',
        name: 'check_availability',
        arguments: { date_from: '2026-08-03' },
      },
    ])
  })

  it('accepts a turn that is only a tool call — no text is not empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          content: [{ type: 'tool_use', id: 'x', name: 'check_availability', input: {} }],
        }),
      ),
    )
    const res = await generateAnthropic(args({ tools: [TOOL] }))
    expect(res.text).toBe('')
    expect(res.toolCalls).toHaveLength(1)
  })

  it('still throws when the model neither spoke nor acted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ content: [] })))
    await expect(generateAnthropic(args())).rejects.toMatchObject({
      code: 'empty_response',
    })
  })

  it('sends tools as input_schema, and omits the key entirely without them', async () => {
    const withTools = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', withTools)
    await generateAnthropic(args({ tools: [TOOL] }))
    const body = sentBody(withTools) as unknown as {
      tools: { name: string; input_schema: unknown }[]
    }
    expect(body.tools[0].name).toBe('check_availability')
    expect(body.tools[0].input_schema).toEqual(TOOL.parameters)

    const noTools = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', noTools)
    await generateAnthropic(args())
    expect(sentBody(noTools)).not.toHaveProperty('tools')
  })

  it('folds consecutive tool results into one user turn, after the assistant turn', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateAnthropic(
      args({
        tools: [TOOL],
        messages: [
          { role: 'user', content: 'marcar' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'a', name: 'check_availability', arguments: { date_from: 'x' } },
              { id: 'b', name: 'check_availability', arguments: { date_from: 'y' } },
            ],
          },
          { role: 'tool', content: 'slot 1', toolCallId: 'a' },
          { role: 'tool', content: 'boom', toolCallId: 'b', isError: true },
        ],
      }),
    )

    const body = sentBody(fetchMock) as unknown as {
      messages: { role: string; content: unknown }[]
    }
    expect(body.messages).toHaveLength(3)
    // Assistant turn: no empty text block, one tool_use per call.
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'a', name: 'check_availability', input: { date_from: 'x' } },
        { type: 'tool_use', id: 'b', name: 'check_availability', input: { date_from: 'y' } },
      ],
    })
    // Both results in the single user turn that follows, error flagged.
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: 'slot 1' },
        { type: 'tool_result', tool_use_id: 'b', content: 'boom', is_error: true },
      ],
    })
  })

  it('drops a leading tool turn that would answer a call the API cannot see', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateAnthropic(
      args({
        messages: [
          { role: 'tool', content: 'orphan', toolCallId: 'gone' },
          { role: 'user', content: 'Hi' },
        ],
      }),
    )
    const body = sentBody(fetchMock) as unknown as { messages: { role: string }[] }
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
  })
})

describe('OpenAI tool calling', () => {
  it('reads tool_calls and parses their arguments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    function: {
                      name: 'check_availability',
                      arguments: '{"date_from":"2026-08-03"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    )

    const res = await generateOpenAi(args({ tools: [TOOL] }))
    expect(res.text).toBe('')
    expect(res.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'check_availability',
        arguments: { date_from: '2026-08-03' },
      },
    ])
  })

  it('surfaces malformed argument JSON on the call rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'call_1', function: { name: 'check_availability', arguments: '{oops' } },
                ],
              },
            },
          ],
        }),
      ),
    )
    const res = await generateOpenAi(args({ tools: [TOOL] }))
    expect(res.toolCalls[0].arguments).toEqual({})
    expect(res.toolCalls[0].argumentsError).toBeTruthy()
  })

  it('sends function specs with tool_choice auto, and omits both without tools', async () => {
    const withTools = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', withTools)
    await generateOpenAi(args({ tools: [TOOL] }))
    const body = sentBody(withTools) as unknown as {
      tools: { type: string; function: { name: string; parameters: unknown } }[]
      tool_choice: string
    }
    expect(body.tools[0].type).toBe('function')
    expect(body.tools[0].function.name).toBe('check_availability')
    expect(body.tools[0].function.parameters).toEqual(TOOL.parameters)
    expect(body.tool_choice).toBe('auto')

    const noTools = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', noTools)
    await generateOpenAi(args())
    expect(sentBody(noTools)).not.toHaveProperty('tools')
    expect(sentBody(noTools)).not.toHaveProperty('tool_choice')
  })

  it('re-serializes a prior assistant tool call and emits results on the tool role', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateOpenAi(
      args({
        tools: [TOOL],
        messages: [
          { role: 'user', content: 'marcar' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'call_1', name: 'check_availability', arguments: { date_from: 'x' } },
            ],
          },
          { role: 'tool', content: 'slot 1', toolCallId: 'call_1' },
        ],
      }),
    )

    const body = sentBody(fetchMock) as unknown as {
      messages: Record<string, unknown>[]
    }
    // [0] is the system prompt.
    expect(body.messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'check_availability',
            arguments: '{"date_from":"x"}',
          },
        },
      ],
    })
    expect(body.messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'slot 1',
    })
  })
})
