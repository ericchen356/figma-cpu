// Runs a PrototypePlan in JS exactly the way Figma runs a reaction's action list: actions in
// order, each SET_VARIABLE evaluating its expression against the current variable values
// (including those set by earlier actions in the same list).
import type { Expr, PlanAction, PrototypePlan } from "./types";

/** Variable values by net id. A Map or a plain record both work. */
export type PlanState = Map<number, boolean> | Record<number, boolean>;

function getter(state: PlanState): (n: number) => boolean {
  if (state instanceof Map)
    return (n) => {
      const v = state.get(n);
      if (v === undefined) throw new Error(`plan reads net ${n}, which has no variable`);
      return v;
    };
  return (n) => {
    const v = state[n];
    if (v === undefined) throw new Error(`plan reads net ${n}, which has no variable`);
    return v;
  };
}

function setter(state: PlanState): (n: number, v: boolean) => void {
  return state instanceof Map ? (n, v) => void state.set(n, v) : (n, v) => void (state[n] = v);
}

export function evalExpr(e: Expr, get: (n: number) => boolean): boolean {
  if ("var" in e) return get(e.var);
  if ("const" in e) return e.const === 1;
  if ("not" in e) return !evalExpr(e.not, get);
  if ("and" in e) return evalExpr(e.and[0], get) && evalExpr(e.and[1], get);
  if ("or" in e) return evalExpr(e.or[0], get) || evalExpr(e.or[1], get);
  if ("eq" in e) return evalExpr(e.eq[0], get) === evalExpr(e.eq[1], get);
  return evalExpr(e.neq[0], get) !== evalExpr(e.neq[1], get);
}

/** Executes an action list in place. Returns the number of actions executed (an `if` counts
 * 1 plus the branch it ran), the same cost model as `runFigmaActions`. */
export function runPlanActions(actions: PlanAction[], state: PlanState): number {
  const get = getter(state);
  const set = setter(state);
  let executed = 0;
  const run = (list: PlanAction[]) => {
    for (const a of list) {
      executed++;
      if ("set" in a) set(a.set, evalExpr(a.to, get));
      else run(evalExpr(a.if, get) ? a.then : (a.else ?? []));
    }
  };
  run(actions);
  return executed;
}

/** Runs one Step (the plan's tick) on `state`, in place; returns `state`. */
export function interpret<S extends PlanState>(plan: PrototypePlan, state: S, actions: PlanAction[] = plan.tick): S {
  runPlanActions(actions, state);
  return state;
}

/** The variables' (and flags') power-on values. */
export function initialState(plan: PrototypePlan): Map<number, boolean> {
  return new Map([...plan.variables, ...(plan.flags ?? [])].map((v) => [v.net, v.init]));
}

/** Runs one tick as the chunked prototype does, one chunk per event; returns the executed
 * actions of each chunk (without dispatch). Requires a plan made with maxActionsPerEvent. */
export function interpretChunked(plan: PrototypePlan, state: PlanState): number[] {
  if (!plan.chunking) throw new Error("plan has no chunking (plan with maxActionsPerEvent)");
  return plan.chunking.chunks.map((c) => runPlanActions(c, state));
}
