// Machine facts that are not behavior: register names, operand formats, memory map,
// palette and the control-signal list. Opcodes and micro-ops are NOT here — they are
// read from the opcode table on the canvas (or spec/opcodes.json in tests).
import { registers, formats } from "../../../spec/opcodes.json";
import memoryMap from "../../../spec/memory-map.json";
import palette from "../../../spec/palette.json";
import signalSpec from "../../../spec/signals.json";

export const REGISTERS: string[] = registers;
export const FORMATS: string[] = Object.keys(formats);

/** Operand bytes that follow the opcode byte, per format. */
export const FORMAT_OPERAND_BYTES: Record<string, number> = {
  "-": 0,
  r: 1,
  "r,r": 1,
  "r,i8": 2,
  "r,a16": 3,
  i16: 2,
  a16: 2,
};

const num = (s: string) => parseInt(s, 16);

export const MEMORY = {
  programStart: num(memoryMap.program.start),
  ramStart: num(memoryMap.ram.start),
  stackTop: num(memoryMap.stackTop),
  vramStart: num(memoryMap.vram.start),
  vramEnd: num(memoryMap.vram.end),
  width: memoryMap.vram.width,
  height: memoryMap.vram.height,
};

export const IO: Record<string, number> = Object.fromEntries(
  Object.entries(memoryMap.io).map(([k, v]) => [k, num(v)]),
);

export const PALETTE_NAME: string = palette.name;
export const PALETTE: [number, number, number][] = palette.colors.map((h) => {
  const n = num(h.slice(1));
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

export interface SignalInfo {
  name: string;
  drives?: string;
  desc: string;
}
export const SIGNALS: SignalInfo[] = signalSpec.signals;
export const MAX_TSTATES: number = signalSpec.maxTStates;

/** Symbols every program can use without defining them. */
export const PREDEFINED_SYMBOLS: Record<string, number> = {
  VRAM: MEMORY.vramStart,
  RAM: MEMORY.ramStart,
  STACK: MEMORY.stackTop,
  SCREEN_W: MEMORY.width,
  SCREEN_H: MEMORY.height,
  ...IO,
};
