import { describe, expect, it } from "vitest";
import { define } from "../src/hdl/builder";
import { flatten, NetlistError } from "../src/netlist/flatten";
import type { Library } from "../src/netlist/types";
import { RefSim } from "../src/sim/reference";

/** Latch and flip-flop built from gates only — the pattern the cell library uses. */
function miniLib(): Library {
  const lib: Library = new Map();
  // Gated D latch as a feedback mux: Q = D·EN + Q·¬EN
  define(lib, "DLATCH", { in: { D: 1, EN: 1 }, out: { Q: 1 } }, (b) => {
    const nen = b.NOT(b.in1("EN"));
    const take = b.AND(b.in1("D"), b.in1("EN"));
    const hold = b.AND(b.out1("Q"), nen);
    b.OR(take, hold, b.out1("Q"));
  });
  // Rising-edge D flip-flop: master transparent while CLK=0, slave while CLK=1.
  define(lib, "DFF", { in: { D: 1, CLK: 1 }, out: { Q: 1 } }, (b) => {
    const nclk = b.NOT(b.in1("CLK"));
    const m = b.use("DLATCH", { D: b.in1("D"), EN: nclk }, "master").Q[0];
    b.use("DLATCH", { D: m, EN: b.in1("CLK"), Q: b.out1("Q") }, "slave");
  });
  define(lib, "COUNTER2", { in: { CLK: 1 }, out: { Q: 2 } }, (b) => {
    const [q0, q1] = b.out("Q");
    b.use("DFF", { D: b.NOT(q0), CLK: b.in1("CLK"), Q: q0 }, "b0");
    b.use("DFF", { D: b.XOR(q0, q1), CLK: b.in1("CLK"), Q: q1 }, "b1");
  });
  return lib;
}

describe("foundation: builder → flatten → reference sim", () => {
  it("a latch built from gates is transparent when EN=1 and holds when EN=0", () => {
    const sim = new RefSim(flatten(miniLib(), "DLATCH"));
    sim.set("EN", 1);
    sim.set("D", 1);
    sim.settle();
    expect(sim.get("Q")).toBe(1);
    sim.set("EN", 0);
    sim.set("D", 0);
    sim.settle();
    expect(sim.get("Q")).toBe(1); // held
    sim.set("EN", 1);
    sim.settle();
    expect(sim.get("Q")).toBe(0);
  });

  it("a flip-flop built from two latches only changes on the rising edge", () => {
    const sim = new RefSim(flatten(miniLib(), "DFF"));
    sim.set("D", 1);
    sim.set("CLK", 0);
    sim.settle();
    expect(sim.get("Q")).toBe(0);
    sim.set("CLK", 1);
    sim.settle();
    expect(sim.get("Q")).toBe(1);
    sim.set("D", 0);
    sim.settle();
    expect(sim.get("Q")).toBe(1); // D changed while CLK high: no effect
    sim.tick();
    expect(sim.get("Q")).toBe(0);
  });

  it("a 2-bit counter of gate-level flip-flops counts", () => {
    const net = flatten(miniLib(), "COUNTER2");
    const sim = new RefSim(net);
    const seen = [];
    for (let i = 0; i < 6; i++) {
      sim.tick();
      seen.push(sim.get("Q"));
    }
    expect(seen).toEqual([1, 2, 3, 0, 1, 2]);
    expect(net.gates.length).toBe(2 * (1 + 2 * 4) + 2); // 2 DFFs (NOT + 2 latches of 4) + NOT + XOR
    expect(net.aliases.get("b1/master/Q")).toBe(net.aliases.get("b1/slave/D"));
  });

  it("reports two drivers on one net", () => {
    const lib: Library = new Map();
    define(lib, "BAD", { in: { A: 1 }, out: { Y: 1 } }, (b) => {
      b.NOT(b.in1("A"), b.out1("Y"));
      b.BUF(b.in1("A"), b.out1("Y"));
    });
    expect(() => flatten(lib, "BAD")).toThrow(NetlistError);
  });
});
