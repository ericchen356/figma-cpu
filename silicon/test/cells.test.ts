import { describe, expect, it } from "vitest";
import { buildCells, CELL_NAMES, type CellName, HEX_GLYPHS } from "../src/cells";
import { flatten, stats } from "../src/netlist/flatten";
import { GATE_TYPES, isGateCell, type Library, type PortDef } from "../src/netlist/types";
import { RefSim } from "../src/sim/reference";

const lib: Library = new Map();
buildCells(lib);
const simOf = (name: string) => new RefSim(flatten(lib, name));

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number) {
  return (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % n) | 0;
  };
}

type Vals = Record<string, number>;

/** Drives every combination of `inputs` (name → width) and compares outputs with `model`.
 * Returns the first mismatch (or undefined) so a failure prints the case, not 100k expects. */
function exhaustive(name: string, inputs: Record<string, number>, model: (v: Vals) => Vals) {
  const sim = simOf(name);
  const names = Object.keys(inputs);
  const bits = names.reduce((t, n) => t + inputs[n], 0);
  for (let x = 0; x < 2 ** bits; x++) {
    const v: Vals = {};
    let shift = 0;
    for (const n of names) {
      v[n] = (x >>> shift) & ((1 << inputs[n]) - 1);
      shift += inputs[n];
      sim.set(n, v[n]);
    }
    sim.settle();
    for (const [o, want] of Object.entries(model(v))) {
      const got = sim.get(o);
      if (got !== want) return { inputs: v, output: o, got, want };
    }
  }
  return undefined;
}

// ---------- the §4 contract ----------

const SPEC: Record<CellName, { in: Record<string, number>; out: Record<string, number> }> = {
  DLATCH: { in: { D: 1, EN: 1 }, out: { Q: 1 } },
  DFF: { in: { D: 1, CLK: 1 }, out: { Q: 1 } },
  DFFE: { in: { D: 1, LOAD: 1, CLK: 1 }, out: { Q: 1 } },
  REG_W3: { in: { D: 3, LOAD: 1, CLK: 1 }, out: { Q: 3 } },
  REG_W4: { in: { D: 4, LOAD: 1, CLK: 1 }, out: { Q: 4 } },
  REG_W8: { in: { D: 8, LOAD: 1, CLK: 1 }, out: { Q: 8 } },
  MUX2: { in: { A: 1, B: 1, S: 1 }, out: { Y: 1 } },
  MUX2_W4: { in: { A: 4, B: 4, S: 1 }, out: { Y: 4 } },
  MUX2_W8: { in: { A: 8, B: 8, S: 1 }, out: { Y: 8 } },
  MUX4_W8: { in: { A: 8, B: 8, C: 8, D: 8, S: 2 }, out: { Y: 8 } },
  HALF_ADDER: { in: { A: 1, B: 1 }, out: { S: 1, CO: 1 } },
  FULL_ADDER: { in: { A: 1, B: 1, CI: 1 }, out: { S: 1, CO: 1 } },
  ADDER_W8: { in: { A: 8, B: 8, CI: 1 }, out: { S: 8, CO: 1 } },
  INC_W3: { in: { A: 3 }, out: { Y: 3, CO: 1 } },
  INC_W4: { in: { A: 4 }, out: { Y: 4, CO: 1 } },
  DEC2: { in: { A: 2, EN: 1 }, out: { Y: 4 } },
  DEC3: { in: { A: 3, EN: 1 }, out: { Y: 8 } },
  DEC4: { in: { A: 4, EN: 1 }, out: { Y: 16 } },
  ZERO_W8: { in: { A: 8 }, out: { Z: 1 } },
  HEX7SEG: { in: { A: 4 }, out: { SEG: 7 } },
};

/** Expected flattened gate counts (keeps the cost of each cell visible and pinned). */
const GATES: Record<CellName, number> = {
  DLATCH: 4,
  DFF: 9,
  DFFE: 10,
  REG_W3: 30,
  REG_W4: 40,
  REG_W8: 80,
  MUX2: 4,
  MUX2_W4: 13,
  MUX2_W8: 25,
  MUX4_W8: 62,
  HALF_ADDER: 2,
  FULL_ADDER: 5,
  ADDER_W8: 40,
  INC_W3: 5,
  INC_W4: 7,
  DEC2: 8,
  DEC3: 17,
  DEC4: 30,
  ZERO_W8: 7,
  HEX7SEG: 54,
};

describe("cell library: structure", () => {
  it("defines exactly CELL_NAMES, in dependency order, with the §4 ports and a doc line", () => {
    expect([...lib.keys()]).toEqual([...CELL_NAMES]);
    const seen = new Set<string>();
    for (const name of CELL_NAMES) {
      const m = lib.get(name)!;
      const want: PortDef[] = [
        ...Object.entries(SPEC[name].in).map(([n, width]) => ({ name: n, dir: "in" as const, width })),
        ...Object.entries(SPEC[name].out).map(([n, width]) => ({ name: n, dir: "out" as const, width })),
      ];
      expect(m.ports, name).toEqual(want);
      expect(m.doc, name).toMatch(/^[^\n]{10,}$/);
      for (const inst of m.instances) expect(isGateCell(inst.cell) || seen.has(inst.cell), `${name}/${inst.name}`).toBe(true);
      const instNames = m.instances.map((i) => i.name);
      expect(new Set(instNames).size, `${name}: unique instance names`).toBe(instNames.length);
      seen.add(name);
    }
  });

  it("flattens every cell to primitive gates only, with the expected gate counts", () => {
    const rows: string[] = [];
    const counts: Record<string, number> = {};
    for (const name of CELL_NAMES) {
      const net = flatten(lib, name);
      for (const g of net.gates) expect(GATE_TYPES).toContain(g.type);
      const s = stats(net);
      counts[name] = s.gates;
      const mix = GATE_TYPES.filter((t) => s[t]).map((t) => `${s[t]} ${t}`).join(", ");
      rows.push(`${name.padEnd(11)} ${String(s.gates).padStart(3)} gates  (${mix})`);
    }
    console.log(`cell gate counts:\n${rows.join("\n")}`);
    expect(counts).toEqual(GATES);
  });

  it("uses meaningful layer names", () => {
    expect(lib.get("DFF")!.instances.map((i) => i.name)).toEqual(["nclk", "master", "slave"]);
    expect(lib.get("REG_W8")!.instances.map((i) => i.name)).toEqual(["b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7"]);
    expect(lib.get("ADDER_W8")!.instances.map((i) => i.name)).toEqual(["fa0", "fa1", "fa2", "fa3", "fa4", "fa5", "fa6", "fa7"]);
    const net = flatten(lib, "REG_W8");
    expect(net.aliases.get("b3/master/Q")).toBe(net.aliases.get("b3/slave/D"));
  });
});

// ---------- combinational: exhaustive truth tables ----------

describe("cell library: combinational truth tables", () => {
  it("MUX2 / MUX2_W4 / MUX2_W8 (exhaustive)", () => {
    const mux = (v: Vals) => ({ Y: v.S ? v.B : v.A });
    expect(exhaustive("MUX2", { A: 1, B: 1, S: 1 }, mux)).toBeUndefined();
    expect(exhaustive("MUX2_W4", { A: 4, B: 4, S: 1 }, mux)).toBeUndefined();
    expect(exhaustive("MUX2_W8", { A: 8, B: 8, S: 1 }, mux)).toBeUndefined();
  });

  it("MUX4_W8 (every bit slice exhaustive, other bits random, plus random words)", () => {
    const sim = simOf("MUX4_W8");
    const r = rng(4);
    const check = (A: number, B: number, C: number, D: number, S: number) => {
      Object.entries({ A, B, C, D, S }).forEach(([n, x]) => sim.set(n, x));
      sim.settle();
      return sim.get("Y") === [A, B, C, D][S];
    };
    let bad = 0;
    for (let bit = 0; bit < 8; bit++)
      for (let x = 0; x < 64; x++) {
        const word = (k: number) => (r(256) & ~(1 << bit)) | (((x >> k) & 1) << bit);
        if (!check(word(0), word(1), word(2), word(3), x >> 4)) bad++;
      }
    for (let i = 0; i < 2000; i++) if (!check(r(256), r(256), r(256), r(256), r(4))) bad++;
    expect(bad).toBe(0);
  });

  it("HALF_ADDER / FULL_ADDER (exhaustive)", () => {
    expect(exhaustive("HALF_ADDER", { A: 1, B: 1 }, (v) => ({ S: v.A ^ v.B, CO: v.A & v.B }))).toBeUndefined();
    expect(
      exhaustive("FULL_ADDER", { A: 1, B: 1, CI: 1 }, (v) => {
        const t = v.A + v.B + v.CI;
        return { S: t & 1, CO: t >> 1 };
      }),
    ).toBeUndefined();
  });

  it("ADDER_W8 (exhaustive: 256 × 256 × CI)", () => {
    expect(
      exhaustive("ADDER_W8", { A: 8, B: 8, CI: 1 }, (v) => {
        const t = v.A + v.B + v.CI;
        return { S: t & 0xff, CO: t >> 8 };
      }),
    ).toBeUndefined();
  });

  it("INC_W3 / INC_W4 (exhaustive)", () => {
    for (const w of [3, 4]) {
      const max = (1 << w) - 1;
      expect(exhaustive(`INC_W${w}`, { A: w }, (v) => ({ Y: (v.A + 1) & max, CO: v.A === max ? 1 : 0 }))).toBeUndefined();
    }
  });

  it("DEC2 / DEC3 / DEC4 (exhaustive, one-hot, all 0 when EN=0)", () => {
    for (const k of [2, 3, 4])
      expect(exhaustive(`DEC${k}`, { A: k, EN: 1 }, (v) => ({ Y: v.EN ? 1 << v.A : 0 }))).toBeUndefined();
  });

  it("ZERO_W8 (exhaustive)", () => {
    expect(exhaustive("ZERO_W8", { A: 8 }, (v) => ({ Z: v.A === 0 ? 1 : 0 }))).toBeUndefined();
  });

  it("HEX7SEG (exhaustive) draws the standard hex glyphs", () => {
    // Classic segment encodings, bit 0 = a … bit 6 = g (independent of HEX_GLYPHS).
    const MASKS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];
    const fromGlyph = (g: string) => [...g].reduce((m, s) => m | (1 << "abcdefg".indexOf(s)), 0);
    expect(HEX_GLYPHS.map(fromGlyph)).toEqual(MASKS);
    expect(exhaustive("HEX7SEG", { A: 4 }, (v) => ({ SEG: MASKS[v.A] }))).toBeUndefined();
  });
});

// ---------- sequential ----------

describe("cell library: latches and flip-flops", () => {
  it("DLATCH is transparent while EN=1 and holds either value while EN=0", () => {
    const sim = simOf("DLATCH");
    const step = (port: string, v: number) => {
      sim.set(port, v);
      sim.settle();
      return sim.get("Q");
    };
    step("EN", 1);
    for (const d of [1, 0, 1]) expect(step("D", d)).toBe(d);
    expect(step("EN", 0)).toBe(1); // close while holding 1
    for (const d of [0, 1, 0, 0]) expect(step("D", d)).toBe(1);
    expect(step("EN", 1)).toBe(0); // reopen: follows D=0
    expect(step("EN", 0)).toBe(0); // close while holding 0
    for (const d of [1, 0, 1, 1]) expect(step("D", d)).toBe(0);

    // Random walk (one input changes at a time) against Q = EN ? D : Q.
    const r = rng(1);
    let [d, en, q] = [1, 0, 0];
    for (let i = 0; i < 500; i++) {
      if (r(2)) d = r(2);
      else en ^= 1;
      sim.set("D", d);
      sim.set("EN", en);
      sim.settle();
      if (en) q = d;
      expect(sim.get("Q")).toBe(q);
    }
  });

  it("DFF changes only on the rising edge", () => {
    const sim = simOf("DFF");
    const step = (port: string, v: number) => {
      sim.set(port, v);
      sim.settle();
      return sim.get("Q");
    };
    expect(step("CLK", 0)).toBe(0);
    expect(step("D", 1)).toBe(0); // CLK low: D only reaches the master
    expect(step("CLK", 1)).toBe(1); // rising edge
    expect(step("D", 0)).toBe(1); // CLK high: ignored
    expect(step("D", 1)).toBe(1);
    expect(step("D", 0)).toBe(1);
    expect(step("CLK", 0)).toBe(1); // falling edge: no change
    expect(step("D", 1)).toBe(1); // CLK low after the edge: still no change
    expect(step("D", 0)).toBe(1);
    expect(step("CLK", 1)).toBe(0); // next rising edge takes D=0

    // Random walk: either D changes or CLK toggles; Q := D on each rising edge only.
    const r = rng(2);
    let [d, clk, q] = [0, 1, 0];
    for (let i = 0; i < 1000; i++) {
      if (r(2)) {
        d = r(2);
        sim.set("D", d);
      } else {
        clk ^= 1;
        sim.set("CLK", clk);
        if (clk) q = d;
      }
      sim.settle();
      expect(sim.get("Q")).toBe(q);
    }
  });

  it("DFFE holds when LOAD=0 across many ticks and loads when LOAD=1", () => {
    const sim = simOf("DFFE");
    for (const v of [1, 0, 1]) {
      sim.set("LOAD", 1);
      sim.set("D", v);
      sim.tick();
      expect(sim.get("Q")).toBe(v);
      sim.set("LOAD", 0);
      for (let t = 0; t < 40; t++) {
        sim.set("D", t & 1);
        sim.tick();
        expect(sim.get("Q")).toBe(v);
      }
    }
    // While CLK is high nothing gets in, whatever LOAD and D do.
    sim.set("CLK", 1);
    sim.settle();
    const q = sim.get("Q");
    for (const [load, d] of [[1, q ^ 1], [0, q ^ 1], [1, q], [1, q ^ 1]]) {
      sim.set("LOAD", load);
      sim.set("D", d);
      sim.settle();
      expect(sim.get("Q")).toBe(q);
    }
    // Random ticks against Q = LOAD ? D : Q.
    const r = rng(3);
    let model = q;
    for (let t = 0; t < 500; t++) {
      const [load, d] = [r(2), r(2)];
      sim.set("LOAD", load);
      sim.set("D", d);
      sim.tick();
      if (load) model = d;
      expect(sim.get("Q")).toBe(model);
    }
  });

  it("REG_W3 / REG_W4 / REG_W8 follow a JS register model over random load/hold sequences", () => {
    for (const w of [3, 4, 8]) {
      const sim = simOf(`REG_W${w}`);
      const r = rng(10 + w);
      let model = 0;
      expect(sim.get("Q")).toBe(0);
      for (let t = 0; t < 1000; t++) {
        const load = r(3) === 0 ? 1 : 0; // mostly holding, so held values live for several ticks
        const d = r(1 << w);
        sim.set("LOAD", load);
        sim.set("D", d);
        sim.tick();
        if (load) model = d;
        expect(sim.get("Q")).toBe(model);
      }
    }
  });
});
