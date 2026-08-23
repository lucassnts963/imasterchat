import { formatDistanceToNow } from 'date-fns'
import { enUS, ko, ptBR } from 'date-fns/locale'
import type { Locale } from 'date-fns'

// ============================================================
// Datas na língua de quem está lendo.
//
// Três jeitos errados conviviam no app, e cada um erra diferente:
//
//   'en-US' fixo        sempre inglês. "August 3, 2026" no funil de um
//                       app em português.
//   locale undefined    usa o do NAVEGADOR, não o do app. Passa
//                       despercebido numa máquina brasileira e vira
//                       inglês na de qualquer outra pessoa — o pior
//                       dos três, porque parece certo para quem testa.
//   'pt-BR' fixo        o inverso, e igualmente errado: quebra quem
//                       roda o app em en ou ko.
//
// E o `date-fns` sem `locale` devolve inglês por padrão: "about 2 hours
// ago", "August 3, 2026".
//
// Aqui a fonte é uma só — o locale do `next-intl`, que é o mesmo que
// escolhe as mensagens. Se a tela está em português, a data está em
// português, em qualquer máquina.
//
// ------------------------------------------------------------
// O QUE NÃO ENTRA AQUI
//
// Formato de máquina não é formato de leitura. `formatDateInZone`
// (`2026-08-03`, chave de agrupamento) e `formatTimeInZone` (`14:30`,
// 24h sempre) ficam em `./zone.ts` com locale fixo DE PROPÓSITO:
// traduzi-los quebraria a ordenação de uma e o parsing da outra.
// ============================================================

const DATE_FNS_LOCALES: Record<string, Locale> = {
  'pt-BR': ptBR,
  pt: ptBR,
  en: enUS,
  'en-US': enUS,
  ko,
}

/** O locale do `date-fns` correspondente, com inglês como piso. */
export function dateFnsLocale(locale: string): Locale {
  return (
    DATE_FNS_LOCALES[locale] ??
    DATE_FNS_LOCALES[locale.split('-')[0]] ??
    enUS
  )
}

/** `03/08/2026` — a data curta, do jeito que o idioma escreve. */
export function formatDate(value: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(toDate(value))
}

/** `3 de ago. de 2026` — quando o mês por extenso lê melhor que o número. */
export function formatDateLong(value: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(toDate(value))
}

/** `3 de agosto de 2026` — o separador de dia dentro da conversa. */
export function formatDateFull(value: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(toDate(value))
}

/** `03/08/2026 14:30` — data e hora numa linha só. */
export function formatDateTime(value: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(toDate(value))
}

/** `3 de ago.` — o rótulo de eixo, onde o ano é ruído. */
export function formatDayMonth(value: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
  }).format(toDate(value))
}

/** `há 2 horas` — o tempo relativo, que era onde o inglês mais aparecia. */
export function formatRelative(value: Date | string, locale: string): string {
  return formatDistanceToNow(toDate(value), {
    addSuffix: true,
    locale: dateFnsLocale(locale),
  })
}

/**
 * String ou Date, indiferente.
 *
 * Quase toda chamada no app parte de um ISO vindo do Supabase, e
 * obrigar cada uma a construir o `Date` só rendia `new Date(...)`
 * repetido — e um lugar a mais para alguém esquecer.
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}
