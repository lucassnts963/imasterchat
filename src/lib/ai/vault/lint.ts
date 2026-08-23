import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Health of the wiki.
//
// The same five diagnostics the methodology names, because they are the
// five ways a maintained wiki rots: `contradiction`, `stale`,
// `duplicate`, `orphan`, `gap`.
//
// All of them are computed here in SQL and plain code — none of them
// asks a model. That is deliberate: a lint pass that costs provider
// calls is a lint pass nobody runs, and every one of these is a
// structural question the database can answer. The judgement calls that
// genuinely need a model (is this page WRONG?) belong to the curator,
// who is the one being shown this report.
//
// The one that matters most is `contradiction`. Two approved pages
// disagreeing about the price is not an untidy wiki, it is a bot that
// quotes a different number depending on how the question was phrased.
// ============================================================

export type LintKind =
  | 'contradiction'
  | 'stale'
  | 'duplicate'
  | 'orphan'
  | 'gap'

export type LintSeverity = 'warning' | 'info'

export interface LintFinding {
  kind: LintKind
  severity: LintSeverity
  /** Pages the finding is about, so the UI can link straight to them. */
  pageIds: string[]
  title: string
  detail: string
}

/** A `state` page older than this is probably describing a promotion
 *  that ended. State is the one kind whose whole contract is that it
 *  stops being true. */
const STATE_STALE_DAYS = 60

interface PageRow {
  id: string
  slug: string
  title: string
  kind: string
  status: string
  updated_at: string
  content: string
}

export async function lintVault(
  db: SupabaseClient,
  accountId: string,
): Promise<LintFinding[]> {
  const { data, error } = await db
    .from('ai_vault_pages')
    .select('id, slug, title, kind, status, updated_at, content')
    .eq('account_id', accountId)
    .neq('status', 'archived')
    .limit(2000)

  if (error) {
    console.error('[ai vault lint] page load failed:', error)
    return []
  }

  const pages = (data ?? []) as PageRow[]
  const approved = pages.filter((p) => p.status === 'approved')

  const { data: linkRows } = await db
    .from('ai_vault_links')
    .select('from_page_id, to_page_id')
    .limit(5000)
  const links = (linkRows ?? []) as { from_page_id: string; to_page_id: string }[]

  return [
    ...findContradictions(approved),
    ...findStaleState(approved),
    ...findDuplicates(approved),
    ...findOrphans(approved, links),
    ...findGaps(approved),
  ]
}

/**
 * Pages that state different numbers about the same subject.
 *
 * A heuristic, and honestly so: it pairs approved pages that share a
 * significant word in the title and then quote different numbers. It
 * will miss contradictions written in prose and will occasionally flag
 * two pages that merely both mention "30". Both are acceptable — this
 * is a report a person reads, not a gate, and a false positive costs a
 * glance while a missed price conflict costs a customer.
 */
function findContradictions(pages: PageRow[]): LintFinding[] {
  const findings: LintFinding[] = []

  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i]
      const b = pages[j]
      const shared = sharedKeywords(a.title, b.title)
      if (shared.length === 0) continue

      const numbersA = numbersIn(a.content)
      const numbersB = numbersIn(b.content)
      if (numbersA.length === 0 || numbersB.length === 0) continue

      const overlap = numbersA.some((n) => numbersB.includes(n))
      if (overlap) continue

      findings.push({
        kind: 'contradiction',
        severity: 'warning',
        pageIds: [a.id, b.id],
        title: `"${a.title}" e "${b.title}"`,
        detail:
          `Ambas falam de "${shared[0]}" e citam números diferentes ` +
          `(${numbersA.slice(0, 3).join(', ')} vs ${numbersB.slice(0, 3).join(', ')}). ` +
          'O bot vai responder um ou outro dependendo de como perguntarem.',
      })
    }
  }

  return findings.slice(0, 20)
}

function findStaleState(pages: PageRow[]): LintFinding[] {
  const cutoff = Date.now() - STATE_STALE_DAYS * 24 * 60 * 60_000
  return pages
    .filter((p) => p.kind === 'state' && Date.parse(p.updated_at) < cutoff)
    .map((p) => ({
      kind: 'stale' as const,
      severity: 'warning' as const,
      pageIds: [p.id],
      title: p.title,
      detail:
        `Página do tipo "agora" sem atualização há mais de ${STATE_STALE_DAYS} dias. ` +
        'Uma promoção que acabou continua sendo oferecida enquanto esta página existir.',
    }))
}

/** Two pages whose titles say the same thing. The keeper is told to
 *  revise instead of duplicating, but a human writing by hand is not. */
function findDuplicates(pages: PageRow[]): LintFinding[] {
  const byNormalized = new Map<string, PageRow[]>()
  for (const page of pages) {
    const key = page.title.toLowerCase().replace(/[^a-z0-9à-ú]+/g, ' ').trim()
    if (!key) continue
    const bucket = byNormalized.get(key) ?? []
    bucket.push(page)
    byNormalized.set(key, bucket)
  }

  return [...byNormalized.values()]
    .filter((bucket) => bucket.length > 1)
    .map((bucket) => ({
      kind: 'duplicate' as const,
      severity: 'info' as const,
      pageIds: bucket.map((p) => p.id),
      title: bucket[0].title,
      detail: `${bucket.length} páginas com o mesmo título. Vale manter uma só.`,
    }))
}

/**
 * Pages nothing links to and which link to nothing.
 *
 * Not a defect on its own — a rule is often legitimately isolated — so
 * it is `info`. What it is really reporting is that the graph has not
 * been connected up, which is the difference between a wiki and a
 * folder of notes.
 */
function findOrphans(
  pages: PageRow[],
  links: { from_page_id: string; to_page_id: string }[],
): LintFinding[] {
  const connected = new Set<string>()
  for (const link of links) {
    connected.add(link.from_page_id)
    connected.add(link.to_page_id)
  }

  const orphans = pages.filter(
    (p) => !connected.has(p.id) && p.kind !== 'rule' && p.kind !== 'state',
  )
  if (orphans.length === 0) return []

  return [
    {
      kind: 'orphan',
      severity: 'info',
      pageIds: orphans.map((p) => p.id),
      title: `${orphans.length} páginas sem conexão`,
      detail:
        'Nada aponta para elas e elas não apontam para nada. São notas soltas, ' +
        'não uma rede — o agente as encontra pela busca, mas não pelo contexto.',
    },
  ]
}

/**
 * Subjects the wiki keeps mentioning without having a page for.
 *
 * The methodology's most useful diagnostic: it says what to write next.
 * Approximated by counting words that recur across page bodies but
 * appear in no page title.
 */
function findGaps(pages: PageRow[]): LintFinding[] {
  const titles = new Set(
    pages.flatMap((p) => keywords(p.title)),
  )
  const counts = new Map<string, number>()

  for (const page of pages) {
    // Count each word once per page: a word repeated ten times on one
    // page is a page about it, not a recurring subject.
    for (const word of new Set(keywords(page.content))) {
      if (titles.has(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, count]) => ({
      kind: 'gap' as const,
      severity: 'info' as const,
      pageIds: [],
      title: word,
      detail: `Aparece em ${count} páginas e não tem página própria. Talvez mereça uma.`,
    }))
}

/** Portuguese and English stop words, plus the filler that survives
 *  tokenising a wiki about a shop. */
const STOP_WORDS = new Set([
  'para', 'com', 'que', 'dos', 'das', 'uma', 'por', 'nao', 'não', 'mais', 'como',
  'quando', 'este', 'esta', 'isso', 'pelo', 'pela', 'sem', 'seu', 'sua', 'ele',
  'ela', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'not', 'are', 'was',
  'cliente', 'clientes', 'loja', 'pagina', 'página',
])

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zà-ú0-9]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
}

function sharedKeywords(a: string, b: string): string[] {
  const setB = new Set(keywords(b))
  return keywords(a).filter((word) => setB.has(word))
}

/** Numbers a page asserts — prices, durations, counts. Currency symbols
 *  and separators stripped so "R$ 150,00" and "150" compare equal. */
function numbersIn(text: string): string[] {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? []
  return [...new Set(matches.map((n) => n.replace(/[.,]0+$/, '')))]
}
