// "Did the first run build correctly?", answered from the outside: a Figma REST dump of the silicon page (we cannot
// open Figma, but we can read the file back). On top of `audit()` (gates drawn ≡ gates built, every event ≤ the cap)
// it checks, with named pass / fail / warn results:
//   · reactions: the graph of NODE navigations from every reaction (clicks, AFTER_TIMEOUT hops, nested conditionals):
//     Step is a single click within the cap; Run A ⇄ Run B closes and returns to Control; each Reset button's chain
//     visits only Reset hop frames, returns to ITS OWN home frame (Control, or CPU · Step for the Step header's button)
//     and can always exit; every event on the way is ≤ cap (counted by `eventWorst`: apply()'s chunk dispatcher runs
//     one case per event, so a chunked Step costs 1 + K + its biggest chunk, not the whole tick). A Reset whose one click is over the cap is the legacy
//     (unchunked) build: rebuild.
//   · frames and flows (▶ Present must offer Control and CPU · Step),
//   · `lit` bindings: every gate of cell/CPU, the front panel, its 128-lamp MEM matrix,
//   · variables: distinct ids used by actions and bindings vs the wires the code builds.
// Names mirror plugin/src/app.ts (NAME "CPU"), plugin/src/canvas.ts (STEP_FRAME, stepResetName) and
// plugin/src/panel.ts (PANEL_NAME, `lamp/<net>` with a child `lit`); they are restated here so the auditor does not
// import plugin code.
import { ramBit } from "../cpu/probes";
import { RAM_BYTES } from "../isa/spec";
import { isGateCell } from "../netlist/types";
import { audit, eventWorst, type Audit, type AuditInput, type RestAction, type RestNode } from "./audit";

export const STEP_FRAME = "CPU · Step";
export const PANEL_NAME = "Silicon · Front panel";
export const MEM_LAMPS = RAM_BYTES * 8;

export function frameNames(plan = "CPU") {
  return {
    control: `${plan} · Control`,
    runA: `${plan} · Run A`,
    runB: `${plan} · Run B`,
    resetA: `${plan} · Reset A`,
    resetB: `${plan} · Reset B`,
    resetAStep: `${plan} · Reset A (Step)`,
    resetBStep: `${plan} · Reset B (Step)`,
    step: STEP_FRAME,
  };
}

/** The 128 MEM matrix lamp names: `lamp/ram/row<addr>/b<bit>/Q`. */
export function memLampNames(): string[] {
  const out: string[] = [];
  for (let a = 0; a < RAM_BYTES; a++) for (let b = 7; b >= 0; b--) out.push(`lamp/${ramBit(a, b)}`);
  return out;
}

export type Status = "pass" | "fail" | "warn";
export interface Check {
  id: string;
  title: string;
  status: Status;
  message: string;
  details?: string[];
}

export interface BuildExpected {
  /** Gates by type, as the code builds them. */
  gates: Record<string, number>;
  /** Variables for wires the code builds (plan.variables, i.e. every non-constant net a gate or port touches). */
  wires?: number;
}

export interface BuildAuditOptions {
  cap?: number;
  /** Top component of the circuit (default cell/CPU). */
  top?: string;
  /** Plan name (default "CPU"). */
  plan?: string;
}

export interface ResetChain {
  button: string;
  home: string;
  /** Actions of the click itself (worst case). */
  click: number;
  chunked: boolean;
  hops: string[];
  exits: string[];
  worstHop: number;
}

export interface BuildAudit extends Audit {
  checks: Check[];
  /** No check failed. */
  ready: boolean;
  /** A Reset (or Step) button runs its whole job in one click over the cap: built by the old plugin. */
  legacy: boolean;
  verdict: string;
  reactions: { step: Array<{ button: string; frame: string; worst: number }>; run: { hops: Record<string, number>; edges: Record<string, string[]> }; resets: ResetChain[] };
  bindings: {
    litTotal: number;
    litBound: number;
    gates: { instances: number; bound: number; unbound: string[] };
    /** Wire lit layers (`wire/<net>/lit`): in the whole page, and inside the top component. */
    wires: { layers: number; bound: number; inTop: { layers: number; bound: number } };
    panel: { lamps: number; bound: number; unbound: string[]; instances: Array<{ frame: string; lamps: number; bound: number }> };
    mem: { present: number; bound: number; missing: string[]; unbound: string[] };
  };
  variables: { distinct: number; wires: number; control: number; unwrittenWires: number; roles: Record<string, string[]>; expectedWires?: number };
}

const isAlias = (v: unknown): v is { type: "VARIABLE_ALIAS"; id: string } =>
  !!v && typeof v === "object" && (v as { type?: unknown }).type === "VARIABLE_ALIAS" && typeof (v as { id?: unknown }).id === "string";
const visibleAlias = (n: RestNode | undefined): string | undefined => {
  const v = n?.boundVariables?.visible;
  return isAlias(v) ? v.id : undefined;
};
const isLitLayer = (n: RestNode) => n.name === "lit" || (n.name.startsWith("wire/") && n.name.endsWith("/lit"));
const LAMP_RE = /^(?:lamp|seg)\//;
const RESET_HOP_RE = / · Reset [AB](?: \(Step\))?$/;

/** NODE destinations anywhere in an action list (nested conditional blocks included). */
export function destinations(actions: readonly RestAction[] | undefined, out: string[] = []): string[] {
  for (const a of actions ?? []) {
    if (a.type === "NODE" && a.destinationId) out.push(a.destinationId);
    if (a.type === "CONDITIONAL") for (const b of a.conditionalBlocks ?? []) destinations(b.actions, out);
  }
  return out;
}

interface Ev {
  node: RestNode;
  top: RestNode;
  trigger: string;
  actions: RestAction[];
  worst: number;
  dests: string[];
}

interface Index {
  byId: Map<string, RestNode>;
  topOf: Map<string, RestNode>;
  tops: Map<string, RestNode>;
  flows: Array<{ nodeId: string; name: string }>;
  events: Ev[];
  evByNode: Map<string, Ev[]>;
}

function index(input: AuditInput): Index {
  const byId = new Map<string, RestNode>();
  const topOf = new Map<string, RestNode>();
  const tops = new Map<string, RestNode>();
  const flows: Array<{ nodeId: string; name: string }> = [];
  const events: Ev[] = [];
  const evByNode = new Map<string, Ev[]>();
  const visit = (n: RestNode, top: RestNode | undefined) => {
    byId.set(n.id, n);
    const t = top ?? n;
    if (!top && n.type !== "CANVAS" && n.type !== "DOCUMENT" && !tops.has(n.name)) tops.set(n.name, n);
    if (n.type !== "CANVAS" && n.type !== "DOCUMENT") topOf.set(n.id, t);
    flows.push(...(n.flowStartingPoints ?? []));
    for (const i of n.interactions ?? []) {
      const actions = i.actions ?? [];
      const e: Ev = { node: n, top: t, trigger: i.trigger?.type ?? "?", actions, worst: eventWorst(actions), dests: destinations(actions) };
      events.push(e);
      const l = evByNode.get(n.id);
      if (l) l.push(e);
      else evByNode.set(n.id, [e]);
    }
    const childTop = n.type === "CANVAS" || n.type === "DOCUMENT" ? undefined : t;
    for (const c of n.children ?? []) visit(c, childTop);
  };
  for (const r of input.roots) visit(r, undefined);
  return { byId, topOf, tops, flows, events, evByNode };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const some = (xs: string[], k = 8) => (xs.length <= k ? xs.join(", ") : `${xs.slice(0, k).join(", ")} … (+${xs.length - k})`);

export function auditBuild(input: AuditInput, expected: BuildExpected, opts: BuildAuditOptions = {}): BuildAudit {
  const cap = opts.cap ?? 400;
  const top = opts.top ?? "cell/CPU";
  const F = frameNames(opts.plan);
  const base = audit(input, expected.gates, cap, top);
  const ix = index(input);
  const checks: Check[] = [];
  const add = (id: string, title: string, status: Status, message: string, details?: string[]) =>
    checks.push({ id, title, status, message, ...(details && details.length ? { details } : {}) });
  const nameOfId = (id: string) => ix.byId.get(id)?.name ?? `unknown node ${id}`;
  const frame = (name: string) => ix.tops.get(name);
  const timeouts = (f: RestNode) => (ix.evByNode.get(f.id) ?? []).filter((e) => e.trigger === "AFTER_TIMEOUT");
  const clickOf = (b: RestNode) => (ix.evByNode.get(b.id) ?? []).find((e) => e.trigger === "ON_CLICK");
  const buttons = (name: string) => ix.events.filter((e) => e.node.name === name && e.trigger === "ON_CLICK").map((e) => e.node);
  const destTop = (id: string) => ix.topOf.get(id) ?? ix.byId.get(id);
  let legacy = false;

  // ── 1. gates (from audit()) ──
  const g = base.gates;
  add(
    "gates",
    "gates drawn = gates built",
    g.matches ? "pass" : "fail",
    g.matches
      ? `${fmt(g.drawnTotal)} gates in ${top}, identical by type to the code`
      : `${fmt(g.drawnTotal)} drawn vs ${fmt(g.expectedTotal)} built: ${g.diffs.concat(g.missing.map((m) => `missing ${m}`)).join("; ") || "nothing drawn"}`,
  );

  // ── 2. frames and flows ──
  const control = frame(F.control);
  const runA = frame(F.runA);
  const runB = frame(F.runB);
  const stepFrame = frame(F.step);
  const resetButtons = buttons("button/Reset");
  const chunkedReset = resetButtons.some((b) => (clickOf(b)?.dests.length ?? 0) > 0);
  const required = [F.control, F.runA, F.runB, F.step];
  if (chunkedReset || frame(F.resetA) || frame(F.resetB)) required.push(F.resetA, F.resetB);
  if ((chunkedReset || frame(F.resetA)) && stepFrame) required.push(F.resetAStep, F.resetBStep);
  const missingFrames = required.filter((n) => !frame(n));
  add(
    "frames",
    "frames",
    missingFrames.length ? "fail" : "pass",
    missingFrames.length ? `missing ${missingFrames.join(", ")}` : `${required.length} frames present (${required.join(", ")})`,
  );
  const flowIds = new Set(ix.flows.map((f) => f.nodeId));
  const wantFlows = [control, stepFrame].filter((f): f is RestNode => !!f);
  const noFlow = [F.control, F.step].filter((n) => !frame(n) || !flowIds.has(frame(n)!.id));
  add(
    "flows",
    "flow starting points",
    noFlow.length ? "fail" : "pass",
    noFlow.length
      ? `no flow starts at ${noFlow.join(", ")} (flows: ${ix.flows.map((f) => `"${f.name}" → ${nameOfId(f.nodeId)}`).join(", ") || "none"})`
      : `▶ Present offers ${wantFlows.map((f) => f.name).join(" and ")} (${ix.flows.length} flow${ix.flows.length === 1 ? "" : "s"})`,
  );

  // ── 3. reactions ──
  // Step: one click, one event within the cap, no navigation.
  const stepButtons = ix.events.filter((e) => /^button\/Step\b/.test(e.node.name));
  const stepRep = stepButtons.map((e) => ({ button: `${e.node.name} ${e.trigger}`, frame: e.top.name, worst: e.worst }));
  {
    const issues: string[] = [];
    const plain = buttons("button/Step");
    if (!plain.length) issues.push("no button/Step with an ON_CLICK");
    for (const b of plain) {
      const evs = ix.evByNode.get(b.id) ?? [];
      if (evs.length !== 1) issues.push(`${b.name} in ${ix.topOf.get(b.id)?.name} has ${evs.length} reactions (expected one click)`);
    }
    for (const e of stepButtons) {
      if (e.worst > cap) issues.push(`${e.node.name} in ${e.top.name}: one ${e.trigger} runs ${fmt(e.worst)} actions (cap ${cap}): unchunked tick`);
      if (e.dests.length) issues.push(`${e.node.name} in ${e.top.name} navigates to ${e.dests.map(nameOfId).join(", ")}`);
    }
    if (stepButtons.some((e) => e.worst > cap)) legacy = true;
    const worst = Math.max(0, ...stepButtons.map((e) => e.worst));
    add("step", "Step is one click within the cap", issues.length ? "fail" : "pass", issues.length ? issues[0] : `${plain.length} Step button(s), ≤ ${fmt(worst)} actions per click`, issues.slice(1));
  }

  // Run loop: Run → Run A; Run A ⇄ Run B by AFTER_TIMEOUT; both can exit to Control; every hop ≤ cap.
  const runHops: Record<string, number> = {};
  const runEdges: Record<string, string[]> = {};
  {
    const issues: string[] = [];
    if (!runA || !runB || !control) issues.push(`missing ${[!control && F.control, !runA && F.runA, !runB && F.runB].filter(Boolean).join(", ")}`);
    else {
      const runs = buttons("button/Run");
      if (!runs.length) issues.push("no button/Run");
      for (const b of runs) {
        const d = clickOf(b)!.dests.map((id) => destTop(id)?.name ?? id);
        if (d.length !== 1 || d[0] !== F.runA) issues.push(`${b.name} in ${ix.topOf.get(b.id)?.name} goes to ${d.join(", ") || "nowhere"}, expected ${F.runA}`);
      }
      for (const [self, other] of [
        [runA, runB],
        [runB, runA],
      ] as const) {
        const t = timeouts(self);
        if (!t.length) {
          issues.push(`${self.name} has no AFTER_TIMEOUT hop: the loop stops there`);
          continue;
        }
        const d = new Set(t.flatMap((e) => e.dests.map((id) => destTop(id)?.name ?? id)));
        runEdges[self.name] = [...d];
        runHops[self.name] = Math.max(...t.map((e) => e.worst));
        if (!d.has(other.name)) issues.push(`${self.name} never hops to ${other.name}: the loop does not close`);
        if (!d.has(control.name)) issues.push(`${self.name} never returns to ${control.name}: Run cannot stop`);
        const stray = [...d].filter((n) => n !== other.name && n !== control.name);
        if (stray.length) issues.push(`${self.name} also goes to ${stray.join(", ")}`);
        for (const e of t) if (e.worst > cap) issues.push(`${self.name} hop runs ${fmt(e.worst)} actions in one event (cap ${cap})`);
      }
    }
    if (Object.values(runHops).some((w) => w > cap)) legacy = true;
    add(
      "run",
      "Run loop closes and returns to Control",
      issues.length ? "fail" : "pass",
      issues.length ? issues[0] : `${F.runA} ⇄ ${F.runB}, exit to ${F.control}, ≤ ${fmt(Math.max(0, ...Object.values(runHops)))} actions per hop`,
      issues.slice(1),
    );
  }

  // Reset chains, one per Reset button, each home = the top frame the button sits in.
  const resets: ResetChain[] = [];
  if (!resetButtons.length) add("reset", "Reset", "fail", "no button/Reset with an ON_CLICK");
  for (const b of resetButtons) {
    const home = ix.topOf.get(b.id)!;
    const click = clickOf(b)!;
    const issues: string[] = [];
    const chain: ResetChain = { button: b.name, home: home.name, click: click.worst, chunked: click.dests.length > 0, hops: [], exits: [], worstHop: 0 };
    const hopFamily = home.name === F.step ? [F.resetAStep, F.resetBStep] : home.name === F.control ? [F.resetA, F.resetB] : [];
    if (click.worst > cap) {
      legacy = true;
      issues.push(`one click runs ${fmt(click.worst)} actions (cap ${cap}${click.worst >= 2001 ? "; the viewer died at 2,001" : ""}): unchunked legacy Reset, rebuild with Compile`);
    }
    if (click.dests.length > 1) issues.push(`the click navigates to ${click.dests.length} places (${click.dests.map(nameOfId).join(", ")})`);
    if (click.dests.length) {
      // Walk the hop graph from the click's destination until home.
      const seen = new Set<string>();
      const edges = new Map<string, Set<string>>();
      const queue = click.dests.map((id) => destTop(id)).filter((n): n is RestNode => !!n);
      if (queue.length < click.dests.length) issues.push(`the click navigates to an unknown node`);
      while (queue.length) {
        const f = queue.shift()!;
        if (f.id === home.id || seen.has(f.id)) continue;
        seen.add(f.id);
        chain.hops.push(f.name);
        if (!RESET_HOP_RE.test(f.name)) {
          issues.push(`the chain visits ${f.name}, which is not a Reset hop frame`);
          continue;
        }
        if (hopFamily.length && !hopFamily.includes(f.name)) issues.push(`the chain from ${home.name} uses ${f.name} (expected ${hopFamily.join(" / ")})`);
        const t = timeouts(f);
        if (!t.length) {
          issues.push(`${f.name} has no AFTER_TIMEOUT hop: the reset stops there`);
          continue;
        }
        const out = new Set<string>();
        for (const e of t) {
          chain.worstHop = Math.max(chain.worstHop, e.worst);
          if (e.worst > cap) issues.push(`${f.name} hop runs ${fmt(e.worst)} actions in one event (cap ${cap})`);
          if (!e.dests.length) issues.push(`${f.name} hop navigates nowhere: the reset stops there`);
          for (const id of e.dests) {
            const d = destTop(id);
            if (!d) {
              issues.push(`${f.name} navigates to unknown node ${id}`);
              continue;
            }
            out.add(d.id);
            if (d.id === home.id) {
              if (!chain.exits.includes(f.name)) chain.exits.push(f.name);
            } else if (RESET_HOP_RE.test(d.name)) queue.push(d);
            else issues.push(`${f.name} returns to ${d.name}, not to ${home.name} (the frame its Reset button is on)`);
          }
        }
        edges.set(f.id, out);
      }
      // Termination: from every hop frame reached, home must be reachable (no cycle without an exit).
      const reachesHome = (from: string) => {
        const s = new Set<string>();
        const q = [from];
        while (q.length) {
          const x = q.pop()!;
          if (x === home.id) return true;
          if (s.has(x)) continue;
          s.add(x);
          for (const y of edges.get(x) ?? []) q.push(y);
        }
        return false;
      };
      const trapped = [...seen].filter((id) => !reachesHome(id)).map(nameOfId);
      if (trapped.length) issues.push(`no way back to ${home.name} from ${trapped.join(", ")}: a cycle with no exit`);
    }
    resets.push(chain);
    const what = chain.chunked ? `${chain.hops.join(" ⇄ ")} → back to ${home.name}, ≤ ${fmt(Math.max(chain.click, chain.worstHop))} actions per event` : `one click of ${fmt(chain.click)} actions`;
    add(`reset:${home.name}`, `Reset on ${home.name}`, issues.length ? "fail" : "pass", issues.length ? issues[0] : what, issues.slice(1));
  }

  // Every event within the cap (the whole file, incl. Stop, keys, extra buttons).
  {
    const bad = base.events.filter((e) => e.level !== "ok");
    add(
      "events",
      `every event ≤ ${cap} actions`,
      bad.length ? "fail" : "pass",
      bad.length
        ? `${bad.length} of ${base.events.length} events over the cap, worst ${fmt(base.worst!.worst)} (${base.worst!.node} ${base.worst!.trigger} in ${base.worst!.frame})`
        : `${base.events.length} reactions, worst ${base.worst ? `${fmt(base.worst.worst)} (${base.worst.node} ${base.worst.trigger})` : "none"}`,
      bad.map((e) => `${e.level === "crash" ? "CRASH" : "risky"}: ${e.node} ${e.trigger} in ${e.frame} runs ${fmt(e.worst)}`),
    );
  }

  // ── 4. bindings ──
  let litTotal = 0;
  let litBound = 0;
  let wireLayers = 0;
  let wireBound = 0;
  const walk = (n: RestNode, f: (n: RestNode) => void) => {
    f(n);
    for (const c of n.children ?? []) walk(c, f);
  };
  for (const r of input.roots)
    walk(r, (n) => {
      if (!isLitLayer(n)) return;
      litTotal++;
      if (visibleAlias(n)) litBound++;
      if (n.name !== "lit") {
        wireLayers++;
        if (visibleAlias(n)) wireBound++;
      }
    });
  // Gates: every gate instance (expanded) under the top component has a bound `lit`.
  const gateB = { instances: 0, bound: 0, unbound: [] as string[] };
  const cpuWires = { layers: 0, bound: 0 };
  const cpu = [...ix.byId.values()].find((n) => n.type === "COMPONENT" && n.name === top);
  if (cpu)
    walk(cpu, (n) => {
      if (isLitLayer(n) && n.name !== "lit") {
        cpuWires.layers++;
        if (visibleAlias(n)) cpuWires.bound++;
      }
      if (n.type !== "INSTANCE" || !n.componentId) return;
      const cn = input.components[n.componentId]?.name;
      if (!cn || !isGateCell(cn)) return;
      gateB.instances++;
      const lit = n.children?.find((c) => c.name === "lit");
      if (visibleAlias(lit)) gateB.bound++;
      else gateB.unbound.push(`${n.name} (${n.id})${lit ? "" : " no lit"}`);
    });
  const gExp = g.expectedTotal;
  {
    const ok = !!cpu && gateB.instances === gExp && gateB.bound === gateB.instances;
    add(
      "bind:gates",
      "gate lit layers bound",
      ok ? "pass" : "fail",
      !cpu
        ? `no ${top} component`
        : `${fmt(gateB.bound)} of ${fmt(gateB.instances)} gate instances have a bound lit (code: ${fmt(gExp)} gates)${gateB.unbound.length ? `; unbound: ${some(gateB.unbound)}` : ""}`,
    );
  }
  // Front panel: the component's lamps, then each instance.
  const panel = [...ix.byId.values()].find((n) => n.type === "COMPONENT" && n.name === PANEL_NAME);
  const lampsIn = (root: RestNode) => {
    const all: Array<{ name: string; bound: boolean }> = [];
    walk(root, (n) => {
      if (!LAMP_RE.test(n.name)) return;
      const lit = n.children?.find((c) => c.name === "lit");
      if (lit) all.push({ name: n.name, bound: !!visibleAlias(lit) });
    });
    return all;
  };
  const panelB = { lamps: 0, bound: 0, unbound: [] as string[], instances: [] as Array<{ frame: string; lamps: number; bound: number }> };
  const memB = { present: 0, bound: 0, missing: [] as string[], unbound: [] as string[] };
  if (!panel) add("bind:panel", "front panel lamps bound", "fail", `no "${PANEL_NAME}" component`);
  else {
    const lamps = lampsIn(panel);
    panelB.lamps = lamps.length;
    panelB.bound = lamps.filter((l) => l.bound).length;
    panelB.unbound = lamps.filter((l) => !l.bound).map((l) => l.name);
    const panelInstances: RestNode[] = [];
    for (const n of ix.byId.values()) if (n.type === "INSTANCE" && n.componentId && input.components[n.componentId]?.name === PANEL_NAME) panelInstances.push(n);
    const badInst: string[] = [];
    for (const i of panelInstances) {
      const l = lampsIn(i);
      const rep = { frame: ix.topOf.get(i.id)?.name ?? i.name, lamps: l.length, bound: l.filter((x) => x.bound).length };
      panelB.instances.push(rep);
      if (rep.bound < panelB.bound || rep.lamps !== panelB.lamps) badInst.push(`${rep.frame}: ${rep.bound} of ${rep.lamps} bound`);
    }
    const ok = panelB.lamps > 0 && !panelB.unbound.length && !badInst.length;
    add(
      "bind:panel",
      "front panel lamps bound",
      ok ? "pass" : "fail",
      `${panelB.bound} of ${panelB.lamps} lamps bound in the component, ${panelInstances.length} instance(s)${panelB.unbound.length ? `; unbound: ${some(panelB.unbound)}` : ""}${badInst.length ? `; instances off: ${some(badInst, 4)}` : ""}`,
    );
    // MEM matrix.
    const byName = new Map(lamps.map((l) => [l.name, l]));
    for (const name of memLampNames()) {
      const l = byName.get(name);
      if (!l) memB.missing.push(name);
      else {
        memB.present++;
        if (l.bound) memB.bound++;
        else memB.unbound.push(name);
      }
    }
    const ok2 = memB.bound === MEM_LAMPS;
    add(
      "bind:mem",
      `MEM matrix: ${MEM_LAMPS} bound lamps`,
      ok2 ? "pass" : "fail",
      memB.present === 0
        ? `no MEM matrix in "${PANEL_NAME}" (0 of ${MEM_LAMPS} lamp/ram/row<N>/b<M>/Q): the panel predates it. Delete the panel component, then Compile (it reuses an existing panel)`
        : `${memB.bound} of ${MEM_LAMPS} MEM lamps bound${memB.missing.length ? `; missing: ${some(memB.missing)}` : ""}${memB.unbound.length ? `; unbound: ${some(memB.unbound)}` : ""}`,
    );
  }
  add("bind:total", "lit layers bound (total)", "pass", `${fmt(litBound)} of ${fmt(litTotal)} lit layers bound in the page (in ${top}: wire lits ${fmt(cpuWires.bound)} of ${fmt(cpuWires.layers)}; the rest of the unbound ones are the library's own definitions)`);

  // ── 5. variables ──
  const wireIds = new Set<string>();
  for (const r of input.roots)
    walk(r, (n) => {
      if (!n.boundVariables) return;
      for (const v of Object.values(n.boundVariables)) for (const a of Array.isArray(v) ? v : [v]) if (isAlias(a) && isLitLayer(n)) wireIds.add(a.id);
    });
  const otherBound = new Set<string>();
  for (const r of input.roots)
    walk(r, (n) => {
      if (!n.boundVariables || isLitLayer(n)) return;
      for (const v of Object.values(n.boundVariables)) for (const a of Array.isArray(v) ? v : [v]) if (isAlias(a)) otherBound.add(a.id);
    });
  const actionIds = new Set<string>();
  const written = new Set<string>();
  const scan = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) scan(x);
      return;
    }
    if (isAlias(v)) actionIds.add(v.id);
    for (const x of Object.values(v)) scan(x);
  };
  const writes = (acts: readonly RestAction[] | undefined) => {
    for (const a of acts ?? []) {
      if (a.variableId) {
        written.add(a.variableId);
        actionIds.add(a.variableId);
      }
      if (a.variableValue !== undefined) scan(a.variableValue);
      for (const b of a.conditionalBlocks ?? []) {
        scan(b.condition);
        writes(b.actions);
      }
    }
  };
  for (const e of ix.events) writes(e.actions);
  const all = new Set([...wireIds, ...actionIds, ...otherBound]);
  const controlIds = [...all].filter((id) => !wireIds.has(id));
  const roles = controlRoles(ix, controlIds);
  const unwritten = ix.events.length ? [...wireIds].filter((id) => !written.has(id)) : [];
  {
    const exp = expected.wires;
    const issues: string[] = [];
    if (exp !== undefined && wireIds.size !== exp) issues.push(`${fmt(wireIds.size)} distinct wire variables bound to lit layers, the code builds ${fmt(exp)}`);
    if (unwritten.length) issues.push(`${unwritten.length} bound variable(s) no reaction ever sets (their lamps never change)`);
    const named = Object.entries(roles)
      .map(([r, ids]) => `${r}${ids.length > 1 ? `×${ids.length}` : ""}`)
      .join(", ");
    add(
      "variables",
      "variables",
      issues.length ? "fail" : "pass",
      `${fmt(all.size)} distinct variables = ${fmt(wireIds.size)} wires${exp !== undefined ? ` (code ${fmt(exp)})` : ""} + ${controlIds.length} control${named ? ` (${named})` : ""}${issues.length ? `; ${issues.join("; ")}` : ""}`,
    );
  }

  // ── verdict ──
  const failed = checks.filter((c) => c.status === "fail");
  const ready = failed.length === 0;
  const verdict = ready ? "READY to present" : `REBUILD needed: ${failed.map((c) => c.title).join("; ")}${legacy ? " (legacy unchunked build: run Compile with the current plugin)" : ""}`;
  const mark = (s: Status) => (s === "pass" ? "✓" : s === "fail" ? "✗" : "⚠");
  const lines = [`FigmaCPU build audit (cap ${cap} actions per event)`];
  for (const c of checks) {
    lines.push(`${mark(c.status)} ${c.title}: ${c.message}`);
    for (const d of (c.details ?? []).slice(0, 12)) lines.push(`    ${d}`);
    if ((c.details?.length ?? 0) > 12) lines.push(`    … ${c.details!.length - 12} more`);
  }
  lines.push(`VERDICT: ${verdict}`);
  return {
    ...base,
    rebuildNeeded: base.rebuildNeeded || !ready,
    checks,
    ready,
    legacy,
    verdict,
    reactions: { step: stepRep, run: { hops: runHops, edges: runEdges }, resets },
    bindings: { litTotal, litBound, gates: gateB, wires: { layers: wireLayers, bound: wireBound, inTop: cpuWires }, panel: panelB, mem: memB },
    variables: { distinct: all.size, wires: wireIds.size, control: controlIds.length, unwrittenWires: unwritten.length, roles, ...(expected.wires !== undefined ? { expectedWires: expected.wires } : {}) },
    text: lines.join("\n"),
  };
}

/** Best-effort names for the control variables, from how the reactions use them (no variables endpoint needed). */
function controlRoles(ix: Index, ids: string[]): Record<string, string[]> {
  const want = new Set(ids);
  const roles: Record<string, string[]> = {};
  const tag = (id: string | undefined, role: string) => {
    if (!id || !want.has(id)) return;
    const l = (roles[role] ??= []);
    if (!l.includes(id)) l.push(id);
  };
  const expr = (v: unknown) => {
    const val = (v as { type?: string; value?: { expressionFunction?: string; expressionArguments?: Array<{ value?: unknown }> } })?.value;
    return (v as { type?: string })?.type === "EXPRESSION" && val ? val : undefined;
  };
  const argAlias = (a: { value?: unknown } | undefined) => (isAlias(a?.value) ? (a!.value as { id: string }).id : isAlias(a) ? (a as { id: string }).id : undefined);
  const argNum = (a: { value?: unknown } | undefined) => (typeof a?.value === "number" ? a.value : undefined);
  const visit = (acts: readonly RestAction[] | undefined, ctx: { run: boolean; dispatcher: string }) => {
    for (const a of acts ?? []) {
      if (a.type === "SET_VARIABLE" && a.variableId) {
        const vv = a.variableValue as { type?: string; resolvedType?: string; value?: unknown } | undefined;
        const e = expr(vv);
        if (vv?.resolvedType === "STRING" || vv?.type === "STRING") tag(a.variableId, "text");
        else if (e?.expressionFunction === "ADDITION" && argAlias(e.expressionArguments?.[0]) === a.variableId && argNum(e.expressionArguments?.[1]) === 1) tag(a.variableId, "counter");
        else if (e?.expressionFunction === "ADDITION" && argNum(e.expressionArguments?.[1]) === 0) {
          tag(a.variableId, `${ctx.dispatcher}Now`);
          tag(argAlias(e.expressionArguments?.[0]), ctx.dispatcher);
        } else if (ctx.run && vv?.type === "BOOLEAN" && vv.value === true) tag(a.variableId, "running");
        else if (vv?.type === "FLOAT") tag(a.variableId, "float");
      }
      for (const b of a.conditionalBlocks ?? []) visit(b.actions, ctx);
    }
  };
  for (const e of ix.events) {
    const isResetHop = e.trigger === "AFTER_TIMEOUT" && RESET_HOP_RE.test(e.top.name) && e.node === e.top;
    visit(e.actions, { run: e.node.name === "button/Run", dispatcher: isResetHop ? "resetPhase" : "phase" });
  }
  // A variable can match several patterns (e.g. phase is also set to FLOAT literals): keep its most specific role.
  const order = ["running", "counter", "phaseNow", "resetPhaseNow", "phase", "resetPhase", "text", "float"];
  const owner = new Map<string, string>();
  for (const r of order) for (const id of roles[r] ?? []) if (!owner.has(id)) owner.set(id, r);
  const out: Record<string, string[]> = {};
  for (const [id, r] of owner) (out[r] ??= []).push(id);
  const unknown = ids.filter((id) => !owner.has(id));
  if (unknown.length) out.unknown = unknown;
  return out;
}

/** Expected counts from the netlist: gates by type, and wires the way plan() allocates variables (every non-constant
 * net that a gate or a top port touches, plus CLK). */
export function expectedFrom(
  net: { gates: Array<{ type: string; in: number[]; out: number }>; ports: Array<{ nets: number[] }>; netNames: string[]; aliases?: Map<string, number> },
  clkName = "CLK",
): BuildExpected {
  const gates: Record<string, number> = {};
  for (const g of net.gates) gates[g.type] = (gates[g.type] ?? 0) + 1;
  const used = new Set<number>();
  const clk = net.aliases?.get(clkName) ?? net.netNames.indexOf(clkName);
  if (clk >= 0) used.add(clk);
  for (const g of net.gates) {
    used.add(g.out);
    for (const n of g.in) used.add(n);
  }
  for (const p of net.ports) for (const n of p.nets) used.add(n);
  used.delete(0);
  used.delete(1);
  return { gates, wires: used.size };
}
