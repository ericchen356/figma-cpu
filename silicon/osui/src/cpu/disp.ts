// The os-ui chip's screen decode: the lines the Figma screen binds its layers to, as gates on the
// register outputs. Its instance in the OS module is named "disp", so NATHAN's synthesizer treats
// these gates as screen gates: an event evaluates them after its commit, and only those that read
// a register that loaded.
//
// The screen does no arithmetic. A layer's box is placed by binary-weighted spacer frames bound to
// bits (x and y as 6-bit offset binary around the window, w and h saturated at 63 cells), a kind or
// a colour is one leaf of a set of layers bound to one-hot lines, and a number is decimal digits
// (double dabble), each shown by the display's glyph table (live/rom.ts) from its four bits.
//
//   DISP        the decode shared by the whole screen: layer count, selection, tool, current colour,
//               and one SLOT_DISP per layer slot
//   SLOT_DISP   one layer: on canvas or not, placement bits, kind and fill lines, the decimal digits
//               of x, y, w, h and the id
import { ModuleBuilder } from "../../../src/hdl/builder";
import {
  CONST0,
  CONST1,
  type GateType,
  type Library,
} from "../../../src/netlist/types";
import { PICK_GROUPS, PICK_NAMES, type PickGroup } from "./pick";

export const SLOTS = 8;
/** The kinds a layer can have (the create tools: frame … star), by tool code. */
export const KINDS = [3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
/** Placement window: x and y in [-OFFSET, OFFSET) cells are drawn, 6-bit offset binary. */
export const OFFSET = 32;
export const PLACE_BITS = 6;

/** Where a screen line comes from, in the scope of the OS module. */
export type Line = { net: string } | { k: 0 | 1 };

/** A number in decimal: digits least significant first, each with its BCD bits and whether it
 * shows (leading zeros hide; the units digit always shows). */
export interface Num {
  /** Minus sign (signed numbers only). */
  neg?: Line;
  digits: Array<{ bits: Line[]; show: Line }>;
}
/** A small field picked by its bits: the bits and their inverses. */
export interface Field {
  bits: Line[];
  inv: Line[];
}

export interface SlotLines {
  /** In use (one of the first n slots): a DISP line from the layer count. */
  used: Line;
  /** Selected: a DISP line from the selection. */
  sel: Line;
  /** Visible and inside the placement window: drawn on the canvas when also used (the screen
   * ANDs the two by nesting one layer in the other). */
  vin: Line;
  vis: Line;
  visN: Line;
  /** x + OFFSET, y + OFFSET (offset binary), w and h saturated at 63: spacer bits, LSB first. */
  px: Line[];
  py: Line[];
  pw: Line[];
  ph: Line[];
  /** One-hot kind lines by tool code (3 … 11). */
  kind: Record<number, Line>;
  /** The kind has a corner radius (frame, section, slice, rectangle). */
  canRadius: Line;
  /** A frame or section: its name shows above it on the canvas. */
  labelled: Line;
  /** The kind has a fill (all but a slice). */
  hasFill: Line;
  /** A region (frame, section, slice): Export names it; otherwise the file. */
  region: Line;
  regionN: Line;
  /** The layer has a stroke (the inverse of strokeNone). */
  hasStroke: Line;
  /** One-hot fill lines 0 … 15. */
  fill: Line[];
  x: Num;
  y: Num;
  w: Num;
  h: Num;
  id: Num;
  /** One-hot opacity 0 … 10 (tenths) and radius 0 … 4 (quarter cells). */
  opacity: Line[];
  radius: Line[];
  /** No stroke (stroke = -1), and one-hot stroke colours 0 … 15 when there is one. */
  strokeNone: Line;
  stroke: Line[];
  shadow: Field;
  flip: Field;
}

export interface DisplayLines {
  /** Layer count one-hot, 0 … 8. */
  n: Line[];
  anySel: Line;
  /** Slot i not selected (the inverse of slots[i].sel). */
  selN: Line[];
  noSel: Line;
  /** Tool one-hot by tool code 0 … 16. */
  tool: Line[];
  /** Current colour one-hot 0 … 15. */
  fill: Line[];
  tCreate: Line;
  tSelect: Line;
  /** The tool each toolbar group of several tools remembers (pick.ts), one-hot by its index in
   * the group. */
  pick: Record<PickGroup, Line[]>;
  slots: SlotLines[];
}

/** The register nets the display reads (OS scope), by field. */
export interface DisplayInputs {
  n: string[];
  sel: string[];
  tool: string[];
  fill: string[];
  tCreate: string;
  tSelect: string;
  pick: Record<PickGroup, string[]>;
  slots: Array<Record<SlotField, string[]>>;
}
export const SLOT_FIELDS = {
  x: 12,
  y: 12,
  w: 10,
  h: 10,
  kind: 5,
  fill: 4,
  vis: 1,
  id: 8,
  opacity: 4,
  radius: 3,
  stroke: 5,
  shadow: 1,
  flip: 1,
} as const;
export type SlotField = keyof typeof SLOT_FIELDS;

// ---------- gates with constants folded at build time ----------

type Bit = string;

/** Places 2-input gates, folding constants and trivial cases away so no gate has a constant input. */
export class Gates {
  private n = 0;
  constructor(
    readonly b: ModuleBuilder,
    private readonly prefix = "g",
  ) {}
  gate(t: GateType, ins: Bit[]): Bit {
    return this.b.gate(t, ins, undefined, `${this.prefix}${this.n++}`);
  }
  not(a: Bit): Bit {
    if (a === CONST0) return CONST1;
    if (a === CONST1) return CONST0;
    return this.gate("NOT", [a]);
  }
  and(a: Bit, c: Bit): Bit {
    if (a === CONST0 || c === CONST0) return CONST0;
    if (a === CONST1) return c;
    if (c === CONST1 || a === c) return a;
    return this.gate("AND", [a, c]);
  }
  or(a: Bit, c: Bit): Bit {
    if (a === CONST1 || c === CONST1) return CONST1;
    if (a === CONST0) return c;
    if (c === CONST0 || a === c) return a;
    return this.gate("OR", [a, c]);
  }
  xor(a: Bit, c: Bit): Bit {
    if (a === CONST0) return c;
    if (c === CONST0) return a;
    if (a === CONST1) return this.not(c);
    if (c === CONST1) return this.not(a);
    if (a === c) return CONST0;
    return this.gate("XOR", [a, c]);
  }
  xnor(a: Bit, c: Bit): Bit {
    if (a === CONST0) return this.not(c);
    if (c === CONST0) return this.not(a);
    if (a === CONST1) return c;
    if (c === CONST1) return a;
    if (a === c) return CONST1;
    return this.gate("XNOR", [a, c]);
  }
  /** Balanced trees; the empty AND is 1, the empty OR 0. */
  andAll(xs: Bit[]): Bit {
    return tree(xs, (a, c) => this.and(a, c), CONST1);
  }
  orAll(xs: Bit[]): Bit {
    return tree(xs, (a, c) => this.or(a, c), CONST0);
  }

  /** One-hot lines for the given values of an unsigned bus: address bits predecoded in pairs,
   * one AND per value, only the terms some value needs. */
  decode(bus: Bit[], values: readonly number[]): Map<number, Bit> {
    const inv = new Map<number, Bit>();
    const lit = (i: number, one: boolean) => {
      if (one) return bus[i] ?? CONST0;
      if (!inv.has(i)) inv.set(i, this.not(bus[i] ?? CONST0));
      return inv.get(i)!;
    };
    const pairs = Math.ceil(bus.length / 2);
    const term = new Map<string, Bit>();
    const pairTerm = (p: number, v: number) => {
      const key = `${p}:${v}`;
      if (!term.has(key)) {
        const lo = lit(2 * p, (v & 1) === 1);
        term.set(
          key,
          2 * p + 1 < bus.length
            ? this.and(lo, lit(2 * p + 1, (v & 2) === 2))
            : lo,
        );
      }
      return term.get(key)!;
    };
    const out = new Map<number, Bit>();
    for (const v of values)
      out.set(
        v,
        this.andAll(
          Array.from({ length: pairs }, (_, p) =>
            pairTerm(p, (v >> (2 * p)) & 3),
          ),
        ),
      );
    return out;
  }

  /** Double dabble: the decimal digits (BCD, least significant first) of an unsigned bus. A digit
   * that can reach 5 gets an add-3 before each shift. */
  bcd(bus: Bit[]): Bit[][] {
    let st: Bit[] = [];
    const max = (bits: Bit[]) =>
      bits.reduce((m, b, k) => m + (b === CONST0 ? 0 : 1 << k), 0);
    for (let i = bus.length - 1; i >= 0; i--) {
      for (let d = 0; 4 * d < st.length; d++) {
        const dig = [0, 1, 2, 3].map((k) => st[4 * d + k] ?? CONST0);
        if (max(dig) < 5) continue;
        const o = this.add3(dig);
        o.forEach((b, k) => {
          if (4 * d + k < st.length || b !== CONST0) st[4 * d + k] = b;
        });
      }
      st = [bus[i], ...st];
    }
    const digits: Bit[][] = [];
    for (let d = 0; 4 * d < st.length; d++)
      digits.push([0, 1, 2, 3].map((k) => st[4 * d + k] ?? CONST0));
    // a top digit that is always 0 adds nothing
    while (
      digits.length > 1 &&
      digits[digits.length - 1].every((b) => b === CONST0)
    )
      digits.pop();
    return digits;
  }

  /** a + 3 when a >= 5 (a is a BCD digit, 0 … 9). */
  private add3([a0, a1, a2, a3]: Bit[]): Bit[] {
    const s = this.or(a3, this.and(a2, this.or(a1, a0)));
    const o0 = this.xor(a0, s);
    const c1 = this.and(a0, s);
    const t = this.xor(a1, s);
    const o1 = this.xor(t, c1);
    const c2 = this.or(this.and(a1, s), this.and(t, c1));
    const o2 = this.xor(a2, c2);
    const c3 = this.and(a2, c2);
    const o3 = this.xor(a3, c3);
    return [o0, o1, o2, o3];
  }

  /** |v| of a two's complement bus, and its sign. */
  abs(bus: Bit[]): { mag: Bit[]; neg: Bit } {
    const neg = bus[bus.length - 1];
    let carry = neg;
    const mag = bus.map((b) => {
      const x = this.xor(b, neg);
      const s = this.xor(x, carry);
      carry = this.and(x, carry);
      return s;
    });
    return { mag, neg };
  }
}

function tree(xs: Bit[], op: (a: Bit, c: Bit) => Bit, empty: Bit): Bit {
  if (!xs.length) return empty;
  let level = xs;
  while (level.length > 1) {
    const next: Bit[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(i + 1 < level.length ? op(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

// ---------- exporting a module's lines ----------

/** A line in the scope of the module that computed it: one of its output bits, one of its input
 * bits, or a constant. */
type Src = { y: number } | { in: string } | { k: 0 | 1 };

/** Gives every gate-driven bit of `lines` an output bit `Y[i]` (the gate now drives the port
 * directly) and adds the port. Returns each line's bits as Srcs. */
export function exportLines<T>(
  b: ModuleBuilder,
  lines: T,
): { src: unknown; width: number } {
  const inputs = new Set(
    b.ports
      .filter((p) => p.dir === "in")
      .flatMap((p) =>
        p.width === 1
          ? [p.name]
          : Array.from({ length: p.width }, (_, i) => `${p.name}[${i}]`),
      ),
  );
  const index = new Map<string, number>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v === CONST0) return { k: 0 };
      if (v === CONST1) return { k: 1 };
      if (inputs.has(v)) return { in: v };
      if (!index.has(v)) index.set(v, index.size);
      return { y: index.get(v)! };
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x)]),
      );
    return v;
  };
  const src = walk(lines);
  const width = index.size;
  if (width) {
    b.ports.push({ name: "Y", dir: "out", width });
    const rename = (n: string) => {
      const i = index.get(n);
      return i === undefined ? n : `Y[${i}]`;
    };
    for (const inst of b.instances)
      for (const k of Object.keys(inst.conn))
        inst.conn[k] = inst.conn[k].map(rename);
  }
  return { src, width };
}

// ---------- SLOT_DISP ----------

interface SlotBits {
  vin: Bit;
  vis: Bit;
  visN: Bit;
  px: Bit[];
  py: Bit[];
  pw: Bit[];
  ph: Bit[];
  kind: Record<number, Bit>;
  canRadius: Bit;
  labelled: Bit;
  hasFill: Bit;
  region: Bit;
  regionN: Bit;
  hasStroke: Bit;
  fill: Bit[];
  x: NumBits;
  y: NumBits;
  w: NumBits;
  h: NumBits;
  id: NumBits;
  opacity: Bit[];
  radius: Bit[];
  strokeNone: Bit;
  stroke: Bit[];
  shadow: FieldBits;
  flip: FieldBits;
}
interface NumBits {
  neg?: Bit;
  digits: Array<{ bits: Bit[]; show: Bit }>;
}
interface FieldBits {
  bits: Bit[];
  inv: Bit[];
}

function numberOf(G: Gates, bus: Bit[], signed: boolean): NumBits {
  const { mag, neg } = signed ? G.abs(bus) : { mag: bus, neg: undefined };
  const digits = G.bcd(mag);
  // a digit shows when it or any higher digit is not 0; the units digit always shows
  const shows: Bit[] = [];
  let above: Bit = CONST0;
  for (let d = digits.length - 1; d >= 0; d--) {
    above = d === 0 ? CONST1 : G.or(above, G.orAll(digits[d]));
    shows[d] = above;
  }
  return {
    neg,
    digits: digits.map((bits, d) => ({
      bits,
      show: shows[d],
    })),
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** The lines of a decode, in value order. */
const hot = (m: Map<number, Bit>): Bit[] =>
  [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);

const fieldOf = (G: Gates, bus: Bit[]): FieldBits => ({
  bits: bus,
  inv: bus.map((x) => G.not(x)),
});

/** Placement bits of a signed coordinate: offset binary in [-OFFSET, OFFSET), and whether the
 * value is in that range (every bit above the window equals the window's top bit). */
function placeOf(G: Gates, bus: Bit[]): { bits: Bit[]; inRange: Bit } {
  const top = PLACE_BITS - 1;
  const same: Bit[] = [];
  for (let i = top; i + 1 < bus.length; i++)
    same.push(G.xnor(bus[i], bus[i + 1]));
  return {
    bits: bus.slice(0, PLACE_BITS).map((b, i) => (i === top ? G.not(b) : b)),
    inRange: G.andAll(same),
  };
}

/** A size saturated at 2^PLACE_BITS - 1 cells: the box never needs more to cover the window. */
function sizeOf(G: Gates, bus: Bit[]): Bit[] {
  const sat = G.orAll(bus.slice(PLACE_BITS));
  return bus.slice(0, PLACE_BITS).map((b) => G.or(b, sat));
}

function defineSlotDisp(lib: Library): SlotSrc {
  // only this slot's registers: an event that changes no field of the slot leaves all of it alone
  const b = new ModuleBuilder(lib, "SLOT_DISP", { in: { ...SLOT_FIELDS } });
  const G = new Gates(b);
  const f = (k: SlotField) => b.in(k);
  const vis = b.in1("vis");
  const px = placeOf(G, f("x"));
  const py = placeOf(G, f("y"));
  const kind = G.decode(f("kind").slice(0, 4), KINDS);
  const region = G.orAll([3, 4, 5].map((k) => kind.get(k)!));
  const fill = G.decode(
    f("fill"),
    Array.from({ length: 16 }, (_, i) => i),
  );
  const lines: SlotBits = {
    vin: G.andAll([vis, px.inRange, py.inRange]),
    vis,
    visN: G.not(vis),
    px: px.bits,
    py: py.bits,
    pw: sizeOf(G, f("w")),
    ph: sizeOf(G, f("h")),
    kind: Object.fromEntries(KINDS.map((k) => [k, kind.get(k)!])),
    canRadius: G.orAll([3, 4, 5, 6].map((k) => kind.get(k)!)),
    labelled: G.or(kind.get(3)!, kind.get(4)!),
    hasFill: G.not(kind.get(5)!),
    region,
    regionN: G.not(region),
    hasStroke: G.not(f("stroke")[4]),
    fill: Array.from({ length: 16 }, (_, i) => fill.get(i)!),
    x: numberOf(G, f("x"), true),
    y: numberOf(G, f("y"), true),
    w: numberOf(G, f("w"), false),
    h: numberOf(G, f("h"), false),
    id: numberOf(G, f("id"), false),
    opacity: hot(G.decode(f("opacity"), range(11))),
    radius: hot(G.decode(f("radius"), range(5))),
    strokeNone: f("stroke")[4],
    stroke: hot(G.decode(f("stroke"), range(16))),
    shadow: fieldOf(G, f("shadow")),
    flip: fieldOf(G, f("flip")),
  };
  const { src, width } = exportLines(b, lines);
  lib.set(
    "SLOT_DISP",
    b.build(
      "one layer slot's screen lines: placement, kind, fill, decimal digits",
    ),
  );
  return { src: src as SlotSrc["src"], width };
}
interface SlotSrc {
  src: Record<string, unknown>;
  width: number;
}

// ---------- DISP ----------

/** Defines SLOT_DISP and DISP in `lib` and places DISP as instance "disp" of the OS module, wired
 * to the register nets in `ins`. Returns where every screen line comes from, in OS scope. */
export function addDisplay(
  lib: Library,
  osName: string,
  ins: DisplayInputs,
): DisplayLines {
  const slot = defineSlotDisp(lib);
  const spec: Record<string, number> = {
    N: ins.n.length,
    SELR: ins.sel.length,
    TOOL: ins.tool.length,
    GFILL: ins.fill.length,
    TCREATE: 1,
    TSELECT: 1,
  };
  for (const g of PICK_NAMES) spec[`PICK_${g}`] = ins.pick[g].length;
  for (let i = 0; i < SLOTS; i++)
    for (const [k, w] of Object.entries(SLOT_FIELDS)) spec[`L${i}_${k}`] = w;
  const b = new ModuleBuilder(lib, "DISP", { in: spec });
  const G = new Gates(b);
  const nHot = G.decode(b.in("N"), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // used[i] = n > i, from the top down
  const used: Bit[] = [];
  let above: Bit = CONST0;
  for (let i = SLOTS - 1; i >= 0; i--) {
    above = G.or(above, nHot.get(i + 1)!);
    used[i] = above;
  }
  const selR = b.in("SELR");
  const neg = selR[selR.length - 1];
  const selHot = G.decode(selR.slice(0, 3), [0, 1, 2, 3, 4, 5, 6, 7]);
  const sel = Array.from({ length: SLOTS }, (_, i) =>
    G.and(G.not(neg), selHot.get(i)!),
  );
  const tool = b.in("TOOL");
  const toolLo = G.decode(
    tool.slice(0, 4),
    Array.from({ length: 16 }, (_, i) => i),
  );
  const notTop = G.not(tool[4]);
  const slots = Array.from({ length: SLOTS }, (_, i) => {
    const conn: Record<string, string[]> = {};
    for (const k of Object.keys(SLOT_FIELDS)) conn[k] = b.in(`L${i}_${k}`);
    const y = b.wire(`s${i}_y`, slot.width);
    b.use("SLOT_DISP", { ...conn, Y: y }, `s${i}`);
    // the slot's lines in DISP scope
    const scope = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(scope);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("y" in o && typeof o.y === "number") return y[o.y];
        if ("in" in o && typeof o.in === "string") {
          const m = /^(\w+?)(?:\[(\d+)\])?$/.exec(o.in)!;
          return conn[m[1]][m[2] ? Number(m[2]) : 0];
        }
        if ("k" in o) return o.k ? CONST1 : CONST0;
        return Object.fromEntries(
          Object.entries(o).map(([k, x]) => [k, scope(x)]),
        );
      }
      return v;
    };
    return { used: used[i], sel: sel[i], ...(scope(slot.src) as SlotBits) };
  });
  const lines = {
    n: Array.from({ length: 9 }, (_, v) => nHot.get(v)!),
    anySel: G.not(neg),
    selN: sel.map((x) => G.not(x)),
    noSel: neg,
    tool: Array.from({ length: 17 }, (_, v) =>
      v < 16 ? G.and(notTop, toolLo.get(v)!) : tool[4],
    ),
    fill: (() => {
      const h = G.decode(
        b.in("GFILL"),
        Array.from({ length: 16 }, (_, i) => i),
      );
      return Array.from({ length: 16 }, (_, i) => h.get(i)!);
    })(),
    tCreate: b.in1("TCREATE"),
    tSelect: b.in1("TSELECT"),
    pick: Object.fromEntries(
      PICK_NAMES.map((g) => {
        const h = G.decode(b.in(`PICK_${g}`), range(PICK_GROUPS[g].length));
        return [g, range(PICK_GROUPS[g].length).map((k) => h.get(k)!)];
      }),
    ),
    slots,
  };
  const { src, width } = exportLines(b, lines);
  lib.set(
    "DISP",
    b.build(
      "the screen decode: what every live layer of the Figma OS screen is bound to",
    ),
  );

  // place it in the OS module
  const os = lib.get(osName)!;
  const conn: Record<string, string[]> = {
    N: ins.n,
    SELR: ins.sel,
    TOOL: ins.tool,
    GFILL: ins.fill,
    TCREATE: [ins.tCreate],
    TSELECT: [ins.tSelect],
  };
  for (const g of PICK_NAMES) conn[`PICK_${g}`] = ins.pick[g];
  ins.slots.forEach((s, i) => {
    for (const k of Object.keys(SLOT_FIELDS) as SlotField[])
      conn[`L${i}_${k}`] = s[k];
  });
  const outNames: string[] = new Array(width);
  const nameOut = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => nameOut(x, `${path}${i}_`));
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if ("y" in o && typeof o.y === "number") {
        if (!outNames[o.y]) outNames[o.y] = `ui_${path.replace(/_$/, "")}`;
      } else if (!("in" in o) && !("k" in o))
        for (const [k, x] of Object.entries(o)) nameOut(x, `${path}${k}_`);
    }
  };
  nameOut(src, "");
  os.instances.push({
    name: "disp",
    cell: "DISP",
    conn: { ...conn, Y: outNames },
  });
  const toOs = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(toOs);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if ("y" in o && typeof o.y === "number") return { net: outNames[o.y] };
      if ("in" in o && typeof o.in === "string") {
        const m = /^(\w+?)(?:\[(\d+)\])?$/.exec(o.in)!;
        const net = conn[m[1]][m[2] ? Number(m[2]) : 0];
        return net === CONST0 ? { k: 0 } : net === CONST1 ? { k: 1 } : { net };
      }
      if ("k" in o) return { k: o.k };
      return Object.fromEntries(
        Object.entries(o).map(([k, x]) => [k, toOs(x)]),
      );
    }
    return v;
  };
  return toOs(src) as DisplayLines;
}
