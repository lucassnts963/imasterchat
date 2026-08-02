import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runVaultKeeper } from '@/lib/ai/vault/keeper'

// ============================================================
// GET /api/ai/vault/keeper  (cron)
//
// Sweeps conversations that have gone quiet and lets the keeper decide
// what the wiki should learn from each.
//
// A sweep rather than a hook on "conversation closed", because most
// conversations never get closed — they just stop. Waiting for an
// explicit close would mean learning from the tidy minority and missing
// the rest, which is most of them.
//
// Shares AUTOMATION_CRON_SECRET with the other scheduled endpoints so
// operators keep one secret rather than collecting them.
// ============================================================

/** A thread is "over" once it has been quiet this long. Short enough to
 *  learn the same day, long enough that a customer who steps away for
 *  lunch does not get their conversation ingested mid-sentence. */
const IDLE_MINUTES = 90

/** Bounded per sweep: each conversation costs provider calls on the
 *  account's own key, and a backlog is better drained over several runs
 *  than in one surprise bill. */
const MAX_PER_SWEEP = 10

interface ConversationRow {
  id: string
  account_id: string
  contact_id: string | null
  updated_at: string
}

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const idleBefore = new Date(Date.now() - IDLE_MINUTES * 60_000).toISOString()
  // Do not walk the whole history on the first ever run: a shop with
  // years of conversations would ingest all of them at once.
  const lookbackFrom = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

  const { data, error } = await db
    .from('conversations')
    .select('id, account_id, contact_id, updated_at')
    .lt('updated_at', idleBefore)
    .gt('updated_at', lookbackFrom)
    .order('updated_at', { ascending: false })
    .limit(MAX_PER_SWEEP * 6)

  if (error) {
    console.error('[vault keeper cron] conversation query failed:', error)
    return NextResponse.json({ error: 'query failed' }, { status: 500 })
  }

  const candidates = (data ?? []) as ConversationRow[]

  // Which of these the vault has already read. One query rather than one
  // per conversation — and `ref_id` is what makes ingestion idempotent
  // even if a sweep is retried mid-flight.
  const { data: seenRows } = await db
    .from('ai_vault_sources')
    .select('ref_id')
    .eq('kind', 'conversation')
    .in(
      'ref_id',
      candidates.map((c) => c.id),
    )
  const seen = new Set(
    ((seenRows ?? []) as { ref_id: string | null }[])
      .map((r) => r.ref_id)
      .filter(Boolean),
  )

  const pending = candidates.filter((c) => !seen.has(c.id)).slice(0, MAX_PER_SWEEP)

  let ran = 0
  let proposed = 0
  for (const conversation of pending) {
    // Sequential on purpose. These share one provider key per account,
    // and a burst is exactly what trips a rate limit — this job has all
    // the time in the world.
    const result = await runVaultKeeper(db, {
      accountId: conversation.account_id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
    })
    if (result.ran) ran += 1
    proposed += result.pagesProposed
  }

  return NextResponse.json({
    considered: pending.length,
    ran,
    pages_proposed: proposed,
  })
}
