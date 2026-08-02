import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig, ToolSpec } from '../types'

// ============================================================
// What a tool *is* in this codebase.
//
// A tool is data: a wire spec the model reads (`ToolSpec`) plus an
// `execute` the server runs. The model chooses WHICH tool and WHEN; it
// never decides whether the action is allowed — every rule lives on
// this side of the boundary, in `execute`.
// ============================================================

/** Everything a tool needs to do its work, resolved once per run. */
export interface ToolContext {
  /** Service-role client in the auto-reply path, SSR client in the
   *  Playground. Tools must not assume an `auth.uid()`. */
  db: SupabaseClient
  accountId: string
  /** Null in the Playground, where there is no real thread yet. Tools
   *  that need a conversation must say so and fail cleanly. */
  conversationId: string | null
  contactId: string | null
  config: AiConfig
  /**
   * Playground. Tools validate everything they normally would — the
   * rules, the availability, the collision — and then report what they
   * WOULD have done instead of doing it.
   *
   * The alternative was letting the Playground book for real, which
   * would put rehearsal events in the shop's own Google Calendar and
   * rehearsal rows in its history. The point of the harness is to run
   * the production code path, not to write production data.
   */
  dryRun?: boolean
}

/** What a tool hands back. */
export interface ToolOutcome {
  /**
   * What the model sees. It goes straight back into the prompt, so keep
   * it short and factual — this is a message to a reader, not a dump.
   */
  content: string
  /** The tool could not do the job. The model gets the reason and can
   *  retry differently or hand off; it is never an exception. */
  isError?: boolean
  /**
   * Stop the loop: this conversation belongs to a human now. Set by
   * `request_human`, and by any tool whose failure means the bot must
   * not keep talking (a booking that half-succeeded, say).
   */
  handoff?: boolean
}

/** A tool the agent loop can actually run. */
export interface AgentTool extends ToolSpec {
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>
}

/** One executed step, for the audit trail and the Playground. */
export interface AgentStep {
  toolName: string
  arguments: Record<string, unknown>
  /** The `content` the model received back. */
  result: string
  isError: boolean
  durationMs: number
}
