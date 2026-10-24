// Reference ("golden") gate simulator: no cleverness, just re-evaluate every gate until
// nothing changes. Slow but obviously correct, including feedback loops (latches).
// The compiled schedule (src/compile) and the Figma prototype must agree with it.
import { busIds, netId } from "../netlist/flatten";
import { evalGate, type FlatNetlist, NET1 } from "../netlist/types";

export class OscillationError extends Error {}

export class RefSim {
  readonly v: Uint8Array;
  ticks = 0;

  constructor(readonly net: FlatNetlist) {
    this.v = new Uint8Array(net.netNames.length);
    this.v[NET1] = 1;
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
    p.nets.forEach((n, i) => (this.v[n] = (value >> i) & 1));
  }

  /** Reads a top-level port as a number. */
  get(name: string): number {
    return this.port(name).nets.reduce((acc, n, i) => acc | (this.v[n] << i), 0);
  }

  /** Reads any net / bus by hierarchical name. */
  peek(name: string, width = 1): number {
    return busIds(this.net, name, width).reduce((acc, n, i) => acc | (this.v[n] << i), 0);
  }

  /** Forces a net value (e.g. preloading RAM latch outputs). */
  poke(name: string, value: number, width = 1): void {
    busIds(this.net, name, width).forEach((n, i) => (this.v[n] = (value >> i) & 1));
  }

  /** Re-evaluates gates until stable. Returns the number of sweeps. */
  settle(maxSweeps = 500): number {
    const { gates } = this.net;
    for (let sweep = 1; sweep <= maxSweeps; sweep++) {
      let changed = false;
      for (const g of gates) {
        const y = evalGate(g.type, this.v[g.in[0]], g.in.length > 1 ? this.v[g.in[1]] : 0);
        if (this.v[g.out] !== y) {
          this.v[g.out] = y;
          changed = true;
        }
      }
      if (!changed) return sweep;
    }
    throw new OscillationError(`circuit did not settle in ${maxSweeps} sweeps (oscillating loop?)`);
  }

  /** One clock cycle: CLK low, settle; CLK high, settle (rising edge). Requires a top input CLK. */
  tick(): void {
    const clk = netId(this.net, "CLK");
    this.v[clk] = 0;
    this.settle();
    this.v[clk] = 1;
    this.settle();
    this.ticks++;
  }
}
