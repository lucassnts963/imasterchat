import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { approvePage, archivePage, VAULT_PAGE_COLUMNS } from '@/lib/ai/vault/store'

// ============================================================
// GET   /api/ai/vault/{id}   (any member) — the page and its evidence
// PATCH /api/ai/vault/{id}   (agent+)     — approve, edit, or retire
//
// The curation surface. Approving is what makes a page reach customers,
// so it is the one action here that changes what the bot says.
// ============================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params

    const { data: page, error } = await supabase
      .from('ai_vault_pages')
      .select(`${VAULT_PAGE_COLUMNS}, contacts(name, phone)`)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/vault/:id GET] error:', error)
      return NextResponse.json({ error: 'Failed to load the page' }, { status: 500 })
    }
    if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // The evidence. A curator approving a claim about a price should be
    // able to see the message it came from without leaving the screen.
    const { data: sources } = await supabase
      .from('ai_vault_page_sources')
      .select('excerpt, ai_vault_sources(id, kind, title, content, created_at)')
      .eq('page_id', id)

    const { data: revisions } = await supabase
      .from('ai_vault_revisions')
      .select('operation, actor_id, note, created_at')
      .eq('page_id', id)
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      page,
      sources: sources ?? [],
      revisions: revisions ?? [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { id } = await params

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    if (body.status === 'archived') {
      const page = await archivePage(supabase, {
        accountId,
        pageId: id,
        actorId: userId,
        note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
        // A draft turned down is a rejection; an approved page retired is
        // an archive. Same end state, different story in the log.
        operation: body.operation === 'rejected' ? 'rejected' : 'archived',
      })
      if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ page })
    }

    if (body.status === 'approved') {
      const page = await approvePage(supabase, {
        accountId,
        pageId: id,
        actorId: userId,
        content: typeof body.content === 'string' ? body.content : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
      })
      if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ page })
    }

    return NextResponse.json(
      { error: "'status' must be 'approved' or 'archived'" },
      { status: 400 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
