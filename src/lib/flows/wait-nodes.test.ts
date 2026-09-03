import { describe, expect, it, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    flow: null as Record<string, unknown> | null,
    nodes: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    runUpdates: [] as Record<string, unknown>[],
    dueRuns: [] as Record<string, unknown>[],
    /** Simula a precondição `resume_at IS NOT NULL` do UPDATE de posse:
     *  false faz a reivindicação voltar vazia, como para quem perde a
     *  corrida com outra execução do cron. */
    claimSucceeds: true,
    run: null as Record<string, unknown> | null,
  },
  isDeliverableUrl: vi.fn(),
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
        return { data: { id: "run-1", ...(ops.payload as object) }, error: null };
      }
      if (type === "update") {
        state.runUpdates.push(ops.payload as Record<string, unknown>);
        if (!state.claimSucceeds) return { data: [], error: null };
        return {
          data: [{ ...(state.run ?? { id: "run-1" }), ...(ops.payload as object) }],
          error: null,
        };
      }
      return { data: state.dueRuns, error: null };
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
      not: () => b,
      lte: () => b,
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
      from: (t: string) => builder(t),
      rpc: async () => ({ data: null, error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "wam-1" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wam-1" })),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: "wam-1" })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wam-1" })),
}));

vi.mock("@/lib/webhooks/ssrf", () => ({ isDeliverableUrl: h.isDeliverableUrl }));

import { isSleeping, resumeWaitingRun, startFlowRun } from "./engine";

const START = {
  accountId: "acct-1",
  contactId: "contact-1",
  flowId: "flow-1",
  startedBy: "automation" as const,
};

function flowWith(entry: string, nodes: Record<string, unknown>[]) {
  h.state.flow = {
    id: "flow-1",
    account_id: "acct-1",
    user_id: "user-1",
    status: "active",
    trigger_type: "manual",
    entry_node_id: entry,
  };
  h.state.nodes = [...nodes, { node_key: "done", node_type: "end", config: {} }];
}

beforeEach(() => {
  h.state.events = [];
  h.state.runUpdates = [];
  h.state.dueRuns = [];
  h.state.claimSucceeds = true;
  h.state.run = null;
  h.isDeliverableUrl.mockReset();
  h.isDeliverableUrl.mockResolvedValue(true);
  vi.unstubAllGlobals();
});

describe("wait node", () => {
  it("parks the run with an hour to come back", async () => {
    flowWith("hold", [
      {
        node_key: "hold",
        node_type: "wait",
        config: { amount: 2, unit: "hours", next_node_key: "done" },
      },
    ]);

    const before = Date.now();
    await startFlowRun(START);

    const parked = h.state.runUpdates.find((u) => u.resume_at);
    expect(parked?.current_node_key).toBe("hold");
    const resumeAt = new Date(String(parked?.resume_at)).getTime();
    expect(resumeAt - before).toBeGreaterThan(1.9 * 3_600_000);
    expect(resumeAt - before).toBeLessThan(2.1 * 3_600_000);
  });

  // Um `wait` de zero, ou com a unidade corrompida, não pode virar um
  // run que nunca volta nem um que volta no passado.
  it("keeps a floor of one second", async () => {
    flowWith("hold", [
      {
        node_key: "hold",
        node_type: "wait",
        config: { amount: 0, unit: "minutes", next_node_key: "done" },
      },
    ]);

    const before = Date.now();
    await startFlowRun(START);
    const parked = h.state.runUpdates.find((u) => u.resume_at);
    expect(new Date(String(parked?.resume_at)).getTime()).toBeGreaterThanOrEqual(
      before + 1_000,
    );
  });

  // É o que separa "dormindo" de "esperando resposta". Sem isso a
  // varredura de abandono mataria um degrau de "espera 3 dias" em 24
  // horas, e uma mensagem que chegasse no meio dispararia o fallback.
  it("is a sleeping node, not a suspending one", () => {
    expect(isSleeping("wait")).toBe(true);
    expect(isSleeping("collect_input")).toBe(false);
  });
});

describe("resumeWaitingRun", () => {
  beforeEach(() => {
    h.state.run = {
      id: "run-1",
      flow_id: "flow-1",
      account_id: "acct-1",
      user_id: "user-1",
      contact_id: "contact-1",
      conversation_id: "conv-1",
      status: "active",
      current_node_key: "hold",
      vars: {},
      reprompt_count: 0,
    };
    flowWith("hold", [
      {
        node_key: "hold",
        node_type: "wait",
        config: { amount: 1, unit: "hours", next_node_key: "done" },
      },
    ]);
  });

  it("picks the run up where it left off", async () => {
    await expect(resumeWaitingRun("run-1")).resolves.toBe("resumed");
    // Chegou ao `end` e encerrou.
    expect(h.state.runUpdates.some((u) => u.status === "completed")).toBe(true);
  });

  // Clearing `resume_at` IS the lock: two cron runs firing at once must
  // not advance the same run twice, or the customer gets the next
  // message in duplicate.
  it("does nothing when another sweep already took it", async () => {
    h.state.claimSucceeds = false;
    await expect(resumeWaitingRun("run-1")).resolves.toBe("already_taken");
  });

  // O fluxo pode ter sido reescrito enquanto o run dormia. Não é erro:
  // o `resume_at` já saiu, e o run segue a vida por onde estiver.
  it("shrugs when the node is no longer a wait", async () => {
    h.state.nodes = [{ node_key: "hold", node_type: "end", config: {} }];
    await expect(resumeWaitingRun("run-1")).resolves.toBe("not_waiting");
  });
});

describe("send_webhook node", () => {
  function webhookFlow() {
    flowWith("hook", [
      {
        node_key: "hook",
        node_type: "send_webhook",
        config: {
          url: "https://example.com/hook",
          next_node_key: "done",
          on_error_next: "failed",
        },
      },
      { node_key: "failed", node_type: "end", config: {} },
    ]);
  }

  function lastNodeKey(): string | undefined {
    const withKey = h.state.events.filter((e) => e.node_key);
    return withKey[withKey.length - 1]?.node_key as string | undefined;
  }

  it("posts and takes the success edge", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    webhookFlow();

    await startFlowRun(START);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    // Sem seguir redirecionamento: uma URL pública que responde 302 para
    // um endereço interno derrotaria a guarda de SSRF.
    expect(opts.redirect).toBe("manual");
    expect(lastNodeKey()).toBe("done");
  });

  it("takes the error edge on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    webhookFlow();
    await startFlowRun(START);
    expect(lastNodeKey()).toBe("failed");
  });

  // A URL é escrita por quem configura e quem faz a requisição é o
  // servidor. Sem a guarda, um fluxo alcança qualquer coisa dentro da
  // rede.
  it("refuses a destination the SSRF guard rejects", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock);
    h.isDeliverableUrl.mockResolvedValue(false);
    webhookFlow();

    await startFlowRun(START);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastNodeKey()).toBe("failed");
  });
});
