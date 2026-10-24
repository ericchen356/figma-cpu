// The synthesized OS run on silicon's simulators: FastSim (the compiled schedule, the JS twin of
// the Figma prototype) or RefSim (iterate until stable, the golden reference). One fire() is one
// editor event: EVT and the input ports are set while CLK is high, then one clock tick.
import {
  compile,
  FastSim,
  powerOn,
  type CompiledSchedule,
} from "../../../silicon/src/compile";
import { flatten, netId } from "../../../silicon/src/netlist/flatten";
import type { FlatNetlist } from "../../../silicon/src/netlist/types";
import { RefSim } from "../../../silicon/src/sim/reference";
import { typeRange } from "./dag";
import type { RegInfo, Synth } from "./synthesize";

export class GateMachine {
  readonly net: FlatNetlist;
  private sim: FastSim | RefSim;
  /** FastSim's schedule; none on RefSim. */
  private readonly schedule?: CompiledSchedule;
  /** The settled power-on state. */
  private readonly init: Uint8Array;
  private readonly ids = new Map<string, number[]>();

  constructor(
    readonly syn: Synth,
    opts: { reference?: boolean } = {},
  ) {
    this.net = flatten(syn.lib, syn.top);
    this.init = powerOn(this.net, syn.pokes);
    if (!opts.reference) this.schedule = compile(this.net);
    this.sim = this.boot();
    for (const [name, r] of syn.regs)
      this.ids.set(
        name,
        r.nets.map((n) => netId(this.net, n)),
      );
  }

  private boot(): FastSim | RefSim {
    if (this.schedule) return new FastSim(this.net, this.schedule, this.init);
    const ref = new RefSim(this.net);
    ref.v.set(this.init);
    return ref;
  }

  /** Back to power-on, as a new machine starts (without flattening and compiling again). */
  reset(): void {
    this.sim = this.boot();
  }

  /** Fires one event: EVT gets its code and the given input variables their values (the other
   * inputs keep theirs) while CLK is high, then one tick. RefSim settles the new inputs first
   * (SILICON.md §2, setup time): its sweeps run in netlist order, and a master latch must not
   * see a LOAD that is still on its way. FastSim's schedule is in dependency order already. */
  fire(eventId: string, inputs: Record<string, number> = {}): void {
    const code = this.syn.codes.get(eventId);
    if (code === undefined) throw new Error(`no event ${eventId}`);
    for (const [name, value] of Object.entries(inputs)) {
      const { port, bits } = inputPort(this.syn, name, value);
      this.sim.set(port, bits);
    }
    this.sim.set("EVT", code);
    if (this.sim instanceof RefSim) this.sim.settle();
    this.sim.tick();
  }

  /** A state variable's register, decoded: two's complement when signed, a boolean for a bool. */
  read(varName: string): number | boolean {
    const r = this.syn.regs.get(varName);
    const ids = this.ids.get(varName);
    if (!r || !ids) throw new Error(`${varName} is not a state variable`);
    return decodeRegister(r, ids, this.sim.v);
  }
}

/** The OS input port of an input variable and the unsigned number its bits hold for `value`,
 * which must fit the variable's width. */
export function inputPort(
  syn: Synth,
  name: string,
  value: number,
): { port: string; bits: number } {
  const p = syn.inputs.get(name);
  if (!p) throw new Error(`${name} is not an input variable`);
  const [lo, hi] = typeRange(p.bits, p.signed);
  if (!Number.isInteger(value) || value < lo || value > hi)
    throw new Error(`${name} = ${value} does not fit ${p.bits} bits`);
  return { port: p.port, bits: value < 0 ? value + 2 ** p.bits : value };
}

/** A register's value from the net values `v`: two's complement when signed, a boolean for a bool. */
export function decodeRegister(
  r: RegInfo,
  ids: readonly number[],
  v: ArrayLike<number>,
): number | boolean {
  let u = 0;
  ids.forEach((id, i) => (u += v[id] * 2 ** i));
  if (r.bool) return u === 1;
  return r.signed && u >= 2 ** (r.bits - 1) ? u - 2 ** r.bits : u;
}
