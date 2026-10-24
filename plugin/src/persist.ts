// Saves the machine state into the Figma document (pluginData on the Machine v2 frame),
// so the file itself holds the computer's state between runs. Memory is stored as
// base64 runs of non-zero bytes, which keeps a typical save to a few KB.
import type { CPU } from "./cpu";

const KEY = "figmacpu-state";

interface Saved {
  v: 1;
  regs: number[];
  pc: number;
  sp: number;
  ir: number;
  flags: [boolean, boolean, boolean];
  cycles: number;
  halted: boolean;
  pin: number;
  segs: [number, string][];
}

function segments(mem: Uint8Array): [number, string][] {
  const out: [number, string][] = [];
  let i = 0;
  while (i < mem.length) {
    if (mem[i] === 0) {
      i++;
      continue;
    }
    let end = i;
    let zeros = 0;
    for (let j = i; j < mem.length && zeros <= 16; j++) {
      if (mem[j] === 0) zeros++;
      else {
        zeros = 0;
        end = j + 1;
      }
    }
    out.push([i, figma.base64Encode(mem.slice(i, end))]);
    i = end;
  }
  return out;
}

export function saveState(node: BaseNode, cpu: CPU, pin: number) {
  const s: Saved = {
    v: 1,
    regs: [...cpu.regs],
    pc: cpu.pc,
    sp: cpu.sp,
    ir: cpu.ir,
    flags: [cpu.Z, cpu.C, cpu.N],
    cycles: cpu.cycles,
    halted: cpu.halted,
    pin,
    segs: segments(cpu.mem),
  };
  node.setPluginData(KEY, JSON.stringify(s));
}

/** Restores into `cpu`; returns the pinned-window base, or null if nothing was saved. */
export function loadState(node: BaseNode, cpu: CPU): number | null {
  const raw = node.getPluginData(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Saved;
    if (s.v !== 1) return null;
    cpu.mem.fill(0);
    for (const [start, b64] of s.segs)
      cpu.mem.set(figma.base64Decode(b64), start);
    cpu.reset();
    cpu.regs.set(s.regs);
    cpu.pc = s.pc;
    cpu.sp = s.sp;
    cpu.ir = s.ir;
    [cpu.Z, cpu.C, cpu.N] = s.flags;
    cpu.cycles = s.cycles;
    cpu.halted = s.halted;
    return s.pin;
  } catch {
    return null;
  }
}
