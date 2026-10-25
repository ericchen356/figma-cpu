// The chip loaded at any editor state it can hold: src/codec.ts stateVars() gives the registers of
// an os-ui State and representable() says when none hold it exactly, src/gates/load.ts pokesFor()
// and GateMachine.load() boot the gates there. A load is exact when the chip started at a state
// does what os-ui's reducer does from it, so the tests load it at states sessions reach (with
// actions the chip has no event for, too) and at random states anywhere its registers reach, edges
// included, and run it on in lockstep with the reducer, the flow beside it, every register
// compared after every event. Just past each limit representable() names, the bits do not exist,
// or the chip loaded with them anyway goes wrong where the reducer does not.
import { describe, expect, it } from "vitest";
import {
  decode,
  eventsFor,
  onHardware,
  representable,
  stateVars,
  Unsupported,
  viewOf,
} from "../src/codec";
import { buildEditor, type Editor } from "../src/editor";
import { GateMachine, pokesFor, synthesize, type Synth } from "../src/gates";
import type { Vars } from "../src/interp";
import { add, ref, set, type Program, type Val, type VarDecl } from "../src/ir";
import {
  CREATE_TOOLS,
  ELLIPSE_RR,
  FEATURES,
  MAX_LAYERS,
  PALETTE,
  TOOLS,
  WORLD,
  toolCode,
  type Feature,
} from "../src/spec";
import {
  initialState,
  LABEL,
  reduce,
  type Action,
  type Layer,
  type State,
} from "../../os-ui/src/model";
import {
  actions,
  lockstep,
  rng,
  Runner,
  SCRIPTS,
  Session,
  type Rng,
} from "./support";

/** The configurations hardware.test.ts runs: every feature, each group left out alone, all left out. */
const CONFIGS: Feature[][] = [[], ...FEATURES.map((f) => [f]), [...FEATURES]];
const label = (omit: readonly Feature[]) =>
  omit.length ? `without ${omit.join(", ")}` : "every feature";
/** The hardware's window stays at the canvas origin. */
const ORIGIN = { x: 0, y: 0 };
const KINDS = CREATE_TOOLS as readonly Layer["kind"][];
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** One chip per configuration, synthesized when a test first needs it. */
const CHIPS = new Map<string, { ed: Editor; syn: Synth; chip: GateMachine }>();
function chipFor(omit: readonly Feature[]) {
  const key = omit.join();
  let c = CHIPS.get(key);
  if (!c) {
    const ed = buildEditor({ target: "hardware", omit });
    const syn = synthesize(ed);
    c = { ed, syn, chip: new GateMachine(syn) };
    CHIPS.set(key, c);
  }
  return c;
}

/** Runs `f`, naming `where` in any failure. */
function within(where: string, f: () => void): void {
  try {
    f();
  } catch (e) {
    if (e instanceof Error) e.message = `${where}: ${e.message}`;
    throw e;
  }
}

// ---------- the registers a state decides ----------

/** `regs` with the registers no editor state decides back at power-on, where stateVars() puts
 * them: an unused slot's record but its vis, the clipboard's record while it is empty, the drag's
 * anchors while there is no drag. A session leaves old values there. */
function decided(
  regs: ReadonlyMap<string, Val>,
  states: readonly VarDecl[],
): Vars {
  const n = regs.get("g/n") as number;
  const empty = regs.get("clip/has") === false;
  const still = regs.get("d/mode") === 0;
  const out: Vars = new Map();
  for (const d of states) {
    const slot = /^L(\d+)\/(\w+)$/.exec(d.name);
    const stale =
      (slot !== null && Number(slot[1]) >= n && slot[2] !== "vis") ||
      (empty && d.name.startsWith("clip/") && d.name !== "clip/has") ||
      (still && (d.name === "d/a" || d.name === "d/b"));
    out.set(d.name, stale ? d.init : regs.get(d.name)!);
  }
  return out;
}

/** Fails at the first register where `got` is not what stateVars() says, `want`. */
function same(
  got: ReadonlyMap<string, Val>,
  want: ReadonlyMap<string, Val>,
  where: string,
): void {
  expect([...got.keys()], where).toEqual([...want.keys()]);
  for (const [name, v] of want)
    if (got.get(name) !== v)
      expect.fail(
        `${where}: ${name} is ${String(got.get(name))}, stateVars says ${String(v)}`,
      );
}

const statesOf = (ed: Editor) => ed.vars.filter((d) => d.role === "state");

// ---------- the chip and the flow, loaded ----------

/** The flow and the chip, both started at the registers `vars`: every event fires on both, then
 * every register must agree. The flow's view variables follow from its registers, as its
 * handlers keep them. Loading the same chip again boots it afresh: nothing of the last run stays. */
class Pair extends Runner {
  readonly states: VarDecl[];
  private readonly recent: string[] = [];

  constructor(
    ed: Editor,
    readonly chip: GateMachine,
    vars: Vars,
    private readonly where: string,
  ) {
    super(ed);
    this.states = statesOf(ed);
    const v = this.vars;
    for (const [name, value] of vars) v.set(name, value);
    for (let i = 0; i < MAX_LAYERS; i++) {
      for (let k = 0; k < PALETTE.length; k++)
        v.set(`L${i}/f/${k}`, v.get(`L${i}/fill`) === k);
      v.set(`L${i}/sel`, v.get("g/sel") === i);
      v.set(`L${i}/used`, i < (v.get("g/n") as number));
      const radius = (v.get(`L${i}/radius`) as number | undefined) ?? 0;
      v.set(
        `L${i}/rr`,
        v.get(`L${i}/kind`) === toolCode("ellipse")
          ? ELLIPSE_RR
          : radius * (ed.K / 4),
      );
    }
    chip.load(vars);
    this.agree("loaded");
  }

  override fire(id: string, inputs: Record<string, number> = {}): number {
    const n = super.fire(id, inputs);
    this.chip.fire(id, inputs);
    this.recent.push(
      Object.keys(inputs).length ? `${id} ${JSON.stringify(inputs)}` : id,
    );
    if (this.recent.length > 8) this.recent.shift();
    this.agree(`after ${this.recent.join(", ")}`);
    return n;
  }

  private agree(when: string): void {
    for (const d of this.states) {
      const got = this.chip.read(d.name);
      const want = this.vars.get(d.name);
      if (got !== want)
        expect.fail(
          `${this.where}, ${when}: ${d.name} is ${String(got)} in the gates, ${String(want)} in the flow`,
        );
    }
  }
}

/** One action on from `s`, the reducer and the pair in lockstep, when the chip can follow it: it
 * has events for it, and the reducer's next state is one it can hold (past that it wraps, at
 * nextId 256, say). Then the registers are also what stateVars() says of the next state. */
function follow(
  t: Pair,
  s: State,
  a: Action,
  omit: readonly Feature[],
  history: string[],
): { s: State; events: number } {
  let ids: string[];
  try {
    ids = eventsFor(s, a, ORIGIN);
  } catch (e) {
    if (e instanceof Unsupported) return { s, events: 0 };
    throw e;
  }
  if (representable(reduce(s, a), omit) !== null) return { s, events: 0 };
  const next = lockstep(t, s, a, ORIGIN, history).s;
  same(
    decided(t.vars, t.states),
    stateVars(next, omit),
    `after ${history.slice(-4).join(" ")}`,
  );
  return { s: next, events: ids.length };
}

/** `steps` more gestures of support.ts's generator on the hardware's window, from `s`. Returns
 * the events fired. */
function runOn(
  t: Pair,
  s: State,
  r: Rng,
  steps: number,
  omit: readonly Feature[],
  history: string[],
): number {
  let events = 0;
  for (let step = 0; step < steps; step++)
    for (const a of actions(r, s, ORIGIN, omit)) {
      const out = follow(t, s, a, omit, history);
      s = out.s;
      events += out.events;
    }
  return events;
}

// ---------- states to load ----------

/** A random session of the reducer alone, taking every action support.ts's generator makes, the
 * ones the chip has no event for too (Pen and Paint strokes, text, Scale-tool resizes…), with the
 * window sliding over the canvas as panning does: the states os-ui reaches. With `stay`, an action
 * that would take it where the chip cannot hold it is left out. Calls `visit` with every state;
 * returns the last one, and the generator to go on with. */
function wander(
  seed: number,
  steps: number,
  omit: readonly Feature[],
  visit: (s: State) => void,
  stay = false,
): { s: State; r: Rng } {
  const r = rng(seed);
  let s = initialState();
  let origin = ORIGIN;
  for (let step = 0; step < steps; step++) {
    if (r.chance(0.08)) origin = { x: r.int(41) - 20, y: r.int(41) - 20 };
    for (const a of actions(r, s, origin, omit)) {
      const next = reduce(s, a);
      if (stay && representable(next, omit) !== null) continue;
      s = next;
      visit(s);
    }
  }
  return { s, r };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A random state the chip can hold, out to every edge of its registers: boxes from the canvas
 * edge to x, y = 2047 and up to 1023 cells, frames and sections nested around a layer in the
 * window (some the same box, a twin) with areas up to align's limit, drags anchored anywhere,
 * ids and nextId up to 255, renamed layers and a named file (labels the chip does not keep). */
function anyState(r: Rng, omit: readonly Feature[]): State {
  const style = !omit.includes("style");
  const AREA = omit.includes("align") ? Infinity : 2 ** 19 - 1;
  const edge = (...xs: number[]) => r.pick(xs);
  const either = (...fs: (() => number)[]) => r.pick(fs)();
  const coord = () =>
    either(
      () => r.int(18) - 3,
      () => -WORLD + r.int(2048 + WORLD),
      () => edge(-WORLD, -WORLD + 1, WORLD, 2046, 2047),
    );
  const size = () =>
    either(
      () => 1 + r.int(12),
      () => 1 + r.int(1023),
      () => edge(1, 2, 528, 1022, 1023),
    );
  const ids = range(256);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  let used = 0;
  const container = (kind: string) => kind === "frame" || kind === "section";
  const fit = (kind: string, b: Box): Box =>
    container(kind) && b.w * b.h > AREA
      ? { ...b, h: Math.floor(AREA / b.w) }
      : b;
  const layer = (kind: Layer["kind"], b: Box, id = ids[used++]): Layer => ({
    id,
    kind,
    name: r.chance(0.2) ? `renamed ${id}` : `${LABEL[kind]} ${id}`,
    ...fit(kind, b),
    fill: r.pick(PALETTE),
    visible: r.chance(0.85),
    opacity: style ? edge(0, 10, r.int(11)) : 10,
    radius: style ? r.int(5) : 0,
    stroke: style && r.chance(0.5) ? r.pick(PALETTE) : "",
    shadow: style && r.chance(0.3),
    rotation: 0,
    flip: r.chance(0.3),
    text: "",
  });
  const anyBox = (): Box => ({ x: coord(), y: coord(), w: size(), h: size() });

  const layers: Layer[] = [];
  let child: Layer | undefined;
  if (r.chance(0.6)) {
    let b: Box = {
      x: r.int(12),
      y: r.int(8),
      w: 1 + r.int(3),
      h: 1 + r.int(3),
    };
    child = layer(r.pick(KINDS), b);
    layers.push(child);
    for (let k = 1 + r.int(3); k > 0; k--) {
      const grow = () => edge(0, 1, r.int(8), r.int(700));
      const left = Math.min(grow(), b.x + WORLD, 1023 - b.w);
      const top = Math.min(grow(), b.y + WORLD, 1023 - b.h);
      let outer: Box = {
        x: b.x - left,
        y: b.y - top,
        w: Math.min(1023, b.w + left + grow()),
        h: Math.min(1023, b.h + top + grow()),
      };
      if (r.chance(0.2) || outer.w * outer.h > AREA) outer = b;
      layers.push(layer(r.pick(["frame", "section"] as const), outer));
      b = outer;
    }
  }
  for (let k = r.int(MAX_LAYERS - layers.length + 1); k > 0; k--)
    layers.push(layer(r.pick(KINDS), anyBox()));
  for (let i = layers.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [layers[i], layers[j]] = [layers[j], layers[i]];
  }

  const top = Math.max(-1, ...layers.map((l) => l.id));
  const anchor = () =>
    either(
      () => r.int(18) - 3,
      () => -WORLD + r.int(2048 + WORLD),
      () => edge(-WORLD, 2047),
    );
  const offset = () =>
    either(
      () => r.int(4),
      () => r.int(4096) - 2048,
      () => edge(-2048, 2047),
    );
  const mode = r.int(5);
  const drag: State["drag"] =
    mode === 1
      ? { mode: "create", sx: anchor(), sy: anchor() }
      : mode === 2
        ? { mode: "move", ox: offset(), oy: offset() }
        : mode === 3
          ? { mode: "resize", ax: anchor(), ay: anchor() }
          : null;
  return {
    ...initialState(),
    title: r.chance(0.3) ? "Plans" : "Untitled",
    layers,
    selected:
      layers.length && r.chance(0.7)
        ? child && r.chance(0.6)
          ? child.id
          : r.pick(layers).id
        : null,
    tool: r.pick(TOOLS),
    fill: r.pick(PALETTE),
    nextId: either(
      () => (top < 255 ? top + 1 + r.int(255 - top) : 255),
      () => r.int(256),
      () => edge(254, 255),
    ),
    drag,
    clipboard:
      !omit.includes("clipboard") && r.chance(0.5)
        ? layer(r.pick(KINDS), anyBox(), r.int(256))
        : null,
  };
}

// ---------- every configuration ----------

for (const omit of CONFIGS)
  describe(`the chip loaded at an editor state, ${label(omit)}`, () => {
    const ed = buildEditor({ target: "hardware", omit });
    const states = statesOf(ed);

    it("is at power-on at os-ui's initial state, with synthesize()'s pokes", () => {
      const { syn, chip } = chipFor(omit);
      const vars = stateVars(initialState(), omit);
      expect([...vars]).toEqual(states.map((d) => [d.name, d.init]));
      expect([...vars.keys()]).toEqual([...syn.regs.keys()]);
      // The same pokes, in the same order: powerOn() settles both machines the same.
      expect(Object.entries(pokesFor(syn, vars))).toEqual(
        Object.entries(syn.pokes),
      );
      chip.load(vars);
      for (const [name, v] of vars) expect(chip.read(name), name).toBe(v);
      chip.reset();
      for (const [name, v] of vars) expect(chip.read(name), name).toBe(v);
    });

    it("decodes to the reducer's view at every state sessions reach that the chip can hold", () => {
      let held = 0;
      const refused = new Map<string, number>();
      for (let seed = 1; seed <= 24; seed++)
        wander(seed, 150, omit, (s) => {
          const why = representable(s, omit);
          if (why !== null) {
            const kind = why.replace(/-?\d+/g, "N");
            refused.set(kind, (refused.get(kind) ?? 0) + 1);
            return;
          }
          held++;
          expect(decode(stateVars(s, omit), 1), `seed ${seed}`).toEqual(
            viewOf(s, omit),
          );
        });
      // Both sides are reached: Pen and Paint strokes leave paint, and text and comments are
      // refused until they are deleted.
      expect(held).toBeGreaterThan(2000);
      expect([...refused.keys()]).toEqual(
        expect.arrayContaining([
          "N painted cells; the chip holds no paint",
          "layer N: text layers aren't on the chip yet",
          "layer N: comments aren't on the chip yet",
        ]),
      );
    });

    it("is what the flow holds after every action of random sessions and of every script, but for the registers no state decides", () => {
      for (let seed = 1; seed <= 12; seed++) {
        const r = rng(seed);
        const flow = new Runner(ed);
        let s = initialState();
        const history = [`seed ${seed}`];
        for (let step = 0; step < 120; step++)
          for (const a of actions(r, s, ORIGIN, omit)) {
            const out = lockstep(flow, s, a, ORIGIN, history);
            if (!out.ran) continue;
            s = out.s;
            same(
              decided(flow.vars, states),
              stateVars(s, omit),
              `seed ${seed}, after ${history.slice(-4).join(" ")}`,
            );
          }
      }
      for (const [name, script] of Object.entries(SCRIPTS))
        within(name, () => script(new Probe(omit, states)));
    });

    it("loads mid-session and runs on in lockstep with the reducer, every register equal after every event", () => {
      const { chip } = chipFor(omit);
      let events = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const steps = 5 + ((seed * 37) % 80);
        const where = `seed ${seed}, loaded after ${steps} gestures`;
        // The session goes on where it was, now on the hardware's window.
        const { s, r } = wander(seed, steps, omit, () => {}, true);
        within(where, () => {
          const t = new Pair(ed, chip, stateVars(s, omit), where);
          events += runOn(t, s, r, 60, omit, [where]);
        });
      }
      expect(events).toBeGreaterThan(20 * 60);
    });

    it("loads at random states anywhere the chip can hold, edges included, and runs on in lockstep", () => {
      const { chip } = chipFor(omit);
      const r = rng(77 + omit.length);
      let events = 0;
      for (let k = 0; k < 30; k++) {
        const s = anyState(r, omit);
        const where = `random state ${k}`;
        expect(representable(s, omit), where).toBeNull();
        within(where, () => {
          const t = new Pair(ed, chip, stateVars(s, omit), where);
          const history = [where];
          let at = s;
          // A drag it was loaded in goes on first.
          const go = (a: Action) => {
            const out = follow(t, at, a, omit, history);
            at = out.s;
            events += out.events;
          };
          if (s.drag) {
            for (let i = 1 + r.int(3); i > 0; i--)
              go({ t: "move", x: r.int(14), y: r.int(10) });
            if (r.chance(0.5)) go({ t: "up" });
          }
          events += runOn(t, at, r, 30, omit, history);
        });
      }
      expect(events).toBeGreaterThan(30 * 25);
    });
  });

/** A script's session that also holds the flow's registers to stateVars() after every step. */
class Probe extends Session {
  constructor(
    private readonly omit: readonly Feature[],
    private readonly states: readonly VarDecl[],
  ) {
    super({ target: "hardware", omit });
  }

  override step(a: Action): void {
    super.step(a);
    const vars = stateVars(this.s, this.omit);
    const where = `after ${JSON.stringify(a)}`;
    expect(decode(vars, 1), where).toEqual(viewOf(this.s, this.omit));
    same(decided(this.flow.vars, this.states), vars, where);
  }
}

describe("the chip loaded at an editor state, on RefSim", () => {
  it("runs on in lockstep on the golden simulator too", () => {
    const { ed, syn } = chipFor([]);
    const ref = new GateMachine(syn, { reference: true });
    const r = rng(5);
    let events = 0;
    for (let k = 0; k < 3; k++) {
      const s = anyState(r, []);
      const where = `random state ${k}`;
      within(where, () => {
        events += runOn(
          new Pair(ed, ref, stateVars(s), where),
          s,
          r,
          8,
          [],
          [where],
        );
      });
    }
    expect(events).toBeGreaterThan(10);
  });
});

// ---------- what the chip cannot hold ----------

const rect = (id: number, over: Partial<Layer> = {}): Layer => ({
  id,
  kind: "rect",
  name: `Rectangle ${id}`,
  x: 1,
  y: 1,
  w: 2,
  h: 2,
  fill: PALETTE[12],
  visible: true,
  opacity: 10,
  radius: 0,
  stroke: "",
  shadow: false,
  rotation: 0,
  flip: false,
  text: "",
  ...over,
});
/** Two rectangles, the second selected, and whatever `over` changes. */
const doc = (over: Partial<State> = {}): State => ({
  ...initialState(),
  layers: [rect(1), rect(2, { x: 4 })],
  selected: 2,
  nextId: 3,
  ...over,
});
/** doc() with the first layer changed. */
const first = (over: Partial<Layer>): State =>
  doc({ layers: [rect(1, over), rect(2, { x: 4 })] });
const frame = (id: number, over: Partial<Layer>): Layer =>
  rect(id, { kind: "frame", name: `Frame ${id}`, ...over });

/** [what, a state just inside the limit, one just past it, the reason, the configuration]. */
const EDGES: [string, State, State, RegExp, Feature[]?][] = [
  [
    "8 layers",
    doc({ layers: range(8).map((i) => rect(i + 1)), nextId: 9 }),
    doc({ layers: range(9).map((i) => rect(i + 1)), nextId: 10 }),
    /^9 layers; the chip holds 8$/,
  ],
  [
    "an id up to 255",
    first({ id: 255 }),
    first({ id: 256 }),
    /^layer 256: id 256 doesn't fit 8 bits$/,
  ],
  [
    "an id from 0",
    first({ id: 0 }),
    first({ id: -1 }),
    /^layer -1: id -1 doesn't fit 8 bits$/,
  ],
  [
    "a whole id",
    first({ id: 7 }),
    first({ id: 1.5 }),
    /^layer 1.5: id 1.5 isn't a whole number$/,
  ],
  [
    "one layer per id",
    doc(),
    doc({ layers: [rect(1), rect(1, { x: 4 })], selected: 1 }),
    /^two layers have id 1$/,
  ],
  [
    "a selection that is a layer",
    doc({ selected: 1 }),
    doc({ selected: 9 }),
    /^the selection, id 9, is no layer$/,
  ],
  [
    "nextId up to 255",
    doc({ nextId: 255 }),
    doc({ nextId: 256 }),
    /^nextId 256 doesn't fit 8 bits$/,
  ],
  [
    "nextId from 0",
    doc({ nextId: 0 }),
    doc({ nextId: -1 }),
    /^nextId -1 doesn't fit 8 bits$/,
  ],
  [
    "x from the canvas edge",
    first({ x: -WORLD }),
    first({ x: -WORLD - 1 }),
    /^layer 1: x -513 is past the canvas edge at -512$/,
  ],
  [
    "x up to 2047",
    first({ x: 2047 }),
    first({ x: 2048 }),
    /^layer 1: x 2048 doesn't fit 12 bits$/,
  ],
  [
    "y from the canvas edge",
    first({ y: -WORLD }),
    first({ y: -WORLD - 1 }),
    /^layer 1: y -513 is past the canvas edge at -512$/,
  ],
  [
    "y up to 2047",
    first({ y: 2047 }),
    first({ y: 2048 }),
    /^layer 1: y 2048 doesn't fit 12 bits$/,
  ],
  [
    "a whole x",
    first({ x: 3 }),
    first({ x: 2.5 }),
    /^layer 1: x 2.5 isn't a whole number$/,
  ],
  ["w from 1", first({ w: 1 }), first({ w: 0 }), /^layer 1: 0 cells wide$/],
  [
    "w up to 1023",
    first({ w: 1023 }),
    first({ w: 1024 }),
    /^layer 1: w 1024 doesn't fit 10 bits$/,
  ],
  ["h from 1", first({ h: 1 }), first({ h: 0 }), /^layer 1: 0 cells tall$/],
  [
    "h up to 1023",
    first({ h: 1023 }),
    first({ h: 1024 }),
    /^layer 1: h 1024 doesn't fit 10 bits$/,
  ],
  [
    "a frame up to align's 19-bit area",
    doc({ layers: [frame(1, { w: 1022, h: 513 }), rect(2)] }),
    doc({ layers: [frame(1, { w: 1023, h: 513 }), rect(2)] }),
    /^layer 1: a frame of 1023 × 513 cells; align keeps areas in 19 bits$/,
  ],
  [
    "a section up to align's 19-bit area",
    first({ kind: "section", w: 513, h: 1022 }),
    first({ kind: "section", w: 513, h: 1023 }),
    /^layer 1: a section of 513 × 1023 cells; align keeps areas in 19 bits$/,
  ],
  [
    "a palette fill",
    first({ fill: PALETTE[8] }),
    first({ fill: "#123456" }),
    /^layer 1: fill #123456 isn't a palette color$/,
  ],
  [
    "a palette fill, as written",
    first({ fill: PALETTE[8] }),
    first({ fill: PALETTE[8].toUpperCase() }),
    /^layer 1: fill #FF004D isn't a palette color$/,
  ],
  [
    "a palette stroke",
    first({ stroke: PALETTE[0] }),
    first({ stroke: "#123456" }),
    /^layer 1: stroke #123456 isn't a palette color$/,
  ],
  [
    "opacity up to 10",
    first({ opacity: 10 }),
    first({ opacity: 11 }),
    /^layer 1: opacity 11 isn't 0 … 10$/,
  ],
  [
    "opacity from 0",
    first({ opacity: 0 }),
    first({ opacity: -1 }),
    /^layer 1: opacity -1 isn't 0 … 10$/,
  ],
  [
    "a whole opacity",
    first({ opacity: 5 }),
    first({ opacity: 5.5 }),
    /^layer 1: opacity 5.5 isn't 0 … 10$/,
  ],
  [
    "radius up to 4",
    first({ radius: 4 }),
    first({ radius: 5 }),
    /^layer 1: radius 5 isn't 0 … 4$/,
  ],
  [
    "radius from 0",
    first({ radius: 0 }),
    first({ radius: -1 }),
    /^layer 1: radius -1 isn't 0 … 4$/,
  ],
  [
    "a boolean visible",
    first({ visible: false }),
    first({ visible: 1 as unknown as boolean }),
    /^layer 1: visible 1 isn't true or false$/,
  ],
  [
    "no rotation",
    first({ rotation: 0 }),
    first({ rotation: 90 }),
    /^layer 1: rotated 90°; the chip has no rotation$/,
  ],
  [
    "no text layers",
    first({ kind: "star" }),
    first({ kind: "text", name: "hi", text: "hi" }),
    /^layer 1: text layers aren't on the chip yet$/,
  ],
  [
    "no comments",
    first({ kind: "slice" }),
    first({ kind: "comment", text: "note" }),
    /^layer 1: comments aren't on the chip yet$/,
  ],
  [
    "no text on a shape",
    first({ text: "" }),
    first({ text: "hi" }),
    /^layer 1: it has text; the chip holds none$/,
  ],
  [
    "a layer kind",
    first({ kind: "arrow" }),
    first({ kind: "pen" as Layer["kind"] }),
    /^layer 1: kind pen is no layer kind$/,
  ],
  [
    "a known tool",
    doc({ tool: "comment" }),
    doc({ tool: "lasso" as State["tool"] }),
    /^the tool lasso is unknown$/,
  ],
  [
    "a palette fill to draw with",
    doc({ fill: PALETTE[0] }),
    doc({ fill: "#123456" }),
    /^the fill #123456 isn't a palette color$/,
  ],
  [
    "a create drag anchored from the canvas edge",
    doc({ drag: { mode: "create", sx: -WORLD, sy: 0 } }),
    doc({ drag: { mode: "create", sx: -WORLD - 1, sy: 0 } }),
    /^the drag: anchor x -513 is past the canvas edge at -512$/,
  ],
  [
    "a create drag anchored up to 2047",
    doc({ drag: { mode: "create", sx: 0, sy: 2047 } }),
    doc({ drag: { mode: "create", sx: 0, sy: 2048 } }),
    /^the drag: anchor y 2048 doesn't fit 12 bits$/,
  ],
  [
    "a resize anchored from the canvas edge",
    doc({ drag: { mode: "resize", ax: 2047, ay: -WORLD } }),
    doc({ drag: { mode: "resize", ax: 2047, ay: -WORLD - 1 } }),
    /^the drag: anchor y -513 is past the canvas edge at -512$/,
  ],
  [
    "a resize that keeps no ratio",
    doc({ drag: { mode: "resize", ax: 1, ay: 1, keep: undefined } }),
    doc({ drag: { mode: "resize", ax: 1, ay: 1, keep: 2 } }),
    /^the drag: a Scale-tool resize keeps a ratio$/,
  ],
  [
    "a move's offset from -2048",
    doc({ drag: { mode: "move", ox: -2048, oy: 2047 } }),
    doc({ drag: { mode: "move", ox: -2049, oy: 2047 } }),
    /^the drag: offset x -2049 doesn't fit 12 bits$/,
  ],
  [
    "a move's offset up to 2047",
    doc({ drag: { mode: "move", ox: -2048, oy: 2047 } }),
    doc({ drag: { mode: "move", ox: -2048, oy: 2048 } }),
    /^the drag: offset y 2048 doesn't fit 12 bits$/,
  ],
  [
    "no Pen stroke",
    doc({ drag: null }),
    doc({ drag: { mode: "pen", sx: 1, sy: 1, lx: 1, ly: 1, moved: false } }),
    /^the drag: a Pen stroke is being drawn$/,
  ],
  [
    "no Paint stroke",
    doc({ drag: null }),
    doc({ drag: { mode: "paint", lx: 1, ly: 1, erase: false } }),
    /^the drag: a Paint stroke is being drawn$/,
  ],
  [
    "no Erase stroke",
    doc({ drag: null }),
    doc({ drag: { mode: "paint", lx: 1, ly: 1, erase: true } }),
    /^the drag: an Erase stroke is being drawn$/,
  ],
  [
    "a clipboard layer like any other",
    doc({ clipboard: rect(7) }),
    doc({ clipboard: rect(7, { kind: "text", text: "hi" }) }),
    /^the clipboard: text layers aren't on the chip yet$/,
  ],
  [
    "a clipboard layer on the canvas",
    doc({ clipboard: rect(7, { x: -WORLD }) }),
    doc({ clipboard: rect(7, { x: -WORLD - 1 }) }),
    /^the clipboard: x -513 is past the canvas edge at -512$/,
  ],
  [
    "no paint",
    doc({ paint: {} }),
    doc({ paint: { "3,4": 2 } }),
    /^1 painted cell; the chip holds no paint$/,
  ],
  [
    "no Pen path",
    doc({ penFrom: null }),
    doc({ penFrom: { x: 1, y: 1 } }),
    /^a Pen path is open; the chip has no Pen$/,
  ],
  [
    "no text being typed",
    doc({ editing: null }),
    doc({ editing: 1 }),
    /^text is being typed; the chip has no text$/,
  ],
  [
    "no style, built without it",
    first({ opacity: 10 }),
    first({ opacity: 9 }),
    /^layer 1: styled; this chip leaves style out$/,
    ["style"],
  ],
  [
    "no stroke, built without style",
    first({ stroke: "" }),
    first({ stroke: PALETTE[1] }),
    /^layer 1: styled; this chip leaves style out$/,
    ["style"],
  ],
  [
    "no shadow, built without style",
    first({ shadow: false }),
    first({ shadow: true }),
    /^layer 1: styled; this chip leaves style out$/,
    ["style"],
  ],
  [
    "a plain clipboard, built without style",
    doc({ clipboard: rect(7) }),
    doc({ clipboard: rect(7, { radius: 2 }) }),
    /^the clipboard: styled; this chip leaves style out$/,
    ["style"],
  ],
  [
    "no clipboard, built without it",
    doc({ clipboard: null }),
    doc({ clipboard: rect(7) }),
    /^a layer on the clipboard; this chip leaves the clipboard out$/,
    ["clipboard"],
  ],
];

describe("what the chip cannot hold", () => {
  for (const [what, inside, outside, reason, omit = []] of EDGES)
    it(`${what}${omit.length ? ` (${label(omit)})` : ""}`, () => {
      expect(representable(inside, omit)).toBeNull();
      const why = representable(outside, omit);
      expect(why).toMatch(reason);
      expect(() => stateVars(outside, omit)).toThrow(
        `the chip cannot hold this state: ${why}`,
      );
      // Just inside, the chip holds it: it loads, and decodes to the reducer's view.
      const { syn, chip } = chipFor(omit);
      const vars = stateVars(inside, omit);
      chip.load(vars);
      const loaded = new Map(
        [...syn.regs.keys()].map((n) => [n, chip.read(n)]),
      );
      expect(loaded).toEqual(vars);
      expect(decode(loaded, 1)).toEqual(viewOf(inside, omit));
    });

  it("holds what has no edge: every kind and tool, a hidden layer, and the labels it does not keep", () => {
    const states = [
      doc({
        layers: KINDS.slice(0, 8).map((kind, i) => rect(i + 1, { kind })),
        nextId: 9,
      }),
      doc({
        layers: [rect(1, { kind: KINDS[8] }), rect(2, { visible: false })],
      }),
      ...TOOLS.map((tool) => doc({ tool })),
      // Align's area limit is a frame's or section's: a rectangle may be as big as it likes.
      first({ w: 1023, h: 1023 }),
    ];
    for (const [i, s] of states.entries())
      expect(representable(s), `state ${i}`).toBeNull();
    // And so may a frame, on a chip without align.
    expect(
      representable(
        doc({ layers: [frame(1, { w: 1023, h: 1023 }), rect(2)] }),
        ["align"],
      ),
    ).toBeNull();
    // A file's title and a layer's name: labels the chip does not keep, and they change nothing.
    const named = doc({
      title: "Plans",
      layers: [rect(1, { name: "Logo" }), rect(2, { x: 4 })],
    });
    expect(representable(named)).toBeNull();
    expect(stateVars(named)).toEqual(stateVars(doc()));
  });
});

/** The chip's registers as a view. */
const chipView = (syn: Synth, chip: GateMachine) =>
  decode(new Map([...syn.regs.keys()].map((n) => [n, chip.read(n)])), 1);

/** The chip loaded at `vars` and the reducer at `s` take `acts`: their views after. */
function play(vars: Vars, s: State, acts: Action[]) {
  const { syn, chip } = chipFor([]);
  chip.load(vars);
  for (const a of acts) {
    for (const id of eventsFor(s, a, ORIGIN)) {
      const f = onHardware(id);
      chip.fire(f.id, f.inputs);
    }
    s = reduce(s, a);
  }
  return { chip: chipView(syn, chip), reducer: viewOf(s) };
}

/** [what, a state just inside the limit, one just past it with the registers that differ, what the
 * two take]. Each bit fits its register, and the registers decode to the state just past it. */
const WITNESSES: [string, State, State, Record<string, Val>, Action[]][] = [
  [
    "a create drag anchored past the canvas edge: its span clips the near end there in the reducer only",
    doc({
      layers: [rect(1, { x: 2, y: 2, w: 1, h: 1 })],
      selected: 1,
      nextId: 2,
      drag: { mode: "create", sx: -WORLD, sy: 2 },
    }),
    doc({
      layers: [rect(1, { x: 2, y: 2, w: 1, h: 1 })],
      selected: 1,
      nextId: 2,
      drag: { mode: "create", sx: -WORLD - 1, sy: 2 },
    }),
    { "d/a": -WORLD - 1 },
    [{ t: "move", x: 5, y: 5 }],
  ],
  [
    "a box past the canvas edge: a resize from its far corner anchors there",
    doc({
      layers: [rect(1, { x: -WORLD, y: 2, w: 3, h: 1 })],
      selected: 1,
      nextId: 2,
    }),
    doc({
      layers: [rect(1, { x: -WORLD - 1, y: 2, w: 3, h: 1 })],
      selected: 1,
      nextId: 2,
    }),
    { "L0/x": -WORLD - 1 },
    [
      { t: "down", x: 0, y: 0, handle: "se" },
      { t: "move", x: 5, y: 5 },
    ],
  ],
  [
    "a frame past align's area: the area wraps, and align takes it for the parent instead of the frame inside it",
    doc({
      layers: [
        frame(1, { x: 0, y: 0, w: 1022, h: 513 }),
        frame(2, { x: 0, y: 0, w: 30, h: 30 }),
        rect(3, { x: 5, y: 5 }),
      ],
      selected: 3,
      nextId: 4,
    }),
    doc({
      layers: [
        frame(1, { x: 0, y: 0, w: 1023, h: 513 }),
        frame(2, { x: 0, y: 0, w: 30, h: 30 }),
        rect(3, { x: 5, y: 5 }),
      ],
      selected: 3,
      nextId: 4,
    }),
    { "L0/w": 1023 },
    [{ t: "align", to: "right" }],
  ],
  [
    "two layers with one id: the reducer shows or hides both",
    doc(),
    doc({ layers: [rect(1), rect(1, { x: 4 })], selected: null }),
    { "L1/id": 1, "g/sel": -1 },
    [{ t: "visible", id: 1 }],
  ],
  [
    "a frame no cells wide: the chip's parent test needs areas that grow with the box",
    doc({
      layers: [
        frame(5, { x: 0, y: 0, w: 1, h: 5 }),
        rect(4, { x: 0, y: 1, w: 1, h: 3 }),
      ],
      selected: 4,
      nextId: 6,
    }),
    doc({
      layers: [
        frame(5, { x: 0, y: 0, w: 0, h: 5 }),
        rect(4, { x: 0, y: 1, w: 0, h: 3 }),
      ],
      selected: 4,
      nextId: 6,
    }),
    { "L0/w": 0, "L1/w": 0 },
    [{ t: "align", to: "bottom" }],
  ],
];

describe("each limit of the chip's logic is real", () => {
  for (const [what, inside, outside, bits, acts] of WITNESSES)
    it(what, () => {
      expect(representable(inside)).toBeNull();
      expect(representable(outside)).not.toBeNull();
      const ok = play(stateVars(inside), inside, acts);
      expect(ok.chip).toEqual(ok.reducer);
      // The same bits with the registers past the limit: they hold the state, then go wrong.
      const raw: Vars = new Map(stateVars(inside));
      for (const [name, v] of Object.entries(bits)) raw.set(name, v);
      expect(decode(raw, 1)).toEqual(viewOf(outside));
      const bad = play(raw, outside, acts);
      expect(bad.chip).not.toEqual(bad.reducer);
    });
});

// ---------- pokesFor ----------

describe("pokesFor", () => {
  it("needs every register, at a value its width holds, and ignores other names", () => {
    const { syn } = chipFor([]);
    const vars = stateVars(initialState());
    const without = new Map(vars);
    without.delete("L3/flip");
    expect(() => pokesFor(syn, without)).toThrow(
      /^no value for the register L3\/flip$/,
    );
    for (const [name, v, message] of [
      ["L0/x", 2048, /^L0\/x = 2048 does not fit signed 12 bits$/],
      ["L0/x", -2049, /^L0\/x = -2049 does not fit signed 12 bits$/],
      ["g/n", 16, /^g\/n = 16 does not fit unsigned 4 bits$/],
      ["g/nextId", 1.5, /^g\/nextId = 1.5 does not fit unsigned 8 bits$/],
      ["g/tool", true, /^g\/tool = true does not fit unsigned 5 bits$/],
      ["L0/vis", 1, /^L0\/vis is a bool register, not 1$/],
    ] as const)
      expect(() => pokesFor(syn, new Map(vars).set(name, v))).toThrow(message);
    // A flow's whole variable map: its temps, views and inputs are no registers.
    expect(
      pokesFor(syn, new Runner(buildEditor({ target: "hardware" })).vars),
    ).toEqual(syn.pokes);
  });

  it("holds a register the synthesizer proved constant at its constant only", () => {
    const program: Program = {
      vars: [
        {
          name: "c",
          ty: "num",
          init: 3,
          role: "state",
          bits: 4,
          signed: false,
        },
        {
          name: "r",
          ty: "num",
          init: 0,
          role: "state",
          bits: 4,
          signed: false,
        },
      ],
      events: [
        {
          id: "e#click",
          node: "e",
          trigger: { type: "click" },
          steps: set("r", add(ref("r"), ref("c"))),
        },
      ],
    };
    const syn = synthesize(program);
    expect(syn.regs.get("c")!.nets).toEqual(["1", "1", "0", "0"]);
    const m = new GateMachine(syn);
    m.load(
      new Map([
        ["c", 3],
        ["r", 14],
      ]),
    );
    m.fire("e#click");
    expect([m.read("c"), m.read("r")]).toEqual([3, 1]);
    expect(() =>
      pokesFor(
        syn,
        new Map([
          ["c", 4],
          ["r", 0],
        ]),
      ),
    ).toThrow(/^c is the constant 3 in the gates; it cannot hold 4$/);
  });
});
