import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { createPage, createSource, VAULT_PAGE_COLUMNS } from '@/lib/ai/vault/store'
import { isVaultPageKind } from '@/lib/ai/vault/schema'

// ============================================================
// GET  /api/ai/vault?status=&kind=   (any member) — browse the wiki
// POST /api/ai/vault                 (agent+)     — write a page by hand
//
// A human writing straight into the vault still goes through
// `createPage`, so it still needs a source: the note they typed becomes
// one. FAITHFULNESS is not a rule for the agent, it is a rule for the
// vault — a page whose evidence is "someone said so once, months ago"
// is exactly what the citation is there to prevent.
// ============================================================

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)

    let query = supabase
      .from('ai_vault_pages')
      .select(`${VAULT_PAGE_COLUMNS}, contacts(name, phone)`)
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(500)

    const status = url.searchParams.get('status')
    if (status && ['draft', 'approved', 'archived'].includes(status)) {
      query = query.eq('status', status)
    }
    const kind = url.searchParams.get('kind')
    if (kind && isVaultPageKind(kind)) query = query.eq('kind', kind)

    const { data, error } = await query
    if (error) {
      console.error('[ai/vault GET] error:', error)
      return NextResponse.json({ error: 'Failed to load the vault' }, { status: 500 })
    }

    // Counts drive the tab badges; cheap enough to compute here rather
    // than making the client fetch three times.
    const { count: drafts } = await supabase
      .from('ai_vault_pages')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'draft')

    return NextResponse.json({ pages: data ?? [], draft_count: drafts ?? 0 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    const kind = body.kind
    if (!title || !content || !isVaultPageKind(kind)) {
      return NextResponse.json(
        { error: "'title', 'content' and a valid 'kind' are required" },
        { status: 400 },
      )
    }

    // The human's own note is the source. Written first so the page can
    // never exist without one.
    const source = await createSource(supabase, {
      accountId,
      kind: 'note',
      title,
      content,
    })
    if (!source) {
      return NextResponse.json(
        { error: 'Could not record the source for this page' },
        { status: 500 },
      )
    }

    const result = await createPage(supabase, {
      accountId,
      kind,
      title,
      content,
      contactId: typeof body.contact_id === 'string' ? body.contact_id : null,
      sourceIds: [source.id],
      actorId: userId,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.failure },
        { status: result.failure === 'slug_taken' ? 409 : 400 },
      )
    }

    return NextResponse.json({ page: result.page }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
