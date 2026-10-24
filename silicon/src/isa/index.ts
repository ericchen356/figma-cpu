// ISA tooling (lane C): the instruction set, its assembler, the T-state reference model and
// the demo programs.
import count from "./programs/count.asm";
import fib from "./programs/fib.asm";
import logic from "./programs/logic.asm";
import mem from "./programs/mem.asm";
import mul from "./programs/mul.asm";
import sub from "./programs/sub.asm";
import pow2 from "./programs/pow2.asm";
import triangle from "./programs/triangle.asm";
import mod from "./programs/mod.asm";
import blink from "./programs/blink.asm";
import lfsr from "./programs/lfsr.asm";
import echo from "./programs/echo.asm";
import keypad from "./programs/keypad.asm";

export * from "./asm";
export * from "./model";
export * from "./spec";

/** Demo programs (assembly source) by name. Each fits in the 16 bytes of RAM. echo and keypad
 * read the input byte at RAM[14] (plugin clock device layer, plugin/src/devices.ts). */
export const PROGRAMS: Record<string, string> = { count, mul, fib, sub, logic, mem, pow2, triangle, mod, blink, lfsr, echo, keypad };
