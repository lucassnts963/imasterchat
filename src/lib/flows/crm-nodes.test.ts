import { describe, expect, it, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    flow: null as Record<string, unknown> | null,
    nodes: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    runUpdates: [] as Record<string, unknown>[],
  },
  sendTemplate: vi.fn(),
  updateContactField: vi.fn(),
  createDeal: vi.fn(),
  assignConversation: vi.fn(),
  closeConversation: vi.fn(),
  loadQueue: vi.fn(),
  routeConversationToQueue: vi.fn(),
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

vi.mock("@/lib/automations/meta-send", () => ({
  engineSendTemplate: h.sendTemplate,
}));

vi.mock("@/lib/actions/crm", () => ({
  updateContactField: h.updateContactField,
  createDeal: h.createDeal,
  assignConversation: h.assignConversation,
  closeConversation: h.closeConversation,
}));

vi.mock("@/lib/actions/queue-routing", () => ({
  loadQueue: h.loadQueue,
  routeConversationToQueue: h.routeConversationToQueue,
}));

import { startFlowRun } from "./engine";

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

function events(type: string) {
  return h.state.events.filter((e) => e.event_type === type);
}

beforeEach(() => {
  h.state.events = [];
  h.state.runUpdates = [];
  for (const fn of [
    h.sendTemplate,
    h.updateContactField,
    h.createDeal,
    h.assignConversation,
    h.closeConversation,
    h.loadQueue,
    h.routeConversationToQueue,
  ]) {
    fn.mockReset();
  }
  h.sendTemplate.mockResolvedValue({ whatsapp_message_id: "wam-tpl" });
  h.updateContactField.mockResolvedValue({ ok: true, message: "name updated" });
  h.createDeal.mockResolvedValue({ ok: true, message: "deal created" });
  h.assignConversation.mockResolvedValue({ ok: true, message: "assigned" });
  h.closeConversation.mockResolvedValue({ ok: true, message: "closed" });
  h.loadQueue.mockResolvedValue({
    id: "q-1",
    name: "Financeiro",
    description: null,
    responsibleUserId: null,
    autoAssign: false,
    distribution: "none",
  });
  h.routeConversationToQueue.mockResolvedValue({
    ok: true,
    message: 'routed to "Financeiro"',
    assignedTo: null,
  });
});

// Este é o nó que tira o fluxo da dependência da janela de 24 horas.
// Sem ele um fluxo só sabe REAGIR — e cobrança, que sempre começa do
// nosso lado, ficaria impossível sem IA.
describe("send_template", () => {
  it("sends the template and advances", async () => {
    flowWith("tpl", [
      {
        node_key: "tpl",
        node_type: "send_template",
        config: {
          template_name: "cobranca_d0",
          language: "pt_BR",
          next_node_key: "done",
        },
      },
    ]);

    await startFlowRun(START);

    expect(h.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: "cobranca_d0",
        language: "pt_BR",
        contactId: "contact-1",
        conversationId: "conv-1",
      }),
    );
  });

  // A Meta consome as variáveis por POSIÇÃO. Fora de ordem, o cliente
  // recebe o nome no lugar do valor — e ninguém vê erro, porque para a
  // Meta a mensagem foi entregue.
  it("emits the variables in numeric order, interpolated from the run", async () => {
    flowWith("tpl", [
      {
        node_key: "tpl",
        node_type: "send_template",
        config: {
          template_name: "t",
          variables: { 10: "décimo", 2: "{{vars.nome}}", 1: "primeiro" },
          next_node_key: "done",
        },
      },
    ]);

    await startFlowRun({ ...START, vars: { nome: "Ana" } });

    expect(h.sendTemplate.mock.calls[0][0].params).toEqual([
      "primeiro",
      "Ana",
      "décimo",
    ]);
  });

  // Ao contrário de uma etiqueta que não gravou, o template É a
  // mensagem: seguir adiante deixaria o cliente esperando um texto que
  // nunca chegou.
  it("fails the run when the template cannot be sent", async () => {
    h.sendTemplate.mockRejectedValue(new Error("template not approved"));
    flowWith("tpl", [
      {
        node_key: "tpl",
        node_type: "send_template",
        config: { template_name: "t", next_node_key: "done" },
      },
    ]);

    await startFlowRun(START);

    expect(events("error")[0]?.payload).toMatchObject({
      reason: "send_template_failed",
    });
  });
});

describe("CRM nodes", () => {
  it("writes a contact field with the run's variables resolved", async () => {
    flowWith("field", [
      {
        node_key: "field",
        node_type: "update_contact_field",
        config: { field: "name", value: "{{vars.nome}}", next_node_key: "done" },
      },
    ]);

    await startFlowRun({ ...START, vars: { nome: "Ana" } });

    expect(h.updateContactField).toHaveBeenCalledWith(
      expect.objectContaining({ field: "name", value: "Ana" }),
    );
  });

  // Uma escrita de CRM que falhou não estranha a conversa: o cliente
  // não está esperando nada dela. Registrar e seguir é melhor que
  // abandonar alguém no meio de um menu.
  it("keeps going when a CRM write fails", async () => {
    h.createDeal.mockResolvedValue({ ok: false, message: "deal not created: boom" });
    flowWith("deal", [
      {
        node_key: "deal",
        node_type: "create_deal",
        config: {
          pipeline_id: "p1",
          stage_id: "s1",
          title: "Negócio",
          next_node_key: "done",
        },
      },
    ]);

    await startFlowRun(START);

    // O laço registra um `node_entered` genérico ao ENTRAR no nó; o do
    // resultado vem depois, e é esse que carrega o `ok`.
    const entered = events("node_entered").filter(
      (e) => (e.payload as { ok?: boolean }).ok !== undefined,
    );
    expect(entered.at(-1)?.payload).toMatchObject({
      node_type: "create_deal",
      ok: false,
    });
    // Chegou ao fim mesmo assim.
    expect(h.state.runUpdates.some((u) => u.status === "completed")).toBe(true);
  });
});

describe("route_to_queue", () => {
  it("routes and ends the run", async () => {
    flowWith("route", [
      {
        node_key: "route",
        node_type: "route_to_queue",
        config: { queue_id: "q-1", reason: "cliente quer negociar" },
      },
    ]);

    const res = await startFlowRun(START);

    expect(h.routeConversationToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "cliente quer negociar" }),
    );
    expect(res).toMatchObject({ started: true, outcome: "handed_off" });
    expect(h.state.runUpdates.some((u) => u.status === "handed_off")).toBe(true);
  });

  // Fila apagada, desativada, ou trocada para atendimento por robô. A
  // decisão de parar de falar continua valendo — e o run não pode ficar
  // preso segurando o índice de um run ativo por contato.
  it("still ends the run when the queue is gone", async () => {
    h.loadQueue.mockResolvedValue(null);
    flowWith("route", [
      { node_key: "route", node_type: "route_to_queue", config: { queue_id: "q-x" } },
    ]);

    const res = await startFlowRun(START);

    expect(h.routeConversationToQueue).not.toHaveBeenCalled();
    expect(res).toMatchObject({ outcome: "handed_off" });
    expect(events("error")[0]?.payload).toMatchObject({
      reason: "queue_not_available",
    });
  });
});
