// Storage cells. The gated D latch is the only feedback loop in the machine (SILICON.md §2):
// flip-flops are two latches, registers are rows of flip-flops.
import { define } from "../hdl/builder";
import type { Library } from "../netlist/types";
import { place } from "./util";

/** DLATCH — feedback mux Q = D·EN + Q·¬EN (4 gates). Transparent while EN=1, holds while EN=0. */
export function defineDLatch(lib: Library): void {
  define(
    lib,
    "DLATCH",
    { in: { D: 1, EN: 1 }, out: { Q: 1 } },
    (b) => {
      const [D, EN, Q] = [b.in1("D"), b.in1("EN"), b.out1("Q")];
      const nen = place(b, "NOT", "nen", [EN]);
      const take = place(b, "AND", "take", [D, EN]); // EN=1: pass D
      const hold = place(b, "AND", "hold", [Q, nen]); // EN=0: recirculate Q
      place(b, "OR", "merge", [take, hold], Q);
    },
    "Gated D latch, feedback mux Q = D·EN + Q·¬EN: transparent while EN=1, holds while EN=0",
  );
}

/** DFF — rising-edge flip-flop: master open while CLK=0, slave open while CLK=1. */
export function defineDff(lib: Library): void {
  define(
    lib,
    "DFF",
    { in: { D: 1, CLK: 1 }, out: { Q: 1 } },
    (b) => {
      const CLK = b.in1("CLK");
      const nclk = place(b, "NOT", "nclk", [CLK]);
      const m = b.wire1("m");
      b.use("DLATCH", { D: b.in1("D"), EN: nclk, Q: m }, "master");
      b.use("DLATCH", { D: m, EN: CLK, Q: b.out1("Q") }, "slave");
    },
    "Rising-edge D flip-flop: master latch open while CLK=0, slave latch open while CLK=1",
  );
}

/** DFFE — load-enable flip-flop without an input mux: master EN = ¬CLK·LOAD, slave EN = CLK.
 * With LOAD=0 the master keeps what it last captured, which is already Q, so Q holds. */
export function defineDffe(lib: Library): void {
  define(
    lib,
    "DFFE",
    { in: { D: 1, LOAD: 1, CLK: 1 }, out: { Q: 1 } },
    (b) => {
      const CLK = b.in1("CLK");
      const nclk = place(b, "NOT", "nclk", [CLK]);
      const men = place(b, "AND", "men", [nclk, b.in1("LOAD")]);
      const m = b.wire1("m");
      b.use("DLATCH", { D: b.in1("D"), EN: men, Q: m }, "master");
      b.use("DLATCH", { D: m, EN: CLK, Q: b.out1("Q") }, "slave");
    },
    "Load-enable flip-flop: master EN = ¬CLK·LOAD, slave EN = CLK; takes D on the rising edge when LOAD=1",
  );
}

/** REG_W<n> — n DFFE bit cells b0..b(n-1) sharing LOAD and CLK. */
export function defineReg(lib: Library, width: number): void {
  define(
    lib,
    `REG_W${width}`,
    { in: { D: width, LOAD: 1, CLK: 1 }, out: { Q: width } },
    (b) => {
      const [D, Q, LOAD, CLK] = [b.in("D"), b.out("Q"), b.in1("LOAD"), b.in1("CLK")];
      for (let i = 0; i < width; i++) b.use("DFFE", { D: D[i], LOAD, CLK, Q: Q[i] }, `b${i}`);
    },
    `${width}-bit register (${width} × DFFE sharing LOAD, CLK): loads D on the rising edge when LOAD=1`,
  );
}
