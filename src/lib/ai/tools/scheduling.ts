import type { GoogleConnection } from '@/lib/google/connection'
import { formatInZone } from '@/lib/time/zone'
import { describeSlots } from '@/lib/scheduling/availability'
import type { SchedulingSettings } from '@/lib/scheduling/settings'
import { describeAppointment } from '@/lib/scheduling/store'
import {
  bookForContact,
  cancelForContact,
  checkSlotFree,
  listAvailability,
  liveAppointmentForContact,
  parseDayEnd,
  parseDayStart,
  rescheduleForContact,
  type SchedulingFailure,
} from '@/lib/actions/scheduling'
import type { AgentTool, ToolContext, ToolOutcome } from './types'

// ============================================================
// As ferramentas de agendamento.
//
// O modelo escolhe QUAL ferramenta e QUANDO. Ele não escolhe se um
// horário é legal — expediente, antecedência, horizonte e colisão são
// decididos em `src/lib/actions/scheduling.ts`, e os índices da 041
// ficam atrás disso como última linha contra um agente que insiste.
//
// Depois da fase 1 (R-3) este arquivo é só TRADUÇÃO: da ação de domínio
// para o que um modelo precisa ler. Toda frase aqui existe porque tem um
// leitor específico — "Confirm it to the customer" é instrução para o
// modelo, não fato sobre o agendamento, e por isso mora deste lado.
//
// Repare no que estas assinaturas NÃO recebem: um id de agendamento. O
// cliente tem no máximo uma reserva viva, então "o agendamento dele" é
// inequívoco — e um modelo que nunca vê um UUID não consegue inventar um
// e cancelar o horário de um estranho.
// ============================================================

/** Até onde `check_availability` olha quando pedem "logo". */
// O padrão quando a conta não tem regra própria. Agora é
// `lookahead_days` em Agentes → Regras.
const DEFAULT_LOOKAHEAD_DAYS = 7

export interface SchedulingToolDeps {
  settings: SchedulingSettings
  /** Null when no calendar is connected: bookings still record, but
   *  availability is then based only on our own table. */
  connection: GoogleConnection | null
}

export function buildSchedulingTools(deps: SchedulingToolDeps): AgentTool[] {
  return [
    checkAvailabilityTool(deps),
    bookAppointmentTool(deps),
    rescheduleAppointmentTool(deps),
    cancelAppointmentTool(deps),
  ]
}

/**
 * Uma recusa da ação, dita para o modelo.
 *
 * Duas famílias, e a diferença é o que o bot faz em seguida. Agenda
 * ilegível ou desincronizada significa que o sistema não sabe o que o
 * dono tem marcado: aí o bot **para** e chama gente, porque confirmar um
 * horário nesse estado é marcar dois clientes no mesmo espaço. Todo o
 * resto é conversa — o modelo explica e o cliente escolhe outra coisa.
 */
function toolOutcomeFor(failure: SchedulingFailure): ToolOutcome {
  switch (failure.reason) {
    case 'calendar_unreadable':
      return {
        content: `${failure.message} Do not offer or confirm any time.`,
        isError: true,
        handoff: true,
      }
    case 'calendar_not_synced':
      return {
        content: `${failure.message} Do not confirm it to the customer — a human must check.`,
        isError: true,
        handoff: true,
      }
    default:
      return { content: failure.message, isError: true }
  }
}

// ------------------------------------------------------------
// check_availability
// ------------------------------------------------------------

function checkAvailabilityTool(deps: SchedulingToolDeps): AgentTool {
  const { settings, connection } = deps
  return {
    name: 'check_availability',
    description:
      'List appointment slots that are actually free. Call this BEFORE offering any time — ' +
      'never invent or guess availability. Returns times already filtered by the business hours, ' +
      'the minimum notice and everything already booked.',
    parameters: {
      type: 'object',
      properties: {
        date_from: {
          type: 'string',
          description:
            'First day to look at, as YYYY-MM-DD in the business timezone. Defaults to today.',
        },
        date_to: {
          type: 'string',
          description: `Last day to look at, as YYYY-MM-DD. Defaults to ${settings.lookaheadDays || DEFAULT_LOOKAHEAD_DAYS} days after date_from.`,
        },
      },
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const now = new Date()
      const from = parseDayStart(args.date_from, settings.timezone) ?? now
      const to =
        parseDayEnd(args.date_to, settings.timezone) ??
        new Date(
          from.getTime() +
            (settings.lookaheadDays || DEFAULT_LOOKAHEAD_DAYS) * 24 * 60 * 60_000,
        )

      const result = await listAvailability({
        db: ctx.db,
        accountId: ctx.accountId,
        settings,
        connection,
        from,
        to,
        now,
      })
      if (!result.ok) {
        // `bad_slot` aqui é a faixa invertida, que era uma mensagem
        // própria antes da extração. Mantida palavra por palavra.
        if (result.reason === 'bad_slot') {
          return { content: 'date_to must be after date_from.', isError: true }
        }
        return toolOutcomeFor(result)
      }
      return { content: describeSlots(result.data, settings.timezone, settings) }
    },
  }
}

// ------------------------------------------------------------
// book_appointment
// ------------------------------------------------------------

function bookAppointmentTool(deps: SchedulingToolDeps): AgentTool {
  const { settings, connection } = deps
  return {
    name: 'book_appointment',
    description:
      'Book one of the free slots for this customer, after they have chosen it. Use an exact ' +
      'start and end taken from check_availability — do not adjust them. Only call this once ' +
      'the customer has confirmed a specific time.',
    parameters: {
      type: 'object',
      properties: {
        starts_at: {
          type: 'string',
          description: 'ISO 8601 start instant, exactly as offered.',
        },
        ends_at: {
          type: 'string',
          description: 'ISO 8601 end instant, exactly as offered.',
        },
        title: {
          type: 'string',
          description:
            'Short description of what the appointment is for, in the customer’s words.',
        },
      },
      required: ['starts_at', 'ends_at'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      if (!ctx.dryRun && !ctx.contactId) {
        return {
          content: 'No customer is attached to this conversation, so nothing can be booked.',
          isError: true,
        }
      }

      // O ensaio roda TODAS as verificações — as regras do horário, o
      // expediente, a colisão contra o Google e contra as nossas
      // próprias reservas — e retém só a escrita, para um ensaio provar
      // que o diálogo marca o horário CERTO sem deixar um ensaio na
      // agenda da loja.
      if (ctx.dryRun) {
        const check = await checkSlotFree(
          { db: ctx.db, accountId: ctx.accountId, settings, connection },
          args.starts_at,
          args.ends_at,
        )
        if (!check.ok) return toolOutcomeFor(check)
        return {
          content:
            `Test run: this would book ${formatInZone(check.data.startsAt, settings.timezone)} ` +
            `(${settings.timezone}) and the slot is genuinely free. Nothing was written. ` +
            'Confirm to the customer as you normally would.',
        }
      }

      const result = await bookForContact({
        db: ctx.db,
        accountId: ctx.accountId,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        settings,
        connection,
        startsAt: args.starts_at,
        endsAt: args.ends_at,
        title: typeof args.title === 'string' ? args.title : null,
        createdVia: 'native',
      })

      if (!result.ok) return toolOutcomeFor(result)

      return {
        content: `Booked: ${describeAppointment(result.data, settings.timezone)}. Confirm it to the customer.`,
      }
    },
  }
}

// ------------------------------------------------------------
// reschedule_appointment
// ------------------------------------------------------------

function rescheduleAppointmentTool(deps: SchedulingToolDeps): AgentTool {
  const { settings, connection } = deps
  return {
    name: 'reschedule_appointment',
    description:
      'Move this customer’s existing appointment to a different free slot. Check availability ' +
      'first and use an exact slot from it.',
    parameters: {
      type: 'object',
      properties: {
        starts_at: { type: 'string', description: 'New ISO 8601 start instant.' },
        ends_at: { type: 'string', description: 'New ISO 8601 end instant.' },
      },
      required: ['starts_at', 'ends_at'],
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const rehearsal = await rehearsalWithoutAppointment(ctx)
      if (rehearsal) return rehearsal

      if (ctx.dryRun) {
        const existing = await liveAppointmentForContact(
          ctx.db,
          ctx.accountId,
          ctx.contactId!,
        )
        const check = await checkSlotFree(
          { db: ctx.db, accountId: ctx.accountId, settings, connection },
          args.starts_at,
          args.ends_at,
          existing?.id,
        )
        if (!check.ok) return toolOutcomeFor(check)
        return {
          content:
            `Test run: this would move the appointment to ${formatInZone(check.data.startsAt, settings.timezone)} ` +
            `(${settings.timezone}) and the slot is genuinely free. Nothing was written.`,
        }
      }

      const result = await rescheduleForContact({
        db: ctx.db,
        accountId: ctx.accountId,
        contactId: ctx.contactId,
        settings,
        connection,
        startsAt: args.starts_at,
        endsAt: args.ends_at,
      })

      if (!result.ok) {
        if (result.reason === 'no_appointment') {
          return {
            content:
              'This customer has no appointment booked, so there is nothing to move. Book one instead.',
            isError: true,
          }
        }
        return toolOutcomeFor(result)
      }

      return {
        content: `Moved to ${describeAppointment(result.data, settings.timezone)}. Confirm it to the customer.`,
      }
    },
  }
}

// ------------------------------------------------------------
// cancel_appointment
// ------------------------------------------------------------

function cancelAppointmentTool(deps: SchedulingToolDeps): AgentTool {
  const { settings, connection } = deps
  return {
    name: 'cancel_appointment',
    description:
      'Cancel this customer’s existing appointment, freeing the slot. Only after they clearly ' +
      'asked to cancel.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why the customer cancelled, in one short sentence.',
        },
      },
      additionalProperties: false,
    },

    async execute(args, ctx) {
      const rehearsal = await rehearsalWithoutAppointment(ctx)
      if (rehearsal) return rehearsal

      if (ctx.dryRun) {
        const existing = await liveAppointmentForContact(
          ctx.db,
          ctx.accountId,
          ctx.contactId!,
        )
        return {
          content: existing
            ? `Test run: this would cancel the appointment on ${formatInZone(
                new Date(existing.startsAt),
                settings.timezone,
              )} (${settings.timezone}). Nothing was written.`
            : 'This customer has no appointment booked — nothing to cancel.',
          isError: !existing,
        }
      }

      const result = await cancelForContact({
        db: ctx.db,
        accountId: ctx.accountId,
        contactId: ctx.contactId,
        settings,
        connection,
        reason: typeof args.reason === 'string' ? args.reason : null,
      })

      if (!result.ok) {
        if (result.reason === 'no_appointment') {
          return {
            content: 'This customer has no appointment booked — nothing to cancel.',
            isError: true,
          }
        }
        return toolOutcomeFor(result)
      }

      return {
        content: `Cancelled the appointment that was on ${describeAppointment(
          result.data.appointment,
          settings.timezone,
        )}. Confirm the cancellation to the customer.`,
      }
    },
  }
}

// ------------------------------------------------------------
// Compartilhado
// ------------------------------------------------------------

/**
 * No Playground não há cliente atrelado, então não há agendamento
 * existente para remarcar ou cancelar. Dizer isso ao operador com todas
 * as letras é melhor do que devolver "este cliente não tem agendamento",
 * que ele leria como defeito.
 */
async function rehearsalWithoutAppointment(
  ctx: ToolContext,
): Promise<ToolOutcome | null> {
  if (!ctx.dryRun) return null
  const existing = ctx.contactId
    ? await liveAppointmentForContact(ctx.db, ctx.accountId, ctx.contactId)
    : null
  if (existing) return null
  return {
    content:
      'Test run: there is no customer attached, so there is no existing appointment to work ' +
      'from. Rehearse booking instead.',
    isError: true,
  }
}
