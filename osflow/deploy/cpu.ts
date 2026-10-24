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
// gate evaluations instead of 4,200. A Step copies the seven dispatch bits, then runs one
// single-block IF per distinct tick body, each judged on that copy (Figma keeps only an IF and an
// ELSE of a CONDITIONAL, and rejects an IF inside an IF). A latch whose enable still depends on
// the data (a conditional jump, the OUT port) is written as its gate equation, Q = D·EN + Q·¬EN.
// Run and Instruction clock the CPU with two overlays whose timers each run a tick and swap in
// the other, until HALT (or, for Instruction, T back at 0).
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
  };
  net: FlatNetlist;
  wireOf: Map<number, number>;
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
// a panel wire beyond the netlist: 1 while a run stops at the end of the instruction (Instruction),
// 0 while it runs to HALT (Run)
const MODE = -100;
// panel wires holding the dispatch bits (opcode, T) as they were when the tick began: Figma keeps
// only an if and an else of a CONDITIONAL, so the dispatch is one single-block IF per body, and
// every IF must judge the same pre-tick state while the bodies before it rewrite the real bits
const SNAP = [-101, -102, -103, -104, -105, -106, -107];
// Run and Instruction open a small overlay whose timer runs one tick and swaps in its twin, whose
// timer runs the next: Figma's prototype engine clocks the CPU until the overlay closes itself
const RUN = ["running A", "running B"] as const;
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
  o: { maxChunk?: number; limit?: number } = {},
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
  [MODE, ...SNAP].forEach((id, i) => wireOf.set(id, ids.length + i));
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
  for (let i = 0; i <= SNAP.length; i++) units.push(unitIdx("panel"));
  const init = initOf.mul;
  const initBits =
    ids.map((id) => (init[id] ? "1" : "0")).join("") +
    "0".repeat(1 + SNAP.length);
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

  const bodies = new Map<string, Array<[number, number]>>();
  let worstTick = 0;
  let sumTick = 0;
  for (let op = 0; op < 16; op++)
    for (let t = 0; t < 8; t++) {
      const ties = new Map<number, 0 | 1>([[reset, 0]]);
      opBits.forEach((id, b) => ties.set(id, ((op >> b) & 1) as 0 | 1));
      tBits.forEach((id, b) => ties.set(id, ((t >> b) & 1) as 0 | 1));
      const list = tickPlan(net, lm, { ties, refresh }).actions;
      worstTick = Math.max(worstTick, list.length);
      sumTick += list.length;
      const code = acts(list);
      if (!bodies.has(code)) bodies.set(code, []);
      bodies.get(code)!.push([op, t]);
    }

  // the dispatch: one IF per group of cases that share a body, each condition a gate expression of
  // the snapshot of the dispatch bits
  const snapOf = new Map([...opBits, ...tBits].map((id, i) => [id, SNAP[i]]));
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
  const tIs = (t: number) =>
    andAll(tBits.map((id, b) => lit(snapOf.get(id)!, (t >> b) & 1)));
  const caseIs = (op: number, t: number) =>
    andAll([
      ...opBits.map((id, b) => lit(snapOf.get(id)!, (op >> b) & 1)),
      ...tBits.map((id, b) => lit(snapOf.get(id)!, (t >> b) & 1)),
    ]);
  const groups = [...bodies.entries()]
    .map(([code, cases]) => {
      const terms: Expr[] = [];
      for (let t = 0; t < 8; t++) {
        const ops = cases.filter((c) => c[1] === t).map((c) => c[0]);
        if (ops.length === 16) terms.push(tIs(t));
        else for (const op of ops) terms.push(caseIs(op, t));
      }
      return { code, cases, cond: ex(orAll(terms)) };
    })
    .filter((g) => g.code.length > 0)
    .sort((a, b) => b.cases.length - a.cases.length);
  const dispatch = [
    ...[...snapOf].map(([id, snap]) => `${w(snap)}:=${w(id)},T`),
    ...groups.map((g) => `?${g.cond}{${g.code}}`),
  ].join(";");
  const dispatchStored = groups.reduce(
    (n, g) => n + g.code.split(";").length + 1,
    0,
  );

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
          `${net.gates.length} gates · ${ids.length} wires (one boolean variable each) · a clock tick is one flat dispatch on the control state: ${Math.round(sumTick / 128)} gate evaluations on average, ${worstTick} at most · no plugin`,
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

  // reactions. Step (Space) runs one tick. Run and
  // Instruction (Enter) open the first running overlay; each overlay's timer runs one tick, then
  // closes the overlay if the CPU has halted (or, for Instruction, T is back at 0) and otherwise
  // swaps in its twin, whose timer runs the next tick. Clicking the pill closes it (pause).
  // one tick: the dispatch, then the counter and its text
  const tick = `${dispatch};@inc:cpu/ticks;@show:cpu/ticksText:cpu/ticks:ticks `;
  const halted = w(net.aliases.get(PROBES.HALTED.name)!);
  const tZero = tBits.map((id) => `!${w(id)}`);
  const done = `|${halted},&${w(MODE)},&${tZero[0]},&${tZero[1]},${tZero[2]}`;
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
    step: tick,
    instruction: `${w(MODE)}:T;@open:${RUN[0]}`,
    run: `${w(MODE)}:F;@open:${RUN[0]}`,
    pause: "@close",
    ...Object.fromEntries(
      RUN.map((_, i) => [
        `tick/${i}`,
        `${tick};?${done}{@close}{@swap:${RUN[1 - i]}}`,
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
    },
    net,
    wireOf,
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
