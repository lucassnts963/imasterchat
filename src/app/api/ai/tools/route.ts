import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { requestHumanTool } from '@/lib/ai/tools/handoff'
import { buildSchedulingTools } from '@/lib/ai/tools/scheduling'
import {
  ALWAYS_ON_TOOLS,
  loadDisabledTools,
  resolveSchedulingContext,
} from '@/lib/ai/tools/registry'
import { loadSchedulingSettings } from '@/lib/scheduling/settings'
import { hasGoogleConnection } from '@/lib/google/connection'

// ============================================================
// GET   /api/ai/tools   (any member) — what the agent can do, and why
// PATCH /api/ai/tools   (admin+)     — switch one on or off
//
// The catalogue was a closed list nobody could see. Worse than closed:
// when scheduling is off the tools are ABSENT rather than disabled, so
// the screen showed nothing and the agent behaved like a plain chatbot
// with no explanation anywhere. That cost a whole session to diagnose.
//
// So this reports every tool the build knows about, whether it is
// currently in the catalogue, and — when it is not — which of the two
// reasons applies: a prerequisite is unmet, or the account turned it
// off. Those look identical from the outside and are fixed in entirely
// different places.
// ============================================================

interface ToolInfo {
  name: string
  description: string
  /** In the catalogue right now — i.e. the model can actually call it. */
  available: boolean
  /** Why not, when it is not. Null when it is. */
  blocked_by: 'prerequisite' | 'disabled' | null
  /** What to do about it, as a key the UI translates. */
  requirement: string | null
  /** False for request_human: the switch is not offered. */
  can_toggle: boolean
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const [scheduling, disabled, settings, googleConnected] = await Promise.all([
      resolveSchedulingContext(supabase, accountId),
      loadDisabledTools(supabase, accountId),
      loadSchedulingSettings(supabase, accountId),
      hasGoogleConnection(supabase, accountId),
    ])

    const tools: ToolInfo[] = []

    tools.push({
      name: requestHumanTool.name,
      description: requestHumanTool.description,
      available: true,
      blocked_by: null,
      requirement: null,
      can_toggle: false,
    })

    // Describe the scheduling tools even when they are not loaded — the
    // whole point is that the operator can see what exists and what is
    // standing in the way.
    const schedulingTools = buildSchedulingTools(
      scheduling ?? {
        settings: settings ?? {
          timezone: 'America/Sao_Paulo',
          slotMinutes: 60,
          leadTimeMinutes: 120,
          maxAdvanceDays: 30,
          weeklyHours: [[], [], [], [], [], [], []],
          appointmentLabel: null,
          isActive: false,
        },
        connection: null,
      },
    )

    for (const tool of schedulingTools) {
      const off = disabled.has(tool.name)
      // Order matters: an unmet prerequisite is the more actionable
      // answer, and reporting "disabled" for an account that never
      // connected Google would send them to the wrong switch.
      const prerequisiteUnmet = !scheduling
      tools.push({
        name: tool.name,
        description: tool.description,
        available: !prerequisiteUnmet && !off,
        blocked_by: prerequisiteUnmet ? 'prerequisite' : off ? 'disabled' : null,
        requirement: prerequisiteUnmet
          ? !settings?.isActive
            ? 'scheduling_off'
            : !googleConnected
              ? 'google_disconnected'
              : 'calendar_unusable'
          : null,
        can_toggle: true,
      })
    }

    return NextResponse.json({ tools })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null

    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const enabled = body?.enabled
    if (!name || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: "'name' and boolean 'enabled' are required" },
        { status: 400 },
      )
    }

    if (ALWAYS_ON_TOOLS.has(name)) {
      // Refused on the server too, not only hidden in the UI: this is
      // the agent's only way to stop, and a client that has drifted
      // must not be able to take it away.
      return NextResponse.json(
        { error: 'Essa ferramenta não pode ser desligada.', code: 'always_on' },
        { status: 400 },
      )
    }

    const { error } = enabled
      ? await supabase
          .from('ai_disabled_tools')
          .delete()
          .eq('account_id', accountId)
          .eq('tool_name', name)
      : await supabase
          .from('ai_disabled_tools')
          .upsert(
            { account_id: accountId, tool_name: name, disabled_by: userId },
            { onConflict: 'account_id,tool_name' },
          )

    if (error) {
      console.error('[ai/tools PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ name, enabled })
  } catch (err) {
    return toErrorResponse(err)
  }
}
