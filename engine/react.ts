// Per-event "reaction compiler": what one Figma trigger would contain for one editor event.
//   1. tie nets to constants (the event code, optionally derived mode nets) and fold them through the netlist
//   2. keep only gates that can change a state register in this event (inert register groups vanish)
//   3. emit ONE evaluation pass of the logic, then the state commit: masters of loaded groups, then slaves
import { gateExpr } from "../silicon/src/prototype/plan";
import type { PlanAction } from "../silicon/src/prototype/types";
import { evalGate, NET0, NET1, type FlatGate, type FlatNetlist, type GateType } from "../silicon/src/netlist/types";

type K = 0 | 1 | 2;
function eval3(t: GateType, a: K, b: K): K {
  switch (t) {
    case "BUF": return a;
    case "NOT": return a === 2 ? 2 : ((a ^ 1) as K);
    case "AND": return a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : 2;
    case "OR": return a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : 2;
    case "NAND": return a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : 2;
    case "NOR": return a === 1 || b === 1 ? 0 : a === 0 && b === 0 ? 1 : 2;
    default: return a === 2 || b === 2 ? 2 : (evalGate(t, a, b) as K);
  }
}
const RE_M = /^(.*)\/m\d+_(take|hold|merge)$/, RE_S = /^(.*)\/s\d+_(take|hold|merge)$/, RE_C = /^(.*)\/(men|nmen)$/;
type Cls = "M" | "S" | "C" | "X";
const cls = (g: FlatGate): { c: Cls; group: string } => {
  let m = RE_M.exec(g.path); if (m) return { c: "M", group: m[1] };
  m = RE_S.exec(g.path); if (m) return { c: "S", group: m[1] };
  m = RE_C.exec(g.path); if (m) return { c: "C", group: m[1] };
  return { c: "X", group: "" };
};

export interface Spec { net: FlatNetlist; kept: number; folded: number; groupsLive: number; groupsInert: number }
/** tie: port name → value, or net name → value (for derived mode nets). */
export function specialize(net: FlatNetlist, tie: Record<string, number>): Spec {
  const nNets = net.netNames.length;
  const Kv = new Int8Array(nNets).fill(2); Kv[NET0] = 0; Kv[NET1] = 1;
  for (const [name, value] of Object.entries(tie)) {
    const p = net.ports.find((x) => x.name === name);
    if (p) p.nets.forEach((id, i) => (Kv[id] = (value >> i) & 1));
    else { const id = net.aliases.get(name); if (id === undefined) throw new Error("cannot tie " + name); Kv[id] = value & 1; }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const g of net.gates) {
      const y = eval3(g.type, Kv[g.in[0]] as K, g.in.length > 1 ? (Kv[g.in[1]] as K) : 0);
      if (y !== 2 && Kv[g.out] !== y) { Kv[g.out] = y; changed = true; }
    }
  }
  const lit = (id: number) => (Kv[id] === 0 ? NET0 : Kv[id] === 1 ? NET1 : id);
  // a tied net that is driven by a gate loses that gate; fine because the predicate is evaluated by the caller's guard
  const inert = new Set<string>(); const live = new Set<string>();
  for (const g of net.gates) { const c = cls(g); if (c.c === "C" && g.path.endsWith("/men")) (Kv[g.out] === 0 ? inert : live).add(c.group); }
  const gates: FlatGate[] = []; let folded = 0;
  for (const g of net.gates) {
    if (Kv[g.out] !== 2) { folded++; continue; }
    const c = cls(g);
    if (c.c !== "X" && inert.has(c.group)) continue;
    gates.push({ ...g, in: g.in.map(lit) });
  }
  // alias elimination: identity gates (AND x 1, OR x 0, XOR x 0, BUF, AND x x ...) become wires
  const alias = Int32Array.from({ length: nNets }, (_, i) => i);
  const find = (x: number) => { while (alias[x] !== x) { alias[x] = alias[alias[x]]; x = alias[x]; } return x; };
  const dead = new Uint8Array(gates.length);
  for (let changed = true; changed; ) {
    changed = false;
    gates.forEach((g, i) => {
      if (dead[i] || cls(g).c !== "X" || g.path === "nclk") return;
      const a = find(g.in[0]), b = g.in.length > 1 ? find(g.in[1]) : -1;
      let to = -1;
      if (g.type === "BUF") to = a;
      else if (g.type === "AND") to = a === NET1 ? b : b === NET1 ? a : a === b ? a : -1;
      else if (g.type === "OR") to = a === NET0 ? b : b === NET0 ? a : a === b ? a : -1;
      else if (g.type === "XOR") to = a === NET0 ? b : b === NET0 ? a : -1;
      else if (g.type === "XNOR") to = a === NET1 ? b : b === NET1 ? a : -1;
      if (to >= 0 && to !== g.out) { alias[g.out] = find(to); dead[i] = 1; changed = true; }
    });
  }
  gates.forEach((g, i) => { if (!dead[i]) g.in = g.in.map(find); });
  for (let i = gates.length - 1; i >= 0; i--) if (dead[i]) gates.splice(i, 1);
  const driver = new Int32Array(nNets).fill(-1);
  gates.forEach((g, i) => (driver[g.out] = i));
  const keep = new Uint8Array(gates.length); const stack: number[] = [];
  gates.forEach((g, i) => { if (cls(g).c !== "X") { keep[i] = 1; stack.push(i); } });
  while (stack.length) {
    const i = stack.pop()!;
    for (const inp of gates[i].in) {
      const d = driver[inp];
      if (d >= 0 && !keep[d] && (cls(gates[d]).c === "X" || cls(gates[d]).c === "C")) { keep[d] = 1; stack.push(d); }
    }
  }
  const kept = gates.filter((_, i) => keep[i]);
  const drv = new Int32Array(nNets).fill(-1); kept.forEach((g, i) => (drv[g.out] = i));
  return { net: { ...net, gates: kept, driver: drv }, kept: kept.length, folded, groupsLive: live.size, groupsInert: inert.size };
}

const C0 = { const: 0 } as const, C1 = { const: 1 } as const;
/** One evaluation pass + commit, as a Figma action list. */
export function reaction(net: FlatNetlist): PlanAction[] {
  const clk = net.aliases.get("CLK")!;
  const info = net.gates.map(cls);
  const comb = (gi: number) => info[gi].c === "X" || info[gi].c === "C";
  const nclkGate = net.gates.findIndex((g) => g.path === "nclk");
  const order: number[] = []; const seen = new Uint8Array(net.gates.length);
  const visit = (gi: number) => {
    if (seen[gi]) return; seen[gi] = 1;
    for (const inp of net.gates[gi].in) { const d = net.driver[inp]; if (d >= 0 && comb(d) && d !== nclkGate) visit(d); }
    order.push(gi);
  };
  net.gates.forEach((_, gi) => { if (comb(gi) && gi !== nclkGate) visit(gi); });
  const set = (g: FlatGate): PlanAction => ({ set: g.out, to: gateExpr(g) });
  const nclk: PlanAction[] = nclkGate >= 0 ? [set(net.gates[nclkGate])] : [];
  const groups = new Map<string, { m: number[]; s: number[]; men: number }>();
  net.gates.forEach((g, gi) => {
    const c = info[gi]; if (c.c === "X") return;
    const e = groups.get(c.group) ?? { m: [], s: [], men: -1 }; groups.set(c.group, e);
    if (c.c === "M") e.m.push(gi); else if (c.c === "S") e.s.push(gi); else if (g.path.endsWith("/men")) e.men = gi;
  });
  const low: PlanAction[] = [{ set: clk, to: C0 }, ...nclk, ...order.map((gi) => set(net.gates[gi]))];
  const high: PlanAction[] = [{ set: clk, to: C1 }, ...nclk];
  for (const e of groups.values()) {
    const menNet = net.gates[e.men].out;
    low.push({ if: { var: menNet }, then: e.m.map((gi) => set(net.gates[gi])) });
    high.push({ if: { var: menNet }, then: e.s.map((gi) => set(net.gates[gi])) });
  }
  return [...low, ...high];
}
