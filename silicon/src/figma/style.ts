// Dark-theme palette, fonts and small node helpers shared by the gate symbols and the cell
// drawings (same look as tools/draw-machine). Figma colors are 0–1 floats; fonts must be
// loaded before any text is written.

export const C = {
  bg: "#141414",
  card: "#1E1E1E",
  cell: "#262626",
  stroke: "#333333",
  text: "#E8E8E8",
  dim: "#8C8C8C",
  gate: "#BDBDBD",
  lead: "#8C8C8C",
  wire: "#5E5E5E",
  net: "#D9A441",
  lit: "#F5C542",
};

export function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function solid(hex: string, opacity = 1): SolidPaint[] {
  return [{ type: "SOLID", color: rgb(hex), opacity }];
}

export interface Fonts {
  sans: FontName;
  bold: FontName;
  mono: FontName;
}

let fonts: Fonts | null = null;

/** Loads Inter (+ Roboto Mono for net names, falling back to Inter). Safe to call repeatedly. */
export async function loadFonts(): Promise<Fonts> {
  if (fonts) return fonts;
  const sans: FontName = { family: "Inter", style: "Regular" };
  const bold: FontName = { family: "Inter", style: "Bold" };
  await figma.loadFontAsync(sans);
  await figma.loadFontAsync(bold);
  let mono: FontName = { family: "Roboto Mono", style: "Regular" };
  try {
    await figma.loadFontAsync(mono);
  } catch {
    mono = sans;
  }
  fonts = { sans, bold, mono };
  return fonts;
}

/** Forgets the loaded fonts (tests swap in a fresh fake Figma between files). */
export function resetFonts(): void {
  fonts = null;
}

export interface TextOpts {
  size?: number;
  font?: keyof Fonts;
  color?: string;
}

/** Appends a text layer. Fonts must have been loaded with loadFonts(). */
export function addText(parent: ChildrenMixin, name: string, chars: string, x: number, y: number, o: TextOpts = {}): TextNode {
  if (!fonts) throw new Error("addText before loadFonts()");
  const t = figma.createText();
  parent.appendChild(t);
  t.name = name;
  t.fontName = fonts[o.font ?? "sans"];
  t.fontSize = o.size ?? 12;
  t.characters = chars;
  t.fills = solid(o.color ?? C.text);
  t.x = x;
  t.y = y;
  return t;
}

/** Rough rendered width of a label (layout runs before Figma measures text). */
export function textWidth(s: string, size: number): number {
  return Math.ceil(s.length * size * 0.62);
}

/** Moves the layers of a createNodeFromSvg frame into `parent` at the same spot and drops the
 * wrapper frame, so a symbol costs one vector per SVG path instead of frame + vectors. */
export function unwrapSvg(parent: ChildrenMixin & BaseNode, svg: string, x = 0, y = 0): SceneNode[] {
  const f = figma.createNodeFromSvg(svg);
  parent.appendChild(f);
  f.x = x;
  f.y = y;
  const out: SceneNode[] = [];
  for (const c of [...f.children]) {
    const cx = f.x + c.x;
    const cy = f.y + c.y;
    parent.appendChild(c);
    c.x = cx;
    c.y = cy;
    out.push(c);
  }
  f.remove();
  return out;
}
