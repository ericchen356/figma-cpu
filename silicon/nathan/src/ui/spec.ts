// The Figma OS editor screen as DATA: a tree of node descriptions that a generic renderer
// (render.ts) turns into Figma frames, bindings and reactions. Nothing here touches Figma, so the
// layout is unit-tested in Node. Everything that moves is bound to a net of the machine by name
// (visibleNet) and everything clickable runs a named reaction from the catalogue (react/catalog).
//
// The screen has no code and no numbers: positions come from binary-weighted spacer frames inside
// auto-layout boxes, bound to register bits (see model/screen.ts); a colour, a kind or the selected
// layer is one leaf of a tree of frames picked by the bits and their inverses.
import {
  HOT,
  LAYERS,
  PALETTE_SIZE,
  SCREEN_NETS,
  STATE_NETS,
  TOOL_BITS,
} from "../hw/layout";
import { GRID_H, GRID_W } from "../model/reference";
import { clickRun, HOTSPOT_GESTURE, HOTSPOT_GRAIN, hoverRun, PAINT_SET } from "../react/catalog";
import { type IconName, svgIcon } from "./icons";

/** PICO-8, same as spec/palette.json and os-ui. */
export const PALETTE_HEX = [
  "#000000",
  "#1D2B53",
  "#7E2553",
  "#008751",
  "#AB5236",
  "#5F574F",
  "#C2C3C7",
  "#FFF1E8",
  "#FF004D",
  "#FFA300",
  "#FFEC27",
  "#00E436",
  "#29ADFF",
  "#83769C",
  "#FF77A8",
  "#FFCCAA",
];

/** Colours measured from the real editor (os-ui/src/chrome look). */
export const COLOR = {
  canvas: "#1E1E1E",
  panel: "#2C2C2C",
  field: "#383838",
  selected: "#394360",
  accent: "#0C8CE9",
  text: "#FFFFFF",
  dim: "#B3B3B3",
  faint: "#808080",
  line: "#444444",
  grid: "#2A2A2A",
  frame: "#1E1E1E",
  /** The pen's ink. */
  ink: "#F5F5F5",
};

// The editor is a 1440 × 810 (16:9) screen laid out like Figma's UI3 (os-ui's reference frames):
// the left rail and Layers panel, the canvas with its rulers and the floating toolbar, the Design
// panel. 16:9 is wider than a laptop's Present view, so the whole frame shows at once: a frame
// taller than the view scrolls, and the viewer then turns a drag into a scroll of the whole screen
// (measured: even a drag that starts on a layer with a MOUSE_DOWN reaction).
export const CELL = 56;
export const CANVAS_W = GRID_W * CELL;
export const CANVAS_H = GRID_H * CELL;
const RAIL_W = 56;
const LEFT_W = 240;
const RIGHT_W = 242;
const RULER = 20;
export const UI_W = 1440;
export const UI_H = 810;
/** The canvas region between the panels (rulers included). */
const MID_X = RAIL_W + LEFT_W;
const MID_W = UI_W - MID_X - RIGHT_W;
export const CANVAS_X = MID_X + RULER + Math.round((MID_W - RULER - CANVAS_W) / 2);
export const CANVAS_Y = 84;
const BAR_H = 48;
const BAR_Y = UI_H - 16 - BAR_H;

export type Sizing = "FIXED" | "HUG" | "FILL";

export interface LayoutSpec {
  dir: "H" | "V";
  gap?: number;
  pad?: number;
  main?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  cross?: "MIN" | "CENTER" | "MAX";
}

/** What a layer does when clicked / hovered / pressed / released / a key is pressed. The canvas
 * takes the mouse button's press (`down`) and release (`up`) apart, so a drag is one gesture: the
 * viewer fires MOUSE_DOWN on the layer under the press and MOUSE_UP on the one under the release
 * (one that the press made visible included), and no MOUSE_ENTER while the button is held. */
export type Trigger =
  | { on: "click" }
  | { on: "enter" }
  | { on: "down" }
  | { on: "up" }
  | { on: "key"; codes: number[] };
export interface ReactionRef {
  trigger: Trigger;
  /** A catalogue reaction ("tool/2", "paint/3/5" on hover), a pointer-column setter ("pointer/3"), or
   * a jump to another frame ("go/machine"). */
  run: string;
  /** Store the pointer's column (this one) before the run: on a canvas cell's hover or release, so
   * a press that follows without the pointer moving finds the column (no hover fires during a drag). */
  pointer?: number;
}

export interface NodeSpec {
  type: "frame" | "rect" | "ellipse" | "text" | "svg";
  name: string;
  /** An icon: an SVG document (type "svg"), drawn at its own width and height. */
  svg?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fill?: string;
  stroke?: string;
  strokeWeight?: number;
  radius?: number;
  clip?: boolean;
  layout?: LayoutSpec;
  /** Sizing as a child of an auto-layout parent (default FIXED). An auto-layout frame outside a
   * flow may HUG its content. */
  sizeH?: Sizing;
  sizeV?: Sizing;
  /** Auto-layout child that does not take part in the flow. */
  absolute?: boolean;
  text?: { chars: string; size?: number; bold?: boolean; color?: string };
  /** Bind the layer's visibility to the variable of this net. */
  visibleNet?: string;
  /** Static: not visible at all. */
  hidden?: boolean;
  reactions?: ReactionRef[];
  children?: NodeSpec[];
}

const frame = (name: string, p: Partial<NodeSpec> = {}): NodeSpec => ({
  type: "frame",
  name,
  ...p,
});
const rect = (name: string, p: Partial<NodeSpec> = {}): NodeSpec => ({
  type: "rect",
  name,
  ...p,
});
const label = (
  name: string,
  chars: string,
  p: Partial<NodeSpec> & { size?: number; bold?: boolean; color?: string } = {},
): NodeSpec => {
  const { size, bold, color, ...rest } = p;
  return { type: "text", name, text: { chars, size, bold, color }, ...rest };
};

const bit = (bus: string, i: number) => `${bus}[${i}]`;

// ---------- building blocks: spacers, placement, picking ----------

/** Size of an invisible frame in the direction it does not measure. */
const THIN = 0.01;
const bits = (net: string) => (i: number) => bit(net, i);

/** `n` frames of 1, 2, 4 … `unit` along `dir`; frame i is visible when net i is 1. Hidden frames take no
 * room in an auto layout, so the visible ones add up to the value. */
function spacer(
  prefix: string,
  dir: "H" | "V",
  unit: number,
  n: number,
  netOf: (i: number) => string,
): NodeSpec[] {
  return Array.from({ length: n }, (_, i) =>
    frame(`${prefix}${i}`, {
      w: dir === "H" ? unit << i : THIN,
      h: dir === "H" ? THIN : unit << i,
      visibleNet: netOf(i),
    }),
  );
}

/** The nets of a rectangle's four 4-bit coordinates, bit by bit. */
export interface PlaceNets {
  x0: (i: number) => string;
  x1: (i: number) => string;
  y0: (i: number) => string;
  y1: (i: number) => string;
}

/** Layer k's rectangle registers. */
const layerNets = (k: number): PlaceNets => ({
  x0: bits(STATE_NETS.x0(k)),
  x1: bits(STATE_NETS.x1(k)),
  y0: bits(STATE_NETS.y0(k)),
  y1: bits(STATE_NETS.y1(k)),
});

/** A rectangle [x0, x1) × [y0, y1) cells straight from the register bits, no arithmetic: the y1 spacers
 * give the frame its height and the content starts under the y0 spacers; inside, the x1 spacers give
 * the width and `body` starts after the x0 spacers. (A fill-container child takes the size of its
 * hug parent's cross axis, which the spacers set.) `inner` goes on the part below the y0 spacers. */
export function placedBy(
  name: string,
  nets: PlaceNets,
  unit: number,
  body: NodeSpec,
  inner: Partial<NodeSpec> = {},
): NodeSpec {
  return frame(name, {
    x: 0,
    y: 0,
    layout: { dir: "H" },
    sizeH: "HUG",
    sizeV: "HUG",
    children: [
      frame("y1", {
        layout: { dir: "V" },
        sizeH: "HUG",
        sizeV: "HUG",
        children: spacer("y1/", "V", unit, 4, nets.y1),
      }),
      frame("col", {
        layout: { dir: "V" },
        sizeH: "HUG",
        sizeV: "FILL",
        ...inner,
        children: [
          ...spacer("y0/", "V", unit, 4, nets.y0),
          frame("xbox", {
            layout: { dir: "V" },
            sizeH: "HUG",
            sizeV: "FILL",
            children: [
              frame("x1", {
                layout: { dir: "H" },
                sizeH: "HUG",
                sizeV: "HUG",
                children: spacer("x1/", "H", unit, 4, nets.x1),
              }),
              frame("row", {
                layout: { dir: "H" },
                sizeH: "FILL",
                sizeV: "FILL",
                children: [
                  ...spacer("x0/", "H", unit, 4, nets.x0),
                  { ...body, sizeH: "FILL", sizeV: "FILL" },
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

const placed = (
  name: string,
  k: number,
  body: NodeSpec,
  inner: Partial<NodeSpec> = {},
) => placedBy(name, layerNets(k), CELL, body, inner);

/** One of 2^n layers, picked by n bits without a decoder: one level of frames per bit, from the top
 * bit down; child 0 is visible on the bit's inverse line, child 1 on the bit, so exactly one leaf is
 * visible. `node` makes a level's frame around its two children, `leaf` the layer for value v. The
 * root is named `pick/<n-1>`, the levels below `pick/<i>`; callers rename the root. */
export function pick(
  n: number,
  bitNet: (i: number) => string,
  invNet: (i: number) => string,
  node: (name: string, children: NodeSpec[]) => NodeSpec,
  leaf: (v: number) => NodeSpec,
): NodeSpec {
  const level = (i: number, v: number): NodeSpec =>
    i < 0
      ? leaf(v)
      : node(`pick/${i}`, [
          { ...level(i - 1, v), visibleNet: invNet(i) },
          { ...level(i - 1, v | (1 << i)), visibleNet: bitNet(i) },
        ]);
  return level(n - 1, 0);
}

/** A pick level that fills its parent: in an auto layout, the one visible child takes all the room. */
const fillNode = (name: string, children: NodeSpec[]): NodeSpec =>
  frame(name, { layout: { dir: "H" }, sizeH: "FILL", sizeV: "FILL", children });

/** A palette colour picked by 4 bits and their inverse lines; `leaf` draws one colour (by default
 * a rectangle of it). */
export function colourPick(
  bitNet: (i: number) => string,
  invNet: (i: number) => string,
  radius = 0,
  leaf?: (c: number) => NodeSpec,
): NodeSpec {
  return pick(
    4,
    bitNet,
    invNet,
    fillNode,
    leaf ??
      ((c) =>
        rect(`swatch/${c}`, {
          fill: PALETTE_HEX[c],
          radius,
          sizeH: "FILL",
          sizeV: "FILL",
        })),
  );
}

// ---------- one layer: a rectangle placed by its register bits ----------

/** A layer on the canvas: shown while the slot is used (the box) and visible (the inside). */
function layerBox(k: number): NodeSpec {
  return {
    ...placed(
      `layer/${k}`,
      k,
      {
        // one colour, drawn square or round by the kind (exactly one of the two shapes is visible)
        ...colourPick(
          bits(STATE_NETS.fill(k)),
          (i) => bit(SCREEN_NETS.nfill, 4 * k + i),
          0,
          (c) =>
            fillNode(`swatch/${c}`, [
              rect("rect", {
                fill: PALETTE_HEX[c],
                sizeH: "FILL",
                sizeV: "FILL",
                visibleNet: bit(SCREEN_NETS.nell, k),
              }),
              {
                type: "ellipse",
                name: "ellipse",
                fill: PALETTE_HEX[c],
                sizeH: "FILL",
                sizeV: "FILL",
                visibleNet: bit(SCREEN_NETS.ell, k),
              },
            ]),
        ),
        name: "body",
      },
      { visibleNet: STATE_NETS.vis(k) },
    ),
    visibleNet: STATE_NETS.used(k),
  };
}

const HANDLE = 12;
/** Selection outline and the four resize handles of a layer, above the click layers. Its handles
 * run the reactions made for slot `k` (the overlay only shows while `k` is selected). A handle
 * takes the press: dragging it to the new corner and releasing there resizes. */
function overlayBox(k: number): NodeSpec {
  const handle = (corner: string, code: number): NodeSpec =>
    frame(`handle/${corner}`, {
      w: HANDLE,
      h: HANDLE,
      fill: COLOR.text,
      stroke: COLOR.accent,
      strokeWeight: 2,
      reactions: [{ trigger: { on: "down" }, run: `handle/${code}@${k}` }],
    });
  const handleRow = (a: NodeSpec, b: NodeSpec): NodeSpec =>
    frame("handles", {
      sizeH: "FILL",
      h: HANDLE,
      layout: { dir: "H", main: "SPACE_BETWEEN" },
      children: [a, b],
    });
  return placed(
    `overlay/${k}`,
    k,
    frame("outline", {
      stroke: COLOR.accent,
      strokeWeight: 2,
      layout: { dir: "V", main: "SPACE_BETWEEN" },
      // corner codes: bit0 = west handle, bit1 = north handle
      children: [
        handleRow(handle("nw", 3), handle("ne", 2)),
        handleRow(handle("sw", 1), handle("se", 0)),
      ],
    }),
  );
}

/** The outline of the selected layer: the overlay of slot `sel`, picked by the sel bits, all of it
 * visible only while something is selected. */
function selection(): NodeSpec {
  const level = (name: string, children: NodeSpec[]): NodeSpec =>
    frame(name, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, children });
  return {
    ...pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, overlayBox),
    name: "selection",
    visibleNet: STATE_NETS.hassel,
  };
}

// ---------- the canvas: grid, layers, click layers, overlays ----------

/** One set of click layers: a row of cells per canvas row. The set takes one half of a click
 * (HOTSPOT_GESTURE): the press (pick up, first corner, the pen down or up) or the release (drop,
 * opposite corner), so a drag is one gesture. Every cell stores its column when the pointer enters
 * it and when the button is released over it: the set showing changes under a pointer that stays put
 * (a pick-up shows the drop's set), no hover fires while the button is held, and the next press must
 * still find the column. In a per-row set the row takes the press (a press on a cell goes to its row,
 * the cell having none of its own), running the reaction made for that row with the stored column.
 * In a per-cell set each cell takes its own, with its column built in. On the pen-down set,
 * entering a cell or releasing over it inks it (the pen's stroke). A per-slot set is 8 stacked
 * copies picked by the selection register's bits, like the per-slot buttons. */
function hotspotSet(i: number): NodeSpec {
  const grain = HOTSPOT_GRAIN[i];
  const gesture = HOTSPOT_GESTURE[i];
  const cellReactions = (r: number, c: number): ReactionRef[] => {
    const hover = hoverRun(i, r, c);
    const own = grain === "cell" ? clickRun(i, r, c) : null;
    // the release: the set's own (a drop, a corner), the stroke on the pen-down set, else the column
    const up = own && gesture === "up" ? own : i === PAINT_SET ? hover : `pointer/${c}`;
    const storing = (run: string) => (run.startsWith("pointer/") ? {} : { pointer: c });
    return [
      ...(own && gesture === "down" ? [{ trigger: { on: "down" as const }, run: own }] : []),
      { trigger: { on: "enter" }, run: hover, ...storing(hover) },
      // a per-row set's row takes its release itself
      ...(grain !== "cell" && gesture === "up" ? [] : [{ trigger: { on: "up" as const }, run: up, ...storing(up) }]),
    ];
  };
  const rows = (sel: number): NodeSpec[] =>
    Array.from({ length: GRID_H }, (_, r) =>
      frame(`row/${r}`, {
        x: 0,
        y: r * CELL,
        w: CANVAS_W,
        h: CELL,
        ...(grain === "cell" ? {} : { reactions: [{ trigger: { on: gesture }, run: clickRun(i, r, 0, sel) }] }),
        children: Array.from({ length: GRID_W }, (_, c) =>
          frame(`cell/${c}`, {
            x: c * CELL,
            y: 0,
            w: CELL,
            h: CELL,
            reactions: cellReactions(r, c),
          }),
        ),
      }),
    );
  const level = (name: string, children: NodeSpec[]): NodeSpec =>
    frame(name, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, children });
  return frame(`hot/${HOT[i]}`, {
    x: 0,
    y: 0,
    w: CANVAS_W,
    h: CANVAS_H,
    visibleNet: bit(SCREEN_NETS.hot, i),
    children:
      grain === "row@sel"
        ? [{ ...pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, (k) => level(`sel/${k}`, rows(k))), name: "slots" }]
        : rows(0),
  });
}

/** The paint plane: one cell-sized rectangle of ink per pixel, visible on its RAM bit. Above the
 * layers, below the click layers and the selection outline. */
function inkLayer(): NodeSpec {
  return frame("ink", {
    x: 0,
    y: 0,
    w: CANVAS_W,
    h: CANVAS_H,
    children: Array.from({ length: GRID_W * GRID_H }, (_, i) =>
      rect(`ink/${i}`, {
        x: (i % GRID_W) * CELL,
        y: Math.floor(i / GRID_W) * CELL,
        w: CELL,
        h: CELL,
        fill: COLOR.ink,
        visibleNet: bit(STATE_NETS.pix, i),
      }),
    ),
  });
}

function canvas(): NodeSpec {
  const grid: NodeSpec[] = [];
  for (let c = 1; c < GRID_W; c++)
    grid.push(
      rect(`grid/x${c}`, {
        x: c * CELL,
        y: 0,
        w: 1,
        h: CANVAS_H,
        fill: COLOR.grid,
      }),
    );
  for (let r = 1; r < GRID_H; r++)
    grid.push(
      rect(`grid/y${r}`, {
        x: 0,
        y: r * CELL,
        w: CANVAS_W,
        h: 1,
        fill: COLOR.grid,
      }),
    );
  return frame("canvas", {
    x: CANVAS_X,
    y: CANVAS_Y,
    w: CANVAS_W,
    h: CANVAS_H,
    fill: COLOR.canvas,
    stroke: COLOR.line,
    strokeWeight: 1,
    clip: true,
    children: [
      ...grid,
      ...Array.from({ length: LAYERS }, (_, k) => layerBox(k)),
      inkLayer(),
      ...HOT.map((_, i) => hotspotSet(i)),
      selection(),
    ],
  });
}

// ---------- the chrome: rail, panels, rulers, toolbar ----------

const icon = (
  name: string,
  ic: IconName,
  x: number,
  y: number,
  size = 24,
  color: string = COLOR.text,
  p: Partial<NodeSpec> = {},
): NodeSpec => ({ type: "svg", name, svg: svgIcon(ic, size, color), x, y, w: size, h: size, ...p });

const rule = (name: string, x: number, y: number, w: number, h: number): NodeSpec =>
  rect(name, { x, y, w, h, fill: COLOR.line });

/** The rail at the far left: the Figma mark and the File / Assets / Tools tabs (File is open). */
function rail(): NodeSpec {
  const tab = (name: string, ic: IconName, text: string, y: number, on = false, run?: string): NodeSpec[] => {
    const parts = [
      ...(on ? [rect(`${name}/on`, { x: 12, y, w: 32, h: 32, radius: 8, fill: COLOR.selected })] : []),
      icon(`${name}/icon`, ic, 18, y + 6, 20, on ? COLOR.text : COLOR.dim),
      label(`${name}/label`, text, { x: 28 - text.length * 2.6, y: y + 36, size: 10, color: on ? COLOR.text : COLOR.dim }),
    ];
    if (!run) return parts;
    return [
      frame(`tab/${name}`, {
        x: 0,
        y,
        w: RAIL_W - 1,
        h: 52,
        reactions: [{ trigger: { on: "click" }, run }],
        children: parts.map((p) => ({ ...p, y: (p.y ?? 0) - y })),
      }),
    ];
  };
  return frame("rail", {
    x: 0,
    y: 0,
    w: RAIL_W,
    h: UI_H,
    fill: COLOR.panel,
    children: [
      icon("logo", "logo", 16, 12, 24, COLOR.text),
      rule("divider", 18, 48, 20, 1),
      ...tab("file", "file", "File", 60, true),
      ...tab("assets", "assets", "Assets", 116),
      ...tab("machine", "cpu", "Gates", 172, false, "go/machine"),
      rule("edge", RAIL_W - 1, 0, 1, UI_H),
    ],
  });
}

const ROW_H = 32;
const ROWS_Y = 104;
function layerRow(k: number, r: number): NodeSpec {
  // Figma names a new layer by its kind and number ("Rectangle 3"); the row shows the kind's icon
  const ICONS: IconName[] = ["rect", "frame", "rect", "ellipse"];
  const entry = (v: number): NodeSpec =>
    frame(`name/${KIND_NAMES[v]}`, {
      layout: { dir: "H", gap: 8, cross: "CENTER" },
      sizeH: "HUG",
      sizeV: "HUG",
      children: [
        icon("icon", ICONS[v], 0, 0, 14, COLOR.dim),
        label("text", `${KIND_NAMES[v]} ${k + 1}`, {
          size: 11,
          color: COLOR.text,
          sizeH: "HUG",
          sizeV: "HUG",
        }),
      ],
    });
  const hug = (name: string, children: NodeSpec[]): NodeSpec =>
    frame(name, { layout: { dir: "H" }, sizeH: "HUG", sizeV: "HUG", children });
  const name: NodeSpec = {
    ...pick(2, bits(STATE_NETS.kind(k)), (i) => bit(SCREEN_NETS.nkind, 2 * k + i), hug, entry),
    name: "name",
    x: 24,
    y: 9,
    sizeH: "HUG",
    sizeV: "HUG",
  };
  return frame(`row/${k}`, {
    x: 0,
    y: ROWS_Y + r * ROW_H,
    w: LEFT_W,
    h: ROW_H,
    visibleNet: STATE_NETS.used(k),
    reactions: [{ trigger: { on: "click" }, run: `select/${k}` }],
    children: [
      name,
      frame("eye-hit", {
        x: LEFT_W - 44,
        y: 0,
        w: 32,
        h: ROW_H,
        reactions: [{ trigger: { on: "click" }, run: `vis/${k}` }],
        // a hidden layer's eye stays, dimmed; a visible layer's lights over it
        children: [
          icon("eye-dim", "eyeOff", 8, 8, 16, COLOR.faint),
          frame("eye", {
            x: 8,
            y: 8,
            w: 16,
            h: 16,
            fill: COLOR.panel,
            visibleNet: STATE_NETS.vis(k),
            children: [icon("glyph", "eye", 0, 0, 16, COLOR.dim)],
          }),
        ],
      }),
    ],
  });
}

/** Layer-panel names by kind code (0 is an empty slot, whose row is hidden). */
export const KIND_NAMES = ["Layer", "Frame", "Rectangle", "Ellipse"];

function leftPanel(): NodeSpec {
  return frame("layers", {
    x: RAIL_W,
    y: 0,
    w: LEFT_W,
    h: UI_H,
    fill: COLOR.panel,
    children: [
      label("file", "Untitled", { x: 16, y: 15, size: 13, bold: true, color: COLOR.text }),
      icon("file-menu", "chevDown", 80, 18, 14, COLOR.dim),
      label("project", "Drafts", { x: 16, y: 40, size: 11, color: COLOR.dim }),
      icon("sidebar", "sidebar", LEFT_W - 36, 14, 20, COLOR.dim),
      rule("rule", 0, 64, LEFT_W, 1),
      label("title", "Layers", { x: 16, y: 78, size: 11, bold: true, color: COLOR.text }),
      // the selected row's highlight: rows are listed top = slot 7, so its row is ¬sel
      frame("highlight", {
        x: 8,
        y: ROWS_Y + 4,
        w: LEFT_W - 16,
        h: 24,
        layout: { dir: "V" },
        sizeH: "FIXED",
        sizeV: "HUG",
        visibleNet: STATE_NETS.hassel,
        children: [
          ...spacer("nsel/", "V", ROW_H, 3, bits(SCREEN_NETS.nsel)),
          rect("bar", { w: LEFT_W - 16, h: 24, radius: 5, fill: COLOR.selected }),
        ],
      }),
      ...Array.from({ length: LAYERS }, (_, r) => layerRow(LAYERS - 1 - r, r)),
      rule("edge", LEFT_W - 1, 0, 1, UI_H),
    ],
  });
}

/** The rulers along the canvas region's top and left, numbered in cells from the drawing's corner. */
function rulers(): NodeSpec[] {
  const top: NodeSpec[] = [];
  const left: NodeSpec[] = [];
  for (let c = 0; c <= GRID_W; c += 2) {
    const x = CANVAS_X - MID_X + c * CELL;
    top.push(rule(`tick/${c}`, x, RULER - 6, 1, 6));
    top.push(label(`n/${c}`, String(c), { x: x + 3, y: 3, size: 9, color: COLOR.faint }));
  }
  for (let r = 0; r <= GRID_H; r += 2) {
    const y = CANVAS_Y + r * CELL;
    left.push(rule(`tick/${r}`, RULER - 6, y, 6, 1));
    left.push(label(`n/${r}`, String(r), { x: 3, y: y + 3, size: 9, color: COLOR.faint }));
  }
  return [
    frame("ruler/top", {
      x: MID_X,
      y: 0,
      w: MID_W,
      h: RULER,
      fill: COLOR.panel,
      children: [...top, rule("edge", 0, RULER - 1, MID_W, 1)],
    }),
    frame("ruler/left", {
      x: MID_X,
      y: RULER,
      w: RULER,
      h: UI_H - RULER,
      fill: COLOR.panel,
      children: [...left.map((n) => ({ ...n, y: (n.y ?? 0) - RULER })), rule("edge", RULER - 1, 0, 1, UI_H - RULER)],
    }),
    label("canvas-name", "Canvas · 14 × 10", { x: CANVAS_X, y: CANVAS_Y - 20, size: 11, color: COLOR.dim }),
  ];
}

function rightPanel(): NodeSpec {
  const sw = 24;
  const pitch = 26;
  // One swatch per value of the selection register, stacked and picked by its bits (like the
  // per-slot buttons): the one showing runs the fill reaction made for the selected slot.
  const swatch = (c: number, k: number): NodeSpec =>
    frame(`sel/${k}`, {
      x: 0,
      y: 0,
      w: sw,
      h: sw,
      radius: 4,
      fill: PALETTE_HEX[c],
      stroke: COLOR.line,
      strokeWeight: 1,
      reactions: [{ trigger: { on: "click" }, run: `fill/${c}@${k}` }],
    });
  const level = (n: string, children: NodeSpec[]): NodeSpec => frame(n, { x: 0, y: 0, w: sw, h: sw, children });
  const swatches = Array.from({ length: PALETTE_SIZE }, (_, c) => ({
    ...pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, (k) => swatch(c, k)),
    name: `color/${c}`,
    x: 16 + (c % 8) * pitch,
    y: 204 + Math.floor(c / 8) * pitch,
  }));
  const section = (name: string, text: string, y: number) =>
    label(name, text, { x: 16, y, size: 11, bold: true, color: COLOR.text });
  return frame("design", {
    x: UI_W - RIGHT_W,
    y: 0,
    w: RIGHT_W,
    h: UI_H,
    fill: COLOR.panel,
    children: [
      rule("edge", 0, 0, 1, UI_H),
      // the header: who is here, Present, and the way to the gates
      { type: "ellipse", name: "avatar", x: 16, y: 12, w: 24, h: 24, fill: "#0FA958" },
      label("avatar-initial", "N", { x: 24, y: 17, size: 11, bold: true, color: COLOR.text }),
      icon("account", "chevDown", 44, 18, 12, COLOR.dim),
      icon("present", "play", 120, 16, 16, COLOR.text),
      icon("present-menu", "chevDown", 138, 18, 12, COLOR.dim),
      frame("button/machine", {
        x: RIGHT_W - 8 - 76,
        y: 10,
        w: 76,
        h: 28,
        radius: 6,
        fill: COLOR.accent,
        reactions: [{ trigger: { on: "click" }, run: "go/machine" }],
        children: [label("label", "See gates", { x: 12, y: 7, size: 11, bold: true, color: COLOR.text })],
      }),
      frame("tab/design", {
        x: 8,
        y: 50,
        w: 56,
        h: 24,
        radius: 6,
        fill: COLOR.field,
        children: [label("label", "Design", { x: 9, y: 5, size: 11, bold: true, color: COLOR.text })],
      }),
      label("tab/prototype", "Prototype", { x: 74, y: 55, size: 11, color: COLOR.dim }),
      label("zoom", "100%", { x: RIGHT_W - 52, y: 55, size: 11, color: COLOR.dim }),
      icon("zoom-menu", "chevDown", RIGHT_W - 22, 56, 12, COLOR.dim),
      rule("rule/tabs", 0, 84, RIGHT_W, 1),
      section("fill", "Fill", 98),
      frame("fill-field", {
        x: 16,
        y: 122,
        w: RIGHT_W - 32,
        h: 28,
        radius: 5,
        fill: COLOR.field,
        children: [
          {
            ...colourPick(bits(STATE_NETS.cur), bits(SCREEN_NETS.ncur), 3),
            name: "current",
            x: 6,
            y: 6,
            w: 16,
            h: 16,
            radius: 3,
            clip: true,
            sizeH: "FIXED",
            sizeV: "FIXED",
          },
          {
            ...colourPick(bits(STATE_NETS.cur), bits(SCREEN_NETS.ncur), 0, (c) =>
              label(`hex/${c}`, PALETTE_HEX[c].slice(1), { size: 11, color: COLOR.text, sizeH: "HUG", sizeV: "HUG" }),
            ),
            name: "hex",
            x: 32,
            y: 7,
            sizeH: "HUG",
            sizeV: "HUG",
          },
          label("opacity", "100%", { x: RIGHT_W - 32 - 40, y: 7, size: 11, color: COLOR.dim }),
        ],
      }),
      rule("rule/fill", 0, 164, RIGHT_W, 1),
      section("colours", "Colours", 176),
      ...swatches,
      label("colours-hint", "Fills the selection and the next shape.", {
        x: 16,
        y: 262,
        size: 11,
        color: COLOR.faint,
      }),
      rule("rule/colours", 0, 288, RIGHT_W, 1),
      section("arrange", "Arrange", 300),
      ...arrangeButtons(),
      rule("rule/arrange", 0, 470, RIGHT_W, 1),
      section("shortcuts", "Shortcuts", 482),
      label(
        "keys",
        "V  move     F  frame     R  rectangle\nO  ellipse     P  pen     E  erase\nC  clear ink     D  duplicate     ⌫  delete\n[ ]  order     Arrows  nudge     Esc  cancel",
        { x: 16, y: 504, size: 11, color: COLOR.faint },
      ),
      label(
        "how",
        "Drag a layer to move it.\nDrag on the canvas to draw a shape.\nDrag a corner handle to resize.\nPen: press to start drawing, move\nthe mouse to ink, press to stop.",
        { x: 16, y: 584, size: 11, color: COLOR.dim },
      ),
    ],
  });
}

/** A labelled button of the right panel (every one is also a keyboard shortcut). */
function pushButton(
  name: string,
  text: string,
  x: number,
  y: number,
  w: number,
  run: string,
): NodeSpec {
  return frame(`button/${name}`, {
    x,
    y,
    w,
    h: 28,
    radius: 5,
    fill: COLOR.field,
    reactions: [{ trigger: { on: "click" }, run }],
    children: [
      label("label", text, {
        x: 10,
        y: 7,
        size: 11,
        color: COLOR.text,
      }),
    ],
  });
}

/** A button whose reaction is made for the selected slot: one per value of the selection register,
 * stacked and picked by its bits, so the one showing is the one for the slot (and only a visible
 * layer takes a click). */
function slotButton(
  name: string,
  text: string,
  x: number,
  y: number,
  w: number,
  run: string,
): NodeSpec {
  const level = (n: string, children: NodeSpec[]): NodeSpec =>
    frame(n, { x: 0, y: 0, w, h: 28, children });
  return {
    ...pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, (k) => ({
      ...pushButton(name, text, 0, 0, w, `${run}@${k}`),
      name: `sel/${k}`,
    })),
    name: `button/${name}`,
    x,
    y,
  };
}

function arrangeButtons(): NodeSpec[] {
  const big: Array<[string, string, string, boolean]> = [
    ["duplicate", "Duplicate", "dup", true],
    ["delete", "Delete", "delete", false],
    ["forward", "Bring forward", "fwd", true],
    ["backward", "Send backward", "back", true],
  ];
  const out = big.map(([n, t, run, perSlot], i) =>
    (perSlot ? slotButton : pushButton)(
      n,
      t,
      16 + (i % 2) * 107,
      324 + Math.floor(i / 2) * 36,
      103,
      run,
    ),
  );
  const arrows: Array<[string, string, string]> = [
    ["left", "←", "nudge/0"],
    ["right", "→", "nudge/1"],
    ["up", "↑", "nudge/2"],
    ["down", "↓", "nudge/3"],
  ];
  out.push(
    label("nudge", "Nudge one cell", {
      x: 16,
      y: 402,
      size: 11,
      color: COLOR.faint,
    }),
  );
  arrows.forEach(([n, t, run], i) =>
    out.push(slotButton(n, t, 16 + i * 53, 422, 49, run)),
  );
  return out;
}

const TOOL = 40;
const TOOL_PITCH = 44;
const TOOLS_W = 4 + 5 * TOOL_PITCH;
const OPTIONS_W = 4 + 2 * TOOL_PITCH;
const BAR_X = MID_X + RULER + Math.round((MID_W - RULER - (TOOLS_W + 8 + OPTIONS_W)) / 2);

/** The floating toolbar under the canvas, like UI3's: one icon per tool, the current one blue (the
 * highlight is moved by the tool register's bits). */
function toolbar(): NodeSpec {
  const tools: Array<{ name: string; icon: IconName }> = [
    { name: "Move", icon: "move" },
    { name: "Frame", icon: "frame" },
    { name: "Rectangle", icon: "rect" },
    { name: "Ellipse", icon: "ellipse" },
    { name: "Pen", icon: "pen" },
  ];
  return frame("toolbar", {
    x: BAR_X,
    y: BAR_Y,
    w: TOOLS_W,
    h: BAR_H,
    radius: 12,
    fill: COLOR.panel,
    stroke: COLOR.line,
    strokeWeight: 1,
    children: [
      frame("highlight", {
        x: 4,
        y: 4,
        layout: { dir: "H" },
        sizeH: "HUG",
        sizeV: "HUG",
        children: [
          ...spacer("t/", "H", TOOL_PITCH, TOOL_BITS, bits(STATE_NETS.tool)),
          rect("active", { w: TOOL, h: TOOL, radius: 8, fill: COLOR.accent }),
        ],
      }),
      ...tools.map((t, i) =>
        frame(`tool/${t.name}`, {
          x: 4 + i * TOOL_PITCH,
          y: 4,
          w: TOOL,
          h: TOOL,
          radius: 8,
          reactions: [{ trigger: { on: "click" }, run: `tool/${i}` }],
          children: [icon("icon", t.icon, 8, 8, 24)],
        }),
      ),
    ],
  });
}

/** The pen's options, beside the tools (where UI3 keeps its mode switcher): the Erase toggle (its
 * "on" layer is bound to the erase bit) and Clear. They work with any tool. */
function penOptions(): NodeSpec {
  const option = (name: string, ic: IconName, x: number, on?: NodeSpec): NodeSpec =>
    frame(`button/${name}`, {
      x,
      y: 4,
      w: TOOL,
      h: TOOL,
      radius: 8,
      reactions: [{ trigger: { on: "click" }, run: name }],
      children: [...(on ? [on] : []), icon("icon", ic, 8, 8, 24)],
    });
  return frame("pen", {
    x: BAR_X + TOOLS_W + 8,
    y: BAR_Y,
    w: OPTIONS_W,
    h: BAR_H,
    radius: 12,
    fill: COLOR.panel,
    stroke: COLOR.line,
    strokeWeight: 1,
    children: [
      option(
        "erase",
        "erase",
        4,
        rect("on", { x: 0, y: 0, w: TOOL, h: TOOL, radius: 8, fill: COLOR.accent, visibleNet: STATE_NETS.erase }),
      ),
      option("clear", "trash", 4 + TOOL_PITCH),
    ],
  });
}

/** What the canvas does now, centred above the toolbar: one line per click-layer set, shown with it. */
function status(): NodeSpec {
  const hint = [
    "Drag a layer to move it · click empty canvas to deselect",
    "Drag on the canvas to draw it · a click makes one cell",
    "Release where it goes · Esc cancels",
    "Release at the opposite corner · Esc cancels",
    "Pen: press on the canvas to start drawing",
    "Drawing: move to ink cells · press to stop · E erases · C clears",
  ];
  return frame("status", {
    x: MID_X + RULER,
    y: BAR_Y - 30,
    w: MID_W - RULER,
    h: 20,
    layout: { dir: "H", main: "CENTER", cross: "CENTER" },
    children: hint.map((t, i) =>
      label(`hint/${HOT[i]}`, t, {
        size: 12,
        color: COLOR.dim,
        sizeH: "HUG",
        sizeV: "HUG",
        visibleNet: bit(SCREEN_NETS.hot, i),
      }),
    ),
  });
}

/** Keyboard shortcuts: key codes → reactions (set on the top frame). */
export const KEYS: Array<{ codes: number[]; run: string }> = [
  { codes: [86], run: "tool/0" },
  { codes: [70], run: "tool/1" },
  { codes: [82], run: "tool/2" },
  { codes: [79], run: "tool/3" },
  { codes: [80], run: "tool/4" },
  { codes: [69], run: "erase" },
  { codes: [67], run: "clear" },
  // one key per reaction: Figma reads a keyCodes list as a chord (all held at once)
  { codes: [46], run: "delete" },
  { codes: [8], run: "delete" },
  { codes: [27], run: "esc" },
];

/** The shortcuts of the per-slot controls: D, [ and ], and the arrow keys (nudge). */
export const SLOT_KEYS = [
  { code: 68, run: "dup" },
  { code: 219, run: "back" },
  { code: 221, run: "fwd" },
  { code: 37, run: "nudge/0" },
  { code: 39, run: "nudge/1" },
  { code: 38, run: "nudge/2" },
  { code: 40, run: "nudge/3" },
] as const;

/** Those shortcuts, like the buttons: one reaction per slot, on a stack of 8 small layers picked by
 * the selection register's bits. Only a layer that shows takes a key (platform test 13), so the
 * one for the selected slot does. `fill` is the colour under it. */
export function slotKeys(fill: string): NodeSpec {
  const level = (name: string, children: NodeSpec[]): NodeSpec =>
    frame(name, { x: 0, y: 0, w: 8, h: 8, children });
  return {
    ...pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, (k) =>
      frame(`keys/${k}`, {
        x: 0,
        y: 0,
        w: 8,
        h: 8,
        fill,
        reactions: SLOT_KEYS.map((s) => ({
          trigger: { on: "key", codes: [s.code] },
          run: `${s.run}@${k}`,
        })),
      }),
    ),
    name: "shortcuts",
    x: 0,
    y: 0,
  };
}

/** The whole editor screen. */
export function uiSpec(): NodeSpec {
  return frame("editor", {
    x: 0,
    y: 0,
    w: UI_W,
    h: UI_H,
    fill: COLOR.frame,
    clip: true,
    children: [
      canvas(),
      ...rulers(),
      rail(),
      leftPanel(),
      status(),
      toolbar(),
      penOptions(),
      rightPanel(),
      slotKeys(COLOR.panel),
    ],
  });
}

/** Every reaction name the screen refers to (the catalogue must provide all of them, `pointer/…` and
 * `go/…` aside). */
export function reactionNames(spec: NodeSpec = uiSpec()): Set<string> {
  const out = new Set<string>();
  const walk = (n: NodeSpec) => {
    for (const r of n.reactions ?? [])
      if (!r.run.startsWith("pointer/") && !r.run.startsWith("go/")) out.add(r.run);
    n.children?.forEach(walk);
  };
  walk(spec);
  for (const k of KEYS) out.add(k.run);
  return out;
}

/** Every net name the screen binds to. */
export function boundNets(spec: NodeSpec = uiSpec()): Set<string> {
  const out = new Set<string>();
  const walk = (n: NodeSpec) => {
    if (n.visibleNet) out.add(n.visibleNet);
    n.children?.forEach(walk);
  };
  walk(spec);
  return out;
}
