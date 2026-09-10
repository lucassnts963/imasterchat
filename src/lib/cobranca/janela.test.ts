import { describe, expect, it } from 'vitest'
import { avaliarJanela, parseJanela, JANELA_PADRAO } from './janela'

const SP = 'America/Sao_Paulo'

/** Um instante local em São Paulo, para o teste ler como as pessoas leem. */
function em(iso: string): Date {
  // São Paulo é UTC-3 sem horário de verão desde 2019.
  return new Date(`${iso}-03:00`)
}

describe('parseJanela', () => {
  it('cai no padrão conservador quando não há nada configurado', () => {
    expect(parseJanela(null)).toEqual(JANELA_PADRAO)
  })

  // Campo a campo, e não tudo-ou-nada: uma régua que configurou só o
  // sábado não pode perder a proteção dos outros dias.
  it('mantém a proteção dos dias que ninguém configurou', () => {
    const janela = parseJanela({ sab: ['09:00', '12:00'] })
    expect(janela.sabado).toEqual({ de: '09:00', ate: '12:00' })
    expect(janela.segSex).toEqual(JANELA_PADRAO.segSex)
    expect(janela.domingo).toBeNull()
  })

  it('trata null como "não contata neste dia"', () => {
    expect(parseJanela({ seg_sex: null }).segSex).toBeNull()
  })

  it('ignora uma faixa malformada em vez de aceitar', () => {
    expect(parseJanela({ sab: ['nove', 'doze'] }).sabado).toEqual(JANELA_PADRAO.sabado)
    expect(parseJanela({ sab: ['08:00'] }).sabado).toEqual(JANELA_PADRAO.sabado)
  })

  it('feriados só entram quando alguém liga explicitamente', () => {
    expect(parseJanela({}).feriados).toBe(false)
    expect(parseJanela({ feriados: true }).feriados).toBe(true)
  })
})

describe('avaliarJanela', () => {
  const janela = parseJanela({}, SP)

  it('deixa passar uma quarta às 10h', () => {
    expect(avaliarJanela(janela, em('2026-09-09T10:00')).dentro).toBe(true)
  })

  // O teste que resume a fase: um degrau que dispara domingo às 22h não
  // é bug de UX, é exposição jurídica do cliente.
  it('barra domingo às 22h', () => {
    const out = avaliarJanela(janela, em('2026-09-13T22:00'))
    expect(out.dentro).toBe(false)
    expect(out.motivo).toBe('dia_fechado')
  })

  it('barra a madrugada de um dia útil', () => {
    const out = avaliarJanela(janela, em('2026-09-09T03:00'))
    expect(out.dentro).toBe(false)
    expect(out.motivo).toBe('cedo_demais')
  })

  it('barra depois das 20h', () => {
    expect(avaliarJanela(janela, em('2026-09-09T20:30')).motivo).toBe('tarde_demais')
  })

  it('conhece o sábado curto', () => {
    expect(avaliarJanela(janela, em('2026-09-12T10:00')).dentro).toBe(true)
    expect(avaliarJanela(janela, em('2026-09-12T15:00')).motivo).toBe('tarde_demais')
  })

  it('barra feriado, mesmo em dia útil', () => {
    const out = avaliarJanela(
      janela,
      em('2026-09-07T10:00'),
      new Set(['2026-09-07']),
    )
    expect(out.dentro).toBe(false)
    expect(out.motivo).toBe('feriado')
  })

  it('deixa passar no feriado quando a conta assume esse risco', () => {
    const permissiva = parseJanela({ feriados: true }, SP)
    expect(
      avaliarJanela(permissiva, em('2026-09-07T10:00'), new Set(['2026-09-07']))
        .dentro,
    ).toBe(true)
  })
})

// Um degrau fora da janela é ADIADO, não descartado. Perder o degrau
// seria perder a cobrança.
describe('para quando a janela reabre', () => {
  const janela = parseJanela({}, SP)

  it('cedo demais abre no mesmo dia', () => {
    const out = avaliarJanela(janela, em('2026-09-09T03:00'))
    expect(out.proximaAbertura.toISOString()).toBe(em('2026-09-09T08:00').toISOString())
  })

  it('tarde demais numa quarta abre na quinta', () => {
    const out = avaliarJanela(janela, em('2026-09-09T21:00'))
    expect(out.proximaAbertura.toISOString()).toBe(em('2026-09-10T08:00').toISOString())
  })

  it('sábado à tarde pula o domingo', () => {
    const out = avaliarJanela(janela, em('2026-09-12T15:00'))
    expect(out.proximaAbertura.toISOString()).toBe(em('2026-09-14T08:00').toISOString())
  })

  it('pula o feriado junto com o fim de semana', () => {
    // 7 de setembro de 2026 é uma segunda-feira.
    const out = avaliarJanela(
      janela,
      em('2026-09-05T15:00'),
      new Set(['2026-09-07']),
    )
    expect(out.proximaAbertura.toISOString()).toBe(em('2026-09-08T08:00').toISOString())
  })

  // Uma régua que fecha todos os dias é erro de configuração — visível,
  // e melhor que um worker em laço infinito.
  it('desiste depois de duas semanas em vez de girar para sempre', () => {
    const fechada = parseJanela({ seg_sex: null, sab: null, dom: null }, SP)
    const out = avaliarJanela(fechada, em('2026-09-09T10:00'))
    expect(out.dentro).toBe(false)
    expect(out.proximaAbertura.getTime()).toBeGreaterThan(
      em('2026-09-09T10:00').getTime(),
    )
  })
})
