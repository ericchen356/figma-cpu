// ISA tooling (lane C): the instruction set, its assembler, the T-state reference model and
// the demo programs.
import count from "./programs/count.asm";
import fib from "./programs/fib.asm";
import logic from "./programs/logic.asm";
import mem from "./programs/mem.asm";
import mul from "./programs/mul.asm";
import sub from "./programs/sub.asm";

export * from "./asm";
export * from "./model";
export * from "./spec";

/** Demo programs (assembly source) by name. Each fits in the 16 bytes of RAM. */
export const PROGRAMS: Record<string, string> = { count, mul, fib, sub, logic, mem };
