// Probes contract (SILICON.md §5): where the architectural state of the gate-level CPU lives,
// as hierarchical net names of the flattened `CPU` (resolvable through FlatNetlist.aliases).
// The keys match IsaModel.probe() (src/isa/model.ts), so a test bench can compare them 1:1.
import { RAM_ADDR_BITS, RAM_BYTES } from "../isa/spec";

export interface Probe {
  /** Net name; bit i of a multi-bit probe is `${name}[i]`. */
  name: string;
  width: number;
}

/** Architectural state → net. BUS is the combinational bus, i.e. after a settled tick it shows
 * what the *next* T-state drives (IsaModel.nextBus()); during the LOW pass it shows the value
 * the current T-state drives (IsaModel's BUS after that tick). */
export const PROBES: Record<string, Probe> = {
  PC: { name: "pc", width: RAM_ADDR_BITS },
  MAR: { name: "mar", width: RAM_ADDR_BITS },
  MDR: { name: "mdr", width: 8 },
  IR: { name: "ir", width: 8 },
  R0: { name: "r0", width: 8 },
  R1: { name: "r1", width: 8 },
  R2: { name: "r2", width: 8 },
  R3: { name: "r3", width: 8 },
  A: { name: "a", width: 8 },
  Y: { name: "y", width: 8 },
  Z: { name: "flag_z", width: 1 },
  C: { name: "flag_c", width: 1 },
  N: { name: "flag_n", width: 1 },
  T: { name: "t", width: 3 },
  HALTED: { name: "halted", width: 1 },
  OUT: { name: "OUT", width: 8 },
  BUS: { name: "bus", width: 8 },
};

/** Hierarchical name of the RAM latch output holding bit `bit` of byte `addr`. */
export function ramBit(addr: number, bit: number): string {
  if (addr < 0 || addr >= RAM_BYTES || bit < 0 || bit > 7) throw new Error(`no RAM bit ${addr}.${bit}`);
  return `ram/row${addr}/b${bit}/Q`;
}

/** What the helpers need from a simulator (RefSim, FastSim). */
export interface SimLike {
  set(port: string, value: number): void;
  settle(): unknown;
  peek(name: string, width?: number): number;
  poke(name: string, value: number, width?: number): void;
}

/** Reads every probe. */
export function readProbes(sim: Pick<SimLike, "peek">): Record<string, number> {
  return Object.fromEntries(Object.entries(PROBES).map(([k, p]) => [k, sim.peek(p.name, p.width)]));
}

/** Reads one RAM byte straight from the latches. */
export function readRam(sim: Pick<SimLike, "peek">, addr: number): number {
  let v = 0;
  for (let bit = 0; bit < 8; bit++) v |= sim.peek(ramBit(addr, bit)) << bit;
  return v;
}

/** Preloads RAM with `bytes` (missing bytes are 0) by forcing the RAM latch outputs. CLK is
 * driven high first (every master latch and every RAM row closed, the state a tick ends in),
 * so the forced values are held; then the circuit settles. Throws if a byte did not stick. */
export function loadProgram(sim: SimLike, bytes: ArrayLike<number>): void {
  if (bytes.length > RAM_BYTES) throw new Error(`program is ${bytes.length} bytes, RAM has ${RAM_BYTES}`);
  sim.set("CLK", 1);
  sim.settle();
  for (let addr = 0; addr < RAM_BYTES; addr++) {
    const v = addr < bytes.length ? bytes[addr] & 0xff : 0;
    for (let bit = 0; bit < 8; bit++) sim.poke(ramBit(addr, bit), (v >> bit) & 1);
  }
  sim.settle();
  for (let addr = 0; addr < RAM_BYTES; addr++) {
    const want = addr < bytes.length ? bytes[addr] & 0xff : 0;
    const got = readRam(sim, addr);
    if (got !== want) throw new Error(`RAM[${addr}] preload: wrote ${want}, reads ${got}`);
  }
}
