// ============================================================
// What the vault IS, in the agent's own terms.
//
// The counterpart of `WIKI_SCHEMA.md` in the methodology this follows:
// the document that tells the maintainer what a page is, what may go on
// one, and what may never. It lives in code rather than in a per-account
// text field because it is not the operator's business to weaken it —
// FAITHFULNESS is what stops an invented price reaching a customer.
// ============================================================

export const VAULT_PAGE_KINDS = [
  'rule',
  'entity_customer',
  'entity_business',
  'concept',
  'state',
] as const

export type VaultPageKind = (typeof VAULT_PAGE_KINDS)[number]

export type VaultPageStatus = 'draft' | 'approved' | 'archived'

export function isVaultPageKind(value: unknown): value is VaultPageKind {
  return (
    typeof value === 'string' &&
    (VAULT_PAGE_KINDS as readonly string[]).includes(value)
  )
}

/**
 * What each kind is for, as the maintainer agent is told. Written at the
 * agent, not at us: these strings go into its prompt verbatim.
 */
export const VAULT_KIND_GUIDANCE: Record<VaultPageKind, string> = {
  rule:
    'A durable rule of the business — something that stays true across customers and months. ' +
    'These are loaded into EVERY reply, so keep them short and never write a rule you are ' +
    'not certain of. "Consultations last 30 minutes" is a rule; "the customer asked for 30 ' +
    'minutes" is not.',
  entity_customer:
    'What is worth remembering about one customer: preferences, constraints, what they bought, ' +
    'how they like to be spoken to. Facts, not impressions — "prefers afternoons" if they said ' +
    'so, never "seems impatient".',
  entity_business:
    'The business itself: what it sells, what it charges, what it will and will not do. The ' +
    'answers a customer asks for by name.',
  concept:
    'Anything else worth knowing that is not a rule, a customer or the business — a product, a ' +
    'procedure, a supplier, a recurring question.',
  state:
    'What is true RIGHT NOW and will STOP being true: a promotion, a holiday closure, a ' +
    'shortage. Always say until when. If it has no end — opening hours, prices, how long an ' +
    'appointment takes — it is a rule or a business page, never this one. A state page that ' +
    'outlives its truth is worse than no page.',
}

/** Which kinds carry a `contact_id`. */
export function kindRequiresContact(kind: VaultPageKind): boolean {
  return kind === 'entity_customer'
}

/**
 * The rule above all others, quoted to the maintainer as the
 * methodology states it.
 */
export const FAITHFULNESS_RULE =
  'FAITHFULNESS — the rule above all others. Every claim on a page must be grounded in the ' +
  'source you were given. Never invent a date, a price, a name, or any concrete detail that is ' +
  'not in the source. If the source does not carry enough substance for a page, do not force ' +
  'one: a short note beats a page padded with filler, and an invented page reaches a paying ' +
  'customer as a price or a policy.'

/**
 * The schema block handed to the maintainer agent when it proposes
 * pages. Assembled here so the prompt and the enum can never drift.
 */
export function buildVaultSchemaPrompt(): string {
  const kinds = VAULT_PAGE_KINDS.map(
    (kind) => `- ${kind}: ${VAULT_KIND_GUIDANCE[kind]}`,
  ).join('\n')

  return [
    'You maintain a wiki about one business. It is not a transcript archive: it is what the ' +
      'business knows, written so the next conversation starts from it.',
    `Page kinds:\n${kinds}`,
    FAITHFULNESS_RULE,
    'Everything you write is a DRAFT. A person reviews it before any of it reaches a customer, ' +
      'so propose what is genuinely worth keeping and leave out what is not — an approval queue ' +
      'full of noise gets approved without reading, which defeats the review.',
    'Prefer updating an existing page over creating a near-duplicate. Two pages disagreeing ' +
      'about the same fact is the worst state this wiki can be in.',
    'Write every page in the language the business speaks to its customers in — the language ' +
      'of the conversation you were given. A wiki half in one language and half in another ' +
      'is read by nobody.',
    'Never write about the conversation itself. "Atendemos das 14h às 18h" is a page; ' +
      '"isto foi informado ao cliente" is not, and a line like that on an otherwise good ' +
      'page is noise the reviewer has to delete.',
  ].join('\n\n')
}

/** The combining marks NFD splits accents into. Built from escapes
 *  rather than written literally: the literal range is invisible in a
 *  source file and does not survive a careless edit. */
const COMBINING_MARKS = new RegExp('[\u0300-\u036f]', 'g')

/**
 * Slug rules: lowercase, ASCII, hyphenated — the same shape the
 * methodology uses for filenames, and unique per account in the schema.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    // "consultório" → "consultorio".
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
