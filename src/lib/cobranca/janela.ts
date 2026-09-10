import { zonedParts, zonedTimeToUtc, formatDateInZone } from '@/lib/time/zone'

// ============================================================
// A janela legal de contato — fase 4, R-21.
//
// Cobrar por WhatsApp é legal no Brasil, mas o CDC (art. 42) e a
// autorregulação bancária (SARB 27/2023) impõem limites. Este arquivo é
// onde eles viram código, e a diferença entre "sugerido na tela" e
// "imposto pelo worker" é a razão de ele existir:
//
//   Um degrau que dispara domingo às 22h não é um bug de UX. É exposição
//   jurídica do cliente, e ele não vai descobrir por um aviso amarelo na
//   tela de configuração — vai descobrir numa notificação do Procon.
//
// Tudo aqui é PURO: recebe a janela, a data e os feriados, e devolve uma
// decisão. Nada de banco, nada de motor. É o que permite testar o caso
// do domingo de véspera de feriado sem levantar nada.
// ============================================================

export interface FaixaHoraria {
  /** "08:00" */
  de: string
  /** "20:00" */
  ate: string
}

export interface JanelaContato {
  /** Segunda a sexta. Null = não contata. */
  segSex: FaixaHoraria | null
  sabado: FaixaHoraria | null
  domingo: FaixaHoraria | null
  /** Contatar em feriado. Falso por padrão, e é o padrão certo. */
  feriados: boolean
  /** Fuso da conta — o mesmo de `ai_scheduling_settings`. Um produto com
   *  duas configurações de fuso tem duas respostas para "que horas são". */
  timezone: string
}

/** O padrão conservador: o que a SARB 27/2023 descreve como aceitável. */
export const JANELA_PADRAO: JanelaContato = {
  segSex: { de: '08:00', ate: '20:00' },
  sabado: { de: '08:00', ate: '14:00' },
  domingo: null,
  feriados: false,
  timezone: 'America/Sao_Paulo',
}

/**
 * Lê a janela do JSON da régua, caindo no padrão a cada campo ausente.
 *
 * Campo a campo, e não tudo-ou-nada: uma régua que configurou só o
 * sábado não pode perder a proteção dos outros dias.
 */
export function parseJanela(
  raw: unknown,
  timezone = JANELA_PADRAO.timezone,
): JanelaContato {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >
  return {
    // `??` não serve aqui: `null` é uma configuração DELIBERADA — "não
    // contata neste dia" — e cairia no padrão junto com o campo ausente.
    // Só `undefined` (ausente ou malformado) volta para o padrão.
    segSex: ouPadrao(parseFaixa(o.seg_sex), JANELA_PADRAO.segSex),
    sabado: ouPadrao(parseFaixa(o.sab), JANELA_PADRAO.sabado),
    domingo: ouPadrao(parseFaixa(o.dom), JANELA_PADRAO.domingo),
    feriados: o.feriados === true,
    timezone: typeof o.timezone === 'string' && o.timezone ? o.timezone : timezone,
  }
}

function ouPadrao(
  lido: FaixaHoraria | null | undefined,
  padrao: FaixaHoraria | null,
): FaixaHoraria | null {
  return lido === undefined ? padrao : lido
}

function parseFaixa(raw: unknown): FaixaHoraria | null | undefined {
  if (raw === null) return null
  if (!Array.isArray(raw) || raw.length !== 2) return undefined
  const [de, ate] = raw
  if (typeof de !== 'string' || typeof ate !== 'string') return undefined
  if (!/^\d{2}:\d{2}$/.test(de) || !/^\d{2}:\d{2}$/.test(ate)) return undefined
  return { de, ate }
}

function faixaDoDia(janela: JanelaContato, weekday: number): FaixaHoraria | null {
  if (weekday === 0) return janela.domingo
  if (weekday === 6) return janela.sabado
  return janela.segSex
}

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export interface JanelaDecisao {
  dentro: boolean
  /** Quando fora: o próximo instante em que a janela abre. Nunca nulo —
   *  um degrau fora da janela é ADIADO, não descartado. */
  proximaAbertura: Date
  motivo?: 'feriado' | 'dia_fechado' | 'cedo_demais' | 'tarde_demais'
}

/**
 * Este instante está dentro da janela? E se não, quando abre?
 *
 * `feriados` é um conjunto de datas `YYYY-MM-DD` no fuso da conta.
 */
export function avaliarJanela(
  janela: JanelaContato,
  quando: Date,
  feriados: ReadonlySet<string> = new Set(),
): JanelaDecisao {
  const partes = zonedParts(quando, janela.timezone)
  const dia = formatDateInZone(quando, janela.timezone)
  const weekday = diaDaSemana(partes)

  const feriado = !janela.feriados && feriados.has(dia)
  const faixa = feriado ? null : faixaDoDia(janela, weekday)

  if (!faixa) {
    return {
      dentro: false,
      motivo: feriado ? 'feriado' : 'dia_fechado',
      proximaAbertura: proximaAbertura(janela, quando, feriados),
    }
  }

  const agora = partes.hour * 60 + partes.minute
  if (agora < minutosDe(faixa.de)) {
    return {
      dentro: false,
      motivo: 'cedo_demais',
      // Hoje mesmo, na abertura.
      proximaAbertura: instanteEm(janela, partes, faixa.de),
    }
  }
  if (agora >= minutosDe(faixa.ate)) {
    return {
      dentro: false,
      motivo: 'tarde_demais',
      proximaAbertura: proximaAbertura(janela, quando, feriados),
    }
  }
  return { dentro: true, proximaAbertura: quando }
}

/**
 * O próximo instante de abertura, olhando no máximo duas semanas à
 * frente.
 *
 * O teto existe para uma janela mal configurada — todos os dias
 * fechados, digamos — não virar laço infinito no worker. Nesse caso a
 * função devolve o fim da busca, e nenhum degrau dispara: uma régua que
 * não contata ninguém é um erro de configuração visível, e é melhor que
 * um worker travado.
 */
function proximaAbertura(
  janela: JanelaContato,
  depoisDe: Date,
  feriados: ReadonlySet<string>,
): Date {
  let cursor = new Date(depoisDe.getTime())
  for (let i = 0; i < 14; i += 1) {
    cursor = new Date(cursor.getTime() + 86_400_000)
    const partes = zonedParts(cursor, janela.timezone)
    const dia = formatDateInZone(cursor, janela.timezone)
    if (!janela.feriados && feriados.has(dia)) continue
    const faixa = faixaDoDia(janela, diaDaSemana(partes))
    if (!faixa) continue
    return instanteEm(janela, partes, faixa.de)
  }
  return cursor
}

function instanteEm(
  janela: JanelaContato,
  partes: { year: number; month: number; day: number },
  hhmm: string,
): Date {
  const [hour, minute] = hhmm.split(':').map(Number)
  return zonedTimeToUtc(
    {
      year: partes.year,
      month: partes.month,
      day: partes.day,
      hour: hour || 0,
      minute: minute || 0,
    },
    janela.timezone,
  )
}

/** 0 = domingo, no fuso da conta. */
function diaDaSemana(partes: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(partes.year, partes.month - 1, partes.day)).getUTCDay()
}
