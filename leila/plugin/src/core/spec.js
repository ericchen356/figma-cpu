// Machine facts that are not behavior: registers, operand formats, memory map, IO addresses and
// the control-signal list. SPEC is injected by build.mjs. Opcodes and micro-ops are NOT here: they
// are read from the opcode table on the canvas. Written in ES2017 for Figma's plugin sandbox.

const REGISTERS = SPEC.registers;
const FORMATS = Object.keys(SPEC.formats);
const FORMAT_OPERAND_BYTES = { "-": 0, r: 1, "r,r": 1, "r,i8": 2, "r,a16": 3, i16: 2, a16: 2 };
const hexNum = (s) => parseInt(s, 16);
const MEMORY = {
  programStart: hexNum(SPEC.memory.program.start),
  ramStart: hexNum(SPEC.memory.ram.start),
  stackTop: hexNum(SPEC.memory.stackTop),
  vramStart: hexNum(SPEC.memory.vram.start),
  vramEnd: hexNum(SPEC.memory.vram.end),
  width: SPEC.memory.vram.width,
  height: SPEC.memory.vram.height,
};
const IO = {};
for (const k of Object.keys(SPEC.memory.io)) IO[k] = hexNum(SPEC.memory.io[k]);
const SIGNALS = SPEC.signals.signals;
const MAX_TSTATES = SPEC.signals.maxTStates;
const PREDEFINED_SYMBOLS = Object.assign(
  { VRAM: MEMORY.vramStart, RAM: MEMORY.ramStart, STACK: MEMORY.stackTop, SCREEN_W: MEMORY.width, SCREEN_H: MEMORY.height },
  IO,
);

function hex(n, width) {
  return n.toString(16).toUpperCase().padStart(width, "0");
}

class CpuFault extends Error {}
class MicroError extends Error {}
class AsmFail extends Error {}
