// Reading the flow's variables as an editor state, and the other way round for the reducer,
// so the two can be compared field by field. Also the bridge from a reducer `Action` to the
// UI events a person would fire in Figma to cause it (a click on a hotspot, a tool button…),
// and from those to the hardware target's events, which read the pointer cell from inputs.
// Last, an editor state as the chip's registers (stateVars), and whether the chip can hold it.
import { buildEditor } from "./editor";
import type { Vars } from "./interp";
import type { Val, VarDecl } from "./ir";
import {
  CREATE_TOOLS,
  FEATURES,
  GRID_H,
  GRID_W,
  MAX_LAYERS,
  PALETTE,
  SELECT_TOOLS,
  STYLE_FIELDS,
  TOOLS,
  UNSUPPORTED_TOOLS,
  WORLD,
  toolCode,
  type Feature,
  type Tool,
} from "./spec";
import {
  getSelected,
  type Action,
  type Layer,
  type State,
} from "../../os-ui/src/model";

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

// ---------- an editor state as the chip's registers ----------

/** The hardware flow's variables by name, built once per feature configuration. Its state
 * variables are the chip's registers, in the order Synth.regs lists them. */
const HARDWARE = new Map<string, ReadonlyMap<string, VarDecl>>();
function hardwareVars(omit: readonly Feature[]): ReadonlyMap<string, VarDecl> {
  const key = FEATURES.filter((feature) => omit.includes(feature)).join();
  let vars = HARDWARE.get(key);
  if (!vars) {
    const ed = buildEditor({ target: "hardware", omit });
    vars = new Map(ed.vars.map((d) => [d.name, d]));
    HARDWARE.set(key, vars);
  }
  return vars;
}

/** Why `v` is not a whole number that the declared variable `name` holds, as `what`, or null. */
function fits(
  hw: ReadonlyMap<string, VarDecl>,
  name: string,
  v: unknown,
  what: string,
): string | null {
  const { bits = 0, signed = false } = hw.get(name)!;
  if (typeof v !== "number" || !Number.isInteger(v))
    return `${what} ${String(v)} isn't a whole number`;
  const [lo, hi] = signed
    ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1]
    : [0, 2 ** bits - 1];
  return v < lo || v > hi ? `${what} ${v} doesn't fit ${bits} bits` : null;
}

/** A box's x or y, or a span's anchor: its register, and no further out than the near edge of
 * the canvas. The reducer keeps every box there, and the chip's span relies on it (editor.ts
 * spanAxis clips only the far end). */
const onCanvas = (
  hw: ReadonlyMap<string, VarDecl>,
  name: string,
  v: unknown,
  what: string,
) =>
  fits(hw, name, v, what) ??
  ((v as number) < -WORLD
    ? `${what} ${v as number} is past the canvas edge at ${-WORLD}`
    : null);

/** Why the chip cannot hold `l` in a slot or on its clipboard, or null. */
function layerProblem(
  l: Layer,
  hw: ReadonlyMap<string, VarDecl>,
): string | null {
  if (l.kind === "text") return "text layers aren't on the chip yet";
  if (l.kind === "comment") return "comments aren't on the chip yet";
  if (!CREATE_TOOLS.includes(l.kind as Tool))
    return `kind ${String(l.kind)} is no layer kind`;
  if (l.rotation !== 0)
    return `rotated ${String(l.rotation)}°; the chip has no rotation`;
  if (l.text) return "it has text; the chip holds none";
  const size = (v: unknown, what: "w" | "h", way: string) =>
    fits(hw, `L0/${what}`, v, what) ??
    ((v as number) < 1 ? `${v as number} cells ${way}` : null);
  const why =
    fits(hw, "L0/id", l.id, "id") ??
    onCanvas(hw, "L0/x", l.x, "x") ??
    onCanvas(hw, "L0/y", l.y, "y") ??
    size(l.w, "w", "wide") ??
    size(l.h, "h", "tall");
  if (why) return why;
  // Align keeps the area of the best parent so far in t/area, which editor.ts sizes for the boxes
  // the hardware's window can drag out: a larger frame or section would wrap there, and align
  // would place the selection in the wrong parent.
  const area = hw.get("t/area");
  if (
    area &&
    (l.kind === "frame" || l.kind === "section") &&
    l.w * l.h > 2 ** area.bits! - 1
  )
    return `a ${l.kind} of ${l.w} × ${l.h} cells; align keeps areas in ${area.bits} bits`;
  const color = (c: string) => PALETTE.includes(c);
  if (!color(l.fill)) return `fill ${String(l.fill)} isn't a palette color`;
  for (const [field, v] of [
    ["visible", l.visible],
    ["flip", l.flip],
    ["shadow", l.shadow],
  ] as const)
    if (typeof v !== "boolean")
      return `${field} ${String(v)} isn't true or false`;
  if (!hw.has("L0/opacity"))
    return l.opacity === 10 && l.radius === 0 && l.stroke === "" && !l.shadow
      ? null
      : "styled; this chip leaves style out";
  const step = (v: unknown, hi: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= hi;
  if (!step(l.opacity, 10)) return `opacity ${String(l.opacity)} isn't 0 … 10`;
  if (!step(l.radius, 4)) return `radius ${String(l.radius)} isn't 0 … 4`;
  if (l.stroke !== "" && !color(l.stroke))
    return `stroke ${String(l.stroke)} isn't a palette color`;
  return null;
}

/** Why the chip cannot hold the drag `d`, or null. */
function dragProblem(
  d: State["drag"],
  hw: ReadonlyMap<string, VarDecl>,
): string | null {
  if (!d) return null;
  const anchor = (x: number, y: number) =>
    onCanvas(hw, "d/a", x, "anchor x") ?? onCanvas(hw, "d/b", y, "anchor y");
  switch (d.mode) {
    case "create":
      return anchor(d.sx, d.sy);
    case "resize":
      return d.keep === undefined
        ? anchor(d.ax, d.ay)
        : "a Scale-tool resize keeps a ratio";
    case "move":
      return (
        fits(hw, "d/a", d.ox, "offset x") ?? fits(hw, "d/b", d.oy, "offset y")
      );
    case "pen":
      return "a Pen stroke is being drawn";
    case "paint":
      return d.erase
        ? "an Erase stroke is being drawn"
        : "a Paint stroke is being drawn";
    default:
      return `mode ${String((d as { mode?: unknown }).mode)} is no drag`;
  }
}

/**
 * Why the chip cannot hold the editor state `s` exactly, or null when it can: then stateVars(s)
 * keeps all of it, and the chip started there does what os-ui's reducer does from s for as long
 * as the reducer's states stay ones it can hold (test/encode.test.ts runs it on from random
 * states, every edge included). `omit` names the feature groups the chip is built without.
 * Besides fitting the registers' widths (editor.ts), s must have
 *  · nothing the chip has no register for: no paint, Pen path or stroke, Paint or Erase stroke,
 *    text or comment layer, text being typed, rotation, Scale-tool resize (it keeps a ratio), and
 *    no style or clipboard on a chip built without them;
 *  · only values os-ui's model makes: palette colors, opacity 0 … 10, radius 0 … 4, boxes at
 *    least a cell big that start on the canvas, one layer per id, a selection that is a layer;
 *  · what the chip's logic needs on top: create and resize drags anchored on the canvas (the
 *    span clips only the far edge), frames and sections small enough for align's area register.
 * The file's title and the layer names are labels the chip does not keep. No rule of the editor
 * reads them (a copy is named after its kind and new id), so they do not count.
 */
export function representable(
  s: State,
  omit: readonly Feature[] = [],
): string | null {
  const hw = hardwareVars(omit);
  if (s.layers.length > MAX_LAYERS)
    return `${s.layers.length} layers; the chip holds ${MAX_LAYERS}`;
  const ids = new Set<number>();
  for (const l of s.layers) {
    const why = layerProblem(l, hw);
    if (why) return `layer ${l.id}: ${why}`;
    if (ids.has(l.id)) return `two layers have id ${l.id}`;
    ids.add(l.id);
  }
  if (s.selected !== null && !ids.has(s.selected))
    return `the selection, id ${String(s.selected)}, is no layer`;
  const why =
    fits(hw, "g/nextId", s.nextId, "nextId") ??
    (TOOLS.includes(s.tool) ? null : `the tool ${String(s.tool)} is unknown`) ??
    (PALETTE.includes(s.fill)
      ? null
      : `the fill ${String(s.fill)} isn't a palette color`);
  if (why) return why;
  const drag = dragProblem(s.drag, hw);
  if (drag) return `the drag: ${drag}`;
  if (s.clipboard) {
    if (!hw.has("clip/has"))
      return "a layer on the clipboard; this chip leaves the clipboard out";
    const clip = layerProblem(s.clipboard, hw);
    if (clip) return `the clipboard: ${clip}`;
  }
  const painted = Object.keys(s.paint).length;
  if (painted)
    return `${painted} painted cell${painted > 1 ? "s" : ""}; the chip holds no paint`;
  if (s.penFrom) return "a Pen path is open; the chip has no Pen";
  if (s.editing !== null) return "text is being typed; the chip has no text";
  return null;
}

/** A layer field's register value: decode()'s layer, the other way round (K = 1). */
function fieldOf(l: Layer, field: string): Val {
  switch (field) {
    case "id":
      return l.id;
    case "kind":
      return toolCode(l.kind);
    case "x":
      return l.x;
    case "y":
      return l.y;
    case "w":
      return l.w;
    case "h":
      return l.h;
    case "fill":
      return PALETTE.indexOf(l.fill);
    case "opacity":
      return l.opacity;
    case "radius":
      return l.radius;
    case "stroke":
      return l.stroke === "" ? -1 : PALETTE.indexOf(l.stroke);
    case "vis":
      return l.visible;
    case "shadow":
      return l.shadow;
    case "flip":
      return l.flip;
    default:
      throw new Error(`internal: the field ${field} has no register value`);
  }
}

/**
 * The value of every state variable of the hardware flow (the chip's registers) for the editor
 * state `s`, by name, in the order Synth.regs lists them: the inverse of decode() at K = 1, for
 * GateMachine.load(). Throws when the chip cannot hold s (representable() says why).
 * The registers no part of s decides hold their power-on values: the slots past the last layer,
 * the clipboard's record while it is empty, the drag's anchors while there is no drag. Nothing
 * the flow computes depends on them: it writes a slot or the clipboard whole before using it, and
 * hitTest, which looks at every slot, skips an unused one by its `vis`, false at power-on too.
 * A real session leaves old values there instead.
 */
export function stateVars(s: State, omit: readonly Feature[] = []): Vars {
  const why = representable(s, omit);
  if (why) throw new Error(`the chip cannot hold this state: ${why}`);
  const hw = hardwareVars(omit);
  const init = (name: string) => hw.get(name)!.init;
  const at = new Map<string, Val>();
  at.set("g/tool", toolCode(s.tool));
  at.set("g/tCreate", CREATE_TOOLS.includes(s.tool));
  at.set("g/tSelect", SELECT_TOOLS.includes(s.tool));
  at.set("g/fill", PALETTE.indexOf(s.fill));
  at.set("g/nextId", s.nextId);
  at.set("g/n", s.layers.length);
  at.set(
    "g/sel",
    s.layers.findIndex((l) => l.id === s.selected),
  );
  // d/mode is the index in DRAG_MODES; no other drag gets past representable().
  const d = s.drag;
  const [mode, a, b]: [number, Val, Val] =
    d?.mode === "create"
      ? [1, d.sx, d.sy]
      : d?.mode === "move"
        ? [2, d.ox, d.oy]
        : d?.mode === "resize"
          ? [3, d.ax, d.ay]
          : [0, init("d/a"), init("d/b")];
  at.set("d/mode", mode);
  at.set("d/a", a);
  at.set("d/b", b);
  const fields = [...hw.values()]
    .filter((v) => v.role === "state" && v.name.startsWith("L0/"))
    .map((v) => v.name.slice(3));
  const record = (rec: string, l: Layer | null | undefined) => {
    for (const field of fields) {
      const name = `${rec}/${field}`;
      at.set(name, l ? fieldOf(l, field) : init(name));
    }
  };
  if (hw.has("clip/has")) {
    at.set("clip/has", s.clipboard !== null);
    record("clip", s.clipboard);
  }
  for (let i = 0; i < MAX_LAYERS; i++) record(`L${i}`, s.layers[i]);
  const out: Vars = new Map();
  for (const v of hw.values()) {
    if (v.role !== "state") continue;
    const value = at.get(v.name);
    if (value === undefined)
      throw new Error(`internal: stateVars has no value for ${v.name}`);
    out.set(v.name, value);
    at.delete(v.name);
  }
  if (at.size)
    throw new Error(`internal: ${[...at.keys()].join(", ")} are no registers`);
  return out;
}

export { MAX_LAYERS };
