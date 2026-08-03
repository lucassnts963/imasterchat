import type { SchedulingSettings } from './settings'
import { formatTimeInZone, zonedParts } from '@/lib/time/zone'

// ============================================================
// POR QUE aquele horário não serve.
//
// O servidor sempre soube: fora do expediente, cedo demais, longe
// demais, ou já ocupado. Mas devolvia as quatro numa frase só —
//
//   "That slot is not available — it is outside the business hours,
//    too soon, too far ahead, or has just been taken."
//
// — e o modelo, sem ter como escolher, dizia ao cliente "não está
// disponível". O que produziu um chamado inteiro: o dono olhou a agenda,
// viu as 10h vagas, e concluiu que o bot estava quebrado.
//
// Não estava. Eram 08:47 e a antecedência mínima da conta é de 2 horas,
// então 10:00 estava a 73 minutos e foi corretamente recusado. Uma
// recusa certa, explicada de um jeito que parecia defeito.
//
// A diferença entre "não está disponível" e "preciso de 2h de
// antecedência; o mais cedo hoje é 11:00" é a diferença entre o cliente
// desistir e o cliente escolher outro horário.
// ============================================================

export type RefusalReason =
  | 'too_soon'
  | 'too_far'
  | 'outside_hours'
  | 'taken'
  | 'unknown'

export interface RefusalInput {
  settings: SchedulingSettings
  startsAt: Date
  endsAt: Date
  /** Intervalos ocupados já considerados, com o próprio agendamento
   *  removido quando é uma remarcação. */
  busy: { start: Date; end: Date }[]
  now?: Date
}

/**
 * Qual regra derrubou este horário.
 *
 * A ordem importa e não é arbitrária: ela vai da razão mais acionável
 * para a menos. Saber que faltou antecedência dá ao cliente o que fazer
 * ("mais tarde então"); saber que está ocupado, também; "fora do
 * expediente" fecha o dia. Um horário que viola duas regras é melhor
 * explicado pela que o cliente consegue contornar.
 */
export function classifyRefusal(input: RefusalInput): RefusalReason {
  const { settings, startsAt, endsAt, busy, now = new Date() } = input

  const earliest = now.getTime() + settings.leadTimeMinutes * 60_000
  if (startsAt.getTime() < earliest) return 'too_soon'

  const horizon = now.getTime() + settings.maxAdvanceDays * 86_400_000
  if (startsAt.getTime() > horizon) return 'too_far'

  if (busy.some((b) => startsAt < b.end && endsAt > b.start)) return 'taken'

  if (!withinOpeningHours(settings, startsAt, endsAt)) return 'outside_hours'

  return 'unknown'
}

/** O início e o fim cabem inteiros numa janela de atendimento do dia? */
function withinOpeningHours(
  settings: SchedulingSettings,
  startsAt: Date,
  endsAt: Date,
): boolean {
  const start = zonedParts(startsAt, settings.timezone)
  const windows = settings.weeklyHours[start.weekday] ?? []
  if (windows.length === 0) return false

  const startMin = start.hour * 60 + start.minute
  const durationMin = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)
  const endMin = startMin + durationMin

  return windows.some(
    (w) =>
      startMin >= w.startHour * 60 + w.startMinute &&
      endMin <= w.endHour * 60 + w.endMinute,
  )
}

/**
 * A frase que o modelo lê — em inglês, como o resto do andaime, mas
 * dizendo O QUE o cliente pode fazer a respeito.
 *
 * Cada uma termina mandando oferecer alternativa, porque uma recusa sem
 * alternativa é o cliente indo embora.
 */
export function describeRefusal(
  reason: RefusalReason,
  settings: SchedulingSettings,
  now: Date = new Date(),
): string {
  switch (reason) {
    case 'too_soon': {
      const earliest = new Date(now.getTime() + settings.leadTimeMinutes * 60_000)
      const hours = settings.leadTimeMinutes / 60
      const notice =
        settings.leadTimeMinutes % 60 === 0
          ? `${hours} hour${hours === 1 ? '' : 's'}`
          : `${settings.leadTimeMinutes} minutes`
      return (
        `That time is too soon: this business needs at least ${notice} of notice, so the ` +
        `earliest anything can start today is ${formatTimeInZone(earliest, settings.timezone)}. ` +
        'The calendar may well be empty then — it is the notice rule, not a conflict. Say so in ' +
        'plain words and offer the earliest times that DO work.'
      )
    }
    case 'too_far':
      return (
        `That date is beyond how far ahead this business books (${settings.maxAdvanceDays} days). ` +
        'Tell the customer the limit and offer something inside it.'
      )
    case 'taken':
      return (
        'That time was just taken by someone else. Call check_availability again and offer what ' +
        'is actually free — preferring another time on the SAME day the customer asked for.'
      )
    case 'outside_hours':
      return (
        'That time is outside the business opening hours. Tell the customer the hours and offer a ' +
        'time inside them.'
      )
    default:
      return (
        'That slot is not bookable. Call check_availability again and offer what is actually free.'
      )
  }
}
