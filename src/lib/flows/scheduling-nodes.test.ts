import { describe, expect, it, beforeEach, vi } from "vitest";

// Mesma forma de mock do `start-run.test.ts`: um resolvedor por tabela,
// num bloco hoisted para a fábrica do vi.mock alcançar.
const h = vi.hoisted(() => ({
  state: {
    flow: null as Record<string, unknown> | null,
    nodes: [] as Record<string, unknown>[],
    runUpdates: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
  },
  listAvailability: vi.fn(),
  bookForContact: vi.fn(),
  rescheduleForContact: vi.fn(),
  cancelForContact: vi.fn(),
  resolveSchedulingContext: vi.fn(),
  sendList: vi.fn(),
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: { table: string; type: string; payload?: unknown }) {
    const { table, type } = ops;
    if (table === "flows") return { data: state.flow, error: null };
    if (table === "contacts") return { data: { id: "contact-1" }, error: null };
    if (table === "conversations") return { data: [{ id: "conv-1" }], error: null };
    if (table === "flow_nodes") return { data: state.nodes, error: null };
    if (table === "messages") return { data: { id: "msg-1" }, error: null };
    if (table === "flow_runs") {
      if (type === "insert") {
        const payload = ops.payload as Record<string, unknown>;
        return { data: { id: "run-1", ...payload }, error: null };
      }
      if (type === "update") {
        state.runUpdates.push(ops.payload as Record<string, unknown>);
        return { data: [{ id: "run-1" }], error: null };
      }
      return { data: [], error: null };
    }
    if (table === "flow_run_events") {
      if (type === "insert") state.events.push(ops.payload as Record<string, unknown>);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = { table, type: "select", payload: undefined as unknown };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      eq: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve(resolve(ops)),
      single: () => Promise.resolve(resolve(ops)),
      then: (onOk: (v: unknown) => unknown) => Promise.resolve(resolve(ops)).then(onOk),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (table: string) => builder(table),
      rpc: async () => ({ data: null, error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "wam-1" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wam-1" })),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: "wam-1" })),
  engineSendInteractiveList: h.sendList,
}));

vi.mock("@/lib/actions/scheduling", () => ({
  listAvailability: h.listAvailability,
  bookForContact: h.bookForContact,
  rescheduleForContact: h.rescheduleForContact,
  cancelForContact: h.cancelForContact,
  resolveSchedulingContext: h.resolveSchedulingContext,
}));

import { startFlowRun } from "./engine";

const SETTINGS = { timezone: "America/Sao_Paulo", lookaheadDays: 7 };

function offerNode(over: Record<string, unknown> = {}) {
  return {
    node_key: "offer",
    node_type: "offer_slots",
    config: {
      text: "Horários livres:",
      button_label: "Ver",
      max_options: 3,
      next_node_key: "booked_end",
      no_slots_next: "no_slots_end",
      on_error_next: "error_end",
      ...over,
    },
  };
}

function slots(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    startsAt: new Date(Date.UTC(2026, 8, 10 + i, 13, 0)),
    endsAt: new Date(Date.UTC(2026, 8, 10 + i, 14, 0)),
  }));
}

/** O nó de saída em que o run terminou, lido do fim do run. */
function endedAt(): string | undefined {
  const ended = h.state.events.filter((e) => e.node_key);
  return ended[ended.length - 1]?.node_key as string | undefined;
}

beforeEach(() => {
  h.state.flow = {
    id: "flow-1",
    account_id: "acct-1",
    user_id: "user-1",
    status: "active",
    trigger_type: "manual",
    entry_node_id: "offer",
  };
  h.state.nodes = [
    offerNode(),
    { node_key: "booked_end", node_type: "end", config: {} },
    { node_key: "no_slots_end", node_type: "end", config: {} },
    { node_key: "error_end", node_type: "end", config: {} },
  ];
  h.state.runUpdates = [];
  h.state.events = [];

  for (const fn of [
    h.listAvailability,
    h.bookForContact,
    h.rescheduleForContact,
    h.cancelForContact,
    h.resolveSchedulingContext,
    h.sendList,
  ]) {
    fn.mockReset();
  }
  h.resolveSchedulingContext.mockResolvedValue({
    settings: SETTINGS,
    connection: null,
  });
  h.listAvailability.mockResolvedValue({ ok: true, data: slots(3) });
  h.sendList.mockResolvedValue({ whatsapp_message_id: "wam-1" });
});

const START = {
  accountId: "acct-1",
  contactId: "contact-1",
  flowId: "flow-1",
  startedBy: "automation" as const,
};

describe("offer_slots", () => {
  it("offers the free times as a list and suspends", async () => {
    const res = await startFlowRun(START);

    expect(res.started).toBe(true);
    expect(h.sendList).toHaveBeenCalledTimes(1);
    const sent = h.sendList.mock.calls[0][0];
    expect(sent.sections[0].rows).toHaveLength(3);
    expect(sent.sections[0].rows[0].id).toBe("slot:0");
  });

  // O índice do `reply_id` só significa alguma coisa contra a lista que
  // foi realmente oferecida. Guardar ANTES de mandar é o que garante que
  // nunca existe uma lista na mão do cliente sem contrapartida gravada.
  it("records what was offered before sending it", async () => {
    await startFlowRun(START);

    const withSlots = h.state.runUpdates.find((u) => u.vars);
    const offered = (withSlots?.vars as Record<string, unknown>)._offered_slots;
    expect(Array.isArray(offered)).toBe(true);
    expect(offered).toHaveLength(3);
  });

  it("respects the configured ceiling", async () => {
    h.listAvailability.mockResolvedValue({ ok: true, data: slots(9) });
    h.state.nodes[0] = offerNode({ max_options: 2 });
    await startFlowRun(START);
    expect(h.sendList.mock.calls[0][0].sections[0].rows).toHaveLength(2);
  });

  // WhatsApp mostra no máximo 10 linhas. Configurar 20 e ver 10 chegar é
  // uma diferença que ninguém liga ao que configurou.
  it("never asks Meta for more rows than it accepts", async () => {
    h.listAvailability.mockResolvedValue({ ok: true, data: slots(30) });
    h.state.nodes[0] = offerNode({ max_options: 25 });
    await startFlowRun(START);
    expect(h.sendList.mock.calls[0][0].sections[0].rows).toHaveLength(10);
  });

  it("takes the no-slots edge when the diary is full", async () => {
    h.listAvailability.mockResolvedValue({ ok: true, data: [] });
    await startFlowRun(START);
    expect(h.sendList).not.toHaveBeenCalled();
    expect(endedAt()).toBe("no_slots_end");
  });

  // ESTA é a razão de as duas arestas existirem. Uma agenda que não
  // conseguimos ler não é uma agenda cheia: mandar o cliente por "não
  // tenho horário" quando o Google caiu perde a venda e mente.
  it("takes the error edge — not the no-slots edge — when the calendar is unreadable", async () => {
    h.listAvailability.mockResolvedValue({
      ok: false,
      reason: "calendar_unreadable",
      message: "The business calendar is no longer connected.",
    });
    await startFlowRun(START);
    expect(h.sendList).not.toHaveBeenCalled();
    expect(endedAt()).toBe("error_end");
  });

  it("takes the error edge when the account has no scheduling at all", async () => {
    h.resolveSchedulingContext.mockResolvedValue(null);
    await startFlowRun(START);
    expect(h.listAvailability).not.toHaveBeenCalled();
    expect(endedAt()).toBe("error_end");
  });
});

describe("book_appointment", () => {
  function bookingFlow(chosen: number | null) {
    h.state.flow = { ...h.state.flow, entry_node_id: "book" };
    h.state.nodes = [
      {
        node_key: "book",
        node_type: "book_appointment",
        config: {
          title: "Corte",
          next_node_key: "booked_end",
          on_unavailable_next: "taken_end",
          on_error_next: "error_end",
        },
      },
      { node_key: "booked_end", node_type: "end", config: {} },
      { node_key: "taken_end", node_type: "end", config: {} },
      { node_key: "error_end", node_type: "end", config: {} },
    ];
    return {
      ...START,
      vars: {
        _offered_slots: [
          { starts_at: "2026-09-10T13:00:00.000Z", ends_at: "2026-09-10T14:00:00.000Z" },
        ],
        ...(chosen === null ? {} : { _chosen_slot: chosen }),
      },
    };
  }

  it("books the slot the customer picked", async () => {
    h.bookForContact.mockResolvedValue({ ok: true, data: {} });
    await startFlowRun(bookingFlow(0));

    expect(h.bookForContact).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2026-09-10T13:00:00.000Z",
        endsAt: "2026-09-10T14:00:00.000Z",
        createdVia: "native",
      }),
    );
    expect(endedAt()).toBe("booked_end");
  });

  // Entre oferecer e confirmar o cliente demora, e o horário vai embora.
  // É o caso comum, e por isso tem caminho próprio em vez de virar erro.
  it("takes the unavailable edge when the time went in the meantime", async () => {
    h.bookForContact.mockResolvedValue({
      ok: false,
      reason: "slot_unavailable",
      message: "Esse horário acabou de ser preenchido.",
    });
    await startFlowRun(bookingFlow(0));
    expect(endedAt()).toBe("taken_end");
  });

  it("takes the error edge when the write failed", async () => {
    h.bookForContact.mockResolvedValue({
      ok: false,
      reason: "write_failed",
      message: "nope",
    });
    await startFlowRun(bookingFlow(0));
    expect(endedAt()).toBe("error_end");
  });

  // Um fluxo mal montado — agendar sem oferecer antes — não pode marcar
  // um horário arbitrário. Sem escolha, não há o que marcar.
  it("refuses to invent a time when nothing was chosen", async () => {
    await startFlowRun(bookingFlow(null));
    expect(h.bookForContact).not.toHaveBeenCalled();
    expect(endedAt()).toBe("error_end");
  });
});

describe("cancel_appointment", () => {
  function cancelFlow() {
    h.state.flow = { ...h.state.flow, entry_node_id: "cancel" };
    h.state.nodes = [
      {
        node_key: "cancel",
        node_type: "cancel_appointment",
        config: {
          reason: "cliente pediu",
          next_node_key: "done_end",
          on_no_appointment_next: "none_end",
          on_error_next: "error_end",
        },
      },
      { node_key: "done_end", node_type: "end", config: {} },
      { node_key: "none_end", node_type: "end", config: {} },
      { node_key: "error_end", node_type: "end", config: {} },
    ];
    return START;
  }

  it("cancels and moves on", async () => {
    h.cancelForContact.mockResolvedValue({ ok: true, data: {} });
    await startFlowRun(cancelFlow());
    expect(endedAt()).toBe("done_end");
  });

  // "Não tinha nada marcado" é uma resposta, não uma falha: o fluxo
  // segue por um caminho que pode dizer isso ao cliente.
  it("has its own path for a customer with nothing booked", async () => {
    h.cancelForContact.mockResolvedValue({
      ok: false,
      reason: "no_appointment",
      message: "This customer has no appointment booked.",
    });
    await startFlowRun(cancelFlow());
    expect(endedAt()).toBe("none_end");
  });
});
