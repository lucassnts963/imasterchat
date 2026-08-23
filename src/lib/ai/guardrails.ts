import type { SupabaseClient } from '@supabase/supabase-js'
import { recordEvent } from '@/lib/observability/events'

// ============================================================
// The shop's own list of things the bot must not handle.
//
// Two kinds, enforced in genuinely different ways, and both are needed:
//
//   topic    goes into the prompt. It catches paraphrase — a customer
//            who is clearly negotiating without ever saying "desconto"
//            — and it is a suggestion, because the model is the one
//            deciding whether this conversation is on that subject.
//
//   keyword  is matched here, in code, before the model is called at
//            all. It is blind to paraphrase and it is certain. A match
//            hands off without spending a provider call, and there is
//            no wording that talks it out of it.
//
// Neither alone is honest. A prompt-only guardrail is a rule the model
// can decide does not apply this time; a keyword-only one misses every
// customer who phrased it differently.
// ============================================================

export interface Guardrail {
  id: string
  kind: 'topic' | 'keyword'
  value: string
  note: string | null
}

export interface GuardrailSet {
  topics: Guardrail[]
  keywords: Guardrail[]
}

export const EMPTY_GUARDRAILS: GuardrailSet = { topics: [], keywords: [] }

/**
 * What every account starts with.
 *
 * Chosen because each one is a case where being wrong costs more than
 * being slow, and none of them is specific to any trade. The shop can
 * switch any of them off — they are seeded as rows, not hardcoded — but
 * an account that never opens the settings screen still gets them.
 */
export const BUILTIN_GUARDRAILS: { kind: 'topic' | 'keyword'; value: string; note: string }[] = [
  {
    kind: 'topic',
    value: 'Reclamação, insatisfação ou pedido de reembolso',
    note: 'Cliente insatisfeito — atender pessoalmente antes de responder qualquer coisa.',
  },
  {
    kind: 'topic',
    value: 'Negociação de preço, desconto ou condição de pagamento',
    note: 'Só uma pessoa decide preço.',
  },
  {
    kind: 'topic',
    value: 'Orientação de saúde, diagnóstico ou interpretação de receita médica',
    note: 'Não é assunto de bot, em nenhuma hipótese.',
  },
  {
    kind: 'topic',
    value: 'Assunto jurídico, cobrança ou dados pessoais de terceiros',
    note: 'Risco legal — encaminhar sempre.',
  },
  {
    kind: 'topic',
    value: 'Qualquer coisa que o cliente peça para tratar com uma pessoa',
    note: 'Pedido explícito de humano.',
  },
  {
    kind: 'keyword',
    value: 'advogado',
    note: 'Menção a advogado — encaminhar imediatamente.',
  },
  {
    kind: 'keyword',
    value: 'procon',
    note: 'Menção ao Procon — encaminhar imediatamente.',
  },
  {
    kind: 'keyword',
    value: 'processar',
    note: 'Ameaça de processo — encaminhar imediatamente.',
  },
]

interface GuardrailRow {
  id: string
  kind: 'topic' | 'keyword'
  value: string
  note: string | null
}

/**
 * Load the account's active guardrails.
 *
 * Best-effort: an account with none, a failed query, or a schema that
 * predates 048 all degrade to an empty set. Failing the reply because a
 * guardrail list could not be read would trade a small risk for a
 * certain one.
 */
export async function loadGuardrails(
  db: SupabaseClient,
  accountId: string,
): Promise<GuardrailSet> {
  try {
    const { data, error } = await db
      .from('ai_handoff_guardrails')
      .select('id, kind, value, note')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .limit(200)

    if (error) throw error

    const rows = (data ?? []) as GuardrailRow[]
    return {
      topics: rows.filter((r) => r.kind === 'topic'),
      keywords: rows.filter((r) => r.kind === 'keyword'),
    }
  } catch (err) {
    // Fail-open é a escolha certa (uma leitura falha não pode calar o
    // atendimento inteiro), mas é a degradação mais cara que existe
    // aqui: sem guardrails o bot fala exatamente sobre o que a ótica
    // proibiu — jurídico, reembolso — e responde bem, o que é pior que
    // o silêncio porque ninguém percebe.
    //
    // Crítico, e nunca em silêncio.
    void recordEvent({
      accountId,
      source: 'ai',
      code: 'guardrails_unreadable',
      severity: 'critical',
      message: `Guardrails não puderam ser lidos — o agente está respondendo SEM eles: ${
        err instanceof Error ? err.message : String(err)
      }`,
    })
    return EMPTY_GUARDRAILS
  }
}

/**
 * Normalise for matching: lowercase, accents stripped, punctuation
 * flattened to spaces.
 *
 * Accents matter here more than anywhere else in this codebase. A
 * customer typing on a phone writes "advogado" or "reembolso" without
 * them as often as with, and a guardrail that only fires on the
 * correctly-accented spelling is a guardrail that fails exactly when
 * someone is angry and typing fast.
 */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(new RegExp('[\u0300-\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Does this message trip a keyword guardrail?
 *
 * Matches on word boundaries over the normalised text, so "advogado"
 * fires on "vou chamar meu advogado" but a rule for "caro" does not
 * fire on "carro". Returns the first match — one reason is enough to
 * stop, and listing them all would only pad the note.
 */
export function matchKeywordGuardrail(
  message: string,
  keywords: Guardrail[],
): Guardrail | null {
  if (!message.trim() || keywords.length === 0) return null
  const haystack = ` ${normalize(message)} `

  for (const rule of keywords) {
    const needle = normalize(rule.value)
    if (!needle) continue
    if (haystack.includes(` ${needle} `)) return rule
  }
  return null
}

/**
 * The topic guardrails as a prompt section.
 *
 * Stated as an instruction rather than as reference, unlike the
 * knowledge base: these are the one part of the prompt where the right
 * behaviour is to stop, and hedging the wording invites the model to
 * decide it can handle this one.
 */
export function describeGuardrails(guardrails: GuardrailSet): string | null {
  if (guardrails.topics.length === 0) return null

  const list = guardrails.topics
    .map((g) => `- ${g.value}`)
    .join('\n')

  return (
    'Subjects you must NOT handle. If the conversation touches any of these, even partly, call ' +
    'request_human immediately and say nothing about the subject itself — do not answer "just ' +
    'this once", do not give a partial answer first, and do not explain the rule to the ' +
    `customer. Simply tell them you are getting someone who can help.\n${list}`
  )
}

/** The note the attendant reads when a keyword guardrail fired. */
export function guardrailHandoffSummary(rule: Guardrail): string {
  const reason = rule.note?.trim() || `Mensagem mencionou "${rule.value}".`
  return `🤖 Regra de segurança acionada: ${reason}`
}
