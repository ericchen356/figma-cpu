// One clock tick of a silicon netlist, specialized to known state bits, as Figma actions.
//
// silicon builds every register from gated D latches (src/cells/latches.ts: Q = D·EN + Q·¬EN as
// the gates nen, take, hold, merge): a flip-flop is a master latch open while CLK is low and a
// slave open while CLK is high; a RAM bit is one latch written while CLK is low. So a tick is:
// with CLK low, the combinational logic settles from the registers' outputs; every master and RAM
// latch whose enable is 1 takes its D; then, with CLK high, every slave takes its master. Nothing
// else changes state (SILICON.md §2 guarantees every loop goes through a latch).
//
// Given some state bits as constants (the opcode and T-state, for one case of the CPU's dispatch),
// constants fold through the gates: an enable that is 0 drops its register, a gate whose output
// is fixed or equals one of its inputs disappears, and what is left is the gates whose output can
// matter this tick, in dependency order, then the latch commits. An enable that still depends on
// the data (a conditional jump) commits through the latch's own equation instead of an IF, because
// the dispatch around this list is already a conditional and Figma rejects one inside another.
import type { FlatGate, FlatNetlist } from "../../silicon/src/netlist/types";
import { NET0, NET1 } from "../../silicon/src/netlist/types";
import { and, eq, neq, not, or } from "../../silicon/src/prototype/plan";
import type { Expr, PlanAction } from "../../silicon/src/prototype/types";

export interface Latch {
  path: string;
  d: number;
  en: number;
  q: number;
  /** Indices of its four gates. */
  gates: number[];
  /** A slave latch (enable = CLK) and the master that feeds it. */
  master?: Latch;
}

export interface LatchMap {
  latches: Latch[];
  /** Masters and single (RAM) latches: what the LOW pass loads. */
  loaders: Latch[];
  /** Slaves: what the HIGH pass copies from their masters. */
  slaves: Latch[];
  latchGates: Set<number>;
  /** Combinational gates in dependency order (inputs first). */
  order: number[];
  clk: number;
}

/** Finds every latch of `net` by its gate names, and orders the rest of the gates. */
export function latchMap(net: FlatNetlist): LatchMap {
  const byPath = new Map(net.gates.map((g, i) => [g.path, i]));
  const clk = net.aliases.get("CLK");
  if (clk === undefined) throw new Error("no CLK");
  const latches: Latch[] = [];
  const latchGates = new Set<number>();
  net.gates.forEach((g, i) => {
    if (g.type !== "OR" || !g.path.endsWith("/merge")) return;
    const path = g.path.slice(0, -"/merge".length);
    const [take, hold, nen] = ["take", "hold", "nen"].map((n) =>
      byPath.get(`${path}/${n}`),
    );
    if (take === undefined || hold === undefined || nen === undefined) return;
    const t = net.gates[take];
    if (t.type !== "AND" || net.gates[nen].in[0] !== t.in[1])
      throw new Error(`latch ${path} is not a gated D latch`);
    latches.push({
      path,
      d: t.in[0],
      en: t.in[1],
      q: g.out,
      gates: [nen, take, hold, i],
    });
    for (const x of [nen, take, hold, i]) latchGates.add(x);
  });
  const byQ = new Map(latches.map((l) => [l.q, l]));
  const slaves: Latch[] = [];
  const loaders: Latch[] = [];
  for (const l of latches) {
    if (l.en === clk) {
      const m = byQ.get(l.d);
      if (!m) throw new Error(`slave ${l.path} is not fed by a master latch`);
      l.master = m;
      slaves.push(l);
    } else loaders.push(l);
  }
  // nothing but a slave may read a master's output (the masters are open during the LOW pass)
  const masterQ = new Set(slaves.map((s) => s.master!.q));
  net.gates.forEach((g, i) => {
    if (latchGates.has(i)) return;
    for (const n of g.in)
      if (masterQ.has(n))
        throw new Error(`${g.path} reads master output ${net.netNames[n]}`);
  });
  const order: number[] = [];
  const state = new Uint8Array(net.gates.length);
  const visit = (gi: number) => {
    if (state[gi] === 2) return;
    if (state[gi] === 1)
      throw new Error(`combinational loop at ${net.gates[gi].path}`);
    state[gi] = 1;
    for (const n of net.gates[gi].in) {
      const d = net.driver[n];
      if (d >= 0 && !latchGates.has(d)) visit(d);
    }
    state[gi] = 2;
    order.push(gi);
  };
  net.gates.forEach((_, i) => {
    if (!latchGates.has(i)) visit(i);
  });
  return { latches, loaders, slaves, latchGates, order, clk };
}

type K = 0 | 1 | 2;
function eval3(t: FlatGate["type"], a: K, b: K): K {
  const inv = (x: K): K => (x === 2 ? 2 : ((x ^ 1) as K));
  const andK = (x: K, y: K): K =>
    x === 0 || y === 0 ? 0 : x === 1 && y === 1 ? 1 : 2;
  const orK = (x: K, y: K): K =>
    x === 1 || y === 1 ? 1 : x === 0 && y === 0 ? 0 : 2;
  const xorK = (x: K, y: K): K => (x === 2 || y === 2 ? 2 : ((x ^ y) as K));
  switch (t) {
    case "BUF":
      return a;
    case "NOT":
      return inv(a);
    case "AND":
      return andK(a, b);
    case "OR":
      return orK(a, b);
    case "NAND":
      return inv(andK(a, b));
    case "NOR":
      return inv(orK(a, b));
    case "XOR":
      return xorK(a, b);
    case "XNOR":
      return inv(xorK(a, b));
  }
}

function gateOf(t: FlatGate["type"], a: Expr, b: Expr): Expr {
  switch (t) {
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

export interface TickOptions {
  /** State or input nets held at a constant for this tick (e.g. the opcode and T bits, RESET = 0). */
  ties: Map<number, 0 | 1>;
  /** Gates re-evaluated after the commit when any of `refreshWhen` loads (e.g. a display decoder). */
  refresh?: { gates: number[]; when: Set<number> };
  /** Fold a gate into the one expression that reads it (or a NOT of a wire into every reader),
   * up to this expression depth, instead of storing its wire: far fewer actions a tick, still all
   * two-input gates, but a folded gate's wire (and its lamp) keeps its last value. */
  fold?: number;
  /** With `fold`, also fold a gate that several expressions read, when the copies this adds come to
   * at most this many expression nodes. */
  share?: number;
  /** Wires always stored, even when they could be folded (e.g. the ones a display shows). */
  keep?: Set<number>;
  /** Commit a flip-flop straight into its slave, Q = D·EN + Q·¬EN, one write instead of the
   * master's and then the slave's. Its master keeps its last value, and nothing but a commit reads
   * a master, so a tick without `direct` must hold a master through its slave (see `heldBySlave`). */
  direct?: boolean;
  /** A master that does not take D holds its slave's value, not its own: equal in the circuit, where
   * the slave copied the master the tick before, but right even after `direct` ticks left the
   * master behind. */
  heldBySlave?: boolean;
  /** Latches (by the output of the latch that takes D: a flip-flop's master) this tick leaves to
   * the caller: no commit, and none of the logic only they need. */
  skip?: Set<number>;
  /** Without `direct`: leave the HIGH pass (every slave takes its master) to the caller, which runs
   * it after these actions; the refresh then reads the masters that loaded. */
  noHighPass?: boolean;
  /** State nets read through other variables (copies the caller makes before the tick). */
  readAs?: Map<number, number>;
  /** Latches and refreshed wires written to other variables (that the caller copies back). */
  writeAs?: Map<number, number>;
}

export interface TickPlan {
  actions: PlanAction[];
  /** Latches this tick can load (enable not constantly 0). */
  loading: number;
}

/** The actions of one tick under `ties`, equal to a two-pass settle of the whole netlist. */
export function tickPlan(
  net: FlatNetlist,
  lm: LatchMap,
  o: TickOptions,
): TickPlan {
  const val = new Uint8Array(net.netNames.length).fill(2) as unknown as K[];
  val[NET0] = 0;
  val[NET1] = 1;
  val[lm.clk] = 0;
  for (const [n, v] of o.ties) val[n] = v;
  // what each net is, as an expression of the state: a constant, a state net, or a gate
  const expr: Array<Expr | undefined> = new Array(net.netNames.length);
  const readNet = (n: number) => o.readAs?.get(n) ?? n;
  const writeNet = (n: number) => o.writeAs?.get(n) ?? n;
  const exprOf = (n: number): Expr => {
    if (val[n] !== 2) return { const: val[n] as 0 | 1 };
    return expr[n] ?? { var: readNet(n) };
  };
  const real = new Set<number>(); // gates that stay gates (not folded away)
  for (const gi of lm.order) {
    const g = net.gates[gi];
    const v = eval3(g.type, val[g.in[0]], g.in.length > 1 ? val[g.in[1]] : 0);
    val[g.out] = v;
    if (v !== 2) continue;
    const e = gateOf(
      g.type,
      exprOf(g.in[0]),
      g.in.length > 1 ? exprOf(g.in[1]) : { const: 0 },
    );
    if ("var" in e)
      expr[g.out] = e; // an identity gate: its output is one of its inputs
    else {
      expr[g.out] = { var: g.out };
      real.add(gi);
    }
  }
  // the latches that can load, and the gates their D and EN need
  const loading = lm.loaders.filter(
    (l) => val[l.en] !== 0 && !o.skip?.has(l.q),
  );
  const need = new Set<number>();
  const want = (n: number) => {
    const d = net.driver[n];
    if (d < 0 || !real.has(d) || need.has(d)) return;
    need.add(d);
    for (const i of net.gates[d].in) {
      const e = exprOf(i);
      if ("var" in e) want(e.var);
    }
  };
  for (const l of loading) {
    for (const n of [l.d, l.en]) {
      const e = exprOf(n);
      if ("var" in e) want(e.var);
    }
  }
  const ins = (g: FlatGate) =>
    g.in.length > 1 ? [g.in[0], g.in[1]] : [g.in[0]];
  // how often this tick's expressions read each wire (the latch equation reads EN twice)
  const reads = new Map<number, number>();
  const read = (e: Expr) => {
    if ("var" in e) reads.set(e.var, (reads.get(e.var) ?? 0) + 1);
  };
  for (const gi of need) for (const i of ins(net.gates[gi])) read(exprOf(i));
  for (const l of loading) {
    read(exprOf(l.d));
    if (val[l.en] !== 1) (read(exprOf(l.en)), read(exprOf(l.en)));
  }
  const folded = new Map<number, Expr>(); // a gate's wire -> its expression, when not stored
  const sub = (e: Expr): Expr => ("var" in e ? (folded.get(e.var) ?? e) : e);
  const foldable = (n: number, to: Expr, readers: number) =>
    o.fold !== undefined &&
    !o.keep?.has(n) &&
    (readers <= 1 ||
      ("not" in to && "var" in to.not) ||
      size(to) * (readers - 1) <= (o.share ?? 0)) &&
    depth(to) <= o.fold;
  const actions: PlanAction[] = [];
  for (const gi of lm.order) {
    if (!need.has(gi)) continue;
    const g = net.gates[gi];
    const [a, b] = ins(g).map((i) => sub(exprOf(i)));
    const to = gateOf(g.type, a, b ?? { const: 0 });
    if (foldable(g.out, to, reads.get(g.out) ?? 0)) folded.set(g.out, to);
    else actions.push({ set: g.out, to });
  }
  const slaveOf = new Map(lm.slaves.map((s) => [s.master!.q, s.q]));
  // a latch takes D when enabled and otherwise holds `hold`
  const commitOf = (l: Latch, q: number, hold: number) => {
    const d = sub(exprOf(l.d));
    const en = sub(exprOf(l.en));
    return {
      set: writeNet(q),
      to:
        val[l.en] === 1
          ? d
          : or(and(en, d), and(not(en), { var: readNet(hold) })),
    };
  };
  const loaded = new Set<number>();
  if (o.direct) {
    // every commit reads the state from before the tick, so one that reads another's latch goes
    // first (a counter writes its top bit first); a cycle of them needs the masters after all
    // a latch whose next value is its own (a sticky flag this tick cannot set), or the constant it
    // is tied to, needs no write
    const ordered = readersFirst(
      loading
        .map((l) => {
          const q = slaveOf.get(l.q) ?? l.q;
          return commitOf(l, q, q);
        })
        .filter(
          (c) =>
            !("var" in c.to && c.to.var === c.set) &&
            !("const" in c.to && val[c.set] === c.to.const),
        ),
    );
    // (the masters, which `direct` ticks leave behind, then hold through their slaves)
    if (!ordered)
      return tickPlan(net, lm, { ...o, direct: false, heldBySlave: true });
    actions.push(...ordered);
    for (const l of loading) loaded.add(l.q);
  } else {
    // commit: masters and RAM take D (LOW pass), then slaves take their masters (HIGH pass)
    for (const l of loading) {
      const c = commitOf(
        l,
        l.q,
        o.heldBySlave ? (slaveOf.get(l.q) ?? l.q) : l.q,
      );
      // all latches load at once: a folded expression must not read a latch this tick already wrote
      if (o.fold !== undefined && leaves(c.to).some((n) => loaded.has(n)))
        return tickPlan(net, lm, { ...o, fold: undefined });
      actions.push(c);
      loaded.add(l.q);
    }
    if (!o.noHighPass)
      for (const s of lm.slaves)
        if (loaded.has(s.master!.q))
          actions.push({ set: s.q, to: { var: s.master!.q } });
  }
  // a flip-flop that loaded, as the refresh reads it: its master when the slaves copy later
  const masterOf = new Map(lm.slaves.map((s) => [s.q, s.master!.q]));
  const now = (n: number) =>
    !o.direct && o.noHighPass && loaded.has(masterOf.get(n) ?? -1)
      ? masterOf.get(n)!
      : n;
  if (o.refresh && [...o.refresh.when].some((q) => loaded.has(q))) {
    // a refresh gate reads one before it where that one was written, and the state as the tick reads it
    const outs = new Set(o.refresh.gates.map((gi) => net.gates[gi].out));
    const src = (n: number): Expr =>
      n === NET0
        ? { const: 0 }
        : n === NET1
          ? { const: 1 }
          : {
              var: outs.has(n)
                ? writeNet(n)
                : now(n) !== n
                  ? now(n)
                  : readNet(n),
            };
    const inRefresh = new Map<number, number>();
    for (const gi of o.refresh.gates)
      for (const i of ins(net.gates[gi]))
        inRefresh.set(i, (inRefresh.get(i) ?? 0) + 1);
    const refolded = new Map<number, Expr>();
    const resub = (e: Expr): Expr =>
      "var" in e ? (refolded.get(e.var) ?? e) : e;
    for (const gi of o.refresh.gates) {
      const g = net.gates[gi];
      const [a, b] = ins(g).map((i) => resub(src(i)));
      const to = gateOf(g.type, a, b ?? { const: 0 });
      if (foldable(g.out, to, inRefresh.get(g.out) ?? 0))
        refolded.set(g.out, to);
      else actions.push({ set: writeNet(g.out), to });
    }
  }
  return { actions, loading: loading.length };
}

/** The commits in an order where each reads only latches not yet written: a commit that reads
 * another's target goes before it. Null if they read each other in a cycle. */
function readersFirst(commits: PlanAction[]): PlanAction[] | null {
  const sets = commits.map((c) => (c as { set: number }).set);
  const at = new Map(sets.map((q, i) => [q, i]));
  // before[j]: the commits that read j's latch, so must run before j
  const before = commits.map(() => new Set<number>());
  commits.forEach((c, i) => {
    for (const n of leaves((c as { to: Expr }).to)) {
      const j = at.get(n);
      if (j !== undefined && j !== i) before[j].add(i);
    }
  });
  const out: PlanAction[] = [];
  const done = new Set<number>();
  while (out.length < commits.length) {
    const next = commits.findIndex(
      (_, j) => !done.has(j) && [...before[j]].every((i) => done.has(i)),
    );
    if (next < 0) return null;
    done.add(next);
    out.push(commits[next]);
  }
  return out;
}

/** Expression nodes in an expression. */
function size(e: Expr): number {
  if ("var" in e || "const" in e) return 1;
  if ("not" in e) return 1 + size(e.not);
  const [a, b] =
    "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
  return 1 + size(a) + size(b);
}

/** Nesting depth of an expression (a wire or a constant is 0). */
function depth(e: Expr): number {
  if ("var" in e || "const" in e) return 0;
  if ("not" in e) return 1 + depth(e.not);
  const [a, b] =
    "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
  return 1 + Math.max(depth(a), depth(b));
}

/** The wires an expression reads. */
export function leaves(e: Expr): number[] {
  if ("var" in e) return [e.var];
  if ("const" in e) return [];
  if ("not" in e) return leaves(e.not);
  const [a, b] =
    "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
  return [...leaves(a), ...leaves(b)];
}
