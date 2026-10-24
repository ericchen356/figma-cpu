import { describe, expect, it } from "vitest";
import { buildControl, controlTruth } from "../src/cpu/control";
import { type Flag, OPCODES, type Signal, SIGNALS } from "../src/isa/spec";
import { flatten, stats } from "../src/netlist/flatten";
import type { FlatNetlist, Library } from "../src/netlist/types";
import { RefSim } from "../src/sim/reference";

function controlLib(): Library {
  const lib: Library = new Map();
  buildControl(lib);
  return lib;
}

const flagsOf = (f: number): Record<Flag, boolean> => ({ Z: !!(f & 1), C: !!(f & 2), N: !!(f & 4) });

/** Names of the nets feeding the gate at `path`. */
const inputsOf = (net: FlatNetlist, path: string) => {
  const g = net.gates.find((x) => x.path === path);
  if (!g) throw new Error(`no gate ${path}`);
  return g.in.map((n) => net.netNames[n]);
};

describe("control unit: PLA generated from the microcode table", () => {
  it("the decoders are one-hot", () => {
    const lib = controlLib();
    for (const [cell, bits] of [
      ["CTRL_DEC2", 2],
      ["CTRL_DEC3", 3],
      ["CTRL_DEC4", 4],
    ] as const) {
      const sim = new RefSim(flatten(lib, cell));
      for (let a = 0; a < 1 << bits; a++) {
        sim.set("A", a);
        sim.settle();
        expect(sim.get("Y"), `${cell} A=${a}`).toBe(1 << a);
      }
    }
  });

  it("controlTruth follows the spec (spot checks)", () => {
    const LDI = OPCODES.find((o) => o.mnem === "LDI")!.code;
    const JZ = OPCODES.find((o) => o.mnem === "JZ")!.code;
    const SUB = OPCODES.find((o) => o.mnem === "SUB")!.code;
    const on = (r: Record<string, number>) => Object.keys(r).filter((k) => r[k] && k !== "ALU_SEL" && k !== "ALU_SUB").sort();
    expect(on(controlTruth(LDI, 5, flagsOf(0), false, false))).toEqual(["MDR_OUT", "REG_LOAD_D", "T_RESET"]);
    expect(on(controlTruth(JZ, 5, flagsOf(0), false, false))).toEqual(["T_RESET"]);
    expect(on(controlTruth(JZ, 5, flagsOf(1), false, false))).toEqual(["MDR_OUT", "PC_LOAD", "T_RESET"]);
    expect(on(controlTruth(JZ, 0, flagsOf(0), false, false))).toEqual(["MAR_LOAD", "PC_OUT"]);
    expect(on(controlTruth(JZ, 0, flagsOf(0), true, false))).toEqual([]);
    expect(controlTruth(SUB, 0, flagsOf(0), false, false)).toMatchObject({ ALU_SEL: 0, ALU_SUB: 1 });
    expect(controlTruth(SUB, 0, flagsOf(0), false, true)).toMatchObject({ ALU_SEL: 0, ALU_SUB: 0 });
  });

  it("matches signalsAt exhaustively: 16 opcodes × 8 T-states × 8 flag sets × HALTED × RESET", () => {
    const sim = new RefSim(flatten(controlLib(), "CONTROL"));
    const bad: string[] = [];
    let cases = 0;
    let ones = 0;
    for (let op = 0; op < 16; op++)
      for (let t = 0; t < 8; t++)
        for (let f = 0; f < 8; f++)
          for (let h = 0; h < 2; h++)
            for (let r = 0; r < 2; r++) {
              sim.set("OP", op);
              sim.set("T", t);
              sim.set("Z", f & 1);
              sim.set("C", (f >> 1) & 1);
              sim.set("N", (f >> 2) & 1);
              sim.set("HALTED", h);
              sim.set("RESET", r);
              sim.settle();
              const want = controlTruth(op, t, flagsOf(f), !!h, !!r);
              for (const [port, v] of Object.entries(want)) {
                const got = sim.get(port);
                if (got !== v) bad.push(`${OPCODES[op].mnem} T${t} ZCN=${f} H=${h} R=${r}: ${port}=${got}, want ${v}`);
                ones += got ? 1 : 0;
              }
              cases++;
            }
    expect(cases).toBe(4096);
    expect(bad.slice(0, 12)).toEqual([]);
    expect(ones).toBeGreaterThan(0);
  });

  it("is a readable PLA: named decoders, shared FETCH and product terms", () => {
    const lib = controlLib();
    const net = flatten(lib, "CONTROL");
    const names = lib.get("CONTROL")!.instances.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["dec_op", "dec_t", "run", ...SIGNALS.map((s) => `out_${s}`)]));
    expect(lib.get("CONTROL")!.doc).toBeTruthy();
    // FETCH steps are the same for every opcode: the term is the bare T line.
    expect(inputsOf(net, "out_IR_LOAD").sort()).toEqual(["T2", "run"]);
    // Signals with identical truth tables are driven by the same product term / OR tree.
    const truth = (s: Signal) => {
      let bits = "";
      for (let op = 0; op < 16; op++) for (let t = 0; t < 8; t++) for (let f = 0; f < 8; f++) bits += controlTruth(op, t, flagsOf(f), false, false)[s];
      return bits;
    };
    const tables = SIGNALS.map(truth);
    let shared = 0;
    for (let i = 0; i < SIGNALS.length; i++)
      for (let j = i + 1; j < SIGNALS.length; j++)
        if (tables[i] === tables[j]) {
          expect(inputsOf(net, `out_${SIGNALS[i]}`)).toEqual(inputsOf(net, `out_${SIGNALS[j]}`));
          shared++;
        }
    expect(shared).toBeGreaterThan(0);
  });

  it("gate count", () => {
    const lib = controlLib();
    const net = flatten(lib, "CONTROL");
    const s = stats(net);
    const by: Record<string, number> = {};
    for (const g of net.gates) {
      const top = g.path.split("/")[0];
      const part = top.startsWith("dec_") ? top : (/^(op|ops|term|or|out)_/.exec(top)?.[1] ?? top);
      by[part] = (by[part] ?? 0) + 1;
    }
    console.log("CONTROL", s, by);
    expect(s.gates).toBe(net.gates.length);
    expect(s.gates).toBeLessThanOrEqual(140); // regression guard for the term sharing
  });
});
