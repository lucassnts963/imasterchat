import { describe, expect, it, beforeEach, vi } from "vitest";

// ============================================================
// O teste que faltava: um fluxo INTEIRO, do gatilho ao fim.
//
// Existia teste de validação, de arestas, de fallback e de layout —
// tudo em volta do motor, nada atravessando ele. GA sem isto é promessa
// sem prova (fase 2, R-11).
//
// O banco é um duplo em memória, com estado de verdade: `flow_runs` e
// `flow_run_events` guardam o que foi escrito, e as consultas leem de
// volta. É o que permite afirmar "o run avançou para X" em vez de "a
// função foi chamada".
// ============================================================

const h = vi.hoisted(() => ({
  db: {
    flows: [] as Record<string, unknown>[],
    nodes: [] as Record<string, unknown>[],
    runs: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    contacts: [{ id: "contact-1", account_id: "acct-1" }] as Record<string, unknown>[],
    conversations: [
      { id: "conv-1", account_id: "acct-1", contact_id: "contact-1" },
    ] as Record<string, unknown>[],
  },
  sent: [] as { kind: string; to: string; body: unknown }[],
}));

vi.mock("./admin-client", () => {
  const { db } = h;
  let nextRunId = 1;

  function matches(rows: Record<string, unknown>[], filters: [string, unknown][]) {
    return rows.filter((row) =>
      filters.every(([key, value]) => {
        if (value === null) return row[key] === null || row[key] === undefined;
        return row[key] === value;
      }),
    );
  }

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    const notNull: string[] = [];
    /** `.in(col, values)` — usado pela checagem de duplicata. */
    let inFilter: { key: string; values: unknown[] } | null = null;
    /** `.filter('payload->>chave', 'eq', valor)` — idem. */
    let jsonFilter: { key: string; value: unknown } | null = null;
    let wantsCount = false;
    let op: "select" | "insert" | "update" = "select";
    let payload: Record<string, unknown> = {};

    const rowsOf = (): Record<string, unknown>[] => {
      switch (table) {
        case "flows":
          return db.flows;
        case "flow_nodes":
          return db.nodes;
        case "flow_runs":
          return db.runs;
        case "flow_run_events":
          return db.events;
        case "contacts":
          return db.contacts;
        case "conversations":
          return db.conversations;
        default:
          return [];
      }
    };

    const settle = () => {
      let rows = matches(rowsOf(), filters);
      for (const key of notNull) rows = rows.filter((r) => r[key] != null);
      if (inFilter) {
        rows = rows.filter((r) => inFilter!.values.includes(r[inFilter!.key]));
      }
      if (jsonFilter) {
        rows = rows.filter(
          (r) =>
            (r.payload as Record<string, unknown> | undefined)?.[jsonFilter!.key] ===
            jsonFilter!.value,
        );
      }

      if (op === "insert") {
        const row = { ...payload };
        if (table === "flow_runs") {
          row.id = `run-${nextRunId++}`;
          row.vars = row.vars ?? {};
          row.reprompt_count = 0;
          row.last_advanced_at = new Date().toISOString();
        }
        rowsOf().push(row);
        return { data: row, error: null };
      }
      if (op === "update") {
        for (const row of rows) Object.assign(row, payload);
        return { data: rows, error: null };
      }
      if (wantsCount) return { data: null, error: null, count: rows.length };
      return { data: rows, error: null };
    };

    const b: Record<string, unknown> = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) wantsCount = true;
        return b;
      },
      insert: (p: Record<string, unknown>) => ((op = "insert"), (payload = p), b),
      update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), b),
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      is: (k: string, v: unknown) => (filters.push([k, v]), b),
      not: (k: string) => (notNull.push(k), b),
      lte: () => b,
      in: (k: string, v: unknown[]) => ((inFilter = { key: k, values: v }), b),
      filter: (expr: string, _op: string, v: unknown) => {
        const key = expr.split("->>")[1];
        if (key) jsonFilter = { key, value: v };
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: () => {
        const out = settle();
        const data = Array.isArray(out.data) ? (out.data[0] ?? null) : out.data;
        return Promise.resolve({ data, error: null });
      },
      single: () => (b.maybeSingle as () => Promise<unknown>)(),
      then: (onOk: (v: unknown) => unknown) => Promise.resolve(settle()).then(onOk),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: async () => ({ data: null, error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async (a: { text: string }) => {
    h.sent.push({ kind: "text", to: "contact-1", body: a.text });
    return { whatsapp_message_id: `wam-${h.sent.length}` };
  }),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wam-media" })),
  engineSendInteractiveButtons: vi.fn(async (a: { bodyText: string }) => {
    h.sent.push({ kind: "buttons", to: "contact-1", body: a.bodyText });
    return { whatsapp_message_id: `wam-${h.sent.length}` };
  }),
  engineSendInteractiveList: vi.fn(async (a: { bodyText: string }) => {
    h.sent.push({ kind: "list", to: "contact-1", body: a.bodyText });
    return { whatsapp_message_id: `wam-${h.sent.length}` };
  }),
}));

vi.mock("@/lib/contacts/tag-events", () => ({
  addContactTagAndDispatch: vi.fn(async () => ({ added: true, dispatched: true })),
}));
vi.mock("@/lib/contacts/tag-write", () => ({
  removeContactTag: vi.fn(async () => true),
  addContactTagIfAbsent: vi.fn(async () => true),
}));

import {
  dispatchInboundToFlows,
  resumeHandoffPause,
  resumeWaitingRun,
} from "./engine";

// O roteiro sob teste: palavra-chave → menu → coleta → condição →
// etiqueta → fim. É o "digite 1, digite 2" completo.
const NODES = [
  { flow_id: "flow-1", node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
  {
    flow_id: "flow-1",
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "Como posso ajudar?",
      buttons: [
        { reply_id: "orcamento", title: "Orçamento", next_node_key: "pede_nome" },
        { reply_id: "suporte", title: "Suporte", next_node_key: "fim_suporte" },
      ],
      timeout_minutes: 10,
      on_timeout_next: "fim_timeout",
    },
  },
  {
    flow_id: "flow-1",
    node_key: "pede_nome",
    node_type: "collect_input",
    config: { prompt_text: "Seu nome?", var_key: "nome", next_node_key: "checa" },
  },
  {
    flow_id: "flow-1",
    node_key: "checa",
    node_type: "condition",
    config: {
      subject: "var",
      subject_key: "nome",
      operator: "present",
      true_next: "marca",
      false_next: "fim_suporte",
    },
  },
  {
    flow_id: "flow-1",
    node_key: "marca",
    node_type: "set_tag",
    config: { mode: "add", tag_id: "tag-lead", next_node_key: "despede" },
  },
  {
    flow_id: "flow-1",
    node_key: "despede",
    node_type: "send_message",
    config: { text: "Obrigado, {{vars.nome}}!", next_node_key: "fim" },
  },
  { flow_id: "flow-1", node_key: "fim", node_type: "end", config: {} },
  { flow_id: "flow-1", node_key: "fim_suporte", node_type: "end", config: {} },
  { flow_id: "flow-1", node_key: "fim_timeout", node_type: "end", config: {} },
];

function flow(over: Record<string, unknown> = {}) {
  return {
    id: "flow-1",
    account_id: "acct-1",
    user_id: "user-1",
    status: "active",
    trigger_type: "keyword",
    trigger_config: { keywords: ["oi"], match_type: "exact" },
    entry_node_id: "start",
    fallback_policy: { on_unknown_reply: "reprompt", max_reprompts: 1, on_timeout_hours: 24 },
    ...over,
  };
}

const INBOUND = {
  accountId: "acct-1",
  userId: "user-1",
  contactId: "contact-1",
  conversationId: "conv-1",
  isFirstInboundMessage: false,
};

const text = (body: string, id: string) => ({
  ...INBOUND,
  message: { kind: "text" as const, text: body, meta_message_id: id },
});

const tap = (replyId: string, id: string) => ({
  ...INBOUND,
  message: {
    kind: "interactive_reply" as const,
    reply_id: replyId,
    reply_title: replyId,
    meta_message_id: id,
  },
});

function theRun() {
  return h.db.runs[0] as Record<string, unknown>;
}

function eventTypes() {
  return h.db.events.map((e) => e.event_type);
}

beforeEach(() => {
  h.db.flows = [flow()];
  h.db.nodes = NODES.map((n) => ({ ...n, config: { ...n.config } }));
  h.db.runs = [];
  h.db.events = [];
  h.sent = [];
});

describe("a whole flow, trigger to end", () => {
  it("walks the customer from the keyword to the goodbye", async () => {
    // 1. A palavra-chave abre o run e o menu sai.
    const started = await dispatchInboundToFlows(text("oi", "m1"));
    expect(started.consumed).toBe(true);
    expect(started.outcome).toBe("started");
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].kind).toBe("buttons");
    expect(theRun().current_node_key).toBe("menu");

    // 2. O toque no botão avança para a coleta.
    await dispatchInboundToFlows(tap("orcamento", "m2"));
    expect(theRun().current_node_key).toBe("pede_nome");
    expect(h.sent[1].body).toBe("Seu nome?");

    // 3. O texto é capturado, a condição passa, a etiqueta entra, e a
    //    despedida sai JÁ INTERPOLADA — que é o teste de que a variável
    //    atravessou três nós.
    const done = await dispatchInboundToFlows(text("Ana", "m3"));
    expect(theRun().vars).toMatchObject({ nome: "Ana" });
    expect(h.sent[2].body).toBe("Obrigado, Ana!");
    expect(done.outcome).toBe("completed");
    expect(theRun().status).toBe("completed");
    expect(theRun().end_reason).toBe("end_node");
  });

  it("leaves a timeline anyone can read afterwards", async () => {
    await dispatchInboundToFlows(text("oi", "m1"));
    await dispatchInboundToFlows(tap("orcamento", "m2"));
    await dispatchInboundToFlows(text("Ana", "m3"));

    const types = eventTypes();
    expect(types[0]).toBe("started");
    expect(types).toContain("message_sent");
    expect(types).toContain("reply_received");
    expect(types).toContain("completed");
  });

  // O texto do cliente NÃO é gravado: um `collect_input` que pergunta o
  // cartão deixaria o número em `flow_run_events` para sempre.
  it("never writes the customer's raw text into the timeline", async () => {
    await dispatchInboundToFlows(text("oi", "m1"));
    await dispatchInboundToFlows(tap("orcamento", "m2"));
    await dispatchInboundToFlows(text("4111 1111 1111 1111", "m3"));

    expect(JSON.stringify(h.db.events)).not.toContain("4111");
  });
});

describe("the customer who does not follow the script", () => {
  it("reprompts once, then gives up as the policy says", async () => {
    await dispatchInboundToFlows(text("oi", "m1"));
    h.sent = [];

    const first = await dispatchInboundToFlows(text("qualquer coisa", "m2"));
    expect(first.outcome).toBe("fallback_fired");
    expect(h.sent).toHaveLength(1); // repetiu o menu

    const second = await dispatchInboundToFlows(text("de novo", "m3"));
    expect(theRun().status).not.toBe("active");
    expect(second.consumed).toBe(true);
  });

  it("ignores a Meta retry of a message it already handled", async () => {
    await dispatchInboundToFlows(text("oi", "m1"));
    await dispatchInboundToFlows(tap("orcamento", "m2"));
    const before = theRun().current_node_key;

    const again = await dispatchInboundToFlows(tap("orcamento", "m2"));

    expect(again.outcome).toBe("duplicate_inbound_ignored");
    expect(theRun().current_node_key).toBe(before);
  });
});

describe("the node deadline", () => {
  it("takes its own edge when nobody answers the menu", async () => {
    await dispatchInboundToFlows(text("oi", "m1"));
    expect(theRun().resume_kind).toBe("node_timeout");
    expect(theRun().resume_at).toBeTruthy();

    await expect(resumeWaitingRun(String(theRun().id))).resolves.toBe("resumed");
    expect(theRun().status).toBe("completed");
    expect(eventTypes()).toContain("timeout");
  });

  // Sem isto o cron acordaria um run que já andou e o mandaria pela
  // aresta de "ninguém respondeu" — depois de alguém ter respondido.
  it("is cleared the moment the customer does answer", async () => {
    await dispatchInboundToFlows(text("oi", "m1"));
    await dispatchInboundToFlows(tap("orcamento", "m2"));

    expect(theRun().resume_at).toBeNull();
    expect(theRun().resume_kind).toBeNull();
  });

  it("ends the run when there is no timeout edge to take", async () => {
    const menu = h.db.nodes.find((n) => n.node_key === "menu")!;
    delete (menu.config as Record<string, unknown>).on_timeout_next;

    await dispatchInboundToFlows(text("oi", "m1"));
    await expect(resumeWaitingRun(String(theRun().id))).resolves.toBe("timed_out");
    expect(theRun().status).toBe("timed_out");
  });
});

// ============================================================
// Handoff que pausa — fase 2, R-12.
//
// O buraco que isto fecha: o cliente diz "quero negociar", vai para uma
// pessoa, a pessoa resolve — e nada devolvia a pessoa ao roteiro.
// ============================================================

describe("a handoff that pauses instead of ending", () => {
  function withPausingHandoff() {
    const menu = h.db.nodes.find((n) => n.node_key === "menu")!;
    (menu.config as { buttons: Array<Record<string, unknown>> }).buttons[1].next_node_key =
      "humano";
    h.db.nodes.push({
      flow_id: "flow-1",
      node_key: "humano",
      node_type: "handoff",
      config: {
        mode: "pause",
        note: "quer negociar",
        next_node_key: "despede",
        pause_timeout_hours: 4,
      },
    });
  }

  it("keeps the run alive with a deadline on it", async () => {
    withPausingHandoff();
    await dispatchInboundToFlows(text("oi", "m1"));
    await dispatchInboundToFlows(tap("suporte", "m2"));

    expect(theRun().status).toBe("active");
    expect(theRun().current_node_key).toBe("humano");
    expect(theRun().resume_kind).toBe("handoff_pause");
    expect(theRun().resume_at).toBeTruthy();
  });

  it("picks the script back up where it stopped", async () => {
    withPausingHandoff();
    await dispatchInboundToFlows(text("oi", "m1"));
    await dispatchInboundToFlows(tap("suporte", "m2"));
    h.sent = [];

    const out = await resumeHandoffPause({
      accountId: "acct-1",
      contactId: "contact-1",
    });

    expect(out).toMatchObject({ resumed: true });
    // Continuou no nó configurado e terminou.
    expect(h.sent[0]?.kind).toBe("text");
    expect(theRun().status).toBe("completed");
  });

  // A conversa volta a ser do robô. Sem isto o fluxo retomaria falando
  // enquanto a inbox continua marcando a conversa como transferida.
  it("gives the conversation back to the bot", async () => {
    withPausingHandoff();
    await dispatchInboundToFlows(text("oi", "m1"));
    await dispatchInboundToFlows(tap("suporte", "m2"));
    expect(h.db.conversations[0].ai_autoreply_disabled).toBe(true);

    await resumeHandoffPause({ accountId: "acct-1", contactId: "contact-1" });

    expect(h.db.conversations[0].ai_autoreply_disabled).toBe(false);
  });

  // Um run pausado para sempre segura o índice de um run ativo por
  // contato e bloqueia todo gatilho futuro daquela pessoa.
  it("gives up on its own when nobody hands it back", async () => {
    withPausingHandoff();
    await dispatchInboundToFlows(text("oi", "m1"));
    await dispatchInboundToFlows(tap("suporte", "m2"));

    await expect(resumeWaitingRun(String(theRun().id))).resolves.toBe("timed_out");
    expect(theRun().status).toBe("timed_out");
    expect(theRun().end_reason).toBe("handoff_pause_expired");
  });

  it("says so when there is nothing paused to hand back", async () => {
    await expect(
      resumeHandoffPause({ accountId: "acct-1", contactId: "contact-1" }),
    ).resolves.toEqual({ resumed: false, reason: "no_paused_run" });
  });
});
