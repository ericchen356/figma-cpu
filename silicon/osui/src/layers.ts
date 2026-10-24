// Captured os-ui layers → Figma nodes. The capture (osui/capture) records every painted box, text
// line, SVG and image of the rendered page with absolute geometry; this creates the same layers,
// parent-relative, with only properties a Figma node has: fills, per-side strokes, corner radii,
// shadows, opacity, blend, clipping, rotation, text style, SVG markup and image fills.

/** A colour as captured: hex plus alpha. */
export interface Rgba {
  hex: string;
  a?: number;
}
export interface Shadow {
  type: "DROP_SHADOW" | "INNER_SHADOW";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: Rgba | null;
}
export interface Layer {
  id: number;
  type: "FRAME" | "RECTANGLE" | "ELLIPSE" | "TEXT" | "SVG";
  parent: number | null;
  name: string;
  /** Absolute page coordinates (px). */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  fills?: Array<{ type: string; hex?: string; a?: number; css?: string }>;
  strokes?: { color: Rgba; align: string; weights: number[]; dash?: string };
  radius?:
    | number
    | Array<number | { rx: number; ry: number }>
    | { rx: number; ry: number };
  effects?: Shadow[];
  opacity?: number;
  blend?: string;
  clips?: boolean;
  scroll?: boolean;
  svg?: string;
  svgUrl?: string | null;
  image?: { png?: string; fit?: string; natural?: number[] };
  outline?: { w: number; style: string; color: Rgba | null; offset: number };
  filterShadow?: string;
  text?: {
    chars: string;
    family: string;
    weight: number;
    size: number;
    lineHeight: number;
    letterSpacing: number;
    color: Rgba | null;
    align: string;
    fixedWidth?: number;
    truncate?: boolean;
  };
  /** The DOM node it came from: id, classes, data attributes (for finding regions). */
  dom?: { id?: string; cls?: string; data?: Record<string, string> };
}
export interface Capture {
  state: string;
  viewport: [number, number];
  layers: Layer[];
}

export interface LayerContext {
  api: PluginAPI;
  /** Called every `breatheEvery` nodes: a long synchronous run drops Figma's server connection. */
  breathe?: () => Promise<void>;
  breatheEvery?: number;
}

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3 ? h.replace(/(.)/g, "$1$1") : h.slice(0, 6),
    16,
  );
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
};
export const solid = (c: Rgba): SolidPaint => ({
  type: "SOLID",
  color: rgb(c.hex),
  opacity: c.a ?? 1,
});

/** Fonts: Inter at os-ui's exact weights (450, 550) when the family is variable in this Figma,
 * otherwise the nearest named weight. */
export class Fonts {
  private variable = new Set<string>();
  private loaded = new Set<string>();
  constructor(private api: PluginAPI) {}
  private static readonly NAMED: Array<[number, string]> = [
    [100, "Thin"],
    [200, "Extra Light"],
    [300, "Light"],
    [400, "Regular"],
    [500, "Medium"],
    [600, "Semi Bold"],
    [700, "Bold"],
    [800, "Extra Bold"],
    [900, "Black"],
  ];
  static style(weight: number): string {
    let best = Fonts.NAMED[3];
    for (const n of Fonts.NAMED)
      if (Math.abs(n[0] - weight) < Math.abs(best[0] - weight)) best = n;
    return best[1];
  }
  /** The family Figma knows: web fonts and system fallbacks map to Inter / Roboto Mono. */
  static family(family: string): string {
    if (/mono|menlo|courier/i.test(family)) return "Roboto Mono";
    return "Inter";
  }
  async load(families: Iterable<string>, weights: Iterable<number>) {
    for (const f of families) {
      if (this.loaded.has(f)) continue;
      const axes = (
        this.api as unknown as {
          getFontFamilyVariationAxes?: (f: string) => string[] | null;
        }
      ).getFontFamilyVariationAxes?.(f);
      if (axes?.includes("wght")) {
        await this.api.loadFontAsync({ family: f } as FontName);
        this.variable.add(f);
      } else
        for (const w of new Set([...weights].map(Fonts.style)))
          await this.api.loadFontAsync({ family: f, style: w });
      this.loaded.add(f);
    }
  }
  name(family: string, weight: number): FontName {
    const f = Fonts.family(family);
    const style = Fonts.style(weight);
    if (this.variable.has(f) && weight % 100 !== 0)
      return {
        family: f,
        style,
        variationSettings: { wght: weight },
      } as FontName;
    return { family: f, style };
  }
}

const radiusOf = (r: Layer["radius"]): number[] | null => {
  if (r == null) return null;
  const one = (v: number | { rx: number; ry: number }) =>
    typeof v === "number" ? v : Math.min(v.rx, v.ry);
  if (Array.isArray(r)) return r.map(one);
  const v = one(r);
  return [v, v, v, v];
};

const BLEND: Record<string, BlendMode> = {
  screen: "SCREEN",
  multiply: "MULTIPLY",
  overlay: "OVERLAY",
  darken: "DARKEN",
  lighten: "LIGHTEN",
};

function base64Bytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const table =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (table.indexOf(clean[i]) << 18) |
      (table.indexOf(clean[i + 1]) << 12) |
      ((table.indexOf(clean[i + 2] ?? "A") & 63) << 6) |
      (table.indexOf(clean[i + 3] ?? "A") & 63);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2] !== undefined && o < out.length) out[o++] = (n >> 8) & 255;
    if (clean[i + 3] !== undefined && o < out.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** Effects for a layer: its box shadows, plus a CSS drop-shadow filter. */
function effectsOf(l: Layer): Effect[] {
  const out: Effect[] = [];
  for (const s of l.effects ?? [])
    out.push({
      type: s.type,
      color: s.color
        ? { ...rgb(s.color.hex), a: s.color.a ?? 1 }
        : { r: 0, g: 0, b: 0, a: 0 },
      offset: { x: s.x, y: s.y },
      radius: s.blur,
      spread: s.spread,
      visible: true,
      blendMode: "NORMAL",
    } as Effect);
  const m = l.filterShadow
    ? /drop-shadow\((rgba?\([^)]*\)|#\w+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\)/.exec(
        l.filterShadow,
      )
    : null;
  if (m) {
    const p = /rgba?\(([^)]+)\)/.exec(m[1]);
    const v = p ? p[1].split(/[ ,/]+/).map(Number) : [0, 0, 0, 1];
    out.push({
      type: "DROP_SHADOW",
      color: { r: v[0] / 255, g: v[1] / 255, b: v[2] / 255, a: v[3] ?? 1 },
      offset: { x: +m[2], y: +m[3] },
      radius: +m[4],
      spread: 0,
      visible: true,
      blendMode: "NORMAL",
    } as Effect);
  }
  return out;
}

/** Builds `layers` under `root`, whose top-left is page point (ox, oy). Returns every created node
 * by layer id. */
export async function buildLayers(
  ctx: LayerContext,
  root: FrameNode,
  layers: Layer[],
  fonts: Fonts,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): Promise<Map<number, SceneNode>> {
  const { api } = ctx;
  const made = new Map<number, SceneNode>();
  const byId = new Map(layers.map((l) => [l.id, l]));
  let count = 0;
  for (const l of layers) {
    const parentLayer = l.parent != null ? byId.get(l.parent) : undefined;
    const parent = (parentLayer && made.get(parentLayer.id)) as
      (FrameNode & ChildrenMixin) | undefined;
    const host = parent ?? root;
    const px = parentLayer ? parentLayer.x : origin.x;
    const py = parentLayer ? parentLayer.y : origin.y;
    const node = await make(api, l, fonts);
    if (!node) continue;
    host.appendChild(node);
    node.x = l.x - px;
    node.y = l.y - py;
    if (l.rotation) {
      // CSS turns clockwise about the box centre; Figma turns counter-clockwise about the node's
      // top-left corner, so place that corner where it keeps the centre in place
      const th = (-l.rotation * Math.PI) / 180;
      const cx = l.x - px + l.w / 2;
      const cy = l.y - py + l.h / 2;
      (node as LayoutMixin).rotation = -l.rotation;
      node.x = cx - (Math.cos(th) * l.w) / 2 - (Math.sin(th) * l.h) / 2;
      node.y = cy + (Math.sin(th) * l.w) / 2 - (Math.cos(th) * l.h) / 2;
    }
    made.set(l.id, node);
    if (ctx.breathe && ++count % (ctx.breatheEvery ?? 150) === 0)
      await ctx.breathe();
  }
  return made;
}

async function make(
  api: PluginAPI,
  l: Layer,
  fonts: Fonts,
): Promise<SceneNode | null> {
  const w = Math.max(0.01, l.w);
  const h = Math.max(0.01, l.h);
  if (l.type === "TEXT" && l.text) {
    const t = api.createText();
    const T = l.text;
    t.name = l.name;
    t.fontName = fonts.name(T.family, T.weight);
    t.fontSize = T.size;
    t.lineHeight = { value: T.lineHeight, unit: "PIXELS" };
    t.letterSpacing = { value: T.letterSpacing, unit: "PIXELS" };
    t.textAlignHorizontal =
      T.align === "RIGHT" ? "RIGHT" : T.align === "CENTER" ? "CENTER" : "LEFT";
    t.fills = T.color ? [solid(T.color)] : [];
    t.characters = T.chars;
    if (T.fixedWidth != null) {
      t.textAutoResize = "HEIGHT";
      t.resize(Math.max(0.01, T.fixedWidth), h);
      if (T.truncate)
        (t as unknown as { textTruncation: string }).textTruncation = "ENDING";
    } else t.textAutoResize = "WIDTH_AND_HEIGHT";
    if (l.opacity != null) t.opacity = l.opacity;
    return t;
  }
  if (l.type === "SVG" || l.svg) {
    const markup = l.svg ?? l.svgUrl;
    if (!markup) return null;
    const v = api.createNodeFromSvg(markup);
    v.name = l.type === "SVG" ? l.name : "svg";
    v.resize(w, h);
    if (l.opacity != null) v.opacity = l.opacity;
    return v;
  }
  const n =
    l.type === "ELLIPSE"
      ? api.createEllipse()
      : l.type === "RECTANGLE"
        ? api.createRectangle()
        : api.createFrame();
  n.name = l.name;
  n.resize(w, h);
  const fills: Paint[] = [];
  for (const f of l.fills ?? [])
    if (f.type === "SOLID" && f.hex) fills.push(solid({ hex: f.hex, a: f.a }));
  if (l.image?.png) {
    const img = api.createImage(base64Bytes(l.image.png));
    fills.push({
      type: "IMAGE",
      imageHash: img.hash,
      scaleMode: l.image.fit === "cover" ? "FILL" : "FIT",
    });
  }
  n.fills = fills;
  if (l.strokes) {
    n.strokes = [solid(l.strokes.color)];
    n.strokeAlign = l.strokes.align === "OUTSIDE" ? "OUTSIDE" : "INSIDE";
    const [t, r, b, lw] = l.strokes.weights;
    if (t === r && r === b && b === lw) n.strokeWeight = t;
    else {
      const s = n as unknown as {
        strokeTopWeight: number;
        strokeRightWeight: number;
        strokeBottomWeight: number;
        strokeLeftWeight: number;
      };
      s.strokeTopWeight = t;
      s.strokeRightWeight = r;
      s.strokeBottomWeight = b;
      s.strokeLeftWeight = lw;
    }
    if (l.strokes.dash === "dashed") n.dashPattern = [4, 4];
    else if (l.strokes.dash === "dotted") n.dashPattern = [1, 2];
  }
  if (l.outline && l.outline.color && !l.strokes && !l.outline.offset) {
    n.strokes = [solid(l.outline.color)];
    n.strokeAlign = "OUTSIDE";
    n.strokeWeight = l.outline.w;
  }
  const radii = l.type === "ELLIPSE" ? null : radiusOf(l.radius);
  if (radii) {
    const r = n as unknown as RectangleCornerMixin & { cornerRadius: number };
    if (radii.every((v) => v === radii[0])) r.cornerRadius = radii[0];
    else {
      r.topLeftRadius = radii[0];
      r.topRightRadius = radii[1];
      r.bottomRightRadius = radii[2];
      r.bottomLeftRadius = radii[3];
    }
  }
  const effects = effectsOf(l);
  if (effects.length) n.effects = effects;
  if (l.opacity != null) n.opacity = l.opacity;
  if (l.blend && BLEND[l.blend]) n.blendMode = BLEND[l.blend];
  if (n.type === "FRAME") n.clipsContent = !!l.clips;
  return n;
}

/** Every text style a set of layers needs, for Fonts.load. */
export function textStyles(layers: Layer[]): {
  families: Set<string>;
  weights: Set<number>;
} {
  const families = new Set<string>();
  const weights = new Set<number>();
  for (const l of layers)
    if (l.text) {
      families.add(Fonts.family(l.text.family));
      weights.add(l.text.weight);
    }
  return { families, weights };
}
