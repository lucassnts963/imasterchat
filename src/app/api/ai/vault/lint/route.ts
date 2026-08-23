import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { lintVault } from '@/lib/ai/vault/lint'

// ============================================================
// GET /api/ai/vault/lint  (any member)
//
// Computed on request rather than stored. Every finding is derived from
// the pages as they stand right now, so a cached report would mostly be
// wrong — and a curator who fixes a contradiction wants the next load to
// show it gone, not a stale row saying it is still there.
// ============================================================

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const findings = await lintVault(supabase, accountId)
    return NextResponse.json({
      findings,
      // Split out so the tab can show a count of the things that
      // actually change what a customer is told.
      warnings: findings.filter((f) => f.severity === 'warning').length,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
