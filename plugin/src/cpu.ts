// CPU state + the "physics" the micro-ops call into. step() never decides what an
// instruction does — it fetches, looks the opcode up in the decode table (built from
// the canvas), and runs that row's micro-ops.
import type { DecodeTable } from "./table";

export const IO = {
  MOUSE_X: 0xf000,
  MOUSE_Y: 0xf001,
  MOUSE_BTN: 0xf002,
  KEY: 0xf003,
  TICK: 0xf004,
  RAND: 0xf005,
} as const;
export const IO_START = 0xf000;
export const IO_END = 0xf005;
export const VRAM_START = 0x8000;
export const SCREEN_W = 128;
export const SCREEN_H = 96;
export const VRAM_END = VRAM_START + SCREEN_W * SCREEN_H - 1;
export const STACK_TOP = 0x7f00;

export interface Access {
  /** f = operand fetch at PC, r = data read, w = data write */
  kind: "f" | "r" | "w";
  addr: number;
  value: number;
}

/** What one instruction did — drives the Watch-mode animation. */
export class Trace {
  fetchAddr = 0;
  opcode = 0;
  mnem = "";
  /** Operand and data accesses after the opcode fetch. */
  accesses: Access[] = [];
  regsWritten = new Set<number>();
  alu: { op: string; a: number; b: number | null; out: number } | null = null;
  flagsChanged = false;
  spChanged = false;
}

export class IoState {
  mouseX = 0;
  mouseY = 0;
  mouseBtn = 0;
  key = 0;
  tick = 0;
  lastRand = 0;
  private seed = 0xace1;

  rand(): number {
    // 16-bit xorshift
    let s = this.seed;
    s ^= (s << 7) & 0xffff;
    s ^= s >> 9;
    s ^= (s << 8) & 0xffff;
    this.seed = s & 0xffff || 0xace1;
    this.lastRand = this.seed & 0xff;
    return this.lastRand;
  }
}

class Fault extends Error {}

export class CPU {
  regs = new Uint8Array(6);
  pc = 0;
  sp = STACK_TOP;
  ir = 0;
  Z = false;
  C = false;
  N = false;
  mem = new Uint8Array(0x10000);
  io = new IoState();
  halted = false;
  error: string | null = null;
  cycles = 0;
  /** Bumped on every VRAM write; the screen sync compares versions. */
  vramVersion = 1;
  lastAlu: { op: string; a: number; b: number | null; out: number } | null =
    null;
  trace: Trace | null = null;

  // per-instruction scratch, set by micro-ops
  rd = 0;
  rs = 0;
  T = 0;
  W = 0;

  constructor(public table: DecodeTable) {}

  /** Clears registers and flags; memory (the loaded program) is kept. */
  reset(): void {
    this.regs.fill(0);
    this.pc = 0;
    this.sp = STACK_TOP;
    this.ir = 0;
    this.Z = this.C = this.N = false;
    this.halted = false;
    this.error = null;
    this.cycles = 0;
    this.lastAlu = null;
    this.vramVersion++;
  }

  /** Wipes memory and loads assembled segments, then resets. */
  load(segments: { start: number; bytes: number[] }[]): void {
    this.mem.fill(0);
    for (const s of segments) this.mem.set(s.bytes, s.start);
    this.reset();
  }

  step(trace: Trace | null = null): void {
    if (this.halted) return;
    this.trace = null;
    const at = this.pc;
    this.ir = this.mem[at];
    this.pc = (at + 1) & 0xffff;
    this.trace = trace;
    const entry = this.table.entries[this.ir];
    if (trace) {
      trace.fetchAddr = at;
      trace.opcode = this.ir;
      trace.mnem = entry ? entry.mnem : "???";
    }
    try {
      if (!entry)
        throw new Fault(`illegal opcode ${hex(this.ir, 2)} at ${hex(at, 4)}`);
      for (const fn of entry.micro) {
        fn(this);
        if (this.halted) break;
      }
    } catch (e) {
      this.halted = true;
      this.error =
        e instanceof Fault
          ? e.message
          : `${entry?.mnem ?? "?"} at ${hex(at, 4)}: ${(e as Error).message}`;
    }
    this.cycles++;
    this.trace = null;
  }

  // ---- primitives used by micro-ops ----

  fetchByte(): number {
    const trace = this.trace;
    this.trace = null;
    const v = this.read(this.pc);
    this.trace = trace;
    trace?.accesses.push({ kind: "f", addr: this.pc, value: v });
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  read(addr: number): number {
    addr &= 0xffff;
    const v =
      addr >= IO_START && addr <= IO_END ? this.readIo(addr) : this.mem[addr];
    this.trace?.accesses.push({ kind: "r", addr, value: v });
    return v;
  }

  write(addr: number, value: number): void {
    addr &= 0xffff;
    value &= 0xff;
    this.trace?.accesses.push({ kind: "w", addr, value });
    if (addr >= IO_START && addr <= IO_END) {
      if (addr === IO.KEY) this.io.key = value;
      return;
    }
    this.mem[addr] = value;
    if (addr >= VRAM_START && addr <= VRAM_END) this.vramVersion++;
  }

  private readIo(addr: number): number {
    switch (addr) {
      case IO.MOUSE_X:
        return this.io.mouseX & 0xff;
      case IO.MOUSE_Y:
        return this.io.mouseY & 0xff;
      case IO.MOUSE_BTN:
        return this.io.mouseBtn & 0xff;
      case IO.KEY:
        return this.io.key & 0xff;
      case IO.TICK:
        return this.io.tick & 0xff;
      default:
        return this.io.rand();
    }
  }

  getReg(i: number): number {
    if (i < 0 || i >= this.regs.length)
      throw new Fault(`bad register index ${i} at ${hex(this.pc, 4)}`);
    return this.regs[i];
  }

  setReg(i: number, v: number): void {
    if (i < 0 || i >= this.regs.length)
      throw new Fault(`bad register index ${i} at ${hex(this.pc, 4)}`);
    this.regs[i] = v & 0xff;
    this.trace?.regsWritten.add(i);
  }

  hl(): number {
    return (this.regs[4] << 8) | this.regs[5];
  }

  setHL(v: number): void {
    this.setReg(4, (v >> 8) & 0xff);
    this.setReg(5, v & 0xff);
  }

  push(v: number): void {
    this.sp = (this.sp - 1) & 0xffff;
    this.write(this.sp, v);
    if (this.trace) this.trace.spChanged = true;
  }

  pop(): number {
    const v = this.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    if (this.trace) this.trace.spChanged = true;
    return v;
  }

  jump(addr: number): void {
    this.pc = addr & 0xffff;
  }

  halt(): void {
    this.halted = true;
  }

  test(cond: string): boolean {
    switch (cond) {
      case "Z":
        return this.Z;
      case "NZ":
        return !this.Z;
      case "C":
        return this.C;
      case "NC":
        return !this.C;
      case "N":
        return this.N;
      default:
        return !this.N;
    }
  }

  /** ALU. `bi` is -1 for unary ops. INC/DEC leave C alone; logic ops clear it. */
  alu(op: string, ai: number, bi: number): void {
    const a = this.getReg(ai);
    const b = bi >= 0 ? this.getReg(bi) : null;
    let r: number;
    let carry = this.C;
    switch (op) {
      case "ADD":
        r = a + b!;
        carry = r > 0xff;
        break;
      case "SUB":
      case "CMP":
        r = a - b!;
        carry = a < b!;
        break;
      case "AND":
        r = a & b!;
        carry = false;
        break;
      case "OR":
        r = a | b!;
        carry = false;
        break;
      case "XOR":
        r = a ^ b!;
        carry = false;
        break;
      case "INC":
        r = a + 1;
        break;
      case "DEC":
        r = a - 1;
        break;
      case "SHL":
        carry = (a & 0x80) !== 0;
        r = a << 1;
        break;
      case "SHR":
        carry = (a & 1) !== 0;
        r = a >> 1;
        break;
      default:
        throw new Fault(`unknown ALU op ${op}`);
    }
    r &= 0xff;
    this.Z = r === 0;
    this.N = (r & 0x80) !== 0;
    this.C = carry;
    if (op !== "CMP") this.setReg(ai, r);
    this.lastAlu = { op, a, b, out: r };
    if (this.trace) {
      this.trace.alu = this.lastAlu;
      this.trace.flagsChanged = true;
    }
  }
}

export function hex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, "0");
}
