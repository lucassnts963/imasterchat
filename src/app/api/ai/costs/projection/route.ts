import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { projectReplyCost } from '@/lib/ai/cost-projection'

// ============================================================
// GET /api/ai/costs/projection  (admin+)
//
// What one reply costs and where the cost sits, assembled from the same
// builders the customer-facing path uses — so it moves when the vault
// grows, a guardrail is added, or scheduling is switched on.
//
// Read with `requireActive: false`: an operator deciding whether to
// turn the agent on is exactly the person who needs to know what it
// will cost, and they have not turned it on yet.
// ============================================================

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch(() => null)

    if (!config) {
      return NextResponse.json({ configured: false })
    }

    const projection = await projectReplyCost(supabase, accountId, config)
    return NextResponse.json({
      configured: true,
      model: config.model,
      provider: config.provider,
      ...projection,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
