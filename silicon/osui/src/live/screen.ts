// The live Figma OS screen, as data: os-ui's Default screen as captured, with every part the editor
// changes rebuilt from layers bound to the chip's screen lines (cpu/disp.ts) and every control wired
// to a run of the catalogue (catalog.ts). render.ts makes it in Figma; nothing here touches Figma.
//
// Nothing on the screen computes. A layer's box is spacer frames bound to its x, y, w, h bits; a
// kind or a state is a layer bound to its line, and "and" is one bound layer inside another. A
// glyph, a colour or a corner radius comes from the display's look-up tables (rom.ts): each digit,
// name, colour is one variable that every layer showing it binds to. The looks are os-ui's own:
// captured screens and parts (osui/capture), or os-ui's canvas CSS for the shapes it draws.
import type { DisplayLines, Line, Num, SlotLines } from "../cpu/disp";
import { KINDS, OFFSET } from "../cpu/disp";
import { PICK_GROUPS, PICK_NAMES } from "../cpu/pick";
import type { Layer, Rgba, ScreensFile } from "../layers";
import { screenLayers } from "../layers";
import { ALIGNS, CORNERS, TOOL_NAMES } from "./catalog";
import { KIND_LABEL, PALETTE, romName } from "./rom";

export { KIND_LABEL, PALETTE };

// ---------- the spec ----------

export type Sizing = "FIXED" | "HUG" | "FILL";

/** What a layer does when used. `over`: the layer sits over the canvas cells, so it takes the press
 * and acts on the release (in Present a cell's press beats a click on a layer above it). */
export type Act =
  /** Runs a catalogue run. */
  | { on: "click"; run: string; over?: boolean }
  | { on: "key"; codes: number[]; run: string }
  /** A canvas cell: the press records it, the release records it and runs the gesture. */
  | { on: "press"; cell: [number, number] }
  | { on: "release"; cell: [number, number] }
  /** A resize handle of the selection (CORNERS index): pressed, or released on itself. */
  | { on: "handle"; corner: number }
  | { on: "handleUp"; corner: number }
  /** Opens a menu (an overlay of menus.ts) over the screen. */
  | { on: "open"; menu: string; over?: boolean }
  /** Over the canvas cells: takes the press, so a click here reaches no cell (and does nothing). */
  | { on: "block" }
  /** In a menu: runs a catalogue run and closes the menu. */
  | { on: "item"; run: string }
  /** In a menu: swaps in another menu state when the pointer reaches it (or on a click). */
  | { on: "sub"; menu: string; click?: boolean }
  /** Closes the menu. */
  | { on: "dismiss" };

export interface Stroke {
  color: Rgba;
  weight: number;
  align?: "INSIDE" | "OUTSIDE" | "CENTER";
  dash?: number[];
  cap?: "NONE" | "ROUND";
  join?: "MITER" | "ROUND";
}

export interface LiveNode {
  name: string;
  /** A captured layer: its look (fills, strokes, radius, effects, opacity, text, SVG). */
  layer?: Layer;
  /** Otherwise a node of this type. */
  type?: "frame" | "rect" | "ellipse" | "star" | "text" | "vector";
  /** Position in the parent (ignored in an auto layout unless `absolute`). */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Pinned to the parent's edges, these distances in (negative: out), and kept so when the parent
   * resizes: left and right both given stretch it across, one of them pins that side (Figma
   * constraints STRETCH / MIN / MAX); likewise top and bottom. Its size comes from `w`, `h` on a
   * side that is pinned once. */
  edges?: { left?: number; top?: number; right?: number; bottom?: number };
  rotation?: number;
  fills?: Rgba[];
  stroke?: Stroke;
  radius?: number;
  opacity?: number;
  /** Variables (by name) the layer follows: opacity, its characters (a text), its fill and stroke
   * colours, its corner radius. */
  opacityVar?: string;
  chars?: string;
  fillVar?: string;
  /** The fill's own opacity under a bound colour (a section's fill is its colour at 25 %). */
  fillAlpha?: number;
  strokeVar?: string;
  radiusVar?: string;
  text?: {
    chars: string;
    size: number;
    weight: number;
    color: Rgba;
    lineHeight?: number;
    letterSpacing?: number;
    align?: "LEFT" | "CENTER" | "RIGHT";
    /** Fixed width (the text wraps / aligns in it); otherwise the text hugs its characters. */
    width?: number;
  };
  /** Vector path data. */
  path?: string;
  /** Star: points and inner radius. */
  star?: { points: number; inner: number };
  clip?: boolean;
  layout?: {
    dir: "H" | "V";
    gap?: number;
    main?: "MIN" | "CENTER" | "MAX";
    cross?: "MIN" | "CENTER" | "MAX";
  };
  sizeH?: Sizing;
  sizeV?: Sizing;
  /** A child of an auto layout that keeps its own position. */
  absolute?: boolean;
  /** Shown while this line is 1 (a net), or always / never (a constant). */
  visible?: Line;
  acts?: Act[];
  children?: LiveNode[];
}

/** os-ui's captured layers: every screen, and parts (the toolbar per tool, layer rows per kind). */
export interface CaptureData {
  screens: ScreensFile;
  parts: {
    svgs: string[];
    images: Record<string, string>;
    parts: Record<string, Layer[]>;
  };
}

// ---------- os-ui's geometry and colours ----------

/** Name of the live frame. */
export const LIVE = "os-ui · live (gate-level CPU)";
export const CELL = 48;
/** Page point of world cell (0, 0): os-ui's artboard corner at 600 %. */
export const ORIGIN = { x: 412, y: 170 };
/** The window of cells the chip's pointer reaches (in/px, in/py: 4 bits each). */
export const GRID = 16;
const HAIR = CELL / 8;
const ACCENT: Rgba = { hex: "#0c8ce9" };
const TRIANGLE = "M 50 0 L 100 100 L 0 100 Z";
const ON: Line = { k: 1 };
const THIN = 0.01;
/** Room for a space between a layer's kind and its id (Inter at 11 px). */
const SPACE = 3;

// ---------- small builders ----------

const frame = (name: string, p: Partial<LiveNode> = {}): LiveNode => ({
  name,
  type: "frame",
  ...p,
});
type Look = {
  size: number;
  weight: number;
  color: Rgba;
  lineHeight?: number;
  letterSpacing?: number;
};
const text = (
  name: string,
  chars: string,
  look: Look,
  p: Partial<LiveNode> = {},
): LiveNode => ({
  name,
  type: "text",
  text: { chars, ...look },
  ...p,
});
const lookOf = (l: Layer): Look => ({
  size: l.text!.size,
  weight: l.text!.weight,
  color: l.text!.color!,
  lineHeight: l.text!.lineHeight,
  letterSpacing: l.text!.letterSpacing,
});
const whole = { left: 0, top: 0, right: 0, bottom: 0 };
const hug = (dir: "H" | "V", p: Partial<LiveNode> = {}): Partial<LiveNode> => ({
  layout: { dir },
  sizeH: "HUG",
  sizeV: "HUG",
  ...p,
});

/** `n` frames 1, 2, 4 … cells long along `dir`, each shown while its line is 1: in an auto layout
 * hidden frames take no room, so the shown ones add up to the value. */
function spacers(prefix: string, dir: "H" | "V", lines: Line[]): LiveNode[] {
  return lines.map((l, i) =>
    frame(`${prefix}${i}`, {
      w: dir === "H" ? CELL << i : THIN,
      h: dir === "H" ? THIN : CELL << i,
      visible: l,
    }),
  );
}

/** `content` at slot `s`'s position: y spacers, then a row of x spacers and the content. The
 * spacers count from world cell (-OFFSET, -OFFSET), which is `at` (in the parent). */
function placed(
  name: string,
  s: SlotLines,
  content: LiveNode,
  at: { x: number; y: number },
): LiveNode {
  return frame(name, {
    x: at.x,
    y: at.y,
    ...hug("V"),
    children: [
      ...spacers("y", "V", s.py),
      frame("row", {
        ...hug("H"),
        children: [...spacers("x", "H", s.px), content],
      }),
    ],
  });
}

/** A box of slot `s`'s size: a bar of w spacers over a row of h spacers and `body`, which fills it. */
function sized(name: string, s: SlotLines, body: LiveNode): LiveNode {
  return frame(name, {
    ...hug("V"),
    children: [
      frame("wbar", { ...hug("H"), children: spacers("w", "H", s.pw) }),
      frame("bodyrow", {
        layout: { dir: "H" },
        sizeH: "FILL",
        sizeV: "HUG",
        children: [
          frame("hbar", { ...hug("V"), children: spacers("h", "V", s.ph) }),
          { ...body, sizeH: "FILL", sizeV: "FILL" },
        ],
      }),
    ],
  });
}

/** Slot `i`'s layers that use slot lines, shown while the slot is used and drawn. */
const drawn = (
  name: string,
  s: SlotLines,
  inner: LiveNode,
  gate: Line = s.used,
): LiveNode =>
  frame(name, {
    x: 0,
    y: 0,
    visible: gate,
    children: [{ ...inner, visible: s.vin }],
  });

/** A number of slot `i`: its minus sign and decimal digits, each a text bound to its glyph. */
function number(
  name: string,
  i: number,
  field: string,
  n: Num,
  look: Look,
): LiveNode {
  const kids: LiveNode[] = [];
  if (n.neg) kids.push(text("minus", "-", look, { visible: n.neg }));
  for (let d = n.digits.length - 1; d >= 0; d--)
    kids.push(
      text(`d${d}`, "0", look, {
        chars: romName(i, `${field}/d${d}`),
        visible: n.digits[d].show,
      }),
    );
  return frame(name, { ...hug("H"), children: kids });
}

/** A layer's name: its kind's label and its id. */
function layerName(
  name: string,
  s: SlotLines,
  i: number,
  look: Look,
  p: Partial<LiveNode> = {},
): LiveNode {
  return frame(name, {
    ...hug("H"),
    layout: { dir: "H", gap: SPACE },
    ...p,
    children: [
      text("kind", "Frame", look, { chars: romName(i, "kind") }),
      number("id", i, "id", s.id, look),
    ],
  });
}

// ---------- captured layers ----------

const holds = (l: Layer) => l.type === "FRAME" || l.type === "SVG";

/** A captured subtree as nodes. Positions are made relative to each node's parent; `at` is the page
 * point of the subtree root's new parent. A shape or text cannot hold children in Figma, so its
 * captured children go to the nearest ancestor that can (as buildLayers does). `skip` drops a layer
 * and its subtree; `edit` may change or replace a node (null drops it). */
export function captured(
  layers: Layer[],
  root: Layer,
  at: { x: number; y: number },
  opts: {
    skip?: (l: Layer) => boolean;
    edit?: (l: Layer, n: LiveNode) => LiveNode | null;
  } = {},
): LiveNode {
  const kids = new Map<number, Layer[]>();
  for (const l of layers)
    if (l.parent != null)
      kids.set(l.parent, [...(kids.get(l.parent) ?? []), l]);
  const build = (l: Layer, px: number, py: number): LiveNode[] => {
    if (opts.skip?.(l)) return [];
    const own: LiveNode = {
      name: l.name,
      layer: l,
      x: l.x - px,
      y: l.y - py,
      rotation: l.rotation,
    };
    const below = (kids.get(l.id) ?? []).flatMap((c) =>
      holds(l) ? build(c, l.x, l.y) : build(c, px, py),
    );
    if (holds(l)) own.children = below;
    const node = opts.edit ? opts.edit(l, own) : own;
    // a shape's captured children come right after it, in its parent
    return [...(node ? [node] : []), ...(holds(l) ? [] : below)];
  };
  const out = build(root, at.x, at.y);
  if (out.length !== 1)
    throw new Error(`captured(${root.name}): the root is not one layer`);
  return out[0];
}

const isCls = (l: Layer, cls: string) =>
  (l.dom?.cls ?? "").split(/\s+/).includes(cls);
const byDom = (
  layers: Layer[],
  f: (l: Layer) => boolean,
  what: string,
): Layer => {
  const l = layers.find(f);
  if (!l) throw new Error(`the capture has no ${what}`);
  return l;
};
/** Applies `f` to every node of a tree, children first. */
function mapTree(n: LiveNode, f: (n: LiveNode) => LiveNode): LiveNode {
  const kids = n.children?.map((c) => mapTree(c, f));
  return f(kids ? { ...n, children: kids } : n);
}

// ---------- the canvas: os-ui's layers drawn from the registers ----------

/** A shape that fills its box and stretches with it. */
const fill = (name: string, p: Partial<LiveNode>): LiveNode => ({
  name,
  type: "rect",
  edges: whole,
  ...p,
});

/** The arrow's head for a box at 45°: os-ui draws two wings 0.5 rad off the shaft, 0.9 cell long. */
function arrowHead(flip: boolean, p: Partial<LiveNode>): LiveNode {
  const size = CELL * 0.9;
  const a = flip ? -Math.PI / 4 : Math.PI / 4;
  const wing = (t: number) => [
    -size * Math.cos(a + t),
    -size * Math.sin(a + t),
  ];
  const [w1, w2] = [wing(0.5), wing(-0.5)];
  const xs = [w1[0], w2[0], 0];
  const ys = [w1[1], w2[1], 0];
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const [w, h] = [Math.max(...xs) - x0, Math.max(...ys) - y0];
  const pt = ([x, y]: number[]) =>
    `${(x - x0).toFixed(2)} ${(y - y0).toFixed(2)}`;
  return {
    name: "head",
    type: "vector",
    path: `M ${pt(w1)} L ${pt([0, 0])} L ${pt(w2)}`,
    w,
    h,
    // the tip sits where the shaft ends (half a stroke in from the corner it points at), whatever
    // the box's size: the head is pinned to that corner's edges
    edges: flip
      ? { right: HAIR / 2 - x0 - w, top: HAIR / 2 + y0 }
      : { right: HAIR / 2 - x0 - w, bottom: HAIR / 2 - y0 - h },
    ...p,
  };
}

/** One slot's shape by kind, the way os-ui's view.ts draws it; its colours, corner radius and
 * opacity come from the slot's look-up tables. `shadow`: the drop shadow's silhouette instead. */
function shapeOf(s: SlotLines, i: number, shadow: boolean): LiveNode[] {
  const black: Rgba = { hex: "#000000", a: 0.6 };
  const paint = (alpha?: number): Partial<LiveNode> =>
    shadow
      ? { fills: [black] }
      : { fillVar: romName(i, "fill/colour"), fillAlpha: alpha };
  const outline = (p: Partial<LiveNode>): LiveNode[] =>
    shadow
      ? []
      : [
          {
            ...fill("stroke", p),
            fills: [],
            strokeVar: romName(i, "stroke/colour"),
            stroke: {
              color: { hex: "#000000" },
              weight: HAIR,
              align: "INSIDE",
              join: "ROUND",
            },
            visible: s.hasStroke,
          },
        ];
  const kind = (k: number, kids: LiveNode[]) =>
    frame(KIND_LABEL[k], { edges: whole, visible: s.kind[k], children: kids });
  const radius = romName(i, "radius");
  const out: LiveNode[] = [];
  // frame, rectangle and section: a rounded box, its fill (a section's at 25 %) and an inner stroke
  for (const k of [3, 6, 4]) {
    const alpha = k === 4 ? 0.25 : undefined;
    out.push(
      kind(k, [
        fill("fill", { ...paint(alpha), radiusVar: radius }),
        ...outline({ radiusVar: radius }),
      ]),
    );
  }
  // a slice: an outline over a faint fill (styles.css .layer.slice .shape), never a shadow
  if (!shadow)
    out.push(
      kind(5, [
        fill("slice", {
          fills: [{ hex: "#0c8ce9", a: 0x22 / 255 }],
          stroke: { color: ACCENT, weight: 1, align: "OUTSIDE", dash: [3, 3] },
        }),
      ]),
    );
  out.push(
    kind(9, [
      fill("fill", { type: "ellipse", ...paint() }),
      ...outline({ type: "ellipse" }),
    ]),
  );
  out.push(
    kind(10, [
      fill("fill", { type: "vector", path: TRIANGLE, ...paint() }),
      ...outline({ type: "vector", path: TRIANGLE, stroke: undefined }).map(
        (n) => ({
          ...n,
          stroke: { ...n.stroke!, align: "CENTER" as const },
        }),
      ),
    ]),
  );
  out.push(
    kind(11, [
      fill("fill", {
        type: "star",
        star: { points: 5, inner: 0.382 },
        ...paint(),
      }),
      ...outline({ type: "star", star: { points: 5, inner: 0.382 } }).map(
        (n) => ({
          ...n,
          stroke: { ...n.stroke!, align: "CENTER" as const },
        }),
      ),
    ]),
  );
  // line and arrow: from corner to corner (flipped: bottom-left to top-right), in the stroke colour
  // when there is one, else the fill (rom.ts line/colour)
  for (const k of [7, 8]) {
    const variant = (flip: boolean) => {
      const ink: Partial<LiveNode> = shadow
        ? {
            stroke: {
              color: black,
              weight: HAIR,
              cap: "ROUND",
              join: "ROUND",
              align: "CENTER",
            },
          }
        : {
            strokeVar: romName(i, "line/colour"),
            stroke: {
              color: { hex: "#000000" },
              weight: HAIR,
              cap: "ROUND",
              join: "ROUND",
              align: "CENTER",
            },
          };
      return frame(flip ? "flipped" : "straight", {
        edges: whole,
        visible: flip ? s.flip.bits[0] : s.flip.inv[0],
        children: [
          fill("shaft", {
            type: "vector",
            path: flip ? "M 0 100 L 100 0" : "M 0 0 L 100 100",
            fills: [],
            edges: {
              left: HAIR / 2,
              top: HAIR / 2,
              right: HAIR / 2,
              bottom: HAIR / 2,
            },
            ...ink,
          }),
          ...(k === 8 ? [arrowHead(flip, { fills: [], ...ink })] : []),
        ],
      });
    };
    out.push(kind(k, [variant(false), variant(true)]));
  }
  return out;
}

/** Where the slots' placement spacers start (world cell (-OFFSET, -OFFSET)), in canvas coordinates. */
const slotOrigin = (canvas: Layer) => ({
  x: ORIGIN.x - OFFSET * CELL - canvas.x,
  y: ORIGIN.y - OFFSET * CELL - canvas.y,
});

function slotShape(
  s: SlotLines,
  i: number,
  at: { x: number; y: number },
): LiveNode {
  const body = frame("body", {
    opacityVar: romName(i, "opacity"),
    children: [
      // os-ui's drop shadow: a quarter cell down and right, black at 60 %
      frame("shadow", {
        edges: {
          left: CELL / 4,
          top: CELL / 4,
          right: -CELL / 4,
          bottom: -CELL / 4,
        },
        visible: s.shadow.bits[0],
        children: shapeOf(s, i, true),
      }),
      ...shapeOf(s, i, false),
    ],
  });
  return drawn(`slot ${i}`, s, placed("vin", s, sized("box", s, body), at));
}

/** A frame's or section's name above its top-left corner (view.ts frameLabels); the selected one
 * blue, in the accent box. */
function slotLabel(
  s: SlotLines,
  selN: Line,
  i: number,
  at: { x: number; y: number },
  looks: { plain: Layer; sel: Layer },
): LiveNode {
  const label = (sel: boolean) =>
    layerName(
      sel ? "selected" : "plain",
      s,
      i,
      lookOf(sel ? looks.sel : looks.plain),
      {
        x: 0,
        y: -20,
        visible: sel ? s.sel : selN,
        ...(sel
          ? { stroke: { color: ACCENT, weight: 1, align: "INSIDE" as const } }
          : {}),
      },
    );
  const anchor = frame("anchor", {
    w: THIN,
    h: THIN,
    visible: s.labelled,
    children: [label(false), label(true)],
  });
  return drawn(`label ${i}`, s, placed("vin", s, anchor, at));
}

/** The selection outline and its size tag "w × h" (view.ts selection). */
function slotSelection(
  s: SlotLines,
  i: number,
  at: { x: number; y: number },
  tagText: Layer,
): LiveNode {
  const look = lookOf(tagText);
  const tag = frame("size", {
    layout: { dir: "H" },
    sizeH: "HUG",
    sizeV: "HUG",
    fills: [ACCENT],
    radius: 3,
    children: [
      frame("pad", { w: 6, h: 18 }),
      number("w", i, "w", s.w, look),
      text("times", " × ", look),
      number("h", i, "h", s.h, look),
      frame("pad", { w: 6, h: 18 }),
    ],
  });
  const body = frame("body", {
    children: [
      fill("outline", {
        type: "frame",
        fills: [],
        stroke: { color: ACCENT, weight: 1, align: "INSIDE" },
      }),
      // centred under the box, 7 px below it
      frame("tag row", {
        h: 18,
        edges: { left: 0, right: 0, bottom: -25 },
        layout: { dir: "H", main: "CENTER" },
        children: [tag],
      }),
    ],
  });
  return drawn(
    `selection ${i}`,
    s,
    placed("vin", s, sized("box", s, body), at),
    s.sel,
  );
}

/** The four resize handles (above the canvas cells, so they take the press). */
function slotHandles(
  s: SlotLines,
  i: number,
  at: { x: number; y: number },
  looks: Layer[],
): LiveNode {
  const body = frame("body", {
    children: CORNERS.map((c, k): LiveNode => {
      const look = looks[k];
      const right = c.endsWith("e");
      const bottom = c.startsWith("s");
      // centred on its corner of the box, whatever the box's size
      return {
        name: `handle ${c}`,
        layer: look,
        w: look.w,
        h: look.h,
        edges: {
          ...(right ? { right: -look.w / 2 } : { left: -look.w / 2 }),
          ...(bottom ? { bottom: -look.h / 2 } : { top: -look.h / 2 }),
        },
        acts: [
          { on: "handle", corner: k },
          { on: "handleUp", corner: k },
        ],
      };
    }),
  });
  return drawn(
    `handles ${i}`,
    s,
    placed("vin", s, sized("box", s, body), at),
    s.sel,
  );
}

/** The selection's band on each ruler (view.ts rulerHtml). */
function rulerBand(
  axis: "x" | "y",
  s: SlotLines,
  i: number,
  at: number,
  band: Layer,
): LiveNode {
  const h = axis === "x";
  const fills = (band.fills ?? [])
    .filter((f) => f.hex)
    .map((f) => ({ hex: f.hex!, a: f.a }));
  return drawn(
    `band ${i}`,
    s,
    frame("vin", {
      x: h ? at : 0,
      y: h ? 0 : at,
      ...hug(h ? "H" : "V"),
      children: [
        ...spacers("p", h ? "H" : "V", h ? s.px : s.py),
        frame("band", {
          ...hug(h ? "H" : "V"),
          fills,
          children: [
            frame(h ? "height" : "width", {
              w: h ? THIN : band.w,
              h: h ? band.h : THIN,
            }),
            ...spacers("s", h ? "H" : "V", h ? s.pw : s.ph),
          ],
        }),
      ],
    }),
    s.sel,
  );
}

// ---------- the layers panel ----------

interface RowLooks {
  /** A captured row per kind: the row, its icon, its name text. */
  kinds: Map<number, { row: Layer; icon: Layer; name: Layer }>;
  selected: Layer;
  hiddenRow: Layer;
  eyeOff: Layer[];
}

/** One row of the Layers panel: icon and name, highlighted when selected, faded when hidden. */
function layerRow(s: SlotLines, i: number, looks: RowLooks): LiveNode {
  const any = looks.kinds.values().next().value!;
  const at = (l: Layer) => ({ x: l.x - any.row.x, y: l.y - any.row.y });
  return frame(`row ${i}`, {
    w: any.row.w,
    h: any.row.h,
    visible: s.used,
    children: [
      {
        name: "highlight",
        layer: looks.selected,
        x: 0,
        y: 0,
        visible: s.sel,
        children: [],
      },
      frame("content", {
        x: 0,
        y: 0,
        w: any.row.w,
        h: any.row.h,
        opacityVar: romName(i, "row/opacity"),
        children: [
          frame("icon", {
            ...at(any.icon),
            w: any.icon.w,
            h: any.icon.h,
            children: KINDS.map((k) => ({
              name: KIND_LABEL[k],
              layer: looks.kinds.get(k)!.icon,
              x: 0,
              y: 0,
              visible: s.kind[k],
            })),
          }),
          layerName("name", s, i, lookOf(any.name), at(any.name)),
          ...looks.eyeOff.map((l) => ({
            name: l.name,
            layer: l,
            x: l.x - looks.hiddenRow.x,
            y: l.y - looks.hiddenRow.y,
            visible: s.visN,
          })),
        ],
      }),
      frame("hit", {
        x: 0,
        y: 0,
        w: any.row.w,
        h: any.row.h,
        acts: [{ on: "click", run: `layer/${i}` }],
      }),
      frame("eye hit", {
        x: any.row.w - 32,
        y: 0,
        w: 32,
        h: any.row.h,
        acts: [{ on: "click", run: `eye/${i}` }],
      }),
    ],
  });
}

// ---------- the Design panel ----------

/** A palette (Styles, Fill, Stroke): each swatch gets os-ui's focus ring while its line is on (its
 * 2 px accent outline, 1 px out: styles.css .sw.on) and a hot spot that runs `run(k)`. */
function paletteLive(
  palette: LiveNode,
  on: Line[],
  run: (k: number) => string,
): LiveNode {
  const swatches = (palette.children ?? []).filter(
    (c) => c.layer && isCls(c.layer, "sw"),
  );
  const rings = swatches.map((sw, k) =>
    frame(`ring ${k}`, {
      x: sw.x! - 3,
      y: sw.y! - 3,
      w: sw.layer!.w + 6,
      h: sw.layer!.h + 6,
      radius: 6,
      stroke: { color: ACCENT, weight: 2, align: "INSIDE" },
      visible: on[k],
    }),
  );
  const hits = swatches.map((sw, k) =>
    frame(`swatch hit ${k}`, {
      x: sw.x,
      y: sw.y,
      w: sw.layer!.w,
      h: sw.layer!.h,
      acts: [{ on: "click", run: run(k) }],
    }),
  );
  return {
    ...palette,
    children: [...(palette.children ?? []), ...rings, ...hits],
  };
}

/** The Design panel of a selected layer in slot `i`: os-ui's panel for a selected frame
 * (frame-selected), with the stroke and shadow sections of a styled star (star-styled), stacked so
 * a section that grows pushes the rest down. */
function designPanel(
  s: SlotLines,
  i: number,
  base: { layers: Layer[]; panel: Layer },
  styled: { layers: Layer[]; panel: Layer },
): LiveNode {
  type Src = typeof base;
  const blocks = (src: Src) =>
    src.layers.filter((l) => l.parent === src.panel.id);
  const titleOf = (src: Src, block: Layer) => {
    const h4 = src.layers.find(
      (l) => l.parent === block.id && l.name.startsWith("h4"),
    );
    const span =
      h4 && src.layers.find((l) => l.parent === h4.id && l.name === "span");
    return (
      span &&
      src.layers.find((l) => l.parent === span.id && l.type === "TEXT")?.text
        ?.chars
    );
  };
  const findBlock = (src: Src, title: string) => {
    const b = blocks(src).find((b) => titleOf(src, b) === title);
    if (!b) throw new Error(`the capture has no "${title}" section`);
    return b;
  };
  const at = { x: base.panel.x, y: base.panel.y };
  const sel = `${i}`;
  /** A value field: its text replaced by `value`, and -1 / +1 hot spots on its halves. */
  const fieldEdit = (
    src: Src,
    prop: string,
    value: (look: Look) => LiveNode,
  ) => ({
    edit: (l: Layer, n: LiveNode): LiveNode =>
      l.type === "TEXT" && l.dom?.data?.["data-prop"] === prop
        ? { ...value(lookOf(l)), name: `${prop} value`, x: n.x, y: n.y }
        : n,
    hits: (block: Layer): LiveNode[] => {
      const input = src.layers.find(
        (l) => l.dom?.data?.["data-prop"] === prop,
      )!;
      const label = src.layers.find((l) => l.id === input.parent)!;
      const [x, y, w, h] = [
        label.x - block.x,
        label.y - block.y,
        label.w,
        label.h,
      ];
      return [
        frame(`${prop} −`, {
          x,
          y,
          w: w / 2,
          h,
          acts: [{ on: "click", run: `prop/${prop}/dec@${sel}` }],
        }),
        frame(`${prop} +`, {
          x: x + w / 2,
          y,
          w: w / 2,
          h,
          acts: [{ on: "click", run: `prop/${prop}/inc@${sel}` }],
        }),
      ];
    },
  });
  const block = (
    src: Src,
    title: string,
    fields: Array<ReturnType<typeof fieldEdit>> = [],
    more: (n: LiveNode) => LiveNode = (n) => n,
    visible?: Line,
  ): LiveNode => {
    const b = findBlock(src, title);
    const n = captured(src.layers, b, at, {
      edit: (l, node) => fields.reduce((acc, f) => f.edit(l, acc), node),
    });
    return {
      ...more({
        ...n,
        children: [...(n.children ?? []), ...fields.flatMap((f) => f.hits(b))],
      }),
      visible,
    };
  };
  const wire = (match: (l: Layer) => boolean, run: string) => (n: LiveNode) =>
    mapTree(n, (node) =>
      node.layer && match(node.layer)
        ? { ...node, acts: [{ on: "click", run }] }
        : node,
    );
  const bound = (key: string) => (look: Look) =>
    text("value", "0", look, { chars: romName(i, key) });
  /** The colour row (swatch + hex) shows the current colour; the palette rings it and sets it. */
  const colourRow =
    (lines: Line[], what: "fill" | "stroke", run: (k: number) => string) =>
    (n: LiveNode) =>
      mapTree(n, (node) => {
        const l = node.layer;
        if (!l) return node;
        if (isCls(l, "swatch") && l.type !== "TEXT")
          return { ...node, fillVar: romName(i, `${what}/colour`) };
        if (
          l.type === "TEXT" &&
          (l.dom?.cls ?? "").split(/\s+/).includes("hex")
        )
          return { ...node, chars: romName(i, `${what}/hex`) };
        if (isCls(l, "palette")) return paletteLive(node, lines, run);
        return node;
      });

  const ptabs = blocks(base).find((b) => isCls(b, "ptabs"))!;
  const sections: LiveNode[] = [
    // the tabs and the zoom menu's button
    captured(base.layers, ptabs, at, {
      edit: (l, n) => {
        const menu = menuOf(l);
        return menu ? { ...n, acts: [{ on: "open", menu }] } : n;
      },
    }),
    // Position: align buttons, X and Y
    block(
      base,
      "Position",
      [
        fieldEdit(base, "x", (look) => number("x", i, "x", s.x, look)),
        fieldEdit(base, "y", (look) => number("y", i, "y", s.y, look)),
      ],
      (n) =>
        mapTree(n, (node) => {
          const to = node.layer?.dom?.data?.["data-align"];
          return to && (ALIGNS as readonly string[]).includes(to)
            ? { ...node, acts: [{ on: "click", run: `align/${to}` }] }
            : node;
        }),
    ),
    // Layout: W and H
    block(base, "Layout", [
      fieldEdit(base, "w", (look) => number("w", i, "w", s.w, look)),
      fieldEdit(base, "h", (look) => number("h", i, "h", s.h, look)),
    ]),
    // Appearance: the eye (show / hide), opacity, and the radius of the kinds that have one
    block(
      base,
      "Appearance",
      [
        fieldEdit(base, "opacity", bound("opacity/text")),
        fieldEdit(base, "radius", bound("radius/text")),
      ],
      (n) =>
        mapTree(
          wire(
            (l) => l.dom?.data?.["data-visible"] !== undefined,
            `eye/${i}`,
          )(n),
          (node) =>
            node.layer &&
            isCls(node.layer, "field") &&
            base.layers.some(
              (c) =>
                c.parent === node.layer!.id &&
                c.dom?.data?.["data-prop"] === "radius",
            )
              ? { ...node, visible: s.canRadius }
              : node,
        ),
    ),
    // Fill: swatch and hex of the fill colour, the palette (all but a slice)
    block(
      base,
      "Fill",
      [],
      colourRow(s.fill, "fill", (k) => `swatch/${k}@${sel}`),
      s.hasFill,
    ),
    // Stroke: "+" adds black, or the stroke colour's row and its palette
    block(
      base,
      "Stroke",
      [],
      wire((l) => l.dom?.data?.["data-stroke"] === "add", `stroke/0@${sel}`),
      s.strokeNone,
    ),
    block(
      styled,
      "Stroke",
      [],
      (n) =>
        colourRow(
          s.stroke,
          "stroke",
          (k) => `stroke/${k}@${sel}`,
        )(
          wire(
            (l) => l.dom?.data?.["data-stroke"] === "remove",
            `stroke/none@${sel}`,
          )(n),
        ),
      s.hasStroke,
    ),
    // Effects: "+" adds the drop shadow, or its row with "−"
    block(
      base,
      "Effects",
      [],
      wire((l) => l.dom?.data?.["data-shadow"] === "add", `shadow/on@${sel}`),
      s.shadow.inv[0],
    ),
    block(
      styled,
      "Effects",
      [],
      wire(
        (l) => l.dom?.data?.["data-shadow"] === "remove",
        `shadow/off@${sel}`,
      ),
      s.shadow.bits[0],
    ),
    // Export: names a frame, section or slice, otherwise the file
    block(base, "Export", [], (n) =>
      mapTree(n, (node) => {
        if (
          node.layer?.type !== "TEXT" ||
          !node.layer.text?.chars.startsWith("Export ")
        )
          return node;
        const look = lookOf(node.layer);
        const btn = base.layers.find((l) => l.id === node.layer!.parent)!;
        return frame("export label", {
          x: 0,
          y: node.y,
          w: btn.w,
          h: node.layer.h,
          layout: { dir: "H", main: "CENTER" },
          children: [
            text("Export", "Export", look),
            frame("gap", { w: SPACE, h: 1 }),
            layerName("name", s, i, look, { visible: s.region }),
            text("Untitled", "Untitled", look, { visible: s.regionN }),
          ],
        });
      }),
    ),
  ];
  return frame(`design ${i}`, {
    x: 0,
    y: 0,
    w: base.panel.w,
    layout: { dir: "V" },
    sizeH: "FIXED",
    sizeV: "HUG",
    visible: s.sel,
    children: sections,
  });
}

// ---------- the toolbar ----------

/** os-ui's toolbar: each group shows the tool last picked from it (the chip's toolbar memory,
 * cpu/pick.ts), active while it is the tool. The base is the toolbar with the text tool active and
 * every other group showing its first tool; over a group's first, each other tool of the group as
 * captured idle (shown while the group remembers it); over all, each tool's button as captured
 * active. */
function toolbarLive(
  part: (id: string) => Layer[],
  d: DisplayLines,
  at: { x: number; y: number },
): LiveNode {
  const groupsOf = (layers: Layer[]) =>
    layers.filter((l) => isCls(l, "tgroup"));
  const buttonOf = (layers: Layer[], g: Layer) =>
    layers.find((l) => l.parent === g.id && isCls(l, "tool"))!;
  const toolOf = (l: Layer) => l.dom?.data?.["data-tool"];
  // the toolbar floats over the canvas cells: its buttons take the press themselves
  const clickable = (l: Layer, n: LiveNode): LiveNode => {
    const tool = toolOf(l);
    if (tool)
      return { ...n, acts: [{ on: "click", run: `tool/${tool}`, over: true }] };
    const menu = menuOf(l);
    return menu ? { ...n, acts: [{ on: "open", menu, over: true }] } : n;
  };
  // the base: the text tool's toolbar, with the text group's button from the move tool's
  const base = part("toolbar/text");
  const moveBar = part("toolbar/move");
  const textGroup = groupsOf(base).find(
    (g) => toolOf(buttonOf(base, g)) === "text",
  )!;
  const textIdle = buttonOf(
    moveBar,
    groupsOf(moveBar).find((g) => toolOf(buttonOf(moveBar, g)) === "text")!,
  );
  const textActive = buttonOf(base, textGroup);
  const root = base.find((l) => l.parent == null)!;
  /** The group of several tools a tool belongs to. */
  const groupOf = (tool: string) =>
    PICK_NAMES.find((g) =>
      (PICK_GROUPS[g] as readonly number[]).includes(
        (TOOL_NAMES as readonly string[]).indexOf(tool),
      ),
    );
  const bar = captured(base, root, at, {
    skip: (l) => l.id === textActive.id || l.parent === textActive.id,
    edit: (l, n) => {
      if (l.id !== textGroup.id) {
        // a group's first tool shows until another of its tools is picked
        const g = isCls(l, "tool") ? groupOf(toolOf(l) ?? "") : undefined;
        return g
          ? { ...clickable(l, n), visible: d.pick[g][0] }
          : clickable(l, n);
      }
      // the idle text button in place of the active one
      const idle = captured(
        moveBar,
        textIdle,
        { x: l.x, y: l.y },
        { edit: clickable },
      );
      return { ...n, children: [idle, ...(n.children ?? [])] };
    },
  });
  const idles = PICK_NAMES.flatMap((g) =>
    PICK_GROUPS[g].slice(1).map((code, k): LiveNode => {
      const t = TOOL_NAMES[code];
      const layers = part(`toolbar/idle/${t}`);
      const idle = layers.find((l) => isCls(l, "tool") && toolOf(l) === t);
      if (!idle)
        throw new Error(`the toolbar remembering ${t} does not show it`);
      return {
        ...captured(
          layers,
          idle,
          { x: root.x, y: root.y },
          { edit: clickable },
        ),
        name: `${t} idle`,
        visible: d.pick[g][k + 1],
      };
    }),
  );
  const overlays = TOOL_NAMES.map((t, code) => {
    const layers = part(`toolbar/${t}`);
    const active = layers.find((l) => isCls(l, "tool") && isCls(l, "active"));
    if (!active) throw new Error(`the toolbar of ${t} shows no active tool`);
    return {
      ...captured(
        layers,
        active,
        { x: root.x, y: root.y },
        { edit: clickable },
      ),
      name: `${t} active`,
      visible: d.tool[code],
    };
  });
  return {
    ...bar,
    name: "toolbar",
    // a click on the pill between its buttons does nothing, as in os-ui
    acts: [{ on: "block" }],
    children: [...(bar.children ?? []), ...idles, ...overlays],
  };
}

/** The menu a layer opens (data-menu "main", "file", "fly:shape"…; the Actions button opens ⌘K). */
export function menuOf(l: Layer): string | undefined {
  const m = l.dom?.data?.["data-menu"];
  if (m) return m.startsWith("fly:") ? `fly/${m.slice(4)}` : m;
  if (l.dom?.data?.["data-cmd"] === "palette") return "palette";
  return undefined;
}

// ---------- the whole screen ----------

export interface LiveScreen {
  root: LiveNode;
  /** Key shortcuts: on the live frame itself. */
  keys: Array<{ codes: number[]; run: string }>;
}

/** The live screen from os-ui's captures and the chip's screen lines. `keys`: run name → chord. */
export function liveScreen(
  data: CaptureData,
  d: DisplayLines,
  keys: Map<string, number[]>,
): LiveScreen {
  const screen = (id: string) => {
    const s = data.screens.screens.find((x) => x.id === id);
    if (!s) throw new Error(`the capture has no screen ${id}`);
    return screenLayers(data.screens, s);
  };
  const part = (id: string) => {
    const p = data.parts.parts[id];
    if (!p)
      throw new Error(
        `the capture has no part ${id} (node osui/capture/capture.mjs --parts)`,
      );
    return screenLayers(
      { ...data.parts, viewport: [1440, 900], screens: [] },
      { id, title: id, layers: p },
    );
  };
  const base = screen("default");
  const selected = screen("frame-selected");
  const styled = screen("star-styled");
  const hidden = screen("row-hidden");
  const shapes = screen("shapes");

  const canvas = byDom(
    base,
    (l) => isCls(l, "canvas") && l.name.startsWith("main"),
    "canvas",
  );
  const at = slotOrigin(canvas);
  const toolbar = byDom(base, (l) => l.dom?.id === "toolbar", "toolbar");
  const artboard = byDom(base, (l) => l.dom?.id === "artboard", "artboard");
  const rulerX = byDom(base, (l) => isCls(l, "ruler-x"), "x ruler");
  const rulerY = byDom(base, (l) => isCls(l, "ruler-y"), "y ruler");
  const leftBody = byDom(base, (l) => l.dom?.id === "left", "layers panel");
  const rightBody = byDom(base, (l) => l.dom?.id === "right", "design panel");
  const count = byDom(base, (l) => isCls(l, "count"), "layer count");
  const countText = byDom(
    base,
    (l) => l.parent === count.id && l.type === "TEXT",
    "layer count text",
  );
  const empty = byDom(base, (l) => isCls(l, "empty"), "empty layers text");

  // looks taken from other captures
  const tagLook = byDom(selected, (l) => isCls(l, "size-tag"), "size tag");
  const tagText = byDom(
    selected,
    (l) => l.parent === tagLook.id && l.type === "TEXT",
    "size tag text",
  );
  const handleLooks = CORNERS.map((c) =>
    byDom(selected, (l) => isCls(l, "handle") && isCls(l, c), `handle ${c}`),
  );
  const labelText = (layers: Layer[], what: string) =>
    byDom(
      layers,
      (l) =>
        l.type === "TEXT" &&
        /^Frame/.test(l.text?.chars ?? "") &&
        layers.find((p) => p.id === l.parent)?.name === "span.name",
      what,
    );
  const labelSel = labelText(selected, "selected frame label");
  const labelPlain = labelText(shapes, "frame label");
  const band = byDom(selected, (l) => isCls(l, "band"), "ruler band");
  const selectedRow = byDom(
    selected,
    (l) => isCls(l, "row") && isCls(l, "selected"),
    "selected row",
  );
  const hiddenRow = byDom(
    hidden,
    (l) => isCls(l, "row") && isCls(l, "hidden"),
    "hidden row",
  );
  const vis = byDom(
    hidden,
    (v) => isCls(v, "vis") && v.parent === hiddenRow.id,
    "hidden row's eye",
  );
  const eyeOff = hidden.filter((l) => l.id === vis.id || l.parent === vis.id);
  const kinds = new Map<number, { row: Layer; icon: Layer; name: Layer }>();
  for (const src of [part("rows/a"), part("rows/b")])
    for (const row of src.filter((l) => isCls(l, "row"))) {
      const name = src.find(
        (l) =>
          l.type === "TEXT" &&
          src.find((p) => p.id === l.parent)?.parent === row.id,
      )!;
      const label = name.text!.chars.replace(/ \d+$/, "");
      const k = Number(
        Object.keys(KIND_LABEL).find(
          (key) => KIND_LABEL[Number(key)] === label,
        ),
      );
      const icon = src.find((l) => l.parent === row.id && l.name === "svg")!;
      kinds.set(k, { row, icon, name });
    }
  for (const k of KINDS)
    if (!kinds.has(k))
      throw new Error(`no captured layer row for ${KIND_LABEL[k]}`);

  // the canvas: os-ui's layers, their labels and the selection, then the cells that take the
  // pointer, then the handles over them
  const canvasLive = frame("live canvas", {
    x: 0,
    y: 0,
    w: canvas.w,
    h: canvas.h,
    children: [
      ...d.slots.map((s, i) => slotShape(s, i, at)),
      ...d.slots.map((s, i) =>
        slotLabel(s, d.selN[i], i, at, { plain: labelPlain, sel: labelSel }),
      ),
      ...d.slots.map((s, i) => slotSelection(s, i, at, tagText)),
      frame("cells", {
        x: ORIGIN.x - canvas.x,
        y: ORIGIN.y - canvas.y,
        w: GRID * CELL,
        h: GRID * CELL,
        children: Array.from({ length: GRID * GRID }, (_, k) => {
          const [c, r] = [k % GRID, Math.floor(k / GRID)];
          return frame(`cell ${c},${r}`, {
            x: c * CELL,
            y: r * CELL,
            w: CELL,
            h: CELL,
            acts: [
              { on: "press", cell: [c, r] },
              { on: "release", cell: [c, r] },
            ],
          });
        }),
      }),
      ...d.slots.map((s, i) => slotHandles(s, i, at, handleLooks)),
    ],
  });
  const toolbarNode = toolbarLive(part, d, { x: canvas.x, y: canvas.y });

  // left panel: the live count, the empty text, the rows front to back
  const rowsLive = frame("rows", {
    x: selectedRow.x - leftBody.x,
    y: selectedRow.y - leftBody.y,
    w: selectedRow.w,
    layout: { dir: "V" },
    sizeH: "FIXED",
    sizeV: "HUG",
    children: [...d.slots.keys()].reverse().map((i) =>
      layerRow(d.slots[i], i, {
        kinds,
        selected: selectedRow,
        hiddenRow,
        eyeOff,
      }),
    ),
  });

  const root = captured(
    base,
    base.find((l) => l.parent == null)!,
    { x: 0, y: 0 },
    {
      skip: (l) => l.id === toolbar.id || l.parent === count.id,
      edit: (l, n) => {
        if (l.id === canvas.id) {
          // the live canvas right above the artboard, under the toolbar and the rulers
          const kids = n.children ?? [];
          const k = kids.findIndex((c) => c.layer?.id === artboard.id);
          return {
            ...n,
            children: [
              ...kids.slice(0, k + 1),
              canvasLive,
              toolbarNode,
              ...kids.slice(k + 1),
            ],
          };
        }
        if (l.id === rulerX.id)
          return {
            ...n,
            children: [
              ...(n.children ?? []),
              ...d.slots.map((s, i) =>
                rulerBand("x", s, i, at.x + canvas.x - rulerX.x, band),
              ),
            ],
          };
        if (l.id === rulerY.id)
          return {
            ...n,
            children: [
              ...(n.children ?? []),
              ...d.slots.map((s, i) =>
                rulerBand("y", s, i, at.y + canvas.y - rulerY.y, band),
              ),
            ],
          };
        if (l.id === count.id)
          return {
            ...n,
            children: d.n.map((line, k) =>
              text(`${k}/8`, `${k}/8`, lookOf(countText), {
                // right-aligned to the captured count's right edge
                x: count.w - 40,
                y: countText.y - count.y,
                text: {
                  chars: `${k}/8`,
                  ...lookOf(countText),
                  align: "RIGHT",
                  width: 40,
                },
                visible: line,
              }),
            ),
          };
        if (l.id === empty.id) return { ...n, visible: d.n[0] };
        const opener = menuOf(l);
        if (opener) return { ...n, acts: [{ on: "open", menu: opener }] };
        if (l.id === leftBody.id)
          return { ...n, children: [...(n.children ?? []), rowsLive] };
        if (l.id === rightBody.id) {
          // nothing selected: the canvas, the palette as styles, export
          const none: LiveNode = {
            ...mapTree(n, (node) =>
              node.layer && isCls(node.layer, "palette")
                ? paletteLive(node, d.fill, (k) => `swatch/${k}@none`)
                : node,
            ),
            x: 0,
            y: 0,
            visible: d.noSel,
          };
          const panelOf = (layers: Layer[]) => ({
            layers,
            panel: byDom(layers, (p) => p.dom?.id === "right", "design panel"),
          });
          const sel = panelOf(selected);
          const sty = panelOf(styled);
          return frame("design panels", {
            x: n.x,
            y: n.y,
            w: l.w,
            h: l.h,
            children: [
              none,
              ...d.slots.map((s, i) => designPanel(s, i, sel, sty)),
            ],
          });
        }
        return n;
      },
    },
  );
  void ON;
  return {
    root: { ...root, name: LIVE },
    keys: [...keys.entries()].map(([run, codes]) => ({ codes, run })),
  };
}
