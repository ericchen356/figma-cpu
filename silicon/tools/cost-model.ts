// Cost model for CPU v2: what a bigger / richer gate-level CPU costs in gates, Figma variables,
// Figma layers and prototype actions per tick. Nothing here is a formula fitted to the current
// CPU: every configuration is BUILT as a real netlist out of the same cells (src/cells), the
// same datapath blocks (src/cpu/datapath.ts) and a PLA generated the same way as
// src/cpu/control.ts, then flattened, compiled (src/compile) and planned (src/prototype/plan.ts).
// Layers come from the same layout code the plugin draws with (src/figma/layout.ts), counted
// node for node the way src/figma/draw.ts creates them (checked against a full draw on the fake
// Figma API in test/cost-model.test.ts).
//
// Calibration: the base configuration (addrBits 4, 4 registers, no features) builds a netlist
// IDENTICAL to cpuNetlist() (same gates, same nets, same order): 2,285 gates, RAM 808.
//
// Parametrized here (src/ is not edited):
//   RAM<2^N>  generic RAM16: 2^N RAM_ROW, a DEC<N> one-hot decoder, an OR plane per bit
//   PC<N>     generic PC4: INC_W<N> + MUX2_W<N> + reset gating + REG_W<N>
//   DEC<N>    generic DEC3/DEC4: address pairs predecoded, EN folded into the top group, groups
//             combined by a balanced AND tree (N = 3, 4 give exactly DEC3 / DEC4's gate counts)
//   BUSMUX    the bus AND-OR with a PC of min(N, 8) bits and an optional SP driver
//   CONTROL   the PLA of src/cpu/control.ts, generalized over the opcode table, the signal list
//             and the flag inputs (v1 table → exactly the real CONTROL)
//   SP<w>     stack pointer (CALL/RET): up/down counter whose all-zero state is its reset value
//   REGFILE8  8 registers as two banks of 4 (bank bit is memory-mapped)
//   CPU       the top level of src/cpu/cpu.ts plus the optional v2 hardware
import { buildCells, defineAdder, defineDecN as defineDecCell, defineMux4W, defineReg, place } from "../src/cells";
import { compile, powerOn } from "../src/compile";
import { defineAlu, defineHaltFf, definePc, defineRam, defineRamRow, defineRegfile, defineTstate } from "../src/cpu/datapath";
import { dependencyOrder } from "../src/figma/draw";
import { type CellGeom, layoutModule } from "../src/figma/layout";
import { textWidth } from "../src/figma/style";
import { gateGeom } from "../src/figma/symbols";
import { define, type ModuleBuilder } from "../src/hdl/builder";
import { FETCH, OPCODES, RAM_ADDR_BITS, SIGNALS } from "../src/isa/spec";
import { flatten } from "../src/netlist/flatten";
import { CONST0, CONST1, type FlatNetlist, GATE_ARITY, type GateType, gateTypeOf, isGateCell, type Library } from "../src/netlist/types";
import { chunkTick, DEFAULT_MAX_ACTIONS_PER_EVENT, needsChunks, plan, worstActions } from "../src/prototype/plan";

// =====================================================================================
// Configuration
// =====================================================================================

export interface CpuConfig {
  /** Address bits of PC / MAR / RAM: 4 → 16 bytes … 10 → 1 KB. */
  addrBits: number;
  /** 4 (R0–R3) or 8 (two banks of 4, bank bit at a memory-mapped address). */
  registers: 4 | 8;
  /** LDR Rd,[Rs] and STR Rd,[Rs] (v2 ISA). */
  indirectLoadStore: boolean;
  /** CALL a / RET with a stack pointer and a RAM stack (v2 ISA). */
  callRet: boolean;
  /** 8-bit input port IN, read by LD from a memory-mapped address. */
  inputPort: boolean;
  /** Force the ISA. Default: v2 when indirect / call / addrBits > 8 need it, else the current v1. */
  isa?: "v1" | "v2";
}

/** The CPU as built (src/cpu): v1 ISA, RAM_ADDR_BITS address bits, no extra features. */
export const BASE: CpuConfig = { addrBits: RAM_ADDR_BITS, registers: 4, indirectLoadStore: false, callRet: false, inputPort: false };
/** Every v2 feature on (4 registers). */
export const V2_ALL: Omit<CpuConfig, "addrBits"> = { registers: 4, indirectLoadStore: true, callRet: true, inputPort: true };

export function validate(cfg: CpuConfig): void {
  if (!Number.isInteger(cfg.addrBits) || cfg.addrBits < 4 || cfg.addrBits > 10) throw new Error(`addrBits ${cfg.addrBits}: must be 4..10`);
  if (cfg.registers !== 4 && cfg.registers !== 8) throw new Error(`registers ${cfg.registers}: must be 4 or 8`);
  if (cfg.isa === "v1" && (cfg.indirectLoadStore || cfg.callRet || cfg.addrBits > 8))
    throw new Error("the v1 ISA has no opcodes for LDR/STR/CALL/RET and cannot address more than 8 bits (ST uses IR[1:0])");
}

export const isaName = (cfg: CpuConfig): "v1" | "v2" => cfg.isa ?? (cfg.indirectLoadStore || cfg.callRet || cfg.addrBits > 8 ? "v2" : "v1");

/** Memory-mapped IO at the top of the address space: OUT = top (as now), IN = top − 1, BANK = top − 2. */
export function ioMap(cfg: CpuConfig): { out: number; in?: number; bank?: number; ioBytes: number } {
  const top = (1 << cfg.addrBits) - 1;
  return {
    out: top,
    ...(cfg.inputPort ? { in: top - 1 } : {}),
    ...(cfg.registers === 8 ? { bank: top - 2 } : {}),
    ioBytes: 1 + (cfg.inputPort || cfg.registers === 8 ? 1 : 0) + (cfg.registers === 8 ? 1 : 0),
  };
}

/** Stack pointer width and reset value: the stack lives in the low 256 bytes, starting just
 * below the IO bytes (or at 0xFF when N > 8, where IO is out of page 0). Empty-descending. */
export function spInfo(cfg: CpuConfig): { width: number; init: number } {
  const width = Math.min(cfg.addrBits, 8);
  const init = cfg.addrBits <= 8 ? (1 << width) - 1 - ioMap(cfg).ioBytes : 0xff;
  return { width, init };
}

// =====================================================================================
// ISA tables (v1 = src/isa/spec.ts, v2 = the proposal in docs/CPU-V2.md)
// =====================================================================================

export interface PlaStep {
  t: number;
  signals: string[];
  when?: { flag: string; signals: string[] };
}
export interface PlaOp {
  code: number;
  mnem: string;
  operands: string[];
  alu?: { sel: number; sub: boolean };
  /** T3 onward (T0–T2 are the fetch). */
  steps: PlaStep[];
  doc: string;
}
export interface Isa {
  name: "v1" | "v2";
  fetch: PlaStep[];
  ops: PlaOp[];
  signals: string[];
  /** PLA flag inputs used by `when` steps. */
  flags: string[];
  tBits: number;
}

export const V1: Isa = {
  name: "v1",
  fetch: FETCH as PlaStep[],
  ops: OPCODES.map((o) => ({ ...o, operands: [...o.operands], steps: o.steps as PlaStep[] })),
  signals: [...SIGNALS],
  flags: ["Z", "C", "N"],
  tBits: 3,
};

const OPERAND: PlaStep[] = [
  { t: 3, signals: ["PC_OUT", "MAR_LOAD"] },
  { t: 4, signals: ["MEM_READ", "PC_INC"] },
];
const ALU3 = (last: string[] = ["REG_OUT_S", "Y_LOAD", "FLAGS_LOAD"]): PlaStep[] => [
  { t: 3, signals: ["REG_OUT_D", "A_LOAD"] },
  { t: 4, signals: last },
  { t: 5, signals: ["Y_OUT", "REG_LOAD_D", "T_RESET"] },
];
const RESERVED = (code: number, why: string): PlaOp => ({
  code,
  mnem: `RSV${code.toString(16).toUpperCase()}`,
  operands: [],
  steps: [{ t: 3, signals: ["T_RESET"] }],
  doc: `reserved (${why} not built): behaves as NOP`,
});

/** The proposed CPU v2 instruction set. Instruction byte [7:4] opcode · [3:2] Rd · [1:0] Rs, as
 * in v1. Changes: NOP dropped (= MOV R0,R0), JMP/JZ/JC/JN merged into J<cc> (cc = IR[3:2]:
 * 00 always, 01 Z, 10 C, 11 N), ST takes its source in the Rd field (so IR[1:0] is free),
 * HLT moves to 0x0 (running into zeroed memory halts). Freed codes: LDR, STR, CALL, RET.
 * Address operands are {IR[1:0], byte} when N > 8 (IR[1:0] = page bits). IN / OUT / BANK are
 * memory-mapped (see ioMap), so they need no opcode. */
export function v2Isa(cfg: Pick<CpuConfig, "indirectLoadStore" | "callRet">): Isa {
  const ops: PlaOp[] = [
    { code: 0x0, mnem: "HLT", operands: [], steps: [{ t: 3, signals: ["HALT", "T_RESET"] }], doc: "stop the clock (opcode 0: zeroed memory halts)" },
    {
      code: 0x1,
      mnem: "LDI",
      operands: ["Rd", "imm"],
      steps: [...OPERAND, { t: 5, signals: ["MDR_OUT", "REG_LOAD_D", "T_RESET"] }],
      doc: "Rd ← n",
    },
    {
      code: 0x2,
      mnem: "LD",
      operands: ["Rd", "addr"],
      steps: [...OPERAND, { t: 5, signals: ["MDR_OUT", "MAR_LOAD"] }, { t: 6, signals: ["MEM_READ"] }, { t: 7, signals: ["MDR_OUT", "REG_LOAD_D", "T_RESET"] }],
      doc: "Rd ← mem[a] (a = IN address reads the input port)",
    },
    {
      code: 0x3,
      mnem: "ST",
      operands: ["Rd", "addr"],
      steps: [...OPERAND, { t: 5, signals: ["MDR_OUT", "MAR_LOAD"] }, { t: 6, signals: ["REG_OUT_D", "MDR_LOAD"] }, { t: 7, signals: ["MEM_WRITE", "T_RESET"] }],
      doc: "mem[a] ← Rd (source moved from the Rs field to the Rd field; a = OUT shows it)",
    },
    cfg.indirectLoadStore
      ? {
          code: 0x4,
          mnem: "LDR",
          operands: ["Rd", "Rs"],
          steps: [{ t: 3, signals: ["REG_OUT_S", "MAR_LOAD"] }, { t: 4, signals: ["MEM_READ"] }, { t: 5, signals: ["MDR_OUT", "REG_LOAD_D", "T_RESET"] }],
          doc: "Rd ← mem[Rs] (page 0 when N > 8)",
        }
      : RESERVED(0x4, "indirect load"),
    cfg.indirectLoadStore
      ? {
          code: 0x5,
          mnem: "STR",
          operands: ["Rd", "Rs"],
          steps: [{ t: 3, signals: ["REG_OUT_S", "MAR_LOAD"] }, { t: 4, signals: ["REG_OUT_D", "MDR_LOAD"] }, { t: 5, signals: ["MEM_WRITE", "T_RESET"] }],
          doc: "mem[Rs] ← Rd (page 0 when N > 8)",
        }
      : RESERVED(0x5, "indirect store"),
    { code: 0x6, mnem: "MOV", operands: ["Rd", "Rs"], steps: [{ t: 3, signals: ["REG_OUT_S", "REG_LOAD_D", "T_RESET"] }], doc: "Rd ← Rs (MOV R0,R0 is the NOP)" },
    { code: 0x7, mnem: "ADD", operands: ["Rd", "Rs"], alu: { sel: 0, sub: false }, steps: ALU3(), doc: "Rd ← Rd + Rs (Z C N)" },
    { code: 0x8, mnem: "SUB", operands: ["Rd", "Rs"], alu: { sel: 0, sub: true }, steps: ALU3(), doc: "Rd ← Rd − Rs (Z C N)" },
    { code: 0x9, mnem: "AND", operands: ["Rd", "Rs"], alu: { sel: 1, sub: false }, steps: ALU3(), doc: "Rd ← Rd AND Rs" },
    { code: 0xa, mnem: "OR", operands: ["Rd", "Rs"], alu: { sel: 2, sub: false }, steps: ALU3(), doc: "Rd ← Rd OR Rs" },
    { code: 0xb, mnem: "XOR", operands: ["Rd", "Rs"], alu: { sel: 3, sub: false }, steps: ALU3(), doc: "Rd ← Rd XOR Rs" },
    { code: 0xc, mnem: "NOT", operands: ["Rd"], alu: { sel: 4, sub: false }, steps: ALU3(["Y_LOAD", "FLAGS_LOAD"]), doc: "Rd ← NOT Rd" },
    {
      code: 0xd,
      mnem: "J",
      operands: ["cc", "addr"],
      steps: [...OPERAND, { t: 5, signals: ["T_RESET"], when: { flag: "COND", signals: ["MDR_OUT", "PC_LOAD"] } }],
      doc: "if cc: PC ← a. cc = IR[3:2]: 00 always (JMP), 01 Z (JZ), 10 C (JC), 11 N (JN)",
    },
    cfg.callRet
      ? {
          code: 0xe,
          mnem: "CALL",
          operands: ["addr"],
          steps: [
            { t: 3, signals: ["SP_OUT", "MAR_LOAD"] },
            { t: 4, signals: ["PC_OUT", "MDR_LOAD", "SP_DEC"] },
            { t: 5, signals: ["MEM_WRITE", "PC_OUT", "MAR_LOAD"] },
            { t: 6, signals: ["MEM_READ"] },
            { t: 7, signals: ["MDR_OUT", "PC_LOAD", "T_RESET"] },
          ],
          doc: "mem[SP] ← PC (address of the operand byte), SP ← SP − 1, PC ← a",
        }
      : RESERVED(0xe, "CALL"),
    cfg.callRet
      ? {
          code: 0xf,
          mnem: "RET",
          operands: [],
          steps: [
            { t: 3, signals: ["SP_INC"] },
            { t: 4, signals: ["SP_OUT", "MAR_LOAD"] },
            { t: 5, signals: ["MEM_READ"] },
            { t: 6, signals: ["MDR_OUT", "PC_LOAD"] },
            { t: 7, signals: ["PC_INC", "T_RESET"] },
          ],
          doc: "SP ← SP + 1, PC ← mem[SP] + 1 (skips CALL's operand byte)",
        }
      : RESERVED(0xf, "RET"),
  ];
  return {
    name: "v2",
    fetch: FETCH as PlaStep[],
    ops,
    signals: [...SIGNALS, ...(cfg.callRet ? ["SP_OUT", "SP_INC", "SP_DEC"] : [])],
    flags: ["COND"],
    tBits: 3,
  };
}

export const isaFor = (cfg: CpuConfig): Isa => (isaName(cfg) === "v1" ? V1 : v2Isa(cfg));

/** Ticks one instruction takes (fetch included). */
export const ticksOf = (op: PlaOp): number => 1 + Math.max(...op.steps.map((s) => s.t));

/** The microcode of an ISA in the format of src/isa/spec.ts (one line per T-state). */
export function formatMicrocode(isa: Isa): string {
  const step = (s: PlaStep) =>
    `T${s.t}: ${s.signals.join(" ") || "-"}${s.when ? `  if ${s.when.flag}: ${s.when.signals.join(" ")}` : ""}`;
  const lines = [`FETCH  ${isa.fetch.map(step).join(" | ")}`];
  for (const o of isa.ops)
    lines.push(`0x${o.code.toString(16).toUpperCase()} ${o.mnem.padEnd(4)} ${o.steps.map(step).join(" | ")}  (${ticksOf(o)} ticks)`);
  return lines.join("\n");
}

// =====================================================================================
// The control PLA: src/cpu/control.ts, generalized over the table (same algorithm, same names)
// =====================================================================================

const OP_BITS = 4;
const N_OPS = 1 << OP_BITS;
const ALU_SEL_BITS = 3;

/** Literal = an opcode line, or an opcode line ANDed with a flag: code·4 + (0 | 1 + flag index). */
type Lit = number;

function definePla(lib: Library, isa: Isa): void {
  if (isa.flags.length > 3) throw new Error("PLA: at most 3 flag inputs");
  const N_T = 1 << isa.tBits;
  const FL = isa.flags;
  const lit = (code: number, flag?: string): Lit => code * 4 + (flag ? FL.indexOf(flag) + 1 : 0);
  const litCode = (l: Lit) => l >> 2;
  const litFlag = (l: Lit): string | undefined => FL[(l & 3) - 1];
  const setKey = (lits: Lit[]) => lits.join(",");
  const isAll = (lits: Lit[]) => lits.length === N_OPS && lits.every((l) => !litFlag(l));

  const ops = [...isa.ops].sort((a, b) => a.code - b.code);
  if (ops.length !== N_OPS || ops.some((o, i) => o.code !== i)) throw new Error(`PLA: the table must define codes 0–${N_OPS - 1} once`);
  const micro = (o: PlaOp) => [...isa.fetch, ...o.steps];

  const label = (lits: Lit[]): string => {
    const name = (l: Lit) => ops[litCode(l)].mnem + (litFlag(l) ? `if${litFlag(l)}` : "");
    const parts: string[] = [];
    for (let i = 0; i < lits.length; ) {
      let j = i;
      if (!litFlag(lits[i])) while (j + 1 < lits.length && !litFlag(lits[j + 1]) && litCode(lits[j + 1]) === litCode(lits[j]) + 1) j++;
      if (j - i >= 2) parts.push(`${name(lits[i])}to${name(lits[j])}`);
      else for (let k = i; k <= j; k++) parts.push(name(lits[k]));
      i = j + 1;
    }
    return parts.join("_");
  };

  // signal → per T-state sorted literal sets
  const on = new Map<string, Set<Lit>[]>(isa.signals.map((s) => [s, Array.from({ length: N_T }, () => new Set<Lit>())]));
  for (const o of ops)
    for (const st of micro(o)) {
      if (st.t < 0 || st.t >= N_T) throw new Error(`PLA: ${o.mnem} uses T${st.t}; the counter has ${N_T} states`);
      for (const s of st.signals) {
        if (!on.has(s)) throw new Error(`PLA: ${o.mnem} uses unknown signal ${s}`);
        on.get(s)![st.t].add(lit(o.code));
      }
      if (st.when) {
        if (!FL.includes(st.when.flag)) throw new Error(`PLA: unknown flag ${st.when.flag}`);
        for (const s of st.when.signals) on.get(s)![st.t].add(lit(o.code, st.when.flag));
      }
    }
  const table = new Map<string, Lit[][]>();
  for (const [s, perT] of on)
    table.set(s, perT.map((set) => [...set].filter((l) => !litFlag(l) || !set.has(lit(litCode(l)))).sort((a, b) => a - b)));

  const gate = (b: ModuleBuilder, type: GateType, inputs: string[], name: string): string => {
    const y = b.wire1(name);
    return b.gate(type, inputs, y, y);
  };
  const orTreeNamed = (b: ModuleBuilder, nets: string[], name: string): string => {
    if (nets.length === 0) return CONST0;
    let level = nets;
    let k = 0;
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2)
        next.push(i + 1 < level.length ? gate(b, "OR", [level[i], level[i + 1]], level.length === 2 ? name : `${name}_${++k}`) : level[i]);
      level = next;
    }
    return level[0];
  };

  class Groups {
    private groups = new Map<string, { lits: Lit[]; net: string }>();
    private flagged = new Map<Lit, string>();
    constructor(
      private b: ModuleBuilder,
      private opLine: string[],
    ) {}
    private literal(l: Lit): string {
      const flag = litFlag(l);
      if (!flag) return this.opLine[litCode(l)];
      let net = this.flagged.get(l);
      if (!net) {
        net = gate(this.b, "AND", [this.opLine[litCode(l)], this.b.in1(flag)], `op_${label([l])}`);
        this.flagged.set(l, net);
      }
      return net;
    }
    private netOf(lits: Lit[]): string {
      return lits.length === 1 ? this.literal(lits[0]) : this.groups.get(setKey(lits))!.net;
    }
    private union(x: Lit[], y: Lit[]): Lit[] {
      const lits = [...x, ...y].sort((a, c) => a - c);
      const key = setKey(lits);
      if (!this.groups.has(key)) this.groups.set(key, { lits, net: gate(this.b, "OR", [this.netOf(x), this.netOf(y)], `ops_${label(lits)}`) });
      return lits;
    }
    private balanced(sets: Lit[][]): Lit[] {
      let level = sets;
      while (level.length > 1) {
        const next: Lit[][] = [];
        for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? this.union(level[i], level[i + 1]) : level[i]);
        level = next;
      }
      return level[0];
    }
    net(lits: Lit[]): string {
      if (lits.length === 0) return CONST0;
      if (isAll(lits)) return CONST1;
      if (lits.length === 1 || this.groups.has(setKey(lits))) return this.netOf(lits);
      const rest = new Set(lits);
      const pieces: Lit[][] = [];
      for (;;) {
        let best: Lit[] | undefined;
        for (const g of this.groups.values()) if (g.lits.length > (best?.length ?? 1) && g.lits.every((l) => rest.has(l))) best = g.lits;
        if (!best) break;
        pieces.push(best);
        for (const l of best) rest.delete(l);
      }
      for (const l of rest) pieces.push([l]);
      pieces.sort((x, y) => x[0] - y[0]);
      const runs: Lit[][][] = [];
      for (const p of pieces) {
        const run = runs[runs.length - 1];
        const prev = run?.[run.length - 1];
        if (prev && litCode(p[0]) === litCode(prev[prev.length - 1]) + 1) run.push(p);
        else runs.push([p]);
      }
      return this.netOf(this.balanced(runs.map((r) => this.balanced(r))));
    }
  }

  if (!lib.has("CTRL_DEC2"))
    define(
      lib,
      "CTRL_DEC2",
      { in: { A: 2 }, out: { Y: 4 } },
      (b) => {
        const a = b.in("A");
        const na = a.map((x, i) => gate(b, "NOT", [x], `nA${i}`));
        b.out("Y").forEach((y, k) => b.gate("AND", [k & 2 ? a[1] : na[1], k & 1 ? a[0] : na[0]], y, `y${k}`));
      },
      "2→4 one-hot predecoder: Y[k] = 1 iff A = k. 2 NOT + 4 AND.",
    );
  if (!lib.has("CTRL_DEC3"))
    define(
      lib,
      "CTRL_DEC3",
      { in: { A: 3 }, out: { Y: 8 } },
      (b) => {
        const a = b.in("A");
        const lo = b.use("CTRL_DEC2", { A: a.slice(0, 2), Y: b.wire("lo", 4) }, "lo").Y;
        const na2 = gate(b, "NOT", [a[2]], "nA2");
        b.out("Y").forEach((y, k) => b.gate("AND", [lo[k & 3], k & 4 ? a[2] : na2], y, `y${k}`));
      },
      "3→8 one-hot decoder (the T-state lines): a CTRL_DEC2 on A[1:0], then Y[k] = lo[k mod 4] · (A[2] or ¬A[2]).",
    );
  if (!lib.has("CTRL_DEC4"))
    define(
      lib,
      "CTRL_DEC4",
      { in: { A: 4 }, out: { Y: 16 } },
      (b) => {
        const a = b.in("A");
        const lo = b.use("CTRL_DEC2", { A: a.slice(0, 2), Y: b.wire("lo", 4) }, "lo").Y;
        const hi = b.use("CTRL_DEC2", { A: a.slice(2, 4), Y: b.wire("hi", 4) }, "hi").Y;
        b.out("Y").forEach((y, k) => b.gate("AND", [lo[k & 3], hi[k >> 2]], y, `y${k}`));
      },
      "4→16 one-hot decoder (the opcode lines): CTRL_DEC2 predecoders on A[1:0] and A[3:2], then Y[k] = lo[k mod 4] · hi[k div 4].",
    );
  const tDec = { 3: "CTRL_DEC3", 4: "CTRL_DEC4" }[isa.tBits];
  if (!tDec) throw new Error(`PLA: tBits ${isa.tBits} not supported`);

  const aluSets = [
    ...Array.from({ length: ALU_SEL_BITS }, (_, bit) => ({
      port: "ALU_SEL",
      bit,
      lits: ops.filter((o) => o.alu && (o.alu.sel >> bit) & 1).map((o) => lit(o.code)),
    })),
    { port: "ALU_SUB", bit: 0, lits: ops.filter((o) => o.alu?.sub).map((o) => lit(o.code)) },
  ];

  define(
    lib,
    "CONTROL",
    {
      in: { OP: OP_BITS, T: isa.tBits, ...Object.fromEntries(FL.map((f) => [f, 1])), HALTED: 1, RESET: 1 },
      out: { ...Object.fromEntries(isa.signals.map((s) => [s, 1])), ALU_SEL: ALU_SEL_BITS, ALU_SUB: 1 },
    },
    (b) => {
      const opLine = ops.map((o) => b.wire1(`op_${o.mnem}`));
      const tLine = Array.from({ length: N_T }, (_, t) => b.wire1(`T${t}`));
      b.use("CTRL_DEC4", { A: b.in("OP"), Y: opLine }, "dec_op");
      b.use(tDec, { A: b.in("T"), Y: tLine }, "dec_t");
      const run = gate(b, "NOR", [b.in1("HALTED"), b.in1("RESET")], "run");

      const groups = new Groups(b, opLine);
      const sets = new Map<string, Lit[]>();
      for (let t = 0; t < N_T; t++) for (const s of isa.signals) sets.set(setKey(table.get(s)![t]), table.get(s)![t]);
      for (const lits of [...sets.values()].sort((x, y) => x.length - y.length)) groups.net(lits);
      const aluNets = aluSets.map((a) => groups.net(a.lits));

      const terms = new Map<string, string>();
      const term = (t: number, lits: Lit[]): string => {
        if (isAll(lits)) return tLine[t];
        const key = `${t}|${setKey(lits)}`;
        let net = terms.get(key);
        if (!net) {
          net = gate(b, "AND", [tLine[t], groups.net(lits)], `term_${label(lits)}_T${t}`);
          terms.set(key, net);
        }
        return net;
      };
      const signalTerms = new Map<string, string[]>(isa.signals.map((s) => [s, []]));
      for (let t = 0; t < N_T; t++)
        for (const s of isa.signals) {
          const lits = table.get(s)![t];
          if (lits.length) signalTerms.get(s)!.push(term(t, lits));
        }
      const sums = new Map<string, string>();
      for (const s of isa.signals) {
        const nets = signalTerms.get(s)!;
        const key = nets.join(",");
        if (!sums.has(key)) sums.set(key, orTreeNamed(b, nets, `or_${s}`));
        b.gate("AND", [run, sums.get(key)!], b.out1(s), `out_${s}`);
      }
      aluSets.forEach((a, i) => {
        const port = b.out(a.port);
        b.gate("AND", [run, aluNets[i]], port[a.bit], `out_${a.port}${port.length > 1 ? a.bit : ""}`);
      });
    },
    `Control unit (${isa.name} table): a sum-of-products PLA generated from the microcode, as in src/cpu/control.ts.`,
  );
}

// =====================================================================================
// Parametrized datapath blocks
// =====================================================================================

const ensure = (lib: Library, name: string, def: () => void) => {
  if (!lib.has(name)) def();
};

/** DEC<N>, RAM<2^N> and PC<N>: the CPU's own builders (src/cells, src/cpu/datapath.ts), which
 * take the address width; N = 2, 3, 4 decoders are the library's DEC2/3/4. */
export function defineDecN(lib: Library, N: number): string {
  return N <= 4 ? `DEC${N}` : defineDecCell(lib, N);
}
export function defineRamN(lib: Library, N: number): string {
  const name = `RAM${1 << N}`;
  return lib.has(name) ? name : defineRam(lib, N);
}
export function definePcN(lib: Library, N: number): string {
  const name = `PC${N}`;
  return lib.has(name) ? name : definePc(lib, N);
}

/** SP<w> — stack pointer: SP ← SP + 1 on INC, SP − 1 on DEC, `init` on RESET. The register
 * holds SP ⊕ init, so the all-zero power-on state already is SP = init (no plugin change). */
export function defineSp(lib: Library, w: number, init: number): string {
  const name = `SP${w}`;
  if (lib.has(name)) return name;
  ensure(lib, `ADDER_W${w}`, () => defineAdder(lib, w));
  ensure(lib, `REG_W${w}`, () => defineReg(lib, w));
  define(
    lib,
    name,
    { in: { INC: 1, DEC: 1, RESET: 1, CLK: 1 }, out: { Q: w } },
    (b) => {
      const [Q, DEC, RESET] = [b.out("Q"), b.in1("DEC"), b.in1("RESET")];
      const raw = b.wire("raw", w);
      raw.forEach((r, i) => ((init >> i) & 1 ? place(b, "NOT", `q${i}`, [r], Q[i]) : place(b, "BUF", `q${i}`, [r], Q[i])));
      const sum = b.wire("sum", w);
      // SP + 1 = SP + 0b0..01; SP − 1 = SP + 0b1..11: B = {1, DEC, DEC, …}.
      b.use(`ADDER_W${w}`, { A: Q, B: [CONST1, ...Array(w - 1).fill(DEC)], CI: CONST0, S: sum }, "add");
      const nrst = place(b, "NOT", "nrst", [RESET]);
      const d = sum.map((s, i) => place(b, "AND", `d${i}`, [(init >> i) & 1 ? place(b, "NOT", `x${i}`, [s]) : s, nrst]));
      const step = place(b, "OR", "step", [b.in1("INC"), DEC]);
      const load = place(b, "OR", "load", [step, RESET]);
      b.use(`REG_W${w}`, { D: d, LOAD: load, CLK: b.in1("CLK"), Q: raw }, "reg");
    },
    `${w}-bit stack pointer: ± 1 on INC / DEC, ${init} on RESET (stored as SP ⊕ ${init})`,
  );
  return name;
}

/** BUSMUX — the bus AND-OR (same names as src/cpu/datapath.ts), PC of `pcBits`, optional SP. */
export function defineBusmuxN(lib: Library, pcBits: number, spBits: number, one = false): string {
  define(
    lib,
    "BUSMUX",
    {
      in: { PC: pcBits, PC_OUT: 1, MDR: 8, MDR_OUT: 1, REG: 8, REG_OUT: 1, Y: 8, Y_OUT: 1, ...(one ? { ONE_OUT: 1 } : {}), ...(spBits ? { SP: spBits, SP_OUT: 1 } : {}) },
      out: { BUS: 8 },
    },
    (b) => {
      const BUS = b.out("BUS");
      const drivers: [string, string[], string][] = [
        ["pc", b.in("PC"), b.in1("PC_OUT")],
        ["mdr", b.in("MDR"), b.in1("MDR_OUT")],
        ["reg", b.in("REG"), b.in1("REG_OUT")],
        ["y", b.in("Y"), b.in1("Y_OUT")],
        ...(spBits ? [["sp", b.in("SP"), b.in1("SP_OUT")] as [string, string[], string]] : []),
      ];
      for (let i = 0; i < 8; i++) {
        const terms = drivers.filter(([, src]) => i < src.length).map(([name, src, en]) => place(b, "AND", `${name}${i}`, [src[i], en]));
        const ab = place(b, "OR", `or_a${i}`, [terms[0], terms[1]]);
        const out = one && i === 0 ? undefined : BUS[i]; // bit 0 also takes ONE_OUT (gate "one")
        let bus: string;
        if (terms.length === 3) bus = place(b, "OR", `bus${i}`, [ab, terms[2]], out);
        else if (terms.length === 4) bus = place(b, "OR", `bus${i}`, [ab, place(b, "OR", `or_b${i}`, [terms[2], terms[3]])], out);
        else {
          const cd = place(b, "OR", `or_b${i}`, [terms[2], terms[3]]);
          const abcd = place(b, "OR", `or_c${i}`, [ab, cd]);
          bus = place(b, "OR", `bus${i}`, [abcd, terms[4]], out);
        }
        if (one && i === 0) place(b, "OR", "one", [bus, b.in1("ONE_OUT")], BUS[0]);
      }
    },
    "The bus: an AND-OR of the drivers (PC low bits, MDR, REG, Y and SP when present)",
  );
  return "BUSMUX";
}

/** REGFILE8 — two banks of four REG_W8: write DEC3(WSEL, WE), read MUX4_W8 ×2 + MUX2_W8. */
export function defineRegfile8(lib: Library): string {
  define(
    lib,
    "REGFILE8",
    { in: { D: 8, WSEL: 3, WE: 1, RSEL: 3, CLK: 1 }, out: { Q: 8, R0: 8, R1: 8, R2: 8, R3: 8, R4: 8, R5: 8, R6: 8, R7: 8 } },
    (b) => {
      const [D, CLK, RSEL] = [b.in("D"), b.in1("CLK"), b.in("RSEL")];
      const load = b.wire("load", 8);
      b.use("DEC3", { A: b.in("WSEL"), EN: b.in1("WE"), Y: load }, "wdec");
      const R = Array.from({ length: 8 }, (_, k) => b.out(`R${k}`));
      R.forEach((Q, k) => b.use("REG_W8", { D, LOAD: load[k], CLK, Q }, `r${k}`));
      const lo = b.use("MUX4_W8", { A: R[0], B: R[1], C: R[2], D: R[3], S: RSEL.slice(0, 2) }, "rmux_lo").Y;
      const hi = b.use("MUX4_W8", { A: R[4], B: R[5], C: R[6], D: R[7], S: RSEL.slice(0, 2) }, "rmux_hi").Y;
      b.use("MUX2_W8", { A: lo, B: hi, S: RSEL[2], Y: b.out("Q") }, "rmux");
    },
    "Register file R0–R7 (bank = WSEL[2] / RSEL[2])",
  );
  return "REGFILE8";
}

// =====================================================================================
// The CPU top level (src/cpu/cpu.ts, parametrized)
// =====================================================================================

function defineTop(lib: Library, cfg: CpuConfig, isa: Isa): void {
  const N = cfg.addrBits;
  const BW = Math.min(N, 8);
  const HB = Math.max(0, N - 8);
  const v2 = isa.name === "v2";
  const sp = spInfo(cfg);
  const io = ioMap(cfg);
  // The CPU as built: its exact OUT decoder. v1 also has LDRI's datapath (ONE_OUT, REG_LOAD_S).
  const base = N === RAM_ADDR_BITS && !cfg.inputPort && cfg.registers === 4 && !v2;
  const ldri = isa.signals.includes("REG_LOAD_S");
  define(
    lib,
    "CPU",
    { in: { CLK: 1, RESET: 1, ...(cfg.inputPort ? { IN: 8 } : {}) }, out: { OUT: 8, SEG_LO: 7, SEG_HI: 7 } },
    (b) => {
      const [CLK, RESET, OUT] = [b.in1("CLK"), b.in1("RESET"), b.out("OUT")];
      const pc = b.wire("pc", N);
      const mar = b.wire("mar", N);
      const ir = b.wire("ir", 8);
      const mdr = b.wire("mdr", 8);
      const a = b.wire("a", 8);
      const y = b.wire("y", 8);
      const [z, c, n] = [b.wire1("flag_z"), b.wire1("flag_c"), b.wire1("flag_n")];
      const t = b.wire("t", 3);
      const halted = b.wire1("halted");
      const r = Array.from({ length: cfg.registers }, (_, k) => b.wire(`r${k}`, 8));
      const bus = b.wire("bus", 8);
      const sig = Object.fromEntries(isa.signals.map((s) => [s, b.wire1(s)])) as Record<string, string>;
      const aluSel = b.wire("alu_sel", 3);
      const aluSub = b.wire1("alu_sub");
      const spQ = cfg.callRet ? b.wire("sp", sp.width) : [];

      // Address paths. N ≤ 8: PC and MAR load from the bus. N > 8: the high bits come from the
      // instruction's page bits IR[1:0] (0 for indirect and stack accesses), or from PC when PC
      // drives the bus (fetch), through a side path, since the bus is 8 bits.
      let pcD = bus.slice(0, BW);
      let marD = bus.slice(0, BW);
      if (HB) {
        const noPage = cfg.callRet ? place(b, "OR", "no_page", [sig.REG_OUT_S, sig.SP_OUT]) : sig.REG_OUT_S;
        const usePage = place(b, "NOT", "use_page", [noPage]);
        const pg = Array.from({ length: HB }, (_, i) => place(b, "AND", `page${i}`, [ir[i], usePage]));
        const hi = b.wire("mar_hi_d", HB);
        for (let i = 0; i < HB; i++) b.use("MUX2", { A: pg[i], B: pc[8 + i], S: sig.PC_OUT, Y: hi[i] }, `mar_page${i}`);
        pcD = [...pcD, ...pg];
        marD = [...marD, ...hi];
      }

      b.use(`PC${N}`, { D: pcD, LOAD: sig.PC_LOAD, INC: sig.PC_INC, RESET, CLK, Q: pc }, "pc");
      b.use(`REG_W${N}`, { D: marD, LOAD: sig.MAR_LOAD, CLK, Q: mar }, "mar");
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
      if (cfg.callRet) b.use(`SP${sp.width}`, { INC: sig.SP_INC, DEC: sig.SP_DEC, RESET, CLK, Q: spQ }, "sp");

      // Control unit. v2: one condition line, cc = IR[3:2] selects always / Z / C / N.
      let flagConn: Record<string, string> = { Z: z, C: c, N: n };
      if (v2) {
        const cond = b.wire1("cond");
        b.use("MUX4_W1", { A: [CONST1], B: [z], C: [c], D: [n], S: ir.slice(2, 4), Y: [cond] }, "ccmux");
        flagConn = { COND: cond };
      }
      b.use("CONTROL", { OP: ir.slice(4, 8), T: t, ...flagConn, HALTED: halted, RESET, ...sig, ALU_SEL: aluSel, ALU_SUB: aluSub }, "ctrl");

      // Register file.
      const rd = ir.slice(2, 4);
      const rs = ir.slice(0, 2);
      const rsel = b.wire("rsel", 2);
      for (let i = 0; i < 2; i++) b.use("MUX2", { A: rd[i], B: rs[i], S: sig.REG_OUT_S, Y: rsel[i] }, `rsel${i}`);
      let [wsel, regWe] = [rd, sig.REG_LOAD_D];
      if (ldri) {
        wsel = b.wire("wsel", 2);
        for (let i = 0; i < 2; i++) b.use("MUX2", { A: rd[i], B: rs[i], S: sig.REG_LOAD_S, Y: wsel[i] }, `wsel${i}`);
        regWe = place(b, "OR", "reg_we", [sig.REG_LOAD_D, sig.REG_LOAD_S]);
      }
      const regQ = b.wire("reg_q", 8);
      const bank = cfg.registers === 8 ? b.wire1("bank") : "";
      if (cfg.registers === 8)
        b.use(
          "REGFILE8",
          { D: bus, WSEL: [...wsel, bank], WE: regWe, RSEL: [...rsel, bank], CLK, Q: regQ, ...Object.fromEntries(r.map((x, k) => [`R${k}`, x])) },
          "regs",
        );
      else
        b.use("REGFILE", { D: bus, WSEL: wsel, WE: regWe, RSEL: rsel, CLK, Q: regQ, R0: r[0], R1: r[1], R2: r[2], R3: r[3] }, "regs");

      // The bus.
      const regOut = place(b, "OR", "reg_out", [sig.REG_OUT_D, sig.REG_OUT_S]);
      b.use(
        "BUSMUX",
        {
          PC: pc.slice(0, BW),
          PC_OUT: sig.PC_OUT,
          MDR: mdr,
          MDR_OUT: sig.MDR_OUT,
          REG: regQ,
          REG_OUT: regOut,
          Y: y,
          Y_OUT: sig.Y_OUT,
          ...(ldri ? { ONE_OUT: sig.ONE_OUT } : {}),
          ...(cfg.callRet ? { SP: spQ, SP_OUT: sig.SP_OUT } : {}),
          BUS: bus,
        },
        "busmux",
      );
      b.use("ALU", { A: a, B: bus, SEL: aluSel, SUB: aluSub, Y: aluY, CO: aluC, Z: aluZ, N: aluN }, "alu");

      // Memory (+ the input port: a read of the IN address takes IN instead of RAM).
      const ramOut = b.wire("ram_out", 8);
      const memOut = cfg.inputPort ? b.wire("mem_out", 8) : ramOut;
      b.use("MUX2_W8", { A: bus, B: memOut, S: sig.MEM_READ, Y: mdrIn }, "mdr_src");
      b.use(`RAM${1 << N}`, { ADDR: mar, DIN: mdr, WE: sig.MEM_WRITE, CLK, DOUT: ramOut }, "ram");
      const marDec = ioDecode(b, mar, io, base);
      if (cfg.inputPort) b.use("MUX2_W8", { A: ramOut, B: b.in("IN"), S: marDec.atIn!, Y: memOut }, "in_src");

      if (cfg.registers === 8) {
        const bankLoad = place(b, "AND", "bank_load", [sig.MEM_WRITE, marDec.atBank!]);
        b.use("DFFE", { D: mdr[0], LOAD: bankLoad, CLK, Q: bank }, "bank_ff");
      }
      // Output port: a store to the OUT address also latches OUT.
      const outLoad = place(b, "AND", "out_load", [sig.MEM_WRITE, marDec.atOut]);
      b.use("REG_W8", { D: mdr, LOAD: outLoad, CLK, Q: OUT }, "outreg");
      if (!v2) {
        // v1's display inverters for the PC marker (src/cpu/cpu.ts).
        const pcN = b.wire("pc_n", N);
        pc.forEach((p, i) => place(b, "NOT", `pc_not${i}`, [p], pcN[i]));
      }
      b.use("HEX7SEG", { A: OUT.slice(0, 4), SEG: b.out("SEG_LO") }, "seg_lo");
      b.use("HEX7SEG", { A: OUT.slice(4, 8), SEG: b.out("SEG_HI") }, "seg_hi");
    },
    `CPU (${isa.name}): ${1 << N} bytes, ${cfg.registers} registers`,
  );
}

/** Address comparators for the memory-mapped IO bytes at the top of memory. The base CPU keeps
 * its exact gates (a balanced AND of every MAR bit: mar_and<d>_<i>, the root at_out, as in
 * src/cpu/cpu.ts). Otherwise: hi = AND of MAR[2..N-1] (all ones at the top 4 bytes), and each IO
 * byte ANDs hi with its two low bits. */
function ioDecode(b: ModuleBuilder, mar: string[], io: ReturnType<typeof ioMap>, base: boolean): { atOut: string; atIn?: string; atBank?: string } {
  if (base) {
    let level = mar;
    for (let depth = 0; level.length > 1; depth++) {
      const next: string[] = [];
      for (let j = 0; j + 1 < level.length; j += 2)
        next.push(place(b, "AND", level.length <= 2 ? "at_out" : `mar_and${depth}_${j / 2}`, [level[j], level[j + 1]]));
      if (level.length % 2) next.push(level[level.length - 1]);
      level = next;
    }
    return { atOut: level[0] };
  }
  // hi: AND tree over mar[2..]
  let level = mar.slice(2);
  let k = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(i + 1 < level.length ? place(b, "AND", level.length === 2 ? "mar_hi" : `mar_hi_${++k}`, [level[i], level[i + 1]]) : level[i]);
    level = next;
  }
  const hi = level[0];
  const lo = (v: number, name: string) => {
    const l0 = v & 1 ? mar[0] : place(b, "NOT", `n_${name}0`, [mar[0]]);
    const l1 = v & 2 ? mar[1] : place(b, "NOT", `n_${name}1`, [mar[1]]);
    return place(b, "AND", `at_${name}`, [place(b, "AND", `lo_${name}`, [l0, l1]), hi]);
  };
  return {
    atOut: lo(io.out & 3, "out"),
    ...(io.in !== undefined ? { atIn: lo(io.in & 3, "in") } : {}),
    ...(io.bank !== undefined ? { atBank: lo(io.bank & 3, "bank") } : {}),
  };
}

// =====================================================================================
// Building and measuring
// =====================================================================================

/** The module library of a configuration (cells, PLA, datapath, CPU). */
export function buildLibrary(cfg: CpuConfig): Library {
  validate(cfg);
  const N = cfg.addrBits;
  const isa = isaFor(cfg);
  const lib: Library = new Map();
  buildCells(lib);
  definePla(lib, isa);
  defineAlu(lib);
  if (cfg.registers === 8) defineRegfile8(lib);
  else defineRegfile(lib);
  defineRamRow(lib);
  defineRamN(lib, N);
  definePcN(lib, N);
  ensure(lib, `REG_W${N}`, () => defineReg(lib, N));
  defineTstate(lib);
  defineHaltFf(lib);
  const sp = spInfo(cfg);
  if (cfg.callRet) defineSp(lib, sp.width, sp.init);
  defineBusmuxN(lib, Math.min(N, 8), cfg.callRet ? sp.width : 0, isa.signals.includes("ONE_OUT"));
  if (isa.name === "v2") ensure(lib, "MUX4_W1", () => defineMux4W(lib, 1));
  defineTop(lib, cfg, isa);
  return lib;
}

export function cpuNetlistFor(cfg: CpuConfig): FlatNetlist {
  return flatten(buildLibrary(cfg), "CPU");
}

/** Gates of one module of the library, flattened on its own. */
export function moduleGates(lib: Library, name: string): number {
  return flatten(lib, name).gates.length;
}

/** Gates of RAM(N), PC(N), MAR(N) and DEC(N), each built and flattened on its own. */
export function measureParts(N: number): { ram: number; pc: number; mar: number; dec: number } {
  const lib: Library = new Map();
  buildCells(lib);
  defineRamRow(lib);
  const ram = defineRamN(lib, N);
  const pc = definePcN(lib, N);
  ensure(lib, `REG_W${N}`, () => defineReg(lib, N));
  const dec = N <= 4 ? `DEC${N}` : defineDecN(lib, N);
  return { ram: moduleGates(lib, ram), pc: moduleGates(lib, pc), mar: moduleGates(lib, `REG_W${N}`), dec: moduleGates(lib, dec) };
}

/** Gate count per top-level instance (same as gatesByBlock in src/cpu/cpu.ts). */
export function blocks(net: FlatNetlist): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of net.gates) {
    const slash = g.path.indexOf("/");
    const k = slash < 0 ? "(top)" : g.path.slice(0, slash);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ---------- Figma layers ----------

/** Layers (nodes) a gate main component holds besides itself: body + leads + lit (3 vectors),
 * one pin rectangle per port, and one net label per port when labels are on (src/figma/symbols.ts). */
export function gateContent(type: GateType, labels = true): number {
  const ports = GATE_ARITY[type] + 1;
  return 3 + ports + (labels ? ports : 0);
}

export interface LayerCount {
  /** Every node on the silicon pages (page nodes excluded): main components and everything in them. */
  total: number;
  /** Nodes inside each main component (component node itself included). */
  perComponent: Record<string, number>;
}

/** Counts the layers `drawLibrary(lib)` creates, from the plugin's own layout (src/figma/layout.ts):
 * a module component holds a title and a subtitle (TEXT), a `wires` frame with two vectors per
 * routed wire (`wire/<net>` + its hidden `lit` copy) when it has wires, a port marker per port
 * (frame + stub vector + name + net TEXT), and one INSTANCE per child, which in Figma carries a
 * full copy of the child's layers. Gate components: see gateContent. */
export function countLayers(lib: Library, opts: { gateLabels?: boolean } = {}): LayerCount {
  const labels = opts.gateLabels !== false;
  const content = new Map<string, number>();
  const geoms = new Map<string, CellGeom>();
  const perComponent: Record<string, number> = {};
  const used = new Set<GateType>();
  const geomOf = (cell: string): CellGeom => (isGateCell(cell) ? gateGeom(gateTypeOf(cell)) : geoms.get(cell)!);
  const contentOf = (cell: string): number => (isGateCell(cell) ? gateContent(gateTypeOf(cell), labels) : content.get(cell)!);
  for (const name of dependencyOrder(lib)) {
    const def = lib.get(name)!;
    for (const i of def.instances) if (isGateCell(i.cell)) used.add(gateTypeOf(i.cell));
    const L = layoutModule(def, geomOf, { titleWidth: textWidth(def.name, 12) + 40 });
    geoms.set(name, L.geom);
    let own = 2 + 4 * L.ports.length + (L.wires.length ? 1 + 2 * L.wires.length : 0);
    for (const i of def.instances) own += 1 + contentOf(i.cell);
    content.set(name, own);
    perComponent[`cell/${name}`] = own + 1;
  }
  // drawGates draws all eight gate types.
  let total = 0;
  for (const t of Object.keys(GATE_ARITY) as GateType[]) total += 1 + gateContent(t, labels);
  for (const v of Object.values(perComponent)) total += v;
  return { total, perComponent };
}

// ---------- the estimate ----------

export interface PlanCost {
  /** Actions executed per tick (worst case, conditionals included). */
  actionsPerTick: number;
  /** Events (Step hops) per tick when chunked to `cap` actions per event; 1 = unchunked;
   * null = the chunk dispatcher cannot fit the tick under the cap at all. */
  eventsPerTick: number | null;
  maxEvent: number | null;
}

export interface CostReport {
  config: CpuConfig;
  isa: "v1" | "v2";
  ramBytes: number;
  /** Usable RAM: bytes minus the memory-mapped IO bytes. */
  freeBytes: number;
  gates: number;
  /** Gates per block (top-level instance). */
  blocks: Record<string, number>;
  /** Figma variables = plan variables (one per non-constant net). */
  variables: number;
  /** Variable collections needed at 4,000 variables per collection (assumption, see apply.ts). */
  collections: number;
  layers: number;
  /** Ungated plan (the plugin's default). */
  plan: PlanCost;
  /** Clock-gated plan (`gate: true`). */
  gated?: PlanCost;
  /** Events a chunked Reset needs (cap 400; tail of 6 actions assumed). */
  resetEvents: number | null;
  /** Ticks per instruction, by mnemonic. */
  ticks: Record<string, number>;
}

export interface EstimateOptions {
  cap?: number;
  gated?: boolean;
  gateLabels?: boolean;
}

export const VARS_PER_COLLECTION = 4000;

/** Builds the configuration, compiles and plans it with the real compile() / plan(), counts layers. */
export function estimate(cfg: CpuConfig, o: EstimateOptions = {}): CostReport {
  const cap = o.cap ?? DEFAULT_MAX_ACTIONS_PER_EVENT;
  const lib = buildLibrary(cfg);
  const net = flatten(lib, "CPU");
  const sched = compile(net, { inputs: cfg.inputPort ? ["IN"] : [] });
  const init = powerOn(net);
  // Chunk counts by the real chunker. Past ~38k actions the dispatcher itself (k + 5 actions per
  // event for k chunks) no longer fits the cap: chunkTick throws, reported as null (unplannable).
  const events = (list: Parameters<typeof chunkTick>[0], tickExtra: number): { n: number | null; max: number | null } => {
    if (!needsChunks(worstActions(list), cap, tickExtra)) return { n: 1, max: worstActions(list) };
    try {
      const ch = chunkTick(list, { maxActionsPerEvent: cap, tickExtra });
      return { n: ch.chunks.length, max: Math.max(...ch.perEvent) };
    } catch {
      return { n: null, max: null };
    }
  };
  const cost = (gate: boolean): { pc: PlanCost; resetEvents: number | null; variables: number } => {
    const p = plan(net, sched, { initial: init, maxActionsPerEvent: Infinity, gate, halt: "halted" });
    const tick = events(p.tick, 4);
    return {
      pc: { actionsPerTick: p.stats.worstCase, eventsPerTick: tick.n, maxEvent: tick.max },
      resetEvents: events(p.reset, 6).n,
      variables: p.variables.length,
    };
  };
  const plain = cost(false);
  const isa = isaFor(cfg);
  return {
    config: cfg,
    isa: isa.name,
    ramBytes: 1 << cfg.addrBits,
    freeBytes: (1 << cfg.addrBits) - ioMap(cfg).ioBytes,
    gates: net.gates.length,
    blocks: blocks(net),
    variables: plain.variables,
    collections: Math.ceil(plain.variables / VARS_PER_COLLECTION),
    layers: countLayers(lib, { gateLabels: o.gateLabels }).total,
    plan: plain.pc,
    ...(o.gated ? { gated: cost(true).pc } : {}),
    resetEvents: plain.resetEvents,
    ticks: Object.fromEntries(isa.ops.map((op) => [op.mnem, ticksOf(op)])),
  };
}

/** One row per addrBits for a feature set. */
export function sweep(features: Omit<CpuConfig, "addrBits">, bits: number[], o: EstimateOptions = {}): CostReport[] {
  return bits.map((addrBits) => estimate({ ...features, addrBits }, o));
}

// =====================================================================================
// CLI (tools/cost-model.mjs bundles this file and calls main)
// =====================================================================================

/** Seconds per tick in Present mode at `hopsPerSecond` (Eric's spike v1: ~0.9 hops/s). */
export const secondsPerTick = (events: number, hopsPerSecond = 0.9) => events / hopsPerSecond;

const NA = "over cap";

function row(r: CostReport): string {
  const ev = r.plan.eventsPerTick;
  const g = r.gated ? ` | ${r.gated.actionsPerTick} | ${r.gated.eventsPerTick ?? NA}` : "";
  return `| ${r.ramBytes} | ${r.isa} | ${r.gates} | ${r.blocks.ram ?? 0} | ${r.variables} | ${r.layers} | ${r.plan.actionsPerTick} | ${ev ?? NA} | ${
    ev === null ? NA : secondsPerTick(ev).toFixed(1)
  } | ${r.resetEvents ?? NA}${g} |`;
}

export function table(rows: CostReport[]): string {
  const gated = rows.some((r) => r.gated);
  return [
    `| RAM bytes | ISA | gates | RAM gates | variables | layers | actions/tick | events/tick | s/tick @0.9 hops/s | reset events${gated ? " | gated actions | gated events" : ""} |`,
    `|---|---|---|---|---|---|---|---|---|---${gated ? "|---|---" : ""}|`,
    ...rows.map(row),
  ].join("\n");
}

const USAGE = `usage: node tools/cost-model.mjs [--addr N | --sweep 4..9] [--regs 4|8] [--indirect] [--call] [--in] [--v2] [--gated] [--no-labels] [--cap 400] [--json] [--microcode]
  --v2         all v2 features (indirect, call, in)
  --sweep A..B one row per addrBits
  --microcode  print the ISA microcode of the configuration`;

export function main(argv: string[]): number {
  const has = (f: string) => argv.includes(f);
  const val = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (has("--help") || has("-h")) {
    console.log(USAGE);
    return 0;
  }
  const all = has("--v2");
  const features: Omit<CpuConfig, "addrBits"> = {
    registers: val("--regs") === "8" ? 8 : 4,
    indirectLoadStore: all || has("--indirect"),
    callRet: all || has("--call"),
    inputPort: all || has("--in"),
  };
  let bits: number[];
  const sw = val("--sweep");
  if (sw) {
    const m = /^(\d+)\.\.(\d+)$/.exec(sw);
    if (!m) throw new Error(`--sweep ${sw}: expected A..B`);
    bits = [];
    for (let k = +m[1]; k <= +m[2]; k++) bits.push(k);
  } else bits = [Number(val("--addr") ?? 4)];
  const o: EstimateOptions = { gated: has("--gated"), gateLabels: !has("--no-labels"), cap: val("--cap") ? Number(val("--cap")) : undefined };
  if (has("--microcode")) {
    console.log(formatMicrocode(isaFor({ ...features, addrBits: bits[0] })));
    return 0;
  }
  const rows = sweep(features, bits, o);
  if (has("--json")) console.log(JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2));
  else console.log(table(rows));
  return 0;
}
