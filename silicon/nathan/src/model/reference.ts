// The executable spec of the budgeted CPU editor: 14×10 cells, up to 8 layers, tools Move /
// Frame / Rectangle / Ellipse, select, move, resize, delete, duplicate, reorder, nudge, fill,
// visibility. It is the subset of os-ui/src/model.ts that fits the prototype budget (OS-DESIGN.md
// §3 and §11, os-ui/src/cost.ts), frozen here so the gate-level engine is checked against a
// fixed target while the full TypeScript editor keeps growing (unbounded canvas, more tools).
// `tools/conformance` reports where the live os-ui model has drifted from this subset.
//
// Pure functions, no DOM. Colours are palette indices (0–15).

export const GRID_W = 14;
export const GRID_H = 10;
export const MAX_LAYERS = 8;
export const PALETTE_SIZE = 16;
/** The editor starts on PICO-8 colour 12 and a frame is white (7). */
export const INITIAL_FILL = 12;
export const FRAME_FILL = 7;

export type Tool = "move" | "frame" | "rect" | "ellipse";
export type Kind = "frame" | "rect" | "ellipse";
export const TOOLS: Tool[] = ["move", "frame", "rect", "ellipse"];
export const KINDS: Kind[] = ["frame", "rect", "ellipse"];
export type Corner = "nw" | "ne" | "sw" | "se";

export interface Layer {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: number;
  visible: boolean;
}

export type Drag =
  | { mode: "create"; sx: number; sy: number }
  | { mode: "move"; ox: number; oy: number }
  | { mode: "resize"; ax: number; ay: number }
  | null;

export interface State {
  layers: Layer[]; // back to front
  selected: number | null; // layer id
  tool: Tool;
  fill: number;
  nextId: number;
  drag: Drag;
}

export type Action =
  | { t: "down"; x: number; y: number; handle?: Corner }
  | { t: "move"; x: number; y: number }
  | { t: "up" }
  | { t: "tool"; tool: Tool }
  | { t: "fill"; color: number }
  | { t: "select"; id: number }
  | { t: "visible"; id: number }
  | { t: "key"; key: string; meta?: boolean };

export function initialState(): State {
  return {
    layers: [],
    selected: null,
    tool: "move",
    fill: INITIAL_FILL,
    nextId: 1,
    drag: null,
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export const getSelected = (s: State): Layer | undefined =>
  s.layers.find((l) => l.id === s.selected);

/** Topmost visible layer covering the cell. */
export function hitTest(s: State, x: number, y: number): Layer | undefined {
  for (let i = s.layers.length - 1; i >= 0; i--) {
    const l = s.layers[i];
    if (l.visible && x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h)
      return l;
  }
  return undefined;
}

const patch = (s: State, id: number, p: Partial<Layer>): State => ({
  ...s,
  layers: s.layers.map((l) => (l.id === id ? { ...l, ...p } : l)),
});

/** Cells covered by two corner cells, inclusive, clamped to the canvas. */
function span(ax: number, ay: number, bx: number, by: number) {
  const x0 = clamp(Math.min(ax, bx), 0, GRID_W - 1);
  const y0 = clamp(Math.min(ay, by), 0, GRID_H - 1);
  const x1 = clamp(Math.max(ax, bx), x0, GRID_W - 1);
  const y1 = clamp(Math.max(ay, by), y0, GRID_H - 1);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function addLayer(s: State, kind: Kind, x: number, y: number): State {
  const layer: Layer = {
    id: s.nextId,
    kind,
    x: clamp(x, 0, GRID_W - 1),
    y: clamp(y, 0, GRID_H - 1),
    w: 1,
    h: 1,
    fill: kind === "frame" ? FRAME_FILL : s.fill,
    visible: true,
  };
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
  };
}

function duplicate(s: State): State {
  const src = getSelected(s);
  if (!src || s.layers.length >= MAX_LAYERS) return s;
  const copy: Layer = {
    ...src,
    id: s.nextId,
    x: clamp(src.x + 1, 0, GRID_W - src.w),
    y: clamp(src.y + 1, 0, GRID_H - src.h),
  };
  return {
    ...s,
    layers: [...s.layers, copy],
    selected: copy.id,
    nextId: s.nextId + 1,
  };
}

function nudge(s: State, dx: number, dy: number): State {
  const l = getSelected(s);
  if (!l) return s;
  return patch(s, l.id, {
    x: clamp(l.x + dx, 0, GRID_W - l.w),
    y: clamp(l.y + dy, 0, GRID_H - l.h),
  });
}

function onDown(s: State, a: Extract<Action, { t: "down" }>): State {
  const { x, y } = a;
  const sel = getSelected(s);
  if (a.handle && sel) {
    // the anchor is the corner cell opposite the handle being dragged
    const ax = a.handle.includes("w") ? sel.x + sel.w - 1 : sel.x;
    const ay = a.handle.includes("n") ? sel.y + sel.h - 1 : sel.y;
    return { ...s, drag: { mode: "resize", ax, ay } };
  }
  if (s.tool !== "move") {
    if (s.layers.length >= MAX_LAYERS) return { ...s, tool: "move" };
    return {
      ...addLayer(
        s,
        s.tool === "frame" ? "frame" : s.tool === "rect" ? "rect" : "ellipse",
        x,
        y,
      ),
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

function onMove(s: State, x: number, y: number): State {
  const d = s.drag;
  const l = getSelected(s);
  if (!d || !l) return s;
  if (d.mode === "create") return patch(s, l.id, span(d.sx, d.sy, x, y));
  if (d.mode === "resize") return patch(s, l.id, span(d.ax, d.ay, x, y));
  return patch(s, l.id, {
    x: clamp(x - d.ox, 0, GRID_W - l.w),
    y: clamp(y - d.oy, 0, GRID_H - l.h),
  });
}

const TOOL_KEYS: Record<string, Tool> = {
  v: "move",
  f: "frame",
  r: "rect",
  o: "ellipse",
};

function onKey(s: State, key: string, meta: boolean): State {
  if (meta) return key === "d" ? duplicate(s) : s;
  if (key in TOOL_KEYS) return { ...s, tool: TOOL_KEYS[key] };
  switch (key) {
    case "Delete":
    case "Backspace":
      return remove(s);
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
      return { ...s, selected: null, tool: "move", drag: null };
    default:
      return s;
  }
}

export function reduce(s: State, a: Action): State {
  switch (a.t) {
    case "down":
      return onDown(s, a);
    case "move":
      return onMove(s, a.x, a.y);
    case "up":
      return s.drag?.mode === "create"
        ? { ...s, drag: null, tool: "move" }
        : { ...s, drag: null };
    case "tool":
      return { ...s, tool: a.tool };
    case "fill": {
      const l = getSelected(s);
      const next = { ...s, fill: a.color };
      return l ? patch(next, l.id, { fill: a.color }) : next;
    }
    case "select":
      return { ...s, selected: a.id };
    case "visible":
      return patch(s, a.id, {
        visible: !s.layers.find((l) => l.id === a.id)?.visible,
      });
    case "key":
      return onKey(s, a.key, !!a.meta);
  }
}

/** A canvas click: starts a drag when nothing is pending, finishes it (move, then up) when one is. */
export function click(s: State, x: number, y: number): State {
  return s.drag
    ? reduce(reduce(s, { t: "move", x, y }), { t: "up" })
    : reduce(s, { t: "down", x, y });
}

/** The 14×10 picture of the document: the topmost visible layer's palette index per cell, -1 = empty. */
export function raster(s: State): number[] {
  const out = new Array<number>(GRID_W * GRID_H).fill(-1);
  for (const l of s.layers) {
    if (!l.visible) continue;
    for (let y = l.y; y < l.y + l.h; y++)
      for (let x = l.x; x < l.x + l.w; x++) out[y * GRID_W + x] = l.fill;
  }
  return out;
}
