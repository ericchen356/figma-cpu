// Shared by the lockstep, hardware and compile tests: a seeded generator of editor sessions, a
// runner that holds the flow to its declared bit widths, the screen invariants, the one-action
// lockstep step, and the directed scripts that both targets must pass.
import { expect } from "vitest";
import {
  decode,
  eventsFor,
  featureOf,
  onHardware,
  Unsupported,
  viewOf,
  type Origin,
} from "../src/codec";
import { buildEditor, type Editor, type EditorOptions } from "../src/editor";
import { run, type Vars } from "../src/interp";
import type { Step, Val, VarDecl } from "../src/ir";
import {
  ALIGNS,
  CORNERS,
  CREATE_TOOLS,
  ELLIPSE_RR,
  GRID_H,
  GRID_W,
  MAX_LAYERS,
  PALETTE,
  TOOL_KEYS,
  TOOLS,
  UNSUPPORTED_TOOLS,
  WORLD,
  toolCode,
  type Feature,
  type Tool,
} from "../src/spec";
import {
  getSelected,
  initialState,
  parentOf,
  reduce,
  type Action,
  type Layer,
  type State,
} from "../../os-ui/src/model";

// ---------- a small seeded generator ----------

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

/** Tools whose canvas gestures the flow implements. The others are picked less often: their
 * buttons and keys work, but a pointer press under them is skipped as unsupported. */
const TOOLS_OK = TOOLS.filter((tool) => !UNSUPPORTED_TOOLS.includes(tool));
/** Every shortcut of each tool (Paint has two). */
const KEYS_OF = new Map<Tool, string[]>();
for (const [shortcut, tool] of Object.entries(TOOL_KEYS))
  KEYS_OF.set(tool, [...(KEYS_OF.get(tool) ?? []), shortcut]);

/** The next batch of actions: a drag gesture, a panel click or a key. Pointer cells are canvas
 * cells. Never an action of a feature in `omit` (with nothing omitted, the first draw is kept, so
 * a seed makes the same session it always did). */
export function actions(
  r: Rng,
  s: State,
  origin: Origin,
  omit: readonly Feature[] = [],
): Action[] {
  const omitted = (a: Action) => {
    const feature = featureOf(a);
    return feature !== undefined && omit.includes(feature);
  };
  for (;;) {
    const out = anyActions(r, s, origin);
    if (!out.some(omitted)) return out;
  }
}

function anyActions(r: Rng, s: State, origin: Origin): Action[] {
  const cell = () => ({
    x: origin.x + r.int(GRID_W),
    y: origin.y + r.int(GRID_H),
  });
  const sel = getSelected(s);
  const any = r.pick(s.layers.length ? s.layers : [undefined]);
  const roll = r.next();
  if (roll < 0.34) {
    const out: Action[] = [{ t: "down", ...cell() }];
    for (let i = r.int(4); i > 0; i--) out.push({ t: "move", ...cell() });
    out.push({ t: "up" });
    return out;
  }
  if (roll < 0.4 && sel) {
    const corner = r.pick(["nw", "ne", "sw", "se"] as const);
    return [
      { t: "down", ...cell(), handle: corner },
      { t: "move", ...cell() },
      { t: "move", ...cell() },
      { t: "up" },
    ];
  }
  if (roll < 0.52) {
    const tool = r.pick(r.chance(0.15) ? UNSUPPORTED_TOOLS : TOOLS_OK);
    const keys = KEYS_OF.get(tool);
    if (keys && r.chance(0.6)) {
      const shortcut = r.pick(keys);
      const shift = shortcut.startsWith("shift+");
      return [{ t: "key", key: shift ? shortcut.slice(6) : shortcut, shift }];
    }
    return [{ t: "tool", tool }];
  }
  if (roll < 0.58)
    return [{ t: "select", id: any && r.chance(0.85) ? any.id : null }];
  if (roll < 0.62 && any) return [{ t: "visible", id: any.id }];
  if (roll < 0.68) return [{ t: "fill", color: r.pick(PALETTE) }];
  if (roll < 0.7)
    return [{ t: "stroke", color: r.chance(0.3) ? "" : r.pick(PALETTE) }];
  if (roll < 0.72) return [{ t: "shadow", on: r.chance(0.5) }];
  if (roll < 0.8 && sel) {
    const prop = r.pick(["x", "y", "w", "h", "opacity", "radius"] as const);
    const cur = prop === "opacity" ? sel.opacity * 10 : sel[prop];
    const step = prop === "opacity" ? 10 : 1;
    return [
      { t: "prop", prop, value: String(cur + (r.chance(0.5) ? step : -step)) },
    ];
  }
  if (roll < 0.86) {
    // Most layers sit on the bare canvas, where align does nothing: half the aligns first draw a
    // layer inside a frame or section, or select one that sits in one.
    const align: Action = { t: "align", to: r.pick(ALIGNS) };
    const inside = drawInside(r, s, origin);
    if (inside && r.chance(0.5)) return [...inside, align];
    const child = r.pick(s.layers.filter((l) => parentOf(s, l)));
    if (child && r.chance(0.5)) return [{ t: "select", id: child.id }, align];
    return [align];
  }
  if (roll < 0.91)
    return [
      {
        t: "key",
        key: r.pick([
          "Delete",
          "Backspace",
          "]",
          "[",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Escape",
        ]),
      },
    ];
  if (roll < 0.98)
    return [{ t: "key", key: r.pick(["d", "c", "x", "v"]), meta: true }];
  return [{ t: "new" }];
}

/** A new layer drawn inside a frame or section the window shows: a create tool, then a drag
 * within the part of the container in view. When all of it is in view, sometimes the drag covers
 * it exactly, with the container's own tool: a twin, the same area. Nothing when no container is
 * in view or every slot is used. */
function drawInside(r: Rng, s: State, origin: Origin): Action[] | undefined {
  if (s.layers.length >= MAX_LAYERS) return undefined;
  /** The cells of [lo, lo + size) the window shows along one axis, first and last. */
  const shown = (lo: number, size: number, from: number, cells: number) =>
    [Math.max(lo, from), Math.min(lo + size, from + cells) - 1] as const;
  const boxes = s.layers.flatMap((l) => {
    if (l.kind !== "frame" && l.kind !== "section") return [];
    const xs = shown(l.x, l.w, origin.x, GRID_W);
    const ys = shown(l.y, l.h, origin.y, GRID_H);
    return xs[0] <= xs[1] && ys[0] <= ys[1]
      ? [
          {
            kind: l.kind,
            xs,
            ys,
            all: xs[1] - xs[0] + 1 === l.w && ys[1] - ys[0] + 1 === l.h,
          },
        ]
      : [];
  });
  if (!boxes.length) return undefined;
  const { kind, xs, ys, all } = r.pick(boxes);
  const twin = all && r.chance(0.3);
  const cell = ([lo, hi]: readonly [number, number]) => lo + r.int(hi - lo + 1);
  const [x0, x1, y0, y1] = twin
    ? [xs[0], xs[1], ys[0], ys[1]]
    : [cell(xs), cell(xs), cell(ys), cell(ys)];
  return [
    { t: "tool", tool: twin ? kind : r.pick(CREATE_TOOLS) },
    { t: "down", x: x0, y: y0 },
    { t: "move", x: x1, y: y1 },
    { t: "up" },
  ];
}

// ---------- running a flow as its target will ----------

/** Whether a number fits a width: unsigned 0 … 2^bits - 1, signed -2^(bits-1) … 2^(bits-1) - 1. */
export const fits = (v: number, bits: number, signed: boolean): boolean =>
  Number.isInteger(v) &&
  (signed
    ? v >= -(2 ** (bits - 1)) && v <= 2 ** (bits - 1) - 1
    : v >= 0 && v <= 2 ** bits - 1);

/** A write that does not fit its variable's width: the gate-level machine would truncate it. */
export class Overflow extends Error {}

/** Variables that refuse a number outside its variable's declared width. */
class CheckedVars extends Map<string, Val> {
  constructor(private readonly decls: ReadonlyMap<string, VarDecl>) {
    super();
  }

  override set(name: string, v: Val): this {
    const d = this.decls.get(name);
    if (
      d?.bits !== undefined &&
      typeof v === "number" &&
      !fits(v, d.bits, d.signed ?? false)
    )
      throw new Overflow(
        `${name} = ${v} does not fit ${d.signed ? "signed" : "unsigned"} ${d.bits} bits`,
      );
    return super.set(name, v);
  }
}

/** Runs an editor flow as its target will: every write, temps included, must fit its variable's
 * width. On the hardware target temps start each event at 0 and the inputs are set just before it. */
export class Runner {
  readonly vars: Vars;
  private readonly decls: Map<string, VarDecl>;
  private readonly byId = new Map<string, Step[]>();
  private readonly temps: VarDecl[];

  constructor(readonly ed: Editor) {
    this.decls = new Map(ed.vars.map((d) => [d.name, d]));
    this.vars = new CheckedVars(this.decls);
    for (const d of ed.vars) {
      if (this.vars.has(d.name))
        throw new Error(`variable ${d.name} declared twice`);
      this.vars.set(d.name, d.init);
    }
    for (const e of ed.events) {
      if (this.byId.has(e.id)) throw new Error(`event ${e.id} defined twice`);
      this.byId.set(e.id, e.steps);
    }
    this.temps = ed.vars.filter((d) => d.role === "temp");
  }

  /** Fires the event `id` after setting `inputs`. Returns the actions it executed. */
  fire(id: string, inputs: Record<string, number> = {}): number {
    const steps = this.byId.get(id);
    if (!steps) throw new Error(`no event ${id}`);
    if (this.ed.target === "hardware")
      for (const d of this.temps) this.vars.set(d.name, d.init);
    for (const [name, value] of Object.entries(inputs)) {
      if (this.decls.get(name)?.role !== "input")
        throw new Error(`${name} is not an input`);
      this.vars.set(name, value);
    }
    return run(steps, this.vars);
  }

  /** Fires what the UI event `id` (an eventsFor id) is on this target. */
  act(id: string): number {
    if (this.ed.target !== "hardware") return this.fire(id);
    const f = onHardware(id);
    return this.fire(f.id, f.inputs);
  }
}

// ---------- invariants the screen depends on ----------

/** The screen's variables against the state they derive from. `context` names the actions so far. */
export function checkScreen(run: Runner, context = () => ""): void {
  const v = run.vars;
  const n = v.get("g/n") as number;
  const sel = v.get("g/sel") as number;
  const want = (name: string, value: Val) => {
    if (v.get(name) !== value)
      expect.fail(
        `${context()}: ${name} is ${String(v.get(name))}, should be ${String(value)}`,
      );
  };
  for (let i = 0; i < MAX_LAYERS; i++) {
    want(`L${i}/used`, i < n);
    want(`L${i}/sel`, i === sel);
    if (i >= n) {
      want(`L${i}/vis`, false);
      continue;
    }
    const fill = v.get(`L${i}/fill`) as number;
    for (let k = 0; k < PALETTE.length; k++) want(`L${i}/f/${k}`, fill === k);
    const radius = (v.get(`L${i}/radius`) as number | undefined) ?? 0;
    want(
      `L${i}/rr`,
      v.get(`L${i}/kind`) === toolCode("ellipse")
        ? ELLIPSE_RR
        : radius * (run.ed.K / 4),
    );
  }
}

/** Applies `a` to the reducer and to the flow, and checks they still agree. Returns ran = false if
 * the flow does not do this yet. */
export function lockstep(
  run: Runner,
  s: State,
  a: Action,
  origin: Origin,
  history: string[],
): { s: State; ran: boolean; maxActions: number } {
  let ids: string[];
  try {
    ids = eventsFor(s, a, origin);
  } catch (e) {
    if (e instanceof Unsupported) return { s, ran: false, maxActions: 0 };
    throw e;
  }
  history.push(JSON.stringify(a));
  const context = () => `after: ${history.slice(-7).join(" ")}`;
  const next = reduce(s, a);
  let maxActions = 0;
  for (const id of ids)
    try {
      maxActions = Math.max(maxActions, run.act(id));
    } catch (e) {
      if (e instanceof Overflow) expect.fail(`${context()}: ${e.message}`);
      throw e;
    }
  expect(decode(run.vars, run.ed.K), context()).toEqual(
    viewOf(next, run.ed.omit),
  );
  checkScreen(run, context);
  return { s: next, ran: true, maxActions };
}

/** A random session of `steps` gestures in lockstep. The word-level window sometimes slides over
 * the canvas, as panning will; the hardware's stays at the origin. */
export function replay(
  seed: number,
  steps: number,
  opts: EditorOptions = {},
): { events: number; maxActions: number } {
  const r = rng(seed);
  const flow = new Runner(buildEditor(opts));
  const hw = flow.ed.target === "hardware";
  let s = initialState();
  let origin: Origin = { x: 0, y: 0 };
  const history: string[] = [`seed ${seed}`];
  let events = 0;
  let maxActions = 0;
  for (let step = 0; step < steps; step++) {
    if (!hw && r.chance(0.08)) {
      origin = { x: r.int(41) - 20, y: r.int(41) - 20 };
      flow.vars.set("v/x", origin.x * flow.ed.K);
      flow.vars.set("v/y", origin.y * flow.ed.K);
    }
    for (const a of actions(r, s, origin, flow.ed.omit)) {
      const out = lockstep(flow, s, a, origin, history);
      s = out.s;
      if (out.ran) events++;
      maxActions = Math.max(maxActions, out.maxActions);
    }
  }
  return { events, maxActions };
}

/** Drives a random session through the reducer and calls `fire` with each event it causes, so
 * other tests can run the same plausible sequences on any back end. On the hardware target an
 * event comes with the inputs to set first, and the window never moves; on the word level a
 * window move is the pseudo-event `@origin x y`. */
export function drive(
  seed: number,
  K: number,
  steps: number,
  fire: (id: string, inputs: Record<string, number>) => void,
  opts: Omit<EditorOptions, "K"> = {},
): number {
  const r = rng(seed);
  const hw = opts.target === "hardware";
  let s = initialState();
  let origin: Origin = { x: 0, y: 0 };
  let events = 0;
  for (let step = 0; step < steps; step++) {
    if (!hw && r.chance(0.08)) {
      origin = { x: r.int(41) - 20, y: r.int(41) - 20 };
      fire(`@origin ${origin.x * K} ${origin.y * K}`, {});
    }
    for (const a of actions(r, s, origin, opts.omit)) {
      let ids: string[];
      try {
        ids = eventsFor(s, a, origin);
      } catch (e) {
        if (e instanceof Unsupported) continue;
        throw e;
      }
      s = reduce(s, a);
      for (const id of ids) {
        const f = hw ? onHardware(id) : { id, inputs: {} };
        fire(f.id, f.inputs);
        events++;
      }
    }
  }
  return events;
}

// ---------- directed scripts ----------

/** The reducer and a flow side by side, driven one action at a time by a script. */
export class Session {
  s: State = initialState();
  readonly flow: Runner;
  private readonly origin: Origin = { x: 0, y: 0 };
  private readonly history: string[] = [];

  /** The flow is the editor `opts` builds, or a given Runner (one that also drives the gates, say). */
  constructor(flow: EditorOptions | Runner = {}) {
    this.flow = flow instanceof Runner ? flow : new Runner(buildEditor(flow));
  }

  /** Whether the flow has this feature group. */
  has(feature: Feature): boolean {
    return !this.flow.ed.omit.includes(feature);
  }

  /** The reducer's selected layer. */
  get sel(): Layer {
    const l = getSelected(this.s);
    if (!l) throw new Error("nothing is selected");
    return l;
  }

  /** Applies `a` to both and checks they agree. An action of a feature the flow leaves out is
   * skipped; any other must be one the flow does. */
  step(a: Action): void {
    const feature = featureOf(a);
    if (feature && !this.has(feature)) return;
    const out = lockstep(this.flow, this.s, a, this.origin, this.history);
    expect(out.ran, JSON.stringify(a)).toBe(true);
    this.s = out.s;
  }

  drag(x0: number, y0: number, x1: number, y1: number): void {
    this.step({ t: "down", x: x0, y: y0 });
    this.step({ t: "move", x: x1, y: y1 });
    this.step({ t: "up" });
  }

  /** Steps one property of the selection, one unit at a time, until it reads `to`. */
  walk(prop: "x" | "y" | "w" | "h", to: number): void {
    while (this.sel[prop] !== to) {
      const from = this.sel[prop];
      this.step({
        t: "prop",
        prop,
        value: String(from + Math.sign(to - from)),
      });
      if (this.sel[prop] === from)
        throw new Error(`${prop} is stuck at ${from}`);
    }
  }

  /** Presses each arrow key in `keys` and each stepper in `steppers` once on the selection, every
   * one a step past an edge where the reducer clamps; `back` puts the layer where it was after a
   * press that moved it. */
  pressPast(
    keys: readonly string[],
    steppers: readonly [prop: "x" | "y" | "w" | "h", dir: 1 | -1][],
    back: () => void = () => {},
  ): void {
    for (const key of keys) {
      this.step({ t: "key", key });
      back();
    }
    for (const [prop, dir] of steppers) {
      this.step({ t: "prop", prop, value: String(this.sel[prop] + dir) });
      back();
    }
  }
}

/** Directed scripts, so a regression in a rarely reached branch cannot hide behind the random
 * sessions. A script skips the actions of a feature the flow leaves out. */
export const SCRIPTS: Record<string, (t: Session) => void> = {
  "covers the paths that matter: full canvas, delete, reorder, clipboard, handles":
    (t) => {
      // Fill all eight slots, each a different shape and color, then try for a ninth.
      for (let i = 0; i <= MAX_LAYERS; i++) {
        t.step({ t: "key", key: ["r", "o", "f", "l"][i % 4] });
        t.step({ t: "fill", color: PALETTE[i % 16] });
        t.drag(i, 1, i + 2, 4);
      }
      expect(t.s.layers).toHaveLength(MAX_LAYERS);
      // Delete from the bottom, middle and top while the canvas is full.
      for (const id of [
        t.s.layers[0].id,
        t.s.layers[3].id,
        t.s.layers[t.s.layers.length - 1].id,
      ]) {
        t.step({ t: "select", id });
        t.step({ t: "key", key: "Delete" });
      }
      // Reorder at both ends, then duplicate, copy, cut and paste.
      t.step({ t: "select", id: t.s.layers[0].id });
      t.step({ t: "key", key: "[" });
      t.step({ t: "key", key: "]" });
      t.step({ t: "select", id: t.s.layers[t.s.layers.length - 1].id });
      t.step({ t: "key", key: "]" });
      t.step({ t: "key", key: "d", meta: true });
      t.step({ t: "key", key: "c", meta: true });
      t.step({ t: "key", key: "x", meta: true });
      t.step({ t: "key", key: "v", meta: true });
      // Resize from every handle.
      for (const handle of CORNERS) {
        t.step({ t: "down", x: 0, y: 0, handle });
        t.step({ t: "move", x: 7, y: 5 });
        t.step({ t: "up" });
      }
      t.step({ t: "new" });
      expect(t.s.layers).toHaveLength(0);
    },

  "aligns to the smallest containing frame, with ties to the lowest slot": (
    t,
  ) => {
    const make = (
      key: string,
      shift: boolean,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ) => {
      t.step({ t: "key", key, shift });
      t.drag(x0, y0, x1, y1);
    };
    make("f", false, 0, 0, 11, 8); // a big frame
    make("f", false, 2, 2, 9, 6); // a frame inside it
    make("f", false, 2, 2, 9, 6); // an identical twin: the lower slot wins
    make("s", true, 1, 1, 12, 9); // a section around everything but the big frame
    make("r", false, 4, 3, 6, 4); // a rectangle inside all of them
    for (const to of [
      "left",
      "hcenter",
      "right",
      "top",
      "vcenter",
      "bottom",
    ] as const)
      t.step({ t: "align", to });
    // The twin frames contain each other's box with equal area: the one with the lower id is the other's parent.
    for (const id of [t.s.layers[1].id, t.s.layers[2].id]) {
      t.step({ t: "select", id });
      for (const to of ["left", "hcenter", "bottom"] as const)
        t.step({ t: "align", to });
    }
    t.step({ t: "select", id: t.s.layers[0].id }); // the big frame has no parent: align does nothing
    t.step({ t: "align", to: "hcenter" });
    expect(t.s.layers[0].x).toBe(0);
    // A new document hides the slots but keeps their records: the old frames must not be parents.
    t.step({ t: "new" });
    make("r", false, 5, 5, 5, 5);
    for (const to of ["left", "top", "right"] as const)
      t.step({ t: "align", to });
    expect([t.sel.x, t.sel.y]).toEqual([5, 5]);
  },

  "stops at the edge of the canvas": (t) => {
    t.step({ t: "key", key: "r" });
    t.step({ t: "down", x: 3, y: 3 });
    t.step({ t: "up" });
    // Walk the layer to the far edge and back past the near edge with the x stepper, then grow it.
    for (let i = 0; i < WORLD + 4; i++)
      t.step({ t: "prop", prop: "x", value: String(t.sel.x + 1) });
    expect(t.sel.x).toBe(WORLD);
    for (let i = 0; i < 2 * WORLD + 4; i++)
      t.step({ t: "prop", prop: "x", value: String(t.sel.x - 1) });
    expect(t.sel.x).toBe(-WORLD);
    for (let i = 0; i < WORLD + 4; i++)
      t.step({ t: "prop", prop: "w", value: String(t.sel.w + 1) });
    expect(t.sel.w).toBe(WORLD);
  },

  "goes past the edge of the canvas: the widest box, far anchors, a layer aligned outside, every arrow and stepper clamped":
    (t) => {
      // A frame stretched from the far corner of the canvas to the far corner of the window is
      // wider and taller than a stepper can make one: 526 x 522 cells.
      t.step({ t: "key", key: "f" });
      t.step({ t: "down", x: 0, y: 0 });
      t.step({ t: "up" });
      const frame = t.sel.id;
      t.walk("x", -WORLD);
      t.walk("y", -WORLD);
      // In the near corner, 1 x 1: every control that would take it further leaves it there.
      t.pressPast(
        ["ArrowLeft", "ArrowUp"],
        [
          ["x", -1],
          ["y", -1],
          ["w", -1],
          ["h", -1],
        ],
      );
      const widest = () => {
        t.step({ t: "down", x: 0, y: 0, handle: "se" });
        t.step({ t: "move", x: GRID_W - 1, y: GRID_H - 1 });
        t.step({ t: "up" });
      };
      widest();
      expect([t.sel.w, t.sel.h]).toEqual([WORLD + GRID_W, WORLD + GRID_H]);
      // A w or h stepper, up or down, clamps it to the widest a stepper makes: stretched again after each.
      t.pressPast(
        [],
        [
          ["w", 1],
          ["w", -1],
          ["h", 1],
          ["h", -1],
        ],
        widest,
      );
      // Dragged by its far corner, 525 cells from its own, it stops at the canvas edge.
      t.drag(GRID_W - 1, GRID_H - 1, 0, 0);
      expect([t.sel.x, t.sel.y]).toEqual([-WORLD, -WORLD]);
      // Walked to the other corner, it sticks out past the canvas edge; it goes no further.
      t.walk("x", WORLD);
      t.walk("y", WORLD);
      t.pressPast(
        ["ArrowRight", "ArrowDown"],
        [
          ["x", 1],
          ["y", 1],
        ],
      );
      // A rectangle at the edge inside it, aligned to the frame's far sides: off the canvas, at
      // x = 1037, more than signed 11 bits hold.
      t.step({ t: "key", key: "r" });
      t.step({ t: "down", x: 1, y: 1 });
      t.step({ t: "up" });
      const rect = t.sel.id;
      t.walk("x", WORLD);
      t.walk("y", WORLD);
      for (const to of ["hcenter", "vcenter", "right", "bottom"] as const)
        t.step({ t: "align", to });
      if (t.has("align")) {
        expect([t.sel.x, t.sel.y]).toEqual([
          2 * WORLD + GRID_W - 1,
          2 * WORLD + GRID_H - 1,
        ]);
        // Every arrow and x or y stepper brings it back to the canvas edge; aligning puts it out again.
        t.pressPast(
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
          [
            ["x", -1],
            ["x", 1],
            ["y", -1],
            ["y", 1],
          ],
          () => {
            t.step({ t: "align", to: "right" });
            t.step({ t: "align", to: "bottom" });
          },
        );
      }
      // A duplicate, a nudge and a stepper bring it back onto the canvas; a pasted copy keeps its place.
      t.step({ t: "key", key: "d", meta: true });
      t.step({ t: "select", id: rect });
      t.step({ t: "key", key: "c", meta: true });
      t.step({ t: "key", key: "v", meta: true });
      t.step({ t: "key", key: "ArrowRight" });
      t.step({ t: "select", id: rect });
      t.step({ t: "prop", prop: "y", value: String(t.sel.y + 1) });
      // Its far corner anchors a resize: the box is clipped at the canvas edge.
      t.step({ t: "down", x: 0, y: 0, handle: "nw" });
      t.step({ t: "move", x: 5, y: 4 });
      t.step({ t: "up" });
      // So is the frame's, dragged back into the window.
      t.step({ t: "select", id: frame });
      t.step({ t: "down", x: 0, y: 0, handle: "nw" });
      t.step({ t: "move", x: 0, y: 0 });
      t.step({ t: "up" });
      expect([t.sel.x, t.sel.w]).toEqual([0, WORLD + 1]);
    },

  "aligns to the lower of two containers with the same area": (t) => {
    t.step({ t: "key", key: "f" });
    t.drag(0, 0, 5, 3); // a frame 6 x 4
    t.step({ t: "key", key: "f" });
    t.drag(0, 0, 3, 5); // a frame 4 x 6: the same area
    t.step({ t: "key", key: "r" });
    t.drag(1, 1, 2, 2); // a rectangle inside both
    t.step({ t: "align", to: "right" });
    if (t.has("align")) expect(t.sel.x).toBe(4); // slot 0 is the parent
    t.step({ t: "align", to: "bottom" });
    if (t.has("align")) expect(t.sel.y).toBe(2);
  },

  "a handle resize keeps a line's flip": (t) => {
    t.step({ t: "key", key: "l" });
    t.drag(5, 1, 2, 4); // against the diagonal
    expect(t.sel.flip).toBe(true);
    t.step({ t: "down", x: 0, y: 0, handle: "se" });
    t.step({ t: "move", x: 7, y: 6 });
    t.step({ t: "up" });
    expect(t.sel.flip).toBe(true);
  },

  "the eighth layer is loaded from its own slot": (t) => {
    for (let i = 0; i < MAX_LAYERS; i++) {
      t.step({ t: "key", key: "r" });
      t.drag(i, 0, i, 0);
    }
    t.step({ t: "key", key: "ArrowDown" }); // slot 7 is selected
    t.step({ t: "prop", prop: "w", value: String(t.sel.w + 1) });
    expect([t.sel.x, t.sel.y, t.sel.w]).toEqual([MAX_LAYERS - 1, 1, 2]);
  },
};
