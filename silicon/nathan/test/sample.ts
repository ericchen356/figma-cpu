// Shared by the reaction tests and the cost report: snapshots of the machine at random points
// of random editor sessions, each with the spec state that goes with it.
import { compile, FastSim } from "../../src/compile";
import type { FlatNetlist } from "../../src/netlist/types";
import { HOT, nathanPowerOn, SCREEN_NETS, STATE_NETS, LAYERS, TOOL_BITS } from "../src/hw";
import { applyRef, engineInputs, type Ev, type Probe, prng, randomEvent } from "../src/model/oracle";
import * as R from "../src/model/reference";
import { INPUTS } from "./driver";

export interface Snapshot {
  spec: R.State;
  v: Uint8Array;
}

/** Every `every`-th state of `episodes` random sessions (half of them start with a full stack). */
export function snapshots(net: FlatNetlist, seed: number, episodes: number, len: number, every = 3): Snapshot[] {
  const schedule = compile(net, { inputs: INPUTS });
  const rnd = prng(seed);
  const out: Snapshot[] = [];
  for (let ep = 0; ep < episodes; ep++) {
    const sim = new FastSim(net, schedule, nathanPowerOn(net));
    let spec = R.initialState();
    const warm: Ev[] = [];
    if (ep % 2 === 0)
      for (let k = 0; k < R.MAX_LAYERS; k++) warm.push({ k: "tool", t: 1 + rnd(3) }, { k: "click", x: rnd(R.GRID_W), y: rnd(R.GRID_H) }, { k: "click", x: rnd(R.GRID_W), y: rnd(R.GRID_H) });
    for (let i = 0; i < len + warm.length; i++) {
      const ev = i < warm.length ? warm[i] : randomEvent(rnd, spec);
      spec = applyRef(spec, ev);
      const inp = engineInputs(ev);
      sim.set("PX", inp.px);
      sim.set("PY", inp.py);
      sim.set("EVT", inp.evt);
      sim.set("ARG", inp.arg);
      sim.tick();
      if (i % every === 0) out.push({ spec, v: sim.v.slice() });
    }
  }
  return out;
}

/** The nets whose value the editor (and the screen) depends on: the registers and the screen lines. */
export function observedNets(net: FlatNetlist): number[] {
  const ids: number[] = [];
  const bus = (name: string, w: number) => {
    for (let i = 0; i < w; i++) ids.push(net.aliases.get(w === 1 ? name : `${name}[${i}]`)!);
  };
  for (let k = 0; k < LAYERS; k++) {
    bus(STATE_NETS.used(k), 1);
    bus(STATE_NETS.vis(k), 1);
    bus(STATE_NETS.kind(k), 2);
    for (const f of [STATE_NETS.x0, STATE_NETS.x1, STATE_NETS.y0, STATE_NETS.y1, STATE_NETS.fill]) bus(f(k), 4);
  }
  bus(STATE_NETS.sel, 3);
  bus(STATE_NETS.hassel, 1);
  bus(STATE_NETS.tool, TOOL_BITS);
  bus(STATE_NETS.cur, 4);
  bus(STATE_NETS.drag, 2);
  bus(STATE_NETS.r1, 4);
  bus(STATE_NETS.r2, 4);
  bus(STATE_NETS.pendown, 1);
  bus(STATE_NETS.erase, 1);
  bus(STATE_NETS.pix, R.GRID_W * R.GRID_H);
  bus(SCREEN_NETS.nsel, 3);
  bus(SCREEN_NETS.nkind, 16);
  bus(SCREEN_NETS.nfill, 32);
  bus(SCREEN_NETS.ncur, 4);
  bus(SCREEN_NETS.ell, 8);
  bus(SCREEN_NETS.nell, 8);
  bus(SCREEN_NETS.hot, HOT.length);
  return ids;
}

/** A Probe over a map of net values (net id → boolean), resolving names through the netlist. */
export function mapProbe(net: FlatNetlist, values: Map<number, boolean>): Probe {
  return {
    peek(name, width = 1) {
      let v = 0;
      for (let i = 0; i < width; i++) {
        const id = net.aliases.get(width === 1 ? name : `${name}[${i}]`);
        if (id === undefined) throw new Error(`no net ${name}[${i}]`);
        if (values.get(id)) v |= 1 << i;
      }
      return v;
    },
  };
}
