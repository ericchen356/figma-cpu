// The Figma OS editor as a pure state machine, budgeted for the prototype CPU.
// No DOM in here: `update(state, action)` is the whole behaviour of the app, so the same rules
// can be ported to the CPU program and to Figma prototype flows. All geometry is in whole CELLS
// (the 8x8 tiles of the 128x96 screen); the canvas has no edge, so a coordinate is a signed 10-bit
// number. The OS screen shows a 14 x 10 cell window onto it. The cost of each
// function in prototype actions is estimated in cost.ts and tested against the budget.
//
// The document is a canvas of layers, with no pages. Frames are the unit of presentation: each
// top-level frame is one slide. Sections group frames, slices mark an export region.

/** What the OS screen shows of the canvas at once: a 14 x 10 cell window. The document itself is unbounded. */
export const GRID_W = 14;
export const GRID_H = 10;
export const MAX_LAYERS = 8;
/** Coordinates run from -WORLD to WORLD cells in both directions: 4096 screen pixels each way, far more than anyone draws. */
export const WORLD = 512;
/** One line of text: one character per cell. */
export const TEXT_MAX = 32;
/** Painted cells the canvas will hold, so a long drag cannot fill the CPU's memory. */
export const MAX_PAINT = 4096;

/** PICO-8 palette, same as spec/palette.json. */
export const PALETTE = [
  "#000000",
  "#1d2b53",
  "#7e2553",
  "#008751",
  "#ab5236",
  "#5f574f",
  "#c2c3c7",
  "#fff1e8",
  "#ff004d",
  "#ffa300",
  "#ffec27",
  "#00e436",
  "#29adff",
  "#83769c",
  "#ff77a8",
  "#ffccaa",
];

/** Cells in the OS screen's window onto the canvas. */
export const CELLS = GRID_W * GRID_H;
/** The canvas paint, sparse: "x,y" -> palette index. Unpainted cells are absent. */
export type Paint = Record<string, number>;
export const emptyPaint = (): Paint => ({});
export const cellKey = (x: number, y: number) => `${x},${y}`;
/** The painted cells as coordinates, for drawing. */
export function paintCells(p: Paint): { x: number; y: number; color: number }[] {
  return Object.entries(p).map(([k, color]) => {
    const [x, y] = k.split(",").map(Number);
    return { x, y, color };
  });
}

export type Tool =
  | "move"
  | "hand"
  | "scale"
  | "frame"
  | "section"
  | "slice"
  | "rect"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star"
  | "pen"
  | "paint"
  | "erase"
  | "text"
  | "comment";
export type Kind =
  | "frame"
  | "section"
  | "slice"
  | "rect"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star"
  | "text"
  | "comment";
export type Corner = "nw" | "ne" | "sw" | "se";

/** Tools that create a layer by dragging out its box: the tool and the kind it makes share a name. */
const DRAG_TO_CREATE = new Set<Tool>([
  "frame",
  "section",
  "slice",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
]);

export interface Layer {
  id: number;
  kind: Kind;
  name: string;
  x: number; // cells
  y: number;
  w: number;
  h: number;
  fill: string;
  visible: boolean;
  opacity: number; // 0-10, tenths
  radius: number; // 0-4, quarter cells
  stroke: string; // palette color of a 1-pixel outline, "" = none
  shadow: boolean; // hard drop shadow, one pixel down and right
  rotation: number; // 0, 90, 180 or 270 degrees
  flip: boolean; // lines and arrows: runs bottom-left to top-right instead of top-left to bottom-right
  text: string; // text layers: the line itself; comments: the note
}

export type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export type Drag =
  | { mode: "create"; sx: number; sy: number }
  | { mode: "move"; ox: number; oy: number }
  /** `keep` is the width/height ratio to hold while resizing (the Scale tool). */
  | { mode: "resize"; ax: number; ay: number; keep?: number }
  | { mode: "paint"; lx: number; ly: number; erase: boolean }
  /** The Pen: pressed at (sx,sy), last cell (lx,ly); `moved` tells a drag from a click. */
  | { mode: "pen"; sx: number; sy: number; lx: number; ly: number; moved: boolean }
  | null;

export interface State {
  title: string; // file name
  layers: Layer[]; // back to front; frames and the layers inside them
  paint: Paint; // painted cells, sparse
  selected: number | null;
  tool: Tool;
  fill: string; // fill for the next layer
  nextId: number;
  drag: Drag;
  /** Last copied or cut layer. It is not part of the document. */
  clipboard: Layer | null;
  /** The text or comment layer whose text is being typed. */
  editing: number | null;
  /** The last cell the Pen clicked, so the next click draws a line from it. */
  penFrom: { x: number; y: number } | null;
}

/** Positions are cell coordinates (integers). */
export type Action =
  | { t: "down"; x: number; y: number; handle?: Corner }
  | { t: "move"; x: number; y: number }
  | { t: "up" }
  | { t: "key"; key: string; meta?: boolean; shift?: boolean }
  | { t: "tool"; tool: Tool }
  | { t: "select"; id: number | null }
  | { t: "visible"; id: number }
  | { t: "fill"; color: string }
  | { t: "stroke"; color: string }
  | { t: "shadow"; on: boolean }
  | {
      t: "prop";
      prop: "x" | "y" | "w" | "h" | "opacity" | "radius" | "rotation";
      value: string;
    }
  | { t: "align"; to: Align }
  | { t: "title"; name: string }
  | { t: "layer-rename"; id: number; name: string }
  | { t: "edit"; id: number }
  | { t: "text"; id: number; value: string }
  | { t: "image"; cells: Paint }
  | { t: "new" }
  | { t: "load"; doc: unknown };

/** Tool shortcuts. A leading "shift+" means the shifted key, as in Figma. */
export const TOOL_KEYS: Record<string, Tool> = {
  v: "move",
  h: "hand",
  k: "scale",
  f: "frame",
  "shift+s": "section",
  s: "slice",
  r: "rect",
  l: "line",
  "shift+l": "arrow",
  o: "ellipse",
  p: "pen",
  "shift+p": "paint",
  b: "paint",
  e: "erase",
  t: "text",
  c: "comment",
};

export const LABEL: Record<Kind, string> = {
  frame: "Frame",
  section: "Section",
  slice: "Slice",
  rect: "Rectangle",
  line: "Line",
  arrow: "Arrow",
  ellipse: "Ellipse",
  polygon: "Polygon",
  star: "Star",
  text: "Text",
  comment: "Comment",
};

export function initialState(): State {
  return {
    title: "Untitled",
    layers: [],
    paint: emptyPaint(),
    selected: null,
    tool: "move",
    fill: PALETTE[12],
    nextId: 1,
    drag: null,
    clipboard: null,
    editing: null,
    penFrom: null,
  };
}

/** Keeps a coordinate inside the world. */
const world = (v: number) => clamp(v, -WORLD, WORLD);

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Frames and sections hold other layers; everything else is a leaf. */
const isContainer = (l: Layer) => l.kind === "frame" || l.kind === "section";

/** Smallest container that fully contains `l` (its parent in the Layers tree), if any. */
export function parentOf(s: State, l: Layer): Layer | undefined {
  let best: Layer | undefined;
  for (const f of s.layers) {
    if (f.id === l.id || !isContainer(f)) continue;
    const inside =
      l.x >= f.x &&
      l.y >= f.y &&
      l.x + l.w <= f.x + f.w &&
      l.y + l.h <= f.y + f.h;
    const larger =
      f.w * f.h > l.w * l.h || (f.w * f.h === l.w * l.h && f.id < l.id);
    if (inside && larger && (!best || f.w * f.h < best.w * best.h)) best = f;
  }
  return best;
}

/** The outermost frame a layer sits in (a top-level frame is its own), if any. Sections do not count. */
export function topFrameOf(s: State, l: Layer): Layer | undefined {
  let top: Layer | undefined = l.kind === "frame" ? l : undefined;
  for (let p = parentOf(s, l); p; p = parentOf(s, p))
    if (p.kind === "frame") top = p;
  return top;
}

/** Top-level frames in presentation order: top to bottom, then left to right. Each one is a slide. */
export function presentFrames(s: State): Layer[] {
  return s.layers
    .filter(
      (l) => l.kind === "frame" && l.visible && topFrameOf(s, l)?.id === l.id,
    )
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
}

/** Every layer inside container `f`, at any depth. */
export function descendants(s: State, f: Layer): Layer[] {
  const reaches = (l: Layer) => {
    for (let p = parentOf(s, l); p; p = parentOf(s, p))
      if (p.id === f.id) return true;
    return false;
  };
  return s.layers.filter((l) => l.id !== f.id && reaches(l));
}

/** The smallest box around every visible layer and painted cell, if there is anything. */
export function contentBounds(s: State): { x: number; y: number; w: number; h: number } | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const l of s.layers) if (l.visible) add(l.x, l.y, l.w, l.h);
  for (const c of paintCells(s.paint)) add(c.x, c.y, 1, 1);
  return x0 === Infinity ? undefined : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The region an export covers: the selected frame, section or slice, else the whole canvas. */
export function exportRegion(s: State): Layer | undefined {
  const l = getSelected(s);
  return l && (isContainer(l) || l.kind === "slice") ? l : undefined;
}

export function getSelected(s: State): Layer | undefined {
  return s.layers.find((l) => l.id === s.selected);
}

/** Topmost visible layer covering the cell. */
export function hitTest(s: State, x: number, y: number): Layer | undefined {
  for (let i = s.layers.length - 1; i >= 0; i--) {
    const l = s.layers[i];
    if (l.visible && x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h)
      return l;
  }
  return undefined;
}

function patch(s: State, id: number, p: Partial<Layer>): State {
  return {
    ...s,
    layers: s.layers.map((l) => (l.id === id ? { ...l, ...p } : l)),
  };
}

/** The box covering two corner cells, inclusive. Only the far edges of the world clip it. */
function span(ax: number, ay: number, bx: number, by: number) {
  const x0 = world(Math.min(ax, bx));
  const y0 = world(Math.min(ay, by));
  const x1 = world(Math.max(ax, bx));
  const y1 = world(Math.max(ay, by));
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Like `span`, but the box keeps width/height = `ratio` (the Scale tool). */
function spanKeeping(ax: number, ay: number, bx: number, by: number, ratio: number) {
  const dx = bx >= ax ? 1 : -1;
  const dy = by >= ay ? 1 : -1;
  const w = Math.abs(bx - ax) + 1;
  const h = Math.max(1, Math.round(w / ratio));
  return span(ax, ay, ax + dx * (w - 1), ay + dy * (h - 1));
}

function blank(s: State, kind: Kind, x: number, y: number): Layer {
  return {
    id: s.nextId,
    kind,
    name: `${LABEL[kind]} ${s.nextId}`,
    x: world(x),
    y: world(y),
    w: 1,
    h: 1,
    fill:
      kind === "frame" ? PALETTE[7] : kind === "section" ? PALETTE[6] : s.fill,
    visible: true,
    opacity: 10,
    radius: 0,
    stroke: "",
    shadow: false,
    rotation: 0,
    flip: false,
    text: "",
  };
}

function addLayer(s: State, kind: Kind, x: number, y: number): State {
  const layer = blank(s, kind, x, y);
  return {
    ...s,
    layers: [...s.layers, layer],
    selected: layer.id,
    nextId: s.nextId + 1,
  };
}

function reorder(s: State, dir: 1 | -1): State {
  const i = s.layers.findIndex((l) => l.id === s.selected);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.layers.length) return s;
  const layers = [...s.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...s, layers };
}

function remove(s: State): State {
  if (s.selected === null) return s;
  return {
    ...s,
    layers: s.layers.filter((l) => l.id !== s.selected),
    selected: null,
    editing: s.editing === s.selected ? null : s.editing,
  };
}

/** A copy of `src` under a fresh id. Text layers keep their words as their name, as in Figma. */
function clone(s: State, src: Layer, x: number, y: number): Layer {
  return {
    ...src,
    id: s.nextId,
    name: src.kind === "text" ? src.name : `${LABEL[src.kind]} ${s.nextId}`,
    x,
    y,
  };
}

function duplicate(s: State): State {
  const src = getSelected(s);
  if (!src || s.layers.length >= MAX_LAYERS) return s;
  const copy = clone(s, src, world(src.x + 1), world(src.y + 1));
  return {
    ...s,
    layers: [...s.layers, copy],
    selected: copy.id,
    nextId: s.nextId + 1,
  };
}

function copy(s: State): State {
  const l = getSelected(s);
  return l ? { ...s, clipboard: l } : s;
}

/** Cut is copy then delete, so one paste brings the layer back. */
const cut = (s: State): State => remove(copy(s));

/** Pastes the clipboard as a new top layer in the copied position, like Figma (a duplicate offsets by one cell). */
function paste(s: State): State {
  const src = s.clipboard;
  if (!src || s.layers.length >= MAX_LAYERS) return s;
  const layer = clone(s, src, src.x, src.y);
  return {
    ...s,
    layers: [...s.layers, layer],
    selected: layer.id,
    nextId: s.nextId + 1,
  };
}

function nudge(s: State, dx: number, dy: number): State {
  const l = getSelected(s);
  if (!l) return s;
  return patch(s, l.id, { x: world(l.x + dx), y: world(l.y + dy) });
}

/** Text and comments are placed with one click, then typed into (`editing` tells the view to open the field). */
function place(
  s: State,
  kind: "text" | "comment",
  x: number,
  y: number,
): State {
  if (s.layers.length >= MAX_LAYERS) return { ...s, tool: "move" };
  const placed = addLayer(s, kind, x, y);
  return { ...placed, tool: "move", editing: placed.selected };
}

/** The Pen draws where you press and drag: freehand, cell by cell. */
function penDown(s: State, x: number, y: number): State {
  return {
    ...s,
    selected: null,
    paint: stamp(s, x, y, x, y, false),
    drag: { mode: "pen", sx: x, sy: y, lx: x, ly: y, moved: false },
  };
}

/**
 * Letting go ends the stroke. A drag stands on its own. A plain click instead draws a straight
 * line from the previous click and becomes the point the next click continues from (Enter ends it).
 */
function penUp(s: State, d: Extract<NonNullable<Drag>, { mode: "pen" }>): State {
  if (d.moved) return { ...s, drag: null, penFrom: null };
  const from = s.penFrom;
  return {
    ...s,
    drag: null,
    paint: from ? stamp(s, from.x, from.y, d.sx, d.sy, false) : s.paint,
    penFrom: { x: d.sx, y: d.sy },
  };
}

/** Sets a text layer's words (or a comment's note). Empty text removes the layer. */
function setText(s: State, id: number, value: string): State {
  const l = s.layers.find((q) => q.id === id);
  const done = { ...s, editing: null };
  if (!l || (l.kind !== "text" && l.kind !== "comment")) return done;
  const text = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, l.kind === "text" ? TEXT_MAX : 40);
  if (!text) return remove({ ...done, selected: id });
  if (l.kind === "comment") return patch(done, id, { text });
  const w = clamp(text.length, 1, TEXT_MAX);
  return patch(done, id, {
    text,
    name: text,
    w,
    h: 1,
  });
}

function onDown(s: State, a: Extract<Action, { t: "down" }>): State {
  const { x, y } = a;
  const sel = getSelected(s);

  if (a.handle && sel) {
    // Anchor is the corner cell opposite the handle being dragged.
    const ax = a.handle.includes("w") ? sel.x + sel.w - 1 : sel.x;
    const ay = a.handle.includes("n") ? sel.y + sel.h - 1 : sel.y;
    const keep = s.tool === "scale" ? sel.w / sel.h : undefined;
    return { ...s, drag: { mode: "resize", ax, ay, keep } };
  }
  if (s.tool === "hand") return s; // panning is a view matter
  if (s.tool === "pen") return penDown(s, x, y);
  if (s.tool === "paint" || s.tool === "erase") {
    const erase = s.tool === "erase";
    return {
      ...s,
      selected: null,
      paint: stamp(s, x, y, x, y, erase),
      drag: { mode: "paint", lx: x, ly: y, erase },
    };
  }
  if (s.tool === "text" || s.tool === "comment") return place(s, s.tool, x, y);
  if (DRAG_TO_CREATE.has(s.tool)) {
    if (s.layers.length >= MAX_LAYERS) return { ...s, tool: "move" };
    return {
      ...addLayer(s, s.tool as Kind, x, y),
      drag: { mode: "create", sx: x, sy: y },
    };
  }
  const hit = hitTest(s, x, y);
  if (!hit) return { ...s, selected: null };
  return {
    ...s,
    selected: hit.id,
    drag: { mode: "move", ox: x - hit.x, oy: y - hit.y },
  };
}

/** Paints (or erases) the cells on the line from (x0,y0) to (x1,y1), so a fast drag leaves no gaps. */
function stamp(s: State, x0: number, y0: number, x1: number, y1: number, erase: boolean): Paint {
  const out = { ...s.paint };
  let count = Object.keys(out).length;
  const color = erase ? -1 : Math.max(0, PALETTE.indexOf(s.fill));
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const key = cellKey(
      world(Math.round(x0 + ((x1 - x0) * i) / n)),
      world(Math.round(y0 + ((y1 - y0) * i) / n)),
    );
    if (erase) {
      if (key in out) (delete out[key], count--);
    } else if (key in out || count < MAX_PAINT) {
      if (!(key in out)) count++;
      out[key] = color;
    }
  }
  return out;
}

function onMove(s: State, x: number, y: number): State {
  const d = s.drag;
  if (d?.mode === "pen")
    return {
      ...s,
      paint: stamp(s, d.lx, d.ly, x, y, false),
      drag: { ...d, lx: x, ly: y, moved: d.moved || x !== d.sx || y !== d.sy },
    };
  if (d?.mode === "paint")
    return {
      ...s,
      paint: stamp(s, d.lx, d.ly, x, y, d.erase),
      drag: { ...d, lx: x, ly: y },
    };
  const l = getSelected(s);
  if (!d || !l) return s;
  if (d.mode === "create") {
    // A line or arrow dragged against the diagonal runs bottom-left to top-right.
    const flip =
      l.kind === "line" || l.kind === "arrow" ? x < d.sx !== y < d.sy : l.flip;
    return patch(s, l.id, { ...span(d.sx, d.sy, x, y), flip });
  }
  if (d.mode === "resize")
    return patch(
      s,
      l.id,
      d.keep ? spanKeeping(d.ax, d.ay, x, y, d.keep) : span(d.ax, d.ay, x, y),
    );
  return patch(s, l.id, { x: world(x - d.ox), y: world(y - d.oy) });
}

function onProp(
  s: State,
  prop: "x" | "y" | "w" | "h" | "opacity" | "radius" | "rotation",
  value: string,
): State {
  const l = getSelected(s);
  const n = Math.round(Number(value.replace(/[%°]\s*$/, "")));
  if (!l || !value.trim() || !Number.isFinite(n)) return s;
  if (prop === "opacity")
    return patch(s, l.id, { opacity: clamp(Math.round(n / 10), 0, 10) });
  if (prop === "radius") return patch(s, l.id, { radius: clamp(n, 0, 4) });
  if (prop === "rotation") return rotate(s, l, n);
  if (prop === "x") return patch(s, l.id, { x: world(n) });
  if (prop === "y") return patch(s, l.id, { y: world(n) });
  if (prop === "w") return patch(s, l.id, { w: clamp(n, 1, WORLD) });
  return patch(s, l.id, { h: clamp(n, 1, WORLD) });
}

function rotate(s: State, l: Layer, degrees: number): State {
  if (l.kind === "text" || l.kind === "comment") return s;
  const to = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  if ((to - l.rotation + 360) % 180 === 0) return patch(s, l.id, { rotation: to });
  const w = l.h;
  const h = l.w;
  return patch(s, l.id, {
    rotation: to,
    w,
    h,
    x: world(Math.round(l.x + l.w / 2 - w / 2)),
    y: world(Math.round(l.y + l.h / 2 - h / 2)),
  });
}

/** Aligns the selection to the frame or section it sits in. A layer on the bare canvas has nothing to align to. */
function onAlign(s: State, to: Align): State {
  const l = getSelected(s);
  const p = l && parentOf(s, l);
  if (!l || !p) return s;
  switch (to) {
    case "left":
      return patch(s, l.id, { x: p.x });
    case "hcenter":
      return patch(s, l.id, { x: p.x + Math.floor((p.w - l.w) / 2) });
    case "right":
      return patch(s, l.id, { x: p.x + p.w - l.w });
    case "top":
      return patch(s, l.id, { y: p.y });
    case "vcenter":
      return patch(s, l.id, { y: p.y + Math.floor((p.h - l.h) / 2) });
    default:
      return patch(s, l.id, { y: p.y + p.h - l.h });
  }
}

function setTool(s: State, tool: Tool): State {
  const next = { ...s, tool, penFrom: null, editing: null };
  return tool === "paint" || tool === "erase" || tool === "pen"
    ? { ...next, selected: null }
    : next;
}

function onKey(s: State, key: string, meta: boolean, shift: boolean): State {
  if (meta) {
    if (key === "d") return duplicate(s);
    if (key === "c") return copy(s);
    if (key === "x") return cut(s);
    if (key === "v") return paste(s);
    return s;
  }
  const shortcut = (shift ? "shift+" : "") + key;
  if (shortcut in TOOL_KEYS) return setTool(s, TOOL_KEYS[shortcut]);
  switch (key) {
    case "Delete":
    case "Backspace":
      return remove(s);
    case "Enter":
      return s.penFrom ? { ...s, penFrom: null } : s;
    case "]":
      return reorder(s, 1);
    case "[":
      return reorder(s, -1);
    case "ArrowLeft":
      return nudge(s, -1, 0);
    case "ArrowRight":
      return nudge(s, 1, 0);
    case "ArrowUp":
      return nudge(s, 0, -1);
    case "ArrowDown":
      return nudge(s, 0, 1);
    case "Escape":
      return {
        ...s,
        selected: null,
        tool: "move",
        drag: null,
        penFrom: null,
        editing: null,
      };
    default:
      return s;
  }
}

/** Adds `incoming` cells to `base`, stopping at the paint limit. */
function mergePaint(base: Paint, incoming: Paint): Paint {
  const out = { ...base };
  let count = Object.keys(out).length;
  for (const [k, c] of Object.entries(incoming)) {
    if (!(k in out)) {
      if (count >= MAX_PAINT) continue;
      count++;
    }
    out[k] = c;
  }
  return out;
}

function updateLayers(s: State, a: Action): State {
  switch (a.t) {
    case "down":
      return onDown(s, a);
    case "move":
      return onMove(s, a.x, a.y);
    case "up":
      if (s.drag?.mode === "pen") return penUp(s, s.drag);
      return s.drag?.mode === "create"
        ? { ...s, drag: null, tool: "move" }
        : { ...s, drag: null };
    case "key":
      return onKey(s, a.key, !!a.meta, !!a.shift);
    case "tool":
      return setTool(s, a.tool);
    case "select":
      return { ...s, selected: a.id };
    case "visible":
      return patch(s, a.id, {
        visible: !s.layers.find((l) => l.id === a.id)?.visible,
      });
    case "fill": {
      const l = getSelected(s);
      const next = { ...s, fill: a.color };
      return l ? patch(next, l.id, { fill: a.color }) : next;
    }
    case "stroke": {
      const l = getSelected(s);
      return l ? patch(s, l.id, { stroke: a.color }) : s;
    }
    case "shadow": {
      const l = getSelected(s);
      return l ? patch(s, l.id, { shadow: a.on }) : s;
    }
    case "prop":
      return onProp(s, a.prop, a.value);
    case "align":
      return onAlign(s, a.to);
    case "edit": {
      const l = s.layers.find((q) => q.id === a.id);
      return l && (l.kind === "text" || l.kind === "comment")
        ? { ...s, selected: l.id, editing: l.id }
        : s;
    }
    case "text":
      return setText(s, a.id, a.value);
    case "image":
      return {
        ...s,
        selected: null,
        paint: mergePaint(s.paint, a.cells),
      };
    default:
      return s;
  }
}

const cleanName = (n: string, fallback: string) =>
  n.trim().slice(0, 40) || fallback;

/** The whole document (title, layers, paint), for Share. */
export function exportDoc(s: State) {
  return { title: s.title, layers: s.layers, paint: s.paint, nextId: s.nextId };
}

/** Paint from a shared file: sparse already, or the old one-index-per-cell array of the 14 x 10 canvas. */
function toPaint(raw: unknown): Paint {
  if (Array.isArray(raw))
    return Object.fromEntries(
      raw.flatMap((c, i) => (typeof c === "number" && c >= 0 ? [[cellKey(i % GRID_W, Math.floor(i / GRID_W)), c]] : [])),
    );
  if (!raw || typeof raw !== "object") return emptyPaint();
  return Object.fromEntries(Object.entries(raw).filter(([k, c]) => /^-?\d+,-?\d+$/.test(k) && typeof c === "number" && c >= 0));
}

/** Documents saved before a field existed load with that field's default. */
const withDefaults = (l: Layer): Layer => ({
  ...l,
  opacity: l.opacity ?? 10,
  radius: l.radius ?? 0,
  stroke: l.stroke ?? "",
  shadow: l.shadow ?? false,
  rotation: l.rotation ?? 0,
  flip: l.flip ?? false,
  text: l.text ?? "",
});

/** Reads a shared document. Links made while the editor still had pages load as their active page. */
function loadDoc(s: State, doc: unknown): State {
  const d = doc as {
    title?: unknown;
    layers?: Layer[];
    paint?: unknown;
    nextId?: unknown;
    pages?: { id: number; layers: Layer[]; paint?: unknown }[];
    page?: number;
  };
  if (!d || typeof d !== "object") return s;
  const old =
    Array.isArray(d.pages) && d.pages.length
      ? (d.pages.find((p) => p.id === d.page) ?? d.pages[0])
      : undefined;
  const layers = old?.layers ?? d.layers;
  if (!Array.isArray(layers)) return s;
  const paint = old ? old.paint : d.paint;
  return {
    ...s,
    title: cleanName(String(d.title ?? ""), "Untitled"),
    layers: layers.slice(0, MAX_LAYERS).map(withDefaults),
    paint: toPaint(paint),
    selected: null,
    nextId: Number(d.nextId) || s.nextId,
    drag: null,
    editing: null,
    penFrom: null,
  };
}

export function reduce(s: State, a: Action): State {
  switch (a.t) {
    case "title":
      return { ...s, title: cleanName(a.name, "Untitled") };
    case "layer-rename":
      return {
        ...s,
        layers: s.layers.map((l) =>
          l.id === a.id ? { ...l, name: cleanName(a.name, l.name) } : l,
        ),
      };
    case "new":
      return initialState();
    case "load":
      return loadDoc(s, a.doc);
    default:
      return updateLayers(s, a);
  }
}

export const update = reduce;
