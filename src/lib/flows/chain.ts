// ============================================================
// Loop guard for the flow ↔ automation bridge.
//
// The bridge makes a cycle possible that neither engine could form on
// its own:
//
//   fluxo termina → nó set_tag → automação com gatilho tag_added
//     → passo start_flow → o MESMO fluxo → …
//
// While a run is active the cycle cannot close: `startFlowRun` refuses
// to start a second run for a contact that already has one. The hole is
// the flow that ENDS and restarts itself, which no active-run check
// catches because there is no active run at that instant.
//
// So the depth travels with the work. `startFlowRun` seeds
// `_flow_chain_depth` into the new run's `vars`; the `set_tag` node
// already passes `run.vars` into the automation context, so the counter
// crosses the bridge without either engine knowing about the other.
//
// Deliberately a mirror of `contacts/tag-chain.ts` rather than a shared
// abstraction: the two chains bound different things and will drift
// apart the first time one of them needs a different ceiling.
// ============================================================

/**
 * How many times a flow may be started by something a flow started.
 * Three is the same ceiling the tag chain uses: enough for the honest
 * compositions we have seen (cobrança → menu → confirmação), short
 * enough that a mistake costs three messages, not a day of them.
 */
export const MAX_FLOW_CHAIN_DEPTH = 3;

/**
 * Read the chain depth out of whatever the caller carries — an
 * automation context's `vars`, or a flow run's `vars`. Anything
 * unparseable reads as zero: a corrupt counter must not be able to
 * BLOCK a legitimate start, only fail to stop a runaway one, and the
 * active-run check is the backstop for that case.
 */
export function getFlowChainDepth(vars?: Record<string, unknown> | null): number {
  const raw = vars?._flow_chain_depth;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : 0;
}
