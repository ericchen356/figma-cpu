// The Figma OS editor screen as DATA: a tree of node descriptions that a generic renderer
// (render.ts) turns into Figma frames, bindings and reactions. Nothing here touches Figma, so the
// layout is unit-tested in Node. Everything that moves is bound to a net of the machine by name
// (visibleNet) and everything clickable runs a named reaction from the catalogue (react/catalog).
//
// The screen has no code and no numbers: positions come from four-frame binary-weighted spacers
// inside auto-layout boxes (see model/screen.ts), colours from stacked swatches, state from lamps.
import {
  HOT,
  LAYERS,
  PALETTE_SIZE,
  SCREEN_NETS,
  STATE_NETS,
} from "../hw/layout";
import { BOX_CELLS } from "../model/screen";
import { GRID_H, GRID_W } from "../model/reference";
import { HOTSPOT_REACTIONS } from "../react/catalog";

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
};

export const CELL = 48;
export const CANVAS_W = GRID_W * CELL;
export const CANVAS_H = GRID_H * CELL;
export const BOX_PX = BOX_CELLS * CELL;
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
  /** A catalogue reaction ("tool/2"), or a pointer-cell setter ("pointer/3,7"). */
  run: string;
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
  /** Sizing as a child of an auto-layout parent (default FIXED). */
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

// ---------- one layer: a rectangle placed by bit-driven spacers ----------

/** Four frames of 1, 2, 4, 8 cells; frame i is visible when bit i of its register is 1. Hidden frames take no
 * room in the auto layout, so the visible ones add up to the register's value. */
function spacer(
  prefix: string,
  dir: "H" | "V",
  netOf: (i: number) => string,
): NodeSpec[] {
  return [0, 1, 2, 3].map((i) =>
    frame(
      `${prefix}${i}`,
      dir === "H"
        ? {
            w: CELL << i,
            h: 1,
            sizeH: "FIXED",
            sizeV: "FILL",
            visibleNet: netOf(i),
          }
        : {
            w: BOX_PX,
            h: CELL << i,
            sizeH: "FILL",
            sizeV: "FIXED",
            visibleNet: netOf(i),
          },
    ),
  );
}

/** The box a layer's rectangle lives in: 15 × 15 cells, [top spacer | row | bottom spacer], the row
 * [left spacer | body | right spacer]. left = x0, right = ¬x1 (15 − x1), top = y0, bottom = ¬y1. */
function layerBox(k: number): NodeSpec {
  const swatches = Array.from({ length: PALETTE_SIZE }, (_, c) =>
    rect(`swatch/${c}`, {
      fill: PALETTE_HEX[c],
      sizeH: "FILL",
      sizeV: "FILL",
      visibleNet: bit(SCREEN_NETS.fill1h, k * PALETTE_SIZE + c),
    }),
  );
  return frame(`layer/${k}`, {
    w: BOX_PX,
    h: BOX_PX,
    layout: { dir: "V" },
    visibleNet: bit(SCREEN_NETS.show, k),
    children: [
      ...spacer("top", "V", (i) => bit(STATE_NETS.y0(k), i)),
      frame("row", {
        sizeH: "FILL",
        sizeV: "FILL",
        layout: { dir: "H" },
        children: [
          ...spacer("left", "H", (i) => bit(STATE_NETS.x0(k), i)),
          frame("body", {
            sizeH: "FILL",
            sizeV: "FILL",
            layout: { dir: "H" },
            children: swatches,
          }),
          ...spacer("right", "H", (i) => bit(SCREEN_NETS.nx1, k * 4 + i)),
        ],
      }),
      ...spacer("bottom", "V", (i) => bit(SCREEN_NETS.ny1, k * 4 + i)),
    ],
  });
}

const HANDLE = 12;
/** Selection outline and the four resize handles of a layer, above the click layers. */
function overlayBox(k: number): NodeSpec {
  const handle = (corner: string, code: number): NodeSpec =>
    frame(`handle/${corner}`, {
      w: HANDLE,
      h: HANDLE,
      fill: COLOR.text,
      stroke: COLOR.accent,
      strokeWeight: 2,
      reactions: [{ trigger: { on: "click" }, run: `handle/${code}` }],
    });
  const handleRow = (a: NodeSpec, b: NodeSpec): NodeSpec =>
    frame("handles", {
      sizeH: "FILL",
      h: HANDLE,
      layout: { dir: "H", main: "SPACE_BETWEEN" },
      children: [a, b],
    });
  return frame(`overlay/${k}`, {
    w: BOX_PX,
    h: BOX_PX,
    layout: { dir: "V" },
    visibleNet: bit(SCREEN_NETS.selk, k),
    children: [
      ...spacer("top", "V", (i) => bit(STATE_NETS.y0(k), i)),
      frame("row", {
        sizeH: "FILL",
        sizeV: "FILL",
        layout: { dir: "H" },
        children: [
          ...spacer("left", "H", (i) => bit(STATE_NETS.x0(k), i)),
          frame("outline", {
            sizeH: "FILL",
            sizeV: "FILL",
            stroke: COLOR.accent,
            strokeWeight: 2,
            layout: { dir: "V", main: "SPACE_BETWEEN" },
            // corner codes: bit0 = west handle, bit1 = north handle
            children: [
              handleRow(handle("nw", 3), handle("ne", 2)),
              handleRow(handle("sw", 1), handle("se", 0)),
            ],
          }),
          ...spacer("right", "H", (i) => bit(SCREEN_NETS.nx1, k * 4 + i)),
        ],
      }),
      ...spacer("bottom", "V", (i) => bit(SCREEN_NETS.ny1, k * 4 + i)),
    ],
  });
}

// ---------- the canvas: grid, layers, click layers, overlays ----------

/** One set of click layers: a cell per canvas cell. Hovering a cell stores its coordinates; the
 * set itself takes the click (clicks on a cell go to the set, the cell having no click of its own). */
function hotspotSet(i: number): NodeSpec {
  const cells: NodeSpec[] = [];
  for (let r = 0; r < GRID_H; r++)
    for (let c = 0; c < GRID_W; c++)
      cells.push(
        frame(`cell/${c},${r}`, {
          x: c * CELL,
          y: r * CELL,
          w: CELL,
          h: CELL,
          reactions: [{ trigger: { on: "enter" }, run: `pointer/${c},${r}` }],
        }),
      );
  return frame(`hot/${HOT[i]}`, {
    x: 0,
    y: 0,
    w: CANVAS_W,
    h: CANVAS_H,
    visibleNet: bit(SCREEN_NETS.hot, i),
    reactions: [{ trigger: { on: "click" }, run: HOTSPOT_REACTIONS[i] }],
    children: cells,
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
      ...Array.from({ length: LAYERS }, (_, k) => ({
        ...layerBox(k),
        x: 0,
        y: 0,
      })),
      ...HOT.map((_, i) => hotspotSet(i)),
      ...Array.from({ length: LAYERS }, (_, k) => ({
        ...overlayBox(k),
        x: 0,
        y: 0,
      })),
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
  const name = (text: string, net: string): NodeSpec =>
    label(`name/${text}`, text, {
      x: 76,
      y: 8,
      size: 12,
      color: COLOR.text,
      visibleNet: bit(net, k),
    });
  return frame(`row/${k}`, {
    x: 0,
    y: TOP_H + 40 + r * ROW_H,
    w: LEFT_W,
    h: ROW_H,
    visibleNet: STATE_NETS.used(k),
    reactions: [{ trigger: { on: "click" }, run: `select/${k}` }],
    children: [
      rect("selected", {
        x: 8,
        y: 0,
        w: LEFT_W - 16,
        h: 24,
        radius: 5,
        fill: COLOR.selected,
        visibleNet: bit(SCREEN_NETS.selk, k),
      }),
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
      name("Frame", SCREEN_NETS.kfr),
      name("Rectangle", SCREEN_NETS.kre),
      name("Ellipse", SCREEN_NETS.kel),
    ],
  });
}

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
  const swatches = Array.from({ length: PALETTE_SIZE }, (_, c) =>
    frame(`color/${c}`, {
      x: 16 + (c % 4) * (sw + gap),
      y: 112 + Math.floor(c / 4) * (sw + gap),
      w: sw,
      h: sw,
      radius: 4,
      fill: PALETTE_HEX[c],
      stroke: COLOR.line,
      strokeWeight: 1,
      reactions: [{ trigger: { on: "click" }, run: `fill/${c}` }],
    }),
  );
  const current = Array.from({ length: PALETTE_SIZE }, (_, c) =>
    rect(`current/${c}`, {
      x: 0,
      y: 0,
      w: 56,
      h: 24,
      radius: 4,
      fill: PALETTE_HEX[c],
      visibleNet: bit(SCREEN_NETS.cur1h, c),
    }),
  );
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
      frame("current", {
        x: 16,
        y: 76,
        w: 56,
        h: 24,
        radius: 4,
        stroke: COLOR.line,
        strokeWeight: 1,
        clip: true,
        children: current,
      }),
      label("current-hint", "current colour", {
        x: 84,
        y: 82,
        size: 11,
        color: COLOR.faint,
      }),
      ...swatches,
      label("arrange", "Arrange", { x: 16, y: 320, size: 12, bold: true, color: COLOR.text }),
      ...arrangeButtons(),
      label(
        "keys",
        "Shortcuts\nV F R O  tools      Esc  cancel\n[ ]  send back / forward\nD  duplicate     Delete\nArrow keys  nudge",
        { x: 16, y: 520, size: 11, color: COLOR.faint },
      ),
    ],
  });
}

/** A labelled button of the right panel (every one is also a keyboard shortcut). */
function pushButton(name: string, text: string, x: number, y: number, w: number, run: string): NodeSpec {
  return frame(`button/${name}`, {
    x,
    y,
    w,
    h: 28,
    radius: 5,
    fill: COLOR.field,
    reactions: [{ trigger: { on: "click" }, run }],
    children: [label("label", text, { x: 10, y: 8, size: 11, bold: true, color: COLOR.text })],
  });
}

function arrangeButtons(): NodeSpec[] {
  const big: Array<[string, string, string]> = [
    ["duplicate", "Duplicate", "dup"],
    ["delete", "Delete", "delete"],
    ["forward", "Bring forward", "fwd"],
    ["backward", "Send backward", "back"],
  ];
  const out = big.map(([n, t, run], i) => pushButton(n, t, 16 + (i % 2) * 112, 344 + Math.floor(i / 2) * 36, 104, run));
  const arrows: Array<[string, string, string]> = [
    ["left", "Left", "nudge/0"],
    ["right", "Right", "nudge/1"],
    ["up", "Up", "nudge/2"],
    ["down", "Down", "nudge/3"],
  ];
  out.push(label("nudge", "Nudge one cell", { x: 16, y: 426, size: 11, color: COLOR.faint }));
  arrows.forEach(([n, t, run], i) => out.push(pushButton(n, t, 16 + i * 56, 446, 52, run)));
  return out;
}

function toolbar(): NodeSpec {
  const tools = [
    { name: "Move", key: "V" },
    { name: "Frame", key: "F" },
    { name: "Rectangle", key: "R" },
    { name: "Ellipse", key: "O" },
  ];
  const w = 104;
  const total = tools.length * w + (tools.length - 1) * 8;
  return frame("toolbar", {
    x: LEFT_W + (MID_W - total) / 2,
    y: CANVAS_Y + CANVAS_H + 24,
    w: total,
    h: 44,
    radius: 8,
    fill: COLOR.panel,
    stroke: COLOR.line,
    strokeWeight: 1,
    children: tools.map((t, i) =>
      frame(`tool/${t.name}`, {
        x: i * (w + 8),
        y: 0,
        w,
        h: 44,
        radius: 8,
        reactions: [{ trigger: { on: "click" }, run: `tool/${i}` }],
        children: [
          rect("active", {
            w,
            h: 44,
            radius: 8,
            fill: COLOR.accent,
            visibleNet: bit(SCREEN_NETS.tool1h, i),
          }),
          label("label", t.name, {
            x: 12,
            y: 15,
            size: 12,
            bold: true,
            color: COLOR.text,
          }),
          label("key", t.key, { x: w - 22, y: 15, size: 11, color: COLOR.dim }),
        ],
      }),
    ),
  });
}

function status(): NodeSpec {
  const hint = [
    "Click a layer to pick it up, or click empty canvas to deselect",
    "Click a cell to start the shape",
    "Click the cell to drop it on (Esc cancels)",
    "Click the opposite corner (Esc cancels)",
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

function topBar(): NodeSpec {
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
      label(
        "note",
        "every pixel of this screen is a gate-level machine — scroll down",
        { x: UI_W - 420, y: 18, size: 11, color: COLOR.faint },
      ),
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
  { codes: [46, 8], run: "delete" },
  { codes: [68], run: "dup" },
  { codes: [221], run: "fwd" },
  { codes: [219], run: "back" },
  { codes: [37], run: "nudge/0" },
  { codes: [39], run: "nudge/1" },
  { codes: [38], run: "nudge/2" },
  { codes: [40], run: "nudge/3" },
  { codes: [27], run: "esc" },
];

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
      topBar(),
      leftPanel(),
      canvas(),
      toolbar(),
      status(),
      rightPanel(),
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
