// Canvas naming conventions (SILICON.md §8). Drawing, extraction and binding all go through
// these helpers, so the canvas contract lives in one place:
//   gate main components   gate/AND … gate/BUF   (pins pin/A pin/B pin/Y, hidden layer `lit`)
//   module main components cell/<NAME>
//   port markers           port/<in|out>/<NAME>/<width>
//   wires                  wire/<net>  and the hidden highlight copy  wire/<net>/lit
//   TEXT properties        one per port, value = parent nets LSB first, e.g. "D[0:7]" or "a, b"
import { GATE_PREFIX, GATE_TYPES, type GateType, type PortDef } from "../netlist/types";

export const PAGE_GATES = "Silicon · Gates";
export const PAGE_CELLS = "Silicon · Cells";
export const PAGE_CPU = "Silicon · CPU";

export const CELL_PREFIX = "cell/";
export const PIN_PREFIX = "pin/";
export const PORT_PREFIX = "port/";
export const WIRE_PREFIX = "wire/";
export const LIT = "lit";
export const LIT_SUFFIX = "/lit";

export const gateComponentName = (t: GateType) => `${GATE_PREFIX}${t}`;
export const cellComponentName = (module: string) => `${CELL_PREFIX}${module}`;
export const wireName = (net: string) => `${WIRE_PREFIX}${net}`;
export const wireLitName = (net: string) => `${WIRE_PREFIX}${net}${LIT_SUFFIX}`;
export const pinName = (port: string) => `${PIN_PREFIX}${port}`;

/** The netlist cell a main component stands for: "gate/AND" → "gate/AND", "cell/DFF" → "DFF".
 * Anything else (decorations, foreign components) → null. */
export function cellOfComponent(componentName: string): string | null {
  if (componentName.startsWith(GATE_PREFIX)) {
    const t = componentName.slice(GATE_PREFIX.length);
    return (GATE_TYPES as readonly string[]).includes(t) ? componentName : null;
  }
  if (componentName.startsWith(CELL_PREFIX) && componentName.length > CELL_PREFIX.length)
    return componentName.slice(CELL_PREFIX.length);
  return null;
}

export const portMarkerName = (p: PortDef) => `${PORT_PREFIX}${p.dir}/${p.name}/${p.width}`;

const MARKER_RE = /^port\/(in|out)\/([A-Za-z_]\w*)\/([1-9]\d*)$/;

/** Parses a port marker layer name back into its PortDef (null if it isn't one). */
export function parsePortMarker(name: string): PortDef | null {
  const m = MARKER_RE.exec(name);
  return m ? { name: m[2], dir: m[1] as PortDef["dir"], width: Number(m[3]) } : null;
}

/** Local net name of a wire highlight layer: "wire/b0_Q/lit" → "b0_Q" (null otherwise). */
export function wireLitNet(layerName: string): string | null {
  return layerName.startsWith(WIRE_PREFIX) && layerName.endsWith(LIT_SUFFIX) && layerName.length > WIRE_PREFIX.length + LIT_SUFFIX.length
    ? layerName.slice(WIRE_PREFIX.length, -LIT_SUFFIX.length)
    : null;
}

/** Figma returns TEXT/BOOLEAN property keys as "NAME#12:3"; the port name is the part before '#'. */
export function propName(key: string): string {
  const i = key.lastIndexOf("#");
  return i < 0 ? key : key.slice(0, i);
}

const BIT_RE = /^(.+)\[(\d+)\]$/;
const RANGE_RE = /^(.+)\[(\d+):(\d+)\]$/;

/** Net list → property text, LSB first. Runs of consecutive bits of one bus collapse to the
 * range shorthand: ["D[0]", "D[1]", "D[2]", "x", "0"] → "D[0:2], x, 0". Descending runs
 * (["Q[3]", "Q[2]"]) become "Q[3:2]". */
export function formatNets(nets: readonly string[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < nets.length) {
    const m = BIT_RE.exec(nets[i]);
    if (m) {
      const base = m[1];
      const start = Number(m[2]);
      let j = i + 1;
      let step = 0;
      while (j < nets.length) {
        const n = BIT_RE.exec(nets[j]);
        if (!n || n[1] !== base) break;
        const d = Number(n[2]) - Number(BIT_RE.exec(nets[j - 1])![2]);
        if (step === 0 && (d === 1 || d === -1)) step = d;
        if (d !== step) break;
        j++;
      }
      if (j - i >= 2) {
        parts.push(`${base}[${start}:${start + step * (j - i - 1)}]`);
        i = j;
        continue;
      }
    }
    parts.push(nets[i]);
    i++;
  }
  return parts.join(", ");
}

/** Property text → net list (inverse of formatNets). Whitespace and empty items are ignored,
 * so "a,b" and "a, b," both read as ["a", "b"]; "" reads as no nets (unconnected). */
export function parseNets(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const r = RANGE_RE.exec(item);
    if (r) {
      const [a, b] = [Number(r[2]), Number(r[3])];
      const step = b >= a ? 1 : -1;
      for (let k = a; ; k += step) {
        out.push(`${r[1]}[${k}]`);
        if (k === b) break;
      }
    } else out.push(item);
  }
  return out;
}
