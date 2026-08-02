import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { fetchUsdToBrl } from '@/lib/ai/price-store'

// ============================================================
// GET /api/exchange/cron  (cron)
//
// Keeps USD→BRL current so the cost screens can show a figure in the
// money the shop owner actually thinks in.
//
// The stale-rate problem is why this exists. A hand-entered rate is
// correct the day it is typed and wrong every day after, with no
// symptom — the dollar moves daily and a three-month-old figure looks
// exactly as authoritative as a fresh one. The scheduled fetch keeps it
// honest; the manual override stays for when it cannot, or when the
// admin disagrees.
//
// A failed fetch changes nothing. Whatever is stored keeps standing,
// and `fetched_at` keeps ageing, so the screen tells the truth about
// how old the number is instead of silently serving a stale one as new.
//
// Shares AUTOMATION_CRON_SECRET with every other scheduled endpoint —
// one secret per operator, not a collection.
// ============================================================

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

  const rate = await fetchUsdToBrl()
  if (rate === null) {
    // 200, not an error status: the sweep ran and did its job, which
    // today was "leave the previous figure alone". A 5xx here would put
    // a red line in someone's monitoring for a third party being down.
    return NextResponse.json({ updated: false, reason: 'fetch_failed' })
  }

  const db = supabaseAdmin()
  const { error } = await db.from('exchange_rates').upsert(
    {
      currency: 'BRL',
      usd_rate: rate,
      source: 'auto',
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'currency' },
  )

  if (error) {
    console.error('[exchange cron] write failed:', error)
    return NextResponse.json({ updated: false, reason: 'write_failed' }, { status: 500 })
  }

  return NextResponse.json({ updated: true, usd_brl: rate })
}
