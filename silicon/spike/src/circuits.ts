// Circuits for the spike, built from gates only (the same patterns as the cell library):
// DLATCH as a feedback mux, DFF as master/slave latches, a 4-bit counter with an
// XOR/AND incrementer.
import { define } from "../../src/hdl/builder";
import { flatten } from "../../src/netlist/flatten";
import type { FlatNetlist, Library } from "../../src/netlist/types";

export function counterLib(): Library {
  const lib: Library = new Map();
  // Gated D latch: Q = D·EN + Q·¬EN
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
  // 4-bit counter: Q ← Q + 1 on every rising edge.
  define(lib, "COUNTER4", { in: { CLK: 1 }, out: { Q: 4 } }, (b) => {
    const q = b.out("Q");
    const clk = b.in1("CLK");
    const d0 = b.NOT(q[0]);
    const d1 = b.XOR(q[1], q[0]);
    const c2 = b.AND(q[0], q[1]);
    const d2 = b.XOR(q[2], c2);
    const c3 = b.AND(c2, q[2]);
    const d3 = b.XOR(q[3], c3);
    [d0, d1, d2, d3].forEach((d, i) => b.use("DFF", { D: d, CLK: clk, Q: q[i] }, `b${i}`));
  });
  return lib;
}

export function counterNetlist(): FlatNetlist {
  return flatten(counterLib(), "COUNTER4");
}
