import type { AutomationTriggerType } from '@/types'
import { formatRelative as formatRelativeInLocale } from '@/lib/time/format'

export interface TriggerMeta {
  label: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'New Message',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    label: 'First Message from Contact',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Keyword Match',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    label: 'New Contact',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversation Assigned',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    label: 'Tag Added',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Time-Based',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  },
  interactive_reply: {
    label: 'Button / List Reply',
    pillClass: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
  },
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
    }
  )
}

/**
 * Quanto tempo faz, na língua do app.
 *
 * A versão anterior era inglês fixo de ponta a ponta — 'never', 'just
 * now', '5m ago' — e terminava num `toLocaleDateString()` sem locale,
 * que usa o do NAVEGADOR. Duas formas de errar na mesma função.
 *
 * `null` devolve null em vez de uma palavra: só quem renderiza sabe
 * como dizer "nunca" na língua certa, e inventar aqui foi o que
 * plantou o inglês da primeira vez.
 */
export function formatRelative(
  iso: string | null | undefined,
  locale: string,
): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return formatRelativeInLocale(new Date(then), locale)
}
