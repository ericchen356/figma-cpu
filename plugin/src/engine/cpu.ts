// LANE: engine. Pure machine core (no Figma API) so it is unit-testable in Node.
// Behavior comes from a table of OpcodeRow (parsed from the CANVAS at runtime; spec/opcodes.json in tests).
// No ISA constants allowed here besides the micro-op primitives (spec/Stage 1 vocabulary).
import type { OpcodeRow } from "../contracts/spec";
import type { MachineState } from "../contracts/messages";

export interface Cpu {
  mem: Uint8Array; // 64KB
  state: MachineState;
  /** Run one full instruction (FETCH + DECODE + EXEC). Returns the opcode row executed. */
  step(): OpcodeRow | null;
  reset(): void;
  load(bytes: number[], origin: number): void;
}

export function createCpu(_table: OpcodeRow[]): Cpu {
  throw new Error("engine lane: createCpu not implemented");
}
