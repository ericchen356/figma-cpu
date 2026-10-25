// Plugin-clock budget: the simulator is fast; what costs inside Figma is the variable writes per tick.
// This pins the numbers (and prints them) so a change that bloats the writes is noticed.
import { describe, expect, it } from "vitest";
import { compile, FastSim } from "../src/compile";
import { cpuNetlist } from "../src/cpu";
import { assemble, PROGRAMS } from "../src/isa";
import { powerOnWith } from "../plugin/src/program";

describe("plugin clock budget", () => {
  const net = cpuNetlist();
  const sched = compile(net, { inputs: [] });
  const stats = (name: string, ticks: number) => {
    const sim = new FastSim(net, sched, powerOnWith(net, assemble(PROGRAMS[name]).bytes));
    let shown = sim.v.slice();
    let writes = 0, peak = 0;
    const t0 = performance.now();
    for (let t = 0; t < ticks; t++) {
      sim.tick();
      let w = 0;
      for (let i = 0; i < shown.length; i++) if (sim.v[i] !== shown[i]) { shown[i] = sim.v[i]; w++; }
      writes += w;
      peak = Math.max(peak, w);
    }
    const ms = performance.now() - t0;
    return { avg: writes / ticks, peak, tps: Math.round(ticks / (ms / 1000)) };
  };

  for (const name of ["count", "mul", "lfsr", "blink"])
    it(`${name}: simulator speed and writes per tick`, () => {
      const s = stats(name, 3000);
      console.log(`[clock] ${name}: ${s.tps} ticks/s simulated, ${s.avg.toFixed(1)} variable writes per tick on average (peak ${s.peak}) of ${net.netNames.length} nets`);
      expect(s.tps).toBeGreaterThan(1000); // the JS twin is never the bottleneck
      expect(s.avg).toBeLessThan(500); // writing only changed nets is the whole point of the clock
    });
});
