// The instruction set and microcode of the gate-level CPU (from the team's architecture
// handoff). This table is the single source for: the assembler, the behavioral reference
// model, and the gate-level control unit (a PLA synthesized from these rows).
//
// Machine: 8-bit data, ONE shared 8-bit bus, 16 bytes of RAM (4-bit addresses),
// registers R0–R3, flags Z C N, 3-bit T-state counter (T0–T7).
// Instruction byte: [7:4] opcode · [3:2] Rd · [1:0] Rs. LDI/LD/ST/JMP/Jcc add a 2nd byte.
// LDR and STR address memory through a register (a pointer), so programs can walk arrays.

export const RAM_ADDR_BITS = 4;
export const RAM_BYTES = 1 << RAM_ADDR_BITS;
/** Writing this address also latches the OUT register (shown on the 7-segment display). */
export const OUT_ADDR = RAM_BYTES - 1;
export const REGISTERS = ["R0", "R1", "R2", "R3"] as const;

/** Control signals. Exactly one *_OUT (bus driver) may be active per T-state. */
export const SIGNALS = [
  "PC_OUT", // PC → bus[0:3] (bus[4:7] = 0)
  "MDR_OUT", // MDR → bus
  "REG_OUT_D", // register[IR.Rd] → bus
  "REG_OUT_S", // register[IR.Rs] → bus
  "Y_OUT", // Y latch (ALU result) → bus
  "MAR_LOAD", // MAR ← bus[0:3]
  "IR_LOAD", // IR ← bus
  "MDR_LOAD", // MDR ← bus
  "REG_LOAD_D", // register[IR.Rd] ← bus
  "A_LOAD", // A latch (ALU input 1) ← bus
  "PC_LOAD", // PC ← bus[0:3]
  "PC_INC", // PC ← PC + 1
  "MEM_READ", // MDR ← RAM[MAR]
  "MEM_WRITE", // RAM[MAR] ← MDR (and OUT ← MDR when MAR = OUT_ADDR)
  "Y_LOAD", // Y ← ALU(A latch, bus)
  "FLAGS_LOAD", // Z C N ← ALU flags
  "T_RESET", // next T-state is T0 (end of instruction)
  "HALT", // stop: HALTED flip-flop set, all signals forced off
] as const;
export type Signal = (typeof SIGNALS)[number];

export const BUS_DRIVERS: Signal[] = ["PC_OUT", "MDR_OUT", "REG_OUT_D", "REG_OUT_S", "Y_OUT"];

/** ALU result select (ALU_SEL input of the ALU), driven by the control unit from the opcode. */
export const ALU_SEL = { ADD: 0, SUB: 0, AND: 1, OR: 2, XOR: 3, NOT: 4 } as const;

export type Flag = "Z" | "C" | "N";

export interface MicroStep {
  /** T-state index (T0–T7). */
  t: number;
  /** Signals asserted unconditionally in this T-state. */
  signals: Signal[];
  /** Signals asserted only when the flag is 1 (conditional jumps). */
  when?: { flag: Flag; signals: Signal[] };
}

export type OperandKind = "none" | "imm" | "addr";

export interface OpcodeSpec {
  code: number;
  mnem: string;
  /** Assembly operands, e.g. ["Rd", "imm"]: Rd → bits 3:2, Rs → bits 1:0, imm/addr → 2nd byte.
   * "[Rd]" / "[Rs]" are the same register fields written as a pointer: `LDR R0, [R1]`. */
  operands: ("Rd" | "Rs" | "[Rd]" | "[Rs]" | "imm" | "addr")[];
  /** ALU behaviour (for ALU ops). */
  alu?: { sel: number; sub: boolean };
  /** T3 onward; T0–T2 are FETCH. The last step must contain T_RESET (or HALT). */
  steps: MicroStep[];
  doc: string;
}

/** Fetch: identical for every instruction. */
export const FETCH: MicroStep[] = [
  { t: 0, signals: ["PC_OUT", "MAR_LOAD"] },
  { t: 1, signals: ["MEM_READ", "PC_INC"] },
  { t: 2, signals: ["MDR_OUT", "IR_LOAD"] },
];

/** Read the operand byte at PC into MDR (T3–T4). */
const OPERAND: MicroStep[] = [
  { t: 3, signals: ["PC_OUT", "MAR_LOAD"] },
  { t: 4, signals: ["MEM_READ", "PC_INC"] },
];

const aluOp = (code: number, mnem: keyof typeof ALU_SEL, doc: string): OpcodeSpec => ({
  code,
  mnem,
  operands: ["Rd", "Rs"],
  alu: { sel: ALU_SEL[mnem], sub: mnem === "SUB" },
  steps: [
    { t: 3, signals: ["REG_OUT_D", "A_LOAD"] },
    { t: 4, signals: ["REG_OUT_S", "Y_LOAD", "FLAGS_LOAD"] },
    { t: 5, signals: ["Y_OUT", "REG_LOAD_D", "T_RESET"] },
  ],
  doc,
});

const jump = (code: number, mnem: string, flag: Flag | null, doc: string): OpcodeSpec => ({
  code,
  mnem,
  operands: ["addr"],
  steps: [
    ...OPERAND,
    flag
      ? { t: 5, signals: ["T_RESET"], when: { flag, signals: ["MDR_OUT", "PC_LOAD"] } }
      : { t: 5, signals: ["MDR_OUT", "PC_LOAD", "T_RESET"] },
  ],
  doc,
});

export const OPCODES: OpcodeSpec[] = [
  { code: 0x0, mnem: "NOP", operands: [], steps: [{ t: 3, signals: ["T_RESET"] }], doc: "no operation" },
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
    steps: [
      ...OPERAND,
      { t: 5, signals: ["MDR_OUT", "MAR_LOAD"] },
      { t: 6, signals: ["MEM_READ"] },
      { t: 7, signals: ["MDR_OUT", "REG_LOAD_D", "T_RESET"] },
    ],
    doc: "Rd ← mem[a]",
  },
  {
    code: 0x3,
    mnem: "ST",
    operands: ["Rs", "addr"],
    steps: [
      ...OPERAND,
      { t: 5, signals: ["MDR_OUT", "MAR_LOAD"] },
      { t: 6, signals: ["REG_OUT_S", "MDR_LOAD"] },
      { t: 7, signals: ["MEM_WRITE", "T_RESET"] },
    ],
    doc: "mem[a] ← Rs (a = 15 also shows it on the OUT display)",
  },
  {
    code: 0x4,
    mnem: "MOV",
    operands: ["Rd", "Rs"],
    steps: [{ t: 3, signals: ["REG_OUT_S", "REG_LOAD_D", "T_RESET"] }],
    doc: "Rd ← Rs",
  },
  aluOp(0x5, "ADD", "Rd ← Rd + Rs (Z C N)"),
  aluOp(0x6, "SUB", "Rd ← Rd − Rs (Z C N; C = 1 means no borrow)"),
  aluOp(0x7, "AND", "Rd ← Rd AND Rs (Z N, C = 0)"),
  aluOp(0x8, "OR", "Rd ← Rd OR Rs (Z N, C = 0)"),
  aluOp(0x9, "XOR", "Rd ← Rd XOR Rs (Z N, C = 0)"),
  {
    code: 0xa,
    mnem: "LDR",
    operands: ["Rd", "[Rs]"],
    steps: [
      { t: 3, signals: ["REG_OUT_S", "MAR_LOAD"] },
      { t: 4, signals: ["MEM_READ"] },
      { t: 5, signals: ["MDR_OUT", "REG_LOAD_D", "T_RESET"] },
    ],
    doc: "Rd ← mem[Rs] (load through a pointer; flags unchanged)",
  },
  jump(0xb, "JMP", null, "PC ← a"),
  jump(0xc, "JZ", "Z", "if Z: PC ← a"),
  jump(0xd, "JC", "C", "if C: PC ← a"),
  {
    code: 0xe,
    mnem: "STR",
    operands: ["Rs", "[Rd]"],
    steps: [
      { t: 3, signals: ["REG_OUT_D", "MAR_LOAD"] },
      { t: 4, signals: ["REG_OUT_S", "MDR_LOAD"] },
      { t: 5, signals: ["MEM_WRITE", "T_RESET"] },
    ],
    doc: "mem[Rd] ← Rs (store through a pointer; Rd = 15 also shows it on the OUT display)",
  },
  { code: 0xf, mnem: "HLT", operands: [], steps: [{ t: 3, signals: ["HALT", "T_RESET"] }], doc: "stop the clock" },
];

/** All steps of an opcode including fetch. */
export function microcode(op: OpcodeSpec): MicroStep[] {
  return [...FETCH, ...op.steps];
}

/** Signals active for (opcode, T-state, flags) — the truth table the control PLA implements. */
export function signalsAt(code: number, t: number, flags: Record<Flag, boolean>): Set<Signal> {
  const op = OPCODES[code & 15];
  const step = microcode(op).find((s) => s.t === t);
  const out = new Set<Signal>(step?.signals ?? []);
  if (step?.when && flags[step.when.flag]) for (const s of step.when.signals) out.add(s);
  return out;
}
