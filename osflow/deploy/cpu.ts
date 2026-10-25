// Builds silicon's general-purpose 8-bit CPU (silicon/src/cpu: 4,803 gates, 64 bytes of latch
// RAM, programs count / mul / fib / perceptron) into a Figma file, with no plugin, in a form that
// runs whole programs in Present mode.
//
// The architecture is the gate netlist itself; what is optimized is how a clock tick reaches
// Figma. A full tick evaluates about 4,200 gates, past what one event survives (the viewer runs a
// reaction's actions recursively: on a cold page 1,000 ran and 1,200 overflowed its stack). But in
// any tick only the gates that the current control state can reach do anything. So each
// (opcode, T-state) pair gets its own specialized tick (deploy/tick.ts: the opcode and T bits tied,
// constants folded through the gates, only the logic that can load a register kept): 22 to 324
// gate evaluations instead of 4,200, dispatched by single-block IFs on the dispatch bits (Figma
// keeps only an IF and an ELSE of a CONDITIONAL, and rejects an IF inside an IF). A latch whose
// enable still depends on the data (a conditional jump, the OUT port) is written as its gate
// equation, Q = D·EN + Q·¬EN.
//
// Step evaluates every gate a tick needs into its own wire, so the gate map lights the tick. Run
// and Instruction share a faster form: two overlays whose timers each run one instruction and swap
// in the other (Instruction closes after one). What it is built around, measured in this file
// (deploy/README.md): a timer event costs about 20 ms, every expression node Figma evaluates about
// 6 µs, a write that leaves its variable as it was about 0.12 ms, and a write that changes it more
// the larger the stored reactions that name the variable. So a Run event runs a whole instruction
// (the IFs laid out by T-state, which moves once per T-state, not in every body); gates are folded
// into the expressions that read them, a flip-flop is written once (its slave), and a heavy tick is
// split by the bits of the mux it spends its writes on; and Step's large reaction names none of the
// variables a run changes (it works on shadow copies, which small reactions copy in and back).
import { assemble, OUT_ADDR, PROGRAMS, RAM_BYTES } from "../../silicon/src/isa";
import { cpuNetlist, PROBES, ramBit } from "../../silicon/src/cpu";
import { powerOn } from "../../silicon/src/compile";
import { NET0, NET1, type FlatNetlist } from "../../silicon/src/netlist/types";
import { and, not, or, ref } from "../../silicon/src/prototype/plan";
import type { Expr, PlanAction } from "../../silicon/src/prototype/types";
import { latchMap, leaves, tickPlan } from "./tick";
import { fnv, runtimeCode, type Chunk } from "./nathan";

export interface CpuGenerated {
  chunks: Chunk[];
  stats: {
    gates: number;
    wires: number;
    cases: number;
    groups: number;
    dispatchStored: number;
    worstTick: number;
    meanTick: number;
    stateNets: number;
    /** Run's tick bodies: their IFs (an instruction judges them all), the longest body, the most
     * actions an instruction runs, and instructions per timer event. */
    fastGroups: number;
    worstFast: number;
    perInstruction: number;
    instructionsPerEvent: number;
  };
  net: FlatNetlist;
  wireOf: Map<number, number>;
  /** Each (opcode, T-state)'s Step body, and its Run body or bodies (one per value of the bits it
   * is split on). */
  ticks: Array<{
    op: number;
    t: number;
    /** The tick sets HALTED, so its bodies move T themselves. */
    halts: boolean;
    full: PlanAction[];
    fast: Array<{ extra: Array<[number, 0 | 1]>; actions: PlanAction[] }>;
  }>;
  /** T's move from each T-state, run after a body that leaves T alone while the CPU runs. */
  tNext: PlanAction[][];
  /** Step's copies before its body (latches into their shadows, masters from slaves) and after it
   * (slaves from masters, the RAM and the digits from their shadows). */
  stepping: { sync: PlanAction[]; finish: PlanAction[] };
  names: {
    frame: string;
    root: string;
    chart: string;
    step: string;
    instruction: string;
    run: string;
    /** The overlays (top-level frames): the two a run swaps between, then Step's chain and Load's. */
    overlays: string[];
    /** The link of Step's chain that runs the tick's body. */
    stepBody: string;
    /** Step's body in pieces, one overlay event each (the first is stepBody). */
    stepBodies: string[];
    programs: Record<string, string>;
  };
  /** The variables holding the tick counter. */
  counters: { ticks: string; text: string };
}

const FRAME = "Silicon CPU · runs in Present (gate level)";
const ROOT = "cpu";
const CHART = "gate map";
const PREFIX = "c/";
// panel wires beyond the netlist. Figma keeps only an IF and an ELSE of a CONDITIONAL, so a Step is
// one single-block IF per body. RAN is cleared before them and set by the body that runs: the IFs
// after it (judged on a state that body already changed) are off, so exactly the IF of the pre-tick
// state runs. MODE is 1 while the running overlay runs one instruction (Instruction), 0 while it
// runs to HALT (Run).
const RAN = -101;
const MODE = -102;
// the program a Load button picked (count, mul, fib = 0, 1, 2), for the loading overlay
const SEL = [-103, -104];
// Run opens a small overlay whose timer runs a batch of instructions and swaps in its twin, whose
// timer runs the next: Figma's prototype engine clocks the CPU until the overlay closes itself. Figma
// rejects a swap to the overlay itself, so there are two. Instruction opens the same overlay, Step
// two 1×1 ones that run a tick and close, and Load a 1×1 one: each piece of code is stored once,
// because Figma's cost of changing a variable grows with the stored actions that write it.
const RUN = ["running A", "running B"] as const;
// Step's and Load's chains of 1×1 overlays, and the most copies one link of them makes
const STEP = "step";
const LOADING = "loading";
const PIECE = 64;
/** The most actions one event may run (the viewer runs them recursively; see deploy/README.md). */
export const EVENT_BUDGET = 600;
const TIMEOUT = 0.001;
const LOADS = ["count", "mul", "fib", "perceptron"] as const;
const COLORS: Record<string, string> = {
  A: "#3DDC84",
  O: "#29ADFF",
  N: "#FF004D",
  X: "#FFA300",
  R: "#FF77A8",
  B: "#C2C3C7",
  D: "#B48EF6",
  E: "#FFEC27",
};
const TYPE_CODE: Record<string, string> = {
  AND: "A",
  OR: "O",
  NOT: "N",
  XOR: "X",
  NOR: "R",
  BUF: "B",
  NAND: "D",
  XNOR: "E",
};
const LAMP = { size: 6, pitch: 8, perRow: 44, pad: 10, top: 26 };

export function generateCpu(
  o: {
    maxChunk?: number;
    limit?: number;
    fold?: number;
    share?: number;
    /** Instructions a Run event runs, budget allowing (each is another stored copy of the code). */
    perEvent?: number;
  } = {},
): CpuGenerated {
  // chunks are loaded into the Figma tab from files (deploy/README.md), so they may be large
  const maxChunk = o.maxChunk ?? 400000;
  const limit = o.limit ?? 2000000;
  const net = cpuNetlist();
  const programs = Object.fromEntries(
    LOADS.map((p) => [p, assemble(PROGRAMS[p]).bytes]),
  );
  const pokes = (bytes: number[]) => {
    const out: Record<string, number> = {};
    for (let a = 0; a < RAM_BYTES; a++)
      for (let b = 0; b < 8; b++)
        out[ramBit(a, b)] = ((bytes[a] ?? 0) >> b) & 1;
    return out;
  };
  const initOf = Object.fromEntries(
    LOADS.map((p) => [p, powerOn(net, pokes(programs[p]))]),
  );

  // ---------- wires ----------
  const used = new Set<number>();
  for (const g of net.gates) {
    used.add(g.out);
    for (const n of g.in) used.add(n);
  }
  for (const p of net.ports) for (const n of p.nets) used.add(n);
  used.delete(NET0);
  used.delete(NET1);
  const ids = [...used].sort((a, b) => a - b);
  const wireOf = new Map(ids.map((id, i) => [id, i]));
  const panel = [RAN, MODE, ...SEL];
  panel.forEach((id, i) => wireOf.set(id, ids.length + i));
  // Figma's cost of changing a variable grows with the size of every stored reaction that names
  // it (deploy/README.md), so Step's large reaction names none of the state a run changes: it
  // reads shadow copies of the latches, and writes the RAM and the 7-segment outputs to shadows,
  // which two small reactions copy in before it and back after it.
  const lm = latchMap(net);
  const masterQs = new Set(lm.slaves.map((s) => s.master!.q));
  const slaveQs = lm.slaves.map((s) => s.q);
  const ramQs = lm.loaders.map((l) => l.q).filter((q) => !masterQs.has(q));
  const segNets = net.ports
    .filter((p) => /^SEG_/.test(p.name))
    .flatMap((p) => p.nets);
  const shadowed = [...slaveQs, ...ramQs, ...segNets];
  const shadowOf = new Map(
    shadowed.map((n, k) => [n, net.netNames.length + k]),
  );
  shadowed.forEach((n, k) =>
    wireOf.set(shadowOf.get(n)!, ids.length + panel.length + k),
  );
  // ... and Run's ticks keep the gates they cannot fold in temporaries of their own, not in the
  // gates' wires, which Step's large reaction names
  const TEMPS = 256;
  const tmp0 = net.netNames.length + shadowed.length;
  for (let k = 0; k < TEMPS; k++)
    wireOf.set(tmp0 + k, ids.length + panel.length + shadowed.length + k);
  const unitOf = (id: number) => {
    const d = net.driver[id];
    return d < 0 ? "io" : net.gates[d].path.split("/")[0];
  };
  const unitNames: string[] = [];
  const unitIdx = (name: string) => {
    let i = unitNames.indexOf(name);
    if (i < 0) i = unitNames.push(name) - 1;
    return i;
  };
  const units = ids.map((id) => unitIdx(unitOf(id)));
  for (const _ of panel) units.push(unitIdx("panel"));
  for (const _ of shadowed) units.push(unitIdx("shadow"));
  for (let k = 0; k < TEMPS; k++) units.push(unitIdx("temp"));
  const init = initOf.mul;
  // the file opens with mul loaded (SEL = 1)
  const initBits =
    ids.map((id) => (init[id] ? "1" : "0")).join("") +
    "0010" +
    shadowed.map((n) => (init[n] ? "1" : "0")).join("") +
    "0".repeat(TEMPS);
  const b36 = (n: number) => n.toString(36);
  const w = (id: number) => {
    const i = wireOf.get(id);
    if (i === undefined)
      throw new Error(`net ${net.netNames[id] ?? id} has no wire`);
    return b36(i);
  };
  const ex = (x: Expr): string => {
    if ("var" in x) return w(x.var);
    if ("const" in x) return x.const ? "T" : "F";
    if ("not" in x) return `!${ex(x.not)}`;
    const [op, [a, b]] =
      "and" in x
        ? (["&", x.and] as const)
        : "or" in x
          ? (["|", x.or] as const)
          : "eq" in x
            ? (["=", x.eq] as const)
            : (["^", x.neq] as const);
    return `${op}${ex(a)},${ex(b)}`;
  };
  const acts = (list: PlanAction[]): string =>
    list
      .map((a) => {
        if (!("set" in a))
          throw new Error(
            "a conditional reached the encoder: flatten it first",
          );
        return `${w(a.set)}:${"var" in a.to ? `=${w(a.to.var)},T` : ex(a.to)}`;
      })
      .join(";");

  // ---------- one specialized tick per (opcode, T-state) ----------
  const bit = (name: string, i: number) => {
    const id = net.aliases.get(`${name}[${i}]`);
    if (id === undefined) throw new Error(`no net ${name}[${i}]`);
    return id;
  };
  const opBits = [4, 5, 6, 7].map((i) => bit(PROBES.IR.name, i));
  const tBits = [0, 1, 2].map((i) => bit(PROBES.T.name, i));
  // the 7-segment decoders feed no register, so a tick that loads OUT re-evaluates them
  const segOrder = topo(
    net,
    net.gates
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => /^seg_(lo|hi)\b/.test(g.path))
      .map((x) => x.i),
  );
  const refresh = {
    gates: segOrder,
    when: new Set(
      lm.loaders.filter((l) => l.path.startsWith("outreg/")).map((l) => l.q),
    ),
  };
  const reset = net.aliases.get("RESET")!;

  // Two sets of tick bodies. Step's evaluates every gate a tick needs, each into its own wire, so
  // every lamp it touches shows the tick. Run's and Instruction's are the same logic, faster: a gate
  // is folded into the expressions that read it (tick.ts `fold` and `share`), a flip-flop commits
  // straight into its slave (`direct`: Step's masters hold through their slaves, so the masters a
  // run leaves behind never matter), and a heavy tick whose cost is a mux over register or RAM bits
  // is specialized on the bits that select it (the RAM address for a store, the register fields for
  // a register write), one body per value, so the mux folds away.
  const marBits = [0, 1, 2, 3].map((i) => bit(PROBES.MAR.name, i));
  const irLow = [0, 1, 2, 3].map((i) => bit(PROBES.IR.name, i));
  const keep = new Set(
    net.ports.filter((p) => /^SEG_/.test(p.name)).flatMap((p) => p.nets),
  );
  // past these, the writes saved cost less than the expression nodes they add (each node Figma
  // evaluates costs about 6 µs, an unchanged write 0.12 ms: osflow/deploy/README.md)
  const fold = o.fold ?? 12;
  const share = o.share ?? 16;
  // Figma's cost of changing a variable grows with the number of stored actions that write it, and
  // the T-state counter changes every tick. So T moves (and the tick counter counts) once per
  // T-state in each copy of the code, after the tick's body, instead of in every body: a body
  // leaves T to that update unless it sets HALTED (the update runs only while the CPU runs).
  const tMasters = tBits.map((q) => {
    const s = lm.slaves.find((x) => x.q === q);
    if (!s) throw new Error(`T bit ${net.netNames[q]} is not a flip-flop`);
    return s.master!.q;
  });
  const halted = net.aliases.get(PROBES.HALTED.name)!;
  const readAs = new Map(
    [...slaveQs, ...ramQs].map((n) => [n, shadowOf.get(n)!]),
  );
  const writeAs = new Map(
    [...ramQs, ...segNets].map((n) => [n, shadowOf.get(n)!]),
  );
  type Case = { op: number; t: number; extra: Array<[number, 0 | 1]> };
  const tiesOf = (c: Case) => {
    const ties = new Map<number, 0 | 1>([[reset, 0]]);
    opBits.forEach((id, b) => ties.set(id, ((c.op >> b) & 1) as 0 | 1));
    tBits.forEach((id, b) => ties.set(id, ((c.t >> b) & 1) as 0 | 1));
    for (const [id, v] of c.extra) ties.set(id, v);
    return ties;
  };
  const plan = (c: Case, fast: boolean, skip?: Set<number>) =>
    fast
      ? privateGates(
          tickPlan(net, lm, {
            ties: tiesOf(c),
            refresh,
            fold,
            share,
            keep,
            direct: true,
            skip,
          }).actions,
        )
      : tickPlan(net, lm, {
          ties: tiesOf(c),
          refresh,
          heldBySlave: true,
          noHighPass: true,
          readAs,
          writeAs,
        }).actions;
  const sets = (a: PlanAction) => ("set" in a ? a.set : -1);
  const readsOf = (a: PlanAction) => ("set" in a ? leaves(a.to) : []);
  // a gate's wire (not a latch, not a wire a display shows) goes to the next free temporary
  const gateWire = (n: number) =>
    n < net.netNames.length &&
    net.driver[n] >= 0 &&
    !lm.latchGates.has(net.driver[n]) &&
    !keep.has(n);
  function privateGates(list: PlanAction[]): PlanAction[] {
    const at = new Map<number, number>();
    const rename = (e: Expr): Expr => {
      if ("var" in e) return { var: at.get(e.var) ?? e.var };
      if ("const" in e) return e;
      if ("not" in e) return { not: rename(e.not) };
      if ("and" in e) return { and: [rename(e.and[0]), rename(e.and[1])] };
      if ("or" in e) return { or: [rename(e.or[0]), rename(e.or[1])] };
      if ("eq" in e) return { eq: [rename(e.eq[0]), rename(e.eq[1])] };
      return { neq: [rename(e.neq[0]), rename(e.neq[1])] };
    };
    return list.map((a) => {
      if (!("set" in a)) return a;
      const to = rename(a.to);
      if (!gateWire(a.set)) return { set: a.set, to };
      if (at.size === TEMPS)
        throw new Error(`a tick stores more than ${TEMPS} gates`);
      const t = tmp0 + at.size;
      at.set(a.set, t);
      return { set: t, to };
    });
  }
  // whether a tick sets HALTED: its flip-flop's next value is not just its own
  const haltMaster = lm.slaves.find((s) => s.q === halted)?.master?.q;
  if (haltMaster === undefined) throw new Error("HALTED is not a flip-flop");
  const notHalt = new Set(
    lm.loaders.map((l) => l.q).filter((q) => q !== haltMaster),
  );
  const haltsAt = (c: Case) => {
    const list = tickPlan(net, lm, {
      ties: tiesOf(c),
      fold,
      share,
      direct: true,
      skip: notHalt,
    }).actions;
    // a tick that might or might not halt would move T twice in Step (see stepMoves)
    for (const a of list)
      if (readsOf(a).some((n) => n !== halted))
        throw new Error(`op ${c.op} T${c.t} halts on a condition`);
    return list.length > 0;
  };
  // where T goes from T-state j: j + 1, or 0 where an instruction ends, as gates of the opcode
  const others = new Set(
    lm.loaders.map((l) => l.q).filter((q) => !tMasters.includes(q)),
  );
  const tNext = Array.from({ length: 8 }, (_, j) => {
    const ties = new Map<number, 0 | 1>([
      [reset, 0],
      [halted, 0],
    ]);
    tBits.forEach((id, b) => ties.set(id, ((j >> b) & 1) as 0 | 1));
    const list = tickPlan(net, lm, {
      ties,
      fold,
      share,
      direct: true,
      skip: others,
    }).actions;
    // gates of the opcode (a shared one stored first), then T's bits
    const known = new Set(opBits);
    for (const a of list) {
      const latch = lm.latches.some((l) => l.q === sets(a));
      if (
        (latch && !tBits.includes(sets(a))) ||
        !readsOf(a).every((n) => known.has(n))
      )
        throw new Error(
          `T's next value at T${j} is not a gate expression of the opcode`,
        );
      known.add(sets(a));
    }
    return privateGates(list);
  });
  const variants = (op: number, t: number, bits: number[]): Case[] =>
    Array.from({ length: 1 << bits.length }, (_, v) => ({
      op,
      t,
      extra: bits.map((id, b): [number, 0 | 1] => [
        id,
        ((v >> b) & 1) as 0 | 1,
      ]),
    }));
  const SPECIALIZE_GAIN = 40; // writes a tick must save to be split by the bits of its mux
  const full = new Map<string, Case[]>();
  const fast = new Map<string, Case[]>();
  const addBody = (into: Map<string, Case[]>, c: Case, code: string) => {
    if (!into.has(code)) into.set(code, []);
    into.get(code)!.push(c);
  };
  const COUNT = "@inc:cpu/ticks";
  let worstTick = 0;
  let sumTick = 0;
  const stepLists: Array<{ c: Case; list: PlanAction[] }> = [];
  let worstFast = 0;
  const worstAt = new Array<number>(8).fill(0);
  const ticks: CpuGenerated["ticks"] = [];
  for (let op = 0; op < 16; op++)
    for (let t = 0; t < 8; t++) {
      const c: Case = { op, t, extra: [] };
      const halts = haltsAt(c);
      // Step's body writes gates and masters; one copy after it takes every master into its slave
      // (stepCopy), so a slave has one writer in Step's code, not one per body. T's master moves
      // only in a tick that halts.
      const list = plan(c, false).filter(
        (a) => halts || !tMasters.includes(sets(a)),
      );
      worstTick = Math.max(worstTick, list.length);
      sumTick += list.length;
      addBody(full, c, acts(list));
      stepLists.push({ c, list });
      const skip = halts ? undefined : new Set(tMasters);
      let best = [{ c, list: plan(c, true, skip) }];
      for (const bits of [marBits, irLow]) {
        const split = variants(op, t, bits).map((v) => ({
          c: v,
          list: plan(v, true, skip),
        }));
        const cost = (xs: typeof best) =>
          Math.max(...xs.map((x) => x.list.length));
        if (cost(split) + SPECIALIZE_GAIN <= cost(best)) best = split;
      }
      for (const x of best) {
        worstFast = Math.max(worstFast, x.list.length);
        worstAt[t] = Math.max(worstAt[t], x.list.length + (halts ? 1 : 0));
        // T's update after the body reads the opcode, so the body must not change it
        if (
          !halts &&
          tNext[t].some((a) => readsOf(a).length > 0) &&
          x.list.some((a) => opBits.includes(sets(a)))
        )
          throw new Error(
            `op ${op} T${t} loads the opcode that T's next value reads`,
          );
        addBody(
          fast,
          x.c,
          [acts(x.list), ...(halts ? [COUNT] : [])].filter(Boolean).join(";"),
        );
      }
      ticks.push({
        op,
        t,
        halts,
        full: list,
        fast: best.map((x) => ({ extra: x.c.extra, actions: x.list })),
      });
    }

  // a dispatch: one IF per group of cases that share a body, each condition a gate expression of
  // the live dispatch bits and a guard
  const lit = (id: number, v: number): Expr => (v ? ref(id) : not(ref(id)));
  const andAll = (xs: Expr[]): Expr =>
    xs.length === 1
      ? xs[0]
      : and(
          andAll(xs.slice(0, xs.length >> 1)),
          andAll(xs.slice(xs.length >> 1)),
        );
  const orAll = (xs: Expr[]): Expr =>
    xs.length === 1
      ? xs[0]
      : or(orAll(xs.slice(0, xs.length >> 1)), orAll(xs.slice(xs.length >> 1)));
  const caseIs = (c: Case, withOp: boolean, rd: (id: number) => number) =>
    andAll([
      ...(withOp ? opBits.map((id, b) => lit(rd(id), (c.op >> b) & 1)) : []),
      ...tBits.map((id, b) => lit(rd(id), (c.t >> b) & 1)),
      ...c.extra.map(([id, v]) => lit(rd(id), v)),
    ]);
  const ifsOf = (
    bodies: Map<string, Case[]>,
    guard: Expr,
    setsRan: boolean,
    rd: (id: number) => number = (id) => id,
  ) => {
    const groups = [...bodies.entries()].map(([code, cases]) => {
      // cases that differ only in the opcode, all 16 of them, need no opcode bits
      const byRest = new Map<string, Case[]>();
      for (const c of cases) {
        const k = `${c.t}|${c.extra.map(([id, v]) => `${id}=${v}`).join(",")}`;
        if (!byRest.has(k)) byRest.set(k, []);
        byRest.get(k)!.push(c);
      }
      const terms = [...byRest.values()].flatMap((cs) =>
        cs.length === 16
          ? [caseIs(cs[0], false, rd)]
          : cs.map((c) => caseIs(c, true, rd)),
      );
      return { code, cases, cond: orAll(terms) };
    });
    groups.sort((x, y) => y.cases.length - x.cases.length);
    // a body with nothing to write needs no IF (unless it must say it ran)
    const used = groups.filter((g) => g.code || setsRan);
    return {
      count: used.length,
      code: used
        .map(
          (g) =>
            `?${ex(and(guard, g.cond))}{${[...(setsRan ? [`${w(RAN)}:T`] : []), ...(g.code ? [g.code] : [])].join(";")}}`,
        )
        .join(";"),
      stored: used.reduce((n, g) => n + g.code.split(";").length + 2, 0),
    };
  };
  const tIs = (j: number) =>
    andAll(tBits.map((id, b) => lit(id, (j >> b) & 1)));
  // Step, as a chain of small events. The first ones copy the latches into their shadows (and every
  // master from its slave: a run leaves the masters behind). Then the large one clears RAN and runs
  // one IF per body, judged on the shadows: gates, masters, and the shadows of the RAM and the
  // digits. The last ones copy every master into its slave and the shadows back, and move T from
  // the T-state whose body ran (a body leaves T where it was), once: each move clears RAN. The
  // copies come in pieces, so that a variable a run changes is named only by a small reaction.
  const copies = (pairs: Array<[number, number]>): PlanAction[] =>
    pairs.map(([set, from]) => ({ set, to: { var: from } }));
  const piecesOf = (units: PlanAction[][]): PlanAction[][] => {
    const out: PlanAction[][] = [];
    for (const u of units) {
      const last = out[out.length - 1];
      if (last && last.length + u.length <= PIECE) last.push(...u);
      else out.push([...u]);
    }
    return out;
  };
  // what the moves read is copied back in the moves' own piece
  const moved = new Set([...tBits, ...opBits, halted]);
  const stepSync = piecesOf([
    ...lm.slaves.map((s) =>
      copies([
        [shadowOf.get(s.q)!, s.q],
        [s.master!.q, s.q],
      ]),
    ),
    ...[...ramQs, ...segNets].map((n) => copies([[shadowOf.get(n)!, n]])),
  ]);
  const stepFinish = [
    ...piecesOf([
      ...lm.slaves
        .filter((s) => !moved.has(s.q))
        .map((s) => copies([[s.q, s.master!.q]])),
      ...[...ramQs, ...segNets].map((n) => copies([[n, shadowOf.get(n)!]])),
    ]),
    copies(
      lm.slaves
        .filter((s) => moved.has(s.q))
        .map((s): [number, number] => [s.q, s.master!.q]),
    ),
  ];
  // The body runs in pieces, one event each: every tick's gates in evaluation order, cut every
  // `size` actions, so a piece reads only wires an earlier one wrote, and its IFs are judged on
  // the shadows, which no piece changes. One piece holds most ticks; a read of the 64-byte RAM
  // evaluates the whole read plane, more than one event may run. The last piece sets RAN.
  const bodyPieces = (size: number) => {
    const n = Math.max(1, Math.ceil(worstTick / size));
    return Array.from({ length: n }, (_, m) => {
      const bodies = new Map<string, Case[]>();
      let longest = 0;
      for (const { c, list } of stepLists) {
        const piece = list.slice(m * size, (m + 1) * size);
        longest = Math.max(longest, piece.length);
        if (piece.length || m === n - 1) addBody(bodies, c, acts(piece));
      }
      const ifs = ifsOf(bodies, not(ref(RAN)), m === n - 1, (id) => shadowOf.get(id) ?? id);
      // executed: RAN's reset (the first), every IF, the longest piece, RAN (the last), the swap
      return { ...ifs, cost: (m === 0 ? 1 : 0) + ifs.count + longest + (m === n - 1 ? 1 : 0) + 1 };
    });
  };
  let stepIfs = bodyPieces(Math.max(1, worstTick));
  for (let n = 2; Math.max(...stepIfs.map((p) => p.cost)) > EVENT_BUDGET && n <= worstTick; n++)
    stepIfs = bodyPieces(Math.ceil(worstTick / n));
  const stepChain = Array.from(
    { length: stepSync.length + stepIfs.length + stepFinish.length },
    (_, i) => `${STEP} ${i + 1}`,
  );
  const stepBodies = stepChain.slice(stepSync.length, stepSync.length + stepIfs.length);
  const stepBody = stepBodies[0];
  const stepMoves = tNext
    .map(
      (list, j) =>
        `?${ex(andAll([ref(RAN), not(ref(halted)), tIs(j)]))}{${acts(list)};${w(RAN)}:F}`,
    )
    .join(";");
  // executed: a piece of copies; RAN, every IF, the longest body and its RAN; the last copies,
  // the moves (one of them taken), the counter, the text, the close
  const stepCost = Math.max(
    PIECE + 1,
    ...stepIfs.map((p) => p.cost),
    stepFinish[stepFinish.length - 1].length +
      tNext.length +
      Math.max(...tNext.map((l) => l.length)) +
      1 +
      3,
  );
  if (stepCost > EVENT_BUDGET)
    throw new Error(
      `a Step runs up to ${stepCost} actions, past the event budget`,
    );
  // Run's and Instruction's ticks, by T-state: slot j holds the IFs of the bodies at T = j, guarded
  // by HALTED = 0, then T's move from j. The move takes T to j + 1 (or 0 where the instruction
  // ends), so no later IF of the slot holds, and the slots after the end of the instruction find
  // T = 0: the eight slots in order run the CPU to the end of its instruction.
  const slotsOf = (guard: Expr) =>
    Array.from({ length: 8 }, (_, j) => {
      const at = new Map<string, Case[]>();
      for (const [code, cases] of fast) {
        const cs = cases.filter((c) => c.t === j);
        if (cs.length) at.set(code, cs);
      }
      const ifs = ifsOf(at, guard, false);
      const move = `?${ex(and(guard, tIs(j)))}{${acts(tNext[j])};${COUNT}}`;
      return {
        count: ifs.count + 1,
        code: [ifs.code, move].filter(Boolean).join(";"),
        // executed: every IF judged, the longest body, and the move
        most: ifs.count + worstAt[j] + 1 + tNext[j].length + 1,
      };
    });
  // the first instruction of a Run event runs while the CPU is not halted; the ones after it only
  // in Run (MODE 0), so that Instruction, which opens the same overlay, stops after one
  const copy = (k: number) =>
    slotsOf(k === 0 ? not(ref(halted)) : and(not(ref(halted)), not(ref(MODE))));
  const perInstruction = copy(0).reduce((n, s) => n + s.most, 0);
  // a Run event also shows the counter and closes or swaps
  const instructionsPerEvent = Math.min(
    o.perEvent ?? 1,
    Math.floor((EVENT_BUDGET - 3) / perInstruction),
  );
  if (instructionsPerEvent < 1)
    throw new Error(
      `an instruction runs up to ${perInstruction} actions, past the event budget`,
    );
  const perEvent = Array.from({ length: instructionsPerEvent }, (_, k) =>
    copy(k)
      .map((s) => s.code)
      .join(";"),
  ).join(";");
  const fastGroups = copy(0).reduce((n, s) => n + s.count, 0);
  const groups = [...full.keys()];
  const dispatchStored = stepIfs.reduce((n, p) => n + p.stored, 0);

  // ---------- reset and program loading: every latch to its power-on value ----------
  // only latch outputs hold state (each tick recomputes the gates it reads, the latches' own inner
  // gates included), plus the 7-segment outputs, which a tick refreshes only when OUT loads; and
  // not the masters, which Step sets from their slaves first. Kept short on purpose: the viewer runs
  // a reaction's actions recursively, and a Load of every gate (1,250 actions) overflowed its stack
  // and left the prototype dead to clicks. A Load button sets the program selector and opens the
  // loading overlay, which sets each latch to that program's value, a gate expression of the
  // selector: one writer per latch for the three programs. (Step copies the shadows in itself.)
  const loadNets = [...new Set([...slaveQs, ...ramQs, ...segNets])].filter(
    (id) => wireOf.has(id),
  );
  const selIs = (k: number) =>
    and(lit(SEL[0], k & 1), lit(SEL[1], (k >> 1) & 1));
  // (in pieces too, chained through 1×1 overlays like Step's)
  const loadPieces = piecesOf(
    loadNets.map((id): PlanAction[] => {
      const vs = LOADS.map((p) => initOf[p][id] ?? 0);
      return [
        {
          set: id,
          to: vs.every((v) => v === vs[0])
            ? { const: vs[0] ? 1 : 0 }
            : orAll(LOADS.flatMap((_, k) => (vs[k] ? [selIs(k)] : []))),
        },
      ];
    }),
  );
  const loadCodes = loadPieces.map((p, i) =>
    i < loadPieces.length - 1
      ? acts(p)
      : `${acts(p)};@zero:cpu/ticks;@str:cpu/ticksText:ticks 0;${LOADS.map((name, k) => `?${ex(selIs(k))}{@str:cpu/program:${name}}`).join(";")}`,
  );
  const loadChain = loadCodes.map((_, i) => `${LOADING} ${i + 1}`);
  const load = (k: number) =>
    `${SEL.map((id, b) => `${w(id)}:${(k >> b) & 1 ? "T" : "F"}`).join(";")};@open:${loadChain[0]}`;

  // ---------- the panel ----------
  const lamp = (
    name: string,
    id: number | undefined,
    color = "#3DDC84",
  ): unknown => ({
    t: "e",
    n: name,
    w: 12,
    h: 12,
    f: color,
    ...(id !== undefined ? { v: wireOf.get(id) } : {}),
  });
  /** SVG path data (cubic Béziers: a vector path has no arcs) of circles of radius r at (x, y). */
  const circles = (xs: number[], y: number, r: number) => {
    const k = 0.5523 * r;
    return xs
      .map(
        (x) =>
          `M ${x + r} ${y} C ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} C ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} C ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} C ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} Z`,
      )
      .join(" ");
  };
  const text = (
    n: string,
    s: string,
    x: number,
    y: number,
    size = 12,
    color = "#E6E6E6",
    bold = 0,
  ) => ({ t: "x", n, x, y, tx: [s, size, bold, color] });
  const row = (
    label: string,
    probe: { name: string; width: number },
    x: number,
    y: number,
    color?: string,
  ) => ({
    t: "f",
    n: `reg/${label}`,
    x,
    y,
    w: 60 + 8 * 20,
    h: 20,
    ch: [
      text("label", label, 0, 2, 12, "#8A8F98", 1),
      // the unlit lamps are one vector of circles (every layer costs the prototype time on every
      // event), the lit ones an ellipse each, bound to its bit
      {
        t: "v",
        n: "dim",
        x: 60 + (8 - probe.width) * 20,
        y: 2,
        f: "#33363D",
        p: circles(
          Array.from({ length: probe.width }, (_, i) => i * 20 + 8),
          8,
          8,
        ),
      },
      ...Array.from({ length: probe.width }, (_, i) => {
        const b = probe.width - 1 - i;
        const id = net.aliases.get(
          probe.width === 1 ? probe.name : `${probe.name}[${b}]`,
        );
        return {
          ...(lamp(`bit${b}`, id, color) as object),
          x: 60 + (8 - probe.width + i) * 20 + 2,
          y: 4,
        };
      }),
    ],
  });
  const button = (
    n: string,
    label: string,
    x: number,
    y: number,
    wid: number,
    color: string,
  ) => ({
    t: "f",
    n,
    x,
    y,
    w: wid,
    h: 40,
    r: 8,
    f: color,
    ch: [{ t: "x", n: "label", x: 14, y: 12, tx: [label, 14, 1, "#FFFFFF"] }],
  });
  // a 7-segment digit: segments a..g = SEG[0..6]
  const SEGS: Array<[number, number, number, number]> = [
    [8, 0, 32, 6],
    [40, 6, 6, 32],
    [40, 44, 6, 32],
    [8, 76, 32, 6],
    [2, 44, 6, 32],
    [2, 6, 6, 32],
    [8, 38, 32, 6],
  ];
  const digit = (n: string, port: string, x: number, y: number) => ({
    t: "f",
    n,
    x,
    y,
    w: 48,
    h: 82,
    ch: SEGS.flatMap(([sx, sy, sw, sh], i) => {
      const id = net.ports.find((p) => p.name === port)!.nets[i];
      return [
        { t: "r", n: `seg${i}/off`, x: sx, y: sy, w: sw, h: sh, f: "#2A2D33" },
        {
          t: "r",
          n: `seg${i}`,
          x: sx,
          y: sy,
          w: sw,
          h: sh,
          f: "#FF004D",
          v: wireOf.get(id),
        },
      ];
    }),
  });
  const REG_ROWS: Array<[string, keyof typeof PROBES]> = [
    ["PC", "PC"],
    ["MAR", "MAR"],
    ["IR", "IR"],
    ["MDR", "MDR"],
    ["A", "A"],
    ["Y (ALU)", "Y"],
    ["R0", "R0"],
    ["R1", "R1"],
    ["R2", "R2"],
    ["R3", "R3"],
    ["OUT", "OUT"],
    ["T-state", "T"],
    ["Z", "Z"],
    ["C", "C"],
    ["N", "N"],
    ["HALTED", "HALTED"],
  ];
  // RAM rows: two columns of RAM_BYTES / 2 to the right of the registers
  const RAM_PER_COL = Math.ceil(RAM_BYTES / 2);
  const RAM_PITCH = 21;
  const W = 1180;
  const H = Math.max(640, 160 + RAM_PER_COL * RAM_PITCH + 20);
  // the Load buttons, each as wide as its label (14 px semibold, about 7.6 px a character)
  const loadW = LOADS.map((p) => Math.max(106, Math.ceil(20 + 7.6 * `Load ${p}`.length)));
  const loadX = loadW.map((_, i) => 488 + loadW.slice(0, i).reduce((a, w) => a + w + 10, 0));
  const ticksX = loadX[LOADS.length - 1] + loadW[LOADS.length - 1] + 16;
  const root = {
    t: "f",
    n: ROOT,
    w: W,
    h: H,
    f: "#1C1F26",
    r: 12,
    ch: [
      text(
        "title",
        `An 8-bit CPU of ${net.gates.length.toLocaleString("en-US")} gates. Every lamp is a register bit; each clock tick runs through the gates.`,
        24,
        18,
        15,
        "#FFFFFF",
        1,
      ),
      text(
        "help",
        "Load a program, then Step one clock tick (Space), one Instruction (Enter), or Run until HALTED lights (click the Running pill to pause). OUT shows the result: mul ends at 2A (42 = 6 × 7).",
        24,
        42,
        12,
        "#8A8F98",
      ),
      button("step", "Step  ▸  tick", 24, 76, 140, "#2F6FED"),
      button("instruction", "Instruction  ▸▸", 176, 76, 160, "#2F6FED"),
      button("run", "Run  ▸▸▸", 348, 76, 116, "#1E9E5A"),
      ...LOADS.map((p, i) =>
        button(`load/${p}`, `Load ${p}`, loadX[i], 76, loadW[i], "#555B66"),
      ),
      {
        t: "x",
        n: "ticks",
        x: ticksX,
        y: 84,
        tx: ["ticks 0", 18, 1, "#FFB000"],
        vs: "cpu/ticks" + "Text",
      },
      {
        t: "x",
        n: "program",
        x: 1090,
        y: 86,
        tx: ["mul", 14, 1, "#8A8F98"],
        vs: "cpu/program",
      },
      text("outLabel", "OUT", 24, 140, 12, "#8A8F98", 1),
      digit("digit/hi", "SEG_HI", 24, 160),
      digit("digit/lo", "SEG_LO", 84, 160),
      ...REG_ROWS.map(([label, key], i) =>
        row(
          label,
          PROBES[key],
          170 + Math.floor(i / 8) * 250,
          150 + (i % 8) * 26,
          key === "OUT" ? "#FF004D" : key === "HALTED" ? "#FFA300" : undefined,
        ),
      ),
      text(
        "ramLabel",
        `RAM: ${RAM_BYTES} bytes of latches (address ${OUT_ADDR} is the OUT port)`,
        700,
        140,
        12,
        "#8A8F98",
        1,
      ),
      ...Array.from({ length: RAM_BYTES }, (_, a) => ({
        ...row(
          `${a.toString(16).toUpperCase()}`,
          { name: `__ram${a}`, width: 8 },
          700 + Math.floor(a / RAM_PER_COL) * 240,
          160 + (a % RAM_PER_COL) * RAM_PITCH,
          "#29ADFF",
        ),
        n: `ram/${a.toString(16).toUpperCase()}`,
      })),
    ],
  };
  // RAM rows read latch nets by address, not by a bus name: patch their lamp bindings
  for (const r of root.ch as Array<{
    n: string;
    ch?: Array<{ n: string; v?: number }>;
  }>) {
    const m = /^ram\/([0-9A-F]+)$/.exec(r.n);
    if (!m || !r.ch) continue;
    const a = parseInt(m[1], 16);
    for (const lit of r.ch.filter((c) => /^bit\d$/.test(c.n)))
      lit.v = wireOf.get(net.aliases.get(ramBit(a, Number(lit.n.slice(3))))!);
  }

  // ---------- the gate map ----------
  const byUnit = new Map<string, string[]>();
  for (const g of net.gates) {
    const u = g.path.split("/")[0];
    if (!byUnit.has(u)) byUnit.set(u, []);
    byUnit.get(u)!.push(`${TYPE_CODE[g.type]}${w(g.out)}`);
  }
  const blockW = LAMP.pad * 2 + LAMP.perRow * LAMP.pitch;
  const chartUnits: Array<{
    name: string;
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    gates: string;
  }> = [];
  const colY = [16, 16, 16];
  for (const [name, gates] of [...byUnit.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const rows = Math.ceil(gates.length / LAMP.perRow);
    const h = LAMP.top + rows * LAMP.pitch + LAMP.pad;
    const col = colY.indexOf(Math.min(...colY));
    chartUnits.push({
      name,
      title: `${name} · ${gates.length} gates`,
      x: 16 + col * (blockW + 16),
      y: colY[col],
      w: blockW,
      h,
      gates: gates.join(","),
    });
    colY[col] += h + 12;
  }
  const chartW = 16 + 3 * (blockW + 16);
  const chartH = Math.max(...colY) + 4;

  // ---------- chunks ----------
  const runtime = runtimeCode();
  const chunks: Chunk[] = [];
  const add = (step: string, data: unknown, note: string) => {
    const json = JSON.stringify(data);
    const code = `${runtime}\nreturn await RT.run("${step}", ${json}, "${fnv(json)}");`;
    if (code.length > limit)
      throw new Error(
        `chunk ${chunks.length + 1} (${step}) is ${code.length} characters`,
      );
    chunks.push({ step, code, note });
  };
  const room = maxChunk - runtime.length - 200;
  add(
    "vars",
    {
      coll: "CPU wires",
      prefix: PREFIX,
      names: unitNames,
      units,
      init: initBits,
      extra: [
        ["cpu/ticks", "FLOAT", 0],
        ["cpu/ticksText", "STRING", "ticks 0"],
        ["cpu/program", "STRING", "mul"],
      ],
    },
    `${units.length} wire variables and the tick counter`,
  );
  const PAD = 48;
  const HEADER = 120;
  add(
    "frame",
    {
      name: FRAME,
      flow: "Silicon CPU",
      prefix: PREFIX,
      hover: { x: [], y: [] },
      w: Math.max(W, chartW) + 2 * PAD,
      h: HEADER + H + 40 + chartH + PAD,
      x: 0,
      y: 0,
      bg: "#16181D",
      rootX: PAD,
      rootY: HEADER,
      texts: [
        [
          "Silicon CPU — a gate-level 8-bit computer, computed by Figma itself",
          PAD,
          28,
          24,
          "#FFFFFF",
          1,
        ],
        [
          `${net.gates.length.toLocaleString("en-US")} gates · ${ids.length.toLocaleString("en-US")} wires, a boolean variable each · Step: one tick, gate by gate · Run and Instruction: a whole instruction per clock event, gates folded into gate expressions · no plugin`,
          PAD,
          64,
          13,
          "#8A8F98",
          0,
        ],
        [
          "Below the panel, every gate is a lamp on its output wire: the gates a tick evaluates light as it runs.",
          PAD,
          86,
          12,
          "#8A8F98",
          0,
        ],
      ],
      root,
      overlays: [
        ...RUN.map((n) => ({
          t: "f",
          n,
          w: 340,
          h: 52,
          r: 26,
          f: "#FFB000",
          ch: [
            {
              t: "x",
              n: "label",
              x: 26,
              y: 15,
              tx: ["Running  ·  click here to pause", 16, 1, "#16181D"],
            },
          ],
        })),
        ...[...stepChain, ...loadChain].map((n) => ({ t: "f", n, w: 1, h: 1 })),
      ],
      // the overlays of earlier builds, whose names this one may not reuse
      clear: ["running ", "stepping", `${STEP} `, LOADING],
      chart: {
        name: CHART,
        x: PAD,
        y: HEADER + H + 40,
        w: chartW,
        h: chartH,
        bg: "#101216",
      },
    },
    "the Present frame and the CPU panel",
  );

  // Reactions. Step (Space) opens the first overlay of Step's chain, each of whose timers runs its
  // part and swaps in the next; the last closes. Run and Instruction (Enter) open the first running
  // overlay; each overlay's timer runs the T-state slots for its instructions, then closes the
  // overlay if the CPU has halted or this is Instruction, and otherwise swaps in its twin, whose
  // timer runs the next ones. Clicking the pill closes it (pause).
  const show = "@show:cpu/ticksText:cpu/ticks:ticks ";
  const stepCodes = [
    ...stepSync.map((p) => acts(p)),
    ...stepIfs.map((p, m) => (m === 0 ? `${w(RAN)}:F;${p.code}` : p.code)),
    ...stepFinish.map((p, i) =>
      i < stepFinish.length - 1
        ? acts(p)
        : `${acts(p)};${stepMoves};${COUNT};${show}`,
    ),
  ];
  // a chain of overlays: each runs its code and swaps in the next, the last closes
  const chain = (names: string[], codes: string[], run: string) =>
    Object.fromEntries(
      names.map((_, i) => [
        `${run}/${i}`,
        `${codes[i]};${i < names.length - 1 ? `@swap:${names[i + 1]}` : "@close"}`,
      ]),
    );
  type Assign = [string, Array<[string, number[] | null, string, null]>];
  const assigns: Assign[] = [
    ["/step", [["c", null, "step", null]]],
    ["/instruction", [["c", null, "instruction", null]]],
    ["/run", [["c", null, "run", null]]],
    ...LOADS.map((p): Assign => [
      `/load/${p}`,
      [["c", null, `load/${p}`, null]],
    ]),
    [
      "",
      [
        ["k", [32], "step", null],
        ["k", [13], "instruction", null],
      ],
    ],
    ...RUN.map((name, i): Assign => [
      `@${name}`,
      [
        ["t", [TIMEOUT], `tick/${i}`, null],
        ["c", null, "pause", null],
      ],
    ]),
    ...stepChain.map((name, i): Assign => [
      `@${name}`,
      [["t", [TIMEOUT], `stepping/${i}`, null]],
    ]),
    ...loadChain.map((name, i): Assign => [
      `@${name}`,
      [["t", [TIMEOUT], `loading/${i}`, null]],
    ]),
  ];
  const runs: Record<string, string> = {
    step: `@open:${stepChain[0]}`,
    ...chain(stepChain, stepCodes, "stepping"),
    ...chain(loadChain, loadCodes, "loading"),
    instruction: `${w(MODE)}:T;@open:${RUN[0]}`,
    run: `${w(MODE)}:F;@open:${RUN[0]}`,
    pause: "@close",
    ...Object.fromEntries(
      RUN.map((_, i) => [
        `tick/${i}`,
        `${perEvent};${show};?${ex(or(ref(halted), ref(MODE)))}{@close}{@swap:${RUN[1 - i]}}`,
      ]),
    ),
    ...Object.fromEntries(LOADS.map((p, k) => [`load/${p}`, load(k)])),
  };
  // one chunk per node with the runs its reactions use (the browser loader takes any size)
  for (const [path, list] of assigns) {
    const used = [...new Set(list.map((r) => r[2]))];
    add(
      "react",
      {
        name: FRAME,
        editor: ROOT,
        prefix: PREFIX,
        runs: Object.fromEntries(used.map((k) => [k, runs[k]])),
        assign: [[path, list]],
      },
      `reactions of ${path || "the frame"}: ${used.join(", ")}`,
    );
  }
  let batch: typeof chartUnits = [];
  let size = 0;
  const flush = () => {
    if (!batch.length) return;
    add(
      "chart",
      {
        name: FRAME,
        chart: CHART,
        prefix: PREFIX,
        colors: COLORS,
        blockBg: "#1C1F26",
        size: LAMP.size,
        pitch: LAMP.pitch,
        perRow: LAMP.perRow,
        pad: LAMP.pad,
        top: LAMP.top,
        units: batch,
      },
      `gate map: ${batch.map((u) => u.name).join(", ")}`,
    );
    batch = [];
    size = 0;
  };
  for (const u of chartUnits) {
    const s = JSON.stringify(u).length;
    if (size + s > room || batch.length >= 8) flush();
    batch.push(u);
    size += s;
  }
  flush();

  return {
    chunks,
    stats: {
      gates: net.gates.length,
      wires: units.length,
      cases: 128,
      groups: groups.length,
      dispatchStored,
      worstTick,
      meanTick: Math.round(sumTick / 128),
      stateNets: loadNets.length,
      fastGroups,
      worstFast,
      perInstruction,
      instructionsPerEvent,
    },
    net,
    wireOf,
    ticks,
    tNext,
    stepping: { sync: stepSync.flat(), finish: stepFinish.flat() },
    names: {
      frame: FRAME,
      root: ROOT,
      chart: CHART,
      step: "/step",
      instruction: "/instruction",
      run: "/run",
      overlays: [...RUN, ...stepChain, ...loadChain],
      stepBody,
      stepBodies,
      programs: Object.fromEntries(LOADS.map((p) => [p, `/load/${p}`])),
    },
    counters: { ticks: "cpu/ticks", text: "cpu/ticksText" },
  };
}

/** Gate indices in dependency order (inputs before outputs) within the given set. */
function topo(net: FlatNetlist, gates: number[]): number[] {
  const set = new Set(gates);
  const done = new Set<number>();
  const out: number[] = [];
  const visit = (gi: number) => {
    if (done.has(gi)) return;
    done.add(gi);
    for (const n of net.gates[gi].in) {
      const d = net.driver[n];
      if (d >= 0 && set.has(d)) visit(d);
    }
    out.push(gi);
  };
  for (const gi of gates) visit(gi);
  return out;
}
