// FastSim: executes a compiled Schedule with typed arrays. It is the JS twin of the Figma
// prototype (same actions, same in-place updates) and must match RefSim on every tick.
// powerOn() is the settled start state both of them (and the prototype's variables) begin from.
import { busIds, netId, NetlistError } from "../netlist/flatten";
import type { FlatNetlist } from "../netlist/types";
import { OscillationError, RefSim } from "../sim/reference";
import { type CompiledSchedule, compile, evalBit, type GateArrays, gateArrays } from "./schedule";
import type { Schedule } from "./types";

/** Net ids for a poke name: a single net ("ram/w3/b2/Q") or a bus base ("R0" → R0[0..]). */
function pokeIds(net: FlatNetlist, name: string): number[] {
  const id = net.aliases.get(name);
  if (id !== undefined) return [id];
  const ids: number[] = [];
  for (let i = 0; net.aliases.has(`${name}[${i}]`); i++) ids.push(net.aliases.get(`${name}[${i}]`)!);
  if (!ids.length) throw new NetlistError(`no net named ${name}`);
  return ids;
}

/** The settled power-on state: all nets 0 (constants set), `pokes` applied (e.g. RAM preload,
 * by hierarchical net name or bus base name → value, LSB = bit 0), CLK=1, then settled like
 * RefSim. A tick starts from a settled CLK=1 state, which is exactly what this is. */
export function powerOn(net: FlatNetlist, pokes: Record<string, number> = {}): Uint8Array {
  const sim = new RefSim(net);
  for (const [name, value] of Object.entries(pokes)) pokeIds(net, name).forEach((id, i) => (sim.v[id] = (value >> i) & 1));
  const clk = net.aliases.get("CLK");
  if (clk !== undefined) sim.v[clk] = 1;
  sim.settle();
  return sim.v.slice();
}

export class FastSim {
  readonly v: Uint8Array;
  ticks = 0;
  private readonly clk: number;
  private readonly all: GateArrays;
  private readonly ops: [GateArrays, GateArrays];
  /** Nets the schedule lets change between ticks (top inputs it treats as changeable). */
  private readonly free: Uint8Array;
  /** The state may break the schedule's assumptions (poke, or a change of an input the schedule
   * treats as constant): the next pass settles fully, exactly like RefSim. */
  private dirty: boolean;
  /** An input changed since the last LOW pass (the HIGH pass assumes inputs are as in LOW). */
  private moved = false;

  constructor(
    readonly net: FlatNetlist,
    readonly schedule: Schedule = compile(net),
    init: Uint8Array = powerOn(net),
  ) {
    if (init.length !== net.netNames.length) throw new Error(`init has ${init.length} nets, netlist has ${net.netNames.length}`);
    this.v = init.slice();
    this.clk = net.aliases.get("CLK") ?? -1;
    this.all = gateArrays(net);
    const pass = (clk: 0 | 1) => {
      const p = schedule.passes.find((x) => x.clk === clk);
      if (!p) throw new Error(`schedule has no CLK=${clk} pass`);
      return gateArrays(net, p.order);
    };
    this.ops = [pass(0), pass(1)];
    this.free = new Uint8Array(net.netNames.length);
    const inputNets = (schedule as Partial<CompiledSchedule>).inputNets ?? net.ports.filter((p) => p.dir === "in").flatMap((p) => p.nets);
    for (const id of inputNets) this.free[id] = 1;
    if (this.clk >= 0) this.free[this.clk] = 1;
    this.dirty = !this.isSettled();
  }

  private port(name: string) {
    const p = this.net.ports.find((x) => x.name === name);
    if (!p) throw new Error(`no top port ${name}`);
    return p;
  }

  /** Drives a top-level input port (number for buses, LSB = bit 0). Does not settle. */
  set(name: string, value: number): void {
    const p = this.port(name);
    if (p.dir !== "in") throw new Error(`${name} is an output`);
    p.nets.forEach((n, i) => {
      const bit = (value >> i) & 1;
      if (this.v[n] !== bit) {
        if (this.free[n]) this.moved = true;
        else this.dirty = true;
      }
      this.v[n] = bit;
    });
  }

  /** Reads a top-level port as a number. */
  get(name: string): number {
    return this.port(name).nets.reduce((acc, n, i) => acc | (this.v[n] << i), 0);
  }

  /** Reads any net / bus by hierarchical name. */
  peek(name: string, width = 1): number {
    return busIds(this.net, name, width).reduce((acc, n, i) => acc | (this.v[n] << i), 0);
  }

  /** Forces a net value (e.g. preloading RAM latch outputs). The next pass settles fully. */
  poke(name: string, value: number, width = 1): void {
    busIds(this.net, name, width).forEach((n, i) => (this.v[n] = (value >> i) & 1));
    this.dirty = true;
  }

  /** Re-evaluates all gates in netlist order until stable, exactly like RefSim.settle. */
  settle(maxSweeps = 500): number {
    const { t, a, b, y } = this.all;
    const v = this.v;
    for (let sweep = 1; sweep <= maxSweeps; sweep++) {
      let changed = false;
      for (let k = 0; k < t.length; k++) {
        const out = evalBit(t[k], v[a[k]], v[b[k]]);
        if (v[y[k]] !== out) {
          v[y[k]] = out;
          changed = true;
        }
      }
      if (!changed) {
        this.dirty = false;
        return sweep;
      }
    }
    throw new OscillationError(`circuit did not settle in ${maxSweeps} sweeps (oscillating loop?)`);
  }

  /** True if every gate's output agrees with its inputs. */
  isSettled(): boolean {
    const { t, a, b, y } = this.all;
    const v = this.v;
    for (let k = 0; k < t.length; k++) if (v[y[k]] !== evalBit(t[k], v[a[k]], v[b[k]])) return false;
    return true;
  }

  /** One pass: CLK=clk, then that pass's actions (a full settle instead if the state is dirty). */
  pass(clk: 0 | 1): void {
    if (this.clk < 0) netId(this.net, "CLK"); // throws, like RefSim.tick
    this.v[this.clk] = clk;
    if (this.dirty || (clk === 1 && this.moved)) {
      this.settle();
      this.moved = false;
      return;
    }
    if (clk === 0) this.moved = false;
    const { t, a, b, y } = this.ops[clk];
    const v = this.v;
    for (let k = 0, n = t.length; k < n; k++) {
      const p = v[a[k]];
      const q = v[b[k]];
      // Codes as in schedule.ts CODE: BUF NOT AND OR NAND NOR XOR XNOR.
      switch (t[k]) {
        case 0:
          v[y[k]] = p;
          break;
        case 1:
          v[y[k]] = p ^ 1;
          break;
        case 2:
          v[y[k]] = p & q;
          break;
        case 3:
          v[y[k]] = p | q;
          break;
        case 4:
          v[y[k]] = (p & q) ^ 1;
          break;
        case 5:
          v[y[k]] = (p | q) ^ 1;
          break;
        case 6:
          v[y[k]] = p ^ q;
          break;
        default:
          v[y[k]] = p ^ q ^ 1;
      }
    }
  }

  /** One clock cycle: LOW pass, then HIGH pass (rising edge). */
  tick(): void {
    this.pass(0);
    this.pass(1);
    this.ticks++;
  }

  /** `n` ticks. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
  }
}
