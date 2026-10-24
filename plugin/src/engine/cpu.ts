// LANE: engine. Pure machine core (no Figma API) so it is unit-testable in Node.
// Behavior comes ONLY from the table rows parsed off the canvas (TableRow.ops). The only things written in code are
// the micro-op primitives (Stage 1 vocabulary) and the 8-bit ALU/flag arithmetic. No opcode or mnemonic appears here.
import type { TableRow } from "./table";
import type { RegArg } from "./microops";
import type { MachineState } from "../contracts/messages";
import { REGS, type Reg } from "../contracts/nodes";

export interface Bus {
  /** memory-mapped IO: return undefined / false when the address is not IO and plain RAM should be used */
  read?(addr: number): number | undefined;
  write?(addr: number, v: number): boolean;
}

/** Everything a Watch-mode renderer needs to animate one instruction. */
export interface StepInfo {
  row: TableRow | null; // null = fault (unknown opcode)
  pcBefore: number;
  ir: number;
  regsWritten: Reg[];
  memReads: number[];
  memWrites: number[];
  alu?: { op: string; in1: number; in2: number; out: number };
  addrBus: number; // last address driven (fetch address if nothing else)
  dataBus: number;
  fault?: string;
}

export interface Cpu {
  mem: Uint8Array; // 64KB
  state: MachineState;
  /** Run one full instruction (FETCH + DECODE + EXEC). No-op when halted. */
  step(): StepInfo | null;
  reset(): void;
  load(bytes: number[], origin: number): void;
  /** Replace the decoder at runtime (the canvas table was edited). */
  setTable(table: TableRow[]): void;
}

const REG_INDEX: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, H: 4, L: 5 };

export function createCpu(table: TableRow[], bus: Bus = {}): Cpu {
  const mem = new Uint8Array(0x10000);
  let byOp = new Map(table.map((r) => [parseInt(r.op, 16), r] as const));
  const R = new Uint8Array(6);
  const state: MachineState = {
    regs: { A: 0, B: 0, C: 0, D: 0, H: 0, L: 0 },
    pc: 0, sp: 0x7f00, ir: 0,
    flags: { Z: false, C: false, N: false },
    cycles: 0, halted: false,
  };
  let rd = 0, rs = 0, T = 0, W = 0;
  let info: StepInfo;

  const rdMem = (a: number) => {
    a &= 0xffff;
    info.memReads.push(a);
    info.addrBus = a;
    const v = bus.read?.(a) ?? mem[a];
    info.dataBus = v;
    return v;
  };
  const wrMem = (a: number, v: number) => {
    a &= 0xffff; v &= 255;
    info.memWrites.push(a);
    info.addrBus = a; info.dataBus = v;
    if (!bus.write?.(a, v)) mem[a] = v;
  };
  const fetch8 = () => { const v = rdMem(state.pc); state.pc = (state.pc + 1) & 0xffff; return v; };
  const hl = () => (R[4] << 8) | R[5];
  const ri = (r: RegArg) => (r === "rd" ? rd : r === "rs" ? rs : REG_INDEX[r]);
  const setReg = (i: number, v: number) => { R[i] = v & 255; info.regsWritten.push(REGS[i]); };
  const flagsFrom = (v: number) => { state.flags.Z = (v & 255) === 0; state.flags.N = (v & 128) !== 0; };
  const push8 = (v: number) => { state.sp = (state.sp - 1) & 0xffff; wrMem(state.sp, v); };
  const pop8 = () => { const v = rdMem(state.sp); state.sp = (state.sp + 1) & 0xffff; return v; };

  function sync() {
    REGS.forEach((r, i) => (state.regs[r] = R[i]));
  }

  function step(): StepInfo | null {
    if (state.halted) return null;
    info = { row: null, pcBefore: state.pc, ir: 0, regsWritten: [], memReads: [], memWrites: [], addrBus: state.pc, dataBus: 0 };
    const op = fetch8(); // FETCH
    state.ir = op; info.ir = op;
    const row = byOp.get(op); // DECODE
    state.cycles++;
    if (!row) {
      state.halted = true;
      info.fault = `unknown opcode ${op.toString(16).toUpperCase().padStart(2, "0")} at ${info.pcBefore.toString(16).toUpperCase().padStart(4, "0")}`;
      sync();
      return info;
    }
    info.row = row;
    for (const m of row.ops) { // EXEC
      switch (m.k) {
        case "REG": { const b = fetch8(); rd = b >> 4; rs = b & 15; break; }
        case "IMM8": T = fetch8(); break;
        case "IMM16": { const lo = fetch8(); W = lo | (fetch8() << 8); break; }
        case "SET": setReg(ri(m.r), T); break;
        case "COPY": setReg(ri(m.dst), R[ri(m.src)]); break;
        case "LOAD": setReg(ri(m.r), rdMem(m.from === "HL" ? hl() : W)); break;
        case "STORE": wrMem(m.to === "HL" ? hl() : W, R[ri(m.r)]); break;
        case "SETHL": setReg(4, W >> 8); setReg(5, W); break;
        case "INCHL": { const v = (hl() + 1) & 0xffff; setReg(4, v >> 8); setReg(5, v); break; }
        case "ALU": {
          const ia = ri(m.a), x = R[ia], y = m.b ? R[ri(m.b)] : 0;
          let v = 0;
          switch (m.op) {
            case "ADD": v = x + y; state.flags.C = v > 255; break;
            case "SUB": case "CMP": v = x - y; state.flags.C = v < 0; break;
            case "AND": v = x & y; break;
            case "OR": v = x | y; break;
            case "XOR": v = x ^ y; break;
            case "INC": v = x + 1; break;
            case "DEC": v = x - 1; break;
            case "SHL": v = x << 1; state.flags.C = v > 255; break;
            case "SHR": state.flags.C = (x & 1) === 1; v = x >> 1; break;
          }
          flagsFrom(v);
          info.alu = { op: m.op, in1: x, in2: y, out: v & 255 };
          if (m.op !== "CMP") setReg(ia, v);
          break;
        }
        case "JUMP": {
          const c = m.cond, f = state.flags;
          const ok = !c || (c === "Z" ? f.Z : c === "NZ" ? !f.Z : c === "C" ? f.C : c === "NC" ? !f.C : c === "N" ? f.N : !f.N);
          if (ok) state.pc = W;
          break;
        }
        case "PUSH": push8(R[ri(m.r)]); break;
        case "POP": setReg(ri(m.r), pop8()); break;
        case "PUSHPC": push8(state.pc >> 8); push8(state.pc & 255); break;
        case "POPPC": { const lo = pop8(); state.pc = lo | (pop8() << 8); break; }
        case "HALT": state.halted = true; break;
      }
    }
    sync();
    return info;
  }

  return {
    mem, state, step,
    reset() {
      R.fill(0);
      Object.assign(state, { pc: 0, sp: 0x7f00, ir: 0, cycles: 0, halted: false });
      state.flags = { Z: false, C: false, N: false };
      sync();
    },
    load(bytes, origin) { for (let i = 0; i < bytes.length; i++) mem[(origin + i) & 0xffff] = bytes[i]; },
    setTable(t) { byOp = new Map(t.map((r) => [parseInt(r.op, 16), r] as const)); },
  };
}
