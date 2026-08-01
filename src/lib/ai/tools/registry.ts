import type { SupabaseClient } from '@supabase/supabase-js'
import type { GoogleConnection } from '@/lib/google/connection'
import { loadGoogleConnection } from '@/lib/google/connection'
import {
  loadSchedulingSettings,
  type SchedulingSettings,
} from '@/lib/scheduling/settings'
import { requestHumanTool } from './handoff'
import { buildSchedulingTools } from './scheduling'
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

/** Everything scheduling needs, resolved once per run. */
export interface SchedulingContext {
  settings: SchedulingSettings
  /** Null when no calendar is connected — bookings still record, they
   *  just live only in the CRM. */
  connection: GoogleConnection | null
}

/**
 * Is autonomous scheduling live for this account, and with what?
 *
 * Returns null when it is switched off, or on but unusable. Resolved
 * once by the caller and handed to both the tool catalog and the
 * environment block, so a single inbound message does not load the same
 * settings twice.
 */
export async function resolveSchedulingContext(
  db: SupabaseClient,
  accountId: string,
): Promise<SchedulingContext | null> {
  const settings = await loadSchedulingSettings(db, accountId)
  if (!settings?.isActive) return null

  // A connection is not required: without one, bookings still land in
  // `appointments` and availability comes from our own rows. Worse
  // product — the optician's hand-blocked day is invisible — but a
  // coherent one, and it keeps the feature demoable before OAuth is set
  // up.
  try {
    return { settings, connection: await loadGoogleConnection(db, accountId) }
  } catch (err) {
    // Credentials exist but are unusable; the operator must reconnect.
    // Offering the tools anyway would have the bot promising times it
    // cannot verify.
    console.error('[ai tools] scheduling disabled, calendar unusable:', err)
    return null
  }
}

export interface BuildToolsArgs {
  db: SupabaseClient
  accountId: string
  /** Null in the Playground. Tools needing a thread degrade gracefully. */
  conversationId: string | null
  /** From `resolveSchedulingContext`. Null → no scheduling tools. */
  scheduling?: SchedulingContext | null
}

/**
 * Resolve the tools available to this account right now.
 *
 * `request_human` is unconditional: any agent that can talk to a
 * customer must be able to stop and call a person. Scheduling appears
 * only when it is switched on — and when it is off the tools do not
 * merely fail, they are absent, so the model cannot offer to book and
 * then discover it can't.
 */
export async function buildToolCatalog(
  args: BuildToolsArgs,
): Promise<AgentTool[]> {
  const tools: AgentTool[] = [requestHumanTool]

  const scheduling =
    args.scheduling === undefined
      ? await resolveSchedulingContext(args.db, args.accountId)
      : args.scheduling
  if (scheduling) {
    tools.push(...buildSchedulingTools(scheduling))
  }

  return tools
}
