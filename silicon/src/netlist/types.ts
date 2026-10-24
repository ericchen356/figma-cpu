// Core netlist contracts. Everything in the CPU is built from the primitive gates below;
// these types describe circuits as Figma draws them (modules = Figma components,
// instances = component instances, nets = named wires) and as the compiler sees them.

/** The only logic the tooling knows. Every other part (latches, flip-flops, adders,
 * registers, RAM, ALU, control unit, CPU) is a module built out of these. */
export const GATE_TYPES = ["BUF", "NOT", "AND", "OR", "NAND", "NOR", "XOR", "XNOR"] as const;
export type GateType = (typeof GATE_TYPES)[number];

export const GATE_ARITY: Record<GateType, 1 | 2> = {
  BUF: 1,
  NOT: 1,
  AND: 2,
  OR: 2,
  NAND: 2,
  NOR: 2,
  XOR: 2,
  XNOR: 2,
};

/** Primitive cells are referenced as "gate/AND" etc. Inputs A (and B), output Y. */
export const GATE_PREFIX = "gate/";
export const isGateCell = (cell: string) => cell.startsWith(GATE_PREFIX);
export const gateTypeOf = (cell: string) => cell.slice(GATE_PREFIX.length) as GateType;

export function evalGate(type: GateType, a: number, b: number): 0 | 1 {
  switch (type) {
    case "BUF":
      return a ? 1 : 0;
    case "NOT":
      return a ? 0 : 1;
    case "AND":
      return a && b ? 1 : 0;
    case "OR":
      return a || b ? 1 : 0;
    case "NAND":
      return a && b ? 0 : 1;
    case "NOR":
      return a || b ? 0 : 1;
    case "XOR":
      return (a ? 1 : 0) ^ (b ? 1 : 0) ? 1 : 0;
    case "XNOR":
      return (a ? 1 : 0) ^ (b ? 1 : 0) ? 0 : 1;
  }
}

/** Constant nets, usable anywhere a net name is expected. */
export const CONST0 = "0";
export const CONST1 = "1";

export type PortDir = "in" | "out";

export interface PortDef {
  name: string;
  dir: PortDir;
  /** Number of bits. Bits are named `NAME[i]` (LSB = 0); a 1-bit port is just `NAME`. */
  width: number;
}

/** One child inside a module: a primitive gate ("gate/AND") or another module ("FULL_ADDER").
 * `conn` maps each child port name to the parent-scope nets for its bits, LSB first. */
export interface InstanceDef {
  name: string;
  cell: string;
  conn: Record<string, string[]>;
}

/** A module = a Figma main component. Nets inside it are named strings; port bit names
 * (`A`, `D[3]`) refer to the ports, "0"/"1" are constants, anything else is internal. */
export interface ModuleDef {
  name: string;
  ports: PortDef[];
  instances: InstanceDef[];
  doc?: string;
}

export type Library = Map<string, ModuleDef>;

/** The primitive gate definitions, so primitives and modules can be treated uniformly. */
export function gatePorts(type: GateType): PortDef[] {
  return GATE_ARITY[type] === 1
    ? [
        { name: "A", dir: "in", width: 1 },
        { name: "Y", dir: "out", width: 1 },
      ]
    : [
        { name: "A", dir: "in", width: 1 },
        { name: "B", dir: "in", width: 1 },
        { name: "Y", dir: "out", width: 1 },
      ];
}

/** Bit names of a port: ["D[0]", "D[1]", ...] or ["CLK"] for width 1. */
export function portBits(p: Pick<PortDef, "name" | "width">): string[] {
  return p.width === 1 ? [p.name] : Array.from({ length: p.width }, (_, i) => `${p.name}[${i}]`);
}

// ---------- flattened form ----------

/** Reserved net ids. */
export const NET0 = 0;
export const NET1 = 1;

export interface FlatGate {
  type: GateType;
  /** Input net ids (1 or 2). */
  in: number[];
  /** Output net id. */
  out: number;
  /** Hierarchical instance path, e.g. "cpu/alu/add/fa3/x1". */
  path: string;
}

export interface FlatPort {
  name: string;
  dir: PortDir;
  /** Net id per bit, LSB first. */
  nets: number[];
}

export interface FlatNetlist {
  top: string;
  /** Canonical (shallowest) hierarchical name per net id. ids 0/1 are the constants. */
  netNames: string[];
  /** Every hierarchical name that refers to a net (port aliases included) → net id. */
  aliases: Map<string, number>;
  gates: FlatGate[];
  /** Top-level ports. Inputs are driven from outside (switches, CLK, RESET). */
  ports: FlatPort[];
  /** Net id → index of the gate driving it, or -1 (inputs, constants). */
  driver: Int32Array;
}
