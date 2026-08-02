import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

// ============================================================
// GET /api/ai/vault/graph  (any member)
//
// The vault as a graph, for the network view. No new data: pages are
// nodes, `ai_vault_links` are edges — the wiki already IS a graph, this
// endpoint just says so in the shape a force layout wants.
//
// `degree` is computed here rather than in the browser because it sizes
// the node, and a client counting edges across a few hundred pages on
// every frame is work done in the wrong place.
// ============================================================

interface PageRow {
  id: string
  slug: string
  title: string
  kind: string
  status: string
  updated_at: string
}

interface LinkRow {
  from_page_id: string
  to_page_id: string
  relation: string
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)
    // Drafts are off by default: the graph is meant to show what the
    // business KNOWS, and a draft is a proposal. Turning them on is how
    // a curator sees what the last ingest wants to add.
    const includeDrafts = url.searchParams.get('drafts') === '1'

    let pages = supabase
      .from('ai_vault_pages')
      .select('id, slug, title, kind, status, updated_at')
      .eq('account_id', accountId)
      .neq('status', 'archived')
      .limit(2000)
    if (!includeDrafts) pages = pages.eq('status', 'approved')

    const { data: pageRows, error: pageErr } = await pages
    if (pageErr) {
      console.error('[ai/vault/graph] page load failed:', pageErr)
      return NextResponse.json({ error: 'Failed to load the graph' }, { status: 500 })
    }

    const nodes = (pageRows ?? []) as PageRow[]
    const ids = new Set(nodes.map((n) => n.id))

    // RLS already scopes links through their page, so no account filter
    // is possible here — we filter to the visible node set instead,
    // which also drops edges into archived or draft pages.
    const { data: linkRows, error: linkErr } = await supabase
      .from('ai_vault_links')
      .select('from_page_id, to_page_id, relation')
      .limit(5000)
    if (linkErr) {
      console.error('[ai/vault/graph] link load failed:', linkErr)
    }

    const links = ((linkRows ?? []) as LinkRow[]).filter(
      (l) => ids.has(l.from_page_id) && ids.has(l.to_page_id),
    )

    const degree = new Map<string, number>()
    for (const link of links) {
      degree.set(link.from_page_id, (degree.get(link.from_page_id) ?? 0) + 1)
      degree.set(link.to_page_id, (degree.get(link.to_page_id) ?? 0) + 1)
    }

    return NextResponse.json({
      nodes: nodes.map((n) => ({
        id: n.id,
        slug: n.slug,
        title: n.title,
        kind: n.kind,
        status: n.status,
        degree: degree.get(n.id) ?? 0,
      })),
      links: links.map((l) => ({
        source: l.from_page_id,
        target: l.to_page_id,
        relation: l.relation,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
