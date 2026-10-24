// The generic cell library (SILICON.md §4): every cell is built from 2-input gates (plus
// NOT/BUF) or from cells defined before it. Each becomes a `cell/<NAME>` Figma component.
import type { Library } from "../netlist/types";
import { defineAdder, defineFullAdder, defineHalfAdder, defineInc, defineZero } from "./arith";
import { defineDec2, defineDec3, defineDec4 } from "./decode";
import { defineHex7Seg } from "./display";
import { defineDff, defineDffe, defineDLatch, defineReg } from "./latches";
import { defineMux2, defineMux2W, defineMux4W } from "./mux";

export * from "./arith";
export * from "./decode";
export * from "./display";
export * from "./latches";
export * from "./mux";
export { orTree, place } from "./util";

/** Every cell `buildCells` defines, in definition (dependency) order. */
export const CELL_NAMES = [
  "DLATCH",
  "DFF",
  "DFFE",
  "REG_W3",
  "REG_W4",
  "REG_W8",
  "MUX2",
  "MUX2_W4",
  "MUX2_W8",
  "MUX4_W8",
  "HALF_ADDER",
  "FULL_ADDER",
  "ADDER_W8",
  "INC_W3",
  "INC_W4",
  "DEC2",
  "DEC3",
  "DEC4",
  "ZERO_W8",
  "HEX7SEG",
] as const;
export type CellName = (typeof CELL_NAMES)[number];

/** Defines the whole cell library into `lib` (each name must not be defined yet). */
export function buildCells(lib: Library): void {
  defineDLatch(lib);
  defineDff(lib);
  defineDffe(lib);
  for (const w of [3, 4, 8]) defineReg(lib, w);
  defineMux2(lib);
  defineMux2W(lib, 4);
  defineMux2W(lib, 8);
  defineMux4W(lib, 8);
  defineHalfAdder(lib);
  defineFullAdder(lib);
  defineAdder(lib, 8);
  defineInc(lib, 3);
  defineInc(lib, 4);
  defineDec2(lib);
  defineDec3(lib);
  defineDec4(lib);
  defineZero(lib, 8);
  defineHex7Seg(lib);
}
