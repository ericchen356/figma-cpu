// Audit of a built silicon file, from the Figma REST API's JSON (GET /v1/files/:key/nodes?ids=<page>, or a whole
// file). Read-only and offline: it tells you, without opening Figma, whether
//   · the gates drawn in the file add up to the gates the code builds (the file ≡ the code), and
//   · every prototype event (Step / Run / Reset buttons, AFTER_TIMEOUT hops) is within the action budget the
//     viewer survives (it died at 2001 actions per event in the team's spike, and was fine at 501).
import { isGateCell, gateTypeOf } from "../netlist/types";

export interface RestNode {
  id: string;
  name: string;
  type: string;
  componentId?: string;
  children?: RestNode[];
  interactions?: RestInteraction[];
  /** Variable bindings, e.g. `{ visible: { type: "VARIABLE_ALIAS", id: "VariableID:1:2" } }`. */
  boundVariables?: Record<string, unknown>;
  /** CANVAS only: the prototype flows (▶ Present). */
  flowStartingPoints?: Array<{ nodeId: string; name: string }>;
}
export interface RestInteraction {
  trigger?: { type?: string; timeout?: number };
  actions?: RestAction[];
}
export interface RestAction {
  type: string;
  conditionalBlocks?: Array<{ condition?: unknown; actions?: RestAction[] }>;
  /** NODE actions: the frame navigated to. */
  destinationId?: string | null;
  navigation?: string;
  /** SET_VARIABLE actions. */
  variableId?: string;
  variableValue?: unknown;
}
export interface AuditInput {
  /** The page(s) or frame(s) to audit. */
  roots: RestNode[];
  /** Component id → name (the REST payload's `components`, merged over all nodes). */
  components: Record<string, { name: string }>;
}

/** Accepts `{ nodes: { id: { document, components } } }` (nodes endpoint) or `{ document, components }` (file endpoint). */
export function parseRest(json: any): AuditInput {
  const roots: RestNode[] = [];
  const components: Record<string, { name: string }> = {};
  if (json?.nodes) {
    for (const n of Object.values<any>(json.nodes)) {
      if (n?.document) roots.push(n.document);
      Object.assign(components, n?.components ?? {});
    }
  } else if (json?.document) {
    roots.push(json.document);
    Object.assign(components, json.components ?? {});
  } else throw new Error("not a Figma REST payload (no .nodes or .document)");
  return { roots, components };
}

/** Worst-case actions one event executes: a CONDITIONAL counts 1 plus its costliest block (same rule as the planner). */
export function worstCase(actions: readonly RestAction[] | undefined): number {
  let n = 0;
  for (const a of actions ?? []) n += a.type === "CONDITIONAL" ? 1 + Math.max(0, ...(a.conditionalBlocks ?? []).map((b) => worstCase(b.actions))) : 1;
  return n;
}

type RestExpr = { expressionFunction?: string; expressionArguments?: Array<{ type?: string; value?: unknown }> };
/** `v == k` for a variable alias and a number literal, or an AND whose operand is one (the flat Run hop gates each case on ctl/go). */
function equalsCase(e: RestExpr | undefined): { v: string; k: number } | null {
  if (!e) return null;
  if (e.expressionFunction === "AND") {
    for (const arg of e.expressionArguments ?? []) {
      const inner = arg?.type === "EXPRESSION" ? equalsCase(arg.value as RestExpr) : null;
      if (inner) return inner;
    }
    return null;
  }
  if (e.expressionFunction !== "EQUALS" || e.expressionArguments?.length !== 2) return null;
  const [x, y] = e.expressionArguments;
  const alias = (x?.value as { type?: string; id?: unknown } | undefined) ?? undefined;
  const v = alias?.type === "VARIABLE_ALIAS" && typeof alias.id === "string" ? alias.id : x?.type === "VARIABLE_ALIAS" && typeof (x as { id?: unknown }).id === "string" ? ((x as { id: string }).id) : undefined;
  return v && typeof y?.value === "number" ? { v, k: y.value } : null;
}
/** `if v == k` with no else: one case of apply()'s chunk dispatcher (v a variable, k a number literal). */
function dispatchCase(a: RestAction): { v: string; k: number } | null {
  if (a.type !== "CONDITIONAL" || a.conditionalBlocks?.length !== 1) return null;
  const c = a.conditionalBlocks[0].condition as { type?: string; value?: RestExpr } | undefined;
  return c?.type === "EXPRESSION" ? equalsCase(c.value) : null;
}
const writesVar = (acts: readonly RestAction[] | undefined, v: string): boolean =>
  (acts ?? []).some((a) => a.variableId === v || (a.conditionalBlocks ?? []).some((b) => writesVar(b.actions, v)));

/** Actions one event can execute, knowing apply()'s chunk dispatcher: consecutive `if v == k` cases on the same
 * variable with distinct k are mutually exclusive (one runs), so a run of K of them costs K (each condition) plus
 * the costliest case, not their sum. A case whose block writes v ends its run (a later case could then fire too, so
 * those are summed). Anything else counts as in `worstCase`. This is the budget apply() checks (1 + K + chunk). */
export function eventWorst(actions: readonly RestAction[] | undefined): number {
  const acts = actions ?? [];
  let n = 0;
  for (let i = 0; i < acts.length; ) {
    const c = dispatchCase(acts[i]);
    if (c) {
      const ks = new Set<number>();
      let max = 0;
      let j = i;
      for (; j < acts.length; j++) {
        const d = dispatchCase(acts[j]);
        if (!d || d.v !== c.v || ks.has(d.k)) break;
        ks.add(d.k);
        const blk = acts[j].conditionalBlocks![0].actions;
        max = Math.max(max, eventWorst(blk));
        if (writesVar(blk, c.v)) {
          j++;
          break;
        }
      }
      n += ks.size + max;
      i = j;
      continue;
    }
    const a = acts[i++];
    n += a.type === "CONDITIONAL" ? 1 + Math.max(0, ...(a.conditionalBlocks ?? []).map((b) => eventWorst(b.actions))) : 1;
  }
  return n;
}

export type Level = "ok" | "risky" | "crash";
/** ≤ cap fine (the viewer survived 501); up to 2000 unproven; ≥ 2001 it died. */
export function levelOf(worst: number, cap: number): Level {
  return worst <= cap ? "ok" : worst < 2001 ? "risky" : "crash";
}

export interface EventReport {
  node: string;
  /** Top-level frame (child of the page) the reacting layer sits in, or the layer itself. */
  frame?: string;
  trigger: string;
  actions: number;
  worst: number;
  level: Level;
}

function walk(n: RestNode, f: (n: RestNode) => void) {
  f(n);
  for (const c of n.children ?? []) walk(c, f);
}

/** Every reaction in the roots: buttons and frames with interactions. */
export function events(input: AuditInput, cap: number): EventReport[] {
  const out: EventReport[] = [];
  const visit = (n: RestNode, top: RestNode | undefined) => {
    for (const i of n.interactions ?? []) {
      const worst = eventWorst(i.actions);
      if (!worst) continue;
      out.push({ node: n.name, frame: (top ?? n).name, trigger: i.trigger?.type ?? "?", actions: i.actions?.length ?? 0, worst, level: levelOf(worst, cap) });
    }
    for (const c of n.children ?? []) visit(c, top ?? (n.type === "CANVAS" || n.type === "DOCUMENT" ? undefined : n));
  };
  for (const r of input.roots) visit(r, undefined);
  return out;
}

/** Leaf gates by type, expanded from the component named `top` through every instance. */
export function expandGates(input: AuditInput, top: string): { byType: Record<string, number>; total: number; missing: string[] } {
  const defs = new Map<string, RestNode>();
  for (const r of input.roots) walk(r, (n) => n.type === "COMPONENT" && !defs.has(n.name) && defs.set(n.name, n));
  const memo = new Map<string, Record<string, number>>();
  const missing = new Set<string>();
  const nameOf = (i: RestNode) => (i.componentId ? input.components[i.componentId]?.name : undefined);
  const count = (name: string, depth = 0): Record<string, number> => {
    const hit = memo.get(name);
    if (hit) return hit;
    if (depth > 40) throw new Error(`component recursion deeper than 40 at ${name}`);
    const def = defs.get(name);
    const acc: Record<string, number> = {};
    if (!def) missing.add(name);
    else {
      const visit = (n: RestNode) => {
        for (const c of n.children ?? []) {
          if (c.type === "INSTANCE") {
            const cn = nameOf(c);
            if (!cn) missing.add(`instance ${c.name} (${c.componentId})`);
            else if (isGateCell(cn)) acc[gateTypeOf(cn)] = (acc[gateTypeOf(cn)] ?? 0) + 1;
            else for (const [k, v] of Object.entries(count(cn, depth + 1))) acc[k] = (acc[k] ?? 0) + v;
          } else visit(c);
        }
      };
      visit(def);
    }
    memo.set(name, acc);
    return acc;
  };
  const byType = count(top);
  return { byType, total: Object.values(byType).reduce((a, b) => a + b, 0), missing: [...missing] };
}

export interface Audit {
  cap: number;
  gates: { drawn: Record<string, number>; expected: Record<string, number>; drawnTotal: number; expectedTotal: number; matches: boolean; diffs: string[]; missing: string[] };
  events: EventReport[];
  worst: EventReport | null;
  rebuildNeeded: boolean;
  text: string;
}

export function audit(input: AuditInput, expectedGates: Record<string, number>, cap = 400, top = "cell/CPU"): Audit {
  const drawn = expandGates(input, top);
  const diffs: string[] = [];
  for (const k of new Set([...Object.keys(drawn.byType), ...Object.keys(expectedGates)]).values()) {
    const a = drawn.byType[k] ?? 0, b = expectedGates[k] ?? 0;
    if (a !== b) diffs.push(`${k}: drawn ${a}, code ${b}`);
  }
  const expectedTotal = Object.values(expectedGates).reduce((a, b) => a + b, 0);
  const ev = events(input, cap);
  const worst = ev.reduce<EventReport | null>((w, e) => (!w || e.worst > w.worst ? e : w), null);
  const bad = ev.filter((e) => e.level !== "ok");
  const matches = diffs.length === 0 && drawn.missing.length === 0 && drawn.total > 0;
  const lines = [
    `gates: ${drawn.total} drawn in ${top}, ${expectedTotal} built by the code → ${matches ? "✓ identical by type" : "✗ " + (diffs.concat(drawn.missing.map((m) => `missing ${m}`)).join("; ") || "nothing drawn")}`,
    `events (cap ${cap}): ${ev.length} reactions, worst ${worst ? `${worst.worst} (${worst.node} ${worst.trigger})` : "none"}`,
    ...bad.map((e) => `  ${e.level === "crash" ? "✗ CRASH" : "⚠ risky"}: ${e.node} ${e.trigger} runs ${e.worst} actions in one event${e.level === "crash" ? " (the viewer died at 2001)" : ""}`),
    bad.length ? "→ REBUILD: run Compile with the current plugin (chunked Step and Reset)" : "✓ every event within the cap",
  ];
  return { cap, gates: { drawn: drawn.byType, expected: expectedGates, drawnTotal: drawn.total, expectedTotal, matches, diffs, missing: drawn.missing }, events: ev, worst, rebuildNeeded: bad.length > 0, text: lines.join("\n") };
}
