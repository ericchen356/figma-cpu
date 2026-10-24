// The datapath blocks of the CPU (SILICON.md §5), every one built from gates and the generic
// cells in src/cells. The top level (src/cpu/cpu.ts) wires them to the bus and the control unit.
//
//   ALU      A[8] B[8] SEL[3] SUB → Y[8] CO Z N        adder / AND / OR / XOR / NOT A
//   REGFILE  D[8] WSEL[2] WE RSEL[2] CLK → Q[8] R0..R3  four REG_W8, one write port, one read port
//   RAM_ROW  D[8] WE SEL → Q[8] RD[8]                  one byte of RAM: 8 DLATCH + read gates
//   RAM16    ADDR[4] DIN[8] WE CLK → DOUT[8]           16 RAM_ROW, written only while CLK=0
//   PC4      D[4] LOAD INC RESET CLK → Q[4]            program counter
//   TSTATE   T_RESET RESET HALTED CLK → Q[3]           T-state counter (frozen while halted)
//   HALT_FF  HALT RESET CLK → Q                        the HALTED flip-flop
//   BUSMUX   PC[4] PC_OUT MDR[8] MDR_OUT REG[8] REG_OUT Y[8] Y_OUT → BUS[8]
//
// Timing (SILICON.md §2): every enable that opens a latch while CLK=0 (DFFE masters, RAM bits)
// is computed from flip-flop outputs and combinational logic only, so it is stable during the
// LOW pass. Inside every cell the gate that computes a latch enable comes before the latch, so
// even a naive in-order simulator never sees a stale enable.
import { define } from "../hdl/builder";
import { place } from "../cells/util";
import { ALU_SEL } from "../isa/spec";
import { CONST1, type Library } from "../netlist/types";

/** ALU functions and their SEL codes (the decoder line that selects each), from spec.ts. */
const ALU_FUNCS = [
  ["add", ALU_SEL.ADD],
  ["and", ALU_SEL.AND],
  ["or", ALU_SEL.OR],
  ["xor", ALU_SEL.XOR],
  ["not", ALU_SEL.NOT],
] as const;

/** ALU — B' = B ⊕ SUB feeds an ADDER_W8 with CI = SUB (so SUB gives A + ¬B + 1); AND, OR, XOR
 * and NOT A per bit; a DEC3 on SEL picks one result per bit with an AND-OR plane.
 * CO = adder carry · (SEL = 0); Z = ZERO_W8(Y); N = Y[7]. SEL 5–7 give Y = 0. */
export function defineAlu(lib: Library): void {
  define(
    lib,
    "ALU",
    { in: { A: 8, B: 8, SEL: 3, SUB: 1 }, out: { Y: 8, CO: 1, Z: 1, N: 1 } },
    (b) => {
      const [A, B, SUB, Y] = [b.in("A"), b.in("B"), b.in1("SUB"), b.out("Y")];
      // Adder: the subtract trick is two's complement, A + ¬B + 1.
      const bx = b.wire("bx", 8);
      for (let i = 0; i < 8; i++) place(b, "XOR", `bx${i}`, [B[i], SUB], bx[i]);
      const sum = b.wire("sum", 8);
      const carry = b.wire1("carry");
      b.use("ADDER_W8", { A, B: bx, CI: SUB, S: sum, CO: carry }, "add");

      // Bitwise functions.
      const fn = {
        add: sum,
        and: A.map((a, i) => place(b, "AND", `and${i}`, [a, B[i]])),
        or: A.map((a, i) => place(b, "OR", `or${i}`, [a, B[i]])),
        xor: A.map((a, i) => place(b, "XOR", `xor${i}`, [a, B[i]])),
        not: A.map((a, i) => place(b, "NOT", `not${i}`, [a])),
      };

      // Result select: one-hot lines sel[k] (k = SEL), then per bit an AND-OR of the 5 results.
      const lines = b.wire("sel", 8);
      b.use("DEC3", { A: b.in("SEL"), EN: CONST1, Y: lines }, "dec");
      for (let i = 0; i < 8; i++) {
        const picked = ALU_FUNCS.map(([f, sel]) => place(b, "AND", `pick_${f}${i}`, [fn[f][i], lines[sel]]));
        const lo = place(b, "OR", `merge_a${i}`, [picked[0], picked[1]]);
        const hi = place(b, "OR", `merge_b${i}`, [picked[2], picked[3]]);
        const mid = place(b, "OR", `merge_c${i}`, [lo, hi]);
        place(b, "OR", `result${i}`, [mid, picked[4]], Y[i]);
      }

      place(b, "AND", "carry_out", [carry, lines[ALU_SEL.ADD]], b.out1("CO"));
      b.use("ZERO_W8", { A: Y, Z: b.out1("Z") }, "zero");
      place(b, "BUF", "sign", [Y[7]], b.out1("N"));
    },
    "8-bit ALU: SEL 0 = A + B (SUB: A + ¬B + 1, CO = 1 means no borrow), 1 = AND, 2 = OR, 3 = XOR, " +
      "4 = NOT A. CO is the adder carry only when SEL = 0; Z = (Y = 0); N = Y[7].",
  );
}

/** REGFILE — R0..R3 as REG_W8 r0..r3. Write port: DEC2(WSEL, EN = WE) gives each register's
 * LOAD. Read port: a MUX4_W8 on RSEL. R0..R3 are also outputs (for the display / probes). */
export function defineRegfile(lib: Library): void {
  define(
    lib,
    "REGFILE",
    { in: { D: 8, WSEL: 2, WE: 1, RSEL: 2, CLK: 1 }, out: { Q: 8, R0: 8, R1: 8, R2: 8, R3: 8 } },
    (b) => {
      const [D, CLK] = [b.in("D"), b.in1("CLK")];
      const load = b.wire("load", 4);
      b.use("DEC2", { A: b.in("WSEL"), EN: b.in1("WE"), Y: load }, "wdec");
      const R = [0, 1, 2, 3].map((k) => b.out(`R${k}`));
      R.forEach((Q, k) => b.use("REG_W8", { D, LOAD: load[k], CLK, Q }, `r${k}`));
      b.use("MUX4_W8", { A: R[0], B: R[1], C: R[2], D: R[3], S: b.in("RSEL"), Y: b.out("Q") }, "rmux");
    },
    "Register file R0–R3: R[WSEL] ← D on the rising edge when WE = 1; Q = R[RSEL]",
  );
}

/** RAM_ROW — one byte: 8 DLATCH b0..b7 written while WE·SEL (WE already includes ¬CLK),
 * and read gates RD = Q·SEL for the RAM's output OR plane. */
export function defineRamRow(lib: Library): void {
  define(
    lib,
    "RAM_ROW",
    { in: { D: 8, WE: 1, SEL: 1 }, out: { Q: 8, RD: 8 } },
    (b) => {
      const [D, Q, RD, SEL] = [b.in("D"), b.out("Q"), b.out("RD"), b.in1("SEL")];
      // The enable is computed before the latches (see the timing note at the top).
      const en = place(b, "AND", "wen", [b.in1("WE"), SEL]);
      for (let i = 0; i < 8; i++) b.use("DLATCH", { D: D[i], EN: en, Q: Q[i] }, `b${i}`);
      for (let i = 0; i < 8; i++) place(b, "AND", `rd${i}`, [Q[i], SEL], RD[i]);
    },
    "One RAM byte: 8 D latches open while WE·SEL; RD = Q·SEL (read gating)",
  );
}

/** RAM16 — 16 RAM_ROW row0..row15. Rows are written only during the LOW pass:
 * EN_k = ¬CLK · WE · (ADDR = k), with DIN from the MDR flip-flops, so the RAM never sees its
 * own output in the same phase. DOUT[i] = OR over k of row_k.Q[i]·(ADDR = k). */
export function defineRam16(lib: Library): void {
  define(
    lib,
    "RAM16",
    { in: { ADDR: 4, DIN: 8, WE: 1, CLK: 1 }, out: { DOUT: 8 } },
    (b) => {
      const [DIN, DOUT] = [b.in("DIN"), b.out("DOUT")];
      // Write strobe first, so every row enable sees ¬CLK of the current pass.
      const nclk = place(b, "NOT", "nclk", [b.in1("CLK")]);
      const we = place(b, "AND", "we_low", [nclk, b.in1("WE")]);
      const sel = b.wire("sel", 16);
      b.use("DEC4", { A: b.in("ADDR"), EN: CONST1, Y: sel }, "dec");
      const rd: string[][] = [];
      for (let k = 0; k < 16; k++)
        rd.push(b.use("RAM_ROW", { D: DIN, WE: we, SEL: sel[k], Q: b.wire(`mem${k}`, 8), RD: b.wire(`rd${k}`, 8) }, `row${k}`).RD);
      // Output OR plane: a balanced tree of 15 ORs per bit.
      for (let i = 0; i < 8; i++) {
        let level = rd.map((r) => r[i]);
        let depth = 1;
        while (level.length > 1) {
          const next: string[] = [];
          for (let j = 0; j < level.length; j += 2)
            next.push(place(b, "OR", `out${i}_${depth}_${j / 2}`, [level[j], level[j + 1]], level.length === 2 ? DOUT[i] : undefined));
          level = next;
          depth++;
        }
      }
    },
    "16 × 8 RAM of D latches: row ADDR is written with DIN while CLK = 0 and WE = 1; DOUT = row ADDR",
  );
}

/** PC4 — program counter: D_next = RESET ? 0 : LOAD ? D : PC + 1, loaded when LOAD + INC + RESET. */
export function definePc4(lib: Library): void {
  define(
    lib,
    "PC4",
    { in: { D: 4, LOAD: 1, INC: 1, RESET: 1, CLK: 1 }, out: { Q: 4 } },
    (b) => {
      const [D, Q, LOAD, RESET] = [b.in("D"), b.out("Q"), b.in1("LOAD"), b.in1("RESET")];
      const next = b.wire("next", 4);
      b.use("INC_W4", { A: Q, Y: next }, "inc");
      const pick = b.wire("pick", 4);
      b.use("MUX2_W4", { A: next, B: D, S: LOAD, Y: pick }, "src");
      const nrst = place(b, "NOT", "nrst", [RESET]);
      const d = pick.map((p, i) => place(b, "AND", `clr${i}`, [p, nrst]));
      const step = place(b, "OR", "step", [LOAD, b.in1("INC")]);
      const load = place(b, "OR", "load", [step, RESET]);
      b.use("REG_W4", { D: d, LOAD: load, CLK: b.in1("CLK"), Q }, "reg");
    },
    "4-bit program counter: PC ← 0 on RESET, ← D on LOAD, ← PC + 1 on INC",
  );
}

/** TSTATE — 3-bit T-state counter: T ← 0 on RESET or T_RESET, else T + 1; frozen while HALTED
 * (LOAD = ¬HALTED + RESET). */
export function defineTstate(lib: Library): void {
  define(
    lib,
    "TSTATE",
    { in: { T_RESET: 1, RESET: 1, HALTED: 1, CLK: 1 }, out: { Q: 3 } },
    (b) => {
      const [Q, RESET] = [b.out("Q"), b.in1("RESET")];
      const next = b.wire("next", 3);
      b.use("INC_W3", { A: Q, Y: next }, "inc");
      const clr = place(b, "OR", "clr", [b.in1("T_RESET"), RESET]);
      const keep = place(b, "NOT", "keep", [clr]);
      const d = next.map((n, i) => place(b, "AND", `d${i}`, [n, keep]));
      const run = place(b, "NOT", "run", [b.in1("HALTED")]);
      const load = place(b, "OR", "load", [run, RESET]);
      b.use("REG_W3", { D: d, LOAD: load, CLK: b.in1("CLK"), Q }, "reg");
    },
    "T-state counter: T ← 0 on RESET or T_RESET, else T + 1; holds while HALTED (unless RESET)",
  );
}

/** HALT_FF — HALTED ← ¬RESET · (HALTED + HALT). */
export function defineHaltFf(lib: Library): void {
  define(
    lib,
    "HALT_FF",
    { in: { HALT: 1, RESET: 1, CLK: 1 }, out: { Q: 1 } },
    (b) => {
      const Q = b.out1("Q");
      const set = place(b, "OR", "set", [Q, b.in1("HALT")]);
      const nrst = place(b, "NOT", "nrst", [b.in1("RESET")]);
      const d = place(b, "AND", "d", [set, nrst]);
      b.use("DFF", { D: d, CLK: b.in1("CLK"), Q }, "ff");
    },
    "HALTED flip-flop: set by HALT, cleared by RESET (synchronous)",
  );
}

/** BUSMUX — the shared bus as an AND-OR of the drivers (the control unit enables at most one).
 * PC drives only bits 0–3; bits 4–7 read 0 then. Nothing enabled → 0. */
export function defineBusmux(lib: Library): void {
  define(
    lib,
    "BUSMUX",
    {
      in: { PC: 4, PC_OUT: 1, MDR: 8, MDR_OUT: 1, REG: 8, REG_OUT: 1, Y: 8, Y_OUT: 1 },
      out: { BUS: 8 },
    },
    (b) => {
      const BUS = b.out("BUS");
      const drivers: [string, string[], string][] = [
        ["pc", b.in("PC"), b.in1("PC_OUT")],
        ["mdr", b.in("MDR"), b.in1("MDR_OUT")],
        ["reg", b.in("REG"), b.in1("REG_OUT")],
        ["y", b.in("Y"), b.in1("Y_OUT")],
      ];
      for (let i = 0; i < 8; i++) {
        const terms = drivers
          .filter(([, src]) => i < src.length)
          .map(([name, src, en]) => place(b, "AND", `${name}${i}`, [src[i], en]));
        // Balanced OR of the 3 or 4 terms.
        const ab = place(b, "OR", `or_a${i}`, [terms[0], terms[1]]);
        if (terms.length === 4) {
          const cd = place(b, "OR", `or_b${i}`, [terms[2], terms[3]]);
          place(b, "OR", `bus${i}`, [ab, cd], BUS[i]);
        } else place(b, "OR", `bus${i}`, [ab, terms[2]], BUS[i]);
      }
    },
    "The bus: BUS = PC·PC_OUT + MDR·MDR_OUT + REG·REG_OUT + Y·Y_OUT (PC drives bits 0–3 only)",
  );
}

/** Every datapath module, in dependency order. */
export const DATAPATH_MODULES = ["ALU", "REGFILE", "RAM_ROW", "RAM16", "PC4", "TSTATE", "HALT_FF", "BUSMUX"] as const;

/** Defines the datapath modules (needs the cell library: run buildCells first). */
export function buildDatapath(lib: Library): void {
  defineAlu(lib);
  defineRegfile(lib);
  defineRamRow(lib);
  defineRam16(lib);
  definePc4(lib);
  defineTstate(lib);
  defineHaltFf(lib);
  defineBusmux(lib);
}
