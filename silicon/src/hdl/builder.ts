// A tiny structural "HDL" for describing modules out of gates and other modules.
// It only builds data (ModuleDef). The same data is drawn into Figma as components,
// read back off the canvas, and compiled — the canvas is the source of truth at run time.
import {
  CONST0,
  CONST1,
  GATE_ARITY,
  GATE_PREFIX,
  type GateType,
  gatePorts,
  type InstanceDef,
  isGateCell,
  type Library,
  type ModuleDef,
  type PortDef,
  portBits,
} from "../netlist/types";

export type Bus = string[];
export type NetRef = string | Bus;

export interface PortSpec {
  in?: Record<string, number>;
  out?: Record<string, number>;
}

/** Port definitions of a cell (gate or module) in a library. */
export function cellPorts(lib: Library, cell: string): PortDef[] {
  if (isGateCell(cell)) {
    const t = cell.slice(GATE_PREFIX.length) as GateType;
    if (!(t in GATE_ARITY)) throw new Error(`unknown gate ${cell}`);
    return gatePorts(t);
  }
  const m = lib.get(cell);
  if (!m) throw new Error(`unknown cell ${cell}`);
  return m.ports;
}

export class ModuleBuilder {
  readonly ports: PortDef[] = [];
  readonly instances: InstanceDef[] = [];
  private used = new Set<string>();
  private counters = new Map<string, number>();

  constructor(
    readonly lib: Library,
    readonly name: string,
    spec: PortSpec,
  ) {
    for (const [n, w] of Object.entries(spec.in ?? {})) this.ports.push({ name: n, dir: "in", width: w });
    for (const [n, w] of Object.entries(spec.out ?? {})) this.ports.push({ name: n, dir: "out", width: w });
    for (const p of this.ports) {
      if (!/^[A-Za-z_][\w]*$/.test(p.name)) throw new Error(`${name}: bad port name ${p.name}`);
      for (const b of portBits(p)) this.used.add(b);
    }
  }

  private port(name: string, dir: "in" | "out"): Bus {
    const p = this.ports.find((x) => x.name === name);
    if (!p) throw new Error(`${this.name}: no port ${name}`);
    if (p.dir !== dir) throw new Error(`${this.name}: port ${name} is ${p.dir}, not ${dir}`);
    return portBits(p);
  }

  /** Bit nets of an input port (LSB first). */
  in(name: string): Bus {
    return this.port(name, "in");
  }
  /** Bit nets of an output port (LSB first). Drive each bit exactly once. */
  out(name: string): Bus {
    return this.port(name, "out");
  }
  /** Single-bit helpers. */
  in1(name: string): string {
    return this.in(name)[0];
  }
  out1(name: string): string {
    return this.out(name)[0];
  }

  /** Fresh internal net names (unique within the module). */
  wire(base: string, width = 1): Bus {
    const out: Bus = [];
    for (let i = 0; i < width; i++) {
      let n = width === 1 ? base : `${base}[${i}]`;
      if (this.used.has(n)) {
        let k = this.counters.get(base) ?? 1;
        while (this.used.has(width === 1 ? `${base}_${k}` : `${base}_${k}[${i}]`)) k++;
        this.counters.set(base, k);
        n = width === 1 ? `${base}_${k}` : `${base}_${k}[${i}]`;
      }
      this.used.add(n);
      out.push(n);
    }
    return out;
  }
  wire1(base: string): string {
    return this.wire(base)[0];
  }

  private instName(base: string): string {
    const k = (this.counters.get(`#${base}`) ?? 0) + 1;
    this.counters.set(`#${base}`, k);
    return `${base}${k}`;
  }

  /** Places a primitive gate. Returns its output net (`out`, or a fresh net). */
  gate(type: GateType, inputs: string[], out?: string, inst?: string): string {
    if (inputs.length !== GATE_ARITY[type]) throw new Error(`${this.name}: ${type} takes ${GATE_ARITY[type]} inputs`);
    const y = out ?? this.wire1(type.toLowerCase());
    if (out && !this.used.has(out)) this.used.add(out);
    const conn: Record<string, string[]> = { A: [inputs[0]], Y: [y] };
    if (inputs.length === 2) conn.B = [inputs[1]];
    this.instances.push({ name: inst ?? this.instName(type.toLowerCase()), cell: `${GATE_PREFIX}${type}`, conn });
    return y;
  }
  BUF = (a: string, out?: string) => this.gate("BUF", [a], out);
  NOT = (a: string, out?: string) => this.gate("NOT", [a], out);
  AND = (a: string, b: string, out?: string) => this.gate("AND", [a, b], out);
  OR = (a: string, b: string, out?: string) => this.gate("OR", [a, b], out);
  NAND = (a: string, b: string, out?: string) => this.gate("NAND", [a, b], out);
  NOR = (a: string, b: string, out?: string) => this.gate("NOR", [a, b], out);
  XOR = (a: string, b: string, out?: string) => this.gate("XOR", [a, b], out);
  XNOR = (a: string, b: string, out?: string) => this.gate("XNOR", [a, b], out);

  /** AND/OR/XOR of many nets as a balanced tree of 2-input gates. */
  reduce(type: "AND" | "OR" | "XOR", nets: string[], out?: string): string {
    if (nets.length === 0) return type === "AND" ? CONST1 : CONST0;
    if (nets.length === 1) return out ? this.BUF(nets[0], out) : nets[0];
    let level = nets;
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 === level.length) next.push(level[i]);
        else next.push(this.gate(type, [level[i], level[i + 1]], level.length === 2 ? out : undefined));
      }
      level = next;
    }
    return level[0];
  }

  /** Instantiates another module. `conn` maps child port → parent nets; unconnected
   * child outputs get fresh nets. Returns every child port's nets in this scope. */
  use(cell: string, conn: Record<string, NetRef>, inst?: string): Record<string, Bus> {
    const ports = cellPorts(this.lib, cell);
    const name = inst ?? this.instName(cell.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    if (this.instances.some((i) => i.name === name)) throw new Error(`${this.name}: duplicate instance ${name}`);
    const out: Record<string, Bus> = {};
    const resolved: Record<string, string[]> = {};
    for (const p of ports) {
      let nets = conn[p.name];
      if (nets === undefined) {
        if (p.dir === "in") throw new Error(`${this.name}/${name}: input ${p.name} of ${cell} is not connected`);
        nets = this.wire(`${name}_${p.name}`, p.width);
      }
      const bus = typeof nets === "string" ? [nets] : nets;
      if (bus.length !== p.width)
        throw new Error(`${this.name}/${name}: ${cell}.${p.name} is ${p.width} bits, got ${bus.length}`);
      for (const n of bus) if (n !== CONST0 && n !== CONST1) this.used.add(n);
      resolved[p.name] = bus;
      out[p.name] = bus;
    }
    for (const k of Object.keys(conn))
      if (!ports.some((p) => p.name === k)) throw new Error(`${this.name}/${name}: ${cell} has no port ${k}`);
    this.instances.push({ name, cell, conn: resolved });
    return out;
  }

  build(doc?: string): ModuleDef {
    return { name: this.name, ports: this.ports, instances: this.instances, doc };
  }
}

/** Defines a module in a library with a builder callback. */
export function define(lib: Library, name: string, spec: PortSpec, body: (b: ModuleBuilder) => void, doc?: string): ModuleDef {
  if (lib.has(name)) throw new Error(`module ${name} defined twice`);
  const b = new ModuleBuilder(lib, name, spec);
  body(b);
  const m = b.build(doc);
  lib.set(name, m);
  return m;
}

/** Constant bus of a number (LSB first). */
export function constBus(value: number, width: number): Bus {
  return Array.from({ length: width }, (_, i) => ((value >> i) & 1 ? CONST1 : CONST0));
}
