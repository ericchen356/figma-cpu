// Test drivers: a simulated machine you can send editor events to, and read registers from.
import { compile, FastSim } from "../../src/compile";
import type { CompiledSchedule } from "../../src/compile";
import type { FlatNetlist } from "../../src/netlist/types";
import { RefSim } from "../../src/sim/reference";
import { nathanPowerOn } from "../src/hw";
import { engineInputs, type Ev, type Probe } from "../src/model/oracle";

export const INPUTS = ["PX", "PY", "EVT", "ARG"];

/** The golden gate simulator (RefSim) behind a send(event) / peek() interface. */
export class RefDriver implements Probe {
  readonly sim: RefSim;
  constructor(readonly net: FlatNetlist) {
    this.sim = new RefSim(net);
    this.sim.v.set(nathanPowerOn(net));
    this.sim.set("CLK", 1);
    this.sim.settle();
  }
  send(ev: Ev): void {
    const i = engineInputs(ev);
    this.sim.set("PX", i.px);
    this.sim.set("PY", i.py);
    this.sim.set("EVT", i.evt);
    this.sim.set("ARG", i.arg);
    this.sim.settle();
    this.sim.tick();
  }
  peek(name: string, width = 1): number {
    return this.sim.peek(name, width);
  }
}

/** The compiled schedule (FastSim) behind the same interface. */
export class FastDriver implements Probe {
  readonly sim: FastSim;
  constructor(readonly net: FlatNetlist, readonly schedule: CompiledSchedule = compile(net, { inputs: INPUTS })) {
    this.sim = new FastSim(net, schedule, nathanPowerOn(net));
  }
  send(ev: Ev): void {
    const i = engineInputs(ev);
    this.sim.set("PX", i.px);
    this.sim.set("PY", i.py);
    this.sim.set("EVT", i.evt);
    this.sim.set("ARG", i.arg);
    this.sim.tick();
  }
  peek(name: string, width = 1): number {
    return this.sim.peek(name, width);
  }
}
