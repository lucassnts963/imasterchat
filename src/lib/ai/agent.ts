import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type ProviderResult,
  type ToolCall,
} from './types'
import {
  HANDOFF_SENTINEL,
  agentTimeoutMs,
  aiRequestTimeoutMs,
  maxToolSteps,
} from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { getPreset, resolveChatBaseUrl } from './providers/catalog'
import type { AgentStep, AgentTool, ToolContext } from './tools/types'

// ============================================================
// The agent loop.
//
// Without tools this is exactly what `generateReply` always did: one
// provider call, parse the handoff sentinel, return the text. With
// tools it becomes call → run tool → feed the result back → repeat,
// bounded by a step cap and a wall-clock budget.
//
// Three rules the loop keeps, because an autonomous bot talking to a
// paying customer has no one watching:
//   1. A tool failure is never an exception. It goes back to the model
//      as an error result, and the model recovers or asks for a human.
//   2. The loop always terminates — step cap, then time budget.
//   3. Running out of steps hands off. A bot that got stuck mid-task
//      must not answer as if it finished.
// ============================================================

/** Longest tool result fed back to the model. Beyond this we are paying
 *  for tokens the model will not read anyway. */
const MAX_TOOL_RESULT_CHARS = 4000

export interface RunAgentArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
  /** Tools the model may call. Omit for the plain single-shot path. */
  tools?: AgentTool[]
  /** Required when `tools` is non-empty — it is what they execute against. */
  ctx?: ToolContext
  /**
   * `required` forbids the model from answering in prose. Use it
   * where prose is not an outcome — the vault keeper has nobody to
   * talk to, so a chatty model turns its whole run into a silent
   * no-op. The catalogue must then include a tool meaning "done".
   */
  toolChoice?: 'auto' | 'required'
}

export interface RunAgentResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the run ended in a human takeover — the model asked via
   *  the sentinel, called `request_human`, or ran out of steps. */
  handoff: boolean
  /**
   * How the handoff came about, null when there wasn't one. The caller
   * needs this to know whether the conversation was *already* flagged:
   * `'tool'` means `request_human` wrote it, with a reason better than
   * anything the caller could reconstruct. The other two mean nobody
   * recorded anything yet and the caller must.
   */
  handoffSource: 'tool' | 'sentinel' | 'exhausted' | null
  /** Token usage summed across every provider call in the run. */
  usage: AiUsage | null
  /** Tools actually executed, in order. Empty for a plain reply. */
  steps: AgentStep[]
}

async function callProvider(
  config: AiConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  tools: AgentTool[],
  toolChoice: 'auto' | 'required' | undefined,
): Promise<ProviderResult> {
  // Dispatch is on the provider's WIRE FORMAT, not its name: every
  // OpenAI-compatible host (DeepSeek, OpenRouter, a self-hosted model)
  // runs through the same adapter with a different origin. Adding a
  // provider is a row in `providers/catalog.ts`, never a branch here.
  const preset = getPreset(config.provider)
  if (!preset) {
    throw new AiError(`Unsupported AI provider: ${config.provider}`, {
      code: 'unsupported_provider',
      status: 400,
    })
  }

  const baseUrl = resolveChatBaseUrl(config)
  if (!baseUrl) {
    // Only reachable for `custom` — the config route requires a base URL
    // before saving one, so this is the defensive half of that pair.
    throw new AiError(
      `${preset.label} needs an endpoint URL. Set it in Settings → AI Assistant.`,
      { code: 'missing_base_url', status: 400 },
    )
  }

  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    baseUrl,
    providerLabel: preset.label,
    systemPrompt,
    messages,
    timeoutMs: aiRequestTimeoutMs(),
    // Strip `execute` — the wire format has no business carrying it.
    tools: tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    toolChoice,
  }

  switch (preset.wire) {
    case 'openai':
      return generateOpenAi(providerArgs)
    case 'anthropic':
      return generateAnthropic(providerArgs)
    default: {
      // Exhaustiveness guard: a WireFormat added to the catalog without
      // an adapter here fails loudly at the call, not silently at build.
      const unreachable: never = preset.wire
      throw new AiError(`Unsupported wire format: ${String(unreachable)}`, {
        code: 'unsupported_provider',
        status: 400,
      })
    }
  }
}

/** Sum usage across calls, treating "provider reported nothing" as zero
 *  rather than letting one silent call erase the whole run's total. */
function addUsage(total: AiUsage | null, next: AiUsage | null): AiUsage | null {
  if (!next) return total
  if (!total) return { ...next }
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(truncated)`
}

/**
 * Run one tool call. Never throws: an unknown name, arguments the model
 * mangled, or a tool that blew up all come back as an error result the
 * model can read and react to.
 */
async function runToolCall(
  call: ToolCall,
  tools: AgentTool[],
  ctx: ToolContext,
): Promise<{ outcome: ToolOutcomeInternal; step: AgentStep }> {
  const startedAt = Date.now()
  const finish = (outcome: ToolOutcomeInternal) => ({
    outcome,
    step: {
      toolName: call.name,
      arguments: call.arguments,
      result: outcome.content,
      isError: Boolean(outcome.isError),
      durationMs: Date.now() - startedAt,
    },
  })

  if (call.argumentsError) {
    return finish({ content: call.argumentsError, isError: true })
  }

  const tool = tools.find((t) => t.name === call.name)
  if (!tool) {
    // Can happen when the catalog changes mid-conversation (the account
    // disconnects Google between turns) and the model is still working
    // from the older transcript.
    return finish({
      content: `Unknown tool '${call.name}'. It is not available on this account.`,
      isError: true,
    })
  }

  try {
    const outcome = await tool.execute(call.arguments, ctx)
    return finish({ ...outcome, content: truncate(outcome.content) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ai agent] tool '${call.name}' threw:`, err)
    return finish({ content: `Tool failed: ${message}`, isError: true })
  }
}

interface ToolOutcomeInternal {
  content: string
  isError?: boolean
  handoff?: boolean
}

/**
 * Generate the next reply, running any tools the model asks for along
 * the way. `generateReply` is this function with no tools.
 */
export async function runAgent(args: RunAgentArgs): Promise<RunAgentResult> {
  const { config, systemPrompt, tools = [], ctx, toolChoice } = args
  if (tools.length > 0 && !ctx) {
    throw new AiError('runAgent was given tools but no ToolContext.', {
      code: 'agent_misconfigured',
      status: 500,
    })
  }

  const messages: ChatMessage[] = [...args.messages]
  const steps: AgentStep[] = []
  const deadline = Date.now() + agentTimeoutMs()
  const stepCap = tools.length > 0 ? maxToolSteps(config) : 1

  let usage: AiUsage | null = null

  for (let step = 0; step < stepCap; step++) {
    const result = await callProvider(
      config,
      systemPrompt,
      messages,
      tools,
      toolChoice,
    )
    usage = addUsage(usage, result.usage)

    if (result.toolCalls.length === 0) {
      // The model answered. This is the only exit that produces a reply.
      const handoff = result.text.includes(HANDOFF_SENTINEL)
      const text = result.text.split(HANDOFF_SENTINEL).join('').trim()
      return {
        text,
        handoff,
        handoffSource: handoff ? 'sentinel' : null,
        usage,
        steps,
      }
    }

    messages.push({
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls,
    })

    for (const call of result.toolCalls) {
      const { outcome, step: executed } = await runToolCall(call, tools, ctx!)
      steps.push(executed)
      messages.push({
        role: 'tool',
        content: outcome.content,
        toolCallId: call.id,
        isError: outcome.isError,
      })

      if (outcome.handoff) {
        // A human owns the thread from here. Whatever the model had
        // already written this turn still goes out — it is usually the
        // "let me get someone for you" line.
        return {
          text: result.text.split(HANDOFF_SENTINEL).join('').trim(),
          handoff: true,
          handoffSource: 'tool',
          usage,
          steps,
        }
      }
    }

    if (Date.now() >= deadline) {
      console.warn(
        `[ai agent] wall-clock budget exhausted after ${steps.length} tool call(s) — handing off.`,
      )
      break
    }
  }

  // Out of steps or out of time with the model still working. Answering
  // now would mean answering mid-task, so hand off instead: the customer
  // gets a person rather than a half-finished thought.
  console.warn(
    `[ai agent] no final answer after ${steps.length} tool call(s) — handing off.`,
  )
  return { text: '', handoff: true, handoffSource: 'exhausted', usage, steps }
}
