import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentStep } from './tools/types'

// ============================================================
// The audit trail for tool calls.
//
// When a bot books an appointment on its own, "why did it do that?" has
// to be answerable — by the operator looking at a booking they did not
// expect, and by us reading a bug report. One row per executed tool,
// with the arguments the model chose and what came back.
//
// Best-effort, exactly like `logAiUsage`: bookkeeping must never break
// a reply the customer is waiting on.
// ============================================================

export interface RecordAgentStepsArgs {
  accountId: string
  conversationId: string | null
  steps: AgentStep[]
}

export async function recordAgentSteps(
  db: SupabaseClient,
  args: RecordAgentStepsArgs,
): Promise<void> {
  const { accountId, conversationId, steps } = args
  if (steps.length === 0) return

  try {
    const rows = steps.map((step, index) => ({
      account_id: accountId,
      conversation_id: conversationId,
      step_index: index,
      tool_name: step.toolName,
      arguments: step.arguments,
      result: step.result,
      is_error: step.isError,
      duration_ms: step.durationMs,
    }))

    const { error } = await db.from('ai_agent_steps').insert(rows)
    if (error) {
      console.error('[ai steps] failed to record agent steps:', error)
    }
  } catch (err) {
    console.error('[ai steps] failed to record agent steps:', err)
  }
}
