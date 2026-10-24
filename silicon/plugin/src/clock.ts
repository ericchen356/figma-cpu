// The plugin clock: a fallback runtime for when Figma's prototype engine is too slow. It reads
// the circuit's current state from the variables, runs the compiled schedule on FastSim (the
// JS twin of the prototype: same gate order, same in-place updates) and writes back only the
// variables that changed, once per frame, so the bound gate and wire highlights light up live
// in the editor. It still runs the circuit extracted from the canvas.
import { FastSim } from "../../src/compile";
import type { Schedule } from "../../src/compile/types";
import { readProbes } from "../../src/cpu/probes";
import type { FlatNetlist } from "../../src/netlist/types";
import type { ClockStatus } from "./messages";

/** A variable and the mode its value lives in (the collection's default mode). */
export interface VarRef {
  v: Variable;
  mode: string;
}

export interface ClockSession {
  net: FlatNetlist;
  schedule: Schedule;
  /** Power-on state: the value of every net that has no variable (the constants). */
  base: Uint8Array;
  /** Net id → its variable. */
  vars: Map<number, VarRef>;
  /** Tick counters shown in the frames (FLOAT, or STRING for a text binding). */
  ticks: VarRef[];
  /** Net id that is 1 once the CPU executed HLT. */
  halt: number;
}

export interface ClockOptions {
  /** Pause between frames, ms (default 33: ~30 frames per second). */
  frameMs?: number;
  /** Simulation time per frame at max speed, ms (default 40). */
  budgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onError?: (e: unknown) => void;
}

export class PluginClock {
  private sim: FastSim | null = null;
  private s: ClockSession | null = null;
  /** Value of each net as last written to its variable. */
  private shown: Uint8Array | null = null;
  private count = 0;
  private countShown = 0;
  private running = false;
  private loop: Promise<void> | null = null;
  /** Bumped by every run() and invalidate(): a loop from an older run stops at its next frame. */
  private gen = 0;
  private tps = 0;
  private lastWrites = 0;
  private window: Array<[number, number]> = [];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly session: () => Promise<ClockSession>,
    private readonly report: (s: ClockStatus) => void,
    private readonly opts: ClockOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Forget the simulator (the variables were rewritten: new program, recompile). */
  invalidate(): void {
    this.running = false;
    this.gen++;
    this.sim = null;
    this.s = null;
    this.shown = null;
  }

  /** Reads the state from the variables (once; later frames keep the simulator). */
  private async attach(): Promise<FastSim> {
    if (this.sim) return this.sim;
    const s = await this.session();
    const init = s.base.slice();
    for (const [net, r] of s.vars) {
      const val = r.v.valuesByMode[r.mode];
      if (typeof val === "boolean") init[net] = val ? 1 : 0;
    }
    const t = s.ticks.map((r) => Number(r.v.valuesByMode[r.mode])).find((n) => Number.isFinite(n));
    this.count = this.countShown = t ?? 0;
    this.sim = new FastSim(s.net, s.schedule, init);
    this.s = s;
    this.shown = init.slice();
    return this.sim;
  }

  private halted(): boolean {
    return !!this.sim && !!this.s && this.sim.v[this.s.halt] === 1;
  }

  /** Writes the variables whose net changed since the last write. Returns how many. */
  private write(): number {
    const { sim, s, shown } = this;
    if (!sim || !s || !shown) return 0;
    let n = 0;
    for (const [net, r] of s.vars) {
      const b = sim.v[net];
      if (b !== shown[net]) {
        r.v.setValueForMode(r.mode, b === 1);
        shown[net] = b;
        n++;
      }
    }
    if (this.countShown !== this.count) {
      for (const r of s.ticks) {
        if (r.v.resolvedType === "FLOAT") r.v.setValueForMode(r.mode, this.count);
        else if (r.v.resolvedType === "STRING") r.v.setValueForMode(r.mode, String(this.count));
      }
      this.countShown = this.count;
    }
    this.lastWrites = n;
    return n;
  }

  status(): ClockStatus {
    const now = this.now();
    this.window = this.window.filter(([t]) => now - t <= 1000);
    const [t0, c0] = this.window[0] ?? [now, this.count];
    const tps = this.running && now > t0 ? Math.round(((this.count - c0) * 1000) / (now - t0)) : 0;
    return {
      running: this.running,
      ticks: this.count,
      tps,
      halted: this.halted(),
      writes: this.lastWrites,
      probes: this.sim ? readProbes(this.sim) : {},
    };
  }

  /** `n` ticks now, then one write. Pauses a running clock first. */
  async step(n = 1): Promise<ClockStatus> {
    this.pause();
    if (this.loop) await this.loop;
    const sim = await this.attach();
    for (let i = 0; i < n; i++) {
      sim.tick();
      this.count++;
    }
    this.write();
    const st = this.status();
    this.report(st);
    return st;
  }

  /** Starts (or re-speeds) the clock: `tps` ticks per second, 0 = as fast as possible. The
   * promise resolves when the clock stops (Pause, HLT, or an error). */
  run(tps: number): Promise<void> {
    this.tps = tps;
    if (this.running && this.loop) return this.loop;
    this.running = true;
    const gen = ++this.gen;
    const loop: Promise<void> = this.runLoop(gen).finally(() => {
      if (this.gen !== gen) return;
      this.running = false;
      this.loop = null;
    });
    this.loop = loop;
    return loop;
  }

  pause(): void {
    this.running = false;
  }

  /** Resolves when a running loop has stopped. */
  async idle(): Promise<void> {
    if (this.loop) await this.loop;
  }

  private async runLoop(gen: number): Promise<void> {
    const live = () => this.running && this.gen === gen;
    try {
      const sim = await this.attach();
      if (!live()) return;
      if (this.halted()) {
        this.running = false;
        this.report(this.status());
        return;
      }
      const budget = this.opts.budgetMs ?? 40;
      let last = this.now();
      let due = 1; // the first tick happens right away
      this.window = [[last, this.count]];
      while (live()) {
        const t = this.now();
        const start = t;
        if (this.tps > 0) due = Math.min(due + ((t - last) * this.tps) / 1000, Math.max(1, this.tps));
        last = t;
        let ran = 0;
        if (this.tps <= 0) {
          // Max speed: fill the time budget, checking the clock every 16 ticks.
          do {
            for (let k = 0; k < 16 && !this.halted(); k++, ran++) sim.tick();
          } while (!this.halted() && this.now() - start < budget);
        } else {
          const want = Math.floor(due);
          while (ran < want && !this.halted()) {
            sim.tick();
            ran++;
            if ((ran & 15) === 0 && this.now() - start > budget) break;
          }
          due -= ran;
          if (this.halted()) due = 0;
        }
        this.count += ran;
        this.write();
        this.window.push([this.now(), this.count]);
        if (this.halted()) this.running = false;
        this.report(this.status());
        if (live()) await this.sleep(this.opts.frameMs ?? 33);
      }
    } catch (e) {
      if (this.gen !== gen) return; // invalidated while it ran: not an error
      this.running = false;
      this.opts.onError?.(e);
      this.report(this.status());
    }
  }
}
