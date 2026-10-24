// Flattens a module hierarchy (Figma components inside components) into one gate list.
// A child's port nets are the same wires as the parent nets they connect to, so nets are
// merged across levels; each net keeps its shallowest hierarchical name.
import {
  CONST0,
  CONST1,
  type FlatGate,
  type FlatNetlist,
  type FlatPort,
  gateTypeOf,
  isGateCell,
  type Library,
  NET0,
  NET1,
  portBits,
} from "./types";
import { cellPorts } from "../hdl/builder";

export class NetlistError extends Error {}

export function flatten(lib: Library, top: string): FlatNetlist {
  const topDef = lib.get(top);
  if (!topDef) throw new NetlistError(`no module ${top}`);
  const netNames: string[] = [CONST0, CONST1];
  const aliases = new Map<string, number>([
    [CONST0, NET0],
    [CONST1, NET1],
  ]);
  const gates: FlatGate[] = [];
  const newNet = (name: string) => {
    netNames.push(name);
    aliases.set(name, netNames.length - 1);
    return netNames.length - 1;
  };

  // Top-level ports become nets named by their bit names.
  const ports: FlatPort[] = topDef.ports.map((p) => ({ name: p.name, dir: p.dir, nets: portBits(p).map((b) => newNet(b)) }));
  const topBinding = new Map<string, number>();
  topDef.ports.forEach((p, i) => portBits(p).forEach((b, k) => topBinding.set(b, ports[i].nets[k])));

  const expand = (moduleName: string, prefix: string, binding: Map<string, number>, depth: number) => {
    if (depth > 64) throw new NetlistError(`hierarchy too deep at ${prefix} (recursive module?)`);
    const def = lib.get(moduleName)!;
    const local = new Map<string, number>(binding);
    const resolve = (n: string): number => {
      if (n === CONST0) return NET0;
      if (n === CONST1) return NET1;
      let id = local.get(n);
      if (id === undefined) {
        id = newNet(`${prefix}${n}`);
        local.set(n, id);
      } else if (!aliases.has(`${prefix}${n}`)) aliases.set(`${prefix}${n}`, id);
      return id;
    };
    for (const inst of def.instances) {
      const path = `${prefix}${inst.name}`;
      if (isGateCell(inst.cell)) {
        const type = gateTypeOf(inst.cell);
        const ins = (inst.conn.B ? ["A", "B"] : ["A"]).map((p) => {
          const n = inst.conn[p]?.[0];
          if (n === undefined) throw new NetlistError(`${path}: gate input ${p} not connected`);
          return resolve(n);
        });
        const y = inst.conn.Y?.[0];
        if (y === undefined) throw new NetlistError(`${path}: gate output Y not connected`);
        gates.push({ type, in: ins, out: resolve(y), path });
        continue;
      }
      if (!lib.has(inst.cell)) throw new NetlistError(`${path}: unknown cell ${inst.cell}`);
      const childBinding = new Map<string, number>();
      for (const p of cellPorts(lib, inst.cell)) {
        const nets = inst.conn[p.name];
        if (!nets) {
          if (p.dir === "in") throw new NetlistError(`${path}: input ${p.name} of ${inst.cell} not connected`);
          continue;
        }
        const bits = portBits(p);
        if (nets.length !== bits.length) throw new NetlistError(`${path}: ${inst.cell}.${p.name} width mismatch`);
        bits.forEach((b, i) => childBinding.set(b, resolve(nets[i])));
      }
      expand(inst.cell, `${path}/`, childBinding, depth + 1);
      // Child port names inside the child scope are aliases of the parent nets.
      for (const [b, id] of childBinding) if (!aliases.has(`${path}/${b}`)) aliases.set(`${path}/${b}`, id);
    }
  };
  expand(top, "", topBinding, 0);

  // Driver analysis: every net has at most one driver; every used net has one (or is an input/constant).
  const driver = new Int32Array(netNames.length).fill(-1);
  gates.forEach((g, i) => {
    if (g.out === NET0 || g.out === NET1) throw new NetlistError(`${g.path}: drives a constant`);
    if (driver[g.out] !== -1)
      throw new NetlistError(`net ${netNames[g.out]} has two drivers: ${gates[driver[g.out]].path} and ${g.path}`);
    driver[g.out] = i;
  });
  const inputNets = new Set(ports.filter((p) => p.dir === "in").flatMap((p) => p.nets));
  for (const n of inputNets) if (driver[n] !== -1) throw new NetlistError(`top input ${netNames[n]} is driven inside the circuit`);
  const undriven = new Set<string>();
  for (const g of gates)
    for (const n of g.in) if (n > NET1 && driver[n] === -1 && !inputNets.has(n)) undriven.add(`${netNames[n]} (read by ${g.path})`);
  for (const p of ports)
    if (p.dir === "out") for (const n of p.nets) if (n > NET1 && driver[n] === -1 && !inputNets.has(n)) undriven.add(`${netNames[n]} (top output)`);
  if (undriven.size) throw new NetlistError(`undriven nets: ${[...undriven].slice(0, 12).join(", ")}${undriven.size > 12 ? ` … (+${undriven.size - 12})` : ""}`);

  return { top, netNames, aliases, gates, ports, driver };
}

/** Net id by hierarchical name (e.g. "alu/sum[3]", "R0[7]"). Throws if unknown. */
export function netId(n: FlatNetlist, name: string): number {
  const id = n.aliases.get(name);
  if (id === undefined) throw new NetlistError(`no net named ${name}`);
  return id;
}

/** Net ids of a bus by base name: bus(n, "alu/sum", 8) → ids of alu/sum[0..7]. */
export function busIds(n: FlatNetlist, base: string, width: number): number[] {
  return Array.from({ length: width }, (_, i) => netId(n, width === 1 ? base : `${base}[${i}]`));
}

export function stats(n: FlatNetlist): Record<string, number> {
  const s: Record<string, number> = { nets: n.netNames.length, gates: n.gates.length };
  for (const g of n.gates) s[g.type] = (s[g.type] ?? 0) + 1;
  return s;
}
