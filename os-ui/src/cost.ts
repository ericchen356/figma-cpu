// Estimated cost of each editor function, in Figma prototype actions (one SET_VARIABLE or one
// conditional branch = 1 action). The prototype has no "variable[index]", so any read or write
// of a layer slot is one conditional per slot: cost scales with MAX_LAYERS, not with the data.
// These are design-time estimates from the model's shape; the real numbers come from the
// compiler's plan() stats once the logic exists as flows.
import { Action, GRID_H, GRID_W, Layer, MAX_LAYERS, State, TEXT_MAX, reduce } from "./model";

/** Hard budget for one user event (handler + redraw). */
export const BUDGET = 4000;
/** The viewer was measured crashing around 500-2000 actions per event, so chunk above this. */
export const CHUNK_TARGET = 2000;

const L = MAX_LAYERS;
const CELLS = GRID_W * GRID_H;
/** Variables per layer slot: kind, x, y, w, h, fill, visible, opacity, radius, stroke, shadow, rotation, flip. */
const FIELDS = 13;
/** The longest straight run of cells the Pen or Pencil stamps in one event. */
const LINE_CELLS = Math.max(GRID_W, GRID_H);

const slotWrite = (fields: number) => fields * L; // one conditional per slot per field
const slotRead = (fields: number) => fields * L;

/** The handlers, by name. */
export const HANDLER_COST = {
  tool: 1,
  select: 1,
  fill: 1 + slotWrite(1),
  visible: slotWrite(1),
  hitTest: L, // one conditional per layer, topmost evaluated last
  create: L + slotWrite(FIELDS), // find a free slot, then write its record
  dragMove: slotWrite(2),
  dragResize: slotWrite(4),
  nudge: slotWrite(2),
  delete: slotWrite(1) + 1,
  duplicate: slotRead(FIELDS) + L + slotWrite(FIELDS),
  copy: slotRead(FIELDS), // the selected slot's fields into the clipboard registers
  cut: slotRead(FIELDS) + slotWrite(1) + 1, // copy, then delete
  paste: L + slotWrite(FIELDS), // find a free slot, then write the clipboard into it
  reorder: (L - 1) * FIELDS * 2, // swap with the neighbour, one pair test per boundary
  prop: slotWrite(1),
  rotate: slotWrite(4) + 8, // swap w and h about the centre, then x and y
  stroke: slotWrite(1),
  shadow: slotWrite(1),
  place: L + slotWrite(FIELDS), // text and comment: find a free slot, write the record, open the field
  text: slotWrite(TEXT_MAX) + slotWrite(2), // one variable per character, then w and the name
  pen: LINE_CELLS, // one write per cell on the line from the previous click
  scale: slotWrite(4) + 10, // resize plus the ratio arithmetic
  image: CELLS, // one write per painted cell (the picture is quantized before the event)
  align: slotWrite(1), // x or y of the selection only
  up: 1,
} as const;

/** Full redraw: every cell. Still used by load and new, and as the worst case. */
export const REDRAW_COST = {
  // Each cell checks every layer back to front, plus one write to clear it first.
  canvas: CELLS * (L + 1),
  // Selection outline and handles: one pass over the cells.
  selection: CELLS,
  // Layers panel: name, visible flag and selected flag per row.
  layersPanel: L * 3,
  // Properties panel: x, y, w, h, fill.
  propertiesPanel: 5,
} as const;

export const REDRAW = Object.values(REDRAW_COST).reduce((a, b) => a + b, 0);

function handlerFor(s: State, a: Action): number {
  switch (a.t) {
    case "down":
      if (a.handle) return s.tool === "scale" ? HANDLER_COST.scale : 1;
      if (s.tool === "pen") return HANDLER_COST.pen;
      if (s.tool === "text" || s.tool === "comment") return HANDLER_COST.place;
      if (s.tool === "hand") return 1;
      return s.tool === "move" || s.tool === "scale" ? HANDLER_COST.hitTest : HANDLER_COST.create;
    case "move":
      return s.drag?.mode === "resize" || s.drag?.mode === "create"
        ? HANDLER_COST.dragResize
        : HANDLER_COST.dragMove;
    case "up":
      return HANDLER_COST.up;
    case "tool":
      return HANDLER_COST.tool;
    case "select":
      return HANDLER_COST.select;
    case "visible":
      return HANDLER_COST.visible;
    case "fill":
      return HANDLER_COST.fill;
    case "prop":
      return a.prop === "rotation" ? HANDLER_COST.rotate : HANDLER_COST.prop;
    case "stroke":
      return HANDLER_COST.stroke;
    case "shadow":
      return HANDLER_COST.shadow;
    case "text":
      return HANDLER_COST.text;
    case "edit":
      return HANDLER_COST.select;
    case "image":
      return HANDLER_COST.image;
    case "align":
      return HANDLER_COST.align;
    case "key":
      if (a.meta) {
        if (a.key === "c") return HANDLER_COST.copy;
        if (a.key === "x") return HANDLER_COST.cut;
        if (a.key === "v") return HANDLER_COST.paste;
        return HANDLER_COST.duplicate;
      }
      if (a.key === "[" || a.key === "]") return HANDLER_COST.reorder;
      if (a.key === "Delete" || a.key === "Backspace")
        return HANDLER_COST.delete;
      if (a.key.startsWith("Arrow")) return HANDLER_COST.nudge;
      return HANDLER_COST.tool;
    default:
      // Title, rename and load are file-level actions; costed with a tool switch for now.
      return HANDLER_COST.tool;
  }
}

const FULL_EVENTS = new Set(["new", "load"]);
const NO_CANVAS_EVENTS = new Set(["title", "layer-rename", "tool", "up", "edit"]);

const SAME_FIELDS = (a: Layer, b: Layer) =>
  a.x === b.x &&
  a.y === b.y &&
  a.w === b.w &&
  a.h === b.h &&
  a.fill === b.fill &&
  a.visible === b.visible &&
  a.opacity === b.opacity &&
  a.radius === b.radius &&
  a.stroke === b.stroke &&
  a.shadow === b.shadow &&
  a.rotation === b.rotation &&
  a.flip === b.flip &&
  a.text === b.text;

function footprint(l: Layer | undefined, into: Set<string>) {
  if (!l || !l.visible) return;
  // Only what fits in the OS screen's window is ever redrawn, however large the layer is.
  for (let y = l.y; y < l.y + Math.min(l.h, GRID_H); y++)
    for (let x = l.x; x < l.x + Math.min(l.w, GRID_W); x++) into.add(`${x},${y}`);
}

/**
 * Cells whose pixels can differ between two states: the old and new footprint of every layer
 * that changed, was reordered, appeared or vanished, plus the old and new selection outline.
 * The flow then repaints only these cells; every other cell keeps its variable as it was.
 */
export function dirtyCells(prev: State, next: State): Set<string> {
  const dirty = new Set<string>();
  const before = new Map(prev.layers.map((l, i) => [l.id, { l, i }]));
  const after = new Map(next.layers.map((l, i) => [l.id, { l, i }]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id);
    const b = after.get(id);
    if (!a || !b || a.i !== b.i || !SAME_FIELDS(a.l, b.l)) {
      footprint(a?.l, dirty);
      footprint(b?.l, dirty);
    }
  }
  if (prev.selected !== next.selected) {
    footprint(prev.layers.find((l) => l.id === prev.selected), dirty);
    footprint(next.layers.find((l) => l.id === next.selected), dirty);
  }
  return dirty;
}

/** Redraw cost for a known number of dirty cells: clear + one test per layer, then the outline pass. */
export const dirtyRedraw = (cells: number) =>
  cells * (L + 1) + cells + REDRAW_COST.layersPanel + REDRAW_COST.propertiesPanel;

/** Estimated actions for one event: its handler plus a dirty-rect redraw. */
export function eventCost(s: State, a: Action): number {
  const handler = handlerFor(s, a);
  if (FULL_EVENTS.has(a.t)) return handler + REDRAW;
  const panels = REDRAW_COST.layersPanel + REDRAW_COST.propertiesPanel;
  if (NO_CANVAS_EVENTS.has(a.t)) return handler + REDRAW_COST.layersPanel + REDRAW_COST.propertiesPanel;
  return handler + dirtyRedraw(dirtyCells(s, reduce(s, a)).size);
}

/** The most expensive single event the app can produce (full redraw: Load or New). */
export function worstEventCost(): number {
  const handlers = Object.values(HANDLER_COST) as number[];
  return Math.max(...handlers) + REDRAW;
}
