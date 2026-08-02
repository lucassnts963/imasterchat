import { archivePage, createPage, VAULT_PAGE_COLUMNS } from './store'
import {
  isVaultPageKind,
  kindRequiresContact,
  VAULT_PAGE_KINDS,
  type VaultPageKind,
} from './schema'
import type { AgentTool, ToolContext } from '../tools/types'

// ============================================================
// The maintainer's tools.
//
// The keeper is `runAgent` with this catalogue instead of the
// scheduling one — same loop, same step cap, same audit trail. Writing
// the wiki is an action like any other, so it is a tool call and not a
// bespoke "parse the model's JSON" path that would drift from the rest.
//
// Every one of these produces a DRAFT. There is deliberately no tool
// that approves anything: the model cannot promote its own proposal,
// which is the entire safety property of this design.
// ============================================================

export interface KeeperToolDeps {
  /** The source every page proposed in this run must cite. */
  sourceId: string
  /** The contact the conversation was with, for entity_customer pages. */
  contactId: string | null
  /** Slug → page id, for linking and updating. Loaded once per run. */
  existingPages: Map<string, { id: string; title: string; kind: string }>
}

export function buildKeeperTools(deps: KeeperToolDeps): AgentTool[] {
  return [
    proposePageTool(deps),
    updatePageTool(deps),
    linkPagesTool(deps),
    skipTool(),
  ]
}

function proposePageTool(deps: KeeperToolDeps): AgentTool {
  return {
    name: 'propose_page',
    description:
      'Propose a NEW page for the wiki. Use it only for something worth keeping beyond this ' +
      'conversation. If a page on this subject already exists, call update_page instead — two ' +
      'pages disagreeing about the same fact is the worst state this wiki can be in.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...VAULT_PAGE_KINDS],
          description: 'Which kind of page this is.',
        },
        title: {
          type: 'string',
          description: 'Short, specific, in the language the business uses.',
        },
        content: {
          type: 'string',
          description:
            'The page body, in markdown. Only claims grounded in the conversation you were given.',
        },
        excerpt: {
          type: 'string',
          description:
            'The line from the conversation this page rests on, quoted, so a person can check it.',
        },
      },
      required: ['kind', 'title', 'content', 'excerpt'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const kind = args.kind
      if (!isVaultPageKind(kind)) {
        return { content: `Unknown page kind '${String(kind)}'.`, isError: true }
      }
      const title = typeof args.title === 'string' ? args.title.trim() : ''
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (!title || !content) {
        return { content: 'A page needs both a title and content.', isError: true }
      }
      // The excerpt is the evidence a curator checks the claim against.
      // Without it they are approving on trust, which is what this whole
      // arrangement exists to avoid.
      const excerpt = typeof args.excerpt === 'string' ? args.excerpt.trim() : ''
      if (!excerpt) {
        return {
          content: 'Quote the line from the conversation this page rests on.',
          isError: true,
        }
      }

      const result = await createPage(ctx.db, {
        accountId: ctx.accountId,
        kind: kind as VaultPageKind,
        title,
        content,
        contactId: kindRequiresContact(kind) ? deps.contactId : null,
        sourceIds: [deps.sourceId],
        excerpt,
      })

      if (!result.ok) return { content: result.message, isError: true }

      deps.existingPages.set(result.page.slug, {
        id: result.page.id,
        title: result.page.title,
        kind: result.page.kind,
      })
      return {
        content: `Proposed "${result.page.title}" (${result.page.slug}) as a draft. A person will review it.`,
      }
    },
  }
}

function updatePageTool(deps: KeeperToolDeps): AgentTool {
  return {
    name: 'update_page',
    description:
      'Propose a revision to a page that already exists, by its slug. The revision goes back ' +
      'through review before it counts — so restate the whole page body, not just what changed.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The slug of the page to revise.' },
        content: { type: 'string', description: 'The complete new page body.' },
        excerpt: {
          type: 'string',
          description: 'The line from the conversation that justifies the change.',
        },
        reason: {
          type: 'string',
          description: 'One sentence for the reviewer: what changed and why.',
        },
      },
      required: ['slug', 'content', 'excerpt', 'reason'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const slug = typeof args.slug === 'string' ? args.slug.trim() : ''
      const existing = deps.existingPages.get(slug)
      if (!existing) {
        return {
          content: `No page with slug '${slug}'. Use propose_page to create one.`,
          isError: true,
        }
      }
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (!content) {
        return { content: 'The new page body cannot be empty.', isError: true }
      }

      // Back to draft: a revised page is an unreviewed page, whatever it
      // was before. The previous body is preserved in the revision log,
      // so a reviewer can see what it is being changed from.
      const { data, error } = await ctx.db
        .from('ai_vault_pages')
        .update({ content, status: 'draft' })
        .eq('id', existing.id)
        .eq('account_id', ctx.accountId)
        .select(VAULT_PAGE_COLUMNS)
        .single()

      if (error) {
        console.error('[ai vault keeper] update failed:', error)
        return { content: 'Could not save the revision.', isError: true }
      }

      // Cite the new evidence too — a revision is a claim like any other.
      await ctx.db
        .from('ai_vault_page_sources')
        .upsert(
          {
            page_id: existing.id,
            source_id: deps.sourceId,
            excerpt: typeof args.excerpt === 'string' ? args.excerpt : null,
          },
          { onConflict: 'page_id,source_id' },
        )

      await ctx.db.from('ai_vault_revisions').insert({
        account_id: ctx.accountId,
        page_id: existing.id,
        operation: 'edited',
        snapshot: content,
        note: typeof args.reason === 'string' ? args.reason.slice(0, 500) : null,
      })

      void data
      return {
        content: `Revised "${existing.title}". It is a draft again until someone approves it.`,
      }
    },
  }
}

function linkPagesTool(deps: KeeperToolDeps): AgentTool {
  return {
    name: 'link_pages',
    description:
      'Record that two pages are related. This is what turns the wiki from a pile of notes into ' +
      'something with structure — a customer to the product they asked about, a rule to the ' +
      'policy it comes from.',
    parameters: {
      type: 'object',
      properties: {
        from_slug: { type: 'string' },
        to_slug: { type: 'string' },
        relation: {
          type: 'string',
          description:
            "How they relate, in a word or two: 'mentions', 'prefers', 'contradicts', 'supersedes'.",
        },
      },
      required: ['from_slug', 'to_slug', 'relation'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const from = deps.existingPages.get(String(args.from_slug ?? '').trim())
      const to = deps.existingPages.get(String(args.to_slug ?? '').trim())
      if (!from || !to) {
        return {
          content: 'Both pages must exist before they can be linked.',
          isError: true,
        }
      }
      if (from.id === to.id) {
        return { content: 'A page cannot link to itself.', isError: true }
      }

      const relation =
        typeof args.relation === 'string' && args.relation.trim()
          ? args.relation.trim().slice(0, 40)
          : 'mentions'

      const { error } = await ctx.db.from('ai_vault_links').upsert(
        { from_page_id: from.id, to_page_id: to.id, relation },
        { onConflict: 'from_page_id,to_page_id,relation' },
      )
      if (error) {
        console.error('[ai vault keeper] link failed:', error)
        return { content: 'Could not record the link.', isError: true }
      }
      return { content: `Linked "${from.title}" → "${to.title}" (${relation}).` }
    },
  }
}

/**
 * Doing nothing, on purpose.
 *
 * Most conversations teach the wiki nothing — a customer asked when the
 * shop opens and got told. Without an explicit way to say so, a model
 * asked to extract knowledge will find some, and the review queue fills
 * with noise until a curator starts approving without reading. That
 * failure is quiet and it ruins the whole arrangement.
 */
function skipTool(): AgentTool {
  return {
    name: 'skip',
    description:
      'Record that this conversation taught the wiki nothing worth keeping, and stop. This is ' +
      'the RIGHT answer most of the time. A page nobody needed is worse than no page: it fills ' +
      'the review queue until people stop reading it.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'One short sentence.' },
      },
      required: ['reason'],
      additionalProperties: false,
    },

    async execute(args, ctx: ToolContext) {
      await ctx.db.from('ai_vault_revisions').insert({
        account_id: ctx.accountId,
        page_id: null,
        operation: 'skipped',
        note: typeof args.reason === 'string' ? args.reason.slice(0, 500) : null,
      })
      // `handoff` ends the loop. Nothing is being handed to a human here
      // — it is simply the loop's "stop now" signal, and there is
      // nothing left to do once the answer is "nothing".
      return { content: 'Noted. Nothing to add.', handoff: true }
    },
  }
}

/** Archive is curator-only; exported so the lint pass can retire a page
 *  a human has agreed is dead. The keeper never gets it. */
export { archivePage }
