// Behavioral, T-state-accurate model of the handoff CPU: the golden reference the gate-level
// CPU must match tick for tick. It has no instruction semantics of its own. One tick() is one
// clock cycle = one T-state:
//   1. the microcode table (signalsAt) says which control signals are active;
//   2. the single active driver puts its value on the bus (nothing driving → 0);
//   3. every register updates at once from the values *before* the tick (flip-flops).
import { ALU_SEL, BUS_DRIVERS, OPCODES, OUT_ADDR, RAM_BYTES, REGISTERS, type Signal, signalsAt } from "./spec";

/** The probe keys of src/cpu/probes.ts; probe(key) reads the same value from this model. */
export const PROBE_KEYS = [
  "PC", "MAR", "MDR", "IR", "R0", "R1", "R2", "R3", "A", "Y", "Z", "C", "N", "T", "HALTED", "OUT", "BUS",
] as const;
export type ProbeKey = (typeof PROBE_KEYS)[number];

const ADDR_MASK = RAM_BYTES - 1;
/** The T-state counter is 3 bits wide. */
const T_MASK = 7;

export interface AluResult {
  y: number;
  /** Carry out of bit 7 (adder only, else 0). With SUB, 1 means "no borrow". */
  co: number;
  z: number;
  n: number;
}

/** The ALU (§5): SEL 0 = adder (SUB → A + ¬B + 1), 1 = AND, 2 = OR, 3 = XOR, 4 = NOT A. */
export function alu(a: number, b: number, sel: number, sub: boolean): AluResult {
  let y: number;
  let co = 0;
  switch (sel) {
    case ALU_SEL.ADD: {
      const sum = (a & 0xff) + (sub ? ~b & 0xff : b & 0xff) + (sub ? 1 : 0);
      y = sum & 0xff;
      co = sum >> 8;
      break;
    }
    case ALU_SEL.AND:
      y = a & b;
      break;
    case ALU_SEL.OR:
      y = a | b;
      break;
    case ALU_SEL.XOR:
      y = a ^ b;
      break;
    case ALU_SEL.NOT:
      y = ~a;
      break;
    default:
      throw new Error(`unknown ALU_SEL ${sel}`);
  }
  y &= 0xff;
  return { y, co, z: y === 0 ? 1 : 0, n: y >> 7 };
}

export interface IsaState {
  PC: number;
  MAR: number;
  MDR: number;
  IR: number;
  /** R0–R3. */
  R: number[];
  /** ALU input latch. */
  A: number;
  /** ALU result latch. */
  Y: number;
  Z: number;
  C: number;
  N: number;
  T: number;
  HALTED: number;
  OUT: number;
  /** Value on the bus during the last tick (0 if nothing drove it). */
  BUS: number;
  RAM: number[];
}

/** Pairs of signals the datapath cannot honour together (one D input, two sources). */
const EXCLUSIVE: [Signal, Signal][] = [
  ["MDR_LOAD", "MEM_READ"],
  ["PC_LOAD", "PC_INC"],
];

export class IsaModel {
  readonly state: IsaState;
  /** Clock ticks run (reset() is not counted). */
  ticks = 0;
  /** Instructions completed (ticks with T_RESET, HLT included). */
  instructions = 0;
  /** Control signals active during the last tick. */
  lastSignals: ReadonlySet<Signal> = new Set();
  /** Every value latched into OUT, in order (repeats included). */
  readonly outputs: number[] = [];

  /** Power-on state: every register 0, RAM preloaded with `program` (at most RAM_BYTES bytes). */
  constructor(program: ArrayLike<number> = []) {
    if (program.length > RAM_BYTES) throw new Error(`program is ${program.length} bytes, RAM has ${RAM_BYTES}`);
    const ram = new Array<number>(RAM_BYTES).fill(0);
    for (let i = 0; i < program.length; i++) ram[i] = program[i] & 0xff;
    const R = REGISTERS.map(() => 0);
    this.state = { PC: 0, MAR: 0, MDR: 0, IR: 0, R, A: 0, Y: 0, Z: 0, C: 0, N: 0, T: 0, HALTED: 0, OUT: 0, BUS: 0, RAM: ram };
  }

  /** The control unit's outputs for the current state, i.e. what the next tick will do. */
  nextSignals(): Set<Signal> {
    const s = this.state;
    if (s.HALTED) return new Set();
    return signalsAt(s.IR >> 4, s.T, { Z: s.Z === 1, C: s.C === 1, N: s.N === 1 });
  }

  /** The bus value the current state drives (what a combinational bus net reads right now). */
  nextBus(): number {
    return this.drive(this.nextSignals());
  }

  private drive(sig: ReadonlySet<Signal>): number {
    const s = this.state;
    const drivers = BUS_DRIVERS.filter((d) => sig.has(d));
    if (drivers.length > 1) throw new Error(`bus conflict at ${this.where()}: ${drivers.join(" + ")}`);
    switch (drivers[0]) {
      case undefined:
        return 0;
      case "PC_OUT":
        return s.PC & ADDR_MASK; // bus[4:7] = 0
      case "MDR_OUT":
        return s.MDR;
      case "REG_OUT_D":
        return s.R[(s.IR >> 2) & 3];
      case "REG_OUT_S":
        return s.R[s.IR & 3];
      case "Y_OUT":
        return s.Y;
      default:
        throw new Error(`no model for bus driver ${drivers[0]}`);
    }
  }

  private where(): string {
    return `${OPCODES[this.state.IR >> 4].mnem} T${this.state.T}`;
  }

  /** One clock cycle. While HALTED nothing changes (the clock is stopped, T included). */
  tick(): void {
    const s = this.state;
    this.ticks++;
    if (s.HALTED) {
      s.BUS = 0;
      this.lastSignals = new Set();
      return;
    }
    const sig = this.nextSignals();
    const on = (x: Signal) => sig.has(x);
    for (const [a, b] of EXCLUSIVE) if (on(a) && on(b)) throw new Error(`${a} + ${b} at ${this.where()}`);

    // Read phase: everything below uses only these pre-tick values.
    const { PC, MAR, MDR, IR, A, T } = s;
    const op = OPCODES[IR >> 4];
    const rd = (IR >> 2) & 3;
    const ramOut = s.RAM[MAR];
    const bus = this.drive(sig);
    const f = on("Y_LOAD") || on("FLAGS_LOAD") ? alu(A, bus, op.alu?.sel ?? 0, op.alu?.sub ?? false) : null;

    // Write phase: all destinations at once (the rising clock edge).
    if (on("MAR_LOAD")) s.MAR = bus & ADDR_MASK;
    if (on("IR_LOAD")) s.IR = bus;
    if (on("MDR_LOAD")) s.MDR = bus;
    if (on("MEM_READ")) s.MDR = ramOut;
    if (on("MEM_WRITE")) {
      s.RAM[MAR] = MDR;
      if (MAR === OUT_ADDR) {
        s.OUT = MDR;
        this.outputs.push(MDR);
      }
    }
    if (on("REG_LOAD_D")) s.R[rd] = bus;
    if (on("A_LOAD")) s.A = bus;
    if (on("PC_LOAD")) s.PC = bus & ADDR_MASK;
    if (on("PC_INC")) s.PC = (PC + 1) & ADDR_MASK;
    if (f && on("Y_LOAD")) s.Y = f.y;
    if (f && on("FLAGS_LOAD")) {
      s.Z = f.z;
      s.C = f.co;
      s.N = f.n;
    }
    s.T = on("T_RESET") ? 0 : (T + 1) & T_MASK;
    if (on("HALT")) s.HALTED = 1;
    s.BUS = bus;
    this.lastSignals = sig;
    if (on("T_RESET")) this.instructions++;
  }

  /** Synchronous RESET (one clock with RESET = 1): all signals off, T ← 0, PC ← 0, HALTED ← 0; the rest is kept. */
  reset(): void {
    const s = this.state;
    s.T = 0;
    s.PC = 0;
    s.HALTED = 0;
    s.BUS = 0;
    this.lastSignals = new Set();
  }

  /** Runs to the end of the current instruction (until T is back at 0). Returns the ticks taken. */
  step(): number {
    let n = 0;
    while (!this.state.HALTED) {
      this.tick();
      n++;
      if (this.state.T === 0) break;
    }
    return n;
  }

  /** Ticks until HALTED or `maxTicks`. Returns the ticks run. */
  runUntilHalt(maxTicks = 100_000): number {
    let n = 0;
    while (!this.state.HALTED && n < maxTicks) {
      this.tick();
      n++;
    }
    return n;
  }

  /** Reads one probe (flags and HALTED as 0/1). */
  probe(key: ProbeKey): number {
    const r = (REGISTERS as readonly string[]).indexOf(key);
    if (r >= 0) return this.state.R[r];
    if (!(PROBE_KEYS as readonly string[]).includes(key)) throw new Error(`unknown probe ${key}`);
    return this.state[key as Exclude<ProbeKey, (typeof REGISTERS)[number]>];
  }

  /** Every probe at once, e.g. to compare with the gate-level CPU. */
  probes(): Record<ProbeKey, number> {
    return Object.fromEntries(PROBE_KEYS.map((k) => [k, this.probe(k)])) as Record<ProbeKey, number>;
  }
}
