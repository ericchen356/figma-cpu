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
import { clickRun, HOTSPOT_GRAIN, hoverRun } from "../react/catalog";

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
  grid: "#262626",
  frame: "#141414",
  /** The pen's ink. */
  ink: "#F5F5F5",
};

export const CELL = 48;
export const CANVAS_W = GRID_W * CELL;
export const CANVAS_H = GRID_H * CELL;
const LEFT_W = 240;
const RIGHT_W = 240;
const TOP_H = 48;
const MID_W = 720;
export const UI_W = LEFT_W + MID_W + RIGHT_W;
export const UI_H = 704;
export const CANVAS_X = LEFT_W + (MID_W - CANVAS_W) / 2;
export const CANVAS_Y = TOP_H + 32;

export type Sizing = "FIXED" | "HUG" | "FILL";

export interface LayoutSpec {
  dir: "H" | "V";
  gap?: number;
  pad?: number;
  main?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  cross?: "MIN" | "CENTER" | "MAX";
}

/** What a layer does when clicked / hovered / a key is pressed. */
export type Trigger =
  { on: "click" } | { on: "enter" } | { on: "key"; codes: number[] };
export interface ReactionRef {
  trigger: Trigger;
  /** A catalogue reaction ("tool/2", "paint/3/5" on hover), or a pointer-column setter ("pointer/3"). */
  run: string;
  /** A hover that stores the pointer's column (this one) before its run: "paint/…" on the pen-down
   * cells, so a click that follows without the pointer moving finds the column like after any hover. */
  pointer?: number;
}

export interface NodeSpec {
  type: "frame" | "rect" | "ellipse" | "text";
  name: string;
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
 * run the reactions made for slot `k` (the overlay only shows while `k` is selected). */
function overlayBox(k: number): NodeSpec {
  const handle = (corner: string, code: number): NodeSpec =>
    frame(`handle/${corner}`, {
      w: HANDLE,
      h: HANDLE,
      fill: COLOR.text,
      stroke: COLOR.accent,
      strokeWeight: 2,
      reactions: [{ trigger: { on: "click" }, run: `handle/${code}@${k}` }],
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

/** One set of click layers: a row of cells per canvas row. Hovering a cell, in any set, stores its
 * column: the set showing changes under a pointer that stays put (a pick-up shows the drop's set),
 * and the next click must still find it. In a per-row set the row takes the click (a click on a
 * cell goes to its row, the cell having no click of its own), running the reaction made for that
 * row with the stored column. In a per-cell set each cell takes its own click, with its column
 * built in; on the pen-down set, entering a cell also paints it (the pen's stroke). A per-slot set
 * is 8 stacked copies picked by the selection register's bits, like the per-slot buttons. */
function hotspotSet(i: number): NodeSpec {
  const grain = HOTSPOT_GRAIN[i];
  const cellReactions = (r: number, c: number): ReactionRef[] => {
    const hover = hoverRun(i, r, c);
    return [
      ...(grain === "cell" ? [{ trigger: { on: "click" as const }, run: clickRun(i, r, c) }] : []),
      { trigger: { on: "enter" }, run: hover, ...(hover.startsWith("pointer/") ? {} : { pointer: c }) },
    ];
  };
  const rows = (sel: number): NodeSpec[] =>
    Array.from({ length: GRID_H }, (_, r) =>
      frame(`row/${r}`, {
        x: 0,
        y: r * CELL,
        w: CANVAS_W,
        h: CELL,
        ...(grain === "cell" ? {} : { reactions: [{ trigger: { on: "click" as const }, run: clickRun(i, r, 0, sel) }] }),
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

// ---------- panels ----------

const ROW_H = 32;
function layerRow(k: number, r: number): NodeSpec {
  const eye = (bright: boolean): NodeSpec =>
    frame(bright ? "eye" : "eye-dim", {
      x: 14,
      y: 11,
      w: 16,
      h: 10,
      stroke: bright ? COLOR.text : COLOR.faint,
      strokeWeight: 1.5,
      radius: 5,
      ...(bright ? { visibleNet: STATE_NETS.vis(k) } : {}),
      children: [
        rect("pupil", {
          x: 5,
          y: 2,
          w: 6,
          h: 6,
          radius: 3,
          fill: bright ? COLOR.text : COLOR.faint,
        }),
      ],
    });
  const hug = (name: string, children: NodeSpec[]): NodeSpec =>
    frame(name, { layout: { dir: "H" }, sizeH: "HUG", sizeV: "HUG", children });
  const name: NodeSpec = {
    ...pick(
      2,
      bits(STATE_NETS.kind(k)),
      (i) => bit(SCREEN_NETS.nkind, 2 * k + i),
      hug,
      (v) =>
        label(`name/${KIND_NAMES[v]}`, KIND_NAMES[v], {
          size: 12,
          color: COLOR.text,
          sizeH: "HUG",
          sizeV: "HUG",
        }),
    ),
    name: "name",
    x: 76,
    y: 8,
    sizeH: "HUG",
    sizeV: "HUG",
  };
  return frame(`row/${k}`, {
    x: 0,
    y: TOP_H + 40 + r * ROW_H,
    w: LEFT_W,
    h: ROW_H,
    visibleNet: STATE_NETS.used(k),
    reactions: [{ trigger: { on: "click" }, run: `select/${k}` }],
    children: [
      frame("eye-hit", {
        x: 6,
        y: 0,
        w: 32,
        h: ROW_H,
        reactions: [{ trigger: { on: "click" }, run: `vis/${k}` }],
        children: [eye(false), eye(true)],
      }),
      label("slot", String(k + 1), {
        x: 50,
        y: 8,
        size: 12,
        color: COLOR.faint,
      }),
      name,
    ],
  });
}

/** Layer-panel names by kind code (0 is an empty slot, whose row is hidden). */
export const KIND_NAMES = ["Layer", "Frame", "Rectangle", "Ellipse"];

function leftPanel(): NodeSpec {
  return frame("layers", {
    x: 0,
    y: TOP_H,
    w: LEFT_W,
    h: UI_H - TOP_H,
    fill: COLOR.panel,
    children: [
      label("title", "Layers", {
        x: 16,
        y: 14,
        size: 12,
        bold: true,
        color: COLOR.text,
      }),
      rect("rule", { x: 0, y: 40, w: LEFT_W, h: 1, fill: COLOR.line }),
      // the selected row's highlight: rows are listed top = slot 7, so its row is ¬sel
      frame("highlight", {
        x: 8,
        y: 48,
        w: LEFT_W - 16,
        h: 24,
        layout: { dir: "V" },
        sizeH: "FIXED",
        sizeV: "HUG",
        visibleNet: STATE_NETS.hassel,
        children: [
          ...spacer("nsel/", "V", ROW_H, 3, bits(SCREEN_NETS.nsel)),
          rect("bar", {
            w: LEFT_W - 16,
            h: 24,
            radius: 5,
            fill: COLOR.selected,
          }),
        ],
      }),
      ...Array.from({ length: LAYERS }, (_, r) => ({
        ...layerRow(LAYERS - 1 - r, r),
        y: 48 + r * ROW_H,
      })),
    ],
  });
}

function rightPanel(): NodeSpec {
  const sw = 40;
  const gap = 8;
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
    x: 16 + (c % 4) * (sw + gap),
    y: 112 + Math.floor(c / 4) * (sw + gap),
  }));
  return frame("design", {
    x: UI_W - RIGHT_W,
    y: TOP_H,
    w: RIGHT_W,
    h: UI_H - TOP_H,
    fill: COLOR.panel,
    children: [
      label("title", "Design", {
        x: 16,
        y: 14,
        size: 12,
        bold: true,
        color: COLOR.text,
      }),
      rect("rule", { x: 0, y: 40, w: RIGHT_W, h: 1, fill: COLOR.line }),
      label("fill", "Fill", {
        x: 16,
        y: 56,
        size: 12,
        bold: true,
        color: COLOR.text,
      }),
      {
        ...colourPick(bits(STATE_NETS.cur), bits(SCREEN_NETS.ncur), 4),
        name: "current",
        x: 16,
        y: 76,
        w: 56,
        h: 24,
        radius: 4,
        stroke: COLOR.line,
        strokeWeight: 1,
        clip: true,
        sizeH: "FIXED",
        sizeV: "FIXED",
      },
      label("current-hint", "current colour", {
        x: 84,
        y: 82,
        size: 11,
        color: COLOR.faint,
      }),
      ...swatches,
      label("arrange", "Arrange", {
        x: 16,
        y: 320,
        size: 12,
        bold: true,
        color: COLOR.text,
      }),
      ...arrangeButtons(),
      label(
        "keys",
        "Shortcuts\nV F R O P  tools      Esc  cancel\n[ ]  send back / forward\nD  duplicate     Delete\nArrow keys  nudge\nE  erase     C  clear the ink",
        { x: 16, y: 520, size: 11, color: COLOR.faint },
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
        y: 8,
        size: 11,
        bold: true,
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
      16 + (i % 2) * 112,
      344 + Math.floor(i / 2) * 36,
      104,
      run,
    ),
  );
  const arrows: Array<[string, string, string]> = [
    ["left", "Left", "nudge/0"],
    ["right", "Right", "nudge/1"],
    ["up", "Up", "nudge/2"],
    ["down", "Down", "nudge/3"],
  ];
  out.push(
    label("nudge", "Nudge one cell", {
      x: 16,
      y: 426,
      size: 11,
      color: COLOR.faint,
    }),
  );
  arrows.forEach(([n, t, run], i) =>
    out.push(slotButton(n, t, 16 + i * 56, 446, 52, run)),
  );
  return out;
}

const TOOL_W = 100;
const TOOLS_W = 5 * TOOL_W + 4 * 8;
const OPTION_W = 72;
const OPTIONS_W = 2 * OPTION_W + 8;
const BAR_X = LEFT_W + (MID_W - (TOOLS_W + 12 + OPTIONS_W)) / 2;

function toolbar(): NodeSpec {
  const tools = [
    { name: "Move", key: "V" },
    { name: "Frame", key: "F" },
    { name: "Rectangle", key: "R" },
    { name: "Ellipse", key: "O" },
    { name: "Pen", key: "P" },
  ];
  const w = TOOL_W;
  return frame("toolbar", {
    x: BAR_X,
    y: CANVAS_Y + CANVAS_H + 24,
    w: TOOLS_W,
    h: 44,
    radius: 8,
    fill: COLOR.panel,
    stroke: COLOR.line,
    strokeWeight: 1,
    children: [
      frame("highlight", {
        x: 0,
        y: 0,
        layout: { dir: "H" },
        sizeH: "HUG",
        sizeV: "HUG",
        children: [
          ...spacer("t/", "H", w + 8, TOOL_BITS, bits(STATE_NETS.tool)),
          rect("active", { w, h: 44, radius: 8, fill: COLOR.accent }),
        ],
      }),
      ...tools.map((t, i) =>
      frame(`tool/${t.name}`, {
        x: i * (w + 8),
        y: 0,
        w,
        h: 44,
        radius: 8,
        reactions: [{ trigger: { on: "click" }, run: `tool/${i}` }],
        children: [
          label("label", t.name, {
            x: 10,
            y: 15,
            size: 12,
            bold: true,
            color: COLOR.text,
          }),
          label("key", t.key, { x: w - 18, y: 15, size: 11, color: COLOR.dim }),
        ],
      }),
      ),
    ],
  });
}

/** The pen's options, beside the tools: the Erase toggle (its "on" layer is bound to the erase bit)
 * and Clear. They work with any tool. */
function penOptions(): NodeSpec {
  const option = (
    name: string,
    text: string,
    key: string,
    x: number,
    on?: NodeSpec,
  ): NodeSpec =>
    frame(`button/${name}`, {
      x,
      y: 0,
      w: OPTION_W,
      h: 44,
      radius: 8,
      reactions: [{ trigger: { on: "click" }, run: name }],
      children: [
        ...(on ? [on] : []),
        label("label", text, {
          x: 10,
          y: 15,
          size: 12,
          bold: true,
          color: COLOR.text,
        }),
        label("key", key, {
          x: OPTION_W - 18,
          y: 15,
          size: 11,
          color: COLOR.dim,
        }),
      ],
    });
  return frame("pen", {
    x: BAR_X + TOOLS_W + 12,
    y: CANVAS_Y + CANVAS_H + 24,
    w: OPTIONS_W,
    h: 44,
    radius: 8,
    fill: COLOR.panel,
    stroke: COLOR.line,
    strokeWeight: 1,
    children: [
      option(
        "erase",
        "Erase",
        "E",
        0,
        rect("on", {
          x: 0,
          y: 0,
          w: OPTION_W,
          h: 44,
          radius: 8,
          fill: COLOR.accent,
          visibleNet: STATE_NETS.erase,
        }),
      ),
      option("clear", "Clear", "C", OPTION_W + 8),
    ],
  });
}

function status(): NodeSpec {
  const hint = [
    "Click a layer to pick it up, or click empty canvas to deselect",
    "Click a cell to start the shape",
    "Click the cell to drop it on (Esc cancels)",
    "Click the opposite corner (Esc cancels)",
    "Pen: click a cell to put the pen down (E erases, C clears)",
    "Drawing: move over cells to ink them, click to lift the pen",
  ];
  return frame("status", {
    x: LEFT_W,
    y: CANVAS_Y + CANVAS_H + 84,
    w: MID_W,
    h: 24,
    children: hint.map((t, i) =>
      label(`hint/${HOT[i]}`, t, {
        x: 0,
        y: 0,
        size: 12,
        color: COLOR.dim,
        visibleNet: bit(SCREEN_NETS.hot, i),
      }),
    ),
  });
}

function topBar(note: string): NodeSpec {
  return frame("topbar", {
    x: 0,
    y: 0,
    w: UI_W,
    h: TOP_H,
    fill: COLOR.panel,
    children: [
      label("file", "Drafts / Untitled", {
        x: 16,
        y: 17,
        size: 12,
        bold: true,
        color: COLOR.text,
      }),
      label("note", note, {
        x: UI_W - 420,
        y: 18,
        size: 11,
        color: COLOR.faint,
      }),
      rect("rule", { x: 0, y: TOP_H - 1, w: UI_W, h: 1, fill: COLOR.line }),
    ],
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

/** The whole editor screen. `note`, at the right of the top bar, says where its gates are (by
 * default under the editor, in the same frame). */
export function uiSpec(
  note = "every pixel of this screen is a gate-level machine — scroll down",
): NodeSpec {
  return frame("editor", {
    x: 0,
    y: 0,
    w: UI_W,
    h: UI_H,
    fill: COLOR.frame,
    clip: true,
    children: [
      topBar(note),
      leftPanel(),
      canvas(),
      toolbar(),
      penOptions(),
      status(),
      rightPanel(),
      slotKeys(COLOR.panel),
    ],
  });
}

/** Every reaction name the screen refers to (the catalogue must provide all of them, `pointer/…` aside). */
export function reactionNames(spec: NodeSpec = uiSpec()): Set<string> {
  const out = new Set<string>();
  const walk = (n: NodeSpec) => {
    for (const r of n.reactions ?? [])
      if (!r.run.startsWith("pointer/")) out.add(r.run);
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
