/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Meta API calls — `meta-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the runner refuses to advance
 *     an active run twice for the same Meta message — protects against
 *     Meta's retries.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises 23505 and the runner catches & exits.
 */

import { supabaseAdmin } from "./admin-client";
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from "./meta-send";
import { decideFallback, resolveFallbackPolicy } from "./fallback";
import { MAX_FLOW_CHAIN_DEPTH } from "./chain";
import { addContactTagAndDispatch } from "@/lib/contacts/tag-events";
import {
  assignConversation,
  closeConversation,
  createDeal,
  updateContactField,
} from "@/lib/actions/crm";
import { loadQueue, routeConversationToQueue } from "@/lib/actions/queue-routing";
import { templateParams } from "@/lib/whatsapp/template-params";
import { isDeliverableUrl } from "@/lib/webhooks/ssrf";
// O template mora no módulo de automações e é usado pelos dois, do mesmo
// jeito que o envio interativo mora aqui e é usado lá — uma
// implementação por formato de envio, dois motores.
import { engineSendTemplate } from "@/lib/automations/meta-send";
import {
  bookForContact,
  cancelForContact,
  listAvailability,
  rescheduleForContact,
  resolveSchedulingContext,
  type SchedulingContext,
  type SchedulingFailure,
} from "@/lib/actions/scheduling";
import {
  parseSlotReplyId,
  readOfferedSlots,
  slotOptionDescription,
  slotOptionTitle,
  slotReplyId,
} from "@/lib/scheduling/slot-option";
import { removeContactTag } from "@/lib/contacts/tag-write";
import {
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type FlowNodeRow,
  type FlowRow,
  type FlowRunRow,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMediaNodeConfig,
  type SendMessageNodeConfig,
  type SetTagNodeConfig,
  type SendTemplateNodeConfig,
  type UpdateContactFieldNodeConfig,
  type CreateDealNodeConfig,
  type AssignConversationNodeConfig,
  type CloseConversationNodeConfig,
  type RouteToQueueNodeConfig,
  type WaitNodeConfig,
  type SendWebhookNodeConfig,
  type OfferSlotsNodeConfig,
  type BookAppointmentNodeConfig,
  type RescheduleAppointmentNodeConfig,
  type CancelAppointmentNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from "./types";

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
): string | null {
  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (matchType === "exact" ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === "start" ||
    node_type === "send_message" ||
    node_type === "send_media" ||
    node_type === "condition" ||
    node_type === "set_tag" ||
    node_type === "send_template" ||
    node_type === "update_contact_field" ||
    node_type === "create_deal" ||
    node_type === "assign_conversation" ||
    node_type === "close_conversation" ||
    node_type === "send_webhook" ||
    node_type === "book_appointment" ||
    node_type === "reschedule_appointment" ||
    node_type === "cancel_appointment"
  );
}

/** Nodes that send a prompt and suspend awaiting a customer reply. */
export function isSuspending(node_type: string): boolean {
  return (
    node_type === "send_buttons" ||
    node_type === "send_list" ||
    node_type === "collect_input" ||
    node_type === "offer_slots"
  );
}

/**
 * Nós que param o run sem esperar o cliente.
 *
 * A distinção importa em dois lugares: a varredura de abandono não pode
 * matar quem está legitimamente dormindo, e uma mensagem que chegue
 * durante a espera não é resposta a nada — o fluxo não está escutando.
 */
export function isSleeping(node_type: string): boolean {
  return node_type === "wait";
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return (
    node_type === "handoff" ||
    node_type === "route_to_queue" ||
    node_type === "end"
  );
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"];
  /**
   * Resolved value of the subject. `undefined` means the subject is
   * absent (no var with that key / no such tag / contact field is
   * null). Pure function: caller does the DB lookup.
   */
  subjectValue: string | undefined;
  /** The configured comparison value, when applicable. */
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? "");
    case "contains":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? "");
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

type AdminClient = ReturnType<typeof supabaseAdmin>;

async function loadActiveRunForContact(
  db: AdminClient,
  accountId: string,
  contactId: string,
): Promise<FlowRunRow | null> {
  // The partial unique index `idx_one_active_run_per_contact` was
  // rebuilt in migration 017 over `(account_id, contact_id)` — so
  // "two active runs for one contact in one account" is impossible
  // by design. But a future migration glitch or manual SQL could
  // create one, and .maybeSingle() throws on >1 row — which would
  // kill dispatch for that contact's webhook entirely. .limit(1) is
  // forgiving: pick the newest, let the cron sweep clean up the
  // stale one.
  const { data, error } = await db
    .from("flow_runs")
    .select("*")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[flows] loadActiveRunForContact error:", error.message);
    return null;
  }
  const rows = (data as FlowRunRow[] | null) ?? [];
  return rows[0] ?? null;
}

async function loadFlow(
  db: AdminClient,
  flowId: string,
): Promise<FlowRow | null> {
  const { data, error } = await db
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .maybeSingle();
  if (error) {
    console.error("[flows] loadFlow error:", error.message);
    return null;
  }
  return (data as FlowRow | null) ?? null;
}

/**
 * Load every node of a flow in one round trip and key them by
 * `node_key`. The advance loop is then in-memory — a 5-node
 * auto-advancing chain costs one SELECT, not five.
 *
 * Returns an empty map on error so the caller can still dispatch
 * cleanly (every subsequent .get() returns undefined → the run
 * fails with node_not_found, same as the old per-node lookup).
 */
async function loadAllNodes(
  db: AdminClient,
  flowId: string,
): Promise<Map<string, FlowNodeRow>> {
  const { data, error } = await db
    .from("flow_nodes")
    .select("*")
    .eq("flow_id", flowId);
  if (error) {
    console.error("[flows] loadAllNodes error:", error.message);
    return new Map();
  }
  const map = new Map<string, FlowNodeRow>();
  for (const row of (data ?? []) as FlowNodeRow[]) {
    map.set(row.node_key, row);
  }
  return map;
}

async function logEvent(
  db: AdminClient,
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("flow_run_events").insert({
    flow_run_id: flowRunId,
    event_type,
    node_key,
    payload,
  });
  if (error) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error("[flows] logEvent error:", error.message);
  }
}

/**
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 *
 * Implementation note: scoped to runs belonging to this user/contact
 * so the lookup is cheap (the index on flow_run_events(flow_run_id,
 * event_type) plus the small set of runs per contact).
 */
async function isDuplicateInbound(
  db: AdminClient,
  accountId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  // Fetch ALL run ids for this contact in this account (active +
  // historical). Bounded by how many flows the customer has been
  // through — small.
  const { data: runs } = await db
    .from("flow_runs")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId);
  if (!runs?.length) return false;
  const runIds = runs.map((r) => (r as { id: string }).id);

  const { count } = await db
    .from("flow_run_events")
    .select("id", { count: "exact", head: true })
    .in("flow_run_id", runIds)
    .eq("event_type", "reply_received")
    .filter("payload->>meta_message_id", "eq", metaMessageId);
  return (count ?? 0) > 0;
}

async function findEntryFlow(
  db: AdminClient,
  accountId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
): Promise<FlowRow | null> {
  // Only text messages can match an entry trigger. Interactive replies
  // are responses to existing prompts; they never start a new flow.
  if (message.kind !== "text") return null;

  // Pull all active flows for this account. Active set is bounded
  // (the builder discourages double-trigger overlap; partial index
  // makes the lookup index-supported).
  const { data: flows, error } = await db
    .from("flows")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error || !flows) return null;

  const typed = flows as FlowRow[];
  for (const flow of typed) {
    if (flow.trigger_type === "keyword") {
      if (matchesKeywordTrigger(
        message.text,
        flow.trigger_config as KeywordTriggerConfig,
      )) {
        return flow;
      }
    } else if (flow.trigger_type === "first_inbound_message" && isFirstInbound) {
      return flow;
    }
    // 'manual' triggers do not auto-start from inbound messages.
  }
  return null;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function sendButtonsAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_buttons",
    whatsapp_message_id,
  });
  // Look up our internal message id so we can stash it on the run.
  // Cheap — indexed on `messages.message_id`.
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function sendListAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_list",
    whatsapp_message_id,
  });
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function executeHandoff(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string };
  const convUpdate: Record<string, unknown> = {
    status: "pending",
    // Desliga a resposta automática, como o handoff do agente de IA já
    // fazia (`lib/conversations/handoff.ts`).
    //
    // Sem isto, o handoff de fluxo era mais fraco do que parecia: ele
    // punha a conversa em `pending` e ia embora, mas o portão que cala o
    // bot é `assigned_agent_id` OU `ai_autoreply_disabled` — e este
    // caminho não escrevia nenhum dos dois quando não havia
    // `assign_to`. Resultado: o fluxo dizia "vou chamar uma pessoa" e a
    // IA respondia na mensagem seguinte, por cima da promessa.
    ai_autoreply_disabled: true,
    // A nota interna do nó vira o motivo que a tarja do inbox mostra.
    // Antes ela era só gravada no log do fluxo, onde a atendente não
    // olha — a tarja aparecia vazia, sem dizer por que a conversa
    // chegou ali.
    ai_handoff_summary: cfg.note?.trim() ? `🔀 ${cfg.note.trim()}` : null,
    updated_at: new Date().toISOString(),
  };
  if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;
  if (run.conversation_id) {
    await db
      .from("conversations")
      .update(convUpdate)
      .eq("id", run.conversation_id);
  }
  await logEvent(db, run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(db, run.id, "handed_off", "handoff_node");
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a Supabase mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input
 *     or http_fetch in v2).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *     `subject_key` IS the tag UUID; the SELECT returns 1 row or 0.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
async function evaluateConditionNode(
  db: AdminClient,
  run: FlowRunRow,
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const { count } = await db
      .from("contact_tags")
      .select("contact_id", { count: "exact", head: true })
      .eq("contact_id", run.contact_id!)
      .eq("tag_id", cfg.subject_key);
    // For tags, "present" really is the only meaningful test — the
    // `present`/`absent` operators are the natural fit. equals/contains
    // against a tag UUID would still work mechanically (compare its
    // existence to the value).
    subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const { data } = await db
      .from("contacts")
      .select(cfg.subject_key)
      .eq("id", run.contact_id!)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

/**
 * Tiny `{{vars.foo}}` interpolation. Used by send_message + collect_input
 * prompt text so a captured `name` can show up in the next prompt
 * ("Thanks {{vars.name}}, what's your email?"). Missing vars render as
 * empty string — the same behavior as the automations engine.
 */
function interpolateVars(template: string, vars: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

async function endRun(
  db: AdminClient,
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  await db
    .from("flow_runs")
    .update({
      status,
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq("id", runId);
}

/** Quanto tempo um nó `wait` dorme, com piso de um segundo. */
function waitMs(cfg: WaitNodeConfig): number {
  const unitMs =
    cfg.unit === "days" ? 86_400_000 : cfg.unit === "hours" ? 3_600_000 : 60_000;
  const amount = Number.isFinite(cfg.amount) ? cfg.amount : 1;
  return Math.max(1_000, amount * unitMs);
}

/**
 * Chama a URL configurada. Devolve `true` quando falhou.
 *
 * A guarda de SSRF é a mesma da automação e da entrega de webhooks: a
 * URL e os cabeçalhos são escritos por quem configura, e quem faz a
 * requisição é o servidor — sem isto, um fluxo alcança qualquer coisa
 * dentro da rede. `redirect: "manual"` fecha o outro lado da mesma
 * porta: uma URL pública que responde 302 para um endereço interno
 * derrotaria a checagem.
 */
async function callWebhook(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  cfg: SendWebhookNodeConfig,
): Promise<boolean> {
  try {
    if (!cfg.url || !(await isDeliverableUrl(cfg.url))) {
      await logEvent(db, run.id, "error", node.node_key, {
        reason: "webhook_destination_not_allowed",
      });
      return true;
    }
    const body = cfg.body_template
      ? interpolateVars(cfg.body_template, run.vars)
      : JSON.stringify(run.vars);
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.headers ?? {}) },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: "send_webhook",
      status: res.status,
    });
    return !res.ok;
  } catch (err) {
    await logEvent(db, run.id, "error", node.node_key, {
      reason: "webhook_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

// ============================================================
// Agendamento dentro do fluxo — fase 1, R-4.
//
// Toda a regra vem de `src/lib/actions/scheduling.ts`, a mesma que o
// agente de IA usa. O que existe aqui é a tradução para o vocabulário do
// fluxo: um resultado da ação vira uma ARESTA, e o cliente segue por ela
// sem nunca ler uma mensagem de erro nossa.
//
// A configuração da conta é carregada uma vez por percurso do laço, e só
// quando um nó de agendamento aparece: um fluxo que nunca agenda não
// paga uma consulta por isso.
// ============================================================

interface SchedulingCache {
  loaded: boolean;
  value: SchedulingContext | null;
}

async function schedulingFor(
  db: AdminClient,
  accountId: string,
  cache: SchedulingCache,
): Promise<SchedulingContext | null> {
  if (!cache.loaded) {
    cache.value = await resolveSchedulingContext(db, accountId);
    cache.loaded = true;
  }
  return cache.value;
}

/**
 * Consulta os horários e oferece como lista.
 *
 * Três saídas, e a diferença entre duas delas é a razão de o nó existir:
 * "não há horário" manda o cliente por um caminho ("me avisa quando
 * abrir vaga"), "não consegui ler a agenda" manda por outro. Tratar as
 * duas como a mesma coisa faz o fluxo dizer que a agenda está cheia
 * quando na verdade o Google caiu.
 */
async function offerSlots(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  scheduling: SchedulingContext | null,
): Promise<{ kind: "suspended" } | { kind: "advance"; to: string }> {
  const cfg = node.config as unknown as OfferSlotsNodeConfig;

  if (!scheduling) {
    await logEvent(db, run.id, "error", node.node_key, {
      reason: "scheduling_not_configured",
    });
    return { kind: "advance", to: cfg.on_error_next };
  }

  const { settings, connection } = scheduling;
  const now = new Date();
  const days = cfg.lookahead_days ?? settings.lookaheadDays ?? 7;
  const result = await listAvailability({
    db,
    accountId: run.account_id,
    settings,
    connection,
    from: now,
    to: new Date(now.getTime() + days * 86_400_000),
    now,
  });

  if (!result.ok) {
    await logEvent(db, run.id, "error", node.node_key, {
      reason: result.reason,
      detail: result.message,
    });
    return { kind: "advance", to: cfg.on_error_next };
  }

  // Meta aceita no máximo 10 linhas numa lista; o padrão de 5 é o que
  // cabe numa tela sem virar formulário.
  const max = Math.min(Math.max(cfg.max_options ?? 5, 1), 10);
  const slots = result.data.slice(0, max);
  if (slots.length === 0) {
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: "offer_slots",
      offered: 0,
    });
    return { kind: "advance", to: cfg.no_slots_next };
  }

  // Guardar ANTES de mandar. Se a Meta falhar depois disto sobra uma
  // oferta registrada que ninguém viu, o que é inofensivo; na ordem
  // inversa sobraria uma lista na mão do cliente cujos índices não
  // apontam para nada.
  const offered = slots.map((slot) => ({
    starts_at: slot.startsAt.toISOString(),
    ends_at: slot.endsAt.toISOString(),
  }));
  const newVars = { ...run.vars, _offered_slots: offered };
  const { error: varsErr } = await db
    .from("flow_runs")
    .update({ vars: newVars })
    .eq("id", run.id);
  if (varsErr) {
    await logEvent(db, run.id, "error", node.node_key, {
      reason: "offer_slots_vars_write_failed",
      detail: varsErr.message,
    });
    return { kind: "advance", to: cfg.on_error_next };
  }
  run.vars = newVars;

  const { whatsapp_message_id } = await engineSendInteractiveList({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: interpolateVars(cfg.text, run.vars),
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: [
      {
        rows: slots.map((slot, index) => ({
          id: slotReplyId(index),
          title: slotOptionTitle(slot, settings.timezone),
          description: slotOptionDescription(slot, settings.timezone),
        })),
      },
    ],
  });

  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "offer_slots",
    offered: slots.length,
    whatsapp_message_id,
  });

  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);

  return { kind: "suspended" };
}

/**
 * Qual aresta uma recusa da ação toma.
 *
 * `slot_unavailable` é a única que tem caminho próprio, e é a que
 * acontece de verdade: entre oferecer e confirmar, o cliente demora, e o
 * horário vai embora. Tudo o mais — agenda ilegível, escrita falhada,
 * gravado sem sincronizar — é `on_error_next`, porque para o cliente
 * são a mesma coisa: não deu, e continuar como se tivesse dado é o
 * único desfecho de fato ruim.
 */
function schedulingEdgeFor(
  failure: SchedulingFailure,
  cfg: {
    on_unavailable_next?: string;
    on_no_appointment_next?: string;
    on_error_next: string;
  },
): string {
  if (failure.reason === "slot_unavailable" && cfg.on_unavailable_next) {
    return cfg.on_unavailable_next;
  }
  if (failure.reason === "no_appointment" && cfg.on_no_appointment_next) {
    return cfg.on_no_appointment_next;
  }
  return cfg.on_error_next;
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

async function advanceFromNodeKey(
  db: AdminClient,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  let currentKey: string | null = startNodeKey;
  // Configuração de agendamento, carregada sob demanda e no máximo uma
  // vez por percurso — um fluxo que nunca agenda não paga por ela.
  const scheduling: SchedulingCache = { loaded: false, value: null };
  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(db, run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(db, run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: FlowNodeRow | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(db, run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(db, run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === "start") {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_message",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_media") {
      const cfg = node.config as unknown as SendMediaNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendMedia({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          kind: cfg.media_type,
          link: cfg.media_url,
          caption: cfg.caption
            ? interpolateVars(cfg.caption, run.vars)
            : undefined,
          filename: cfg.filename,
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_media",
          media_type: cfg.media_type,
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_media_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_media_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "collect_input",
          whatsapp_message_id,
        });
        const { data: msg } = await db
          .from("messages")
          .select("id")
          .eq("message_id", whatsapp_message_id)
          .maybeSingle();
        await db
          .from("flow_runs")
          .update({
            last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
          })
          .eq("id", run.id);
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "collect_input_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "collect_input_prompt_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: "true" | "false";
      try {
        branch = (await evaluateConditionNode(db, run, cfg))
          ? "true"
          : "false";
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "condition_evaluation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "condition_evaluation_failed");
        return { outcome: "completed" };
      }
      currentKey =
        branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(db, run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      try {
        if (cfg.mode === "add") {
          await addContactTagAndDispatch({
            db,
            accountId: run.account_id,
            contactId: run.contact_id!,
            tagId: cfg.tag_id,
            context: {
              conversation_id: run.conversation_id ?? undefined,
              vars: run.vars,
            },
          });
        } else {
          await removeContactTag(db, {
            accountId: run.account_id,
            contactId: run.contact_id!,
            tagId: cfg.tag_id,
          });
        }
      } catch (err) {
        // Non-fatal — log + advance. A tag-write failure shouldn't
        // strand the customer mid-flow.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "set_tag_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_template") {
      const cfg = node.config as unknown as SendTemplateNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendTemplate({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          templateName: cfg.template_name,
          language: cfg.language,
          params: templateParams(cfg.variables, (v) =>
            interpolateVars(v, run.vars),
          ),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_template",
          template_name: cfg.template_name,
          whatsapp_message_id,
        });
      } catch (err) {
        // Falha de template é fatal para o run, ao contrário de uma
        // etiqueta que não gravou: o template É a mensagem, e seguir
        // adiante deixaria o cliente esperando um texto que não chegou.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_template_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_template_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "update_contact_field") {
      const cfg = node.config as unknown as UpdateContactFieldNodeConfig;
      const result = await updateContactField({
        db,
        accountId: run.account_id,
        contactId: run.contact_id!,
        field: cfg.field,
        value: interpolateVars(cfg.value, run.vars),
      });
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "update_contact_field",
        ok: result.ok,
        detail: result.message,
      });
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "create_deal") {
      const cfg = node.config as unknown as CreateDealNodeConfig;
      const result = await createDeal({
        db,
        accountId: run.account_id,
        userId: run.user_id,
        pipelineId: cfg.pipeline_id,
        stageId: cfg.stage_id,
        contactId: run.contact_id,
        title: interpolateVars(cfg.title, run.vars),
        value: cfg.value,
      });
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "create_deal",
        ok: result.ok,
        detail: result.message,
      });
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "assign_conversation") {
      const cfg = node.config as unknown as AssignConversationNodeConfig;
      const result = await assignConversation({
        db,
        accountId: run.account_id,
        contactId: run.contact_id!,
        mode: cfg.mode,
        agentId: cfg.agent_id,
      });
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "assign_conversation",
        ok: result.ok,
        detail: result.message,
      });
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "close_conversation") {
      const cfg = node.config as unknown as CloseConversationNodeConfig;
      const result = await closeConversation({
        db,
        accountId: run.account_id,
        contactId: run.contact_id!,
      });
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "close_conversation",
        ok: result.ok,
        detail: result.message,
      });
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "route_to_queue") {
      const cfg = node.config as unknown as RouteToQueueNodeConfig;
      const queue = await loadQueue(db, run.account_id, cfg.queue_id);
      if (!queue) {
        // Fila apagada, desativada, ou trocada para atendimento por
        // robô. Encerra como transferência mesmo assim: a decisão de
        // parar de falar continua valendo, e o run não pode ficar preso.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "queue_not_available",
          queue_id: cfg.queue_id,
        });
        await endRun(db, run.id, "handed_off", "queue_not_available");
        return { outcome: "handed_off" };
      }
      const result = await routeConversationToQueue({
        db,
        accountId: run.account_id,
        conversationId: run.conversation_id!,
        queue,
        summary: cfg.reason
          ? interpolateVars(cfg.reason, run.vars)
          : `🤖 ${queue.name}`,
      });
      await logEvent(db, run.id, "handoff", node.node_key, {
        node_type: "route_to_queue",
        queue_id: queue.id,
        ok: result.ok,
        assigned_to: result.assignedTo ?? null,
      });
      await endRun(db, run.id, "handed_off", "routed_to_queue");
      return { outcome: "handed_off" };
    }
    if (node.node_type === "wait") {
      const cfg = node.config as unknown as WaitNodeConfig;
      const resumeAt = new Date(Date.now() + waitMs(cfg));
      // Grava o ponteiro e a hora de voltar numa escrita só. O UPDATE
      // otimista é o mesmo dos nós que esperam o cliente: se outro
      // webhook já moveu o run, esta escrita não pega e nós saímos.
      const { data: parked } = await db
        .from("flow_runs")
        .update({
          current_node_key: node.node_key,
          resume_at: resumeAt.toISOString(),
          last_advanced_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("status", "active")
        .select("id");
      if (!Array.isArray(parked) || parked.length === 0) {
        return { outcome: "advanced" };
      }
      run.current_node_key = node.node_key;
      run.resume_at = resumeAt.toISOString();
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "wait",
        resume_at: resumeAt.toISOString(),
      });
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_webhook") {
      const cfg = node.config as unknown as SendWebhookNodeConfig;
      const failed = await callWebhook(db, run, node, cfg);
      currentKey = failed ? cfg.on_error_next : cfg.next_node_key;
      continue;
    }
    if (node.node_type === "offer_slots") {
      const outcome = await offerSlots(
        db,
        run,
        node,
        await schedulingFor(db, run.account_id, scheduling),
      );
      if (outcome.kind === "advance") {
        currentKey = outcome.to;
        continue;
      }
      // Suspenso à espera da escolha. Mesmo protocolo dos outros nós que
      // esperam: grava o ponteiro por UPDATE otimista e sai.
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) return { outcome: "advanced" };
      run.current_node_key = node.node_key;
      return { outcome: "advanced" };
    }
    if (node.node_type === "book_appointment") {
      const cfg = node.config as unknown as BookAppointmentNodeConfig;
      const ctx = await schedulingFor(db, run.account_id, scheduling);
      const chosen = readOfferedSlots(run.vars)[
        typeof run.vars._chosen_slot === "number" ? run.vars._chosen_slot : -1
      ];
      if (!ctx || !chosen) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: ctx ? "no_slot_chosen" : "scheduling_not_configured",
        });
        currentKey = cfg.on_error_next;
        continue;
      }
      const result = await bookForContact({
        db,
        accountId: run.account_id,
        contactId: run.contact_id,
        conversationId: run.conversation_id,
        settings: ctx.settings,
        connection: ctx.connection,
        startsAt: chosen.starts_at,
        endsAt: chosen.ends_at,
        title: cfg.title ? interpolateVars(cfg.title, run.vars) : null,
        createdVia: "native",
      });
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "book_appointment",
        booked: result.ok,
        reason: result.ok ? null : result.reason,
      });
      currentKey = result.ok
        ? cfg.next_node_key
        : schedulingEdgeFor(result, cfg);
      continue;
    }
    if (node.node_type === "reschedule_appointment") {
      const cfg = node.config as unknown as RescheduleAppointmentNodeConfig;
      const ctx = await schedulingFor(db, run.account_id, scheduling);
      const chosen = readOfferedSlots(run.vars)[
        typeof run.vars._chosen_slot === "number" ? run.vars._chosen_slot : -1
      ];
      if (!ctx || !chosen) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: ctx ? "no_slot_chosen" : "scheduling_not_configured",
        });
        currentKey = cfg.on_error_next;
        continue;
      }
      const result = await rescheduleForContact({
        db,
        accountId: run.account_id,
        contactId: run.contact_id,
        settings: ctx.settings,
        connection: ctx.connection,
        startsAt: chosen.starts_at,
        endsAt: chosen.ends_at,
      });
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "reschedule_appointment",
        moved: result.ok,
        reason: result.ok ? null : result.reason,
      });
      currentKey = result.ok
        ? cfg.next_node_key
        : schedulingEdgeFor(result, cfg);
      continue;
    }
    if (node.node_type === "cancel_appointment") {
      const cfg = node.config as unknown as CancelAppointmentNodeConfig;
      const ctx = await schedulingFor(db, run.account_id, scheduling);
      if (!ctx) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "scheduling_not_configured",
        });
        currentKey = cfg.on_error_next;
        continue;
      }
      const result = await cancelForContact({
        db,
        accountId: run.account_id,
        contactId: run.contact_id,
        settings: ctx.settings,
        connection: ctx.connection,
        reason: cfg.reason ? interpolateVars(cfg.reason, run.vars) : null,
      });
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "cancel_appointment",
        cancelled: result.ok,
        reason: result.ok ? null : result.reason,
      });
      currentKey = result.ok
        ? cfg.next_node_key
        : schedulingEdgeFor(result, cfg);
      continue;
    }
    if (node.node_type === "send_buttons") {
      await sendButtonsAndSuspend(db, run, node);
      // Persist the new current_node_key via optimistic UPDATE.
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_list") {
      await sendListAndSuspend(db, run, node);
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "handoff") {
      await executeHandoff(db, run, node);
      return { outcome: "handed_off" };
    }
    if (node.node_type === "end") {
      await logEvent(db, run.id, "completed", node.node_key);
      await endRun(db, run.id, "completed", "end_node");
      return { outcome: "completed" };
    }
    // Unknown node type — shouldn't happen given the CHECK constraint.
    await logEvent(db, run.id, "error", node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(db, run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  // Safety break — log + fail.
  await logEvent(db, run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(db, run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

/**
 * Optimistic UPDATE — only advance current_node_key when it matches
 * the value we read at the top of dispatch. If another webhook beat
 * us, the row's pointer has already moved and our UPDATE returns
 * zero rows; we treat that as a no-op and let the other run continue.
 */
async function advanceCurrentNodeKey(
  db: AdminClient,
  runId: string,
  expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  // PostgREST: when expectedOldKey is null we can't `.eq` (would match
  // any row); use `.is('current_node_key', null)` instead.
  let q = db
    .from("flow_runs")
    .update({
      current_node_key: newKey,
      last_advanced_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "active");
  if (expectedOldKey === null) {
    q = q.is("current_node_key", null);
  } else {
    q = q.eq("current_node_key", expectedOldKey);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.error("[flows] advanceCurrentNodeKey error:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    const activeRun = await loadActiveRunForContact(
      db,
      input.accountId,
      input.contactId,
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        db,
        input.accountId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }
      // One SELECT for the whole flow's nodes — advance loop is now
      // in-memory. See loadAllNodes.
      const nodes = await loadAllNodes(db, activeRun.flow_id);
      return handleReplyForActiveRun(db, activeRun, input.message, nodes);
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      db,
      input.accountId,
      input.message,
      input.isFirstInboundMessage,
    );
    if (!flow || !flow.entry_node_id) {
      return { consumed: false, outcome: "no_match" };
    }
    const nodes = await loadAllNodes(db, flow.id);
    return startNewRun(db, flow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

async function handleReplyForActiveRun(
  db: AdminClient,
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(db, run.id, "reply_received", run.current_node_key, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

  if (!run.current_node_key) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(db, run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.current_node_key) ?? null;
  if (!currentNode) {
    await endRun(db, run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  // Parado num `wait`: o fluxo não está escutando, e a mensagem não é
  // resposta a nada. Devolver `consumed: false` deixa o agente e as
  // automações atenderem — o contrário faria a política de fallback
  // reprompt ou transferir por causa de uma frase que não foi dirigida
  // ao fluxo.
  if (isSleeping(currentNode.node_type)) {
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  if (
    message.kind === "interactive_reply" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchReplyId(currentNode, message.reply_id);
  } else if (
    message.kind === "interactive_reply" &&
    currentNode.node_type === "offer_slots"
  ) {
    // A escolha volta como índice, e o horário sai de
    // `vars._offered_slots` — o registro do que REALMENTE foi oferecido.
    // Um índice fora da oferta cai no fallback como qualquer resposta
    // que não casa, em vez de virar um agendamento inventado.
    const cfg = currentNode.config as unknown as OfferSlotsNodeConfig;
    const index = parseSlotReplyId(message.reply_id);
    const offered = readOfferedSlots(run.vars);
    if (index !== null && index < offered.length) {
      const newVars = { ...run.vars, _chosen_slot: index };
      const { error: chooseErr } = await db
        .from("flow_runs")
        .update({ vars: newVars, reprompt_count: 0 })
        .eq("id", run.id);
      if (!chooseErr) {
        run.vars = newVars;
        run.reprompt_count = 0;
        await logEvent(db, run.id, "node_entered", currentNode.node_key, {
          chosen_slot: index,
          starts_at: offered[index].starts_at,
        });
        matched = cfg.next_node_key;
      }
    }
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (captured.length > 0 && cfg.var_key) {
      // Persist captured value + reset reprompt count atomically.
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      const { error: capErr } = await db
        .from("flow_runs")
        .update({
          vars: newVars,
          reprompt_count: 0,
        })
        .eq("id", run.id);
      if (!capErr) {
        // Mirror the UPDATE in-memory so downstream interpolation in
        // the advance loop sees the captured var without us having to
        // re-SELECT the whole row.
        run.vars = newVars;
        run.reprompt_count = 0;
        await logEvent(db, run.id, "node_entered", currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      }
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0. The previous re-read of
    // the whole row was needed only because we weren't mirroring the
    // capture UPDATE into the in-memory `run`; now that we do, the
    // local copy is the source of truth.
    if (run.reprompt_count !== 0) {
      const { error } = await db
        .from("flow_runs")
        .update({ reprompt_count: 0 })
        .eq("id", run.id);
      if (!error) run.reprompt_count = 0;
    }
    const outcome = await advanceFromNodeKey(db, run, matched, nodes);
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const policy = resolveFallbackPolicy(
    (await loadFlow(db, run.flow_id))?.fallback_policy,
  );
  const newReprompts = run.reprompt_count + 1;
  await db
    .from("flow_runs")
    .update({ reprompt_count: newReprompts })
    .eq("id", run.id);

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(db, run.id, "fallback_fired", run.current_node_key, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "reprompt") {
    // Re-send the same prompt. Same node, no current_node_key change.
    if (currentNode.node_type === "send_buttons") {
      await sendButtonsAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === "send_list") {
      await sendListAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(db, run.id, "error", currentNode.node_key, {
          reason: "reprompt_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversation_id) {
      await db
        .from("conversations")
        .update({
          status: "pending",
          // Mesmo motivo do `executeHandoff` acima: sem isto o fluxo
          // desiste e a IA assume, o que é o oposto do que "esgotou o
          // fallback" significa.
          ai_autoreply_disabled: true,
          ai_handoff_summary: "🔀 O fluxo não entendeu as respostas.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.conversation_id);
    }
    await logEvent(db, run.id, "handoff", run.current_node_key, {
      reason: "fallback_exhausted",
    });
    await endRun(db, run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  await endRun(db, run.id, "completed", "fallback_exhausted_end");
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  db: AdminClient,
  flow: FlowRow,
  input: DispatchInboundInput,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  const started = await insertRunAndAdvance(db, flow, nodes, {
    contactId: input.contactId,
    conversationId: input.conversationId,
    startedPayload: {
      flow_id: flow.id,
      trigger_type: flow.trigger_type,
      meta_message_id: input.message.meta_message_id,
      started_by: "inbound",
    },
  });
  if (!started.ok) {
    return started.reason === "duplicate_run"
      ? { consumed: true, outcome: "duplicate_inbound_ignored" }
      : { consumed: false, outcome: "no_match" };
  }
  return {
    consumed: true,
    flow_run_id: started.run.id,
    outcome: started.outcome === "advanced" ? "started" : started.outcome,
  };
}

/**
 * Create the run row and walk it forward. The one place a run is born,
 * shared by the inbound path (`startNewRun`) and the bridge
 * (`startFlowRun`) so the two can never drift on what a fresh run looks
 * like — same tenancy fields, same counter bump, same first event.
 *
 * `vars` seeds the run: the bridge uses it to carry the chain depth and
 * whatever context the caller wants interpolated into the nodes.
 */
async function insertRunAndAdvance(
  db: AdminClient,
  flow: FlowRow,
  nodes: Map<string, FlowNodeRow>,
  opts: {
    contactId: string;
    conversationId: string | null;
    startedPayload: Record<string, unknown>;
    vars?: Record<string, unknown>;
  },
): Promise<
  | {
      ok: true;
      run: FlowRunRow;
      outcome: "advanced" | "completed" | "handed_off";
    }
  | { ok: false; reason: "duplicate_run" | "insert_failed" }
> {
  // INSERT — partial unique index `idx_one_active_run_per_contact`
  // catches concurrent inserts with 23505. We report it as a duplicate
  // and let the caller decide what that means: for the webhook it is
  // "the parallel delivery is handling it", for the bridge it is a
  // refusal the operator needs to see.
  const { data: inserted, error: insErr } = await db
    .from("flow_runs")
    .insert({
      flow_id: flow.id,
      // Tenancy: NOT NULL post-017. The partial unique index
      // `idx_one_active_run_per_contact` is over (account_id,
      // contact_id) WHERE status='active', so two accounts sharing
      // a contact phone number each run their own flows independently.
      account_id: flow.account_id,
      // Audit: preserves the flow's author on the run row for log
      // attribution.
      user_id: flow.user_id,
      contact_id: opts.contactId,
      conversation_id: opts.conversationId,
      status: "active",
      current_node_key: flow.entry_node_id,
      ...(opts.vars ? { vars: opts.vars } : {}),
    })
    .select("*")
    .maybeSingle();
  if (insErr) {
    // 23505 = unique_violation → this contact already has an active run.
    const msg = insErr.message ?? "";
    if (msg.includes("23505") || msg.includes("duplicate key")) {
      return { ok: false, reason: "duplicate_run" };
    }
    console.error("[flows] insertRunAndAdvance insert error:", insErr.message);
    return { ok: false, reason: "insert_failed" };
  }
  const run = inserted as FlowRunRow;
  await logEvent(db, run.id, "started", flow.entry_node_id, opts.startedPayload);
  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  //
  // Atomic RPC (migration 012) rather than read-modify-write: two
  // concurrent webhooks starting runs for different contacts on the
  // same flow would otherwise both read N and both write N+1, losing
  // a count. Mirrors the automations engine's use of
  // `increment_automation_execution_count` (migration 007).
  const { error: incErr } = await db.rpc("increment_flow_execution_count", {
    p_flow_id: flow.id,
  });
  if (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error("[flows] execution_count rpc error:", incErr.message);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(db, run, flow.entry_node_id!, nodes);
  return { ok: true, run, outcome: outcome.outcome };
}

// ============================================================
// Second public entry point — the bridge.
//
// `dispatchInboundToFlows` starts a run because the CUSTOMER said
// something. This starts one because something else in the system
// decided to: an automation that just sent a cobrança template, the AI
// agent handing a menu to the flow, an operator on the inbox.
//
// Why this belongs to the flow engine and not to the callers: every
// rule about what a run IS lives here — one active run per contact, the
// entry node, the counter, the first event. A caller that inserted its
// own row would be a second definition of "a run", and the two would
// drift. The callers stay adapters: they translate their own shape into
// `StartFlowRunInput` and translate the result back into their own
// vocabulary.
//
// It never throws. Both adapters are fire-and-forget paths where an
// exception would take down an automation run or an agent turn, so
// every failure comes back as a NAMED refusal instead. Silence is not
// an option either: "the flow did not start and nobody said why" is the
// bug this whole shape exists to prevent.
// ============================================================

/** Why a start was refused. Every one of these is reportable to a human. */
export type StartFlowRefusal =
  /** No such flow in this account. Also covers a flow in another
   *  account: the caller must not learn that the id exists. */
  | "flow_not_found"
  | "flow_not_active"
  | "flow_has_no_entry"
  | "contact_not_in_account"
  /** The contact is mid-flow. The existing run's id comes back with it. */
  | "active_run_exists"
  /** Nothing to talk on — the contact has never had a conversation. */
  | "no_conversation"
  | "max_chain_depth"
  | "error";

export interface StartFlowRunInput {
  accountId: string;
  contactId: string;
  flowId: string;
  /** Who asked. Recorded on the run's `started` event, which is the
   *  only place anyone can later find out where a run came from. */
  startedBy: "automation" | "agent" | "human" | "api";
  /** The thread to talk on. Null resolves to the contact's most recent
   *  conversation. */
  conversationId?: string | null;
  /** Seeded into `flow_runs.vars`, so the flow can interpolate what the
   *  caller knew — the invoice amount, the due date. */
  vars?: Record<string, unknown>;
  /** Chain depth carried across the bridge. See `./chain.ts`. */
  chainDepth?: number;
}

export type StartFlowRunResult =
  | {
      started: true;
      flowRunId: string;
      outcome: "advanced" | "completed" | "handed_off";
    }
  | {
      started: false;
      reason: StartFlowRefusal;
      /** Present for `active_run_exists`. */
      flowRunId?: string;
      detail?: string;
    };

/** One sentence per refusal, so the automation log, the agent's tool
 *  result and the inbox all say the same thing. */
export function describeStartFlowRefusal(
  reason: StartFlowRefusal,
  flowName?: string,
): string {
  const which = flowName ? `"${flowName}"` : "that flow";
  switch (reason) {
    case "flow_not_found":
      return `${which} does not exist in this account.`;
    case "flow_not_active":
      return `${which} is not active, so it cannot be started.`;
    case "flow_has_no_entry":
      return `${which} has no entry node — open it in the builder and connect the start.`;
    case "contact_not_in_account":
      return "That contact does not belong to this account.";
    case "active_run_exists":
      return "The contact is already in a flow; only one runs at a time.";
    case "no_conversation":
      return "The contact has no conversation yet, so there is nowhere to send the flow.";
    case "max_chain_depth":
      return "Too many flows started one another in a row; stopped to avoid a loop.";
    case "error":
      return "The flow could not be started.";
  }
}

/**
 * Find the thread to talk on. Newest first rather than `.maybeSingle()`:
 * a contact with two conversation rows is a data state we have seen, and
 * it must not turn the bridge into an error — the newest thread is the
 * one the customer is actually looking at.
 */
async function resolveConversationForContact(
  db: AdminClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) {
    console.error("[flows] resolveConversationForContact error:", error.message);
    return null;
  }
  const rows = (data as { id: string }[] | null) ?? [];
  return rows[0]?.id ?? null;
}

export async function startFlowRun(
  input: StartFlowRunInput,
): Promise<StartFlowRunResult> {
  const db = supabaseAdmin();
  try {
    // Depth first: it is the cheapest check and the one whose whole
    // point is to run before anything costs anything.
    const depth = input.chainDepth ?? 0;
    if (depth >= MAX_FLOW_CHAIN_DEPTH) {
      console.warn("[flows] flow chain depth limit reached", {
        accountId: input.accountId,
        contactId: input.contactId,
        flowId: input.flowId,
        depth,
      });
      return { started: false, reason: "max_chain_depth" };
    }

    const flow = await loadFlow(db, input.flowId);
    // Account mismatch is reported as "not found" on purpose: this runs
    // on the service-role client, which bypasses RLS, so a caller
    // probing ids must not be able to tell a foreign flow from a
    // missing one.
    if (!flow || flow.account_id !== input.accountId) {
      return { started: false, reason: "flow_not_found" };
    }
    if (flow.status !== "active") {
      return { started: false, reason: "flow_not_active" };
    }
    if (!flow.entry_node_id) {
      return { started: false, reason: "flow_has_no_entry" };
    }

    // Same discipline as the automations engine: the service-role
    // client bypasses RLS, so tenancy is checked here or nowhere.
    const { data: contact, error: contactErr } = await db
      .from("contacts")
      .select("id")
      .eq("id", input.contactId)
      .eq("account_id", input.accountId)
      .maybeSingle();
    if (contactErr) {
      console.error("[flows] contact ownership check failed:", contactErr.message);
      return { started: false, reason: "error", detail: contactErr.message };
    }
    if (!contact) {
      return { started: false, reason: "contact_not_in_account" };
    }

    // Checked before the INSERT so the refusal can name the run the
    // contact is actually in. The partial unique index is still the
    // authority — see the duplicate_run branch below for the race.
    const active = await loadActiveRunForContact(
      db,
      input.accountId,
      input.contactId,
    );
    if (active) {
      return {
        started: false,
        reason: "active_run_exists",
        flowRunId: active.id,
      };
    }

    const conversationId =
      input.conversationId ??
      (await resolveConversationForContact(
        db,
        input.accountId,
        input.contactId,
      ));
    if (!conversationId) {
      return { started: false, reason: "no_conversation" };
    }

    const nodes = await loadAllNodes(db, flow.id);
    const started = await insertRunAndAdvance(db, flow, nodes, {
      contactId: input.contactId,
      conversationId,
      startedPayload: {
        flow_id: flow.id,
        trigger_type: flow.trigger_type,
        started_by: input.startedBy,
      },
      vars: { ...(input.vars ?? {}), _flow_chain_depth: depth + 1 },
    });

    if (!started.ok) {
      if (started.reason === "duplicate_run") {
        // Lost the race with a concurrent start. Same answer as the
        // check above, minus the run id we no longer have cheaply.
        return { started: false, reason: "active_run_exists" };
      }
      return { started: false, reason: "error" };
    }

    return {
      started: true,
      flowRunId: started.run.id,
      outcome: started.outcome,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[flows] startFlowRun threw:", detail);
    return { started: false, reason: "error", detail };
  }
}

// ============================================================
// Terceira entrada pública — o relógio.
//
// `dispatchInboundToFlows` acorda um run porque o cliente falou;
// `startFlowRun` cria um porque o sistema decidiu. Esta acorda um que
// marcou hora consigo mesmo, e só o cron a chama.
// ============================================================

export interface DueRun {
  id: string
  flow_id: string
  current_node_key: string | null
}

/**
 * Runs cuja hora de voltar já passou.
 *
 * Limite explícito: uma varredura que tenta acordar dez mil runs numa
 * requisição estoura antes de acordar o primeiro. O cron roda de novo
 * em minutos, então uma fila que não coube nesta rodada não se perde —
 * só espera a próxima.
 */
export async function loadDueRuns(limit = 200): Promise<DueRun[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("flow_runs")
    .select("id, flow_id, current_node_key")
    .eq("status", "active")
    .not("resume_at", "is", null)
    .lte("resume_at", new Date().toISOString())
    .order("resume_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[flows] loadDueRuns error:", error.message);
    return [];
  }
  return (data as DueRun[] | null) ?? [];
}

export type ResumeOutcome =
  | "resumed"
  | "already_taken"
  | "not_waiting"
  | "error";

/**
 * Retoma um run parado num `wait`.
 *
 * A limpeza de `resume_at` é a TRAVA: é feita com a precondição de que
 * ela ainda esteja preenchida, então duas execuções simultâneas do cron
 * não avançam o mesmo run duas vezes. Quem perder a corrida recebe zero
 * linhas e sai — que é o mesmo protocolo do `advanceCurrentNodeKey`.
 */
export async function resumeWaitingRun(runId: string): Promise<ResumeOutcome> {
  const db = supabaseAdmin();
  try {
    const { data: claimed, error: claimErr } = await db
      .from("flow_runs")
      .update({ resume_at: null, last_advanced_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "active")
      .not("resume_at", "is", null)
      .select("*");
    if (claimErr) {
      console.error("[flows] resumeWaitingRun claim error:", claimErr.message);
      return "error";
    }
    const rows = (claimed as FlowRunRow[] | null) ?? [];
    if (rows.length === 0) return "already_taken";
    const run = rows[0];

    const nodes = await loadAllNodes(db, run.flow_id);
    const node = run.current_node_key ? nodes.get(run.current_node_key) : null;
    if (!node || node.node_type !== "wait") {
      // O run mudou de nó entre a leitura e agora, ou o fluxo foi
      // reescrito e o nó sumiu. Não é erro: o `resume_at` já foi
      // limpo, e o run segue a vida por onde estiver.
      return "not_waiting";
    }

    const cfg = node.config as unknown as WaitNodeConfig;
    await advanceFromNodeKey(db, run, cfg.next_node_key, nodes);
    return "resumed";
  } catch (err) {
    console.error(
      "[flows] resumeWaitingRun threw:",
      err instanceof Error ? err.message : err,
    );
    return "error";
  }
}
