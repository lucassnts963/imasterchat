import { GoogleError } from '@/lib/google/oauth'
import type { GoogleConnection } from '@/lib/google/connection'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseSlot, SLOT_ERROR_MESSAGE } from '@/lib/api/v1/appointments'
import { zonedParts, zonedTimeToUtc } from '@/lib/time/zone'
import { computeAvailableSlots, type Slot } from '@/lib/scheduling/availability'
import type { SchedulingSettings } from '@/lib/scheduling/settings'
import { classifyRefusal, describeRefusal } from '@/lib/scheduling/refusal'
import { loadGoogleConnection } from '@/lib/google/connection'
import {
  loadSchedulingSettings,
} from '@/lib/scheduling/settings'
import { recordEvent } from '@/lib/observability/events'
import {
  bookAppointment,
  cancelAppointment,
  loadBusyIntervals,
  rescheduleAppointment,
  type Appointment,
} from '@/lib/scheduling/store'

// ============================================================
// Agendamento como AÇÃO DE DOMÍNIO — a fase 1, R-3.
//
// Até aqui, marcar um horário só existia como ferramenta do agente de
// IA. Não porque a regra fosse de IA: `src/lib/scheduling/` já guardava
// disponibilidade, recusa, persistência e texto. O que estava preso ao
// agente era a CAMADA DE COLA — checar o slot de novo, pegar o
// agendamento vivo do contato, decidir o que fazer quando o Google não
// respondeu. Cerca de duzentas linhas que nada têm de modelo de
// linguagem, e sem as quais nem fluxo nem automação conseguiam agendar.
//
// Este módulo é essa cola, sem nenhum motor por perto. Ele:
//
//   - não fala com o cliente (quem redige a frase é o adaptador);
//   - não sabe o que é uma ferramenta, um nó ou um passo;
//   - devolve FATO ESTRUTURADO — o que aconteceu, e quando não deu, por
//     quê, num vocabulário fechado que os três motores traduzem cada um
//     do seu jeito.
//
// A regra do plano é "uma capacidade, uma implementação, três
// adaptadores finos". Este é o lado "uma implementação".
// ============================================================

export interface SchedulingDeps {
  settings: SchedulingSettings
  /** Null quando não há agenda conectada: o agendamento ainda é gravado
   *  aqui, mas a disponibilidade sai só das nossas próprias linhas. */
  connection: GoogleConnection | null
}

/**
 * Por que a ação não fez o que pediram. Vocabulário fechado de
 * propósito: é o que permite ao nó de fluxo desviar por uma aresta e à
 * ferramenta de IA escolher entre "explique ao cliente" e "chame
 * alguém", a partir do MESMO resultado.
 */
export type SchedulingRefusal =
  /** Não há contato — conversa sem cliente atrelado. */
  | 'no_contact'
  /** As datas não formam um intervalo válido. Erro de quem chamou. */
  | 'bad_slot'
  /** O horário existe mas não serve: fora do expediente, cedo demais,
   *  longe demais, ou tomado desde que foi oferecido. */
  | 'slot_unavailable'
  /** O contato não tem agendamento vivo para remarcar ou cancelar. */
  | 'no_appointment'
  /** Não deu para ler a agenda. **Nunca** tratar como "agenda vazia". */
  | 'calendar_unreadable'
  /** Gravado aqui, mas a agenda do negócio não recebeu. O dono trabalha
   *  pela agenda dele — isto precisa de gente. */
  | 'calendar_not_synced'
  /** A escrita falhou. */
  | 'write_failed'

export interface SchedulingFailure {
  ok: false
  reason: SchedulingRefusal
  /**
   * O FATO, em uma frase, sem instrução para ninguém. "Preciso de 2h de
   * antecedência; o mais cedo hoje é 11:00" serve igualmente para o
   * modelo, para o nó do fluxo e para o log da automação — o que cada um
   * acrescenta em volta é problema do adaptador.
   */
  message: string
  /** Só em `calendar_unreadable`: as credenciais do Google morreram, e
   *  o conserto é reconectar, não tentar de novo. */
  reconnect?: boolean
}

export type SchedulingResult<T> = { ok: true; data: T } | SchedulingFailure

/** Tudo que agendar precisa, resolvido uma vez por execução. */
export interface SchedulingContext {
  settings: SchedulingSettings
  /** Null quando não há agenda conectada — a reserva ainda é gravada,
   *  só não sai da nossa própria tabela. */
  connection: GoogleConnection | null
}

/**
 * Agendamento autônomo está ligado nesta conta, e com o quê?
 *
 * Devolve null quando está desligado, ou ligado e inutilizável. Resolvido
 * uma vez por quem chama e passado adiante, para uma mensagem recebida
 * não carregar a mesma configuração duas vezes.
 */
export async function resolveSchedulingContext(
  db: SupabaseClient,
  accountId: string,
): Promise<SchedulingContext | null> {
  const settings = await loadSchedulingSettings(db, accountId)
  if (!settings?.isActive) return null

  // Conexão não é obrigatória: sem ela, as reservas ainda caem em
  // `appointments` e a disponibilidade sai das nossas próprias linhas.
  // Produto pior — o dia bloqueado à mão pelo ótico fica invisível — mas
  // coerente, e mantém a funcionalidade demonstrável antes do OAuth.
  try {
    return { settings, connection: await loadGoogleConnection(db, accountId) }
  } catch (err) {
    // As credenciais existem mas não servem; o operador precisa
    // reconectar. Oferecer as ferramentas assim mesmo faria o bot
    // prometer horários que não consegue verificar.
    //
    // A tela de status responde "conectado" olhando se EXISTE linha,
    // não se o token vale. Então o operador vê "conectado", o cliente
    // acha que o bot está agendando, e as ferramentas simplesmente não
    // entram no catálogo — o bot nem sabe que podia agendar.
    void recordEvent({
      accountId,
      source: 'google',
      code:
        err instanceof Error && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'calendar_unusable',
      severity: 'error',
      message: `Agenda do Google inutilizável — o agendamento saiu do ar para esta conta: ${
        err instanceof Error ? err.message : String(err)
      }`,
      context: { hint: 'reconectar o Google em Configurações → Agendamento' },
    })
    return null
  }
}

function fail(
  reason: SchedulingRefusal,
  message: string,
  extra: { reconnect?: boolean } = {},
): SchedulingFailure {
  return { ok: false, reason, message, ...extra }
}

// ------------------------------------------------------------
// Consultar disponibilidade
// ------------------------------------------------------------

export interface ListAvailabilityArgs extends SchedulingDeps {
  db: SupabaseClient
  accountId: string
  from: Date
  to: Date
  now?: Date
}

/**
 * Os horários realmente livres no intervalo, já filtrados por
 * expediente, antecedência mínima, horizonte e o que está ocupado.
 *
 * Devolve os slots, não um texto: cada motor apresenta do seu jeito —
 * o agente numa frase, o fluxo numa lista de botões.
 */
export async function listAvailability(
  args: ListAvailabilityArgs,
): Promise<SchedulingResult<Slot[]>> {
  const { db, accountId, settings, connection, from, to } = args
  const now = args.now ?? new Date()

  if (to <= from) {
    return fail('bad_slot', 'The end of the range must be after its start.')
  }

  try {
    const busy = await loadBusyIntervals(db, accountId, connection, from, to)
    const slots = computeAvailableSlots({
      settings,
      busy,
      from,
      to,
      now,
      limit: settings.slotFetchLimit || undefined,
    })
    return { ok: true, data: slots }
  } catch (err) {
    return calendarFailure(err, 'read the calendar')
  }
}

// ------------------------------------------------------------
// Agendar
// ------------------------------------------------------------

export interface BookArgs extends SchedulingDeps {
  db: SupabaseClient
  accountId: string
  contactId: string | null
  conversationId: string | null
  /** ISO 8601, como veio de quem ofereceu o horário. */
  startsAt: unknown
  endsAt: unknown
  title?: string | null
  /** Quem marcou. `native` é o sistema falando com o cliente — agente,
   *  fluxo ou automação; `manual` é alguém pela tela. */
  createdVia: 'native' | 'manual'
}

export async function bookForContact(
  args: BookArgs,
): Promise<SchedulingResult<Appointment>> {
  const { db, accountId, contactId, settings, connection } = args
  if (!contactId) {
    return fail('no_contact', 'There is no customer attached to this conversation.')
  }

  const slot = parseSlot(args.startsAt, args.endsAt)
  if (!slot.ok) return fail('bad_slot', SLOT_ERROR_MESSAGE[slot.error])

  // Reconferir contra o estado vivo. O cliente levou tempo para
  // responder, e o horário oferecido pode ter ido embora nesse meio.
  const free = await assertSlotFree(args, slot.slot.startsAt, slot.slot.endsAt)
  if (free) return free

  const result = await bookAppointment({
    db,
    accountId,
    contactId,
    conversationId: args.conversationId,
    startsAt: slot.slot.startsAt,
    endsAt: slot.slot.endsAt,
    title: typeof args.title === 'string' ? args.title.slice(0, 200) : null,
    createdVia: args.createdVia,
    connection,
    timezone: settings.timezone,
    appointmentLabel: settings.appointmentLabel,
  })

  if (!result.ok) return fail('write_failed', result.message)
  if (!result.calendarSynced) {
    return fail(
      'calendar_not_synced',
      'The appointment was recorded but could not be written to the business calendar.',
    )
  }
  return { ok: true, data: result.appointment }
}

// ------------------------------------------------------------
// Remarcar
// ------------------------------------------------------------

export interface RescheduleArgs extends SchedulingDeps {
  db: SupabaseClient
  accountId: string
  contactId: string | null
  startsAt: unknown
  endsAt: unknown
}

export async function rescheduleForContact(
  args: RescheduleArgs,
): Promise<SchedulingResult<Appointment>> {
  const { db, accountId, contactId, settings, connection } = args
  if (!contactId) {
    return fail('no_contact', 'There is no customer attached to this conversation.')
  }

  const existing = await liveAppointmentForContact(db, accountId, contactId)
  if (!existing) {
    return fail('no_appointment', 'This customer has no appointment booked.')
  }

  const slot = parseSlot(args.startsAt, args.endsAt)
  if (!slot.ok) return fail('bad_slot', SLOT_ERROR_MESSAGE[slot.error])

  const free = await assertSlotFree(
    args,
    slot.slot.startsAt,
    slot.slot.endsAt,
    existing.id,
  )
  if (free) return free

  const result = await rescheduleAppointment({
    db,
    accountId,
    appointmentId: existing.id,
    startsAt: slot.slot.startsAt,
    endsAt: slot.slot.endsAt,
    connection,
    timezone: settings.timezone,
  })

  if (!result.ok) return fail('write_failed', result.message)
  if (!result.calendarSynced) {
    return fail(
      'calendar_not_synced',
      'The appointment was moved here but the business calendar was not updated.',
    )
  }
  return { ok: true, data: result.appointment }
}

// ------------------------------------------------------------
// Cancelar
// ------------------------------------------------------------

export interface CancelArgs extends SchedulingDeps {
  db: SupabaseClient
  accountId: string
  contactId: string | null
  reason?: string | null
}

export interface CancelledAppointment {
  appointment: Appointment
  /** Quando era, antes de cancelar — é o que a confirmação precisa dizer. */
  previousStartsAt: string
}

export async function cancelForContact(
  args: CancelArgs,
): Promise<SchedulingResult<CancelledAppointment>> {
  const { db, accountId, contactId, connection } = args
  if (!contactId) {
    return fail('no_contact', 'There is no customer attached to this conversation.')
  }

  const existing = await liveAppointmentForContact(db, accountId, contactId)
  if (!existing) {
    return fail('no_appointment', 'This customer has no appointment booked.')
  }

  const result = await cancelAppointment({
    db,
    accountId,
    appointmentId: existing.id,
    reason: typeof args.reason === 'string' ? args.reason.slice(0, 500) : null,
    connection,
  })

  if (!result.ok) return fail('write_failed', result.message)
  if (!result.calendarSynced) {
    return fail(
      'calendar_not_synced',
      'Cancelled here, but the event is still on the business calendar.',
    )
  }
  return {
    ok: true,
    data: {
      appointment: { ...result.appointment, startsAt: existing.startsAt },
      previousStartsAt: existing.startsAt,
    },
  }
}

// ------------------------------------------------------------
// Compartilhado
// ------------------------------------------------------------

/**
 * O único agendamento vivo do contato.
 *
 * Repare no que não existe aqui: um id de agendamento vindo de fora. O
 * cliente tem no máximo uma reserva viva (`idx_appointments_one_live_per_contact`),
 * então "o agendamento dele" é inequívoco — e um chamador que nunca vê
 * um UUID é um chamador que não consegue inventar um e cancelar o
 * horário de um estranho.
 */
export async function liveAppointmentForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<Appointment | null> {
  const { data, error } = await db
    .from('appointments')
    .select(
      'id, contact_id, conversation_id, starts_at, ends_at, status, title, notes, google_event_id, created_via',
    )
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'scheduled')
    .order('starts_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[scheduling] live appointment lookup failed:', error)
    return null
  }
  const row = (data ?? [])[0] as
    | {
        id: string
        contact_id: string
        conversation_id: string | null
        starts_at: string
        ends_at: string
        status: string
        title: string | null
        notes: string | null
        google_event_id: string | null
        created_via: string
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    title: row.title,
    notes: row.notes,
    googleEventId: row.google_event_id,
    createdVia: row.created_via,
  }
}

/**
 * O horário escolhido é legal e está livre? Versão pública, que também
 * valida o formato — é o que um ensaio precisa: roda toda a verificação
 * e não escreve nada.
 */
export async function checkSlotFree(
  args: SchedulingDeps & { db: SupabaseClient; accountId: string },
  startsAt: unknown,
  endsAt: unknown,
  ignoreAppointmentId?: string,
): Promise<SchedulingResult<{ startsAt: Date; endsAt: Date }>> {
  const slot = parseSlot(startsAt, endsAt)
  if (!slot.ok) return fail('bad_slot', SLOT_ERROR_MESSAGE[slot.error])
  const refusal = await assertSlotFree(
    args,
    slot.slot.startsAt,
    slot.slot.endsAt,
    ignoreAppointmentId,
  )
  if (refusal) return refusal
  return { ok: true, data: { startsAt: slot.slot.startsAt, endsAt: slot.slot.endsAt } }
}

/**
 * O horário escolhido ainda é legal e ainda está livre?
 *
 * `computeAvailableSlots` é a autoridade, então isto pergunta a ela em
 * vez de rederivar as regras: um horário vale só se voltar como um dos
 * livres. Isso pega os quatro filtros de uma vez — fora do expediente,
 * dentro da antecedência, além do horizonte, ou tomado desde a oferta.
 *
 * Devolve `null` quando está livre, ou a recusa pronta.
 */
async function assertSlotFree(
  args: SchedulingDeps & {
    db: SupabaseClient
    accountId: string
  },
  startsAt: Date,
  endsAt: Date,
  ignoreAppointmentId?: string,
): Promise<SchedulingFailure | null> {
  const { db, accountId, settings, connection } = args
  try {
    const busy = await loadBusyIntervals(db, accountId, connection, startsAt, endsAt)

    // Ao mover um agendamento existente, o horário dele próprio não pode
    // contar contra ele — senão "mesmo dia, uma hora depois" é
    // impossível sempre que os dois se sobrepõem.
    const filtered = ignoreAppointmentId
      ? await withoutOwnInterval(db, accountId, ignoreAppointmentId, busy)
      : busy

    const slots = computeAvailableSlots({
      settings,
      busy: filtered,
      from: startsAt,
      to: endsAt,
      limit: 1,
    })
    const match = slots.find(
      (s) =>
        s.startsAt.getTime() === startsAt.getTime() &&
        s.endsAt.getTime() === endsAt.getTime(),
    )
    if (match) return null

    // O servidor sabe QUAL regra derrubou o horário. Devolver as quatro
    // possibilidades numa frase só fazia o modelo dizer "não está
    // disponível" — e um dono que olha a agenda vazia naquele horário
    // conclui, com razão, que o bot está quebrado.
    return fail(
      'slot_unavailable',
      describeRefusal(
        classifyRefusal({ settings, startsAt, endsAt, busy: filtered }),
        settings,
      ),
    )
  } catch (err) {
    return calendarFailure(err, 'check the calendar')
  }
}

async function withoutOwnInterval(
  db: SupabaseClient,
  accountId: string,
  appointmentId: string,
  busy: { start: Date; end: Date }[],
): Promise<{ start: Date; end: Date }[]> {
  const { data } = await db
    .from('appointments')
    .select('starts_at, ends_at')
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .maybeSingle<{ starts_at: string; ends_at: string }>()
  if (!data) return busy
  const ownStart = new Date(data.starts_at).getTime()
  const ownEnd = new Date(data.ends_at).getTime()
  return busy.filter(
    (b) => !(b.start.getTime() === ownStart && b.end.getTime() === ownEnd),
  )
}

/**
 * Uma agenda que não conseguimos ler não é uma agenda vazia. Oferecer
 * horários calculados sem o Google marcaria dois clientes no mesmo
 * espaço, então isto para em vez de degradar.
 */
function calendarFailure(err: unknown, what: string): SchedulingFailure {
  const reconnect =
    err instanceof GoogleError &&
    (err.code === 'not_authorized' ||
      err.code === 'invalid_grant' ||
      err.code === 'credentials_unreadable')

  console.error(`[scheduling] could not ${what}:`, err)
  return fail(
    'calendar_unreadable',
    reconnect
      ? 'The business calendar is no longer connected.'
      : `Could not ${what} right now.`,
    { reconnect },
  )
}

// ------------------------------------------------------------
// Limites de dia, para quem pede disponibilidade por data
// ------------------------------------------------------------

export function parseDayStart(value: unknown, timezone: string): Date | null {
  const ymd = parseYmd(value)
  if (!ymd) return null
  return zonedMidnight(ymd, timezone, 0)
}

export function parseDayEnd(value: unknown, timezone: string): Date | null {
  const ymd = parseYmd(value)
  if (!ymd) return null
  // Fim do dia nomeado, isto é, meia-noite do começo do seguinte.
  return zonedMidnight(ymd, timezone, 1)
}

function parseYmd(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function zonedMidnight(
  ymd: { year: number; month: number; day: number },
  timezone: string,
  addDays: number,
): Date {
  // Monta a data em UTC primeiro para a virada de mês/ano ser problema
  // do runtime, e só então resolve a meia-noite daquele dia no fuso.
  const rolled = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + addDays, 12))
  const parts = zonedParts(rolled, 'UTC')
  return zonedTimeToUtc(
    { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0 },
    timezone,
  )
}
