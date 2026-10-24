// A small, self-contained scheduler so the prototype compiler and the spike work before
// (or without) lane A's `compile()`. It follows SILICON.md §7 in its simplest form:
//   1. per pass, CLK is a constant; three-valued propagation finds the gates whose output is
//      constant for the whole pass. They are evaluated first, in the order they were derived.
//   2. the remaining gates form a graph (edges from constant nets are dropped — that is what
//      breaks the master↔slave loops of a flip-flop); Tarjan finds its strongly connected
//      components, which are emitted in topological order.
//   3. a cyclic component (a latch's hold loop) is emitted in netlist order, repeated r times;
//      r is found by trying every input/state combination of the component when it is small.
// Prefer `compile()` from src/compile when it exists; this is the fallback and test helper.
import type { Schedule } from "../compile/types";
import { netId } from "../netlist/flatten";
import { evalGate, type FlatNetlist, type GateType, NET0, NET1 } from "../netlist/types";
import { RefSim } from "../sim/reference";

const X = 2; // unknown, in three-valued propagation
type V3 = 0 | 1 | 2;

function eval3(type: GateType, a: V3, b: V3): V3 {
  switch (type) {
    case "BUF":
      return a;
    case "NOT":
      return a === X ? X : a ? 0 : 1;
    case "AND":
    case "NAND": {
      const y: V3 = a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : X;
      return type === "AND" || y === X ? y : y ? 0 : 1;
    }
    case "OR":
    case "NOR": {
      const y: V3 = a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : X;
      return type === "OR" || y === X ? y : y ? 0 : 1;
    }
    case "XOR":
    case "XNOR": {
      if (a === X || b === X) return X;
      const y = a ^ b;
      return (type === "XOR" ? y : 1 - y) as V3;
    }
  }
}

export { eval3, X as UNKNOWN };

/** Three-valued value of every net for a pass with CLK fixed at `level`: 0, 1 or 2 (varies). */
export function constants3(net: FlatNetlist, clk: number, level: 0 | 1): Uint8Array {
  const k = new Uint8Array(net.netNames.length).fill(X);
  k[NET0] = 0;
  k[NET1] = 1;
  if (clk >= 0) k[clk] = level;
  for (let changed = true; changed; ) {
    changed = false;
    for (const g of net.gates) {
      if (k[g.out] !== X) continue;
      const y = eval3(g.type, k[g.in[0]] as V3, (g.in.length > 1 ? k[g.in[1]] : 0) as V3);
      if (y !== X) {
        k[g.out] = y;
        changed = true;
      }
    }
  }
  return k;
}

export interface SimpleScheduleOptions {
  /** Name of the clock input (default "CLK"). */
  clk?: string;
  /** Components with more input+state bits than this get r = component size (default 16). */
  exhaustiveBits?: number;
}

interface PassResult {
  order: number[];
  sccs: number[][];
}

export function simpleSchedule(net: FlatNetlist, opts: SimpleScheduleOptions = {}): Schedule {
  const clk = netId(net, opts.clk ?? "CLK");
  const p0 = schedulePass(net, clk, 0, opts.exhaustiveBits ?? 16);
  const p1 = schedulePass(net, clk, 1, opts.exhaustiveBits ?? 16);
  return {
    passes: [
      { clk: 0, order: p0.order },
      { clk: 1, order: p1.order },
    ],
    sccs: [p0.sccs, p1.sccs],
    stats: {
      gates: net.gates.length,
      actionsPerTick: p0.order.length + p1.order.length,
      largestScc: Math.max(0, ...p0.sccs.map((s) => s.length), ...p1.sccs.map((s) => s.length)),
    },
  };
}

function schedulePass(net: FlatNetlist, clk: number, level: 0 | 1, exhaustiveBits: number): PassResult {
  const { gates, driver } = net;
  // 1. Constant propagation; `constOrder` is a valid evaluation order for constant gates
  //    because a gate is appended only after the inputs that decide its value.
  const k = new Uint8Array(net.netNames.length).fill(X);
  k[NET0] = 0;
  k[NET1] = 1;
  k[clk] = level;
  const isConst = new Uint8Array(gates.length);
  const constOrder: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    gates.forEach((g, i) => {
      if (isConst[i]) return;
      const y = eval3(g.type, k[g.in[0]] as V3, (g.in.length > 1 ? k[g.in[1]] : 0) as V3);
      if (y === X) return;
      k[g.out] = y;
      isConst[i] = 1;
      constOrder.push(i);
      changed = true;
    });
  }

  // 2. Live graph: u → v when gate v reads the (non-constant) output of gate u.
  const succ: number[][] = gates.map(() => []);
  const selfLoop = new Uint8Array(gates.length);
  gates.forEach((g, v) => {
    if (isConst[v]) return;
    for (const n of g.in) {
      const u = driver[n];
      if (u < 0 || isConst[u]) continue;
      if (u === v) selfLoop[v] = 1;
      succ[u].push(v);
    }
  });

  // Tarjan (iterative). Components come out in reverse topological order.
  const index = new Int32Array(gates.length).fill(-1);
  const low = new Int32Array(gates.length);
  const onStack = new Uint8Array(gates.length);
  const stack: number[] = [];
  const comps: number[][] = [];
  let counter = 0;
  for (let root = 0; root < gates.length; root++) {
    if (isConst[root] || index[root] !== -1) continue;
    const work: Array<[number, number]> = [[root, 0]];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (work.length) {
      const top = work[work.length - 1];
      const [v, ei] = top;
      if (ei < succ[v].length) {
        top[1]++;
        const w = succ[v][ei];
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low[parent] = Math.min(low[parent], low[v]);
      }
      if (low[v] === index[v]) {
        const comp: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          comp.push(w);
        } while (w !== v);
        comps.push(comp);
      }
    }
  }
  comps.reverse();

  // 3. Emit.
  const order = [...constOrder];
  const sccs: number[][] = [];
  for (const comp of comps) {
    if (comp.length === 1 && !selfLoop[comp[0]]) {
      order.push(comp[0]);
      continue;
    }
    comp.sort((a, b) => a - b); // netlist order, as RefSim sweeps
    sccs.push(comp);
    const r = repeatsToSettle(net, comp, k, exhaustiveBits);
    for (let i = 0; i < r; i++) order.push(...comp);
  }
  return { order, sccs };
}

/** Smallest r such that r sweeps over `comp` (in the given order) reach a fixed point from
 * every combination of its free inputs and current outputs; component size if too large. */
function repeatsToSettle(net: FlatNetlist, comp: number[], k: Uint8Array, exhaustiveBits: number): number {
  const gates = comp.map((i) => net.gates[i]);
  const outs = new Set(gates.map((g) => g.out));
  const free = new Set<number>();
  for (const g of gates) for (const n of g.in) if (!outs.has(n) && k[n] === X) free.add(n);
  const vars = [...free, ...outs];
  if (vars.length > exhaustiveBits) return comp.length;
  const cap = 2 * comp.length + 2;
  const v = new Map<number, number>();
  let need = 1;
  for (let m = 0; m < 1 << vars.length; m++) {
    vars.forEach((n, i) => v.set(n, (m >> i) & 1));
    const val = (n: number) => (v.has(n) ? v.get(n)! : k[n]);
    for (let sweep = 1; sweep <= cap; sweep++) {
      let changed = false;
      for (const g of gates) {
        const y = evalGate(g.type, val(g.in[0]), g.in.length > 1 ? val(g.in[1]) : 0);
        if (v.get(g.out) !== y) {
          v.set(g.out, y);
          changed = true;
        }
      }
      if (!changed) {
        need = Math.max(need, sweep - 1);
        break;
      }
      // A combination that never settles is an oscillating loop; ignore it here (RefSim and
      // the design rules catch real oscillators) and keep the bound from the others.
    }
  }
  return need;
}

/** Power-on state: all nets 0, CLK=1, settled by the reference simulator — the same
 * convention as src/compile `powerOn()`: a tick starts from a settled CLK=1 state (a pruned
 * schedule relies on it). Prefer `powerOn` (it also takes RAM preload pokes). */
export function powerOnState(net: FlatNetlist): Uint8Array {
  const sim = new RefSim(net);
  const clk = net.aliases.get("CLK");
  if (clk !== undefined) sim.v[clk] = 1;
  sim.settle();
  return sim.v.slice();
}
