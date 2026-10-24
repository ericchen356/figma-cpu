// Reading the flow's variables as an editor state, and the other way round for the reducer,
// so the two can be compared field by field. Also the bridge from a reducer `Action` to the
// UI events a person would fire in Figma to cause it (a click on a hotspot, a tool button…),
// and from those to the hardware target's events, which read the pointer cell from inputs.
import type { Vars } from "./interp";
import {
  GRID_H,
  GRID_W,
  MAX_LAYERS,
  PALETTE,
  STYLE_FIELDS,
  TOOLS,
  UNSUPPORTED_TOOLS,
  type Feature,
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
  /** Absent when the flow leaves the clipboard out. */
  clipboard?: ViewLayer | null;
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
  /** The style fields are absent when the flow leaves the "style" group out. */
  opacity?: number;
  radius?: number;
  stroke?: number;
  shadow?: boolean;
  rotation: number;
  flip: boolean;
}

const DRAG_MODES = [null, "create", "move", "resize"] as const;

/** The flow's variables as a View. `K` is the program's pixels per cell. Fields the program does
 * not declare are left out (an omitted feature), except rotation, which is always 0 without `rot`. */
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
    ...(vars.has(rec("opacity"))
      ? {
          opacity: num(rec("opacity")),
          radius: num(rec("radius")),
          stroke: num(rec("stroke")),
          shadow: flag(rec("shadow")),
        }
      : {}),
    rotation: vars.has(rec("rot")) ? num(rec("rot")) : 0,
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
    ...(vars.has("clip/has")
      ? { clipboard: flag("clip/has") ? layer((f) => `clip/${f}`) : null }
      : {}),
  };
}

/** A reducer State as a View (what the flow is expected to hold), without the fields of the
 * features in `omit`. */
export function viewOf(s: State, omit: readonly Feature[] = []): View {
  const style = !omit.includes("style");
  const layer = (l: State["layers"][number]): ViewLayer => ({
    id: l.id,
    kind: l.kind,
    x: l.x,
    y: l.y,
    w: l.w,
    h: l.h,
    fill: PALETTE.indexOf(l.fill),
    visible: l.visible,
    ...(style
      ? {
          opacity: l.opacity,
          radius: l.radius,
          stroke: l.stroke === "" ? -1 : PALETTE.indexOf(l.stroke),
          shadow: l.shadow,
        }
      : {}),
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
    ...(omit.includes("clipboard")
      ? {}
      : { clipboard: s.clipboard ? layer(s.clipboard) : null }),
  };
}

// ---------- reducer action → UI events ----------

/** Why an action cannot be a Figma UI event (yet). */
export class Unsupported extends Error {}

/** The corner of the screen's window in the canvas, in cells. The flow's `v/x`, `v/y` divided by K. */
export interface Origin {
  x: number;
  y: number;
}

/**
 * The event ids a person causes in Figma by doing what `a` says, given the state it applies to.
 * A pointer action names a canvas cell; a hotspot is a cell of the 14 x 10 window, so it is the
 * cell minus the window's corner and must lie inside it. A pointer `up` can land on any hotspot
 * and every `up` is the same handler, so cell 0,0 stands in.
 * Property edits are the Properties panel's +/- steppers: Figma cannot type a number, so a typed
 * value is only supported when it is one step from the current one.
 */
export function eventsFor(
  s: State,
  a: Action,
  origin: Origin = { x: 0, y: 0 },
): string[] {
  const slotOf = (id: number) => {
    const i = s.layers.findIndex((l) => l.id === id);
    if (i < 0) throw new Unsupported(`no layer ${id}`);
    return i;
  };
  const cell = (x: number, y: number) => {
    const cx = x - origin.x;
    const cy = y - origin.y;
    if (cx < 0 || cx >= GRID_W || cy < 0 || cy >= GRID_H)
      throw new Unsupported("pointer outside the window has no hotspot");
    return `cell/${cx},${cy}`;
  };
  switch (a.t) {
    case "down":
      if (UNSUPPORTED_TOOLS.includes(s.tool))
        throw new Unsupported(`tool ${s.tool}`);
      if (a.handle && getSelected(s)) {
        if (s.tool === "scale")
          throw new Unsupported(
            "resize handles under the Scale tool keep a ratio",
          );
        return [`handle/${a.handle}#down`];
      }
      return [`${cell(a.x, a.y)}#down`];
    case "move":
      return [`${cell(a.x, a.y)}#enter`];
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

/** The feature group an action belongs to, if it is one that can be left out (EditorOptions.omit). */
export function featureOf(a: Action): Feature | undefined {
  switch (a.t) {
    case "stroke":
    case "shadow":
      return "style";
    case "prop":
      return (STYLE_FIELDS as readonly string[]).includes(a.prop)
        ? "style"
        : undefined;
    case "align":
      return "align";
    case "key":
      return a.meta && (a.key === "c" || a.key === "x" || a.key === "v")
        ? "clipboard"
        : undefined;
    default:
      return undefined;
  }
}

/** One event to fire, after setting the input variables it reads. */
export interface Firing {
  id: string;
  inputs: Record<string, number>;
}

/** The hardware target's firing for a word-level event id: the hotspot `cell/cx,cy#…` is the one
 * pointer event `pointer#…`, with the window cell in in/px, in/py. Other events keep their id. */
export function onHardware(id: string): Firing {
  const m = /^cell\/(\d+),(\d+)#(\w+)$/.exec(id);
  return m
    ? {
        id: `pointer#${m[3]}`,
        inputs: { "in/px": Number(m[1]), "in/py": Number(m[2]) },
      }
    : { id, inputs: {} };
}

export { MAX_LAYERS };
