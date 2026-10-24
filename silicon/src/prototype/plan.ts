// Prototype planner: netlist + schedule → PrototypePlan (pure data). One boolean variable per
// net, one `set` action per scheduled gate evaluation, constants folded into the expressions.
import type { Schedule } from "../compile/types";
import { netId } from "../netlist/flatten";
import { type FlatGate, type FlatNetlist, NET0, NET1 } from "../netlist/types";
import type { Expr, PlanAction, PlanVariable, PrototypePlan } from "./types";

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
  const lowActs = low.order.flatMap(gateActs);
  const highActs = high.order.flatMap(gateActs);
  const tick: PlanAction[] = [{ set: clk, to: ZERO }, ...lowActs, { set: clk, to: ONE }, ...highActs];
  const reset: PlanAction[] = variables.map((v) => ({ set: v.net, to: lit(v.init) }));

  return {
    name: opts.name ?? "Silicon",
    variables,
    clk,
    ...(opts.halt !== undefined ? { halt: netId(net, opts.halt) } : {}),
    gateOut: net.gates.map((g) => g.out),
    tick,
    reset,
    stats: {
      gates: net.gates.length,
      variables: variables.length,
      actionsPerTick: countActions(tick),
      lowPass: countActions(lowActs),
      highPass: countActions(highActs),
      maxDepth: maxDepth(tick),
    },
  };
}
