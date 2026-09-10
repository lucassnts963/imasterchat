import { describe, expect, it } from 'vitest'
import { variaveisDaCobranca, resolverVariaveis, formatarData } from './mensagem'
import type { CobrancaCompleta } from './store'

const titulo = (over: Partial<CobrancaCompleta> = {}): CobrancaCompleta => ({
  id: 't1',
  contactId: 'c1',
  titularRef: 'titular-1',
  valor: 80,
  vencimento: '2026-09-09',
  status: 'aberta',
  descricao: 'Mensalidade setembro',
  linkPagamento: null,
  codigoPix: null,
  linhaDigitavel: null,
  ...over,
})

describe('formatarData', () => {
  it('vira o formato que o titular lê', () => {
    expect(formatarData('2026-09-09')).toBe('09/09/2026')
  })

  // Sem passar por Date: `new Date('2026-09-09')` é meia-noite UTC, que
  // no Brasil é o dia ANTERIOR — e uma cobrança com a data errada por um
  // dia é uma cobrança contestável.
  it('não escorrega um dia por causa de fuso', () => {
    expect(formatarData('2026-01-01')).toBe('01/01/2026')
  })
})

describe('variaveisDaCobranca', () => {
  it('soma os títulos do titular', () => {
    const vars = variaveisDaCobranca([titulo(), titulo({ id: 't2', valor: 45.5 })])
    expect(vars.valor).toContain('125,50')
    expect(vars.quantidade).toBe('2')
  })

  it('usa o vencimento mais antigo', () => {
    const vars = variaveisDaCobranca([
      titulo({ vencimento: '2026-09-20' }),
      titulo({ id: 't2', vencimento: '2026-08-05' }),
    ])
    expect(vars.vencimento).toBe('05/08/2026')
  })

  // Uma mensagem que fala de um título quando existem três faz o titular
  // pagar um e achar que quitou.
  it('lista todos os títulos, do mais antigo para o mais novo', () => {
    const vars = variaveisDaCobranca([
      titulo({ descricao: 'Outubro', vencimento: '2026-10-05' }),
      titulo({ id: 't2', descricao: 'Setembro', vencimento: '2026-09-05' }),
    ])
    const linhas = vars.titulos.split('\n')
    expect(linhas[0]).toContain('Setembro')
    expect(linhas[1]).toContain('Outubro')
  })

  it('pega o primeiro link e o primeiro pix que existirem', () => {
    const vars = variaveisDaCobranca([
      titulo(),
      titulo({ id: 't2', linkPagamento: 'https://pag.ar/x', codigoPix: '000201...' }),
    ])
    expect(vars.link).toBe('https://pag.ar/x')
    expect(vars.pix).toBe('000201...')
  })

  it('não inventa link quando não há', () => {
    expect(variaveisDaCobranca([titulo()]).link).toBe('')
  })
})

describe('resolverVariaveis', () => {
  it('substitui o que conhece', () => {
    const vars = variaveisDaCobranca([titulo()])
    expect(resolverVariaveis('Total {{valor}} venc {{vencimento}}', vars)).toBe(
      `Total ${vars.valor} venc 09/09/2026`,
    )
  })

  // Um template com `{{nome}}` que chega em branco parece defeito nosso;
  // chegando literal, o operador vê o que digitou errado.
  it('deixa uma variável desconhecida à mostra', () => {
    const vars = variaveisDaCobranca([titulo()])
    expect(resolverVariaveis('Oi {{nome}}', vars)).toBe('Oi {{nome}}')
  })
})
