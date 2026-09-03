/**
 * Type definitions for the Flows runtime.
 *
 * These mirror the Supabase schema added in migration 010 (`flows`,
 * `flow_nodes`, `flow_runs`, `flow_run_events`) plus the discriminated
 * unions the engine uses to typecheck node configs.
 *
 * Schema invariants enforced here that the DB CHECK constraints don't:
 *   - Each node_type maps to one config shape — adding a new node_type
 *     requires adding the matching config interface AND extending
 *     `FlowNodeConfig` so the engine's exhaustiveness checks light up.
 *   - Edges live INSIDE the config (each button row / list row carries
 *     `next_node_key`). The DB schema doesn't model this — the
 *     validator (PR #3) catches missing or orphan edges at save time.
 *
 * `next_node_key` is the stable string id stored in `flow_nodes.node_key`,
 * not a UUID, so flows can be cloned / templated without rewriting
 * references in JSONB.
 */

// ============================================================
// Node configs (discriminated union by node_type)
// ============================================================

export interface StartNodeConfig {
  /** Stable node_key of the first real node to advance to. */
  next_node_key: string;
}

export interface SendMessageNodeConfig {
  /** Plain text sent to the customer; can interpolate {{vars.X}}. */
  text: string;
  /** Auto-advance target after the message lands at Meta. */
  next_node_key: string;
}

export interface SendButtonsNodeConfig {
  text: string;
  /** Optional header / footer lines around the buttons. */
  header_text?: string;
  footer_text?: string;
  /** 1-3 buttons; Meta cap enforced in meta-api validation. */
  buttons: Array<{
    /** Stable id sent back by Meta when this button is tapped. */
    reply_id: string;
    /** Visible label (≤ 20 chars per Meta). */
    title: string;
    /** node_key the runner advances to when this button is tapped. */
    next_node_key: string;
  }>;
}

export interface SendListNodeConfig {
  text: string;
  /** Label of the tap-to-expand button on the message bubble. */
  button_label: string;
  header_text?: string;
  footer_text?: string;
  /** 1-10 rows TOTAL across sections; cap enforced in meta-api. */
  sections: Array<{
    title?: string;
    rows: Array<{
      reply_id: string;
      title: string;
      description?: string;
      next_node_key: string;
    }>;
  }>;
}

/**
 * Sends a single image / video / document via WhatsApp, then
 * auto-advances. The media file is uploaded to the `flow-media`
 * Supabase Storage bucket by the builder; `media_url` is the public
 * URL Meta fetches at send time.
 *
 * Why one node with a `media_type` discriminator (rather than three
 * separate node types): Meta's send-side payload differs only in the
 * top-level key (`image` / `video` / `document`) and the
 * filename-on-document quirk. Modeling three node types would triple
 * the builder forms, engine cases, and add-menu entries for no
 * meaningful behavioural difference.
 */
export interface SendMediaNodeConfig {
  media_type: "image" | "video" | "document";
  /** Public URL Meta will fetch. Uploaded via the builder's file picker. */
  media_url: string;
  /** Optional caption shown under the media (Meta caps at 1024 chars). */
  caption?: string;
  /**
   * Filename shown in the recipient's chat. Documents only — Meta
   * ignores it for image/video. Defaults to the file's original name
   * at upload time; the user can edit it.
   */
  filename?: string;
  /** Auto-advance target after the send lands at Meta. */
  next_node_key: string;
}

export interface HandoffNodeConfig {
  /** Optional internal note written to flow_run_events.payload.note. */
  note?: string;
  /**
   * Optional agent user_id to assign on the conversation when this
   * node fires. Leave unset to flip the status without assignment.
   */
  assign_to?: string;
}

/**
 * Captures the customer's next free-text reply into
 * `flow_runs.vars[var_key]`, then advances.
 *
 * v1.5 ships without runtime validation (`validation` is accepted on
 * the config for forward compat but ignored by the runner); the
 * builder still surfaces the field so users can author flows that
 * v2 will start enforcing.
 */
export interface CollectInputNodeConfig {
  /** Prompt text sent to the customer before they reply. */
  prompt_text: string;
  /**
   * Key under which to store the captured text in
   * `flow_runs.vars`. Stable identifier — used by downstream
   * `condition` nodes and `handoff` notes via interpolation.
   */
  var_key: string;
  /**
   * Reserved for v2. Accepted on the config but ignored by the v1.5
   * runner — captures any non-empty text.
   */
  validation?: "any" | "email" | "phone" | "regex";
  /** Used only when `validation === 'regex'`. */
  regex?: string;
  /** Node to advance to after capture. */
  next_node_key: string;
}

export type ConditionOperator =
  | "equals"
  | "contains"
  | "present"
  | "absent";

export type ConditionSubject = "var" | "tag" | "contact_field";

/**
 * Routes the run based on a predicate over the contact's tags,
 * profile fields, or stored vars. Always auto-advances — no Meta
 * call, no customer-side input.
 */
export interface ConditionNodeConfig {
  subject: ConditionSubject;
  /**
   * For `var`: the key in flow_runs.vars.
   * For `tag`: the tag UUID (matched against contact_tags).
   * For `contact_field`: one of 'name' | 'email' | 'phone' | 'company'.
   */
  subject_key: string;
  operator: ConditionOperator;
  /** Compared against `subject` for `equals`/`contains`. Ignored for `present`/`absent`. */
  value?: string;
  /** Node to advance to when the predicate evaluates true. */
  true_next: string;
  /** Node to advance to when it evaluates false. */
  false_next: string;
}

// ============================================================
// Agendamento no fluxo — fase 1, R-4.
//
// Existem porque o cliente que recusa o custo do modelo também precisa
// marcar horário. Toda a regra — expediente, antecedência, horizonte,
// colisão — vem de `src/lib/actions/scheduling.ts`, a mesma que o agente
// de IA usa; estes nós são o invólucro de menu por cima dela.
//
// Repare que os quatro têm arestas de erro SEPARADAS de "não deu certo".
// Uma agenda que não conseguimos ler não é uma agenda vazia: mandar o
// cliente pelo caminho de "não tenho horário" quando o Google caiu é
// perder a venda e mentir. Por isso `on_error_next` existe em todos.
// ============================================================

/**
 * Consulta os horários livres e oferece como lista, esperando a escolha.
 *
 * É o único nó cujas opções não estão na configuração: elas são
 * calculadas na hora e guardadas em `flow_runs.vars._offered_slots`, na
 * mesma ordem dos `reply_id`. O runner casa a resposta por índice.
 */
export interface OfferSlotsNodeConfig {
  /** Texto acima da lista. */
  text: string;
  /** Rótulo do botão que abre a lista. */
  button_label: string;
  header_text?: string;
  footer_text?: string;
  /** Quantos horários oferecer, no máximo. Meta limita a 10 linhas. */
  max_options?: number;
  /** Quantos dias à frente olhar. Sem isto, `lookahead_days` da conta. */
  lookahead_days?: number;
  /** O cliente escolheu um horário → aqui. */
  next_node_key: string;
  /** Não há horário livre no período. */
  no_slots_next: string;
  /** A agenda não pôde ser lida. NUNCA é o mesmo que "sem horário". */
  on_error_next: string;
}

/**
 * Marca o horário escolhido no nó `offer_slots` anterior.
 *
 * Separado dele de propósito: entre a oferta e a escolha o cliente leva
 * tempo, e o horário pode ter ido embora. Um nó só não teria onde
 * desviar quando isso acontece.
 */
export interface BookAppointmentNodeConfig {
  /** Descrição do compromisso; interpola `{{vars.X}}`. */
  title?: string;
  /** Marcado. */
  next_node_key: string;
  /** O horário caiu entre a oferta e a confirmação. */
  on_unavailable_next: string;
  /** Nenhum horário escolhido, agenda ilegível, ou a escrita falhou. */
  on_error_next: string;
}

export interface RescheduleAppointmentNodeConfig {
  next_node_key: string;
  on_unavailable_next: string;
  /** O cliente não tem agendamento para mover. */
  on_no_appointment_next: string;
  on_error_next: string;
}

export interface CancelAppointmentNodeConfig {
  /** Motivo registrado no agendamento; interpola `{{vars.X}}`. */
  reason?: string;
  next_node_key: string;
  /** O cliente não tem agendamento para cancelar. */
  on_no_appointment_next: string;
  on_error_next: string;
}

/**
 * Envia um template aprovado da Meta e avança.
 *
 * É o nó que tira o fluxo da dependência da janela de 24 horas: sem
 * ele, um fluxo só sabe REAGIR — fora da janela ele não fala. Com ele,
 * cada degrau de uma régua de cobrança é um fluxo, e a resposta do
 * cliente cai num menu.
 */
export interface SendTemplateNodeConfig {
  template_name: string;
  language?: string;
  /** Valores posicionais `{{1}}`, `{{2}}`, … Interpolam `{{vars.X}}`. */
  variables?: Record<string, string>;
  next_node_key: string;
}

export interface UpdateContactFieldNodeConfig {
  /** Coluna nativa (`name` | `email` | `company`) ou `custom:<id>`. */
  field: string;
  /** Interpola `{{vars.X}}`. */
  value: string;
  next_node_key: string;
}

export interface CreateDealNodeConfig {
  pipeline_id: string;
  stage_id: string;
  title: string;
  value?: number;
  next_node_key: string;
}

export interface AssignConversationNodeConfig {
  mode: "specific" | "round_robin";
  agent_id?: string;
  next_node_key: string;
}

export interface CloseConversationNodeConfig {
  next_node_key: string;
}

/**
 * Encaminha para uma fila humana e TERMINA o run.
 *
 * Terminal como o `handoff`, e pela mesma razão: a partir daqui a
 * conversa tem dono. Um fluxo que continuasse mandando mensagem por cima
 * de uma pessoa atendendo é o pior desfecho possível.
 */
export interface RouteToQueueNodeConfig {
  queue_id: string;
  /** A nota que quem pegar vai ler; interpola `{{vars.X}}`. */
  reason?: string;
}

export interface SetTagNodeConfig {
  mode: "add" | "remove";
  /** Tag UUID. The builder picks from the user's existing tags. */
  tag_id: string;
  next_node_key: string;
}

// Terminal nodes carry no config — they just stop the run.
export type EndNodeConfig = Record<string, never>;

/**
 * Total union — every concrete node_type the v1 engine understands.
 * Add new node types here and the engine's switch will flag missing
 * cases via TypeScript's exhaustiveness check.
 *
 * v1.5+ additions (collect_input, condition, set_tag, http_fetch) will
 * extend this union — out-of-scope for the v1 engine PR.
 */
export type FlowNodeConfig =
  | { node_type: "start"; config: StartNodeConfig }
  | { node_type: "send_message"; config: SendMessageNodeConfig }
  | { node_type: "send_buttons"; config: SendButtonsNodeConfig }
  | { node_type: "send_list"; config: SendListNodeConfig }
  | { node_type: "send_media"; config: SendMediaNodeConfig }
  | { node_type: "collect_input"; config: CollectInputNodeConfig }
  | { node_type: "condition"; config: ConditionNodeConfig }
  | { node_type: "set_tag"; config: SetTagNodeConfig }
  | { node_type: "send_template"; config: SendTemplateNodeConfig }
  | {
      node_type: "update_contact_field";
      config: UpdateContactFieldNodeConfig;
    }
  | { node_type: "create_deal"; config: CreateDealNodeConfig }
  | {
      node_type: "assign_conversation";
      config: AssignConversationNodeConfig;
    }
  | {
      node_type: "close_conversation";
      config: CloseConversationNodeConfig;
    }
  | { node_type: "route_to_queue"; config: RouteToQueueNodeConfig }
  | { node_type: "offer_slots"; config: OfferSlotsNodeConfig }
  | { node_type: "book_appointment"; config: BookAppointmentNodeConfig }
  | {
      node_type: "reschedule_appointment";
      config: RescheduleAppointmentNodeConfig;
    }
  | { node_type: "cancel_appointment"; config: CancelAppointmentNodeConfig }
  | { node_type: "handoff"; config: HandoffNodeConfig }
  | { node_type: "end"; config: EndNodeConfig };

export type FlowNodeType = FlowNodeConfig["node_type"];

// ============================================================
// Triggers (matches `flows.trigger_type` + `trigger_config`)
// ============================================================

export interface KeywordTriggerConfig {
  /** One or more keywords. Match is case-insensitive by default. */
  keywords: string[];
  match_type?: "exact" | "contains";
  case_sensitive?: boolean;
}

// No knobs in v1 — the trigger has a single semantic. Kept as a type
// alias (not an empty interface) for forward compat without tripping
// the no-empty-object-type lint rule.
export type FirstInboundTriggerConfig = Record<string, never>;

export type FlowTriggerConfig =
  | { trigger_type: "keyword"; config: KeywordTriggerConfig }
  | { trigger_type: "first_inbound_message"; config: FirstInboundTriggerConfig }
  | { trigger_type: "manual"; config: Record<string, never> };

// ============================================================
// DB-row shapes (read by the engine via supabaseAdmin)
// ============================================================

export interface FlowRow {
  id: string;
  /** Account tenancy (NOT NULL post-017). The engine looks up active
   *  flows for inbound dispatch using this field. */
  account_id: string;
  /** Author. Used as a default sender-of-record on engine sends and
   *  preserved on flow_runs for log/audit display. */
  user_id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | FirstInboundTriggerConfig | Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: FlowFallbackPolicy;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowNodeRow {
  id: string;
  flow_id: string;
  node_key: string;
  node_type: FlowNodeType;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
  created_at: string;
}

export interface FlowRunRow {
  id: string;
  flow_id: string;
  /** Tenancy. Matches flows.account_id; NOT NULL post-017. */
  account_id: string;
  /** Audit. Matches the parent flow.user_id. */
  user_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  status:
    | "active"
    | "completed"
    | "handed_off"
    | "timed_out"
    | "paused_by_agent"
    | "failed";
  current_node_key: string | null;
  last_prompt_message_id: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

// ============================================================
// Fallback policy (matches flows.fallback_policy JSONB)
// ============================================================

export interface FlowFallbackPolicy {
  /** What to do when the customer reply doesn't match any option. */
  on_unknown_reply: "reprompt" | "handoff" | "ignore";
  /** Max reprompts before applying `on_exhaust`. */
  max_reprompts: number;
  /** Stale-run sweep cutoff. */
  on_timeout_hours: number;
  /** What to do once max_reprompts has been hit. */
  on_exhaust: "handoff" | "end";
}

export const DEFAULT_FALLBACK_POLICY: FlowFallbackPolicy = {
  on_unknown_reply: "reprompt",
  max_reprompts: 2,
  on_timeout_hours: 24,
  on_exhaust: "handoff",
};

// ============================================================
// Engine input — what `dispatchInboundToFlows` accepts
// ============================================================

/**
 * Normalised view of an inbound message that the runner needs. The
 * webhook lifts this out of the raw Meta payload before invoking the
 * runner; keeps the runner free of any WhatsApp-API specifics.
 */
export type ParsedInbound =
  | {
      kind: "text";
      /** The user's typed message body. */
      text: string;
      /** Meta's `messages[0].id` — used for idempotency. */
      meta_message_id: string;
    }
  | {
      kind: "interactive_reply";
      /** The reply_id of the tapped button or list row. */
      reply_id: string;
      /** The visible title of the tapped option (for logging). */
      reply_title: string;
      meta_message_id: string;
    };

export interface DispatchInboundInput {
  /** Account tenancy key. Drives the lookup of active flows and the
   *  idempotency check for previously-seen inbound message_ids. */
  accountId: string;
  /** Sender-of-record for the bot's outbound prompts on engine
   *  sends. Set by the webhook to the WhatsApp config owner. */
  userId: string;
  contactId: string;
  conversationId: string;
  message: ParsedInbound;
}

export interface DispatchInboundResult {
  /**
   * True iff the runner handled the message — it either advanced an
   * existing run or started a new one matching a flow trigger.
   * Webhook uses this to decide whether to also fire automations.
   */
  consumed: boolean;
  /** For diagnostics / logging — null when not consumed. */
  flow_run_id?: string;
  /** For diagnostics. */
  outcome?:
    | "advanced"
    | "started"
    | "completed"
    | "handed_off"
    | "fallback_fired"
    | "duplicate_inbound_ignored"
    | "no_match";
}

// ============================================================
// Helpers — exhaustiveness assertions
// ============================================================

/**
 * Throws a typed compile-time error if the switch over a discriminated
 * union forgets a case. Used in the engine's node-type switch.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled node type: ${JSON.stringify(x)}`);
}
