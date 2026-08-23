import type { SupabaseClient } from '@supabase/supabase-js'
import type { GoogleConnection } from '@/lib/google/connection'
import { loadGoogleConnection } from '@/lib/google/connection'
import {
  loadSchedulingSettings,
  type SchedulingSettings,
} from '@/lib/scheduling/settings'
import { requestHumanTool } from './handoff'
import { buildSchedulingTools } from './scheduling'
import { buildQueueTools, type QueueOption } from './queues'
import { buildTagTools, type TagOption } from './tags'
import type { AgentTool } from './types'
import { recordEvent } from '@/lib/observability/events'

// ============================================================
// What tools an account's agent actually gets.
//
// The catalog is built per run, not declared once, because it depends
// on how the account is set up: no Google connection means the
// scheduling tools do not exist as far as the model is concerned. That
// is deliberate — a tool the model can see is a tool it will try, and
// "I called book_appointment and it said not configured" is a worse
// conversation than never offering to book at all.
//
// A tool being absent is the strongest possible permission check, and
// it costs no prompt tokens.
// ============================================================

/** Everything scheduling needs, resolved once per run. */
export interface SchedulingContext {
  settings: SchedulingSettings
  /** Null when no calendar is connected — bookings still record, they
   *  just live only in the CRM. */
  connection: GoogleConnection | null
}

/**
 * Is autonomous scheduling live for this account, and with what?
 *
 * Returns null when it is switched off, or on but unusable. Resolved
 * once by the caller and handed to both the tool catalog and the
 * environment block, so a single inbound message does not load the same
 * settings twice.
 */
export async function resolveSchedulingContext(
  db: SupabaseClient,
  accountId: string,
): Promise<SchedulingContext | null> {
  const settings = await loadSchedulingSettings(db, accountId)
  if (!settings?.isActive) return null

  // A connection is not required: without one, bookings still land in
  // `appointments` and availability comes from our own rows. Worse
  // product — the optician's hand-blocked day is invisible — but a
  // coherent one, and it keeps the feature demoable before OAuth is set
  // up.
  try {
    return { settings, connection: await loadGoogleConnection(db, accountId) }
  } catch (err) {
    // Credentials exist but are unusable; the operator must reconnect.
    // Offering the tools anyway would have the bot promising times it
    // cannot verify.
    // A tela de status responde "conectado" olhando se EXISTE linha,
    // não se o token vale. Então o operador vê "conectado", o cliente
    // acha que o bot está agendando, e as ferramentas simplesmente não
    // entram no catálogo — o bot nem sabe que podia agendar.
    void recordEvent({
      accountId,
      source: 'google',
      code: err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'calendar_unusable',
      severity: 'error',
      message: `Agenda do Google inutilizável — as ferramentas de agendamento saíram do catálogo do agente: ${
        err instanceof Error ? err.message : String(err)
      }`,
      context: { hint: 'reconectar o Google em Configurações → Agendamento' },
    })
    return null
  }
}

/**
 * The one tool that cannot be switched off.
 *
 * It is how the agent stops. An account without it has a bot that never
 * calls a person, and that account is exactly the one that would have
 * switched it off by mistake — so the decision is not offered.
 */
export const ALWAYS_ON_TOOLS = new Set(['request_human'])

/** Tools this account has switched off. */
export async function loadDisabledTools(
  db: SupabaseClient,
  accountId: string,
): Promise<Set<string>> {
  try {
    const { data, error } = await db
      .from('ai_disabled_tools')
      .select('tool_name')
      .eq('account_id', accountId)
    if (error) throw error
    return new Set(
      ((data ?? []) as { tool_name: string }[])
        .map((r) => r.tool_name)
        .filter((name) => !ALWAYS_ON_TOOLS.has(name)),
    )
  } catch (err) {
    // Failing open is the right call: a tool that stays available when
    // the toggle list cannot be read is a working bot, where failing
    // closed would silently strip an account of scheduling.
    console.error('[ai tools] disabled list unreadable, treating as none:', err)
    return new Set()
  }
}

export interface BuildToolsArgs {
  db: SupabaseClient
  accountId: string
  /** Null in the Playground. Tools needing a thread degrade gracefully. */
  conversationId: string | null
  /** From `resolveSchedulingContext`. Null → no scheduling tools. */
  scheduling?: SchedulingContext | null
  /** Pre-loaded deny list, so a caller that already has it does not
   *  make the query twice. */
  disabled?: Set<string>
}

/**
 * As filas para as quais o agente pode encaminhar.
 *
 * Só as HUMANAS: mandar para a fila do robô seria encaminhar para si
 * mesmo. Só as ativas, e nunca a padrão — a conversa já está nela.
 */
async function loadRoutableQueues(
  db: SupabaseClient,
  accountId: string,
): Promise<QueueOption[]> {
  try {
    const { data } = await db
      .from('queues')
      .select('id, name, description, responsible_user_id, auto_assign, distribution')
      .eq('account_id', accountId)
      .eq('active', true)
      .eq('attended_by', 'humans')
      .order('position')
    // `Array.isArray`, e não `data ?? []`: uma resposta malformada não é
    // nula, é um objeto — e o `.map` logo abaixo estouraria FORA do
    // try/catch, derrubando a montagem inteira do catálogo por causa de
    // uma consulta acessória.
    if (!Array.isArray(data)) return []
    return ((data ?? []) as Array<{
      id: string
      name: string
      description: string | null
      responsible_user_id: string | null
      auto_assign: boolean
      distribution: string
    }>).map((q) => ({
      id: q.id,
      name: q.name,
      description: q.description,
      responsibleUserId: q.responsible_user_id,
      autoAssign: q.auto_assign,
      distribution: q.distribution ?? 'responsible',
    }))
  } catch (err) {
    // Falhar ABERTO seria oferecer encaminhamento que não funciona.
    // Sem a lista, a ferramenta não entra no catálogo e o agente cai no
    // `request_human`, que é o comportamento anterior a esta onda.
    console.error('[ai tools] filas indisponíveis:', err)
    return []
  }
}

/**
 * As etiquetas que a conta autorizou o agente a aplicar.
 *
 * `ai_selectable` é padrão `false` (migração 067): a lista nasce vazia,
 * e a ferramenta só aparece depois que alguém escolhe. É a defesa contra
 * o cliente pedir uma etiqueta pelo texto da mensagem.
 */
async function loadSelectableTags(
  db: SupabaseClient,
  accountId: string,
): Promise<TagOption[]> {
  try {
    const { data } = await db
      .from('tags')
      .select('id, name')
      .eq('account_id', accountId)
      .eq('ai_selectable', true)
      .order('name')
    // Mesmo cuidado do carregador de filas: quem consome faz `.map`,
    // e isso acontece fora deste try.
    return Array.isArray(data) ? (data as TagOption[]) : []
  } catch (err) {
    console.error('[ai tools] etiquetas indisponíveis:', err)
    return []
  }
}

/**
 * Resolve the tools available to this account right now.
 *
 * `request_human` is unconditional: any agent that can talk to a
 * customer must be able to stop and call a person. Scheduling appears
 * only when it is switched on — and when it is off the tools do not
 * merely fail, they are absent, so the model cannot offer to book and
 * then discover it can't.
 */
export async function buildToolCatalog(
  args: BuildToolsArgs,
): Promise<AgentTool[]> {
  const tools: AgentTool[] = [requestHumanTool]

  const scheduling =
    args.scheduling === undefined
      ? await resolveSchedulingContext(args.db, args.accountId)
      : args.scheduling
  if (scheduling) {
    tools.push(...buildSchedulingTools(scheduling))
  }

  // Filas humanas e etiquetas liberadas, em paralelo: são duas consultas
  // independentes e ambas entram em toda montagem do catálogo.
  const [queues, tags] = await Promise.all([
    loadRoutableQueues(args.db, args.accountId),
    loadSelectableTags(args.db, args.accountId),
  ])
  tools.push(...buildQueueTools(queues))
  tools.push(...buildTagTools(tags))

  const disabled =
    args.disabled ?? (await loadDisabledTools(args.db, args.accountId))

  // A disabled tool is REMOVED, not flagged. The model never learns it
  // exists, so it cannot offer it and then fail — the same reasoning
  // that keeps unavailable tools out of the catalogue entirely. It also
  // stops paying for its schema on every request, which the cost
  // breakdown showed is the largest slice of the prompt.
  return tools.filter(
    (tool) => ALWAYS_ON_TOOLS.has(tool.name) || !disabled.has(tool.name),
  )
}
