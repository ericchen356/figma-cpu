// The timing compiler ("fab", lane A): flat gate netlist → Schedule, the fixed order in which
// Figma's prototype engine (or FastSim) evaluates gates for one clock tick.
//
// A tick is a LOW pass (CLK=0) then a HIGH pass (CLK=1). Each pass must leave every net where
// the reference simulator (src/sim/reference.ts) settles it, but as straight-line code: every
// gate once, in dependency order, and feedback groups (latch hold loops) repeated just enough
// to settle. Per pass:
//   1. Three-valued constant propagation with CLK fixed. With CLK=1 a master latch's enable
//      ¬CLK·LOAD is constant 0, so its D input is dead and the false loop
//      slave → logic → master → slave disappears; with CLK=0 the same happens to every slave.
//      What remains cyclic are the latches' own hold loops.
//   2. Live dependency graph (driver → reader), Tarjan SCCs, topological order of the
//      condensation (ties broken by gate index, so the order reads like the netlist).
//   3. A feedback group is evaluated in netlist (gate index) order: that is RefSim's sweep
//      order, so the group reaches the same fixpoint RefSim does. For the mux latch this puts
//      `hold = Q·¬EN` before `merge = take + hold → Q`, which is required: when EN falls while
//      Q=1, merge-before-hold would read the stale hold=0 and lose Q. The group is repeated as
//      many actions as an exhaustive check over all its start states and inputs proves enough.
//   4. Pruning (default on): a gate is scheduled only if its value can differ from the
//      previous pass's settled value. LOW starts with CLK and the top inputs changed, HIGH with
//      CLK only. A latch holding through a pass keeps its output, so logic downstream of
//      flip-flops runs once per tick (in HIGH) instead of twice.
import { type FlatNetlist, type GateType, NET0, NET1 } from "../netlist/types";
import type { Schedule } from "./types";

export class CompileError extends Error {}

export interface CompileOptions {
  /** Schedule only gates whose value can change in a pass (default true). Off, every gate is
   * evaluated in both passes and every feedback group in whole rounds: the baseline. */
  prune?: boolean;
  /** Top-level input ports that may change between ticks (default: every input except CLK).
   * Inputs left out are assumed constant; FastSim falls back to a full settle if they change. */
  inputs?: string[];
  /** A feedback group that needs more rounds than this to settle is rejected (default 16). */
  maxRounds?: number;
}

/** What `compile` returns: the Schedule contract plus the assumption FastSim needs to stay exact. */
export interface CompiledSchedule extends Schedule {
  /** Top-level input nets the LOW pass treats as changeable between ticks. */
  inputNets: number[];
}

// ---------- gate arrays (shared with FastSim) ----------

/** Gate type codes of the typed-array simulators. */
export const CODE: Record<GateType, number> = { BUF: 0, NOT: 1, AND: 2, OR: 3, NAND: 4, NOR: 5, XOR: 6, XNOR: 7 };
const [BUF, NOT, AND, OR, NAND, NOR, XOR] = [0, 1, 2, 3, 4, 5, 6];

/** Typed-array view of gates, all of them or the actions of a pass (`order`). For 1-input
 * gates b = a, so every gate is y = f(v[a], v[b]). */
export interface GateArrays {
  t: Uint8Array;
  a: Int32Array;
  b: Int32Array;
  y: Int32Array;
}

export function gateArrays(net: FlatNetlist, order?: ArrayLike<number>): GateArrays {
  const n = order ? order.length : net.gates.length;
  const out: GateArrays = { t: new Uint8Array(n), a: new Int32Array(n), b: new Int32Array(n), y: new Int32Array(n) };
  for (let k = 0; k < n; k++) {
    const g = net.gates[order ? order[k] : k];
    out.t[k] = CODE[g.type];
    out.a[k] = g.in[0];
    out.b[k] = g.in.length > 1 ? g.in[1] : g.in[0];
    out.y[k] = g.out;
  }
  return out;
}

/** 0/1 evaluation of a gate code. */
export function evalBit(t: number, a: number, b: number): number {
  switch (t) {
    case BUF:
      return a;
    case NOT:
      return a ^ 1;
    case AND:
      return a & b;
    case OR:
      return a | b;
    case NAND:
      return (a & b) ^ 1;
    case NOR:
      return (a | b) ^ 1;
    case XOR:
      return a ^ b;
    default:
      return a ^ b ^ 1;
  }
}

// ---------- three-valued constant propagation ----------

const X = -1; // unknown

function eval3(t: number, a: number, b: number): number {
  switch (t) {
    case BUF:
      return a;
    case NOT:
      return a === X ? X : a ^ 1;
    case AND:
      return a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : X;
    case OR:
      return a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : X;
    case NAND:
      return a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : X;
    case NOR:
      return a === 1 || b === 1 ? 0 : a === 0 && b === 0 ? 1 : X;
    case XOR:
      return a === X || b === X ? X : a ^ b;
    default:
      return a === X || b === X ? X : a ^ b ^ 1;
  }
}

/** Constant value per net for one CLK level (X = varies), and the order in which each constant
 * was derived. A constant gate's output is forced by inputs derived before it (lower rank). */
interface Levels {
  k: Int8Array;
  rank: Int32Array;
}

function constants(g: GateArrays, rs: Int32Array, rd: Int32Array, nNets: number, clk: number, level: number): Levels {
  const k = new Int8Array(nNets).fill(X);
  const rank = new Int32Array(nNets);
  k[NET0] = 0;
  k[NET1] = 1;
  if (clk >= 0) k[clk] = level;
  const n = g.t.length;
  if (n === 0) return { k, rank };
  // FIFO ring of gates to (re)check; a gate is queued at most once at a time.
  const queue = new Int32Array(n);
  const queued = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) queue[i] = i;
  let head = 0;
  let size = n;
  let next = 1;
  while (size > 0) {
    const i = queue[head];
    head = (head + 1) % n;
    size--;
    queued[i] = 0;
    const y = g.y[i];
    if (k[y] !== X) continue;
    const v = eval3(g.t[i], k[g.a[i]], k[g.b[i]]);
    if (v === X) continue;
    k[y] = v;
    rank[y] = next++;
    for (let e = rs[y]; e < rs[y + 1]; e++) {
      const r = rd[e];
      if (!queued[r] && k[g.y[r]] === X) {
        queued[r] = 1;
        queue[(head + size) % n] = r;
        size++;
      }
    }
  }
  return { k, rank };
}

// ---------- graph algorithms ----------

/** Tarjan's SCCs (iterative) over edges p → i for p in {p0[i], p1[i]}. */
function tarjan(n: number, p0: Int32Array, p1: Int32Array): { comp: Int32Array; count: number } {
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    if (p0[i] >= 0) start[p0[i] + 1]++;
    if (p1[i] >= 0) start[p1[i] + 1]++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const succ = new Int32Array(start[n]);
  const fill = start.slice(0, n);
  for (let i = 0; i < n; i++) {
    if (p0[i] >= 0) succ[fill[p0[i]]++] = i;
    if (p1[i] >= 0) succ[fill[p1[i]]++] = i;
  }

  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const comp = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack = new Int32Array(n);
  const call = new Int32Array(n);
  const edge = new Int32Array(n);
  let sp = 0;
  let cp = 0;
  let idx = 0;
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    index[s] = low[s] = idx++;
    stack[sp++] = s;
    onStack[s] = 1;
    call[cp] = s;
    edge[cp++] = start[s];
    while (cp > 0) {
      const v = call[cp - 1];
      if (edge[cp - 1] < start[v + 1]) {
        const w = succ[edge[cp - 1]++];
        if (index[w] === -1) {
          index[w] = low[w] = idx++;
          stack[sp++] = w;
          onStack[w] = 1;
          call[cp] = w;
          edge[cp++] = start[w];
        } else if (onStack[w] && index[w] < low[v]) low[v] = index[w];
        continue;
      }
      cp--;
      if (cp > 0 && low[v] < low[call[cp - 1]]) low[call[cp - 1]] = low[v];
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack[--sp];
          onStack[w] = 0;
          comp[w] = count;
        } while (w !== v);
        count++;
      }
    }
  }
  return { comp, count };
}

/** Binary min-heap of distinct non-negative ints. */
class MinHeap {
  private h: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.h = new Int32Array(Math.max(1, capacity));
  }
  push(x: number): void {
    const h = this.h;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p] <= x) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = x;
  }
  pop(): number {
    const h = this.h;
    const top = h[0];
    const x = h[--this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && h[c + 1] < h[c]) c++;
      if (h[c] >= x) break;
      h[i] = h[c];
      i = c;
    }
    h[i] = x;
    return top;
  }
}

/** Components in topological order (Kahn), each as its gates in ascending index; among ready
 * components the one with the smallest gate index goes first. */
function topoComponents(n: number, comp: Int32Array, count: number, p0: Int32Array, p1: Int32Array): number[][] {
  const members: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < n; i++) members[comp[i]].push(i);
  const indeg = new Int32Array(count);
  const outs: number[][] = Array.from({ length: count }, () => []);
  const link = (p: number, i: number) => {
    if (p < 0 || comp[p] === comp[i]) return;
    indeg[comp[i]]++;
    outs[comp[p]].push(comp[i]);
  };
  for (let i = 0; i < n; i++) {
    link(p0[i], i);
    link(p1[i], i);
  }
  const heap = new MinHeap(count);
  for (let c = 0; c < count; c++) if (indeg[c] === 0) heap.push(members[c][0]);
  const order: number[][] = [];
  while (heap.size > 0) {
    const c = comp[heap.pop()];
    order.push(members[c]);
    for (const d of outs[c]) if (--indeg[d] === 0) heap.push(members[d][0]);
  }
  return order;
}

// ---------- feedback groups ----------

/** Number of actions of the group's order, repeated, after which the group is at a fixpoint
 * from ANY start values of its nets and ANY values of its non-constant inputs (constants fixed
 * at this pass's values). Exhaustive for small groups; sampled (plus a spare round) otherwise.
 * Throws if some state is still changing after `maxRounds` rounds (an oscillating loop). */
function settleLength(
  net: FlatNetlist,
  gs: number[],
  g: GateArrays,
  K: Int8Array,
  maxRounds: number,
  memo: Map<string, number>,
): number {
  const k = gs.length;
  const local = new Map<number, number>();
  gs.forEach((i, j) => local.set(g.y[i], j));
  const ext = new Map<number, number>();
  // Operand slots 2j, 2j+1: kind 0 = group net (local index), 1 = constant, 2 = outside net.
  const kind = new Uint8Array(2 * k);
  const val = new Int32Array(2 * k);
  const encode = (slot: number, id: number) => {
    const l = local.get(id);
    if (l !== undefined) [kind[slot], val[slot]] = [0, l];
    else if (K[id] !== X) [kind[slot], val[slot]] = [1, K[id]];
    else {
      let e = ext.get(id);
      if (e === undefined) ext.set(id, (e = ext.size));
      [kind[slot], val[slot]] = [2, e];
    }
  };
  gs.forEach((i, j) => {
    encode(2 * j, g.a[i]);
    encode(2 * j + 1, g.b[i]);
  });
  const t = gs.map((i) => g.t[i]);
  const key = t.map((tj, j) => `${tj}${kind[2 * j]}${val[2 * j]},${kind[2 * j + 1]}${val[2 * j + 1]}`).join(";");
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  const m = ext.size;
  const bits = k + m;
  const exhaustive = bits <= 20 && 2 ** bits * k <= 1 << 18;
  const states = exhaustive ? 2 ** bits : 4096;
  const vals = new Uint8Array(k);
  const xs = new Uint8Array(m);
  const operand = (slot: number) => (kind[slot] === 0 ? vals[val[slot]] : kind[slot] === 1 ? val[slot] : xs[val[slot]]);
  let seed = 0x2545f491;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed & 1;
  };
  let need = 0;
  for (let s = 0; s < states; s++) {
    for (let j = 0; j < k; j++) vals[j] = exhaustive ? Math.floor(s / 2 ** j) & 1 : rand();
    for (let j = 0; j < m; j++) xs[j] = exhaustive ? Math.floor(s / 2 ** (k + j)) & 1 : rand();
    // Gauss-Seidel in group order until a whole round changes nothing.
    let pos = 0;
    let last = -1;
    let quiet = 0;
    while (quiet < k) {
      const j = pos % k;
      const y = evalBit(t[j], operand(2 * j), operand(2 * j + 1));
      if (y !== vals[j]) {
        if (pos >= k * maxRounds) {
          const paths = gs.slice(0, 8).map((i) => net.gates[i].path);
          throw new CompileError(
            `feedback group of ${k} gates does not settle within ${maxRounds} rounds (oscillating loop?): ${paths.join(", ")}${k > 8 ? ", …" : ""}`,
          );
        }
        vals[j] = y;
        last = pos;
        quiet = 0;
      } else quiet++;
      pos++;
    }
    need = Math.max(need, last + 1);
  }
  if (!exhaustive) need += k;
  memo.set(key, need);
  return need;
}

/** Pruning inside a "pure hold" group: every gate, with this pass's constants substituted, just
 * copies (or inverts) one net of the group, e.g. a latch with EN constant 0: hold = Q·1,
 * Q = 0 + hold. Tracks symbolically which start value each net receives; a net that only ever
 * receives its own start value cannot change, so its actions are dropped (for the closed latch
 * that is `merge`: only `hold` needs evaluating). Returns the kept actions and the nets that
 * may change, or null if the group is not a pure hold loop. */
function holdFilter(gs: number[], seq: number[], g: GateArrays, K: Int8Array): { keep: number[]; changing: number[] } | null {
  const k = gs.length;
  const local = new Map<number, number>();
  gs.forEach((i, j) => local.set(g.y[i], j));
  const src = new Int32Array(k);
  const inv = new Uint8Array(k);
  for (let j = 0; j < k; j++) {
    const i = gs[j];
    const [t, a, b] = [g.t[i], g.a[i], g.b[i]];
    let x: number;
    let c = -1; // the other operand's constant, if any
    if (t === BUF || t === NOT || a === b) x = a;
    else if (K[a] === X && K[b] !== X) [x, c] = [a, K[b]];
    else if (K[b] === X && K[a] !== X) [x, c] = [b, K[a]];
    else return null; // two varying operands: data flows into the group
    const s = local.get(x);
    if (s === undefined) return null; // a varying operand from outside the group
    src[j] = s;
    // Non-constant output means AND/NAND see c=1 and OR/NOR see c=0: copy or invert.
    if (t === BUF || t === AND || t === OR) inv[j] = 0;
    else if (t === NOT || t === NAND || t === NOR) inv[j] = 1;
    else if (c < 0) return null; // XOR(x, x)
    else inv[j] = t === XOR ? c : c ^ 1;
  }
  const symSrc = Int32Array.from({ length: k }, (_, j) => j);
  const symInv = new Uint8Array(k);
  const moves = new Uint8Array(k);
  for (const i of seq) {
    const j = local.get(g.y[i])!;
    const [s, p] = [symSrc[src[j]], symInv[src[j]] ^ inv[j]];
    if (s !== j || p !== 0) moves[j] = 1;
    symSrc[j] = s;
    symInv[j] = p;
  }
  return {
    keep: seq.filter((i) => moves[local.get(g.y[i])!]),
    changing: gs.filter((_, j) => moves[j]).map((i) => g.y[i]),
  };
}

// ---------- compile ----------

export function compile(net: FlatNetlist, opts: CompileOptions = {}): CompiledSchedule {
  const prune = opts.prune ?? true;
  const maxRounds = opts.maxRounds ?? 16;
  const g = gateArrays(net);
  const n = g.t.length;
  const nNets = net.netNames.length;
  const { driver } = net;
  const clk = net.aliases.get("CLK") ?? -1;
  if (clk >= 0 && driver[clk] !== -1) throw new CompileError("CLK must be a top-level input");

  // Readers of each net (CSR).
  const rs = new Int32Array(nNets + 1);
  for (let i = 0; i < n; i++) {
    rs[g.a[i] + 1]++;
    if (g.b[i] !== g.a[i]) rs[g.b[i] + 1]++;
  }
  for (let i = 0; i < nNets; i++) rs[i + 1] += rs[i];
  const rd = new Int32Array(rs[nNets]);
  const fill = rs.slice(0, nNets);
  for (let i = 0; i < n; i++) {
    rd[fill[g.a[i]]++] = i;
    if (g.b[i] !== g.a[i]) rd[fill[g.b[i]]++] = i;
  }

  const inPorts = net.ports.filter((p) => p.dir === "in");
  const inputNets: number[] = [];
  for (const name of opts.inputs ?? inPorts.map((p) => p.name).filter((x) => x !== "CLK")) {
    const p = inPorts.find((x) => x.name === name);
    if (!p) throw new CompileError(`no top-level input ${name}`);
    for (const id of p.nets) if (id !== clk) inputNets.push(id);
  }

  const levels = [constants(g, rs, rd, nNets, clk, 0), constants(g, rs, rd, nNets, clk, 1)];
  const memo = new Map<string, number>();

  const plan = (level: 0 | 1) => {
    const { k: K, rank } = levels[level];
    const Kprev = levels[1 - level].k;

    // Live predecessors. A varying gate depends on the drivers of both operands (constant ones
    // included: they must be updated first). A constant gate depends only on the operands
    // that force it, which were derived earlier, so constant gates never form a cycle.
    const p0 = new Int32Array(n);
    const p1 = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const y = g.y[i];
      const live = (id: number) => {
        const d = driver[id];
        if (d < 0) return -1;
        if (K[y] === X) return d;
        return K[id] !== X && rank[id] < rank[y] ? d : -1;
      };
      p0[i] = live(g.a[i]);
      p1[i] = g.b[i] === g.a[i] ? -1 : live(g.b[i]);
    }
    const { comp, count } = tarjan(n, p0, p1);
    const comps = topoComponents(n, comp, count, p0, p1);

    // chg[net] = its settled value in this pass may differ from the previous pass's.
    const chg = new Uint8Array(nNets);
    if (clk >= 0) chg[clk] = 1;
    if (level === 0) for (const id of inputNets) chg[id] = 1;
    const changes = (i: number) => {
      const [y, a, b] = [g.y[i], g.a[i], g.b[i]];
      if (K[y] === X) return chg[a] === 1 || chg[b] === 1;
      // Constant now: unchanged if it had the same constant before, or if the operands that
      // force it did not change (they forced the same value in the previous pass).
      if (Kprev[y] === K[y]) return false;
      const forced = (id: number) => K[id] !== X && rank[id] < rank[y] && chg[id] === 1;
      return forced(a) || forced(b);
    };

    const order: number[] = [];
    const sccs: number[][] = [];
    for (const gs of comps) {
      const i0 = gs[0];
      if (gs.length === 1 && p0[i0] !== i0 && p1[i0] !== i0) {
        if (!prune) order.push(i0);
        else if (changes(i0)) {
          order.push(i0);
          chg[g.y[i0]] = 1;
        }
        continue;
      }
      sccs.push(gs);
      const need = settleLength(net, gs, g, K, maxRounds, memo);
      if (!prune) {
        for (let r = Math.max(1, Math.ceil(need / gs.length)); r > 0; r--) order.push(...gs);
        continue;
      }
      // At the start of the pass the group is at the previous pass's fixpoint; if none of its
      // inputs change it stays there.
      const c = comp[i0];
      const moved = (id: number) => chg[id] === 1 && (driver[id] < 0 || comp[driver[id]] !== c);
      if (!gs.some((i) => moved(g.a[i]) || moved(g.b[i]))) continue;
      const seq = Array.from({ length: need }, (_, j) => gs[j % gs.length]);
      const hold = holdFilter(gs, seq, g, K);
      order.push(...(hold ? hold.keep : seq));
      for (const y of hold ? hold.changing : seq.map((i) => g.y[i])) chg[y] = 1;
    }
    return { order, sccs };
  };

  const low = plan(0);
  const high = plan(1);
  return {
    passes: [
      { clk: 0, order: low.order },
      { clk: 1, order: high.order },
    ],
    sccs: [low.sccs, high.sccs],
    stats: {
      gates: n,
      actionsPerTick: low.order.length + high.order.length,
      largestScc: [...low.sccs, ...high.sccs].reduce((m, s) => Math.max(m, s.length), 0),
    },
    inputNets,
  };
}
