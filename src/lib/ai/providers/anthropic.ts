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
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicBlock {
  type?: string
  text?: string
  /** tool_use */
  id?: string
  name?: string
  input?: unknown
}

interface AnthropicResponse {
  content?: AnthropicBlock[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** One entry of the `messages` array Anthropic accepts. */
interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | Record<string, unknown>[]
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 *
 * Leading `tool` turns go too: with the assistant turn that requested
 * them gone, they'd be tool results answering a call Anthropic can't
 * see, which is a hard API error.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (
    merged.length > 0 &&
    (merged[0].role === 'assistant' || merged[0].role === 'tool')
  ) {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

/**
 * Map our provider-neutral turns onto Anthropic's block format.
 *
 * The two shapes that only exist once tools do:
 *   - an assistant turn that called tools becomes a content array of an
 *     optional `text` block plus one `tool_use` block per call;
 *   - tool results are **user** turns carrying `tool_result` blocks, and
 *     every result for a given assistant turn has to arrive in the one
 *     user message right after it — so consecutive tool turns are folded
 *     together here rather than emitted one per message.
 *
 * A text-only transcript maps to plain strings, byte for byte what this
 * adapter sent before tools existed.
 */
function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []

  for (const m of messages) {
    if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }

    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: Record<string, unknown>[] = []
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content })
      for (const call of m.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments,
        })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }

    out.push({ role: m.role, content: m.content })
  }

  return out
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
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
    res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: toAnthropicMessages(normalizeForAnthropic(messages)),
        // Omitted entirely when the account has no tools — the request
        // stays identical to the pre-tool-calling one.
        ...(tools?.length
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
              // Anthropic spells "you must call something" as `any`.
              ...(toolChoice === 'required'
                ? { tool_choice: { type: 'any' } }
                : {}),
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

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null
  const blocks = data?.content ?? []

  const text = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()

  // Read tool_use blocks instead of dropping them. The old filter kept
  // only `type === 'text'`, so a tool call would have vanished here and
  // surfaced as "empty response" — a silent failure with no clue in it.
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === 'tool_use' && b.id && b.name)
    .map((b) => ({
      id: b.id!,
      name: b.name!,
      // Anthropic sends `input` already parsed, so there is no malformed
      // JSON case here (unlike OpenAI).
      arguments:
        b.input && typeof b.input === 'object' && !Array.isArray(b.input)
          ? (b.input as Record<string, unknown>)
          : {},
    }))

  // Empty is only a failure when the model neither spoke nor acted —
  // answering purely with a tool call is a normal, complete turn.
  if (!text && toolCalls.length === 0) {
    throw new AiError(`${providerLabel} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  // Anthropic reports input/output but no total — normalizeUsage sums.
  const usage = normalizeUsage({
    prompt: data?.usage?.input_tokens,
    completion: data?.usage?.output_tokens,
  })
  return { text, usage, toolCalls }
}
