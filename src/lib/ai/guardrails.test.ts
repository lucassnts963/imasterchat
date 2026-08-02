import { describe, it, expect } from 'vitest'
import {
  describeGuardrails,
  guardrailHandoffSummary,
  matchKeywordGuardrail,
  type Guardrail,
} from './guardrails'

function kw(value: string, note: string | null = null): Guardrail {
  return { id: value, kind: 'keyword', value, note }
}

describe('matchKeywordGuardrail', () => {
  it('fires on the word in a sentence', () => {
    const hit = matchKeywordGuardrail('vou chamar meu advogado', [kw('advogado')])
    expect(hit?.value).toBe('advogado')
  })

  it('ignores accents in either direction', () => {
    // Someone typing angrily on a phone writes it both ways, and a rule
    // that only fires on the correctly-accented spelling fails exactly
    // when it is needed.
    expect(matchKeywordGuardrail('vou no procon', [kw('Procon')])).toBeTruthy()
    expect(matchKeywordGuardrail('reembolso ja', [kw('reembolso')])).toBeTruthy()
    expect(matchKeywordGuardrail('reembolso já', [kw('reembolso')])).toBeTruthy()
  })

  it('does not fire on a word that merely contains the term', () => {
    // The failure that would make guardrails untrustworthy: a rule for
    // "caro" handing off every conversation that mentions a car.
    expect(matchKeywordGuardrail('meu carro quebrou', [kw('caro')])).toBeNull()
    expect(matchKeywordGuardrail('advogados associados', [kw('advogado')])).toBeNull()
  })

  it('matches across punctuation', () => {
    expect(matchKeywordGuardrail('isso é caso de PROCON!', [kw('procon')])).toBeTruthy()
  })

  it('handles multi-word terms', () => {
    expect(
      matchKeywordGuardrail('quero abrir uma acao judicial', [kw('ação judicial')]),
    ).toBeTruthy()
  })

  it('returns nothing for an empty message or an empty rule set', () => {
    expect(matchKeywordGuardrail('   ', [kw('advogado')])).toBeNull()
    expect(matchKeywordGuardrail('advogado', [])).toBeNull()
  })

  it('returns the first match — one reason to stop is enough', () => {
    const hit = matchKeywordGuardrail('advogado e procon', [kw('advogado'), kw('procon')])
    expect(hit?.value).toBe('advogado')
  })
})

describe('describeGuardrails', () => {
  it('states them as a boundary, not as reference material', () => {
    const out = describeGuardrails({
      topics: [{ id: '1', kind: 'topic', value: 'Negociação de desconto', note: null }],
      keywords: [],
    })!
    expect(out).toContain('Negociação de desconto')
    expect(out).toContain('must NOT handle')
    // The wording has to close the door the model would otherwise find:
    // answering partly, or explaining the rule to the customer.
    expect(out).toContain('just this once')
    expect(out).toContain('do not explain the rule')
  })

  it('says nothing when there are no topics', () => {
    expect(describeGuardrails({ topics: [], keywords: [kw('advogado')] })).toBeNull()
  })
})

describe('guardrailHandoffSummary', () => {
  it('uses the operator’s own note when there is one', () => {
    const out = guardrailHandoffSummary(kw('procon', 'Menção ao Procon — encaminhar.'))
    expect(out).toContain('Menção ao Procon')
  })

  it('falls back to naming the term that fired', () => {
    expect(guardrailHandoffSummary(kw('advogado'))).toContain('advogado')
  })
})
