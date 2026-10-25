// Look and small node helpers of the Live dashboard (lane L1): a Figma-like dark UI (canvas
// #1E1E1E, chrome #2C2C2C, Figma's own accent colors), Inter for UI text and Roboto Mono for
// numbers and net names. Every helper takes the Plugin API object (never the `figma` global),
// so the dashboard draws against the fake API in tests. Nothing here is computed at run time:
// a lit layer is just a hidden copy whose `visible` gets bound to an existing net variable.

export const L = {
  /** Canvas behind everything. */
  bg: "#1E1E1E",
  /** Top bar and side panels. */
  chrome: "#2C2C2C",
  /** Cards on the canvas. */
  card: "#252525",
  /** Blocks inside cards. */
  block: "#2F2F2F",
  /** Grid cells, inputs. */
  cell: "#333333",
  line: "#383838",
  line2: "#4A4A4A",
  text: "#FFFFFF",
  text2: "#B3B3B3",
  text3: "#7C7C7C",
  /** A lamp that is off. */
  off: "#3D3D3D",
  /** Figma's selection blue: microcode row / column highlights. */
  blue: "#0D99FF",
  // Signal categories (Figma's brand colors).
  drive: "#FFC700", // drives the bus
  load: "#1ABCFE", // loads from the bus
  mem: "#A259FF", // memory
  alu: "#0ACF83", // ALU, flags
  out: "#F24E1E", // output port, 7-segment
  ctrl: "#FF7262", // control unit
  ptr: "#FF24BD", // a register used as an address (LDR, LDRI, STR)
  /** Register bits. */
  bit: "#0ACF83",
  segOff: "#3A2420",
  display: "#141414",
};

export function rgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function solid(hex: string, opacity = 1): SolidPaint[] {
  return [{ type: "SOLID", color: rgb(hex), opacity }];
}

// ---------- fonts ----------

export interface LiveFonts {
  regular: FontName;
  medium: FontName;
  semibold: FontName;
  bold: FontName;
  mono: FontName;
  monoBold: FontName;
}

/** Loads the dashboard's fonts, each with a fallback (Inter Regular / Bold always exist in
 * Figma; Roboto Mono falls back to Inter). Also covers the fonts lane E's cells use, so
 * setting the TEXT properties of a cell instance (its port labels) works. */
export async function loadLiveFonts(api: PluginAPI): Promise<LiveFonts> {
  const tryLoad = async (want: FontName[], fallback: FontName): Promise<FontName> => {
    for (const f of want) {
      try {
        await api.loadFontAsync(f);
        return f;
      } catch {
        /* next */
      }
    }
    await api.loadFontAsync(fallback);
    return fallback;
  };
  const regular: FontName = { family: "Inter", style: "Regular" };
  const bold: FontName = { family: "Inter", style: "Bold" };
  await api.loadFontAsync(regular);
  await api.loadFontAsync(bold);
  const medium = await tryLoad([{ family: "Inter", style: "Medium" }], regular);
  const semibold = await tryLoad([{ family: "Inter", style: "Semi Bold" }], bold);
  const mono = await tryLoad([{ family: "Roboto Mono", style: "Regular" }], regular);
  const monoBold = await tryLoad([{ family: "Roboto Mono", style: "Bold" }, { family: "Roboto Mono", style: "Medium" }], mono);
  return { regular, medium, semibold, bold, mono, monoBold };
}

/** What every drawing helper needs. */
export interface Ctx {
  api: PluginAPI;
  fonts: LiveFonts;
}

type Parent = BaseNode & ChildrenMixin;

/** Places `child` inside `parent` at (x, y). */
export function put<T extends SceneNode>(parent: Parent, child: T, x: number, y: number): T {
  parent.appendChild(child);
  child.x = Math.round(x * 2) / 2;
  child.y = Math.round(y * 2) / 2;
  return child;
}

export interface BoxOpts {
  fill?: string | null;
  fillOpacity?: number;
  radius?: number;
  stroke?: string;
  strokeWeight?: number;
  clip?: boolean;
}

/** A frame (fill, optional stroke and radius). Frames are what carries reactions and lit children. */
export function frame(ctx: Ctx, parent: Parent, name: string, x: number, y: number, w: number, h: number, o: BoxOpts = {}): FrameNode {
  const f = ctx.api.createFrame();
  f.name = name;
  f.resize(Math.max(1, w), Math.max(1, h));
  f.fills = o.fill ? solid(o.fill, o.fillOpacity ?? 1) : [];
  if (o.radius) f.cornerRadius = o.radius;
  if (o.stroke) {
    f.strokes = solid(o.stroke);
    f.strokeWeight = o.strokeWeight ?? 1;
  }
  f.clipsContent = o.clip ?? false;
  return put(parent, f, x, y);
}

/** A rectangle. */
export function rect(ctx: Ctx, parent: Parent, name: string, x: number, y: number, w: number, h: number, o: BoxOpts = {}): RectangleNode {
  const r = ctx.api.createRectangle();
  r.name = name;
  r.resize(Math.max(1, w), Math.max(1, h));
  r.fills = o.fill ? solid(o.fill, o.fillOpacity ?? 1) : [];
  if (o.radius) r.cornerRadius = o.radius;
  if (o.stroke) {
    r.strokes = solid(o.stroke);
    r.strokeWeight = o.strokeWeight ?? 1;
  }
  return put(parent, r, x, y);
}

export interface TextOpts {
  size?: number;
  font?: keyof LiveFonts;
  color?: string;
  name?: string;
  /** Fixed width (the text wraps and grows in height); default: auto width. */
  w?: number;
  /** Fixed height too (with `w`); e.g. to center vertically. */
  h?: number;
  align?: "LEFT" | "CENTER" | "RIGHT";
  valign?: "TOP" | "CENTER" | "BOTTOM";
  /** Letter spacing, percent. */
  tracking?: number;
  /** Line height, px. */
  lineHeight?: number;
  opacity?: number;
}

/** A text layer (fonts must be loaded, see loadLiveFonts). */
export function text(ctx: Ctx, parent: Parent, chars: string, x: number, y: number, o: TextOpts = {}): TextNode {
  const t = ctx.api.createText();
  t.fontName = ctx.fonts[o.font ?? "regular"];
  t.fontSize = o.size ?? 12;
  if (o.lineHeight) t.lineHeight = { value: o.lineHeight, unit: "PIXELS" };
  if (o.tracking) t.letterSpacing = { value: o.tracking, unit: "PERCENT" };
  t.characters = chars;
  t.fills = solid(o.color ?? L.text, o.opacity ?? 1);
  t.name = o.name ?? (chars.slice(0, 40) || "text");
  if (o.align) t.textAlignHorizontal = o.align;
  if (o.valign) t.textAlignVertical = o.valign;
  if (o.w) {
    t.resize(o.w, o.h ?? Math.max(1, t.height));
    t.textAutoResize = o.h ? "NONE" : "HEIGHT";
  }
  return put(parent, t, x, y);
}

/** Section header in a side panel: small, uppercase, dim, tracked out. */
export function header(ctx: Ctx, parent: Parent, label: string, x: number, y: number): TextNode {
  return text(ctx, parent, label.toUpperCase(), x, y, { size: 10, font: "semibold", color: L.text2, tracking: 6, name: `header/${label}` });
}

/** A soft glow (drop shadow without offset). Cosmetic: ignored where effects are unsupported. */
export function glow(node: SceneNode, hex: string, radius = 8, alpha = 0.6): void {
  try {
    const c = rgb(hex);
    (node as BlendMixin).effects = [
      { type: "DROP_SHADOW", color: { ...c, a: alpha }, offset: { x: 0, y: 0 }, radius, spread: 0, visible: true, blendMode: "NORMAL" },
    ];
  } catch {
    /* cosmetic */
  }
}

// ---------- vectors ----------

export type Pt = [number, number];

const num = (v: number) => String(Math.round(v * 100) / 100);

/** A vector from polylines (stroked) and closed polygons (filled), placed so its path data
 * starts at (0, 0) like lane E's wires. Returns the vector at its page-relative spot. */
export function vector(
  ctx: Ctx,
  parent: Parent,
  name: string,
  lines: Pt[][],
  polys: Pt[][],
  color: string,
  weight: number,
  o: { dash?: number[]; opacity?: number } = {},
): VectorNode {
  const all = [...lines.flat(), ...polys.flat()];
  const x0 = Math.min(...all.map((p) => p[0]));
  const y0 = Math.min(...all.map((p) => p[1]));
  const d = (pts: Pt[], close: boolean) =>
    pts.map((p, i) => `${i ? "L" : "M"} ${num(p[0] - x0)} ${num(p[1] - y0)}`).join(" ") + (close ? " Z" : "");
  const paths: VectorPath[] = [];
  if (lines.length) paths.push({ windingRule: "NONE", data: lines.map((l) => d(l, false)).join(" ") });
  if (polys.length) paths.push({ windingRule: "NONZERO", data: polys.map((p) => d(p, true)).join(" ") });
  const v = ctx.api.createVector();
  v.name = name;
  v.vectorPaths = paths;
  v.strokes = solid(color, o.opacity ?? 1);
  v.strokeWeight = weight;
  v.strokeJoin = "ROUND";
  v.strokeCap = "ROUND";
  v.fills = polys.length ? solid(color, o.opacity ?? 1) : [];
  if (o.dash) v.dashPattern = o.dash;
  return put(parent, v, x0, y0);
}

/** Arrowhead triangle at the end of a polyline (pointing along its last segment). */
export function arrowHead(pts: Pt[], size = 7): { line: Pt[]; head: Pt[] } {
  const [ax, ay] = pts[pts.length - 2];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const base: Pt = [bx - ux * size, by - uy * size];
  const half = size * 0.6;
  const head: Pt[] = [
    [bx, by],
    [base[0] - uy * half, base[1] + ux * half],
    [base[0] + uy * half, base[1] - ux * half],
  ];
  return { line: [...pts.slice(0, -1), base], head };
}
