// Builds silicon's general-purpose 8-bit CPU (silicon/src/cpu: 2,285 gates, 16 bytes of latch
// RAM, programs count / mul / fib) into a Figma file, with no plugin, in a form that runs whole
// programs in Present mode.
//
// The architecture is the gate netlist itself; what is optimized is how a clock tick reaches
// Figma. A full tick evaluates about 4,200 gates, past what one event survives (the viewer runs a
// reaction's actions recursively: on a cold page 1,000 ran and 1,200 overflowed its stack). But in
// any tick only the gates that the current control state can reach do anything. So each
// (opcode, T-state) pair gets its own specialized tick (deploy/tick.ts: the opcode and T bits tied,
// constants folded through the gates, only the logic that can load a register kept): 22 to 324
// gate evaluations instead of 4,200. A tick clears RAN, then runs one single-block IF per distinct
// tick body, each judged on the live dispatch bits and on RAN, which the body that runs sets (Figma
// keeps only an IF and an ELSE of a CONDITIONAL, and rejects an IF inside an IF). A latch whose
// enable still depends on the data (a conditional jump, the OUT port) is written as its gate
// equation, Q = D·EN + Q·¬EN.
//
// Instruction runs the CPU to the end of its instruction in one click; Run clocks it with two
// overlays whose timers each run a batch of instructions and swap in the other, until HALT. Their
// ticks are faster than Step's: Figma's time goes to variable writes (about 0.3 ms each, against
// 0.03 ms for an IF judged false, and 8 ms for each timer event), so gates are folded into the
// expressions that read them instead of being written, a flip-flop is written once (its slave)
// instead of twice, a heavy tick is split by the bits of the mux it spends its writes on, and the
// IFs are laid out by T-state, so one event runs whole instructions with no bookkeeping writes.
import { assemble, PROGRAMS, RAM_BYTES } from "../../silicon/src/isa";
import { cpuNetlist, PROBES, ramBit } from "../../silicon/src/cpu";
import { powerOn } from "../../silicon/src/compile";
import { NET0, NET1, type FlatNetlist } from "../../silicon/src/netlist/types";
import { and, not, or, ref } from "../../silicon/src/prototype/plan";
import type { Expr, PlanAction } from "../../silicon/src/prototype/types";
import { latchMap, tickPlan } from "./tick";
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
    full: PlanAction[];
    fast: Array<{ extra: Array<[number, 0 | 1]>; actions: PlanAction[] }>;
  }>;
  names: {
    frame: string;
    root: string;
    chart: string;
    step: string;
    instruction: string;
    run: string;
    /** The two running overlays (top-level frames) a run swaps between. */
    overlays: string[];
    programs: Record<string, string>;
  };
  /** The variables holding the tick counter. */
  counters: { ticks: string; text: string };
}

const FRAME = "Silicon CPU · runs in Present (gate level)";
const ROOT = "cpu";
const CHART = "gate map";
const PREFIX = "c/";
// a panel wire beyond the netlist. Figma keeps only an IF and an ELSE of a CONDITIONAL, so a Step is
// one single-block IF per body. RAN is cleared before them and set by the body that runs: the IFs
// after it (judged on a state that body already changed) are off, so exactly the IF of the pre-tick
// state runs.
const RAN = -101;
// Run opens a small overlay whose timer runs a batch of instructions and swaps in its twin, whose
// timer runs the next: Figma's prototype engine clocks the CPU until the overlay closes itself
const RUN = ["running A", "running B"] as const;
/** The most actions one event may run (the viewer runs them recursively; see deploy/README.md). */
export const EVENT_BUDGET = 600;
const TIMEOUT = 0.001;
const LOADS = ["count", "mul", "fib"] as const;
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
  o: { maxChunk?: number; limit?: number; fold?: number; share?: number } = {},
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
  wireOf.set(RAN, ids.length);
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
  units.push(unitIdx("panel"));
  const init = initOf.mul;
  const initBits = ids.map((id) => (init[id] ? "1" : "0")).join("") + "0";
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
  const lm = latchMap(net);
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
  // past these, the writes saved are few and the expressions grow fast (osflow/deploy/README.md)
  const fold = o.fold ?? 12;
  const share = o.share ?? 64;
  type Case = { op: number; t: number; extra: Array<[number, 0 | 1]> };
  const plan = (c: Case, fast: boolean) => {
    const ties = new Map<number, 0 | 1>([[reset, 0]]);
    opBits.forEach((id, b) => ties.set(id, ((c.op >> b) & 1) as 0 | 1));
    tBits.forEach((id, b) => ties.set(id, ((c.t >> b) & 1) as 0 | 1));
    for (const [id, v] of c.extra) ties.set(id, v);
    return tickPlan(
      net,
      lm,
      fast
        ? { ties, refresh, fold, share, keep, direct: true }
        : { ties, refresh, heldBySlave: true },
    ).actions;
  };
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
  const addBody = (into: Map<string, Case[]>, c: Case, list: PlanAction[]) => {
    const code = acts(list);
    if (!into.has(code)) into.set(code, []);
    into.get(code)!.push(c);
  };
  let worstTick = 0;
  let sumTick = 0;
  let worstFast = 0;
  const ticks: CpuGenerated["ticks"] = [];
  for (let op = 0; op < 16; op++)
    for (let t = 0; t < 8; t++) {
      const c: Case = { op, t, extra: [] };
      const list = plan(c, false);
      worstTick = Math.max(worstTick, list.length);
      sumTick += list.length;
      addBody(full, c, list);
      let best = [{ c, list: plan(c, true) }];
      for (const bits of [marBits, irLow]) {
        const split = variants(op, t, bits).map((v) => ({
          c: v,
          list: plan(v, true),
        }));
        const cost = (xs: typeof best) =>
          Math.max(...xs.map((x) => x.list.length));
        if (cost(split) + SPECIALIZE_GAIN <= cost(best)) best = split;
      }
      for (const x of best) {
        worstFast = Math.max(worstFast, x.list.length);
        addBody(fast, x.c, x.list);
      }
      ticks.push({
        op,
        t,
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
  const caseIs = (c: Case, withOp: boolean) =>
    andAll([
      ...(withOp ? opBits.map((id, b) => lit(id, (c.op >> b) & 1)) : []),
      ...tBits.map((id, b) => lit(id, (c.t >> b) & 1)),
      ...c.extra.map(([id, v]) => lit(id, v)),
    ]);
  const ifsOf = (
    bodies: Map<string, Case[]>,
    guard: Expr,
    setsRan: boolean,
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
          ? [caseIs(cs[0], false)]
          : cs.map((c) => caseIs(c, true)),
      );
      return { code, cases, cond: orAll(terms) };
    });
    groups.sort((x, y) => y.cases.length - x.cases.length);
    const ran = setsRan ? `${w(RAN)}:T;` : "";
    return {
      count: groups.length,
      code: groups
        .map(
          (g) =>
            `?${ex(and(guard, g.cond))}{${ran}${g.code ? `${g.code};` : ""}@inc:cpu/ticks}`,
        )
        .join(";"),
      stored: groups.reduce((n, g) => n + g.code.split(";").length + 2, 0),
    };
  };
  const stepIfs = ifsOf(full, not(ref(RAN)), true);
  // Run's and Instruction's ticks, by T-state: slot j holds the IFs of the bodies at T = j, guarded
  // by HALTED = 0. A body moves T on (to j + 1, or to 0 when its instruction ends), so no later IF
  // of its slot holds, and the slots after the end of the instruction find T = 0: the eight slots in
  // order run the CPU to the end of its instruction, with no RAN to keep.
  const halted = net.aliases.get(PROBES.HALTED.name)!;
  const slots = Array.from({ length: 8 }, (_, j) => {
    const at = new Map<string, Case[]>();
    for (const [code, cases] of fast) {
      const cs = cases.filter((c) => c.t === j);
      if (cs.length) at.set(code, cs);
    }
    const worst = Math.max(
      ...ticks
        .filter((tk) => tk.t === j)
        .flatMap((tk) => tk.fast.map((f) => f.actions.length)),
    );
    return { ...ifsOf(at, not(ref(halted)), false), worst };
  });
  const instruction = slots.map((s) => s.code).join(";");
  // executed actions: each slot judges its IFs and runs at most one body and its counter write
  const perInstruction = slots.reduce((n, s) => n + s.count + s.worst + 1, 0);
  // a Run event also shows the counter and closes or swaps
  const instructionsPerEvent = Math.floor((EVENT_BUDGET - 3) / perInstruction);
  if (instructionsPerEvent < 1)
    throw new Error(
      `an instruction runs up to ${perInstruction} actions, past the event budget`,
    );
  const groups = [...full.keys()];
  const dispatchStored = stepIfs.stored;

  // ---------- reset and program loading: every latch to its power-on value ----------
  // only latch outputs hold state (each tick recomputes the gates it reads, the latches' own inner
  // gates included), plus the 7-segment outputs, which a tick refreshes only when OUT loads. Kept
  // short on purpose: the viewer runs a reaction's actions recursively, and a Load of every gate
  // (1,250 actions) overflowed its stack and left the prototype dead to clicks.
  const latchNets = [
    ...new Set([
      ...lm.latches.map((l) => l.q),
      ...net.ports.filter((p) => /^SEG_/.test(p.name)).flatMap((p) => p.nets),
    ]),
  ].filter((id) => wireOf.has(id));
  const load = (p: string) =>
    `${latchNets.map((id) => `${w(id)}:${initOf[p][id] ? "T" : "F"}`).join(";")};@zero:cpu/ticks;@str:cpu/ticksText:ticks 0;@str:cpu/program:${p}`;

  // ---------- the panel ----------
  const lamp = (
    name: string,
    id: number | undefined,
    color = "#3DDC84",
  ): unknown => ({
    t: "f",
    n: name,
    w: 16,
    h: 16,
    r: 8,
    f: "#33363D",
    ch: [
      {
        t: "e",
        n: "lit",
        x: 2,
        y: 2,
        w: 12,
        h: 12,
        f: color,
        ...(id !== undefined ? { v: wireOf.get(id) } : {}),
      },
    ],
  });
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
      ...Array.from({ length: probe.width }, (_, i) => {
        const b = probe.width - 1 - i;
        const id = net.aliases.get(
          probe.width === 1 ? probe.name : `${probe.name}[${b}]`,
        );
        return {
          ...(lamp(`bit${b}`, id, color) as object),
          x: 60 + (8 - probe.width + i) * 20,
          y: 2,
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
  const W = 1180;
  const H = 640;
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
        "An 8-bit CPU of 2,285 gates. Every lamp is a register bit; each clock tick runs through the gates.",
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
        button(`load/${p}`, `Load ${p}`, 488 + i * 116, 76, 106, "#555B66"),
      ),
      {
        t: "x",
        n: "ticks",
        x: 860,
        y: 84,
        tx: ["ticks 0", 18, 1, "#FFB000"],
        vs: "cpu/ticks" + "Text",
      },
      {
        t: "x",
        n: "program",
        x: 1010,
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
        "RAM: 16 bytes of latches (address 15 is the OUT port)",
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
          700,
          160 + a * 26,
          "#29ADFF",
        ),
        n: `ram/${a.toString(16).toUpperCase()}`,
      })),
    ],
  };
  // RAM rows read latch nets by address, not by a bus name: patch their lamp bindings
  for (const r of root.ch as Array<{
    n: string;
    ch?: Array<{ ch?: Array<{ v?: number }> }>;
  }>) {
    const m = /^ram\/([0-9A-F])$/.exec(r.n);
    if (!m || !r.ch) continue;
    const a = parseInt(m[1], 16);
    r.ch.slice(1).forEach((lampSpec, i) => {
      const b = 7 - i;
      lampSpec.ch![0].v = wireOf.get(net.aliases.get(ramBit(a, b))!);
    });
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
          `${net.gates.length} gates · ${ids.length} wires (one boolean variable each) · Step: one tick, every gate it needs (${Math.round(sumTick / 128)} on average, ${worstTick} at most) · Run: ${instructionsPerEvent} instructions an event, gates folded into gate expressions, flip-flops written once (${worstFast} writes at most a tick) · no plugin`,
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
      overlays: RUN.map((n) => ({
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

  // Reactions. Step (Space) runs one tick of the every-gate bodies. Instruction (Enter) runs the
  // eight T-state slots once: the CPU to the end of its instruction. Run opens the first running
  // overlay; each overlay's timer runs the slots for as many instructions as fit in one event's
  // action budget, then closes the overlay if the CPU has halted and otherwise swaps in its twin,
  // whose timer runs the next ones. Clicking the pill closes it (pause).
  const show = "@show:cpu/ticksText:cpu/ticks:ticks ";
  const perEvent = Array.from(
    { length: instructionsPerEvent },
    () => instruction,
  ).join(";");
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
  ];
  const runs: Record<string, string> = {
    step: `${w(RAN)}:F;${stepIfs.code};${show}`,
    instruction: `${instruction};${show}`,
    run: `@open:${RUN[0]}`,
    pause: "@close",
    ...Object.fromEntries(
      RUN.map((_, i) => [
        `tick/${i}`,
        // a condition must be an expression, not a bare variable (plan's eq would simplify to one)
        `${perEvent};${show};?${ex({ eq: [ref(halted), { const: 1 }] })}{@close}{@swap:${RUN[1 - i]}}`,
      ]),
    ),
    ...Object.fromEntries(LOADS.map((p) => [`load/${p}`, load(p)])),
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
      stateNets: latchNets.length,
      fastGroups: slots.reduce((n, s) => n + s.count, 0),
      worstFast,
      perInstruction,
      instructionsPerEvent,
    },
    net,
    wireOf,
    ticks,
    names: {
      frame: FRAME,
      root: ROOT,
      chart: CHART,
      step: "/step",
      instruction: "/instruction",
      run: "/run",
      overlays: [...RUN],
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
