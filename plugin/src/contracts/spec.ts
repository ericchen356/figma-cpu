// Typed access to spec/*.json (written by Stage 1). The engine gets behavior from the CANVAS table at runtime;
// these are used by the assembler (mnemonic -> opcode), tests, and as the fixture for the canvas table.
import opcodes from "../../../spec/opcodes.json";
import memoryMap from "../../../spec/memory-map.json";
import palette from "../../../spec/palette.json";

export interface OpcodeRow {
  op: string; // hex byte, e.g. "10"
  mnem: string;
  fmt: string; // "-" | "r" | "r,r" | "r,i8" | "r,a16" | "i16" | "a16"
  micro: string; // "REG; IMM8; SET rd T"
}

export const OPCODES: OpcodeRow[] = opcodes.opcodes;
export const MEMORY_MAP = memoryMap;
export const PALETTE: string[] = palette.colors;

export const MEM = {
  size: 0x10000,
  vramStart: 0x8000,
  vramW: 128,
  vramH: 96,
  stackTop: 0x7f00,
  io: { MOUSE_X: 0xf000, MOUSE_Y: 0xf001, MOUSE_BTN: 0xf002, KEY: 0xf003, TICK: 0xf004, RAND: 0xf005 },
} as const;
