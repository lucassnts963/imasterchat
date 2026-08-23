import {
  AiError,
  type ChatMessage,
  type ProviderResult,
  type ToolCall,
} from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  parseToolArguments,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

interface OpenAiToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAiResponse {
  choices?: {
    message?: { content?: string; tool_calls?: OpenAiToolCall[] }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Map our provider-neutral turns onto Chat Completions' shape.
 *
 * Tool results are their own `tool` role here (Anthropic instead folds
 * them into a user turn), and an assistant turn that called tools
 * carries `tool_calls` with the arguments re-serialized to the JSON
 * string the API expects. Text-only turns pass through unchanged.
 */
function toOpenAiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        // The API wants null, not '', when the turn is pure tool calls.
        content: m.content.trim() || null,
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        })),
      }
    }
    return { role: m.role, content: m.content }
  })
}

/**
 * Call a Chat Completions endpoint with the caller's own key.
 *
 * Not OpenAI-specific despite the name: this is the OpenAI *wire
 * format*, which DeepSeek, OpenRouter and every other OpenAI-compatible
 * host also speak. `baseUrl` is what selects the destination — see
 * `providers/catalog.ts`.
 *
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const {
    apiKey,
    model,
    baseUrl,
    providerLabel,
    systemPrompt,
    messages,
    timeoutMs,
    tools,
    toolChoice,
  } = args

  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...toOpenAiMessages(mergeConsecutive(messages)),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        // Omitted entirely when the account has no tools, so the request
        // stays identical to the pre-tool-calling one.
        ...(tools?.length
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
              tool_choice: toolChoice ?? 'auto',
            }
          : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(providerLabel, res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const message = data?.choices?.[0]?.message
  const raw = message?.content
  const text = typeof raw === 'string' ? raw.trim() : ''

  const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
    .filter((c) => c.id && c.function?.name)
    .map((c) => ({
      id: c.id!,
      name: c.function!.name!,
      ...parseToolArguments(c.function?.arguments),
    }))

  // Empty is only a failure when the model neither spoke nor acted —
  // a turn that is purely tool calls arrives with content: null.
  if (!text && toolCalls.length === 0) {
    throw new AiError(`${providerLabel} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage, toolCalls }
}
