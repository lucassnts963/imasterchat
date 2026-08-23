import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { BUILTIN_GUARDRAILS } from '@/lib/ai/guardrails'

// ============================================================
// GET    /api/ai/guardrails   (any member) — list, seeding the defaults
// POST   /api/ai/guardrails   (admin+)     — add one
// PATCH  /api/ai/guardrails   (admin+)     — toggle / edit one
// DELETE /api/ai/guardrails?id=            (admin+) — remove one
//
// The defaults are seeded on first read rather than by the migration.
// A migration would have to loop over every account that exists and
// then never run again for the ones created afterwards; seeding here
// means an account gets them the first time anyone looks, including
// accounts created next year.
//
// Seeding on a GET is a write on a read, which is worth being uneasy
// about — it is bounded to once per account by the unique constraint,
// and the alternative is shipping a bot with no guardrails to anyone
// who never opens this screen.
// ============================================================

const SELECT = 'id, kind, value, note, is_active, is_builtin, created_at'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { count } = await supabase
      .from('ai_handoff_guardrails')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)

    if (!count) {
      // `upsert` with the unique constraint makes a concurrent second
      // request a no-op rather than a duplicate-key error.
      const { error: seedErr } = await supabase
        .from('ai_handoff_guardrails')
        .upsert(
          BUILTIN_GUARDRAILS.map((g) => ({
            account_id: accountId,
            kind: g.kind,
            value: g.value,
            note: g.note,
            is_builtin: true,
          })),
          { onConflict: 'account_id,kind,value', ignoreDuplicates: true },
        )
      // A member without admin cannot seed (the INSERT policy is
      // admin+). Not an error worth failing the read over — they simply
      // see an empty list until an admin opens it.
      if (seedErr) {
        console.warn('[ai/guardrails] could not seed defaults:', seedErr.message)
      }
    }

    const { data, error } = await supabase
      .from('ai_handoff_guardrails')
      .select(SELECT)
      .eq('account_id', accountId)
      .order('is_builtin', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[ai/guardrails GET] error:', error)
      return NextResponse.json(
        { error: 'Failed to load the guardrails' },
        { status: 500 },
      )
    }

    return NextResponse.json({ guardrails: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null

    const kind = body?.kind
    const value = typeof body?.value === 'string' ? body.value.trim() : ''
    if ((kind !== 'topic' && kind !== 'keyword') || !value) {
      return NextResponse.json(
        { error: "'kind' must be 'topic' or 'keyword', and 'value' is required" },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('ai_handoff_guardrails')
      .insert({
        account_id: accountId,
        kind,
        value: value.slice(0, 200),
        note: typeof body?.note === 'string' ? body.note.slice(0, 300) : null,
        created_by: userId,
      })
      .select(SELECT)
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Essa regra já existe.', code: 'duplicate' },
          { status: 409 },
        )
      }
      console.error('[ai/guardrails POST] error:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ guardrail: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!id) {
      return NextResponse.json({ error: "'id' is required" }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    if (typeof body?.is_active === 'boolean') update.is_active = body.is_active
    if (typeof body?.value === 'string' && body.value.trim()) {
      update.value = body.value.trim().slice(0, 200)
    }
    if (typeof body?.note === 'string') update.note = body.note.slice(0, 300)
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('ai_handoff_guardrails')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SELECT)
      .single()

    if (error) {
      console.error('[ai/guardrails PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }
    return NextResponse.json({ guardrail: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = new URL(request.url).searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: "'id' is required" }, { status: 400 })
    }

    const { error } = await supabase
      .from('ai_handoff_guardrails')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) {
      console.error('[ai/guardrails DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    }
    return NextResponse.json({ deleted: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
