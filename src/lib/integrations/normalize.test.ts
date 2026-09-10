import { describe, expect, it } from 'vitest'
import {
  normalizarLinha,
  normalizarTelefone,
  parseValor,
  parseVencimento,
  resumirImportacao,
} from './normalize'

describe('parseValor', () => {
  // Adivinhar errado transforma R$ 1.234,56 em R$ 1,23 — e uma cobrança
  // com o valor errado é uma cobrança contestável.
  it.each([
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1234,56', 1234.56],
    ['1234.56', 1234.56],
    ['R$ 80,00', 80],
    ['80', 80],
    [80.5, 80.5],
  ])('lê %j como %j', (raw, esperado) => {
    expect(parseValor(raw)).toBe(esperado)
  })

  it.each([['', null], ['abc', null], [null, null], [undefined, null]])(
    'recusa %j',
    (raw, esperado) => {
      expect(parseValor(raw)).toBe(esperado)
    },
  )
})

describe('parseVencimento', () => {
  it.each([
    ['2026-09-09', '2026-09-09'],
    ['09/09/2026', '2026-09-09'],
    ['9/9/26', '2026-09-09'],
    ['2026-09-09T10:00:00Z', '2026-09-09'],
  ])('lê %j como %j', (raw, esperado) => {
    expect(parseVencimento(raw)).toBe(esperado)
  })

  // `new Date('2026-01-01')` é meia-noite UTC, que no Brasil é 31/12 —
  // e uma cobrança com a data errada por um dia dispara o degrau errado.
  it('não escorrega um dia no primeiro de janeiro', () => {
    expect(parseVencimento('01/01/2026')).toBe('2026-01-01')
  })

  it('recusa o que não reconhece', () => {
    expect(parseVencimento('semana que vem')).toBeNull()
  })
})

describe('normalizarTelefone', () => {
  it('põe o 55 quando falta', () => {
    expect(normalizarTelefone('(11) 98765-4321')).toBe('5511987654321')
  })

  it('não duplica o 55 de quem já tem', () => {
    expect(normalizarTelefone('5511987654321')).toBe('5511987654321')
  })

  it('recusa o que é curto demais para ser telefone', () => {
    expect(normalizarTelefone('12345')).toBeNull()
  })
})

describe('normalizarLinha', () => {
  const linha = {
    id: 'FAT-1',
    telefone: '11987654321',
    nome: 'Ana',
    valor: '80,00',
    vencimento: '09/09/2026',
  }

  it('lê uma linha com os nomes que a fonte usa', () => {
    const out = normalizarLinha(linha, { idExterno: 'id' })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.cobranca).toMatchObject({
        idExterno: 'FAT-1',
        telefone: '5511987654321',
        valor: 80,
        vencimento: '2026-09-09',
        status: 'aberta',
      })
    }
  })

  // Sem NENHUMA chave, reimportar o arquivo do mês duplicaria a
  // carteira inteira.
  it('inventa uma chave estável quando a planilha não tem id', () => {
    const a = normalizarLinha({ ...linha, id: undefined })
    const b = normalizarLinha({ ...linha, id: undefined })
    expect(a.ok && b.ok && a.cobranca.idExterno).toBe(
      b.ok ? b.cobranca.idExterno : 'diferente',
    )
  })

  it('recusa linha sem valor legível', () => {
    const out = normalizarLinha({ ...linha, valor: 'de graça' }, { idExterno: 'id' })
    expect(out).toMatchObject({ ok: false, erro: 'valor_invalido' })
  })

  it('recusa linha sem quem cobrar', () => {
    const out = normalizarLinha({ valor: '80', vencimento: '09/09/2026' })
    expect(out).toMatchObject({ ok: false, erro: 'sem_identificacao' })
  })

  it('reconhece as grafias de "pago"', () => {
    for (const status of ['paga', 'pago', 'PAID']) {
      const out = normalizarLinha({ ...linha, status }, { idExterno: 'id' })
      expect(out.ok && out.cobranca.status).toBe('paga')
    }
  })

  it('trata status desconhecido como aberta, não como erro', () => {
    const out = normalizarLinha({ ...linha, status: 'em análise' }, { idExterno: 'id' })
    expect(out.ok && out.cobranca.status).toBe('aberta')
  })

  it('usa o telefone como titular quando a fonte não informa', () => {
    const out = normalizarLinha(linha, { idExterno: 'id' })
    expect(out.ok && out.cobranca.titularRef).toBe('5511987654321')
  })
})

// Meia carteira importada é pior que nenhuma. Um resumo honesto antes
// de gravar evita o operador descobrir o problema com as mensagens já
// saindo.
describe('resumirImportacao', () => {
  it('conta o que entra, o que cai e por quê', () => {
    const linhas = [
      normalizarLinha({ id: '1', telefone: '11987654321', valor: '10', vencimento: '01/01/2026' }, { idExterno: 'id' }),
      normalizarLinha({ id: '2', telefone: '11987654321', valor: 'x', vencimento: '01/01/2026' }, { idExterno: 'id' }),
      normalizarLinha({ id: '1', telefone: '11987654321', valor: '10', vencimento: '01/01/2026' }, { idExterno: 'id' }),
    ]
    expect(resumirImportacao(linhas)).toMatchObject({
      total: 3,
      validas: 2,
      rejeitadas: 1,
      duplicadasNoArquivo: 1,
      porErro: { valor_invalido: 1 },
    })
  })
})
