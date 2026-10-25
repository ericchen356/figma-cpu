// Building blocks of the dashboard: lamps, tags, arrows, buttons. Each lit thing is a
// container named after what lights it (names.ts) with a hidden child `lit`; bindDashboard
// binds that child's visibility. A container costs 2 layers (lamp) to 5 (arrow with label).
import { arrowHead, type Ctx, frame, glow, L, put, type Pt, rect, text, vector } from "./style";
import { bound, type NetKind } from "./names";

type Parent = BaseNode & ChildrenMixin;

export interface LampOpts {
  /** Corner radius (default: a rounded square, size / 4); size / 2 for a round lamp. */
  radius?: number;
  off?: string;
  /** Container kind (default "lamp"; "seg" for 7-segment bars). */
  kind?: NetKind;
  w?: number;
  h?: number;
}

/** A lamp: a dark tile with a bright `lit` copy whose visibility follows `net`. */
export function lamp(ctx: Ctx, parent: Parent, net: string, x: number, y: number, size: number, color: string, o: LampOpts = {}): FrameNode {
  const w = o.w ?? size;
  const h = o.h ?? size;
  const radius = o.radius ?? Math.max(1, Math.round(Math.min(w, h) / 4));
  const f = frame(ctx, parent, bound(o.kind ?? "lamp", net), x, y, w, h, { fill: o.off ?? L.off, radius });
  const lit = rect(ctx, f, "lit", 0, 0, w, h, { fill: color, radius });
  lit.visible = false;
  return f;
}

/** A row of lamps for the bits of a probe, MSB on the left (nets[0] is the MSB). */
export function lampRow(ctx: Ctx, parent: Parent, nets: string[], x: number, y: number, size: number, pitch: number, color: string, o: LampOpts = {}): FrameNode[] {
  return nets.map((n, i) => lamp(ctx, parent, n, x + i * pitch, y, size, color, o));
}

/** Bit nets of a probe, MSB first: ("pc", 4) → pc[3] pc[2] pc[1] pc[0]. */
export const bitsMsbFirst = (name: string, width: number) =>
  width === 1 ? [name] : Array.from({ length: width }, (_, i) => `${name}[${width - 1 - i}]`);

export interface TagOpts {
  w?: number;
  h?: number;
  size?: number;
  /** Container name (default tag/<net>). */
  name?: string;
  /** Text color of the lit tag (default: near-black on the bright fill). */
  litText?: string;
  outline?: boolean;
}

/** A pill label: dim outline normally, filled with `color` while `net` is 1. */
export function tag(ctx: Ctx, parent: Parent, net: string, label: string, x: number, y: number, color: string, o: TagOpts = {}): FrameNode {
  const size = o.size ?? 9;
  const h = o.h ?? 18;
  const w = o.w ?? Math.ceil(label.length * size * 0.62) + 14;
  const f = frame(ctx, parent, o.name ?? bound("tag", net), x, y, w, h, {
    fill: null,
    radius: h / 2,
    ...(o.outline === false ? {} : { stroke: L.line2 }),
  });
  text(ctx, f, label, 0, 0, { size, font: "mono", color: L.text3, w, h, align: "CENTER", valign: "CENTER", name: "label" });
  const lit = frame(ctx, f, "lit", 0, 0, w, h, { fill: color, radius: h / 2 });
  text(ctx, lit, label, 0, 0, { size, font: "monoBold", color: o.litText ?? "#111111", w, h, align: "CENTER", valign: "CENTER", name: "label" });
  lit.visible = false;
  return f;
}

export interface ArrowOpts {
  label?: string;
  /** Label position relative to the first point (default: above the middle of the first segment). */
  labelAt?: Pt;
  weight?: number;
  /** Container name (default arrow/<net>). A static arrow (no `lit`) when `net` is null. */
  name?: string;
  head?: boolean;
}

/** A transfer arrow along `pts` (parent coordinates): a dim line, and a bright, glowing `lit`
 * copy shown while `net` is 1. The container sits at the points' bounding box. */
export function arrow(ctx: Ctx, parent: Parent, net: string | null, pts: Pt[], color: string, o: ArrowOpts = {}): FrameNode {
  const pad = 10;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + pad;
  const h = Math.max(...ys) - y0 + pad;
  const name = o.name ?? (net ? bound("arrow", net) : "link");
  const f = frame(ctx, parent, name, x0, y0, w, h, { fill: null });
  const local = pts.map(([x, y]): Pt => [x - x0, y - y0]);
  const { line, head } = o.head === false ? { line: local, head: [] as Pt[] } : arrowHead(local, 7);
  vector(ctx, f, "line", [line], head.length ? [head] : [], net ? L.line2 : L.text3, o.weight ?? 1.5);
  const labelPos = (): Pt => {
    if (o.labelAt) return [local[0][0] + o.labelAt[0], local[0][1] + o.labelAt[1]];
    const [a, b] = [local[0], local[1]];
    return [Math.min(a[0], b[0]) + 2, Math.min(a[1], b[1]) - 13];
  };
  if (o.label) {
    const [lx, ly] = labelPos();
    text(ctx, f, o.label, lx, ly, { size: 8, font: "mono", color: L.text3, name: "label" });
  }
  if (!net) return f;
  const lit = frame(ctx, f, "lit", 0, 0, w, h, { fill: null });
  const v = vector(ctx, lit, "line", [line], head.length ? [head] : [], color, (o.weight ?? 1.5) + 1.5);
  glow(v, color, 6, 0.7);
  if (o.label) {
    const [lx, ly] = labelPos();
    text(ctx, lit, o.label, lx, ly, { size: 8, font: "monoBold", color, name: "label" });
  }
  lit.visible = false;
  return f;
}

/** A button (a frame carrying reactions) with an icon glyph and a label. */
export function button(ctx: Ctx, parent: Parent, name: string, label: string, x: number, y: number, w: number, h: number, color: string, o: { icon?: string; outline?: boolean } = {}): FrameNode {
  const f = frame(ctx, parent, name, x, y, w, h, o.outline ? { fill: L.cell, radius: 6, stroke: L.line2 } : { fill: color, radius: 6 });
  const fg = o.outline ? L.text : "#FFFFFF";
  const chars = o.icon ? `${o.icon}  ${label}` : label;
  text(ctx, f, chars, 0, 0, { size: 12, font: "semibold", color: fg, w, h, align: "CENTER", valign: "CENTER", name: "label" });
  return f;
}

/** A block of the datapath: a rounded card with a title and an optional subtitle. */
export function block(ctx: Ctx, parent: Parent, name: string, title: string, x: number, y: number, w: number, h: number, sub?: string, accent?: string): FrameNode {
  const f = frame(ctx, parent, `block/${name}`, x, y, w, h, { fill: L.block, radius: 8, stroke: L.line });
  if (accent) rect(ctx, f, "accent", 0, 10, 3, Math.max(8, h - 20), { fill: accent, radius: 1.5 });
  text(ctx, f, title, 12, 8, { size: 11, font: "bold", color: L.text, name: "title" });
  if (sub) text(ctx, f, sub, 12, 23, { size: 8.5, color: L.text3, name: "subtitle" });
  return f;
}

/** Bit-index labels under a lamp row (MSB first), as ONE monospace text whose letter spacing
 * matches the lamp pitch (Roboto Mono advances 0.6 em per character). */
export function bitLabels(ctx: Ctx, parent: Parent, width: number, x: number, y: number, pitch: number, size: number): TextNode {
  const fs = 7;
  const chars = Array.from({ length: width }, (_, i) => String((width - 1 - i) % 10)).join("");
  const t = text(ctx, parent, chars, x + size / 2 - (fs * 0.6) / 2, y, { size: fs, font: "mono", color: L.text3, name: "bits" });
  try {
    t.letterSpacing = { value: pitch - fs * 0.6, unit: "PIXELS" };
  } catch {
    /* cosmetic */
  }
  return t;
}

export { put };
