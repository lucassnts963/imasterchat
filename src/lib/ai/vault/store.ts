import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ingestDocument } from '../knowledge'
import { loadEmbeddingsKey } from '../config'
import { slugify, type VaultPageKind, type VaultPageStatus } from './schema'

// ============================================================
// Writing to the vault.
//
// Two rules run through everything here.
//
// A page cites a source, or it is not a page. `createSource` +
// `createPage` are the only way in, and `createPage` refuses without at
// least one source id — FAITHFULNESS enforced at the one door rather
// than hoped for at every caller.
//
// Approval is what makes a page real. Only on approval is it chunked
// and embedded, which is the moment it becomes retrievable; rejecting
// or archiving takes it back out of the index. The draft/approved
// distinction is not a label, it is whether a customer can be told this.
// ============================================================

export interface VaultPage {
  id: string
  slug: string
  kind: VaultPageKind
  title: string
  content: string
  status: VaultPageStatus
  contactId: string | null
  version: number
  updatedAt: string
}

interface PageRow {
  id: string
  slug: string
  kind: VaultPageKind
  title: string
  content: string
  status: VaultPageStatus
  contact_id: string | null
  version: number
  updated_at: string
}

export const VAULT_PAGE_COLUMNS =
  'id, slug, kind, title, content, status, contact_id, version, updated_at'

export function toVaultPage(row: PageRow): VaultPage {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    content: row.content,
    status: row.status,
    contactId: row.contact_id,
    version: row.version,
    updatedAt: row.updated_at,
  }
}

/**
 * Record a source. Idempotent by content: ingesting the same
 * conversation twice returns the existing row rather than creating a
 * rival the keeper would then have to reconcile with itself.
 */
export async function createSource(
  db: SupabaseClient,
  args: {
    accountId: string
    kind: 'conversation' | 'document' | 'note'
    refId?: string | null
    title?: string | null
    content: string
  },
): Promise<{ id: string } | null> {
  const contentHash = crypto
    .createHash('sha256')
    .update(args.content)
    .digest('hex')

  const { data, error } = await db
    .from('ai_vault_sources')
    .upsert(
      {
        account_id: args.accountId,
        kind: args.kind,
        ref_id: args.refId ?? null,
        title: args.title ?? null,
        content: args.content,
        content_hash: contentHash,
      },
      { onConflict: 'account_id,content_hash', ignoreDuplicates: false },
    )
    .select('id')
    .single<{ id: string }>()

  if (error) {
    console.error('[ai vault] source insert failed:', error)
    return null
  }
  return data
}

export type CreatePageFailure = 'no_sources' | 'slug_taken' | 'internal'

export type CreatePageResult =
  | { ok: true; page: VaultPage }
  | { ok: false; failure: CreatePageFailure; message: string }

/**
 * Propose a page. Always lands as a draft — nothing the agent writes
 * reaches a customer before a person agrees with it.
 */
export async function createPage(
  db: SupabaseClient,
  args: {
    accountId: string
    kind: VaultPageKind
    title: string
    content: string
    contactId?: string | null
    /** At least one. A page with no evidence is a page the agent made up. */
    sourceIds: string[]
    excerpt?: string | null
    actorId?: string | null
  },
): Promise<CreatePageResult> {
  if (args.sourceIds.length === 0) {
    return {
      ok: false,
      failure: 'no_sources',
      message: 'A page must cite at least one source.',
    }
  }

  const slug = slugify(args.title) || slugify(args.kind)

  const { data, error } = await db
    .from('ai_vault_pages')
    .insert({
      account_id: args.accountId,
      slug,
      kind: args.kind,
      title: args.title.slice(0, 200),
      content: args.content,
      contact_id: args.contactId ?? null,
      status: 'draft',
    })
    .select(VAULT_PAGE_COLUMNS)
    .single<PageRow>()

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        failure: 'slug_taken',
        message: `A page named "${slug}" already exists. Update it instead of creating a second.`,
      }
    }
    console.error('[ai vault] page insert failed:', error)
    return { ok: false, failure: 'internal', message: 'Could not save the page.' }
  }

  const page = toVaultPage(data)

  const { error: linkErr } = await db.from('ai_vault_page_sources').insert(
    args.sourceIds.map((sourceId) => ({
      page_id: page.id,
      source_id: sourceId,
      excerpt: args.excerpt ?? null,
    })),
  )
  if (linkErr) {
    // The page exists but cites nothing, which is the one state the
    // whole design forbids. Remove it rather than leave it for a curator
    // to approve on trust.
    console.error('[ai vault] source link failed, rolling back the page:', linkErr)
    await db.from('ai_vault_pages').delete().eq('id', page.id)
    return {
      ok: false,
      failure: 'internal',
      message: 'Could not attach the sources to the page.',
    }
  }

  await recordRevision(db, {
    accountId: args.accountId,
    pageId: page.id,
    operation: 'proposed',
    actorId: args.actorId ?? null,
    snapshot: page.content,
  })

  return { ok: true, page }
}

/**
 * Approve a draft: it becomes retrievable, and only now is it indexed.
 * Indexing on approval rather than on write is what keeps a draft out of
 * the bot's mouth even if some future caller forgets to filter.
 */
export async function approvePage(
  db: SupabaseClient,
  args: {
    accountId: string
    pageId: string
    actorId: string
    /** A curator's edit, applied as part of approving. */
    content?: string
    title?: string
  },
): Promise<VaultPage | null> {
  const update: Record<string, unknown> = {
    status: 'approved',
    approved_by: args.actorId,
    approved_at: new Date().toISOString(),
  }
  if (typeof args.content === 'string') update.content = args.content
  if (typeof args.title === 'string') update.title = args.title.slice(0, 200)

  const { data: current } = await db
    .from('ai_vault_pages')
    .select('version, status')
    .eq('id', args.pageId)
    .eq('account_id', args.accountId)
    .maybeSingle<{ version: number; status: VaultPageStatus }>()
  if (!current) return null
  // Re-approving an already-approved page (a curator editing it) is a
  // new version; approving a draft for the first time is not.
  if (current.status === 'approved') update.version = current.version + 1

  const { data, error } = await db
    .from('ai_vault_pages')
    .update(update)
    .eq('id', args.pageId)
    .eq('account_id', args.accountId)
    .select(VAULT_PAGE_COLUMNS)
    .single<PageRow>()

  if (error) {
    console.error('[ai vault] approve failed:', error)
    return null
  }

  const page = toVaultPage(data)
  await indexPage(db, args.accountId, page)
  await recordRevision(db, {
    accountId: args.accountId,
    pageId: page.id,
    operation: 'approved',
    actorId: args.actorId,
    snapshot: page.content,
  })
  return page
}

/**
 * Reject or retire a page. Archived, never deleted: what the agent
 * proposed and a human turned down is the record of how the vault came
 * to be trustworthy.
 */
export async function archivePage(
  db: SupabaseClient,
  args: {
    accountId: string
    pageId: string
    actorId: string
    note?: string | null
    operation?: 'rejected' | 'archived'
  },
): Promise<VaultPage | null> {
  const { data, error } = await db
    .from('ai_vault_pages')
    .update({ status: 'archived' })
    .eq('id', args.pageId)
    .eq('account_id', args.accountId)
    .select(VAULT_PAGE_COLUMNS)
    .single<PageRow>()

  if (error) {
    console.error('[ai vault] archive failed:', error)
    return null
  }

  // Out of the index the moment it stops being approved — otherwise a
  // retired price keeps answering questions.
  await db.from('ai_knowledge_chunks').delete().eq('vault_page_id', args.pageId)

  await recordRevision(db, {
    accountId: args.accountId,
    pageId: args.pageId,
    operation: args.operation ?? 'archived',
    actorId: args.actorId,
    note: args.note ?? null,
  })
  return toVaultPage(data)
}

/**
 * Chunk + embed an approved page through the same pipeline the
 * knowledge base uses, so retrieval stays one code path.
 */
async function indexPage(
  db: SupabaseClient,
  accountId: string,
  page: VaultPage,
): Promise<void> {
  try {
    const { key } = await loadEmbeddingsKey(db, accountId)
    await ingestDocument(
      db,
      accountId,
      { embeddingsApiKey: key },
      { vaultPageId: page.id },
      `${page.title}\n\n${page.content}`,
    )
  } catch (err) {
    // Lexical search still works without embeddings, and an approval
    // that half-indexed is better than an approval that failed.
    console.error('[ai vault] indexing failed for page', page.id, err)
  }
}

export async function recordRevision(
  db: SupabaseClient,
  args: {
    accountId: string
    pageId: string | null
    operation: string
    actorId?: string | null
    snapshot?: string | null
    note?: string | null
  },
): Promise<void> {
  const { error } = await db.from('ai_vault_revisions').insert({
    account_id: args.accountId,
    page_id: args.pageId,
    operation: args.operation,
    actor_id: args.actorId ?? null,
    snapshot: args.snapshot ?? null,
    note: args.note ?? null,
  })
  if (error) console.error('[ai vault] revision log failed:', error)
}
