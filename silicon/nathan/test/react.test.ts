// Reaction synthesis against the full machine. For every reaction of the OS (tool buttons,
// swatches, layer rows, canvas clicks in each dispatch state, keys), on hundreds of real states:
// run the synthesised action list and compare every register and every screen line with what the
// full two-pass gate-level tick produces, and the registers with the editor spec. Also report
// what each one costs in Figma actions.
import { describe, expect, it } from "vitest";
import { FastSim, compile } from "../../src/compile";
import { runPlanActions } from "../../src/prototype";
import { nathanNetlist, nathanPowerOn } from "../src/hw";
import { applyRef, compare, engineInputs, prng } from "../src/model/oracle";
import * as R from "../src/model/reference";
import { compareScreen } from "../src/model/screen";
import { buildCatalog, reactionSpecs } from "../src/react/catalog";
import { depth, staticSize } from "../src/react/synth";
import { INPUTS } from "./driver";
import { mapProbe, observedNets, snapshots } from "./sample";

const net = nathanNetlist();
const schedule = compile(net, { inputs: INPUTS });
const watch = observedNets(net);
const port = (n: string) => net.ports.find((p) => p.name === n)!.nets;

const pool = snapshots(net, 21, 40, 90, 2);

describe.each([["gates"], ["compact"], ["auto"]] as const)("synthesised reactions, latches: %s", (latch) => {
  const catalog = buildCatalog(net, reactionSpecs(), { latch });

  it("has a reaction for every control, each at most one conditional deep", () => {
    expect(catalog.size).toBe(reactionSpecs().length);
    for (const [name, { reaction }] of catalog) expect(depth(reaction.actions), name).toBeLessThanOrEqual(1);
  });

  it("every reaction gives the same registers and screen as the full gate-level tick, and the spec", () => {
    const rnd = prng(5);
    const sim = new FastSim(net, schedule, nathanPowerOn(net));
    const rows: string[] = [];
    let worst = 0;
    for (const [name, { spec, reaction }] of catalog) {
      const cases = pool.filter((p) => spec.valid(p.spec)).slice(0, 140);
      expect(cases.length, `no sampled state offers ${name}`).toBeGreaterThan(5);
      const executed: number[] = [];
      for (const snap of cases) {
        const ev = spec.event(rnd, snap.spec);
        const inp = engineInputs(ev);
        // the full machine
        sim.v.set(snap.v);
        sim.set("PX", inp.px);
        sim.set("PY", inp.py);
        sim.set("EVT", inp.evt);
        sim.set("ARG", inp.arg);
        sim.tick();
        // the reaction, on the variables as they stood
        const st = new Map<number, boolean>();
        for (let i = 0; i < snap.v.length; i++) st.set(i, snap.v[i] === 1);
        const put = (n: string, val: number) => port(n).forEach((id, i) => st.set(id, ((val >> i) & 1) === 1));
        put("PX", inp.px);
        put("PY", inp.py);
        put("EVT", inp.evt);
        put("ARG", inp.arg);
        executed.push(runPlanActions(reaction.actions, st));
        for (const id of watch) if (st.get(id) !== (sim.v[id] === 1)) throw new Error(`${name} after ${JSON.stringify(ev)}: ${net.netNames[id]} is ${st.get(id)} in the reaction, ${sim.v[id]} in the machine`);
        const after = applyRef(snap.spec, ev);
        const probe = mapProbe(net, st);
        const err = compare(after, probe) ?? compareScreen(after, probe);
        if (err) throw new Error(`${name} after ${JSON.stringify(ev)}: ${err}`);
      }
      const mean = Math.round(executed.reduce((a, b) => a + b, 0) / executed.length);
      const max = Math.max(...executed);
      worst = Math.max(worst, max);
      rows.push(`${name.padEnd(18)} cases ${String(cases.length).padStart(3)}  static ${String(staticSize(reaction.actions)).padStart(5)}  executed mean ${String(mean).padStart(5)}  max ${String(max).padStart(5)}  groups ${reaction.stats.groupsLive}/${reaction.stats.groupsLive + reaction.stats.groupsInert}  screen ${reaction.stats.displayGates}`);
    }
    if (latch !== "gates") console.log(`\nlatches: ${latch}\n` + rows.join("\n"));
    expect(worst).toBeLessThan(latch === "gates" ? 2000 : 1300);
  }, 300_000);
});
