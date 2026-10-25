// The binding engine (docs/OS-CPU-CONTRACT.md §4), the OS's "GPU": the gates never draw. A
// binding table maps a RAM byte, bit or bit range to one property of a named canvas layer. The
// plugin reads RAM after a batch of ticks, calls applyBindings() with the previous snapshot, and
// writes only the returned changes. The reverse direction, inputFromEvent(), turns a click on a
// named layer or a key into the byte the plugin pokes into the INPUT byte (RAM[14]).
// Pure and deterministic: no Figma API, no clock, no randomness.
import { RAM_BYTES } from "../isa/spec";

export const BIND_PROPS = ["visible", "x", "y", "text", "fill", "opacity"] as const;
export type BindProp = (typeof BIND_PROPS)[number];
export type BindValue = boolean | number | string;

/** Which RAM bits a binding reads: the whole byte, one bit, or bits lo..hi (inclusive, lo ≤ hi). */
export interface RamRef {
  addr: number;
  bit?: number;
  bits?: [number, number];
}

/** value = field * scale + offset (numeric props and text), or value = table[field]. */
export type BindMap = { scale: number; offset?: number } | { table: BindValue[] };

export interface Binding {
  ram: RamRef;
  /** Layer name on the canvas. */
  node: string;
  prop: BindProp;
  map?: BindMap;
}

export interface CanvasWrite {
  node: string;
  prop: BindProp;
  value: BindValue;
}

export type InputEvent = { type: "click"; node: string } | { type: "key"; key: string };

/** Event → input byte. 0 is reserved ("no input / consumed", §4), so mapped values are 1–255. */
export interface Keymap {
  click?: Record<string, number>;
  key?: Record<string, number>;
}

export class BindingError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid bindings: ${problems.join("; ")}`);
  }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Bit range [lo, hi] a ref reads. */
function rangeOf(ref: RamRef): [number, number] {
  if (ref.bit !== undefined) return [ref.bit, ref.bit];
  if (ref.bits) return ref.bits;
  return [0, 7];
}

/** The unsigned field a ref selects from RAM. */
export function fieldOf(ram: ArrayLike<number>, ref: RamRef): number {
  const [lo, hi] = rangeOf(ref);
  const byte = (ram[ref.addr] ?? 0) & 0xff;
  return (byte >> lo) & ((1 << (hi - lo + 1)) - 1);
}

/** Problems with one binding (empty when it is valid). `i` is used in messages. */
function problemsOf(b: unknown, i: number, ramBytes: number): string[] {
  const out: string[] = [];
  const at = `binding ${i}`;
  if (!isObj(b)) return [`${at} must be an object {ram, node, prop, map?}`];
  const who = typeof b.node === "string" && b.node ? `${at} (${b.node}.${String(b.prop)})` : at;
  if (typeof b.node !== "string" || !b.node) out.push(`${at}: "node" must be a layer name`);
  if (!BIND_PROPS.includes(b.prop as BindProp)) out.push(`${who}: "prop" must be one of ${BIND_PROPS.join(", ")}`);
  const r = b.ram;
  if (!isObj(r)) out.push(`${who}: "ram" must be {addr, bit?} or {addr, bits: [lo, hi]}`);
  else {
    if (!isInt(r.addr) || r.addr < 0 || r.addr >= ramBytes) out.push(`${who}: ram.addr ${JSON.stringify(r.addr)} is outside RAM (0–${ramBytes - 1})`);
    if (r.bit !== undefined && r.bits !== undefined) out.push(`${who}: give ram.bit or ram.bits, not both`);
    if (r.bit !== undefined && (!isInt(r.bit) || r.bit < 0 || r.bit > 7)) out.push(`${who}: ram.bit must be 0–7`);
    if (r.bits !== undefined) {
      const ok = Array.isArray(r.bits) && r.bits.length === 2 && r.bits.every((x) => isInt(x) && x >= 0 && x <= 7) && r.bits[0] <= r.bits[1];
      if (!ok) out.push(`${who}: ram.bits must be [lo, hi] with 0 ≤ lo ≤ hi ≤ 7`);
    }
  }
  const m = b.map;
  if (m !== undefined) {
    if (!isObj(m) || ("scale" in m) === ("table" in m)) out.push(`${who}: "map" must be {scale, offset?} or {table: [...]}`);
    else if ("scale" in m) {
      if (typeof m.scale !== "number" || !Number.isFinite(m.scale)) out.push(`${who}: map.scale must be a number`);
      if (m.offset !== undefined && (typeof m.offset !== "number" || !Number.isFinite(m.offset))) out.push(`${who}: map.offset must be a number`);
      if (b.prop === "visible" || b.prop === "fill") out.push(`${who}: ${b.prop} takes a {table}, not a scale`);
    } else {
      const t = m.table;
      if (!Array.isArray(t) || t.length === 0) out.push(`${who}: map.table must be a non-empty array`);
      else {
        const want: Record<BindProp, [string, (v: unknown) => boolean]> = {
          visible: ["booleans", (v) => typeof v === "boolean"],
          x: ["numbers", (v) => typeof v === "number" && Number.isFinite(v)],
          y: ["numbers", (v) => typeof v === "number" && Number.isFinite(v)],
          opacity: ["numbers 0–1", (v) => typeof v === "number" && v >= 0 && v <= 1],
          text: ["strings", (v) => typeof v === "string"],
          fill: ['colors "#rrggbb"', (v) => typeof v === "string" && HEX.test(v)],
        };
        const w = want[b.prop as BindProp];
        if (w && !t.every(w[1])) out.push(`${who}: map.table for ${b.prop} must hold ${w[0]}`);
      }
    }
  }
  return out;
}

/** Validates a binding table read from JSON. Never throws. */
export function validateBindings(bindings: unknown, ramBytes = RAM_BYTES): { bindings: Binding[]; errors: string[]; warnings: string[] } {
  if (!Array.isArray(bindings)) return { bindings: [], errors: ["bindings must be an array"], warnings: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  const good: Binding[] = [];
  bindings.forEach((b, i) => {
    const p = problemsOf(b, i, ramBytes);
    if (p.length) return errors.push(...p);
    const bb = b as Binding;
    good.push(bb);
    if (bb.map && "table" in bb.map) {
      const [lo, hi] = rangeOf(bb.ram);
      const n = 1 << (hi - lo + 1);
      if (bb.map.table.length < n)
        warnings.push(`binding ${i} (${bb.node}.${bb.prop}): table has ${bb.map.table.length} entries for a ${hi - lo + 1}-bit field (${n} values); larger values use the last entry`);
    }
  });
  return { bindings: good, errors, warnings };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The property value a binding produces from a RAM image. Without a map: visible = field ≠ 0,
 * x/y = field, opacity = field / max (so a 1-bit field is 0 or 1), text = decimal field,
 * fill = gray from black (0) to white (max). Opacity is clamped to 0–1. */
export function valueOf(ram: ArrayLike<number>, b: Binding): BindValue {
  const f = fieldOf(ram, b.ram);
  const [lo, hi] = rangeOf(b.ram);
  const max = (1 << (hi - lo + 1)) - 1;
  const m = b.map;
  if (m && "table" in m) {
    const v = m.table[Math.min(f, m.table.length - 1)];
    return b.prop === "opacity" ? clamp01(v as number) : v;
  }
  const scaled = m ? f * m.scale + (m.offset ?? 0) : f;
  switch (b.prop) {
    case "visible":
      return f !== 0;
    case "x":
    case "y":
      return scaled;
    case "opacity":
      return clamp01(m ? scaled : f / max);
    case "text":
      return String(scaled);
    case "fill": {
      const g = Math.round((f * 255) / max)
        .toString(16)
        .padStart(2, "0");
      return `#${g}${g}${g}`;
    }
  }
}

/** Final value per node.prop for a RAM image. When several bindings target the same node.prop,
 * the last one wins. Keys keep first-appearance order, so the result is deterministic. */
function evaluate(ram: ArrayLike<number>, bindings: readonly Binding[]): Map<string, CanvasWrite> {
  const out = new Map<string, CanvasWrite>();
  for (const b of bindings) {
    const key = `${b.node}\u0000${b.prop}`;
    const w = { node: b.node, prop: b.prop, value: valueOf(ram, b) };
    if (out.has(key)) out.get(key)!.value = w.value;
    else out.set(key, w);
  }
  return out;
}

/** Canvas writes that bring the layers from `previous` RAM to `ram`: one write per node.prop
 * whose value changed, in binding order. Without `previous`, every bound property is written
 * (the initial sync). Throws BindingError if the table is invalid (validate it once at load). */
export function applyBindings(ram: ArrayLike<number>, bindings: readonly Binding[], previous?: ArrayLike<number>): CanvasWrite[] {
  const { errors } = validateBindings(bindings, Math.max(RAM_BYTES, ram.length));
  if (errors.length) throw new BindingError(errors);
  const now = evaluate(ram, bindings);
  if (!previous) return [...now.values()];
  const before = evaluate(previous, bindings);
  return [...now.entries()].filter(([k, w]) => before.get(k)?.value !== w.value).map(([, w]) => w);
}

/** The input byte for a canvas event, or null if the keymap does not map it (or maps it to an
 * invalid byte). Clicks are matched by layer name, keys by KeyboardEvent.key, both exactly. */
export function inputFromEvent(event: InputEvent, keymap: Keymap): number | null {
  const table = event.type === "click" ? keymap.click : keymap.key;
  const name = event.type === "click" ? event.node : event.key;
  if (!table || !Object.prototype.hasOwnProperty.call(table, name)) return null;
  const v = table[name];
  return isInt(v) && v >= 1 && v <= 255 ? v : null;
}

/** Validates a keymap read from JSON. Never throws. */
export function validateKeymap(keymap: unknown): string[] {
  if (keymap === undefined) return [];
  if (!isObj(keymap)) return ["keymap must be {click?: {layer: byte}, key?: {key: byte}}"];
  const out: string[] = [];
  for (const kind of ["click", "key"] as const) {
    const t = keymap[kind];
    if (t === undefined) continue;
    if (!isObj(t)) {
      out.push(`keymap.${kind} must be an object`);
      continue;
    }
    for (const [k, v] of Object.entries(t))
      if (!isInt(v) || v < 1 || v > 255) out.push(`keymap.${kind}["${k}"] = ${JSON.stringify(v)}: input bytes are 1–255 (0 means "no input")`);
  }
  for (const k of Object.keys(keymap)) if (k !== "click" && k !== "key") out.push(`keymap has unknown field "${k}"`);
  return out;
}

/** A bindings file: {bindings: [...], keymap?: {...}}. Never throws. */
export function parseBindingsFile(json: unknown, ramBytes = RAM_BYTES): { bindings: Binding[]; keymap: Keymap; errors: string[]; warnings: string[] } {
  if (!isObj(json)) return { bindings: [], keymap: {}, errors: ["bindings file must be an object {bindings, keymap?}"], warnings: [] };
  const v = validateBindings(json.bindings, ramBytes);
  const kErr = validateKeymap(json.keymap);
  return { bindings: v.bindings, keymap: kErr.length ? {} : ((json.keymap as Keymap) ?? {}), errors: [...v.errors, ...kErr], warnings: v.warnings };
}
