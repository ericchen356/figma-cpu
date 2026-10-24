// Clock gating: wraps groups of scheduled gate evaluations in `if` blocks that are skipped
// when the group provably cannot change, so a tick *executes* fewer actions (the viewer's
// limit is executed actions per event; a skipped branch costs one action). Every net stays
// exactly equal to the ungated schedule (and so to FastSim/RefSim), not just the probes.
//
// LOW pass. Take a net w that is constant v in the HIGH pass (K_HIGH[w] = v) but varies in
// LOW, e.g. a master latch enable ¬CLK·LOAD or a RAM write enable ¬CLK·WE (v = 0). The LOW pass
// starts from the settled HIGH state, where w = v. Let F be what w = v forces by three-valued
// propagation (from w alone, not from CLK). A gate belongs to the region R(w) if its output is
// forced, or all its inputs are forced or outputs of R (greatest such set). If w = v when the
// block is reached, every gate of R would compute the value it already has: forced gates
// hold their forced value since the HIGH state; the rest (the latch hold loops) are a fixed
// point fed only by unchanged nets. So `if (w ≠ v) { R's evaluations }` is exact.
//
// HIGH pass. The same latches are re-evaluated in HIGH (their enables became constant), but
// only need it if their LOW block ran. The LOW block sets a plan-only flag `dirty`; the HIGH
// evaluations of those gates whose inputs are HIGH constants or other region outputs are
// wrapped in `if (dirty) { …; dirty = false }`. If the LOW block was skipped they still hold
// the previous HIGH state, which is a fixed point of exactly these inputs.
//
// Blocks nest (RAM: the write enable outside, each row's enable inside). Evaluations are moved
// into a block only past evaluations they commute with (no read/write overlap); otherwise the
// region is split into several blocks with the same guard.
import type { Schedule } from "../compile/types";
import { type FlatNetlist, NET0, NET1 } from "../netlist/types";
import { constants3, eval3, UNKNOWN as X } from "./schedule";
import type { Expr } from "./types";

/** A gate evaluation (gate index) or a guarded block. */
export type GItem = number | GBlock;
export interface GBlock {
  guard: Expr;
  items: GItem[];
  /** Plan-only flag variable to set at the end of the block (dirty marking / clearing). */
  setFlag?: { id: number; value: 0 | 1 };
}

export interface GatingOptions {
  /** Smallest number of evaluations worth a block (default 4). */
  minSaving?: number;
  /** Ids for plan-only flag variables start here (default: net count). */
  flagBase?: number;
}

export interface Gating {
  passes: [GItem[], GItem[]];
  /** Flag ids used (flagBase …): one per LOW region that also has a HIGH block. */
  flags: number[];
  /** Number of guarded blocks (both passes). */
  blocks: number;
}

interface Region {
  /** Guard net, and every net known to equal it (same gate type and inputs). */
  w: number;
  seeds: number[];
  v: 0 | 1;
  gates: Set<number>;
  children: Region[];
  flag?: number;
}

export function gateSchedule(net: FlatNetlist, schedule: Schedule, opts: GatingOptions = {}): Gating {
  const minSaving = opts.minSaving ?? 4;
  const clk = net.aliases.get("CLK") ?? -1;
  const K = [constants3(net, clk, 0), constants3(net, clk, 1)];
  const { gates, driver } = net;
  const readers: number[][] = net.netNames.map(() => []);
  gates.forEach((g, i) => new Set(g.in).forEach((n) => readers[n].push(i)));

  const lowOrder = schedule.passes[0].order;
  const highOrder = schedule.passes[1].order;
  const positions = (order: number[]) => {
    const pos = new Map<number, number[]>();
    order.forEach((gi, p) => pos.set(gi, [...(pos.get(gi) ?? []), p]));
    return pos;
  };
  const lowPos = positions(lowOrder);
  const highPos = positions(highOrder);

  /** Nets forced by seeds = v (three-valued, seeded with them and the constant nets only). */
  const forcedBy = (seeds: number[], v: 0 | 1): Map<number, number> => {
    const f = new Map<number, number>([
      [NET0, 0],
      [NET1, 1],
      ...seeds.map((w): [number, number] => [w, v]),
    ]);
    const val = (n: number) => (f.has(n) ? (f.get(n) as 0 | 1) : X);
    const work = [...seeds];
    while (work.length) {
      const n = work.pop()!;
      for (const gi of readers[n]) {
        const g = gates[gi];
        if (f.has(g.out)) continue;
        const y = eval3(g.type, val(g.in[0]) as 0 | 1 | 2, (g.in.length > 1 ? val(g.in[1]) : 0) as 0 | 1 | 2);
        if (y !== X) {
          f.set(g.out, y);
          work.push(g.out);
        }
      }
    }
    return f;
  };

  /** Greatest set of `allowed` gates that are forced or fed only by forced nets / members. */
  const greatest = (allowed: Set<number>, forced: (n: number) => boolean): Set<number> => {
    const r = new Set(allowed);
    for (let changed = true; changed; ) {
      changed = false;
      for (const gi of r) {
        const g = gates[gi];
        if (forced(g.out)) continue;
        if (g.in.every((n) => n === NET0 || n === NET1 || forced(n) || (driver[n] >= 0 && r.has(driver[n])))) continue;
        r.delete(gi);
        changed = true;
      }
    }
    return r;
  };

  /** Region of seeds = v among `pool` (LOW gates), evaluated after the seeds' last LOW
   * evaluation. */
  const lowRegion = (seeds: number[], v: 0 | 1, pool: Set<number>): Set<number> => {
    const ds = new Set(seeds.map((w) => driver[w]));
    const after = Math.max(...seeds.flatMap((w) => lowPos.get(driver[w]) ?? [-1]));
    const f = forcedBy(seeds, v);
    // Forward cone of the seeds inside the pool (anything else cannot depend on the guard).
    const cone = new Set<number>();
    const work = [...seeds];
    const seen = new Set<number>(seeds);
    while (work.length) {
      const n = work.pop()!;
      for (const gi of readers[n]) {
        if (!pool.has(gi) || ds.has(gi) || cone.has(gi)) continue;
        if (Math.min(...lowPos.get(gi)!) <= after) continue;
        cone.add(gi);
        const o = gates[gi].out;
        if (!seen.has(o)) {
          seen.add(o);
          work.push(o);
        }
      }
    }
    return greatest(cone, (n) => f.has(n));
  };
  const evals = (r: Set<number>, pos: Map<number, number[]>) => [...r].reduce((s, gi) => s + (pos.get(gi)?.length ?? 0), 0);

  // Guard candidates: nets constant v in HIGH that vary in LOW. Structurally equal nets (same
  // gate types over the same inputs, e.g. a register's per-bit enables ¬CLK·LOAD, each with its
  // own NOT) are equal once evaluated, if every net of their cones is written at most once in
  // LOW and none is in a feedback loop: they share one guard (one block per register).
  const vn = valueNumbers(net, lowPos, new Set(schedule.sccs.flat(2)));
  const classes = new Map<number, number[]>();
  for (let w = 2; w < net.netNames.length; w++) {
    if (K[0][w] !== X || K[1][w] === X || driver[w] < 0 || !lowPos.has(driver[w]) || w === clk) continue;
    classes.set(vn[w], [...(classes.get(vn[w]) ?? []), w]);
  }

  /** Greedy choice of disjoint regions among `pool`, largest saving first, then nested. */
  const choose = (pool: Set<number>, exclude: Set<number>): Region[] => {
    const cands: Array<{ seeds: number[]; v: 0 | 1; size: number }> = [];
    for (const seeds of classes.values()) {
      if (seeds.some((w) => exclude.has(w))) continue;
      const v = K[1][seeds[0]] as 0 | 1;
      const size = evals(lowRegion(seeds, v, pool), lowPos);
      if (size >= minSaving) cands.push({ seeds, v, size });
    }
    cands.sort((a, b) => b.size - a.size || a.seeds[0] - b.seeds[0]);
    const free = new Set(pool);
    const out: Region[] = [];
    for (const c of cands) {
      const r = lowRegion(c.seeds, c.v, free);
      if (evals(r, lowPos) < minSaving) continue;
      for (const gi of r) free.delete(gi);
      out.push({ w: c.seeds[0], seeds: c.seeds, v: c.v, gates: r, children: choose(r, new Set([...exclude, ...c.seeds])) });
    }
    return out;
  };
  const top = choose(new Set(lowOrder), new Set([clk]));

  // HIGH regions and flags.
  const flagBase = opts.flagBase ?? net.netNames.length;
  const flags: number[] = [];
  const highGates = new Set(highOrder);
  const highRegion = new Map<Region, Set<number>>();
  const assignHigh = (rs: Region[]) => {
    for (const r of rs) {
      const allowed = new Set([...r.gates].filter((gi) => highGates.has(gi)));
      const h = greatest(allowed, (n) => K[1][n] !== X);
      if (evals(h, highPos) >= minSaving) {
        r.flag = flagBase + flags.length;
        flags.push(r.flag);
        highRegion.set(r, h);
      }
      assignHigh(r.children);
    }
  };
  assignHigh(top);

  // Build the item lists.
  let blocks = 0;
  const lowGuard = (r: Region): Expr => (r.v === 0 ? { var: r.w } : { not: { var: r.w } });
  // segment() makes blocks whose guard is the very object passed in: that identifies them.
  const buildLow = (items: GItem[], rs: Region[]): GItem[] => {
    for (const r of rs) {
      const g = lowGuard(r);
      items = segment(items, r.gates, g, gates);
      for (const it of items)
        if (typeof it !== "number" && it.guard === g) {
          blocks++;
          it.items = buildLow(it.items, r.children);
          if (r.flag !== undefined) it.setFlag = { id: r.flag, value: 1 };
        }
    }
    return items;
  };
  const buildHigh = (items: GItem[], rs: Region[]): GItem[] => {
    for (const r of rs) {
      const h = highRegion.get(r);
      if (!h || r.flag === undefined) {
        items = buildHigh(items, r.children);
        continue;
      }
      const g: Expr = { var: r.flag };
      items = segment(items, h, g, gates);
      const mine = items.filter((it): it is GBlock => typeof it !== "number" && it.guard === g);
      mine.forEach((b) => {
        blocks++;
        b.items = buildHigh(b.items, r.children);
      });
      // The flag is cleared once, at the end of the last block (pieces before it must not).
      if (mine.length) mine[mine.length - 1].setFlag = { id: r.flag, value: 0 };
      else throw new Error(`gating: HIGH region of ${net.netNames[r.w]} not found in its pass`);
    }
    return items;
  };
  const low = buildLow([...lowOrder], top);
  const high = buildHigh([...highOrder], top);
  return { passes: [low, high], flags, blocks };
}

/** Structural value numbers: nets with equal numbers carry equal values once their cones are
 * evaluated. Unique for top inputs, loop nets, nets written more than once in LOW. */
function valueNumbers(net: FlatNetlist, lowPos: Map<number, number[]>, cyclic: Set<number>): number[] {
  const { gates, driver } = net;
  const vn = new Array<number>(net.netNames.length).fill(-1);
  const intern = new Map<string, number>();
  const unique = (n: number) => {
    intern.set(`#${n}`, intern.size);
    return (vn[n] = intern.get(`#${n}`)!);
  };
  const onStack = new Set<number>();
  const sym = new Set(["AND", "OR", "NAND", "NOR", "XOR", "XNOR"]);
  const visit = (n: number): number => {
    if (vn[n] >= 0) return vn[n];
    const d = driver[n];
    if (n <= 1 || d < 0 || cyclic.has(d) || onStack.has(n) || (lowPos.get(d)?.length ?? 0) > 1) return unique(n);
    onStack.add(n);
    const g = gates[d];
    const ins = g.in.map(visit);
    onStack.delete(n);
    if (vn[n] >= 0) return vn[n]; // became unique while on the stack (a loop through n)
    if (sym.has(g.type)) ins.sort((a, b) => a - b);
    const key = `${g.type}${lowPos.has(d) ? "L" : "S"}(${ins.join(",")})`;
    if (!intern.has(key)) intern.set(key, intern.size);
    return (vn[n] = intern.get(key)!);
  };
  for (let n = 0; n < net.netNames.length; n++) visit(n);
  return vn;
}

// ---------- moving evaluations into blocks ----------

interface RW {
  reads: Set<number>;
  writes: Set<number>;
}

function rwOf(it: GItem, gates: FlatNetlist["gates"]): RW {
  if (typeof it === "number") return { reads: new Set(gates[it].in), writes: new Set([gates[it].out]) };
  const rw: RW = { reads: new Set(exprVars(it.guard)), writes: new Set() };
  if (it.setFlag) rw.writes.add(it.setFlag.id);
  for (const c of it.items) {
    const x = rwOf(c, gates);
    x.reads.forEach((n) => rw.reads.add(n));
    x.writes.forEach((n) => rw.writes.add(n));
  }
  return rw;
}

function exprVars(e: Expr): number[] {
  if ("var" in e) return [e.var];
  if ("const" in e) return [];
  if ("not" in e) return exprVars(e.not);
  const [a, b] = "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
  return [...exprVars(a), ...exprVars(b)];
}

const meets = (a: Set<number>, b: Set<number>) => {
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) return true;
  return false;
};
/** Two items may swap places: neither writes what the other reads or writes. */
const commutes = (a: RW, b: RW) => !meets(a.writes, b.reads) && !meets(b.writes, a.reads) && !meets(a.writes, b.writes);
const addRW = (to: RW, x: RW) => {
  x.reads.forEach((n) => to.reads.add(n));
  x.writes.forEach((n) => to.writes.add(n));
};

/** Groups the evaluations of `region` gates in `items` into blocks guarded by `guard`
 * (one block if possible, more if an evaluation cannot be moved past an unrelated one). */
export function segment(items: GItem[], region: Set<number>, guard: Expr, gates: FlatNetlist["gates"]): GItem[] {
  const out: GItem[] = [];
  let cur: GItem[] | null = null;
  let curRW: RW = { reads: new Set(), writes: new Set() };
  let before: GItem[] = [];
  let after: GItem[] = [];
  let afterRW: RW = { reads: new Set(), writes: new Set() };
  const flush = () => {
    if (!cur) return;
    out.push(...before, { guard, items: cur }, ...after);
    cur = null;
    before = [];
    after = [];
    afterRW = { reads: new Set(), writes: new Set() };
  };
  for (const it of items) {
    const inRegion = typeof it === "number" && region.has(it);
    const rw = rwOf(it, gates);
    if (inRegion) {
      if (cur && commutes(rw, afterRW)) {
        cur.push(it);
        addRW(curRW, rw);
        continue;
      }
      flush();
      cur = [it];
      curRW = { reads: new Set([...rw.reads, ...exprVars(guard)]), writes: new Set(rw.writes) };
      continue;
    }
    if (!cur) {
      out.push(it);
      continue;
    }
    if (commutes(rw, curRW) && commutes(rw, afterRW)) before.push(it);
    else {
      after.push(it);
      addRW(afterRW, rw);
    }
  }
  flush();
  return out;
}
