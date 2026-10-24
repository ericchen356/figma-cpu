// Test oracle: a tiny generic interpreter driven by the spec micro strings. NOT the engine - used only to prove
// that assembled programs behave. Independent of src/engine on purpose.
import { OPCODES } from "../../src/contracts/spec";

export interface RunOpts {
  maxSteps?: number;
  /** memory-mapped reads (e.g. TICK/RAND): return undefined to fall through to RAM */
  ioRead?: (addr: number, step: number) => number | undefined;
  ioWrite?: (addr: number, v: number) => boolean;
  /** called after every instruction */
  onStep?: (step: number) => void;
}
export function run(bytes: number[], opts: RunOpts = {}) {
  const maxSteps = opts.maxSteps ?? 5000;
  const mem = new Uint8Array(0x10000);
  bytes.forEach((b, i) => (mem[i] = b));
  const R = [0, 0, 0, 0, 0, 0];
  let pc = 0, sp = 0x7f00, T = 0, W = 0, Z = false, C = false, N = false, halted = false;
  const table = new Map(OPCODES.map((o) => [parseInt(o.op, 16), o]));
  let rd = 0, rs = 0, steps = 0;
  const hl = () => (R[4] << 8) | R[5];
  const ri = (t: string) => (t === "rd" ? rd : t === "rs" ? rs : "ABCDHL".indexOf(t));
  const flags = (v: number) => { Z = (v & 255) === 0; N = (v & 128) !== 0; };
  while (!halted && steps++ < maxSteps) {
    const o = table.get(mem[pc++])!;
    for (const seg of o.micro.split(";").map((s) => s.trim()).filter(Boolean)) {
      const [k, a, b, c] = seg.split(" ");
      switch (k) {
        case "REG": rd = mem[pc] >> 4; rs = mem[pc] & 15; pc++; break;
        case "IMM8": T = mem[pc++]; break;
        case "IMM16": W = mem[pc] | (mem[pc + 1] << 8); pc += 2; break;
        case "SET": R[ri(a)] = T; break;
        case "COPY": R[ri(a)] = R[ri(b)]; break;
        case "LOAD": { const ad = b === "HL" ? hl() : W; R[ri(a)] = opts.ioRead?.(ad, steps) ?? mem[ad]; break; }
        case "STORE": { const ad = b === "HL" ? hl() : W; if (!opts.ioWrite?.(ad, R[ri(a)])) mem[ad] = R[ri(a)]; break; }
        case "SETHL": R[4] = W >> 8; R[5] = W & 255; break;
        case "INCHL": { const v = (hl() + 1) & 0xffff; R[4] = v >> 8; R[5] = v & 255; break; }
        case "ALU": {
          const x = R[ri(b)], y = c ? R[ri(c)] : 0; let v = 0;
          switch (a) {
            case "ADD": v = x + y; C = v > 255; break;
            case "SUB": case "CMP": v = x - y; C = v < 0; break;
            case "AND": v = x & y; break; case "OR": v = x | y; break; case "XOR": v = x ^ y; break;
            case "INC": v = x + 1; break; case "DEC": v = x - 1; break;
            case "SHL": v = x << 1; C = v > 255; break; case "SHR": C = (x & 1) === 1; v = x >> 1; break;
          }
          flags(v); if (a !== "CMP") R[ri(b)] = v & 255; break;
        }
        case "JUMP": {
          const cond = a === "W" ? b : undefined;
          const ok = !cond || (cond === "Z" ? Z : cond === "NZ" ? !Z : cond === "C" ? C : cond === "NC" ? !C : cond === "N" ? N : !N);
          if (ok) pc = W; break;
        }
        case "PUSH": mem[--sp] = R[ri(a)]; break;
        case "POP": R[ri(a)] = mem[sp++]; break;
        case "PUSHPC": mem[--sp] = pc >> 8; mem[--sp] = pc & 255; break;
        case "POPPC": pc = mem[sp++] | (mem[sp++] << 8); break;
        case "HALT": halted = true; break;
      }
    }
    opts.onStep?.(steps);
  }
  return { R, mem, pc, steps, halted };
}

