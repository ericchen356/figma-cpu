// Lane D1: datapath blocks (ALU, REGFILE, RAM16, PC4, TSTATE, HALT_FF) and the CPU top level.
// The CPU is checked against the T-state-accurate IsaModel after EVERY tick, on hand-assembled
// programs and on the demo programs, plus structural checks of the clocking rules (§2).
import { describe, expect, it } from "vitest";
import { buildCells } from "../src/cells";
import { compile, FastSim } from "../src/compile";
import { buildControl } from "../src/cpu/control";
import { buildCpu, cpuLibrary, cpuNetlist, gatesByBlock } from "../src/cpu/cpu";
import { buildDatapath } from "../src/cpu/datapath";
import { loadProgram, PROBES, ramBit, readProbes, readRam, type SimLike } from "../src/cpu/probes";
import { alu, assemble, IsaModel, OPCODES, PROBE_KEYS, PROGRAMS, RAM_BYTES } from "../src/isa";
import { flatten, stats } from "../src/netlist/flatten";
import type { FlatNetlist, Library } from "../src/netlist/types";
import { RefSim } from "../src/sim/reference";

// ---------- helpers ----------

function datapathLib(): Library {
  const lib: Library = new Map();
  buildCells(lib);
  buildDatapath(lib);
  return lib;
}

/** A sim of one datapath module, at rest with CLK = 1 (the state a tick ends in). */
function moduleSim(top: string): RefSim {
  const sim = new RefSim(flatten(datapathLib(), top));
  if (sim.net.ports.some((p) => p.name === "CLK")) sim.set("CLK", 1);
  sim.settle();
  return sim;
}

/** JS model of the ALU, including the codes 5–7 the hardware decodes to Y = 0. */
function aluRef(a: number, b: number, sel: number, sub: number) {
  let y = 0;
  let co = 0;
  if (sel === 0) {
    const s = a + (sub ? ~b & 0xff : b) + sub;
    y = s & 0xff;
    co = s >> 8;
  } else if (sel === 1) y = a & b;
  else if (sel === 2) y = a | b;
  else if (sel === 3) y = a ^ b;
  else if (sel === 4) y = ~a & 0xff;
  return { y, co, z: y === 0 ? 1 : 0, n: y >> 7 };
}

/** Deterministic pseudo-random bytes. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
}

type Sim = SimLike & { tick(): void; pass?: (clk: 0 | 1) => void };

/** Half a tick: CLK = clk and settle (FastSim runs its compiled pass instead). */
function half(sim: Sim, clk: 0 | 1): void {
  if (sim.pass) sim.pass(clk);
  else {
    sim.set("CLK", clk);
    sim.settle();
  }
}

/** Synchronous RESET: change the input while CLK is high (masters closed), one tick, release. */
function pulseReset(sim: Sim, model: IsaModel, ticks = 1): void {
  sim.set("RESET", 1);
  sim.settle();
  for (let i = 0; i < ticks; i++) {
    half(sim, 0);
    half(sim, 1);
    model.reset();
  }
  sim.set("RESET", 0);
  sim.settle();
}

const JUMPS: Record<number, "Z" | "C" | "N"> = { 0xc: "Z", 0xd: "C", 0xe: "N" };
/** What the lockstep runs exercised, across all tests in this file. */
const coverage = { ops: new Set<string>(), taken: new Set<string>(), notTaken: new Set<string>(), outAt15: 0, resets: 0 };

/** Runs the gate-level CPU and the model side by side, comparing every probe and every RAM
 * byte after every tick (and the bus during the LOW pass). Stops `extra` ticks after HALTED. */
function lockstep(sim: Sim, model: IsaModel, maxTicks: number, extra = 0): number {
  let ticks = 0;
  let afterHalt = -1;
  while (ticks < maxTicks && afterHalt < extra) {
    const s = model.state;
    const op = OPCODES[s.IR >> 4];
    if (!s.HALTED && s.T === 3) coverage.ops.add(op.mnem);
    if (!s.HALTED && s.T === 5 && JUMPS[op.code]) (s[JUMPS[op.code]] ? coverage.taken : coverage.notTaken).add(op.mnem);
    const where = `tick ${ticks + 1} (${s.HALTED ? "halted" : `${op.mnem} T${s.T}`}, PC=${s.PC})`;
    const outs = model.outputs.length;

    half(sim, 0);
    const busLow = sim.peek(PROBES.BUS.name, 8);
    half(sim, 1);
    model.tick();
    ticks++;
    if (model.outputs.length > outs) coverage.outAt15++;

    const got = readProbes(sim);
    const want: Record<string, number> = { ...model.probes(), BUS: model.nextBus() };
    const diff = Object.keys(want).filter((k) => got[k] !== want[k]);
    if (busLow !== model.state.BUS) diff.push(`bus during LOW pass ${busLow} ≠ ${model.state.BUS}`);
    for (let addr = 0; addr < RAM_BYTES; addr++) {
      const r = readRam(sim, addr);
      if (r !== model.state.RAM[addr]) diff.push(`RAM[${addr}] ${r} ≠ ${model.state.RAM[addr]}`);
    }
    if (diff.length)
      throw new Error(
        `${where}: ${diff.map((k) => (k in want ? `${k} gate ${got[k]} ≠ model ${want[k]}` : k)).join("; ")}`,
      );
    if (model.state.HALTED) afterHalt++;
  }
  return ticks;
}

/** A RefSim of a fresh CPU with `bytes` preloaded, and the model with the same program. */
function boot(net: FlatNetlist, bytes: number[], sim: Sim = new RefSim(net)): { sim: Sim; model: IsaModel } {
  loadProgram(sim, bytes);
  return { sim, model: new IsaModel(bytes) };
}

// ---------- datapath blocks ----------

describe("ALU", () => {
  const sim = moduleSim("ALU");
  const run = (a: number, b: number, sel: number, sub: number) => {
    sim.set("A", a);
    sim.set("B", b);
    sim.set("SEL", sel);
    sim.set("SUB", sub);
    sim.settle();
    return { y: sim.get("Y"), co: sim.get("CO"), z: sim.get("Z"), n: sim.get("N") };
  };

  it("adds and subtracts exhaustively (SUB: A + ¬B + 1, carry = no borrow)", () => {
    for (const sub of [0, 1])
      for (let a = 0; a < 256; a++)
        for (let b = 0; b < 256; b++) {
          const got = run(a, b, 0, sub);
          const want = aluRef(a, b, 0, sub);
          if (got.y !== want.y || got.co !== want.co || got.z !== want.z || got.n !== want.n)
            expect(got, `${a} ${sub ? "-" : "+"} ${b}`).toEqual(want);
        }
    expect(run(5, 3, 0, 1)).toEqual({ y: 2, co: 1, z: 0, n: 0 }); // no borrow
    expect(run(3, 5, 0, 1)).toEqual({ y: 254, co: 0, z: 0, n: 1 }); // borrow
    expect(run(7, 7, 0, 1)).toEqual({ y: 0, co: 1, z: 1, n: 0 });
    expect(run(0x80, 0x80, 0, 0)).toEqual({ y: 0, co: 1, z: 1, n: 0 });
  });

  it("logic functions, unused codes and SUB on non-adder codes match the model", () => {
    const r = rng(7);
    const edge = [0, 1, 0x0f, 0x7f, 0x80, 0xf0, 0xff];
    for (let sel = 1; sel < 8; sel++)
      for (const sub of [0, 1]) {
        const pairs: [number, number][] = [];
        for (const a of edge) for (const b of edge) pairs.push([a, b]);
        for (let a = 0; a < 256; a++) pairs.push([a, r()]);
        for (const [a, b] of pairs) {
          const got = run(a, b, sel, sub);
          const want = aluRef(a, b, sel, sub);
          if (JSON.stringify(got) !== JSON.stringify(want)) expect(got, `sel ${sel} sub ${sub} ${a},${b}`).toEqual(want);
        }
      }
  });

  it("agrees with the ISA model's alu() for every opcode's ALU field", () => {
    const r = rng(11);
    for (const op of OPCODES.filter((o) => o.alu))
      for (let i = 0; i < 300; i++) {
        const [a, b] = [r(), r()];
        const m = alu(a, b, op.alu!.sel, op.alu!.sub);
        expect(run(a, b, op.alu!.sel, op.alu!.sub ? 1 : 0), `${op.mnem} ${a},${b}`).toEqual({ y: m.y, co: m.co, z: m.z, n: m.n });
      }
  });
});

describe("REGFILE", () => {
  it("writes R[WSEL] on the rising edge only when WE, reads R[RSEL]", () => {
    const sim = moduleSim("REGFILE");
    const regs = [0, 0, 0, 0];
    const check = () => {
      for (let k = 0; k < 4; k++) {
        expect(sim.get(`R${k}`), `R${k}`).toBe(regs[k]);
        sim.set("RSEL", k);
        sim.settle();
        expect(sim.get("Q"), `Q with RSEL=${k}`).toBe(regs[k]);
      }
    };
    const r = rng(3);
    for (let step = 0; step < 60; step++) {
      const [d, wsel, we] = [r(), r() & 3, step % 3 === 2 ? 0 : 1];
      sim.set("D", d);
      sim.set("WSEL", wsel);
      sim.set("WE", we);
      sim.set("RSEL", wsel);
      sim.settle();
      // Before the edge the read port still shows the old value (no write-through).
      expect(sim.get("Q")).toBe(regs[wsel]);
      sim.tick();
      if (we) regs[wsel] = d;
      check();
    }
  });
});

describe("RAM16", () => {
  it("writes only during the LOW pass, reads every row back, leaves other rows alone", () => {
    const sim = moduleSim("RAM16");
    const mem = new Array<number>(16).fill(0);
    const row = (k: number) => {
      let v = 0;
      for (let i = 0; i < 8; i++) v |= sim.peek(`row${k}/b${i}/Q`) << i;
      return v;
    };
    const checkAll = () => {
      for (let k = 0; k < 16; k++) {
        expect(row(k), `row ${k}`).toBe(mem[k]);
        sim.set("ADDR", k);
        sim.settle();
        expect(sim.get("DOUT"), `DOUT at ${k}`).toBe(mem[k]);
      }
    };
    const r = rng(5);
    // Write every row (in a scrambled order), checking the LOW-pass-only rule each time.
    for (let n = 0; n < 32; n++) {
      const k = (n * 7) % 16;
      const v = r();
      sim.set("ADDR", k);
      sim.set("DIN", v);
      sim.set("WE", 1);
      sim.settle(); // CLK high: nothing written yet
      expect(row(k)).toBe(mem[k]);
      sim.set("CLK", 0);
      sim.settle(); // LOW pass: written, and the latch is transparent
      expect(sim.get("DOUT")).toBe(v);
      sim.set("CLK", 1);
      sim.settle();
      sim.set("WE", 0);
      sim.settle();
      mem[k] = v;
      checkAll();
    }
    // WE = 1 with CLK high: wiggling ADDR / DIN writes nothing.
    sim.set("WE", 1);
    for (let k = 0; k < 16; k++) {
      sim.set("ADDR", k);
      sim.set("DIN", ~mem[k] & 0xff);
      sim.settle();
    }
    sim.set("WE", 0);
    sim.settle();
    checkAll();
    // WE = 0 through whole clock cycles: nothing written.
    for (let k = 0; k < 16; k++) {
      sim.set("ADDR", k);
      sim.set("DIN", ~mem[k] & 0xff);
      sim.tick();
    }
    checkAll();
  });
});

describe("PC4, TSTATE, HALT_FF", () => {
  it("PC4: RESET beats LOAD beats INC; holds otherwise; wraps at 16", () => {
    const sim = moduleSim("PC4");
    const step = (d: number, load: number, inc: number, reset: number) => {
      sim.set("D", d);
      sim.set("LOAD", load);
      sim.set("INC", inc);
      sim.set("RESET", reset);
      sim.settle();
      sim.tick();
      return sim.get("Q");
    };
    expect(step(0, 0, 1, 0)).toBe(1);
    expect(step(9, 1, 0, 0)).toBe(9);
    expect(step(0, 0, 0, 0)).toBe(9);
    expect(step(3, 1, 1, 0)).toBe(3); // LOAD wins over INC (never asserted together)
    expect(step(5, 1, 1, 1)).toBe(0); // RESET wins
    expect(step(15, 1, 0, 0)).toBe(15);
    expect(step(0, 0, 1, 0)).toBe(0); // wraps
  });

  it("TSTATE: counts, T_RESET / RESET clear, frozen while HALTED unless RESET", () => {
    const sim = moduleSim("TSTATE");
    const step = (tr: number, reset: number, halted: number) => {
      sim.set("T_RESET", tr);
      sim.set("RESET", reset);
      sim.set("HALTED", halted);
      sim.settle();
      sim.tick();
      return sim.get("Q");
    };
    const seq = Array.from({ length: 9 }, () => step(0, 0, 0));
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 1]);
    expect(step(1, 0, 0)).toBe(0);
    expect(step(0, 0, 0)).toBe(1);
    expect(step(0, 0, 0)).toBe(2);
    expect(step(0, 0, 1)).toBe(2);
    expect(step(1, 0, 1)).toBe(2);
    expect(step(0, 1, 1)).toBe(0);
  });

  it("HALT_FF: set by HALT, held, cleared by RESET", () => {
    const sim = moduleSim("HALT_FF");
    const step = (halt: number, reset: number) => {
      sim.set("HALT", halt);
      sim.set("RESET", reset);
      sim.settle();
      sim.tick();
      return sim.get("Q");
    };
    expect([step(0, 0), step(1, 0), step(0, 0), step(0, 0), step(0, 1), step(0, 0), step(1, 1)]).toEqual([0, 1, 1, 1, 0, 0, 0]);
  });
});

// ---------- the CPU ----------

describe("CPU structure", () => {
  const net = cpuNetlist();

  it("has the contract ports, instances and probes", () => {
    expect(net.ports.map((p) => [p.name, p.dir, p.nets.length])).toEqual([
      ["CLK", "in", 1],
      ["RESET", "in", 1],
      ["OUT", "out", 8],
      ["SEG_LO", "out", 7],
      ["SEG_HI", "out", 7],
    ]);
    const cpu = cpuLibrary().get("CPU")!;
    const inst = new Map(cpu.instances.map((i) => [i.name, i.cell]));
    for (const [name, cell] of Object.entries({
      pc: "PC4",
      mar: "REG_W4",
      ir: "REG_W8",
      mdr: "REG_W8",
      alatch: "REG_W8",
      ylatch: "REG_W8",
      fz: "DFFE",
      fc: "DFFE",
      fn: "DFFE",
      tstate: "TSTATE",
      halt: "HALT_FF",
      regs: "REGFILE",
      ram: "RAM16",
      alu: "ALU",
      ctrl: "CONTROL",
      busmux: "BUSMUX",
      outreg: "REG_W8",
      seg_lo: "HEX7SEG",
      seg_hi: "HEX7SEG",
    }))
      expect(inst.get(name), name).toBe(cell);
    expect(Object.keys(PROBES).sort()).toEqual([...PROBE_KEYS].sort());
    for (const [k, p] of Object.entries(PROBES))
      for (let i = 0; i < p.width; i++) expect(net.aliases.has(p.width === 1 ? p.name : `${p.name}[${i}]`), `${k} bit ${i}`).toBe(true);
    for (let a = 0; a < RAM_BYTES; a++) for (let bit = 0; bit < 8; bit++) expect(net.aliases.has(ramBit(a, bit))).toBe(true);
    for (let i = 0; i < 8; i++) expect(net.netNames[net.aliases.get(`bus[${i}]`)!]).toBe(`bus[${i}]`);
  });

  it("buildCpu works on an empty library and next to existing cells / control", () => {
    const a: Library = new Map();
    buildCpu(a);
    const b: Library = new Map();
    buildCells(b);
    buildControl(b);
    buildCpu(b);
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    expect(flatten(b, "CPU").gates.length).toBe(net.gates.length);
  });

  it("is built from 2-input gates (+NOT/BUF) only", () => {
    for (const g of net.gates) expect(g.in.length).toBe(g.type === "NOT" || g.type === "BUF" ? 1 : 2);
  });

  // §2 clocking rules, checked on the flattened circuit. Every DLATCH instance is found from the
  // library hierarchy; its D / EN / Q are the aliases `${path}/D` etc.
  describe("clocking rules (SILICON.md §2)", () => {
    const lib = cpuLibrary();
    const latches: string[] = [];
    const walk = (cell: string, prefix: string) => {
      for (const i of lib.get(cell)?.instances ?? []) {
        if (i.cell === "DLATCH") latches.push(`${prefix}${i.name}`);
        else if (lib.has(i.cell)) walk(i.cell, `${prefix}${i.name}/`);
      }
    };
    walk("CPU", "");
    const latchSet = new Set(latches);
    const id = (name: string) => net.aliases.get(name)!;
    const latchOfQ = new Map(latches.map((l) => [id(`${l}/Q`), l]));
    const latchOfGate = (gi: number) => {
      const p = net.gates[gi].path;
      const parent = p.slice(0, p.lastIndexOf("/"));
      return latchSet.has(parent) ? parent : undefined;
    };
    const kind = (l: string) => (l.startsWith("ram/") ? "ram" : l.endsWith("/master") ? "master" : l.endsWith("/slave") ? "slave" : "other");
    const clk = id("CLK");
    const reset = id("RESET");

    /** Backward cone of a net through combinational gates: the latches (by output) and the
     * top inputs it depends on. */
    const cone = (start: number) => {
      const seen = new Set<number>();
      const found = { latches: new Set<string>(), inputs: new Set<number>() };
      const stack = [start];
      while (stack.length) {
        const n = stack.pop()!;
        if (seen.has(n) || n <= 1) continue;
        seen.add(n);
        const l = latchOfQ.get(n);
        if (l) {
          found.latches.add(l);
          continue;
        }
        const d = net.driver[n];
        if (d < 0) found.inputs.add(n);
        else stack.push(...net.gates[d].in);
      }
      return found;
    };

    it("finds every storage bit", () => {
      const counts = { ram: 0, master: 0, slave: 0, other: 0 };
      for (const l of latches) counts[kind(l)]++;
      expect(counts.ram).toBe(128);
      expect(counts.other).toBe(0);
      expect(counts.master).toBe(counts.slave);
    });

    /** Three-valued (0, 1, 2 = unknown) settle with only CLK known: which nets each CLK level
     * forces. Starts all-unknown and only ever refines, so it terminates. */
    const forced = (level: 0 | 1) => {
      const v = new Uint8Array(net.netNames.length).fill(2);
      [v[0], v[1], v[clk]] = [0, 1, level];
      const and = (a: number, b: number) => (a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : 2);
      const or = (a: number, b: number) => (a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : 2);
      const not = (a: number) => (a === 2 ? 2 : a ^ 1);
      const xor = (a: number, b: number) => (a === 2 || b === 2 ? 2 : a ^ b);
      for (let changed = true; changed; ) {
        changed = false;
        for (const g of net.gates) {
          const [a, b] = [v[g.in[0]], v[g.in[1] ?? g.in[0]]];
          const y = { BUF: a, NOT: not(a), AND: and(a, b), OR: or(a, b), NAND: not(and(a, b)), NOR: not(or(a, b)), XOR: xor(a, b), XNOR: not(xor(a, b)) }[g.type];
          if (y !== v[g.out]) [v[g.out], changed] = [y, true];
        }
      }
      return v;
    };

    it("CLK closes the slaves while low and the masters and RAM bits while high", () => {
      for (const level of [0, 1] as const) {
        const v = forced(level);
        const wrong = latches.filter((l) => (v[id(`${l}/EN`)] === 0) !== (kind(l) === "slave" ? level === 0 : level === 1));
        expect(wrong, `CLK=${level}`).toEqual([]);
      }
    });

    it("rule 1: with the latches CLK closes cut, the only loops left are each latch's own hold loop", () => {
      for (const level of [0, 1] as const) {
        const v = forced(level);
        const closed = new Set(latches.filter((l) => v[id(`${l}/EN`)] === 0));
        // Edge: driver of an input → gate, except out of a closed latch (its Q is a constant
        // for this pass) into gates outside that latch.
        const preds = (g: number) =>
          net.gates[g].in
            .map((x) => net.driver[x])
            .filter((d) => {
              if (d < 0) return false;
              const l = latchOfGate(d);
              return !(l && closed.has(l) && latchOfGate(g) !== l);
            });
        // Tarjan SCC, iterative.
        const n = net.gates.length;
        const index = new Int32Array(n).fill(-1);
        const low = new Int32Array(n);
        const onStack = new Uint8Array(n);
        const st: number[] = [];
        let next = 0;
        const bad: string[] = [];
        for (let root = 0; root < n; root++) {
          if (index[root] >= 0) continue;
          const work: [number, number][] = [[root, 0]];
          index[root] = low[root] = next++;
          st.push(root);
          onStack[root] = 1;
          while (work.length) {
            const top = work[work.length - 1];
            const [u, k] = top;
            const ps = preds(u);
            if (k < ps.length) {
              top[1]++;
              const w = ps[k];
              if (index[w] < 0) {
                index[w] = low[w] = next++;
                st.push(w);
                onStack[w] = 1;
                work.push([w, 0]);
              } else if (onStack[w]) low[u] = Math.min(low[u], index[w]);
              continue;
            }
            work.pop();
            if (work.length) low[work[work.length - 1][0]] = Math.min(low[work[work.length - 1][0]], low[u]);
            if (low[u] !== index[u]) continue;
            const scc: number[] = [];
            let w: number;
            do {
              w = st.pop()!;
              onStack[w] = 0;
              scc.push(w);
            } while (w !== u);
            if (scc.length === 1 && !preds(u).includes(u)) continue;
            const owners = new Set(scc.map(latchOfGate));
            const names = scc.map((g) => net.gates[g].path.split("/").pop()).sort();
            if (owners.size !== 1 || owners.has(undefined) || names.join() !== "hold,merge")
              bad.push(`${scc.length} gates: ${scc.slice(0, 6).map((g) => net.gates[g].path).join(" ")}`);
          }
        }
        expect(bad, `CLK=${level}`).toEqual([]);
      }
    });

    it("rule 2: master and RAM enables depend only on flip-flop outputs, CLK and RESET", () => {
      const bad: string[] = [];
      for (const l of latches) {
        const k = kind(l);
        if (k === "slave") {
          if (id(`${l}/EN`) !== clk) bad.push(`${l}: slave EN is not CLK`);
          continue;
        }
        const c = cone(id(`${l}/EN`));
        for (const x of c.latches) if (kind(x) !== "slave") bad.push(`${l}: EN depends on ${x}`);
        for (const x of c.inputs) if (x !== clk && x !== reset) bad.push(`${l}: EN depends on ${net.netNames[x]}`);
        if (!c.inputs.has(clk)) bad.push(`${l}: EN does not depend on CLK`);
      }
      expect(bad).toEqual([]);
    });

    it("rule 3: RAM data comes from the MDR flip-flops; RAM output only reaches the MDR masters' D", () => {
      const bad: string[] = [];
      for (const l of latches.filter((x) => kind(x) === "ram")) {
        const c = cone(id(`${l}/D`));
        const bit = l.slice(l.lastIndexOf("/b") + 2);
        if (c.inputs.size || c.latches.size !== 1 || !c.latches.has(`mdr/b${bit}/slave`)) bad.push(`${l}: D from ${[...c.latches]}`);
      }
      // Forward from every RAM bit, through combinational gates, to the latch inputs it reaches.
      const readers = new Map<number, number[]>();
      net.gates.forEach((g, i) => g.in.forEach((x) => readers.set(x, [...(readers.get(x) ?? []), i])));
      const dOf = new Map<number, string[]>();
      const enOf = new Map<number, string[]>();
      for (const l of latches) {
        dOf.set(id(`${l}/D`), [...(dOf.get(id(`${l}/D`)) ?? []), l]);
        enOf.set(id(`${l}/EN`), [...(enOf.get(id(`${l}/EN`)) ?? []), l]);
      }
      const seen = new Set<number>();
      const stack = latches.filter((x) => kind(x) === "ram").map((l) => id(`${l}/Q`));
      const reached = new Set<string>();
      while (stack.length) {
        const n = stack.pop()!;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const l of enOf.get(n) ?? []) bad.push(`RAM output reaches the enable of ${l}`);
        for (const l of dOf.get(n) ?? []) if (kind(l) !== "ram") reached.add(l);
        for (const gi of readers.get(n) ?? []) if (!latchOfGate(gi)) stack.push(net.gates[gi].out);
        for (const p of net.ports) if (p.dir === "out" && p.nets.includes(n)) bad.push(`RAM output reaches port ${p.name}`);
      }
      expect([...reached].sort()).toEqual(Array.from({ length: 8 }, (_, i) => `mdr/b${i}/master`).sort());
      expect(bad).toEqual([]);
    });
  });

  it("reports gate counts", () => {
    const s = stats(net);
    const blocks = gatesByBlock(net);
    const sched = compile(net);
    console.log("CPU gates", s, "\nper block", blocks, "\nschedule", sched.stats);
    expect(Object.values(blocks).reduce((x, y) => x + y, 0)).toBe(s.gates);
  });
});

/** Hand-assembled programs (independent of the assembler), with their source for a cross-check. */
const HAND: Record<string, { src: string; bytes: number[]; ticks: number; halts: boolean; outputs?: number[] }> = {
  // NOP, LDI, SUB, JZ not taken twice then taken, JMP, ST to OUT, HLT.
  jz: {
    src: `NOP
          LDI R0, 3
          LDI R1, 1
    loop: SUB R0, R1
          JZ done
          JMP loop
    done: ST R0, [15]
          HLT`,
    bytes: [0x00, 0x10, 0x03, 0x14, 0x01, 0x61, 0xc0, 0x0a, 0xb0, 0x05, 0x30, 0x0f, 0xf0],
    ticks: 400,
    halts: true,
    outputs: [0],
  },
  // LD, MOV, ADD with carry, JC taken, JN not taken, NOT, ST R1 to OUT, JN taken, HLT.
  flags: {
    src: `      LD R3, [14]
          MOV R1, R3
          ADD R1, R1
          JC skip
    stop: HLT
    skip: JN stop
          NOT R1
          ST R1, [15]
          JN stop
          .db 0x9C`,
    bytes: [0x2c, 0x0e, 0x47, 0x55, 0xd0, 0x07, 0xf0, 0xe0, 0x06, 0xa4, 0x31, 0x0f, 0xe0, 0x06, 0x9c],
    ticks: 400,
    halts: true,
    outputs: [0xc7],
  },
  // AND, OR, XOR to zero, JZ taken, SUB with borrow, JZ and JC not taken, then PC wraps to 0.
  wrap: {
    src: `      LDI R0, 0x5A
          LDI R1, 0xF0
          AND R0, R1
          OR R0, R1
          XOR R0, R1
          JZ go
          .db 0xF0, 0xF0
    go:   SUB R0, R1
          JZ 9
          JC 9`,
    bytes: [0x10, 0x5a, 0x14, 0xf0, 0x71, 0x81, 0x91, 0xc0, 0x0b, 0xf0, 0xf0, 0x61, 0xc0, 0x09, 0xd0, 0x09],
    ticks: 300,
    halts: false,
  },
};

describe("CPU vs IsaModel, tick by tick (RefSim)", () => {
  const net = cpuNetlist();

  for (const [name, p] of Object.entries(HAND))
    it(`hand-assembled: ${name}`, () => {
      const asm = assemble(p.src);
      expect(asm.errors).toEqual([]);
      expect(asm.bytes.slice(0, p.bytes.length)).toEqual(p.bytes);
      const { sim, model } = boot(net, p.bytes);
      const ticks = lockstep(sim, model, p.ticks, 10);
      expect(model.state.HALTED).toBe(p.halts ? 1 : 0);
      if (p.halts) expect(ticks).toBeLessThan(p.ticks);
      if (p.outputs) expect(model.outputs).toEqual(p.outputs);
    });

  const expected: Record<string, { outputs: number[]; halts: boolean; ticks?: number }> = {
    mul: { outputs: [42], halts: true, ticks: 162 },
    fib: { outputs: [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233], halts: true, ticks: 448 },
    sub: { outputs: [5, 4, 3, 2, 1, 0], halts: true },
    logic: { outputs: [0x33, 0x30, 0xc3], halts: true },
    mem: { outputs: [0x42], halts: true },
    count: { outputs: Array.from({ length: 20 }, (_, i) => i + 1), halts: false },
  };
  for (const [name, src] of Object.entries(PROGRAMS))
    it(`program: ${name}.asm`, () => {
      const asm = assemble(src);
      expect(asm.errors).toEqual([]);
      const { sim, model } = boot(net, asm.bytes);
      const exp = expected[name];
      const ticks = lockstep(sim, model, exp?.halts === false ? 20 * exp.outputs.length + 6 : 2000, 10);
      const g = readProbes(sim);
      expect(g.OUT).toBe(model.state.OUT);
      if (exp) {
        expect(model.outputs).toEqual(exp.outputs);
        expect(g.HALTED).toBe(exp.halts ? 1 : 0);
        if (exp.ticks) expect(ticks - 10).toBe(exp.ticks); // up to the HLT tick, then 10 frozen ticks
      }
    });

  it("mul: OUT = 42 then HALTED; frozen while halted; RESET restarts it", () => {
    const asm = assemble(PROGRAMS.mul);
    const { sim, model } = boot(net, asm.bytes);
    lockstep(sim, model, 1000, 25);
    expect(readProbes(sim)).toMatchObject({ OUT: 42, HALTED: 1, T: 0, R0: 42 });
    expect(sim.peek("SEG_LO", 7)).not.toBe(0);
    pulseReset(sim, model);
    coverage.resets++;
    expect(readProbes(sim)).toMatchObject({ HALTED: 0, T: 0, PC: 0, OUT: 42 });
    const ticks = lockstep(sim, model, 1000, 3);
    expect(ticks - 3).toBe(162);
    expect(readProbes(sim)).toMatchObject({ OUT: 42, HALTED: 1 });
    expect(model.outputs).toEqual([42, 42]);
  });

  it("RESET in the middle of instructions (held 1 and 3 ticks)", () => {
    const asm = assemble(PROGRAMS.fib);
    const { sim, model } = boot(net, asm.bytes);
    for (const [at, hold] of [
      [37, 1],
      [61, 3],
      [5, 1],
    ]) {
      lockstep(sim, model, at);
      expect(model.state.T).not.toBe(0);
      pulseReset(sim, model, hold);
      coverage.resets++;
      const g = readProbes(sim);
      const m = { ...model.probes(), BUS: model.nextBus() };
      expect(g).toEqual(m);
    }
    lockstep(sim, model, 2000, 5);
    expect(model.state.HALTED).toBe(1);
    expect(readProbes(sim).OUT).toBe(233);
  });

  it("covered every opcode, both outcomes of every conditional jump, OUT and RESET", () => {
    expect([...coverage.ops].sort()).toEqual(OPCODES.map((o) => o.mnem).sort());
    expect([...coverage.taken].sort()).toEqual(["JC", "JN", "JZ"]);
    expect([...coverage.notTaken].sort()).toEqual(["JC", "JN", "JZ"]);
    expect(coverage.outAt15).toBeGreaterThan(10);
    expect(coverage.resets).toBeGreaterThan(1);
  });
});

describe("CPU on FastSim (compiled schedule)", () => {
  const net = cpuNetlist();
  const schedule = compile(net);

  it("count.asm: 3000 ticks in lockstep with the model", () => {
    const asm = assemble(PROGRAMS.count);
    const { sim, model } = boot(net, asm.bytes, new FastSim(net, schedule));
    lockstep(sim, model, 3000);
    expect(model.outputs.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(model.outputs.length).toBeGreaterThan(140);
    expect(readProbes(sim).OUT).toBe(model.outputs[model.outputs.length - 1]);
  });

  it("fib.asm with a RESET: same as RefSim, net for net, every tick", () => {
    const asm = assemble(PROGRAMS.fib);
    const ref = new RefSim(net);
    const fast = new FastSim(net, schedule);
    loadProgram(ref, asm.bytes);
    loadProgram(fast, asm.bytes);
    for (let t = 0; t < 620; t++) {
      if (t === 100 || t === 101)
        for (const s of [ref, fast]) {
          s.set("RESET", t === 100 ? 1 : 0);
          s.settle();
        }
      ref.tick();
      fast.tick();
      if (!ref.v.every((x, i) => x === fast.v[i])) {
        const diff = [...ref.v.keys()].filter((i) => ref.v[i] !== fast.v[i]).map((i) => net.netNames[i]);
        throw new Error(`tick ${t + 1}: ${diff.length} nets differ, e.g. ${diff.slice(0, 5).join(", ")}`);
      }
    }
    expect(readProbes(fast)).toMatchObject({ OUT: 233, HALTED: 1 });
  });

  it("reports simulation speed", () => {
    const asm = assemble(PROGRAMS.count);
    const ref = new RefSim(net);
    const fast = new FastSim(net, schedule);
    loadProgram(ref, asm.bytes);
    loadProgram(fast, asm.bytes);
    const speed = (sim: { tick(): void }, n: number) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) sim.tick();
      return Math.round(n / ((performance.now() - t0) / 1000));
    };
    const r = speed(ref, 2000);
    const f = speed(fast, 20000);
    console.log(`ticks/s: RefSim ${r}, FastSim ${f} (${schedule.stats.actionsPerTick} actions/tick)`);
    expect(r).toBeGreaterThan(0);
    expect(f).toBeGreaterThan(r);
  });
});
