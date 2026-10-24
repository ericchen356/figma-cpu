// LANE: engine. Watch/Turbo run loops, independent of Figma (scheduler + clock are injected) so they are testable.
import type { Cpu, StepInfo } from "./cpu";
import type { Mode } from "../contracts/messages";

export interface RunnerDeps {
  cpu: Cpu;
  /** called once per presented frame (TICK register + screen refresh live behind this) */
  onFrame(): void;
  /** called after every instruction in Watch mode, and once after a manual Step */
  onStep(info: StepInfo | null): void;
  /** called when the run stops (halt, fault, pause) */
  onStop?(reason: "halt" | "fault" | "pause"): void;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  now(): number;
}

export const TURBO_SLICE_MS = 25; // wall budget per Turbo frame (~30 fps frames incl. canvas flush)
export const TURBO_CHUNK = 256; // instructions between clock checks
export const FRAME_MS = 33; // the TICK register advances at ~30 Hz of wall time in both modes

export class Runner {
  running = false;
  mode: Mode = "watch";
  private handle: unknown = null;
  private lastFrame = 0;
  instructions = 0;

  constructor(private d: RunnerDeps) {}

  stepOnce(): StepInfo | null {
    const info = this.d.cpu.step();
    if (info) this.instructions++;
    this.d.onStep(info);
    this.d.onFrame();
    return info;
  }

  start(mode: Mode, hz = 3) {
    this.pause(false);
    this.mode = mode;
    this.running = true;
    this.lastFrame = this.d.now();
    if (mode === "watch") {
      const period = 1000 / Math.max(0.5, Math.min(60, hz));
      const tick = () => {
        if (!this.running) return;
        const info = this.d.cpu.step();
        if (info) this.instructions++;
        this.d.onStep(info);
        this.maybeFrame();
        if (!this.finishIfStopped(info)) this.handle = this.d.schedule(tick, period);
      };
      this.handle = this.d.schedule(tick, 0);
    } else {
      const slice = () => {
        if (!this.running) return;
        const t0 = this.d.now();
        let info: StepInfo | null = null;
        do {
          for (let i = 0; i < TURBO_CHUNK; i++) {
            info = this.d.cpu.step();
            if (!info) break;
            this.instructions++;
            if (this.d.cpu.state.halted) break;
          }
        } while (info && !this.d.cpu.state.halted && this.d.now() - t0 < TURBO_SLICE_MS);
        this.d.onStep(null); // state-only frame: one canvas flush per slice
        this.d.onFrame();
        if (!this.finishIfStopped(info)) this.handle = this.d.schedule(slice, 0);
      };
      this.handle = this.d.schedule(slice, 0);
    }
  }

  /** Watch mode: advance TICK on wall time, not per instruction. */
  private maybeFrame() {
    const t = this.d.now();
    if (t - this.lastFrame >= FRAME_MS) { this.lastFrame = t; this.d.onFrame(); }
  }

  private finishIfStopped(info: StepInfo | null): boolean {
    if (!this.d.cpu.state.halted && info) return false;
    this.running = false;
    this.handle = null;
    this.d.onStop?.(info?.fault || (!info && !this.d.cpu.state.halted) ? "fault" : "halt");
    return true;
  }

  pause(notify = true) {
    if (this.handle !== null) this.d.cancel(this.handle);
    this.handle = null;
    if (this.running && notify) this.d.onStop?.("pause");
    this.running = false;
  }
}
