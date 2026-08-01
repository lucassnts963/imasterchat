import type { SupabaseClient } from '@supabase/supabase-js'
import { requestHumanTool } from './handoff'
import type { AgentTool } from './types'

// ============================================================
// What tools an account's agent actually gets.
//
// The catalog is built per run, not declared once, because it depends
// on how the account is set up: no Google connection means the
// scheduling tools do not exist as far as the model is concerned. That
// is deliberate — a tool the model can see is a tool it will try, and
// "I called book_appointment and it said not configured" is a worse
// conversation than never offering to book at all.
//
// A tool being absent is the strongest possible permission check, and
// it costs no prompt tokens.
// ============================================================

export interface BuildToolsArgs {
  db: SupabaseClient
  accountId: string
  /** Null in the Playground. Tools needing a thread degrade gracefully. */
  conversationId: string | null
}

/**
 * Resolve the tools available to this account right now.
 *
 * `request_human` is unconditional: any agent that can talk to a
 * customer must be able to stop and call a person.
 */
export async function buildToolCatalog(
  args: BuildToolsArgs,
): Promise<AgentTool[]> {
  const tools: AgentTool[] = [requestHumanTool]

  // Scheduling tools land here once the account has a Google Calendar
  // connection and active scheduling rules (phase 2).
  void args

  return tools
}
