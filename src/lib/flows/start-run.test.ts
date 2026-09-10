import { describe, expect, it, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client, hoisted so the
// vi.mock factory below can close over it. Same shape as the
// automations engine test: one resolver keyed by table + operation.
const h = vi.hoisted(() => ({
  state: {
    flow: null as Record<string, unknown> | null,
    contact: null as { id: string } | null,
    activeRuns: [] as Record<string, unknown>[],
    conversations: [] as { id: string }[],
    nodes: [] as Record<string, unknown>[],
    insertError: null as { message: string } | null,
    runInserts: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    runUpdates: [] as Record<string, unknown>[],
    rpcCalls: [] as string[],
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
  }): { data: unknown; error: unknown } {
    const { table, type } = ops;
    if (table === "flows") return { data: state.flow, error: null };
    if (table === "contacts") return { data: state.contact, error: null };
    if (table === "conversations") return { data: state.conversations, error: null };
    if (table === "flow_nodes") return { data: state.nodes, error: null };
    if (table === "flow_runs") {
      if (type === "insert") {
        if (state.insertError) return { data: null, error: state.insertError };
        const payload = ops.payload as Record<string, unknown>;
        state.runInserts.push(payload);
        return { data: { id: "run-new", ...payload }, error: null };
      }
      if (type === "update") {
        state.runUpdates.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      return { data: state.activeRuns, error: null };
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
      rpc: async (name: string) => {
        h.state.rpcCalls.push(name);
        return { data: null, error: null };
      },
    }),
  };
});

import { startFlowRun } from "./engine";
import { MAX_FLOW_CHAIN_DEPTH } from "./chain";

const INPUT = {
  accountId: "acct-1",
  contactId: "contact-1",
  flowId: "flow-1",
  startedBy: "automation" as const,
};

function activeFlow(over: Record<string, unknown> = {}) {
  return {
    id: "flow-1",
    account_id: "acct-1",
    user_id: "user-1",
    status: "active",
    trigger_type: "manual",
    entry_node_id: "start",
    ...over,
  };
}

beforeEach(() => {
  h.state.flow = activeFlow();
  h.state.contact = { id: "contact-1" };
  h.state.activeRuns = [];
  h.state.conversations = [{ id: "conv-1" }];
  // start → end: enough to exercise the advance loop without a Meta send.
  h.state.nodes = [
    { node_key: "start", node_type: "start", config: { next_node_key: "done" } },
    { node_key: "done", node_type: "end", config: {} },
  ];
  h.state.insertError = null;
  h.state.runInserts = [];
  h.state.events = [];
  h.state.runUpdates = [];
  h.state.rpcCalls = [];
});

describe("startFlowRun", () => {
  it("creates the run and walks it forward", async () => {
    const res = await startFlowRun(INPUT);

    expect(res).toMatchObject({ started: true, flowRunId: "run-new" });
    expect(h.state.runInserts).toHaveLength(1);
    expect(h.state.runInserts[0]).toMatchObject({
      flow_id: "flow-1",
      account_id: "acct-1",
      contact_id: "contact-1",
      conversation_id: "conv-1",
      status: "active",
      current_node_key: "start",
    });
    expect(h.state.rpcCalls).toContain("increment_flow_execution_count");
  });

  // The `started` event is the only place anyone can later find out
  // where a run came from. Without it, "why did this customer get a
  // menu?" has no answer.
  it("records who started it", async () => {
    await startFlowRun(INPUT);
    const started = h.state.events.find((e) => e.event_type === "started");
    expect(started?.payload).toMatchObject({ started_by: "automation" });
  });

  it("seeds the caller's vars alongside the chain counter", async () => {
    await startFlowRun({ ...INPUT, vars: { valor: "80,00" } });
    expect(h.state.runInserts[0].vars).toEqual({
      valor: "80,00",
      _flow_chain_depth: 1,
    });
  });

  // The refusal names the run the contact is actually in, so the
  // operator reading the automation log can go look at it.
  it("refuses when the contact is already in a flow", async () => {
    h.state.activeRuns = [{ id: "run-old", flow_id: "flow-9" }];
    await expect(startFlowRun(INPUT)).resolves.toEqual({
      started: false,
      reason: "active_run_exists",
      flowRunId: "run-old",
    });
    expect(h.state.runInserts).toHaveLength(0);
  });

  // The index is the authority; the pre-check above is a courtesy. A
  // concurrent start must land on the same answer, not on an error.
  it("treats a unique-violation on insert as the same refusal", async () => {
    h.state.insertError = { message: 'duplicate key value violates "idx_one_active_run_per_contact"' };
    await expect(startFlowRun(INPUT)).resolves.toEqual({
      started: false,
      reason: "active_run_exists",
    });
  });

  it("refuses a flow that is not active", async () => {
    h.state.flow = activeFlow({ status: "draft" });
    await expect(startFlowRun(INPUT)).resolves.toEqual({
      started: false,
      reason: "flow_not_active",
    });
  });

  it("refuses a flow with no entry node", async () => {
    h.state.flow = activeFlow({ entry_node_id: null });
    await expect(startFlowRun(INPUT)).resolves.toEqual({
      started: false,
      reason: "flow_has_no_entry",
    });
  });

  // This runs on the service-role client, which bypasses RLS. A flow in
  // someone else's account must be indistinguishable from one that does
  // not exist, or the refusal becomes an existence oracle for ids.
  it("reports another account's flow as not found", async () => {
    h.state.flow = activeFlow({ account_id: "acct-2" });
    await expect(startFlowRun(INPUT)).resolves.toEqual({
      started: false,
      reason: "flow_not_found",
    });
  });

  it("refuses a contact from another account", async () => {
    h.state.contact = null;
    await expect(startFlowRun(INPUT)).resolves.toEqual({
      started: false,
      reason: "contact_not_in_account",
    });
  });

  it("refuses when there is no conversation to talk on", async () => {
    h.state.conversations = [];
    await expect(startFlowRun(INPUT)).resolves.toEqual({
      started: false,
      reason: "no_conversation",
    });
  });

  it("uses the conversation the caller handed it", async () => {
    await startFlowRun({ ...INPUT, conversationId: "conv-from-webhook" });
    expect(h.state.runInserts[0].conversation_id).toBe("conv-from-webhook");
  });

  // The active-run check cannot catch a flow that ENDS and restarts
  // itself, because at that instant there is no active run. The depth
  // counter is what stops it.
  it("stops a runaway chain at the ceiling", async () => {
    await expect(
      startFlowRun({ ...INPUT, chainDepth: MAX_FLOW_CHAIN_DEPTH }),
    ).resolves.toEqual({ started: false, reason: "max_chain_depth" });
    expect(h.state.runInserts).toHaveLength(0);
  });

  it("still starts one below the ceiling", async () => {
    const res = await startFlowRun({
      ...INPUT,
      chainDepth: MAX_FLOW_CHAIN_DEPTH - 1,
    });
    expect(res.started).toBe(true);
    expect(h.state.runInserts[0].vars).toEqual({
      _flow_chain_depth: MAX_FLOW_CHAIN_DEPTH,
    });
  });
});
