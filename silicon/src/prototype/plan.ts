// Prototype planner: netlist + schedule → PrototypePlan (pure data). One boolean variable per
// net, one `set` action per scheduled gate evaluation, constants folded into the expressions.
import type { Schedule } from "../compile/types";
import { netId } from "../netlist/flatten";
import { type FlatGate, type FlatNetlist, NET0, NET1 } from "../netlist/types";
import { type GItem, gateSchedule } from "./gating";
import type { Chunking, Expr, PlanAction, PlanVariable, PrototypePlan } from "./types";

export interface PlanOptions {
  /** Power-on value per net id (e.g. `powerOnState(net)`, with RAM preloaded). */
  initial: Uint8Array;
  /** Variable collection name (default "Silicon"). */
  name?: string;
  /** Clock input name (default "CLK"). */
  clk?: string;
  /** Net that stops the Run loop when 1 (e.g. "HALTED"). */
  halt?: string;
  /** Avoid nested expressions: NAND/NOR become two actions (`y = a·b`, then `y = ¬y`).
   * Only needed if Figma rejects nested expressions; costs one action per such gate. */
  flat?: boolean;
  /** Clock gating (see gating.ts): skip latch groups that cannot change. Exact on every net. */
  gate?: boolean;
  /** Split the tick into chunks so no event executes more than this (see `Chunking`).
   * Default DEFAULT_MAX_ACTIONS_PER_EVENT (400); a tick that fits in one event is not
   * chunked. Infinity: never chunk. */
  maxActionsPerEvent?: number;
  /** Actions the last chunk's event needs for the tick counter/text (default 4). */
  tickExtra?: number;
}

// ---------- expressions (constant-folding constructors) ----------

const ZERO: Expr = { const: 0 };
const ONE: Expr = { const: 1 };

/** A net as an expression; the constant nets become literals. */
export function ref(net: number): Expr {
  return net === NET0 ? ZERO : net === NET1 ? ONE : { var: net };
}
export const lit = (v: boolean | 0 | 1): Expr => (v ? ONE : ZERO);
const sameVar = (a: Expr, b: Expr) => "var" in a && "var" in b && a.var === b.var;

export function not(e: Expr): Expr {
  if ("const" in e) return lit(!e.const);
  if ("not" in e) return e.not;
  return { not: e };
}
export function and(a: Expr, b: Expr): Expr {
  if ("const" in a) return a.const ? b : ZERO;
  if ("const" in b) return b.const ? a : ZERO;
  return sameVar(a, b) ? a : { and: [a, b] };
}
export function or(a: Expr, b: Expr): Expr {
  if ("const" in a) return a.const ? ONE : b;
  if ("const" in b) return b.const ? ONE : a;
  return sameVar(a, b) ? a : { or: [a, b] };
}
export function eq(a: Expr, b: Expr): Expr {
  if ("const" in a) return a.const ? b : not(b);
  if ("const" in b) return b.const ? a : not(a);
  return sameVar(a, b) ? ONE : { eq: [a, b] };
}
export function neq(a: Expr, b: Expr): Expr {
  if ("const" in a) return a.const ? not(b) : b;
  if ("const" in b) return b.const ? not(a) : a;
  return sameVar(a, b) ? ZERO : { neq: [a, b] };
}

/** The expression a gate computes from its input nets. */
export function gateExpr(g: Pick<FlatGate, "type" | "in">): Expr {
  const a = ref(g.in[0]);
  const b = g.in.length > 1 ? ref(g.in[1]) : ZERO;
  switch (g.type) {
    case "BUF":
      return a;
    case "NOT":
      return not(a);
    case "AND":
      return and(a, b);
    case "OR":
      return or(a, b);
    case "NAND":
      return not(and(a, b));
    case "NOR":
      return not(or(a, b));
    case "XOR":
      return neq(a, b);
    case "XNOR":
      return eq(a, b);
  }
}

/** Actions that set `out` to `e`. With `flat`, ¬(a ∘ b) is split into two flat actions. */
export function setActions(out: number, e: Expr, flat = false): PlanAction[] {
  if (flat && "not" in e && !("var" in e.not) && !("not" in e.not))
    return [
      { set: out, to: e.not },
      { set: out, to: { not: { var: out } } },
    ];
  return [{ set: out, to: e }];
}

export function exprDepth(e: Expr): number {
  if ("var" in e || "const" in e) return 0;
  if ("not" in e) return 1 + exprDepth(e.not);
  const [a, b] = "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
  return 1 + Math.max(exprDepth(a), exprDepth(b));
}

/** Number of prototype actions in a list (a conditional counts itself and its branches). */
export function countActions(list: PlanAction[]): number {
  let n = 0;
  for (const a of list) n += "set" in a ? 1 : 1 + countActions(a.then) + countActions(a.else ?? []);
  return n;
}

/** Most actions a list can execute: an `if` counts 1 plus its costlier branch. */
export function worstActions(list: PlanAction[]): number {
  let n = 0;
  for (const a of list) n += "set" in a ? 1 : 1 + Math.max(worstActions(a.then), worstActions(a.else ?? []));
  return n;
}

// ---------- chunking ----------

/** Default event budget: the viewer survived 501 actions per click and died at 2001 (spike v1). */
export const DEFAULT_MAX_ACTIONS_PER_EVENT = 400;

/** Whether a tick (worst case `worst` actions) needs chunking under `cap`: an unchunked event
 * is the tick, its tick counter (tickExtra) and a Run hop (2). */
export const needsChunks = (worst: number, cap: number, tickExtra = 4) => Number.isFinite(cap) && worst + tickExtra + 2 > cap;

/** Dispatch cost per event besides the chunk itself and the tick extra (see `Chunking`). */
export const dispatchOverhead = (chunks: number) => chunks + 5;

function planVars(e: Expr): number[] {
  if ("var" in e) return [e.var];
  if ("const" in e) return [];
  if ("not" in e) return planVars(e.not);
  const [a, b] = "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
  return [...planVars(a), ...planVars(b)];
}
function writes(list: PlanAction[], out = new Set<number>()): Set<number> {
  for (const a of list) {
    if ("set" in a) out.add(a.set);
    else {
      writes(a.then, out);
      writes(a.else ?? [], out);
    }
  }
  return out;
}

/** Splits a list into consecutive pieces of at most `budget` worst-case actions. An `if` that
 * is too big becomes several `if`s with the same condition, which is exact as long as no
 * piece but the last writes what the condition reads (checked). */
export function splitActions(list: PlanAction[], budget: number): PlanAction[][] {
  if (budget < 1) throw new Error(`chunk budget ${budget} is too small`);
  const out: PlanAction[][] = [];
  let cur: PlanAction[] = [];
  let w = 0;
  const add = (a: PlanAction, wa: number) => {
    if (w + wa > budget && cur.length) {
      out.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(a);
    w += wa;
  };
  for (const a of list) {
    const wa = worstActions([a]);
    if (wa <= budget || "set" in a) {
      add(a, wa);
      continue;
    }
    const thenP = splitActions(a.then, budget - 1);
    const elseP = a.else?.length ? splitActions(a.else, budget - 1) : [];
    const n = Math.max(thenP.length, elseP.length);
    // Align both branches at the end, so whatever a branch writes last is in the last piece.
    const at = (ps: PlanAction[][], j: number) => ps[j - (n - ps.length)] ?? [];
    const cond = new Set(planVars(a.if));
    for (let j = 0; j < n; j++) {
      const t = at(thenP, j);
      const e = at(elseP, j);
      if (j < n - 1 && [...writes([...t, ...e])].some((x) => cond.has(x)))
        throw new Error("cannot split a conditional whose body changes its own condition before its end");
      const piece: PlanAction = e.length ? { if: a.if, then: t, else: e } : { if: a.if, then: t };
      add(piece, worstActions([piece]));
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Chunks a tick for at most `maxActionsPerEvent` executed actions per event, dispatch included. */
export function chunkTick(tick: PlanAction[], o: { maxActionsPerEvent: number; tickExtra?: number }): Chunking {
  const cap = o.maxActionsPerEvent;
  const tickExtra = o.tickExtra ?? 4;
  for (let k = 1; ; k++) {
    const budget = cap - dispatchOverhead(k) - tickExtra;
    if (budget < 1) throw new Error(`maxActionsPerEvent ${cap} is too small for this tick: dispatching ${k} chunks leaves no room`);
    const chunks = splitActions(tick, budget);
    if (chunks.length > k) {
      k = chunks.length - 1;
      continue;
    }
    const perEvent = chunks.map((c, i) => worstActions(c) + dispatchOverhead(chunks.length) + (i === chunks.length - 1 ? tickExtra : 0));
    return { maxActionsPerEvent: cap, tickExtra, chunks, perEvent };
  }
}

function maxDepth(list: PlanAction[]): number {
  let d = 0;
  for (const a of list)
    d = Math.max(d, "set" in a ? exprDepth(a.to) : Math.max(exprDepth(a.if), maxDepth(a.then), maxDepth(a.else ?? [])));
  return d;
}

// ---------- names ----------

/** Figma variable name for a net. Figma reserves `.`, `{` and `}` (alias syntax) and treats
 * `/` as a group separator, so empty groups are squeezed out. */
export function varName(hier: string): string {
  const clean = hier
    .replace(/[.{}]/g, "_")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
  return `net/${clean || "_"}`;
}

// ---------- the plan ----------

export function plan(net: FlatNetlist, schedule: Schedule, opts: PlanOptions): PrototypePlan {
  const { initial } = opts;
  if (initial.length !== net.netNames.length) throw new Error(`initial has ${initial.length} values for ${net.netNames.length} nets`);
  const [low, high] = schedule.passes;
  if (low.clk !== 0 || high.clk !== 1) throw new Error("schedule must be [CLK=0 pass, CLK=1 pass]");
  const clk = netId(net, opts.clk ?? "CLK");

  // Every non-constant net that a gate or a top port touches gets a variable.
  const used = new Set<number>([clk]);
  for (const g of net.gates) {
    used.add(g.out);
    for (const n of g.in) used.add(n);
  }
  for (const p of net.ports) for (const n of p.nets) used.add(n);
  used.delete(NET0);
  used.delete(NET1);
  const taken = new Set<string>();
  const variables: PlanVariable[] = [...used]
    .sort((a, b) => a - b)
    .map((n) => {
      let name = varName(net.netNames[n]);
      for (let k = 2; taken.has(name); k++) name = `${varName(net.netNames[n])}~${k}`;
      taken.add(name);
      return { net: n, name, init: initial[n] === 1 };
    });

  const gateActs = (gi: number): PlanAction[] => {
    const g = net.gates[gi];
    if (!g) throw new Error(`schedule refers to gate ${gi}, netlist has ${net.gates.length}`);
    return setActions(g.out, gateExpr(g), opts.flat);
  };
  // With gating, each pass is a tree of gate evaluations and guarded blocks.
  const gating = opts.gate ? gateSchedule(net, schedule) : null;
  const items = (list: GItem[]): PlanAction[] =>
    list.flatMap((it): PlanAction[] =>
      typeof it === "number"
        ? gateActs(it)
        : [{ if: it.guard, then: [...items(it.items), ...(it.setFlag ? [{ set: it.setFlag.id, to: lit(it.setFlag.value) }] : [])] }],
    );
  const lowActs = gating ? items(gating.passes[0]) : low.order.flatMap(gateActs);
  const highActs = gating ? items(gating.passes[1]) : high.order.flatMap(gateActs);
  const tick: PlanAction[] = [{ set: clk, to: ZERO }, ...lowActs, { set: clk, to: ONE }, ...highActs];
  const flags: PlanVariable[] = (gating?.flags ?? []).map((id, k) => ({ net: id, name: `gate/dirty/${k}`, init: false }));
  const reset: PlanAction[] = [...variables, ...flags].map((v) => ({ set: v.net, to: lit(v.init) }));
  const cap = opts.maxActionsPerEvent ?? DEFAULT_MAX_ACTIONS_PER_EVENT;
  const chunking = needsChunks(worstActions(tick), cap, opts.tickExtra) ? chunkTick(tick, { maxActionsPerEvent: cap, tickExtra: opts.tickExtra }) : undefined;

  return {
    name: opts.name ?? "Silicon",
    variables,
    flags,
    clk,
    ...(opts.halt !== undefined ? { halt: netId(net, opts.halt) } : {}),
    gateOut: net.gates.map((g) => g.out),
    tick,
    reset,
    ...(Number.isFinite(cap) ? { maxActionsPerEvent: cap } : {}),
    ...(chunking ? { chunking } : {}),
    stats: {
      gates: net.gates.length,
      variables: variables.length,
      actionsPerTick: countActions(tick),
      lowPass: countActions(lowActs),
      highPass: countActions(highActs),
      maxDepth: maxDepth(tick),
      worstCase: worstActions(tick),
      gatedBlocks: gating?.blocks ?? 0,
      ...(chunking ? { chunks: chunking.chunks.length, maxEvent: Math.max(...chunking.perEvent) } : {}),
    },
  };
}
