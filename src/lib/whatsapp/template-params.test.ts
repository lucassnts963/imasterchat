import { describe, expect, it } from 'vitest'
import { templateParams } from './template-params'

describe('templateParams', () => {
  // O defeito que esta função existe para não deixar voltar: ordenar
  // "1", "2", …, "10" como texto dá "1", "10", "2", e o cliente recebe
  // o nome no lugar do valor — sem erro nenhum, porque para a Meta a
  // mensagem foi entregue.
  it('orders ten or more variables numerically', () => {
    const vars: Record<string, string> = {}
    for (let i = 1; i <= 12; i += 1) vars[String(i)] = `v${i}`
    expect(templateParams(vars)).toEqual([
      'v1', 'v2', 'v3', 'v4', 'v5', 'v6',
      'v7', 'v8', 'v9', 'v10', 'v11', 'v12',
    ])
  })

  it('is empty when there are no variables', () => {
    expect(templateParams(undefined)).toEqual([])
    expect(templateParams(null)).toEqual([])
    expect(templateParams({})).toEqual([])
  })

  it('puts numbered keys before named ones, and keeps named ones stable', () => {
    expect(templateParams({ nome: 'a', 2: 'b', 1: 'c' })).toEqual(['c', 'b', 'a'])
  })

  it('runs each value through the caller’s interpolation', () => {
    expect(
      templateParams({ 1: '{{ vars.nome }}' }, (v) => v.replace('{{ vars.nome }}', 'Ana')),
    ).toEqual(['Ana'])
  })

  it('coerces non-strings rather than dropping them', () => {
    expect(templateParams({ 1: 42, 2: true })).toEqual(['42', 'true'])
  })
})
