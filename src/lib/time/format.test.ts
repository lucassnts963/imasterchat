import { describe, it, expect } from 'vitest'

import {
  dateFnsLocale,
  formatDate,
  formatDateFull,
  formatDateTime,
  formatDayMonth,
  formatRelative,
} from './format'

// Datas construídas com `new Date(ano, mês, dia)` — local e sem
// ambiguidade, como o vitest.config.ts pede. `new Date('2026-08-03')`
// seria meia-noite UTC e viraria dia 2 no fuso de São Paulo.
const TRES_DE_AGOSTO = new Date(2026, 7, 3, 14, 30)

describe('formatDate', () => {
  it('português escreve dia/mês', () => {
    expect(formatDate(TRES_DE_AGOSTO, 'pt-BR')).toBe('03/08/2026')
  })

  it('inglês americano escreve mês/dia — e é por isso que o locale importa', () => {
    // Mesma data, mesma função, leitura oposta. Um "03/08" servido a um
    // leitor en-US é lido como 8 de março.
    expect(formatDate(TRES_DE_AGOSTO, 'en-US')).toBe('08/03/2026')
  })
})

describe('formatDateFull', () => {
  it('o mês por extenso sai em português', () => {
    expect(formatDateFull(TRES_DE_AGOSTO, 'pt-BR')).toContain('agosto')
  })

  it('e em inglês quando o app está em inglês', () => {
    expect(formatDateFull(TRES_DE_AGOSTO, 'en-US')).toContain('August')
  })
})

describe('formatDateTime', () => {
  it('junta data e hora no formato do idioma', () => {
    const out = formatDateTime(TRES_DE_AGOSTO, 'pt-BR')
    expect(out).toContain('03/08/2026')
    expect(out).toContain('14:30')
  })
})

describe('formatDayMonth', () => {
  it('omite o ano, que é ruído num eixo de gráfico', () => {
    expect(formatDayMonth(TRES_DE_AGOSTO, 'pt-BR')).not.toContain('2026')
  })
})

describe('formatRelative', () => {
  it('o tempo relativo sai em português', () => {
    const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const out = formatRelative(duasHorasAtras, 'pt-BR')
    // "há cerca de 2 horas" — o que importa é não ser "ago".
    expect(out).toMatch(/há/)
    expect(out).not.toMatch(/ago/)
  })

  it('e em inglês quando é o caso', () => {
    const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000)
    expect(formatRelative(duasHorasAtras, 'en')).toMatch(/ago/)
  })
})

describe('dateFnsLocale', () => {
  it('resolve os três idiomas do app', () => {
    expect(dateFnsLocale('pt-BR').code).toBe('pt-BR')
    expect(dateFnsLocale('en').code).toBe('en-US')
    expect(dateFnsLocale('ko').code).toBe('ko')
  })

  it('cai na raiz quando a variante é desconhecida', () => {
    // `pt-PT` não está mapeado, mas português de Portugal lê muito
    // melhor em pt-BR do que em inglês.
    expect(dateFnsLocale('pt-PT').code).toBe('pt-BR')
  })

  it('idioma desconhecido cai em inglês em vez de quebrar', () => {
    expect(dateFnsLocale('xx-YY').code).toBe('en-US')
  })
})
