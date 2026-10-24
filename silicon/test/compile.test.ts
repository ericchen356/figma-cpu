import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { buildCells, CELL_NAMES } from "../src/cells";
import { CompileError, compile, FastSim, powerOn, type Schedule } from "../src/compile";
import { define } from "../src/hdl/builder";
import { flatten, netId } from "../src/netlist/flatten";
import { evalGate, type FlatNetlist, GATE_TYPES, type GateType, type Library } from "../src/netlist/types";
import { RefSim } from "../src/sim/reference";

// ---------- helpers ----------

/** Deterministic PRNG (mulberry32) → [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellLib(): Library {
  const lib: Library = new Map();
  buildCells(lib);
  return lib;
}

/** First net whose value differs, or null. */
function firstDiff(net: FlatNetlist, a: Uint8Array, b: Uint8Array): string | null {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `${net.netNames[i]} (ref ${a[i]}, fast ${b[i]})`;
  return null;
}

/** First gate whose output disagrees with its inputs, or null. */
function unsettled(net: FlatNetlist, v: Uint8Array): string | null {
  for (const g of net.gates) if (v[g.out] !== evalGate(g.type, v[g.in[0]], g.in.length > 1 ? v[g.in[1]] : 0)) return g.path;
  return null;
}

type Stimulus = (tick: number) => Record<string, number>;

/** Runs RefSim and one FastSim per schedule side by side, pass by pass, from the same power-on
 * state. After every pass all nets must be equal and the FastSim state fully settled. */
function lockstep(net: FlatNetlist, schedules: Schedule[], ticks: number, stim: Stimulus, label = "", init = powerOn(net)) {
  const ref = new RefSim(net);
  ref.v.set(init);
  const fasts = schedules.map((s) => new FastSim(net, s, init));
  const clk = netId(net, "CLK");
  for (let t = 0; t < ticks; t++) {
    for (const [port, value] of Object.entries(stim(t))) {
      ref.set(port, value);
      for (const f of fasts) f.set(port, value);
    }
    for (const level of [0, 1] as const) {
      ref.v[clk] = level;
      ref.settle();
      fasts.forEach((f, i) => {
        f.pass(level);
        const at = `${label} schedule ${i} tick ${t} pass ${level}`;
        const d = firstDiff(net, ref.v, f.v);
        if (d) expect(d, at).toBeNull();
        const u = unsettled(net, f.v);
        if (u) expect(u, `${at}: unsettled gate`).toBeNull();
      });
    }
  }
  return { ref, fasts };
}

const both = (net: FlatNetlist, opts = {}) => [compile(net, opts), compile(net, { ...opts, prune: false })];

const report: string[] = [];
const statLine = (name: string, net: FlatNetlist, extra?: Record<string, Schedule>) => {
  const on = compile(net);
  const off = compile(net, { prune: false });
  const cols = [
    `${name.padEnd(22)} gates ${String(net.gates.length).padStart(6)}`,
    `actions/tick pruned ${String(on.stats.actionsPerTick).padStart(6)} (LOW ${on.passes[0].order.length}, HIGH ${on.passes[1].order.length})`,
    `unpruned ${String(off.stats.actionsPerTick).padStart(6)}`,
    `largest SCC ${on.stats.largestScc}`,
  ];
  for (const [k, s] of Object.entries(extra ?? {})) cols.push(`${k} ${s.stats.actionsPerTick}`);
  report.push(cols.join(" · "));
};
afterAll(() => {
  if (report.length) console.log(`\ncompile stats\n${report.join("\n")}`);
});

// ---------- hand-built circuits ----------

/** Small sequential circuits from the real cell library (DLATCH, DFF, DFFE, REG_W4, MUX2_W4, INC_W4). */
function testLib(): Library {
  const lib = cellLib();
  define(lib, "SHIFT4", { in: { CLK: 1, SIN: 1 }, out: { Q: 4 } }, (b) => {
    const Q = b.out("Q");
    Q.forEach((q, i) => b.use("DFF", { D: i ? Q[i - 1] : b.in1("SIN"), CLK: b.in1("CLK"), Q: q }, `s${i}`));
  });
  define(lib, "COUNTER4", { in: { CLK: 1 }, out: { Q: 4 } }, (b) => {
    const Q = b.out("Q");
    let carry = "1";
    Q.forEach((q, i) => {
      b.use("DFF", { D: b.XOR(q, carry), CLK: b.in1("CLK"), Q: q }, `b${i}`);
      carry = b.AND(q, carry);
    });
  });
  // Register with load enable and an input mux: LOAD=1 → Q ← SEL ? Q+1 : IN.
  define(lib, "REGMUX", { in: { CLK: 1, IN: 4, LOAD: 1, SEL: 1 }, out: { Q: 4 } }, (b) => {
    const inc = b.use("INC_W4", { A: b.out("Q") }, "inc").Y;
    const d = b.use("MUX2_W4", { A: b.in("IN"), B: inc, S: b.in1("SEL") }, "mux").Y;
    b.use("REG_W4", { D: d, LOAD: b.in1("LOAD"), CLK: b.in1("CLK"), Q: b.out("Q") }, "r");
  });
  // RAM-like 4×4 latch array (SILICON.md §2 rule 3): address, data and write enable are
  // registered; a bit latch is written only in the LOW pass (EN = ¬CLK·WE·row) from the data
  // flip-flops; the read mux feeds an output register whose master captures in the LOW pass.
  define(lib, "RAM4X4", { in: { CLK: 1, A: 2, D: 4, WE: 1 }, out: { OUT: 4 } }, (b) => {
    const CLK = b.in1("CLK");
    const reg = (d: string, name: string) => b.use("DFF", { D: d, CLK }, name).Q[0];
    const a = b.in("A").map((x, i) => reg(x, `ar${i}`));
    const d = b.in("D").map((x, i) => reg(x, `dr${i}`));
    const we = b.AND(b.NOT(CLK), reg(b.in1("WE"), "wer"));
    const na = a.map((x) => b.NOT(x));
    const sel = [0, 1, 2, 3].map((w) => b.AND(w & 1 ? a[0] : na[0], w & 2 ? a[1] : na[1]));
    const mem = sel.map((s, w) => {
      const en = b.AND(we, s);
      return d.map((x, i) => b.use("DLATCH", { D: x, EN: en }, `m${w}_${i}`).Q[0]);
    });
    b.out("OUT").forEach((o, i) => {
      const rd = b.reduce("OR", sel.map((s, w) => b.AND(s, mem[w][i])));
      b.use("DFF", { D: rd, CLK, Q: o }, `out${i}`);
    });
  });
  // Six latches in a ring, each enabled by a top input (against the design rules on purpose):
  // one feedback group of 20 gates, too big for the exhaustive settle check, so it is sampled.
  define(lib, "LATCHRING", { in: { CLK: 1, EN: 6, KEEP: 1, INJ: 1 }, out: { Q: 6 } }, (b) => {
    const [Q, EN] = [b.out("Q"), b.in("EN")];
    const d0 = b.OR(b.AND(Q[5], b.in1("KEEP")), b.in1("INJ"));
    Q.forEach((q, i) => b.use("DLATCH", { D: i ? Q[i - 1] : d0, EN: EN[i], Q: q }, `l${i}`));
  });
  // Cross-coupled NOR set/reset latch: a feedback group that is not a mux latch.
  define(lib, "SRLATCH", { in: { CLK: 1, S: 1, R: 1 }, out: { Q: 1, QN: 1 } }, (b) => {
    b.NOR(b.in1("R"), b.out1("QN"), b.out1("Q"));
    b.NOR(b.in1("S"), b.out1("Q"), b.out1("QN"));
  });
  return lib;
}

describe("compile: schedule shape", () => {
  it("a DFF's feedback groups are the closed latch's hold loop, hold before merge", () => {
    const net = flatten(cellLib(), "DFF");
    const path = (i: number) => net.gates[i].path;
    for (const s of both(net)) {
      expect(s.sccs[0].map((g) => g.map(path))).toEqual([["slave/hold", "slave/merge"]]);
      expect(s.sccs[1].map((g) => g.map(path))).toEqual([["master/hold", "master/merge"]]);
    }
    // Pruned: the closed latch only re-evaluates `hold` (merge keeps Q), and the open latch
    // is a plain dependency chain.
    const s = compile(net);
    expect(s.passes[0].order.map(path)).toEqual([
      "nclk",
      "master/nen",
      "master/take",
      "master/hold",
      "master/merge",
      "slave/nen",
      "slave/take",
      "slave/hold",
    ]);
    expect(s.passes[1].order.map(path)).toEqual([
      "nclk",
      "master/nen",
      "master/take",
      "master/hold",
      "slave/nen",
      "slave/take",
      "slave/hold",
      "slave/merge",
    ]);
    expect(s.stats).toEqual({ gates: 9, actionsPerTick: 16, largestScc: 2 });
    expect(compile(net, { prune: false }).stats.actionsPerTick).toBe(18);
  });

  it("every latch evaluates hold before merge in every pass (REG_W8, RAM array, both modes)", () => {
    let checked = 0;
    for (const top of ["REG_W8", "RAM4X4"]) {
      const net = flatten(top === "REG_W8" ? cellLib() : testLib(), top);
      const find = (c: number[], suffix: string) => c.find((i) => net.gates[i].path.endsWith(suffix));
      for (const s of both(net))
        for (const p of s.passes)
          for (const c of s.sccs[p.clk]) {
            const [hold, merge] = [find(c, "/hold"), find(c, "/merge")];
            expect(hold !== undefined && merge !== undefined).toBe(true);
            const m = p.order.indexOf(merge!);
            if (m < 0) continue; // closed latch, pruned: only hold runs
            const h = p.order.indexOf(hold!);
            expect(h, `${top} ${net.gates[merge!].path} pass ${p.clk}`).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(m);
            checked++;
          }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("logic behind flip-flops runs once per tick when pruned", () => {
    const net = flatten(testLib(), "COUNTER4");
    const s = compile(net);
    const comb = net.gates.map((g, i) => [g, i] as const).filter(([g]) => !g.path.includes("/"));
    for (const [, i] of comb) {
      expect(s.passes[0].order.includes(i)).toBe(false);
      expect(s.passes[1].order.includes(i)).toBe(true);
    }
  });

  it("is deterministic and orders acyclic logic in netlist order", () => {
    const net = flatten(cellLib(), "ADDER_W8");
    const a = compile(net);
    expect(compile(net)).toEqual(a);
    const off = compile(net, { prune: false });
    // a combinational cell defined in dependency order is scheduled in that order
    const sorted = [...off.passes[0].order].sort((x, y) => x - y);
    expect(off.passes[0].order).toEqual(sorted);
    expect(a.sccs).toEqual([[], []]);
  });

  it("rejects loops that never settle and unknown inputs", () => {
    const lib: Library = new Map();
    define(lib, "RING", { in: { CLK: 1 }, out: { Y: 1 } }, (b) => {
      const [x, y] = [b.wire1("x"), b.wire1("y")];
      b.NOT(b.out1("Y"), x);
      b.NOT(x, y);
      b.NOT(y, b.out1("Y"));
    });
    define(lib, "SELFNOT", { in: { CLK: 1 }, out: { Y: 1 } }, (b) => {
      b.NOT(b.out1("Y"), b.out1("Y"));
    });
    expect(() => compile(flatten(lib, "RING"))).toThrow(CompileError);
    expect(() => compile(flatten(lib, "SELFNOT"))).toThrow(/does not settle/);
    expect(() => compile(flatten(cellLib(), "DFF"), { inputs: ["NOPE"] })).toThrow(CompileError);
  });
});

// ---------- the merge-before-hold hazard (lane B's ordering constraint) ----------

describe("latch hold ordering", () => {
  const holdOne = (net: FlatNetlist, schedule: Schedule) => {
    const sim = new FastSim(net, schedule);
    sim.set("D", 1);
    sim.set("LOAD", 1);
    sim.tick();
    const seen = [sim.get("Q")];
    const r = rng(7);
    sim.set("LOAD", 0);
    for (let t = 0; t < 50; t++) {
      sim.set("D", r() < 0.5 ? 1 : 0);
      sim.pass(0);
      seen.push(sim.get("Q"));
      sim.pass(1);
      seen.push(sim.get("Q"));
    }
    return seen;
  };

  it("a DFFE holding 1 with LOAD=0 keeps 1 across many ticks (pruned and unpruned)", () => {
    const net = flatten(cellLib(), "DFFE");
    for (const s of both(net)) expect(holdOne(net, s).every((q) => q === 1)).toBe(true);
  });

  it("a DFF that captured 1 keeps it through the next LOW pass after D→0", () => {
    const net = flatten(cellLib(), "DFF");
    for (const s of both(net)) {
      const sim = new FastSim(net, s);
      sim.set("D", 1);
      sim.tick();
      expect(sim.get("Q")).toBe(1);
      expect(sim.peek("m")).toBe(1);
      sim.set("D", 0);
      sim.pass(0); // slave closes while Q=1; master opens and takes 0
      expect([sim.get("Q"), sim.peek("m")]).toEqual([1, 0]);
      sim.pass(1); // master closes while m=0, slave takes 0
      expect(sim.get("Q")).toBe(0);
      sim.set("D", 1);
      sim.tick();
      sim.tick(); // master closes while m=1 (hold first) and Q stays 1
      expect([sim.get("Q"), sim.peek("m")]).toEqual([1, 1]);
    }
  });

  it("those checks catch a schedule that runs merge before hold", () => {
    const net = flatten(cellLib(), "DFFE");
    const good = compile(net, { prune: false });
    const flip = (order: number[]) => {
      const out = [...order];
      for (let k = 0; k + 1 < out.length; k++) {
        const [p, q] = [net.gates[out[k]].path, net.gates[out[k + 1]].path];
        if (p.endsWith("/hold") && q === p.replace(/hold$/, "merge")) [out[k], out[k + 1]] = [out[k + 1], out[k]];
      }
      return out;
    };
    const bad: Schedule = { ...good, passes: [{ clk: 0, order: flip(good.passes[0].order) }, { clk: 1, order: flip(good.passes[1].order) }] };
    expect(holdOne(net, bad).every((q) => q === 1)).toBe(false);
  });
});

// ---------- FastSim = RefSim ----------

describe("FastSim = RefSim on hand-built sequential circuits", () => {
  const lib = testLib();

  it("shift register", () => {
    const net = flatten(lib, "SHIFT4");
    const r = rng(1);
    const bits: number[] = [];
    const { fasts } = lockstep(net, both(net), 200, () => {
      bits.push(r() < 0.5 ? 1 : 0);
      return { SIN: bits[bits.length - 1] };
    });
    const expected = [0, 1, 2, 3].reduce((acc, i) => acc | ((bits[bits.length - 1 - i] ?? 0) << i), 0);
    for (const f of fasts) expect(f.get("Q")).toBe(expected);
    statLine("SHIFT4", net);
  });

  it("counter", () => {
    const net = flatten(lib, "COUNTER4");
    const sim = new FastSim(net);
    const seen = Array.from({ length: 20 }, () => (sim.tick(), sim.get("Q")));
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) % 16));
    lockstep(net, both(net), 100, () => ({}));
    statLine("COUNTER4", net);
  });

  it("register with load enable and input mux", () => {
    const net = flatten(lib, "REGMUX");
    const r = rng(2);
    let q = 0;
    const ins: Record<string, number>[] = [];
    const { fasts } = lockstep(net, both(net), 300, () => {
      const s = { IN: Math.floor(r() * 16), LOAD: r() < 0.6 ? 1 : 0, SEL: r() < 0.5 ? 1 : 0 };
      ins.push(s);
      return s;
    });
    for (const s of ins) if (s.LOAD) q = s.SEL ? (q + 1) & 15 : s.IN;
    for (const f of fasts) expect(f.get("Q")).toBe(q);
    statLine("REGMUX", net);
  });

  it("RAM-like latch array written in the LOW pass", () => {
    const net = flatten(lib, "RAM4X4");
    const r = rng(3);
    const m = { a: 0, d: 0, we: 0, out: 0, mem: [0, 0, 0, 0] };
    const sim = new FastSim(net);
    for (let t = 0; t < 400; t++) {
      const s = { A: Math.floor(r() * 4), D: Math.floor(r() * 16), WE: r() < 0.4 ? 1 : 0 };
      for (const [k, v] of Object.entries(s)) sim.set(k, v);
      sim.tick();
      // behavioral model: LOW writes with the registered inputs and reads; HIGH registers.
      if (m.we) m.mem[m.a] = m.d;
      const rd = m.mem[m.a];
      Object.assign(m, { a: s.A, d: s.D, we: s.WE, out: rd });
      expect(sim.get("OUT"), `tick ${t}`).toBe(m.out);
    }
    const r2 = rng(4);
    lockstep(net, both(net), 300, () => ({ A: Math.floor(r2() * 4), D: Math.floor(r2() * 16), WE: r2() < 0.4 ? 1 : 0 }));
    statLine("RAM4X4", net);
  });

  it("set/reset latch (a feedback group that is not a mux latch)", () => {
    const net = flatten(lib, "SRLATCH");
    const r = rng(5);
    lockstep(net, both(net), 300, () => ({ S: r() < 0.3 ? 1 : 0, R: r() < 0.3 ? 1 : 0 }));
  });

  it("a large feedback group (sampled settle check)", () => {
    const net = flatten(lib, "LATCHRING");
    const [on, off] = both(net);
    expect(on.stats.largestScc).toBe(20);
    const r = rng(8);
    lockstep(net, [on, off], 300, () => ({ EN: Math.floor(r() * 64), KEEP: r() < 0.7 ? 1 : 0, INJ: r() < 0.3 ? 1 : 0 }));
    statLine("LATCHRING", net);
  });

  it("pass(1) right after set() still sees the new inputs", () => {
    const net = flatten(lib, "REGMUX");
    const ref = new RefSim(net);
    const fast = new FastSim(net);
    ref.v.set(fast.v);
    for (const s of [ref, fast]) {
      s.set("IN", 9);
      s.set("LOAD", 1);
    }
    ref.settle(); // CLK is still 1
    fast.pass(1);
    expect(firstDiff(net, ref.v, fast.v)).toBeNull();
  });

  it("tick() equals RefSim.tick() from zeros for flip-flop circuits (power-on agrees)", () => {
    for (const top of ["SHIFT4", "COUNTER4", "REGMUX"]) {
      const net = flatten(lib, top);
      const ref = new RefSim(net);
      const fast = new FastSim(net);
      const r = rng(6);
      for (let t = 0; t < 100; t++) {
        for (const p of net.ports.filter((x) => x.dir === "in" && x.name !== "CLK")) {
          const v = Math.floor(r() * 2 ** p.nets.length);
          ref.set(p.name, v);
          fast.set(p.name, v);
        }
        ref.tick();
        fast.tick();
        expect(firstDiff(net, ref.v, fast.v), `${top} tick ${t}`).toBeNull();
      }
      expect(fast.ticks).toBe(100);
    }
  });
});

// ---------- random rule-abiding circuits ----------

interface RandSpec {
  inputs: number;
  dffs: number;
  dffes: number;
  ram: number;
  comb: number;
  outputs: number;
  /** Probability that a gate operand is one of the most recent nets (deeper logic). */
  deep?: number;
}

/** A random sequential circuit that obeys SILICON.md §2: feedback only through DFF/DFFE/latch
 * cells; random combinational DAGs between them; master enables (LOAD), RAM write enables and
 * RAM data come from flip-flop outputs and logic of them only; RAM latches are written in the
 * LOW pass (EN = ¬CLK·WE, the enable gate placed before its latch). Data paths may use the top
 * inputs, RAM outputs and CLK itself. Gates and cells are emitted in shuffled order. */
function randomNetlist(seed: number, s: RandSpec): FlatNetlist {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const deep = s.deep ?? 0.5;
  const operand = (xs: string[]) => (r() < deep ? xs[xs.length - 1 - Math.floor(r() * Math.min(xs.length, 12))] : pick(xs));
  const lib = cellLib();
  define(lib, "RAND", { in: { CLK: 1, IN: s.inputs }, out: { OUT: s.outputs } }, (b) => {
    const CLK = b.in1("CLK");
    const q = b.wire("q", s.dffs + s.dffes);
    const m = b.wire("m", s.ram);
    const stable = ["0", "1", ...q];
    const any = [...stable, ...b.in("IN"), ...m];
    const comb: { type: GateType; ins: string[]; out: string }[] = [];
    for (let i = 0; i < s.comb; i++) {
      const type = pick([...GATE_TYPES]);
      const safe = r() < 0.4;
      const pool = safe ? stable : any;
      const arg = () => (!safe && r() < 0.03 ? CLK : operand(pool));
      const ins = type === "BUF" || type === "NOT" ? [arg()] : [arg(), arg()];
      const out = b.wire1("c");
      comb.push({ type, ins, out });
      if (safe) stable.push(out);
      any.push(out);
    }
    const nclk = b.NOT(CLK); // shared ¬CLK of the RAM write enables, placed before them
    const items: (() => void)[] = [
      ...comb.map((g) => () => void b.gate(g.type, g.ins, g.out)),
      ...q.map(
        (Q, i) => () =>
          void (i < s.dffs ? b.use("DFF", { D: pick(any), CLK, Q }) : b.use("DFFE", { D: pick(any), LOAD: pick(stable), CLK, Q })),
      ),
      ...m.map((Q) => () => void b.use("DLATCH", { D: pick(stable), EN: b.AND(nclk, pick(stable)), Q })),
    ];
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    for (const f of items) f();
    for (const o of b.out("OUT")) b.BUF(pick(any), o);
  });
  return flatten(lib, "RAND");
}

function randomSpec(r: () => number): RandSpec {
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  return { inputs: int(1, 5), dffs: int(1, 12), dffes: int(0, 8), ram: int(0, 8), comb: int(5, 150), outputs: int(1, 4) };
}

describe("random sequential circuits: FastSim = RefSim on all nets after every pass", () => {
  it("60 seeds × 200 ticks, pruned and unpruned", () => {
    let gates = 0;
    let pruned = 0;
    let unpruned = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const net = randomNetlist(seed, randomSpec(rng(1000 + seed)));
      const r = rng(seed * 7);
      const [on, off] = both(net);
      gates += net.gates.length;
      pruned += on.stats.actionsPerTick;
      unpruned += off.stats.actionsPerTick;
      const width = net.ports.find((p) => p.name === "IN")!.nets.length;
      lockstep(net, [on, off], 200, () => ({ IN: Math.floor(r() * 2 ** width) }), `seed ${seed}`);
    }
    report.push(`random ×60              gates ${gates} · actions/tick pruned ${pruned} · unpruned ${unpruned} (${((100 * pruned) / unpruned).toFixed(0)}%)`);
  });

  it("8 larger seeds (≈1–2k gates) × 120 ticks", () => {
    for (let seed = 101; seed <= 108; seed++) {
      const net = randomNetlist(seed, { inputs: 6, dffs: 40, dffes: 30, ram: 32, comb: 900, outputs: 8, deep: 0.3 });
      const r = rng(seed);
      lockstep(net, both(net), 120, () => ({ IN: Math.floor(r() * 64) }), `seed ${seed}`);
      if (seed === 101) statLine("random large", net);
    }
  });

  it("inputs that rarely change; a schedule assuming constant inputs falls back to a full settle", () => {
    for (let seed = 201; seed <= 220; seed++) {
      const net = randomNetlist(seed, randomSpec(rng(seed)));
      const r = rng(seed);
      const width = net.ports.find((p) => p.name === "IN")!.nets.length;
      let x = 0;
      const fixed = compile(net, { inputs: [] });
      expect(fixed.stats.actionsPerTick).toBeLessThanOrEqual(compile(net).stats.actionsPerTick);
      lockstep(net, [...both(net), fixed], 150, () => {
        if (r() < 0.1) x = Math.floor(r() * 2 ** width);
        return { IN: x };
      }, `seed ${seed}`);
    }
  });

  it("pokes between ticks (RAM latch outputs, logic nets) match RefSim", () => {
    for (let seed = 301; seed <= 320; seed++) {
      const spec = { ...randomSpec(rng(seed)), ram: 6 };
      const net = randomNetlist(seed, spec);
      const r = rng(seed);
      const init = powerOn(net);
      const ref = new RefSim(net);
      ref.v.set(init);
      const fasts = both(net).map((s) => new FastSim(net, s, init));
      const width = net.ports.find((p) => p.name === "IN")!.nets.length;
      for (let t = 0; t < 150; t++) {
        const x = Math.floor(r() * 2 ** width);
        if (r() < 0.15) {
          const name = r() < 0.6 ? `m[${Math.floor(r() * spec.ram)}]` : net.netNames[2 + Math.floor(r() * (net.netNames.length - 2))];
          const v = r() < 0.5 ? 1 : 0;
          ref.poke(name, v);
          for (const f of fasts) f.poke(name, v);
        }
        ref.set("IN", x);
        ref.tick();
        for (const f of fasts) {
          f.set("IN", x);
          f.tick();
          const d = firstDiff(net, ref.v, f.v);
          if (d) expect(d, `seed ${seed} tick ${t}`).toBeNull();
        }
      }
    }
  });
});

// ---------- power-on ----------

describe("powerOn", () => {
  it("is settled with CLK=1 and keeps preloaded latch values", () => {
    const net = flatten(testLib(), "RAM4X4");
    const v = powerOn(net, { "m2_1/Q": 1, "m3_0/Q": 1, "m3_3/Q": 1 });
    expect(v[netId(net, "CLK")]).toBe(1);
    expect(unsettled(net, v)).toBeNull();
    const sim = new FastSim(net, compile(net), v);
    expect([sim.peek("m2_1/Q"), sim.peek("m3_0/Q"), sim.peek("m0_0/Q")]).toEqual([1, 1, 0]);
    // read address 3 back: A=3 registers on tick 1, read in tick 2's LOW pass, OUT after tick 2
    sim.set("A", 3);
    sim.tick();
    sim.tick();
    expect(sim.get("OUT")).toBe(0b1001);
  });

  it("accepts bus base names and rejects unknown nets", () => {
    const net = flatten(cellLib(), "REG_W8");
    // Slaves are open with CLK=1, so a poke of Q is settled away (Q follows the masters, 0) ...
    const v = powerOn(net, { Q: 0xa5 });
    expect(new FastSim(net, compile(net), v).get("Q")).toBe(0);
    const m = powerOn(net, { "b0/m": 1, "b7/m": 1 }); // master latch outputs hold with CLK=1
    expect(new FastSim(net, compile(net), m).get("Q")).toBe(0x81);
    expect(() => powerOn(net, { nope: 1 })).toThrow(/no net named nope/);
  });
});

// ---------- the real cell library ----------

describe("cell library (src/cells)", () => {
  it("every cell compiles and FastSim = RefSim under random stimuli", () => {
    const lib = cellLib();
    for (const name of CELL_NAMES) {
      const def = lib.get(name)!;
      let top = name as string;
      if (!def.ports.some((p) => p.name === "CLK")) {
        // combinational cell: wrap it with an (unused) CLK so it can be ticked
        top = `T_${name}`;
        const ins = Object.fromEntries(def.ports.filter((p) => p.dir === "in").map((p) => [p.name, p.width]));
        const outs = Object.fromEntries(def.ports.filter((p) => p.dir === "out").map((p) => [p.name, p.width]));
        define(lib, top, { in: { ...ins, CLK: 1 }, out: outs }, (b) => {
          b.use(name, Object.fromEntries(def.ports.map((p) => [p.name, p.dir === "in" ? b.in(p.name) : b.out(p.name)])), "u");
        });
      }
      const net = flatten(lib, top);
      const r = rng(name.length * 31);
      const ins = net.ports.filter((p) => p.dir === "in" && p.name !== "CLK");
      lockstep(net, both(net), 120, () => Object.fromEntries(ins.map((p) => [p.name, Math.floor(r() * 2 ** p.nets.length)])), name);
      if (["DFF", "DFFE", "REG_W8", "ADDER_W8", "HEX7SEG"].includes(name)) statLine(name, net);
    }
  });
});

// ---------- the CPU, once lanes D1/D2 have built it ----------

describe("CPU (src/cpu)", () => {
  const url = (rel: string) => new URL(rel, import.meta.url);
  const optional = async (rel: string): Promise<any> => (existsSync(url(rel)) ? import(/* @vite-ignore */ url(rel).href) : null);

  /** The CPU library and one RAM preload per program (`prefix` = hierarchical path of the CPU),
   * or null while lanes D1/D2 have not built it yet. */
  const loadCpu = async () => {
    const cpu = await optional("../src/cpu/cpu.ts");
    if (!cpu?.buildCpu) return null;
    const lib = cellLib();
    cpu.buildCpu(lib);
    const probes = await optional("../src/cpu/probes.ts");
    const isa = await optional("../src/isa/index.ts");
    const programs = (prefix: string) => {
      const runs: [string, Record<string, number>][] = [["empty RAM", {}]];
      if (!probes?.ramBit || !isa?.assemble || !isa?.PROGRAMS) return runs;
      for (const [prog, src] of Object.entries(isa.PROGRAMS as Record<string, string>)) {
        const pokes: Record<string, number> = {};
        (isa.assemble(src).bytes as number[]).forEach((byte, addr) => {
          for (let bit = 0; bit < 8; bit++) pokes[prefix + probes.ramBit(addr, bit)] = (byte >> bit) & 1;
        });
        runs.push([prog, pokes]);
      }
      return runs;
    };
    return { lib, programs };
  };

  it("compiles the CPU and FastSim = RefSim on all nets, every pass, every program", async (ctx) => {
    const cpu = await loadCpu();
    if (!cpu) return ctx.skip();
    const net = flatten(cpu.lib, "CPU");
    const t0 = performance.now();
    const on = compile(net);
    const ms = performance.now() - t0;
    const off = compile(net, { prune: false });
    const fixedReset = compile(net, { inputs: [] });
    statLine("CPU", net, { "inputs: [] (RESET fixed)": fixedReset });
    report.push(`CPU compile ${ms.toFixed(0)} ms`);
    const runs = cpu.programs("");
    // Power-on reset only: RESET reaches the register enables through CONTROL combinationally,
    // so a RESET edge in mid-run races in RefSim (see the next test).
    for (const [label, pokes] of runs)
      lockstep(net, [on, off, fixedReset], 500, (t) => ({ RESET: t < 2 ? 1 : 0 }), `CPU ${label}`, powerOn(net, pokes));
    const sim = new FastSim(net, on, powerOn(net, runs[runs.length - 1][1]));
    const t1 = performance.now();
    sim.run(2000);
    report.push(`CPU FastSim ${(2000 / ((performance.now() - t1) / 1000)).toFixed(0)} ticks/s`);
  });

  it("mid-run RESET pulses match RefSim once RESET is registered (design rule 2)", async (ctx) => {
    const cpu = await loadCpu();
    if (!cpu) return ctx.skip();
    define(cpu.lib, "CPU_SYNC_RESET", { in: { CLK: 1, RESET: 1 }, out: { OUT: 8 } }, (b) => {
      const rst = b.use("DFF", { D: b.in1("RESET"), CLK: b.in1("CLK") }, "rst").Q[0];
      b.use("CPU", { CLK: b.in1("CLK"), RESET: rst, OUT: b.out("OUT") }, "cpu");
    });
    const net = flatten(cpu.lib, "CPU_SYNC_RESET");
    for (const [label, pokes] of cpu.programs("cpu/"))
      lockstep(net, both(net), 400, (t) => ({ RESET: t < 3 || t % 97 < 2 ? 1 : 0 }), `CPU_SYNC_RESET ${label}`, powerOn(net, pokes));
  });
});

// ---------- performance ----------

describe("performance", () => {
  it("compiles a 10k-gate circuit well under a second; FastSim runs it fast", () => {
    const net = randomNetlist(4242, { inputs: 8, dffs: 300, dffes: 200, ram: 200, comb: 4300, outputs: 8, deep: 0.05 });
    expect(net.gates.length).toBeGreaterThanOrEqual(10000);
    let t0 = performance.now();
    const on = compile(net);
    const msOn = performance.now() - t0;
    t0 = performance.now();
    const off = compile(net, { prune: false });
    const msOff = performance.now() - t0;
    expect(msOn).toBeLessThan(1000);
    expect(msOff).toBeLessThan(1000);
    const sim = new FastSim(net, on);
    t0 = performance.now();
    sim.run(500);
    const tps = 500 / ((performance.now() - t0) / 1000);
    report.push(
      `perf: ${net.gates.length} gates · compile ${msOn.toFixed(0)} ms (unpruned ${msOff.toFixed(0)} ms) · actions/tick ${on.stats.actionsPerTick} (unpruned ${off.stats.actionsPerTick}) · FastSim ${tps.toFixed(0)} ticks/s`,
    );
    const r = rng(1);
    lockstep(net, [on, off], 25, () => ({ IN: Math.floor(r() * 256) }), "10k");
  });
});
