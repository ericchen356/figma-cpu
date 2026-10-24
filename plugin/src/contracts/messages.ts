// postMessage protocol between plugin main thread (engine) and UI iframe. Frozen: change = ask first.
import type { Reg, Flag } from "./nodes";

export type Mode = "watch" | "turbo";

export interface MachineState {
  regs: Record<Reg, number>;
  pc: number;
  sp: number;
  ir: number;
  flags: Record<Flag, boolean>;
  cycles: number;
  halted: boolean;
}

// UI -> main
export type ToMain =
  | { type: "load"; bytes: number[]; origin: number } // assembler output -> RAM (origin usually 0)
  | { type: "step" }
  | { type: "run"; mode: Mode; hz?: number } // watch: hz 2..5 ; turbo: ignored
  | { type: "pause" }
  | { type: "reset" }
  | { type: "input"; mouseX?: number; mouseY?: number; mouseBtn?: 0 | 1; key?: number }
  | { type: "screen-png"; bytes: Uint8Array } // UI-encoded upscaled PNG for dev/screen
  | { type: "ready" };

// main -> UI
export type ToUi =
  | { type: "state"; state: MachineState }
  | { type: "vram"; bytes: Uint8Array } // 12288 bytes, low nibble = palette index
  | { type: "bind-report"; missing: string[]; found: number }
  | { type: "log"; text: string };
