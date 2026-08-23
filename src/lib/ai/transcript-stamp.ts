import type { ChatMessage } from './types'
import { formatDateInZone, formatTimeInZone } from '@/lib/time/zone'
import { DEFAULT_TIMEZONE } from '@/lib/scheduling/settings'

// ============================================================
// Quando cada frase foi dita.
//
// O transcript ia para o modelo como texto puro, sem nenhuma marca de
// tempo. Um transcript assim não tem ontem: tudo aconteceu agora.
//
// O caso real, reconstruído de `ai_agent_steps` e `messages`:
//
//   02/08 23:51  cliente: "Amanhã as 11"
//                bot agenda 03/08 11:00
//                bot: "agendada para amanhã às 11:00"
//   03/08 07:51  cliente: "Consegue reagendar para as 14hrs?"
//                bot chama check_availability(04/08 → 04/08)
//
// Ele nem consultou o dia de hoje. E o raciocínio está correto para o
// que ele viu: a última frase dizia "agendada para amanhã às 11:00", e
// nada indicava que aquilo tinha sido dito ontem. "Amanhã" seguia
// sendo amanhã. O cliente foi movido de dia e avisado como se fosse o
// combinado.
//
// Saber a data de hoje — que o bloco de ambiente já mandava — não
// resolve: o que faltava era saber QUANDO CADA FRASE foi dita.
//
// ------------------------------------------------------------
// O FORMATO, E POR QUE ESTE
//
//   [2026-08-02 23:51] Amanhã as 11
//
// Ano completo e ISO, não `02/08`. Dois motivos:
//
//   1. `02/08` é ambíguo na virada do ano e ambíguo entre locales — e
//      este texto é lido por um modelo, não por uma pessoa.
//   2. É EXATAMENTE como as ferramentas de agendamento já falam
//      (`check_availability` devolve `2026-08-04: 10:00, 11:00`). O
//      modelo correlacionar transcript com resultado de ferramenta sem
//      converter formato é meio caminho para ele acertar o dia.
//
// Custa ~6 tokens por mensagem. Em 20 mensagens, ~120 por resposta.
// ============================================================

export interface StampedMessage extends ChatMessage {
  /** ISO do banco. */
  at: string
}

/**
 * A frase que impede o modelo de repetir as marcas na resposta.
 *
 * Sem ela o cliente recebe "[2026-08-03 08:12] Claro, posso ajudar" —
 * o modelo imita o formato que acabou de ver, que é o que modelos
 * fazem. Vai no bloco de ambiente, junto do resto que é fato e não
 * instrução de conteúdo.
 */
export const TRANSCRIPT_STAMP_NOTE =
  'Each message in the conversation is prefixed with when it was said, as ' +
  '[YYYY-MM-DD HH:MM] in the business timezone. Use it to tell today from ' +
  'yesterday — a "tomorrow" said yesterday does NOT mean tomorrow. These ' +
  'prefixes are metadata for you: NEVER write one in your reply.'

/**
 * Marca cada mensagem com o instante em que foi dita.
 *
 * Uma data inválida passa sem marca, em vez de virar "Invalid Date" no
 * meio do transcript: perder a marca de uma mensagem custa contexto,
 * mas escrever lixo ali ensina o modelo a desconfiar de todas.
 */
export function stampTranscript(
  messages: StampedMessage[],
  timezone: string = DEFAULT_TIMEZONE,
): ChatMessage[] {
  return messages.map(({ role, content, at }) => {
    const stamp = formatStamp(at, timezone)
    return {
      role,
      content: stamp ? `[${stamp}] ${content}` : content,
    }
  })
}

/** `2026-08-02 23:51`, ou null quando a data não presta. */
export function formatStamp(at: string, timezone: string): string | null {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  return `${formatDateInZone(date, timezone)} ${formatTimeInZone(date, timezone)}`
}
