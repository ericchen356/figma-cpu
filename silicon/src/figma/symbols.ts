// The eight primitive gates as Figma main components on "Silicon · Gates": an ANSI symbol
// (SVG → vectors), pin markers pin/A pin/B pin/Y, TEXT properties A B Y holding net names
// (shown as tiny labels on the leads), and a hidden bright `lit` copy of the symbol that the
// prototype compiler binds to the output net (visible = Y is 1).
import { GATE_ARITY, GATE_TYPES, type GateType, gatePorts } from "../netlist/types";
import { type CellGeom, type LabelAnchor, type Pin } from "./layout";
import { gateComponentName, LIT, pinName } from "./names";
import { addText, C, loadFonts, solid, unwrapSvg } from "./style";

export const GATE_W = 96;
export const GATE_H = 48;
/** Pin heights: 2-input gates take A/B at 16/32, 1-input gates A at 24; Y is always at 24. */
const PIN_Y: Record<string, number> = { A: 16, B: 32, Y: 24 };
const PIN_Y1: Record<string, number> = { A: 24, Y: 24 };
export const NET_LABEL_SIZE = 7;

/** Gate geometry for the layout (pins on the 8 px grid). */
export function gateGeom(type: GateType): CellGeom {
  const ports = gatePorts(type);
  const ys = GATE_ARITY[type] === 1 ? PIN_Y1 : PIN_Y;
  const pins = new Map<string, Pin>();
  for (const p of ports) pins.set(p.name, { x: p.dir === "in" ? 0 : GATE_W, y: ys[p.name], dir: p.dir });
  const outLabels = new Map<string, LabelAnchor>([["Y", { x: outLead(type) + 2, y: 14, h: 9, size: NET_LABEL_SIZE }]]);
  return { w: GATE_W, h: GATE_H, ports, pins, outLabels };
}

// ---------- ANSI symbols, drawn in a 96×48 box ----------

const bubble = (cx: number) => `M ${cx + 4} 24 A 4 4 0 1 1 ${cx - 4} 24 A 4 4 0 1 1 ${cx + 4} 24 Z`;
const AND_BODY = "M 24 6 L 48 6 A 18 18 0 0 1 48 42 L 24 42 Z";
const OR_BODY = "M 22 6 Q 52 6 68 24 Q 52 42 22 42 Q 32 24 22 6 Z";
const BUF_BODY = "M 26 8 L 62 24 L 26 40 Z";

/** Closed outline (filled). */
function body(t: GateType): string {
  switch (t) {
    case "AND":
      return AND_BODY;
    case "NAND":
      return `${AND_BODY} ${bubble(70)}`;
    case "OR":
    case "XOR":
      return OR_BODY;
    case "NOR":
    case "XNOR":
      return `${OR_BODY} ${bubble(72)}`;
    case "BUF":
      return BUF_BODY;
    case "NOT":
      return `${BUF_BODY} ${bubble(66)}`;
  }
}

/** x where the output lead starts (tip of the body or bubble). */
function outLead(t: GateType): number {
  return { AND: 66, NAND: 74, OR: 68, XOR: 68, NOR: 76, XNOR: 76, BUF: 62, NOT: 70 }[t];
}

/** x of a 2-input body's back edge at the input heights (OR's curve, XOR's extra arc). */
const BACK_EDGE: Partial<Record<GateType, number>> = { AND: 24, NAND: 24, OR: 26, NOR: 26, XOR: 20, XNOR: 20 };

/** Open strokes: input leads up to the body's back edge, the output lead, XOR's extra arc. */
function leads(t: GateType): string {
  const out = `M ${outLead(t)} 24 L 96 24`;
  if (GATE_ARITY[t] === 1) return `M 0 24 L 26 24 ${out}`;
  const back = BACK_EDGE[t] ?? 24;
  const arc = t === "XOR" || t === "XNOR" ? " M 16 6 Q 26 24 16 42" : "";
  return `M 0 16 L ${back} 16 M 0 32 L ${back} 32 ${out}${arc}`;
}

const svgDoc = (paths: string) =>
  `<svg width="${GATE_W}" height="${GATE_H}" viewBox="0 0 ${GATE_W} ${GATE_H}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;

export function gateSymbolSvg(t: GateType): string {
  return svgDoc(
    `<path d="${body(t)}" fill="${C.cell}" stroke="${C.gate}" stroke-width="1.5"/>` +
      `<path d="${leads(t)}" fill="none" stroke="${C.lead}" stroke-width="1.5"/>`,
  );
}

/** The highlight: body and output lead in the "lit" color. */
export function gateLitSvg(t: GateType): string {
  return svgDoc(
    `<path d="${body(t)} M ${outLead(t)} 24 L 96 24" fill="${C.lit}" fill-opacity="0.22" stroke="${C.lit}" stroke-width="2"/>`,
  );
}

const DOC: Record<GateType, string> = {
  BUF: "Buffer. Y = A",
  NOT: "Inverter. Y = ¬A",
  AND: "Y = A·B",
  OR: "Y = A + B",
  NAND: "Y = ¬(A·B)",
  NOR: "Y = ¬(A + B)",
  XOR: "Y = A ⊕ B",
  XNOR: "Y = ¬(A ⊕ B)",
};

export interface GateOptions {
  /** Net-name labels on the leads (3 text layers per gate). Default true. */
  labels?: boolean;
  /** Replace existing gate components (instances of the old ones are left orphaned). */
  redraw?: boolean;
}

/** Draws (or finds) the gate main components on `page`. Returns them by gate type. */
export async function drawGates(page: PageNode, opts: GateOptions = {}): Promise<Map<GateType, ComponentNode>> {
  await figma.setCurrentPageAsync(page);
  await loadFonts();
  const out = new Map<GateType, ComponentNode>();
  const existing = new Map<string, ComponentNode>();
  for (const n of page.children) if (n.type === "COMPONENT") existing.set(n.name, n);
  GATE_TYPES.forEach((t, i) => {
    const name = gateComponentName(t);
    const old = existing.get(name);
    if (old && !opts.redraw) {
      out.set(t, old);
      return;
    }
    const x = old ? old.x : i * (GATE_W + 48);
    const y = old ? old.y : 0;
    if (old) old.remove();
    const comp = drawGate(t, opts.labels !== false);
    page.appendChild(comp);
    comp.x = x;
    comp.y = y;
    out.set(t, comp);
  });
  return out;
}

function drawGate(t: GateType, labels: boolean): ComponentNode {
  const comp = figma.createComponent();
  comp.name = gateComponentName(t);
  comp.resize(GATE_W, GATE_H);
  comp.fills = [];
  comp.clipsContent = false;
  comp.description = DOC[t];
  const [b, l] = unwrapSvg(comp, gateSymbolSvg(t));
  b.name = "body";
  if (l) l.name = "leads";
  const [lit] = unwrapSvg(comp, gateLitSvg(t));
  lit.name = LIT;
  lit.visible = false;
  const geom = gateGeom(t);
  for (const p of geom.ports) {
    const pin = geom.pins.get(p.name)!;
    const r = figma.createRectangle();
    comp.appendChild(r);
    r.name = pinName(p.name);
    r.resize(4, 4);
    r.x = pin.x - 2;
    r.y = pin.y - 2;
    r.cornerRadius = 1;
    r.fills = solid(C.lead);
  }
  for (const p of geom.ports) {
    const key = comp.addComponentProperty(p.name, "TEXT", p.name);
    if (!labels) continue;
    const pin = geom.pins.get(p.name)!;
    const x = p.dir === "in" ? 2 : outLead(t) + 2;
    const txt = addText(comp, `label/${p.name}`, p.name, x, pin.y - 10, { size: NET_LABEL_SIZE, font: "mono", color: C.dim });
    txt.componentPropertyReferences = { characters: key };
  }
  return comp;
}
