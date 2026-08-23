import { describe, it, expect } from 'vitest'

import { classifyRefusal, describeRefusal } from './refusal'
import { parseWeeklyHours, type SchedulingSettings } from './settings'

const SP = 'America/Sao_Paulo'

/** Seg-sex, 09:00-12:00 e 14:00-18:00, blocos de 60min, 2h de aviso. */
function settings(over: Partial<SchedulingSettings> = {}): SchedulingSettings {
  return {
    timezone: SP,
    slotMinutes: 60,
    leadTimeMinutes: 120,
    maxAdvanceDays: 30,
    appointmentLabel: null,
    lookaheadDays: 7,
    slotFetchLimit: 12,
    offerSlotsMax: 3,
    weeklyHours: parseWeeklyHours({
      '1': [['09:00', '12:00'], ['14:00', '18:00']],
      '2': [['09:00', '12:00'], ['14:00', '18:00']],
    }),
    isActive: true,
    ...over,
  }
}

// O caso real: segunda, 08:47 da manhã, cliente pede 10:00. A agenda
// está vaga. A antecedência de 2h derruba, e o bot disse "não está
// disponível" — o dono olhou a agenda e achou que era defeito.
const SEGUNDA_0847 = new Date(2026, 7, 3, 8, 47)
const SEGUNDA_1000 = new Date(2026, 7, 3, 10, 0)
const SEGUNDA_1100 = new Date(2026, 7, 3, 11, 0)

describe('classifyRefusal', () => {
  it('antecedência: agenda vaga, mas cedo demais', () => {
    expect(
      classifyRefusal({
        settings: settings(),
        startsAt: SEGUNDA_1000,
        endsAt: new Date(2026, 7, 3, 11, 0),
        busy: [],
        now: SEGUNDA_0847,
      }),
    ).toBe('too_soon')
  })

  it('ocupado é ocupado, e não "cedo demais"', () => {
    expect(
      classifyRefusal({
        settings: settings(),
        startsAt: SEGUNDA_1100,
        endsAt: new Date(2026, 7, 3, 12, 0),
        busy: [{ start: SEGUNDA_1100, end: new Date(2026, 7, 3, 12, 0) }],
        now: SEGUNDA_0847,
      }),
    ).toBe('taken')
  })

  it('fora do expediente: 13:00 cai no intervalo do almoço', () => {
    expect(
      classifyRefusal({
        settings: settings(),
        startsAt: new Date(2026, 7, 3, 13, 0),
        endsAt: new Date(2026, 7, 3, 14, 0),
        busy: [],
        now: SEGUNDA_0847,
      }),
    ).toBe('outside_hours')
  })

  it('além do horizonte de agendamento', () => {
    expect(
      classifyRefusal({
        settings: settings({ maxAdvanceDays: 7 }),
        startsAt: new Date(2026, 7, 20, 10, 0),
        endsAt: new Date(2026, 7, 20, 11, 0),
        busy: [],
        now: SEGUNDA_0847,
      }),
    ).toBe('too_far')
  })

  it('a antecedência ganha do "ocupado" quando ambos valem', () => {
    // O cliente consegue contornar "muito cedo" escolhendo mais tarde;
    // por isso é a razão que vale a pena dizer primeiro.
    expect(
      classifyRefusal({
        settings: settings(),
        startsAt: SEGUNDA_1000,
        endsAt: new Date(2026, 7, 3, 11, 0),
        busy: [{ start: SEGUNDA_1000, end: new Date(2026, 7, 3, 11, 0) }],
        now: SEGUNDA_0847,
      }),
    ).toBe('too_soon')
  })
})

describe('describeRefusal', () => {
  it('diz a hora a partir da qual dá, não só que não deu', () => {
    const out = describeRefusal('too_soon', settings(), SEGUNDA_0847)
    expect(out).toContain('2 hours')
    expect(out).toContain('10:47')
    // E deixa explícito que a agenda pode estar vazia — é o que impede
    // o modelo de traduzir isto como "está ocupado".
    expect(out).toContain('calendar may well be empty')
  })

  it('quando foi tomado, manda oferecer no MESMO dia', () => {
    // O outro bug desta semana: o bot pulou para o dia seguinte em vez
    // de oferecer outro horário do dia pedido.
    expect(describeRefusal('taken', settings())).toContain('SAME day')
  })
})
