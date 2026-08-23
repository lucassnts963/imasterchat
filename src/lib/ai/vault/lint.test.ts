import { describe, it, expect } from 'vitest'
import { lintVault, type LintFinding } from './lint'

function db(pages: unknown[], links: unknown[] = []) {
  return {
    from(table: string) {
      const rows = table === 'ai_vault_pages' ? pages : links
      const c: Record<string, unknown> = {}
      Object.assign(c, {
        select: () => c,
        eq: () => c,
        neq: () => c,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(ok, err),
      })
      return c
    },
  } as never
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    slug: 'p1',
    title: 'Página',
    kind: 'concept',
    status: 'approved',
    updated_at: new Date().toISOString(),
    content: '',
    ...overrides,
  }
}

const kinds = (findings: LintFinding[]) => findings.map((f) => f.kind)

describe('lintVault', () => {
  it('flags two approved pages quoting different numbers about the same subject', async () => {
    // The finding that matters: the bot quotes a different price
    // depending on how the question was phrased.
    const findings = await lintVault(
      db([
        page({
          id: 'a',
          title: 'Preço do exame de vista',
          content: 'O exame de vista custa R$ 150,00.',
        }),
        page({
          id: 'b',
          title: 'Exame de vista — valor',
          content: 'Cobramos 90 reais pelo exame.',
        }),
      ]),
      'acct',
    )
    const contradiction = findings.find((f) => f.kind === 'contradiction')
    expect(contradiction).toBeDefined()
    expect(contradiction!.severity).toBe('warning')
    expect(contradiction!.pageIds).toEqual(['a', 'b'])
  })

  it('does not flag two pages that quote the same number', async () => {
    const findings = await lintVault(
      db([
        page({ id: 'a', title: 'Preço do exame', content: 'Custa 150.' }),
        page({ id: 'b', title: 'Exame preço', content: 'São 150 reais.' }),
      ]),
      'acct',
    )
    expect(kinds(findings)).not.toContain('contradiction')
  })

  it('flags a state page that has outlived its truth', async () => {
    const old = new Date(Date.now() - 120 * 24 * 60 * 60_000).toISOString()
    const findings = await lintVault(
      db([page({ kind: 'state', title: 'Promoção de verão', updated_at: old })]),
      'acct',
    )
    expect(kinds(findings)).toContain('stale')
  })

  it('leaves a rule alone however old it is', async () => {
    const old = new Date(Date.now() - 900 * 24 * 60 * 60_000).toISOString()
    const findings = await lintVault(
      db([page({ kind: 'rule', title: 'Duração', updated_at: old })]),
      'acct',
    )
    // A rule not changing for two years is a rule, not a defect.
    expect(kinds(findings)).not.toContain('stale')
  })

  it('reports duplicate titles', async () => {
    const findings = await lintVault(
      db([
        page({ id: 'a', title: 'Exame de vista' }),
        page({ id: 'b', title: 'exame de  vista' }),
      ]),
      'acct',
    )
    expect(kinds(findings)).toContain('duplicate')
  })

  it('reports unconnected pages as info, not as a defect', async () => {
    const findings = await lintVault(
      db([page({ id: 'a', kind: 'concept' }), page({ id: 'b', kind: 'concept' })]),
      'acct',
    )
    const orphan = findings.find((f) => f.kind === 'orphan')
    expect(orphan?.severity).toBe('info')
  })

  it('does not call a linked page an orphan', async () => {
    const findings = await lintVault(
      db(
        [page({ id: 'a' }), page({ id: 'b' })],
        [{ from_page_id: 'a', to_page_id: 'b' }],
      ),
      'acct',
    )
    expect(kinds(findings)).not.toContain('orphan')
  })

  it('names a subject the wiki keeps mentioning without a page for it', async () => {
    const findings = await lintVault(
      db([
        page({ id: 'a', title: 'Armações', content: 'Vendemos lentes multifocais.' }),
        page({ id: 'b', title: 'Consultas', content: 'Indicamos lentes multifocais.' }),
        page({ id: 'c', title: 'Entrega', content: 'Prazo de lentes multifocais.' }),
      ]),
      'acct',
    )
    const gap = findings.find((f) => f.kind === 'gap')
    expect(gap).toBeDefined()
    expect(['lentes', 'multifocais']).toContain(gap!.title)
  })

  it('ignores drafts — only what customers can be told is linted', async () => {
    const findings = await lintVault(
      db([
        page({ id: 'a', title: 'Preço', content: 'Custa 150.', status: 'draft' }),
        page({ id: 'b', title: 'Preço exame', content: 'Custa 90.', status: 'draft' }),
      ]),
      'acct',
    )
    expect(kinds(findings)).not.toContain('contradiction')
  })
})
