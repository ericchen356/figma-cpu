// Reading the flow's variables as an editor state, and the other way round for the reducer,
// so the two can be compared field by field. Also the bridge from a reducer `Action` to the
// UI events a person would fire in Figma to cause it (a click on a hotspot, a tool button…).
import type { Vars } from "./interp";
import {
  ALIGNS,
  CORNERS,
  GRID_H,
  GRID_W,
  MAX_LAYERS,
  PALETTE,
  TOOLS,
  UNSUPPORTED_TOOLS,
  type Tool,
} from "./spec";
import { getSelected, type Action, type State } from "../../os-ui/src/model";

/** The part of the editor state the flow implements, in the reducer's units (cells, palette indices). */
export interface View {
  tool: Tool;
  fill: number;
  selected: number | null;
  nextId: number;
  layers: ViewLayer[];
  drag: { mode: "create" | "move" | "resize"; a: number; b: number } | null;
  clipboard: ViewLayer | null;
}

export interface ViewLayer {
  id: number;
  kind: Tool;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: number;
  visible: boolean;
  opacity: number;
  radius: number;
  stroke: number;
  shadow: boolean;
  rotation: number;
  flip: boolean;
}

const DRAG_MODES = [null, "create", "move", "resize"] as const;

/** The flow's variables as a View. `K` is the program's pixels per cell. */
export function decode(vars: Vars, K: number): View {
  const num = (name: string) => vars.get(name) as number;
  const flag = (name: string) => vars.get(name) as boolean;
  const layer = (rec: (f: string) => string): ViewLayer => ({
    id: num(rec("id")),
    kind: TOOLS[num(rec("kind"))],
    x: num(rec("x")) / K,
    y: num(rec("y")) / K,
    w: num(rec("w")) / K,
    h: num(rec("h")) / K,
    fill: num(rec("fill")),
    visible: flag(rec("vis")),
    opacity: num(rec("opacity")),
    radius: num(rec("radius")),
    stroke: num(rec("stroke")),
    shadow: flag(rec("shadow")),
    rotation: num(rec("rot")),
    flip: flag(rec("flip")),
  });
  const n = num("g/n");
  const layers = Array.from({ length: n }, (_, i) =>
    layer((f) => `L${i}/${f}`),
  );
  const sel = num("g/sel");
  const mode = DRAG_MODES[num("d/mode")];
  return {
    tool: TOOLS[num("g/tool")],
    fill: num("g/fill"),
    selected: sel < 0 ? null : layers[sel].id,
    nextId: num("g/nextId"),
    layers,
    drag: mode ? { mode, a: num("d/a") / K, b: num("d/b") / K } : null,
    clipboard: flag("clip/has") ? layer((f) => `clip/${f}`) : null,
  };
}

/** A reducer State as a View (what the flow is expected to hold). */
export function viewOf(s: State): View {
  const layer = (l: State["layers"][number]): ViewLayer => ({
    id: l.id,
    kind: l.kind,
    x: l.x,
    y: l.y,
    w: l.w,
    h: l.h,
    fill: PALETTE.indexOf(l.fill),
    visible: l.visible,
    opacity: l.opacity,
    radius: l.radius,
    stroke: l.stroke === "" ? -1 : PALETTE.indexOf(l.stroke),
    shadow: l.shadow,
    rotation: l.rotation,
    flip: l.flip,
  });
  const d = s.drag;
  return {
    tool: s.tool,
    fill: PALETTE.indexOf(s.fill),
    selected: s.selected,
    nextId: s.nextId,
    layers: s.layers.map(layer),
    drag: !d
      ? null
      : d.mode === "create"
        ? { mode: "create", a: d.sx, b: d.sy }
        : d.mode === "move"
          ? { mode: "move", a: d.ox, b: d.oy }
          : d.mode === "resize"
            ? { mode: "resize", a: d.ax, b: d.ay }
            : (() => {
                throw new Error(`drag mode ${d.mode} is not part of the flow`);
              })(),
    clipboard: s.clipboard ? layer(s.clipboard) : null,
  };
}

// ---------- reducer action → UI events ----------

/** Why an action cannot be a Figma UI event (yet). */
export class Unsupported extends Error {}

/**
 * The event ids a person causes in Figma by doing what `a` says, given the state it applies to.
 * A pointer `up` can land on any cell and every cell's `up` is the same handler, so cell 0,0 stands in.
 * Property edits are the Properties panel's +/- steppers: Figma cannot type a number, so a typed
 * value is only supported when it is one step from the current one.
 */
export function eventsFor(s: State, a: Action): string[] {
  const slotOf = (id: number) => {
    const i = s.layers.findIndex((l) => l.id === id);
    if (i < 0) throw new Unsupported(`no layer ${id}`);
    return i;
  };
  const inGrid = (x: number, y: number) =>
    x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
  switch (a.t) {
    case "down":
      if (!inGrid(a.x, a.y))
        throw new Unsupported("pointer outside the canvas has no hotspot");
      if (UNSUPPORTED_TOOLS.includes(s.tool))
        throw new Unsupported(`tool ${s.tool}`);
      return [
        a.handle && CORNERS.includes(a.handle) && getSelected(s)
          ? `handle/${a.handle}#down`
          : `cell/${a.x},${a.y}#down`,
      ];
    case "move":
      if (!inGrid(a.x, a.y))
        throw new Unsupported("pointer outside the canvas has no hotspot");
      return [`cell/${a.x},${a.y}#enter`];
    case "up":
      return ["cell/0,0#up"];
    case "tool":
      return [`tool/${a.tool}#click`];
    case "select":
      return [
        a.id === null ? "select/none#click" : `layer/${slotOf(a.id)}#click`,
      ];
    case "visible":
      return [`eye/${slotOf(a.id)}#click`];
    case "fill":
      return [`swatch/${PALETTE.indexOf(a.color)}#click`];
    case "stroke":
      return [
        a.color === ""
          ? "stroke/none#click"
          : `stroke/${PALETTE.indexOf(a.color)}#click`,
      ];
    case "shadow":
      return [a.on ? "shadow/on#click" : "shadow/off#click"];
    case "align":
      if (!ALIGNS.includes(a.to)) throw new Unsupported(`align ${a.to}`);
      return [`align/${a.to}#click`];
    case "new":
      return ["new#click"];
    case "prop": {
      const l = getSelected(s);
      if (!l || a.prop === "rotation") throw new Unsupported(`prop ${a.prop}`);
      const cur = a.prop === "opacity" ? l.opacity * 10 : l[a.prop];
      const want = Number(a.value);
      const step = a.prop === "opacity" ? 10 : 1;
      if (want === cur) return [];
      if (want === cur + step) return [`prop/${a.prop}/inc#click`];
      if (want === cur - step) return [`prop/${a.prop}/dec#click`];
      throw new Unsupported(`prop ${a.prop} jumps from ${cur} to ${want}`);
    }
    case "key": {
      const id = a.meta
        ? `key/meta+${a.key}`
        : `key/${a.shift ? "shift+" : ""}${a.key}`;
      return [`${id}#key`];
    }
    default:
      throw new Unsupported(`action ${a.t}`);
  }
}

export { MAX_LAYERS };
