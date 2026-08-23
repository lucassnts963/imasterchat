import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { defaultPrices } from '@/lib/ai/pricing'
import { fetchUsdToBrl, loadExchangeRate } from '@/lib/ai/price-store'

// ============================================================
// GET   /api/admin/pricing   (platform admin) — prices + the FX rate
// PATCH /api/admin/pricing   (platform admin) — edit one, or refresh FX
//
// Global facts, not account settings: a model's list price is the same
// for everybody and so is the dollar. Gated on `is_platform_admin`
// rather than the account's admin role, so one shop's typo cannot
// become another shop's budget.
//
// Seeded from the code table on first read, for the same reason the
// guardrails are: a migration would fill the table for the deployments
// that exist today and never for the ones set up next month.
// ============================================================

async function requirePlatformAdmin() {
  const ctx = await getCurrentAccount({ allowBlocked: true })
  if (!ctx.isPlatformAdmin) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
  return ctx
}

export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin()

    const { count } = await supabase
      .from('ai_model_prices')
      .select('model_prefix', { count: 'exact', head: true })

    if (!count) {
      const { error } = await supabase
        .from('ai_model_prices')
        .upsert(defaultPrices(), {
          onConflict: 'model_prefix',
          ignoreDuplicates: true,
        })
      if (error) console.warn('[admin/pricing] seed failed:', error.message)
    }

    const [{ data: prices }, rate] = await Promise.all([
      supabase
        .from('ai_model_prices')
        .select('model_prefix, provider, input_usd, output_usd, updated_at')
        .order('provider', { ascending: true })
        .order('input_usd', { ascending: true }),
      loadExchangeRate(supabase, 'BRL'),
    ])

    return NextResponse.json({ prices: prices ?? [], rate })
  } catch (err) {
    if ((err as { status?: number }).status === 403) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, userId } = await requirePlatformAdmin()
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null

    // Ask the exchange API for a fresh figure, on demand. The same work
    // the scheduled sweep does — exposed here so an admin who does not
    // trust the age shown on screen can settle it immediately.
    if (body?.action === 'refresh_rate') {
      const fetched = await fetchUsdToBrl()
      if (fetched === null) {
        return NextResponse.json(
          { error: 'Não foi possível obter a cotação agora.', code: 'fetch_failed' },
          { status: 502 },
        )
      }
      const { error } = await supabase.from('exchange_rates').upsert(
        {
          currency: 'BRL',
          usd_rate: fetched,
          source: 'auto',
          fetched_at: new Date().toISOString(),
          updated_by: userId,
        },
        { onConflict: 'currency' },
      )
      if (error) {
        console.error('[admin/pricing] rate write failed:', error)
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
      }
      return NextResponse.json({ rate: await loadExchangeRate(supabase, 'BRL') })
    }

    if (typeof body?.usd_rate === 'number') {
      const rate = Number(body.usd_rate)
      if (!Number.isFinite(rate) || rate <= 0 || rate > 50) {
        return NextResponse.json(
          { error: 'Cotação fora de qualquer faixa plausível.' },
          { status: 400 },
        )
      }
      const { error } = await supabase.from('exchange_rates').upsert(
        {
          currency: 'BRL',
          usd_rate: rate,
          // A hand-entered figure is a correction and says so. It stands
          // until the next successful fetch rather than pinning forever.
          source: 'manual',
          fetched_at: new Date().toISOString(),
          updated_by: userId,
        },
        { onConflict: 'currency' },
      )
      if (error) {
        console.error('[admin/pricing] manual rate failed:', error)
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
      }
      return NextResponse.json({ rate: await loadExchangeRate(supabase, 'BRL') })
    }

    const prefix =
      typeof body?.model_prefix === 'string' ? body.model_prefix.trim() : ''
    const input = Number(body?.input_usd)
    const output = Number(body?.output_usd)
    if (!prefix || !Number.isFinite(input) || !Number.isFinite(output)) {
      return NextResponse.json(
        { error: "'model_prefix', 'input_usd' and 'output_usd' are required" },
        { status: 400 },
      )
    }
    if (input < 0 || output < 0) {
      return NextResponse.json({ error: 'Preço negativo.' }, { status: 400 })
    }

    const { error } = await supabase
      .from('ai_model_prices')
      .update({ input_usd: input, output_usd: output, updated_by: userId })
      .eq('model_prefix', prefix)

    if (error) {
      console.error('[admin/pricing] price update failed:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }
    return NextResponse.json({ model_prefix: prefix, input_usd: input, output_usd: output })
  } catch (err) {
    if ((err as { status?: number }).status === 403) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return toErrorResponse(err)
  }
}
