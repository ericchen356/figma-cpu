// From the bit graph to silicon modules. Gates are emitted for what the registers need and
// nothing else; each AIG node is built in the polarity most of its consumers want, as whichever
// of AND, NAND, NOR, OR, XOR, XNOR saves an inverter, and a NOT is made only for the other
// polarity when something really needs it. Every gate belongs to the module of the node it came
// from; bits that cross from one module to another become ports, grouped into buses named after
// the word-level node that produced them. The top module wires the blocks to the registers.
import { define, type ModuleBuilder } from "../../../silicon/src/hdl/builder";
import {
  portBits,
  type GateType,
  type Library,
} from "../../../silicon/src/netlist/types";
import { Aig, KIND_AND, KIND_INPUT, KIND_XOR, T, type Lit } from "./aig";

/** A net of the generated design. */
export interface Signal {
  /** Producing module, or -1 for a top-level net (register output, input port, EVT bit). */
  module: number;
  /** Bus the signal belongs to where it crosses a module boundary. */
  bus: string;
  /** Order inside the bus. */
  index: number;
  /** The AIG input key of a top-level net. */
  key?: string;
}

export interface Gate {
  type: GateType;
  ins: number[];
  out: number;
  module: number;
}

/** A name usable as a port or net base: letters, digits and _, not starting with a digit. */
export function sanitize(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Za-z_]/.test(s) ? s : `_${s}`;
}

/** Hands out distinct names: the base itself, then base_2, base_3, … */
export class Namer {
  private readonly taken = new Set<string>();
  constructor(reserved: Iterable<string> = []) {
    for (const r of reserved) this.taken.add(r);
  }
  unique(base: string): string {
    let n = base;
    for (let k = 2; this.taken.has(n); k++) n = `${base}_${k}`;
    this.taken.add(n);
    return n;
  }
}

/** Builds the gates for `roots`. Returns them in dependency order, with every root's signal. */
export function emitGates(
  aig: Aig,
  roots: readonly Lit[],
  busOf: (origin: number) => string,
  external: (key: string) => { bus: string; index: number },
  rootModule: number,
): { signals: Signal[]; gates: Gate[]; rootSignals: number[] } {
  const N = aig.size;
  const isGate = (n: number) =>
    aig.kind[n] === KIND_AND || aig.kind[n] === KIND_XOR;

  // Nodes the roots need, operands first.
  const seen = new Uint8Array(N);
  const order: number[] = [];
  for (const r of roots) {
    if (r <= T) throw new Error("internal: a register input is constant");
    if (seen[r >> 1]) continue;
    const stack = [r >> 1];
    while (stack.length) {
      const n = stack[stack.length - 1];
      if (seen[n] === 0) {
        seen[n] = 1;
        if (isGate(n))
          for (const c of [aig.b[n] >> 1, aig.a[n] >> 1])
            if (!seen[c]) stack.push(c);
      } else {
        stack.pop();
        if (seen[n] === 1) {
          seen[n] = 2;
          order.push(n);
        }
      }
    }
  }

  // Which polarity of each node its consumers want. An AND of two complemented operands will be
  // a NOR (or an OR) of the operands themselves, so it asks for them uncomplemented; an XOR gate
  // takes either polarity of its operands, so it asks for nothing.
  const want = [new Int32Array(N), new Int32Array(N)];
  for (const r of roots) want[r & 1][r >> 1]++;
  for (const n of order) {
    if (aig.kind[n] !== KIND_AND) continue;
    const [x, y] = [aig.a[n], aig.b[n]];
    if (x & 1 && y & 1) {
      want[0][x >> 1]++;
      want[0][y >> 1]++;
    } else {
      want[x & 1][x >> 1]++;
      want[y & 1][y >> 1]++;
    }
  }
  const prim = new Uint8Array(N);
  for (const n of order) prim[n] = isGate(n) && want[1][n] > want[0][n] ? 1 : 0;

  const signals: Signal[] = [];
  const gates: Gate[] = [];
  const net = new Int32Array(2 * N).fill(-1);
  const signal = (s: Signal) => signals.push(s) - 1;

  /** The signal of a literal whose node is built; makes the inverter for its other polarity. */
  const lit = (l: Lit, requester: number): number => {
    if (net[l] >= 0) return net[l];
    const n = l >> 1;
    const other = net[l ^ 1];
    if (other < 0)
      throw new Error("internal: a literal is used before its node is built");
    const module = aig.kind[n] === KIND_INPUT ? requester : aig.owner[n];
    const s = signal({
      module,
      bus: `${signals[other].bus}_n`,
      index: signals.length,
    });
    gates.push({ type: "NOT", ins: [other], out: s, module });
    net[l] = s;
    return s;
  };

  for (const n of order) {
    if (aig.kind[n] === KIND_INPUT) {
      const key = aig.inputKey.get(n)!;
      net[2 * n] = signal({ module: -1, ...external(key), key });
      continue;
    }
    const module = aig.owner[n];
    const p = prim[n];
    const [x, y] = [aig.a[n], aig.b[n]];
    let type: GateType;
    let ins: number[];
    if (aig.kind[n] === KIND_XOR) {
      // Operands as they were built; the gate type absorbs their polarity.
      const [nx, ny] = [x >> 1, y >> 1];
      type = prim[nx] ^ prim[ny] ^ p ? "XNOR" : "XOR";
      ins = [net[2 * nx + prim[nx]], net[2 * ny + prim[ny]]];
    } else {
      const missing = (l: Lit) => (net[l] >= 0 ? 0 : 1);
      if (missing(x ^ 1) + missing(y ^ 1) < missing(x) + missing(y)) {
        type = p ? "OR" : "NOR";
        ins = [lit(x ^ 1, module), lit(y ^ 1, module)];
      } else {
        type = p ? "NAND" : "AND";
        ins = [lit(x, module), lit(y, module)];
      }
    }
    const s = signal({
      module,
      bus: busOf(aig.origin[n]),
      index: signals.length,
    });
    gates.push({ type, ins, out: s, module });
    net[2 * n + p] = s;
  }
  const rootSignals = roots.map((r) => lit(r, rootModule));
  return { signals, gates, rootSignals };
}

export interface BlockSpec {
  name: string;
  inst: string;
}

export interface RegisterSpec {
  /** State variable. */
  name: string;
  inst: string;
  /** Base name of its output nets in the top module. */
  net: string;
  bits: number;
  load: number;
  d: number[];
}

export interface TopSpec {
  name: string;
  evtBits: number;
  inputs: { name: string; port: string; bits: number }[];
}

/** Defines one module per block that has gates, then the top module with the registers.
 * Returns the register output nets of the top module. */
export function assemble(
  lib: Library,
  blocks: readonly BlockSpec[],
  emitted: { signals: Signal[]; gates: Gate[] },
  registers: readonly RegisterSpec[],
  top: TopSpec,
): Map<string, string[]> {
  const { signals, gates } = emitted;
  const imports = blocks.map(() => new Set<number>());
  const exported = new Set<number>();
  const byBlock = blocks.map((): Gate[] => []);
  const cross = (s: number, to: number) => {
    const from = signals[s].module;
    if (from === to) return;
    if (to >= 0) imports[to].add(s);
    if (from >= 0) exported.add(s);
  };
  for (const g of gates) {
    byBlock[g.module].push(g);
    for (const s of g.ins) cross(s, g.module);
  }
  for (const r of registers) for (const s of [r.load, ...r.d]) cross(s, -1);

  /** Signals grouped into buses, each bus in index order, with a port name unique in the block. */
  const buses = (sigs: Iterable<number>, namer: Namer) => {
    const groups = new Map<string, number[]>();
    for (const s of sigs) {
      const list = groups.get(signals[s].bus);
      if (list) list.push(s);
      else groups.set(signals[s].bus, [s]);
    }
    return [...groups].map(([bus, list]) => ({
      port: namer.unique(sanitize(bus)),
      sigs: list.sort((a, b) => signals[a].index - signals[b].index),
    }));
  };
  const ports = blocks.map((_, m) => {
    const namer = new Namer();
    return {
      ins: buses(
        [...imports[m]].sort((a, b) => a - b),
        namer,
      ),
      outs: buses(
        [...exported]
          .filter((s) => signals[s].module === m)
          .sort((a, b) => a - b),
        namer,
      ),
    };
  });

  blocks.forEach((blk, m) => {
    if (!byBlock[m].length) return;
    const spec = {
      in: {} as Record<string, number>,
      out: {} as Record<string, number>,
    };
    for (const p of ports[m].ins) spec.in[p.port] = p.sigs.length;
    for (const p of ports[m].outs) spec.out[p.port] = p.sigs.length;
    define(lib, blk.name, spec, (b: ModuleBuilder) => {
      const local = new Map<number, string>();
      for (const p of [...ports[m].ins, ...ports[m].outs])
        portBits({ name: p.port, width: p.sigs.length }).forEach((bit, i) =>
          local.set(p.sigs[i], bit),
        );
      const inst = new Namer();
      for (const g of byBlock[m]) {
        const ins = g.ins.map((s) => local.get(s)!);
        let out = local.get(g.out);
        if (out === undefined) {
          out = b.wire1(sanitize(signals[g.out].bus));
          local.set(g.out, out);
        }
        b.gate(g.type, ins, out, inst.unique(out.replace(/\[(\d+)\]$/, "_$1")));
      }
    });
  });

  const qNets = new Map<string, string[]>();
  const spec: Record<string, number> = { CLK: 1, EVT: top.evtBits };
  for (const i of top.inputs) spec[i.port] = i.bits;
  define(lib, top.name, { in: spec }, (b) => {
    for (const r of registers) qNets.set(r.name, b.wire(r.net, r.bits));
    const evt = b.in("EVT");
    const inputPort = new Map(top.inputs.map((i) => [i.name, b.in(i.port)]));
    const external = (key: string): string => {
      const [kind, bit, name] = key.split(":");
      const i = Number(bit);
      if (kind === "e") return evt[i];
      if (kind === "i") return inputPort.get(name)![i];
      const q = qNets.get(name);
      if (!q)
        throw new Error(
          `internal: ${name} is read as a register but is not one`,
        );
      return q[i];
    };
    const topNet = new Map<number, string>();
    blocks.forEach((_, m) => {
      for (const p of ports[m].outs)
        b.wire(p.port, p.sigs.length).forEach((n, i) =>
          topNet.set(p.sigs[i], n),
        );
    });
    const netOf = (s: number) =>
      signals[s].module < 0 ? external(signals[s].key!) : topNet.get(s)!;
    blocks.forEach((blk, m) => {
      if (!byBlock[m].length) return;
      const conn: Record<string, string[]> = {};
      for (const p of [...ports[m].ins, ...ports[m].outs])
        conn[p.port] = p.sigs.map(netOf);
      b.use(blk.name, conn, blk.inst);
    });
    for (const r of registers)
      b.use(
        `REG_W${r.bits}`,
        {
          D: r.d.map(netOf),
          LOAD: netOf(r.load),
          CLK: "CLK",
          Q: qNets.get(r.name)!,
        },
        r.inst,
      );
  });
  return qNets;
}
