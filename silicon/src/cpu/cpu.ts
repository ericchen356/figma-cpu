// The CPU top level (SILICON.md §5): the datapath blocks, the control unit and the bus, wired
// as in the handoff architecture. Inputs CLK and RESET; outputs OUT[8] and two 7-segment digits.
//
//   ctrl (CONTROL)  OP = ir[7:4], T = t, flags, halted, RESET → one net per control signal
//   busmux          bus = pc·PC_OUT + mdr·MDR_OUT + R[rsel]·(REG_OUT_D + REG_OUT_S) + y·Y_OUT
//   regs (REGFILE)  write R[ir[3:2]] ← bus on REG_LOAD_D; read R[rsel],
//                   rsel = REG_OUT_S ? ir[1:0] (Rs) : ir[3:2] (Rd)
//   alu             A = a (A latch), B = bus, SEL / SUB from ctrl
//   mar ← bus[0:3], ir ← bus, alatch ← bus, ylatch ← alu.Y, fz/fc/fn ← alu flags (FLAGS_LOAD)
//   mdr ← MEM_READ ? ram.DOUT : bus, loaded on MDR_LOAD + MEM_READ
//   ram (RAM16)     ADDR = mar, DIN = mdr, WE = MEM_WRITE (written while CLK = 0)
//   outreg ← mdr when MEM_WRITE · (mar = 15); seg_lo / seg_hi show its two hex digits
//   pc (PC4), tstate (TSTATE), halt (HALT_FF): synchronous RESET → PC = 0, T = 0, HALTED = 0
//
// Top-level net names (also the probe names, src/cpu/probes.ts): pc mar ir mdr a y flag_z
// flag_c flag_n t halted r0..r3 bus, and one net per control signal named like the signal.
import { buildCells } from "../cells";
import { define } from "../hdl/builder";
import { place } from "../cells/util";
import { SIGNALS } from "../isa/spec";
import { flatten } from "../netlist/flatten";
import type { FlatNetlist, Library } from "../netlist/types";
import { buildControl } from "./control";
import { buildDatapath } from "./datapath";

/** Defines every CPU module and the `CPU` top level. Defines the cell library, the control
 * unit and the datapath first when they are not in `lib` yet. */
export function buildCpu(lib: Library): void {
  if (!lib.has("DLATCH")) buildCells(lib);
  if (!lib.has("CONTROL")) buildControl(lib);
  if (!lib.has("ALU")) buildDatapath(lib);
  define(
    lib,
    "CPU",
    { in: { CLK: 1, RESET: 1 }, out: { OUT: 8, SEG_LO: 7, SEG_HI: 7 } },
    (b) => {
      const [CLK, RESET, OUT] = [b.in1("CLK"), b.in1("RESET"), b.out("OUT")];

      // State nets (flip-flop outputs) and the bus.
      const pc = b.wire("pc", 4);
      const mar = b.wire("mar", 4);
      const ir = b.wire("ir", 8);
      const mdr = b.wire("mdr", 8);
      const a = b.wire("a", 8);
      const y = b.wire("y", 8);
      const [z, c, n] = [b.wire1("flag_z"), b.wire1("flag_c"), b.wire1("flag_n")];
      const t = b.wire("t", 3);
      const halted = b.wire1("halted");
      const r = [0, 1, 2, 3].map((k) => b.wire(`r${k}`, 8));
      const bus = b.wire("bus", 8);

      // Control signals, one net per SIGNALS entry, plus the ALU function.
      const sig = Object.fromEntries(SIGNALS.map((s) => [s, b.wire1(s)])) as Record<(typeof SIGNALS)[number], string>;
      const aluSel = b.wire("alu_sel", 3);
      const aluSub = b.wire1("alu_sub");

      // Registers first: in-order simulators then see fresh flip-flop outputs in the same sweep.
      b.use("PC4", { D: bus.slice(0, 4), LOAD: sig.PC_LOAD, INC: sig.PC_INC, RESET, CLK, Q: pc }, "pc");
      b.use("REG_W4", { D: bus.slice(0, 4), LOAD: sig.MAR_LOAD, CLK, Q: mar }, "mar");
      b.use("REG_W8", { D: bus, LOAD: sig.IR_LOAD, CLK, Q: ir }, "ir");
      const mdrIn = b.wire("mdr_in", 8);
      const mdrLoad = place(b, "OR", "mdr_load", [sig.MDR_LOAD, sig.MEM_READ]);
      b.use("REG_W8", { D: mdrIn, LOAD: mdrLoad, CLK, Q: mdr }, "mdr");
      b.use("REG_W8", { D: bus, LOAD: sig.A_LOAD, CLK, Q: a }, "alatch");
      const aluY = b.wire("alu_y", 8);
      const [aluZ, aluC, aluN] = [b.wire1("alu_z"), b.wire1("alu_c"), b.wire1("alu_n")];
      b.use("REG_W8", { D: aluY, LOAD: sig.Y_LOAD, CLK, Q: y }, "ylatch");
      b.use("DFFE", { D: aluZ, LOAD: sig.FLAGS_LOAD, CLK, Q: z }, "fz");
      b.use("DFFE", { D: aluC, LOAD: sig.FLAGS_LOAD, CLK, Q: c }, "fc");
      b.use("DFFE", { D: aluN, LOAD: sig.FLAGS_LOAD, CLK, Q: n }, "fn");
      b.use("TSTATE", { T_RESET: sig.T_RESET, RESET, HALTED: halted, CLK, Q: t }, "tstate");
      b.use("HALT_FF", { HALT: sig.HALT, RESET, CLK, Q: halted }, "halt");

      // Control unit.
      b.use(
        "CONTROL",
        { OP: ir.slice(4, 8), T: t, Z: z, C: c, N: n, HALTED: halted, RESET, ...sig, ALU_SEL: aluSel, ALU_SUB: aluSub },
        "ctrl",
      );

      // Register file: Rd = ir[3:2] is the write port and the default read port, Rs = ir[1:0].
      const rd = ir.slice(2, 4);
      const rs = ir.slice(0, 2);
      const rsel = b.wire("rsel", 2);
      for (let i = 0; i < 2; i++) b.use("MUX2", { A: rd[i], B: rs[i], S: sig.REG_OUT_S, Y: rsel[i] }, `rsel${i}`);
      const regQ = b.wire("reg_q", 8);
      b.use(
        "REGFILE",
        { D: bus, WSEL: rd, WE: sig.REG_LOAD_D, RSEL: rsel, CLK, Q: regQ, R0: r[0], R1: r[1], R2: r[2], R3: r[3] },
        "regs",
      );

      // The bus.
      const regOut = place(b, "OR", "reg_out", [sig.REG_OUT_D, sig.REG_OUT_S]);
      b.use(
        "BUSMUX",
        { PC: pc, PC_OUT: sig.PC_OUT, MDR: mdr, MDR_OUT: sig.MDR_OUT, REG: regQ, REG_OUT: regOut, Y: y, Y_OUT: sig.Y_OUT, BUS: bus },
        "busmux",
      );

      // ALU: A latch and bus in, result and flags to the Y latch and flag flip-flops.
      b.use("ALU", { A: a, B: bus, SEL: aluSel, SUB: aluSub, Y: aluY, CO: aluC, Z: aluZ, N: aluN }, "alu");

      // Memory: MDR takes the RAM output on MEM_READ, the bus otherwise.
      const ramOut = b.wire("ram_out", 8);
      b.use("MUX2_W8", { A: bus, B: ramOut, S: sig.MEM_READ, Y: mdrIn }, "mdr_src");
      b.use("RAM16", { ADDR: mar, DIN: mdr, WE: sig.MEM_WRITE, CLK, DOUT: ramOut }, "ram");

      // Output port: a store to address 15 also latches OUT.
      const marLo = place(b, "AND", "mar_lo", [mar[0], mar[1]]);
      const marHi = place(b, "AND", "mar_hi", [mar[2], mar[3]]);
      const atOut = place(b, "AND", "at_out", [marLo, marHi]);
      const outLoad = place(b, "AND", "out_load", [sig.MEM_WRITE, atOut]);
      b.use("REG_W8", { D: mdr, LOAD: outLoad, CLK, Q: OUT }, "outreg");
      b.use("HEX7SEG", { A: OUT.slice(0, 4), SEG: b.out("SEG_LO") }, "seg_lo");
      b.use("HEX7SEG", { A: OUT.slice(4, 8), SEG: b.out("SEG_HI") }, "seg_hi");
    },
    "The CPU: 8-bit data, one shared bus, 16 bytes of RAM, R0–R3, flags Z C N, a PLA control unit " +
      "stepping T-states T0–T7. OUT shows every store to address 15 on two hex digits.",
  );
}

/** A fresh library with the cell library, the control unit, the datapath and `CPU`. */
export function cpuLibrary(): Library {
  const lib: Library = new Map();
  buildCpu(lib);
  return lib;
}

/** The whole CPU flattened to gates. */
export function cpuNetlist(): FlatNetlist {
  return flatten(cpuLibrary(), "CPU");
}

/** Gate count per top-level instance of a flattened netlist (top-level glue gates under "(top)"). */
export function gatesByBlock(net: FlatNetlist): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of net.gates) {
    const slash = g.path.indexOf("/");
    const block = slash < 0 ? "(top)" : g.path.slice(0, slash);
    out[block] = (out[block] ?? 0) + 1;
  }
  return out;
}
