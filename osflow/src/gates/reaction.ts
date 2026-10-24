// What one Figma reaction per event executes (docs/GATES.md §4). A prototype needs no clock: the
// reaction of an event can compute the next state directly. Tie EVT to the event's code and fold
// the constants that follow through the flattened netlist, three-valued (0, 1 or "varies"); what
// is left is the cone of gates that feeds the LOAD or D input of a register bit that can still
// load, one SET_VARIABLE per gate in dependency order, then one commit per such bit
// (Q = LOAD ? D : Q). The latches, the event decoder and whatever the code makes constant drop out.
//
// cli/gates.ts prints these costs. ReactionMachine runs the reactions, so the tests can show that
// the cone and the commits alone compute exactly what a whole clock tick of the gates does.
import { powerOn } from "../../../silicon/src/compile";
import { flatten, netId } from "../../../silicon/src/netlist/flatten";
import {
  evalGate,
  NET0,
  NET1,
  type FlatNetlist,
  type GateType,
} from "../../../silicon/src/netlist/types";
import { decodeRegister, inputPort } from "./machine";
import type { Synth } from "./synthesize";

/** A register bit a reaction can write: its output net, and the nets of its LOAD and D. */
export interface Commit {
  q: number;
  load: number;
  d: number;
}

export interface Reaction {
  /** EVT code (≥ 1). */
  code: number;
  /** The events that share the code. */
  ids: string[];
  /** Flat gate indices of the cone, in evaluation order. */
  gates: number[];
  /** Nets the cone and the commits read that are constant under this code, with their values:
   * literals in a Figma expression. */
  folded: [net: number, value: number][];
  /** Every bit of every register whose LOAD is not constant 0 under this code. */
  commits: Commit[];
  /** Actions one reaction executes: one per gate of the cone, one per commit. */
  cost: number;
}

const X = -1;

/** A gate over 0, 1 and X (varies). */
function eval3(type: GateType, a: number, b: number): number {
  switch (type) {
    case "BUF":
      return a;
    case "NOT":
      return a === X ? X : a ^ 1;
    case "AND":
    case "NAND": {
      const v = a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : X;
      return v === X || type === "AND" ? v : v ^ 1;
    }
    case "OR":
    case "NOR": {
      const v = a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : X;
      return v === X || type === "OR" ? v : v ^ 1;
    }
    case "XOR":
    case "XNOR":
      return a === X || b === X ? X : type === "XOR" ? a ^ b : a ^ b ^ 1;
  }
}

/** The reaction of every EVT code, in code order. `net` is the flattened top module. */
export function reactions(
  syn: Synth,
  net: FlatNetlist = flatten(syn.lib, syn.top),
): Reaction[] {
  const { gates, driver } = net;
  const nNets = net.netNames.length;

  // The register cells, and the gates inside them (latches: a reaction replaces them by commits).
  const regInsts = syn.lib
    .get(syn.top)!
    .instances.filter((i) => i.cell.startsWith("REG_W"));
  const regNames = new Set(regInsts.map((i) => i.name));
  const inReg = gates.map((g) => regNames.has(g.path.split("/")[0]));
  const registers = regInsts.map((inst) => {
    const load = netId(net, inst.conn.LOAD[0]);
    return inst.conn.Q.map((q, i): Commit => ({
      q: netId(net, q),
      load,
      d: netId(net, inst.conn.D[i]),
    }));
  });

  // The logic outside the registers in dependency order; it has no loop (SILICON.md §2, rule 1).
  const readers: number[][] = Array.from({ length: nNets }, () => []);
  const waiting = new Int32Array(gates.length);
  const ready: number[] = [];
  gates.forEach((g, i) => {
    if (inReg[i]) return;
    for (const x of new Set(g.in))
      if (driver[x] >= 0 && !inReg[driver[x]]) {
        waiting[i]++;
        readers[x].push(i);
      }
    if (!waiting[i]) ready.push(i);
  });
  const order: number[] = [];
  while (ready.length) {
    const i = ready.pop()!;
    order.push(i);
    for (const r of readers[gates[i].out])
      if (--waiting[r] === 0) ready.push(r);
  }
  if (order.length !== inReg.filter((r) => !r).length)
    throw new Error("internal: a loop that does not go through a latch");

  const evt = net.ports.find((p) => p.name === "EVT")!.nets;
  const idsOf = new Map<number, string[]>();
  for (const [id, code] of syn.codes) {
    const list = idsOf.get(code);
    if (list) list.push(id);
    else idsOf.set(code, [id]);
  }
  const codes = Math.max(0, ...syn.codes.values());

  const out: Reaction[] = [];
  const K = new Int8Array(nNets);
  const inCone = new Uint8Array(gates.length);
  for (let code = 1; code <= codes; code++) {
    K.fill(X);
    K[NET0] = 0;
    K[NET1] = 1;
    evt.forEach((id, i) => (K[id] = Math.floor(code / 2 ** i) % 2));
    for (const i of order) {
      const g = gates[i];
      K[g.out] = eval3(g.type, K[g.in[0]], K[g.in[1] ?? g.in[0]]);
    }
    const commits = registers.filter((bits) => K[bits[0].load] !== 0).flat();
    inCone.fill(0);
    const folded = new Map<number, number>();
    const stack = commits.flatMap((c) => [c.load, c.d]);
    while (stack.length) {
      const x = stack.pop()!;
      if (K[x] !== X) {
        folded.set(x, K[x]);
        continue;
      }
      const d = driver[x];
      if (d < 0 || inReg[d] || inCone[d]) continue; // an input, a register's output, or seen
      inCone[d] = 1;
      stack.push(...gates[d].in);
    }
    const cone = order.filter((i) => inCone[i]);
    out.push({
      code,
      ids: idsOf.get(code) ?? [],
      gates: cone,
      folded: [...folded],
      commits,
      cost: cone.length + commits.length,
    });
  }
  return out;
}

/** The synthesized OS run as per-event reactions would run it in Figma: no clock and no
 * latches. fire() evaluates the event's cone in order, then commits the bits it can load. */
export class ReactionMachine {
  readonly net: FlatNetlist;
  readonly reactions: Reaction[];
  /** Net values; a register bit's value is on its output net. */
  readonly v: Uint8Array;
  private readonly init: Uint8Array;
  private readonly ports = new Map<string, number[]>();
  private readonly ids = new Map<string, number[]>();

  constructor(readonly syn: Synth) {
    this.net = flatten(syn.lib, syn.top);
    this.reactions = reactions(syn, this.net);
    this.init = powerOn(this.net, syn.pokes);
    this.v = this.init.slice();
    for (const p of this.net.ports) this.ports.set(p.name, p.nets);
    for (const [name, r] of syn.regs)
      this.ids.set(
        name,
        r.nets.map((n) => netId(this.net, n)),
      );
  }

  /** Back to power-on. */
  reset(): void {
    this.v.set(this.init);
  }

  /** Fires one event: the given inputs get their values (the others keep theirs), then the
   * event's reaction runs. */
  fire(eventId: string, inputs: Record<string, number> = {}): void {
    const code = this.syn.codes.get(eventId);
    if (code === undefined) throw new Error(`no event ${eventId}`);
    const v = this.v;
    for (const [name, value] of Object.entries(inputs)) {
      const { port, bits } = inputPort(this.syn, name, value);
      this.ports
        .get(port)!
        .forEach((id, i) => (v[id] = Math.floor(bits / 2 ** i) % 2));
    }
    const r = this.reactions[code - 1];
    for (const [id, value] of r.folded) v[id] = value;
    for (const i of r.gates) {
      const g = this.net.gates[i];
      v[g.out] = evalGate(g.type, v[g.in[0]], v[g.in[1] ?? g.in[0]]);
    }
    // Every commit reads the values from before the event: one register may load another's output.
    const next = r.commits.map((c) => (v[c.load] ? v[c.d] : v[c.q]));
    r.commits.forEach((c, i) => (v[c.q] = next[i]));
  }

  /** A state variable's register, decoded as GateMachine.read does. */
  read(varName: string): number | boolean {
    const r = this.syn.regs.get(varName);
    const ids = this.ids.get(varName);
    if (!r || !ids) throw new Error(`${varName} is not a state variable`);
    return decodeRegister(r, ids, this.v);
  }
}
