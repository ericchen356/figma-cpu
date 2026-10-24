// The checks test/nathan-deploy.test.ts runs on a build of CPU NATHAN (deploy/nathan.ts) made on
// silicon's fake Plugin API: the editor against uiSpec(), the gate map's lamps, the most actions a
// stored event can run, which chains write the machine's state early, and a user session through
// the stored reactions, dispatched the way Figma's viewer was measured to dispatch: a key goes to a
// layer that shows (a child's key beats the frame's), a click to a layer that shows (through a
// canvas cell to its row), and the hover column stays while the pointer stays in its cell.
import { generate, type Generated, type GenOptions } from "../deploy/nathan";
import type { FigmaValue } from "../../silicon/src/prototype/emulate";
import { FakeFigma, type FakeNode } from "../../silicon/test/fake-figma";
import { nathanLibrary, nathanNetlist } from "../../silicon/nathan/src/hw";
import { HOT, LAYERS } from "../../silicon/nathan/src/hw/layout";
import {
  applyRef,
  compare,
  prng,
  type Ev,
  type Probe,
} from "../../silicon/nathan/src/model/oracle";
import * as R from "../../silicon/nathan/src/model/reference";
import {
  compareScreen,
  expectedScreen,
  type ScreenLayer,
} from "../../silicon/nathan/src/model/screen";
import { classify, masterToQ } from "../../silicon/nathan/src/react/synth";
import {
  KEYS,
  KIND_NAMES,
  uiSpec,
  type NodeSpec,
  type ReactionRef,
} from "../../silicon/nathan/src/ui/spec";
import { runEvent } from "./figma-shape";

const net = nathanNetlist(nathanLibrary());
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export interface Built {
  gen: Generated;
  fake: FakeFigma;
  /** The most actions one event may run (the generator's default is 700). */
  part: number;
  /** The frame Present opens, and the editor in it. */
  present: FakeNode;
  editor: FakeNode;
  /** The variable of a net (by id), of a wire (by number). */
  varOfNet(id: number): string | undefined;
  varOfWire(n: number): string | undefined;
}

/** Runs every chunk the generator wrote, exactly as use_figma would, on a fake that also makes a
 * flow of each frame that gets a navigation, as Figma desktop does (autoFlows). */
export async function build(o: GenOptions = {}): Promise<Built> {
  const gen = generate(o);
  const fake = new FakeFigma(["Page 1"]);
  fake.autoFlows = true;
  (globalThis as { figma?: unknown }).figma = fake;
  for (const c of gen.chunks) await new AsyncFunction("figma", c.code)(fake);
  const present = fake.currentPage.children.find(
    (n) => n.name === gen.names.frame,
  )!;
  const wire = new Map<number, string>();
  for (const c of fake.collections)
    for (const v of c.vars) {
      const m = /\/(\d+)$/.exec(v.name);
      if (m) wire.set(Number(m[1]), v.id);
    }
  return {
    gen,
    fake,
    part: o.part ?? 700,
    present,
    editor: present.children.find((n) => n.name === gen.names.editor)!,
    varOfNet: (id) => wire.get(gen.wireOf.get(id) ?? -1),
    varOfWire: (n) => wire.get(n),
  };
}

/** Every node below `root`, depth first. */
const under = (root: FakeNode): FakeNode[] => {
  const out: FakeNode[] = [];
  root.walkRaw((n) => out.push(n));
  return out;
};
const find = (root: FakeNode | null, ...path: string[]): FakeNode | null =>
  path.reduce<FakeNode | null>(
    (n, name) => n?.children.find((c) => c.name === name) ?? null,
    root,
  );
/** A trigger as text: "ON_CLICK", "ON_KEY_DOWN [68]". */
const triggerOf = (t: Trigger | null): string => {
  const keys = (t as { keyCodes?: readonly number[] } | null)?.keyCodes;
  return keys ? `${t?.type} [${keys}]` : `${t?.type}`;
};
const ON = { click: "ON_CLICK", enter: "MOUSE_ENTER", key: "ON_KEY_DOWN" };
const specTrigger = (r: ReactionRef) =>
  r.trigger.on === "key"
    ? `ON_KEY_DOWN [${r.trigger.codes}]`
    : ON[r.trigger.on];
const TYPE = {
  frame: "FRAME",
  rect: "RECTANGLE",
  ellipse: "ELLIPSE",
  text: "TEXT",
};
/** Every action of a list, inside its CONDITIONALs too. */
function* every(acts: readonly Action[]): Generator<Action> {
  for (const a of acts) {
    yield a;
    if (a.type === "CONDITIONAL")
      for (const b of a.conditionalBlocks) yield* every(b.actions);
  }
}

/** The built editor against uiSpec(), layer by layer, as silicon/nathan's renderer (render.ts, the
 * reference) makes it: names, order and types; x/y outside auto layout; the size, where Figma keeps
 * its default 100 in a direction the spec leaves out; clipping, auto layout and sizing; the variable
 * the visibility is bound to; what the layer reacts to, a canvas cell storing its own column in the
 * hover wires. And a run stores the same actions on every layer that runs it (the frame's
 * shortcuts included), so a shortcut does what its button does. */
export function structureErrors(b: Built): string[] {
  const errors: string[] = [];
  const name = (id?: string | null) =>
    (id && b.fake.variableById.get(id)?.name) ?? "nothing";
  // the hover column: the 4 wires after the nets (deploy/nathan.ts)
  const hover = [0, 1, 2, 3].map((i) => b.varOfWire(b.gen.wireOf.size + i));
  const runs = new Map<string, Set<string>>();
  const stores = (run: string, acts?: readonly Action[]) =>
    runs.set(run, (runs.get(run) ?? new Set()).add(JSON.stringify(acts)));
  const walk = (
    s: NodeSpec,
    n: FakeNode,
    parent: NodeSpec | null,
    path: string,
  ) => {
    const at = path || "/";
    const f = n as unknown as Record<string, unknown>;
    const same = (what: string, got: unknown, want: unknown) => {
      if (got !== want) errors.push(`${at}: ${what} ${got}, spec ${want}`);
    };
    if (n.name !== s.name || n.type !== TYPE[s.type])
      return void errors.push(
        `${at}: built ${n.type} ${n.name}, spec ${s.type} ${s.name}`,
      );
    const inLayout = !!parent?.layout;
    // placed by x/y outside an auto layout (the editor itself is placed in the Present frame)
    if (parent && !inLayout) {
      same("x", n.x, s.x ?? 0);
      same("y", n.y, s.y ?? 0);
    }
    if (s.type !== "text") {
      same("width", n.width, Math.max(s.w ?? 100, 0.01));
      same("height", n.height, Math.max(s.h ?? 100, 0.01));
    }
    const L = s.layout;
    if (s.type === "frame") {
      same("clipsContent", n.clipsContent, !!s.clip);
      same(
        "layoutMode",
        f.layoutMode ?? "NONE",
        L ? (L.dir === "H" ? "HORIZONTAL" : "VERTICAL") : "NONE",
      );
    }
    if (L) {
      same("itemSpacing", f.itemSpacing, L.gap ?? 0);
      for (const side of ["Left", "Right", "Top", "Bottom"])
        same(`padding${side}`, f[`padding${side}`], L.pad ?? 0);
      same("primaryAxisAlignItems", f.primaryAxisAlignItems, L.main ?? "MIN");
      same("counterAxisAlignItems", f.counterAxisAlignItems, L.cross ?? "MIN");
    }
    // sizing: in an auto layout as the spec says (FIXED by default); an auto-layout frame outside
    // one hugs its content or keeps its size; any other layer has none
    const sizing = (v?: string) => {
      if (inLayout) return v ?? "FIXED";
      if (L) return v === "HUG" ? "HUG" : "FIXED";
    };
    same("layoutSizingHorizontal", f.layoutSizingHorizontal, sizing(s.sizeH));
    same("layoutSizingVertical", f.layoutSizingVertical, sizing(s.sizeV));
    same("visible", n.visible, !s.hidden);
    const bound = n.boundVariables.visible?.id;
    const want =
      s.visibleNet === undefined
        ? undefined
        : (b.varOfNet(net.aliases.get(s.visibleNet) ?? -1) ?? "no variable");
    if (bound !== want)
      errors.push(
        `${at}: visible bound to ${name(bound)}, spec ${s.visibleNet ?? "unbound"} (${name(want)})`,
      );
    same(
      "reacts to",
      n.reactions
        .map((r) => triggerOf(r.trigger))
        .sort()
        .join(", "),
      (s.reactions ?? []).map(specTrigger).sort().join(", "),
    );
    for (const r of s.reactions ?? []) {
      const acts = n.reactions.find(
        (x) => triggerOf(x.trigger) === specTrigger(r),
      )?.actions;
      if (!r.run.startsWith("pointer/")) {
        stores(r.run, acts);
        continue;
      }
      const c = Number(r.run.slice("pointer/".length));
      same(
        "hover stores",
        JSON.stringify(
          acts?.map((a) =>
            a.type === "SET_VARIABLE"
              ? [name(a.variableId), a.variableValue?.value]
              : a.type,
          ),
        ),
        JSON.stringify(hover.map((v, i) => [name(v), ((c >> i) & 1) === 1])),
      );
    }
    const kids = s.children ?? [];
    if (kids.length !== n.children.length)
      return void errors.push(
        `${at}: ${n.children.length} children, spec ${kids.length}`,
      );
    const seen: Record<string, number> = {};
    kids.forEach((c, i) => {
      const k = (seen[c.name] = (seen[c.name] ?? -1) + 1);
      walk(c, n.children[i], s, `${path}/${c.name}${k ? `#${k}` : ""}`);
    });
  };
  walk(uiSpec(), b.editor, null, "");
  for (const k of KEYS)
    stores(
      k.run,
      b.present.reactions.find(
        (r) => triggerOf(r.trigger) === `ON_KEY_DOWN [${k.codes}]`,
      )?.actions,
    );
  for (const [run, lists] of runs)
    if (lists.size > 1)
      errors.push(`${run}: stored as ${lists.size} different action lists`);
  return errors;
}

/** The gate map: block unit/<u> has one lamp per gate of unit u, in netlist order, bound to the
 * gate's output, or for a master latch to its Q (masterToQ): the two are equal between events, and
 * a direct commit (Q = D) never writes the master, whose own wire would leave the lamp stale. */
export function lampErrors(b: Built): string[] {
  const errors: string[] = [];
  const shadow = masterToQ(net);
  const outs = new Map<string, number[]>();
  for (const g of net.gates) {
    const top = g.path.split("/")[0];
    const unit = `unit/${/^g\d+$/.test(top) ? "glue" : top}`;
    if (!outs.has(unit)) outs.set(unit, []);
    outs.get(unit)!.push(g.out);
  }
  const chart = b.present.children.find((n) => n.name === b.gen.names.chart)!;
  const blocks = chart.children.map((c) => c.name).sort();
  if (blocks.join() !== [...outs.keys()].sort().join())
    errors.push(
      `blocks ${blocks.join(" ")}, units ${[...outs.keys()].join(" ")}`,
    );
  for (const block of chart.children) {
    const gates = outs.get(block.name) ?? [];
    const lamps = block.children.filter((c) => c.name === "lit");
    if (lamps.length !== gates.length)
      errors.push(
        `${block.name}: ${lamps.length} lamps, ${gates.length} gates`,
      );
    gates.forEach((out, i) => {
      const q = shadow.get(out) ?? out;
      const v = lamps[i]?.boundVariables.visible?.id;
      if (v !== b.varOfNet(q))
        errors.push(
          `${block.name} lamp ${i} (${net.netNames[out]}): bound to ${v ? b.fake.variableById.get(v)?.name : "nothing"}, want ${net.netNames[q]}`,
        );
    });
  }
  return errors;
}

/** Actions in a stored list with every branch taken: the most one event of it could run. */
const storedSize = (acts: readonly Action[]): number =>
  acts.reduce(
    (n, a) =>
      n +
      1 +
      (a.type === "CONDITIONAL"
        ? a.conditionalBlocks.reduce((m, x) => m + storedSize(x.actions), 0)
        : 0),
    0,
  );

/** Every stored event (the triggers in the Present frame, every overlay's timer) that could run
 * more than the build's part, whether or not a session fires it. */
export function budgetErrors(b: Built): string[] {
  const errors: string[] = [];
  for (const n of b.fake.allNodes())
    for (const r of n.reactions) {
      const size = storedSize(r.actions ?? []);
      if (size > b.part)
        errors.push(`${n.name} ${triggerOf(r.trigger)}: ${size} actions`);
    }
  return errors;
}

/** Every trigger in the Present frame, run once through the strict runner (runEvent), one after
 * another from power-on: each is a chain the viewer can follow, whether or not a session fires it. */
export function chainErrors(b: Built): string[] {
  const values = b.fake.variableValues() as Map<string, FigmaValue>;
  const errors: string[] = [];
  for (const n of [b.present, ...under(b.present)])
    for (const r of n.reactions)
      try {
        runEvent(r.actions ?? [], values, (id) => b.fake.nodeById(id));
      } catch (e) {
        errors.push(
          `${n.name} ${triggerOf(r.trigger)}: ${(e as Error).message}`,
        );
      }
  return errors;
}

/** The runs whose early events (the ones that open or swap in an overlay) set a register or a
 * screen line, the variable of an M, S or D gate (synth's classes): a chain keeps those writes for
 * its last event, so that between two events nothing is half written, unless it is torn. */
export function writesEarly(b: Built): string[] {
  const state = new Set(
    net.gates
      .filter((g) => ["M", "S", "D"].includes(classify(g).c))
      .map((g) => b.varOfNet(g.out)),
  );
  const runs = new Set<string>();
  for (const n of b.fake.allNodes())
    for (const r of n.reactions) {
      const acts = [...every(r.actions ?? [])];
      const next = acts.find(
        (a) =>
          a.type === "NODE" &&
          ["OVERLAY", "SWAP"].includes(String(a.navigation)),
      );
      if (
        next?.type === "NODE" &&
        acts.some((a) => a.type === "SET_VARIABLE" && state.has(a.variableId!))
      )
        runs.add(
          (b.fake.nodeById(next.destinationId!)?.name ?? "").replace(
            /^then (.+) \d+$/,
            "$1",
          ),
        );
    }
  return [...runs].sort();
}

const TOOL_NAMES = ["Move", "Frame", "Rectangle", "Ellipse"];
const TOOL_CODES = [86, 70, 82, 79];
const ARROW_CODES = [37, 39, 38, 40];
const ARROW_BUTTONS = ["left", "right", "up", "down"];
const CORNER = ["se", "sw", "ne", "nw"]; // by corner code: bit0 = west, bit1 = north

export interface Session {
  /** The most actions one event ran. */
  worst: number;
  /** User events that continued through overlays, and the most events one took. */
  chained: number;
  longestChain: number;
  /** Canvas clicks the pointer made without moving (no fresh MOUSE_ENTER). */
  repeats: number;
  /** The event kinds, with the way each was done ("delete 8", "dup button"). */
  used: string[];
}

/** A random user session through the stored reactions (silicon's strict emulator of the prototype
 * engine, chains through runEvent), dispatched as the viewer dispatches: a key goes to the one
 * showing layer that takes exactly that key, else to the frame; a click to a layer that shows; the
 * pointer enters a canvas cell only when it moves to another one, and the cell's row takes the
 * click. Like silicon/nathan's self-test, each event takes its shortcut or its button at random,
 * from a stream of its own, so the events are the same either way; Delete goes round 46, 8 and the
 * button. After every event the registers, the screen lines and the screen layers must match the
 * editor spec; throws at the first difference. `stay` lands that percentage of the canvas clicks
 * where the pointer already is (more clicks on a stored hover, but other events than the seed's). */
export function session(
  b: Built,
  { events = 600, seed = 7, stay = 0 } = {},
): Session {
  const { present, editor } = b;
  const values = b.fake.variableValues() as Map<string, FigmaValue>;
  const probe: Probe = {
    peek(name, width = 1) {
      let out = 0;
      for (let i = 0; i < width; i++) {
        const id = net.aliases.get(width === 1 ? name : `${name}[${i}]`);
        if (id === undefined) throw new Error(`no net ${name}`);
        const v = b.varOfNet(id);
        if (v === undefined) throw new Error(`no variable for ${name}`);
        if (values.get(v) === true) out |= 1 << i;
      }
      return out;
    },
  };
  const shown = (n: FakeNode) => {
    const id = n.boundVariables.visible?.id;
    return id !== undefined ? values.get(id) === true : n.visible;
  };
  /** The layer and every layer above it in the Present frame show. */
  const showing = (n: FakeNode) => {
    for (let p: FakeNode | null = n; p && p !== present; p = p.parent)
      if (!shown(p)) return false;
    return true;
  };
  /** The one reaction of `n` with that trigger (exactly that key list for a key). */
  const one = (n: FakeNode, trigger: string): readonly Action[] => {
    const rs = n.reactions.filter((r) => triggerOf(r.trigger) === trigger);
    if (rs.length !== 1)
      throw new Error(`${n.name} has ${rs.length} ${trigger} reactions`);
    return rs[0].actions ?? [];
  };
  let worst = 0;
  let chained = 0;
  let longestChain = 0;
  const fire = (acts: readonly Action[]) => {
    const r = runEvent(acts, values, (id) => b.fake.nodeById(id));
    worst = Math.max(worst, r.worst);
    if (r.events > 1) chained++;
    longestChain = Math.max(longestChain, r.events);
  };
  // the layers in the frame that take each key
  const takers = new Map<string, FakeNode[]>();
  for (const n of under(present))
    for (const r of n.reactions)
      if (r.trigger?.type === "ON_KEY_DOWN")
        takers.set(triggerOf(r.trigger), [
          ...(takers.get(triggerOf(r.trigger)) ?? []),
          n,
        ]);
  const press = (code: number) => {
    const key = `ON_KEY_DOWN [${code}]`;
    const on = (takers.get(key) ?? []).filter(showing);
    if (on.length > 1)
      throw new Error(`key ${code}: ${on.length} showing layers take it`);
    fire(one(on[0] ?? present, key));
  };
  let at = null as { x: number; y: number } | null; // the canvas cell the pointer is over
  /** A click on a layer that shows, away from the canvas cells. */
  const click = (n: FakeNode | null) => {
    if (!n || !showing(n))
      throw new Error(
        `${n?.name ?? "no layer"} does not show: it takes no click`,
      );
    at = null;
    fire(one(n, "ON_CLICK"));
  };

  const canvas = find(editor, "canvas")!;
  const spacers = (n: FakeNode, prefix: string) =>
    n.children.reduce(
      (v, c) =>
        c.name.startsWith(prefix) && shown(c)
          ? v + (1 << Number(c.name.slice(prefix.length)))
          : v,
      0,
    );
  const pickedLeaf = (root: FakeNode | null): FakeNode | null => {
    let n = root;
    do {
      const on = n?.children.filter(shown) ?? [];
      if (on.length !== 1) return null;
      n = on[0];
    } while (n.name.startsWith("pick/"));
    return n;
  };
  const leafIndex = (leaf: FakeNode | null) =>
    leaf ? Number(leaf.name.split("/")[1]) : -1;
  const readUi = () => {
    const selection = find(canvas, "selection")!;
    const outline = shown(selection) ? leafIndex(pickedLeaf(selection)) : -1;
    const layers: ScreenLayer[] = [];
    for (let k = 0; k < LAYERS; k++) {
      const box = find(canvas, `layer/${k}`)!;
      const col = find(box, "col")!;
      const row = find(col, "xbox", "row")!;
      const x0 = spacers(row, "x0/");
      const y0 = spacers(col, "y0/");
      const panelRow = find(editor, "layers", `row/${k}`)!;
      const name = pickedLeaf(find(panelRow, "name"));
      const kind = name
        ? KIND_NAMES.indexOf(name.name.slice("name/".length))
        : -1;
      // the colour's leaf holds the body twice, square and round: exactly one is shown
      const swatch = pickedLeaf(find(row, "body"));
      const drawn = (swatch?.children ?? []).filter(shown).map((c) => c.name);
      layers.push({
        slot: k,
        shown: shown(box) && shown(col),
        x: x0,
        y: y0,
        w: spacers(find(col, "xbox", "x1")!, "x1/") - x0,
        h: spacers(find(box, "y1")!, "y1/") - y0,
        color: leafIndex(swatch),
        kind: kind > 0 ? R.KINDS[kind - 1] : null,
        shape:
          drawn.length === 1 && (drawn[0] === "rect" || drawn[0] === "ellipse")
            ? drawn[0]
            : null,
        // the canvas outline; the panel's highlight is read on its own
        selected: outline === k,
        row: shown(panelRow),
      });
    }
    const sets = canvas.children.filter((c) => c.name.startsWith("hot/"));
    const highlight = find(editor, "layers", "highlight")!;
    return {
      layers,
      tool: spacers(find(editor, "toolbar", "highlight")!, "t/"),
      color: leafIndex(pickedLeaf(find(editor, "design", "current"))),
      hot: sets.filter(shown).length === 1 ? sets.findIndex(shown) : -1,
      // rows are listed from slot 7 down
      highlight: shown(highlight)
        ? LAYERS - 1 - spacers(highlight, "nsel/")
        : -1,
    };
  };
  const uiDiff = (spec: R.State): string | null => {
    const ui = readUi();
    const want = expectedScreen(spec);
    for (let k = 0; k < LAYERS; k++) {
      const [g, w] = [ui.layers[k], want.layers[k]];
      if (g.row !== w.row)
        return `layer row ${k} is ${g.row ? "visible" : "hidden"}, the spec says ${w.row}`;
      if (!w.row) {
        if (g.shown || g.selected) return `empty slot ${k} is drawn`;
        continue;
      }
      if (g.shown !== w.shown)
        return `layer ${k} shown=${g.shown}, spec ${w.shown}`;
      if (g.selected !== w.selected)
        return `layer ${k} outlined=${g.selected}, spec selected=${w.selected}`;
      if (g.kind !== w.kind) return `layer ${k} name ${g.kind}, spec ${w.kind}`;
      if (g.shape !== w.shape)
        return `layer ${k} drawn ${g.shape}, spec ${w.shape}`;
      if (g.color !== w.color)
        return `layer ${k} colour ${g.color}, spec ${w.color}`;
      if (g.x !== w.x || g.y !== w.y || g.w !== w.w || g.h !== w.h)
        return `layer ${k} at ${g.x},${g.y} ${g.w}×${g.h}, spec ${w.x},${w.y} ${w.w}×${w.h}`;
    }
    const sel = want.layers.findIndex((l) => l.selected);
    if (ui.highlight !== sel)
      return `the panel highlight is on row ${ui.highlight}, spec ${sel}`;
    if (ui.tool !== want.tool) return `tool ${ui.tool}, spec ${want.tool}`;
    if (ui.color !== want.color)
      return `colour ${ui.color}, spec ${want.color}`;
    if (ui.hot !== want.hot) return `click layer ${ui.hot}, spec ${want.hot}`;
    return null;
  };
  const check = (spec: R.State) =>
    compare(spec, probe) ?? compareScreen(spec, probe) ?? uiDiff(spec);

  let repeats = 0;
  let deletes = 0;
  /** Does `ev`; returns how, when there is more than one way ("key", "button", "8"). */
  const act = (ev: Ev, spec: R.State, byKey: boolean): string => {
    const keyOr = (code: number, button: () => void) => {
      if (byKey) press(code);
      else button();
      return byKey ? "key" : "button";
    };
    const design = (name: string) => find(editor, "design", `button/${name}`);
    // a per-slot button is a pick tree of them: the one showing
    const slotButton = (name: string) => () => click(pickedLeaf(design(name)));
    switch (ev.k) {
      case "tool":
        return keyOr(TOOL_CODES[ev.t], () =>
          click(find(editor, "toolbar", `tool/${TOOL_NAMES[ev.t]}`)),
        );
      case "fill":
        click(find(editor, "design", `color/${ev.c}`));
        return "";
      case "select":
        click(find(editor, "layers", `row/${ev.slot}`));
        return "";
      case "vis":
        click(find(editor, "layers", `row/${ev.slot}`, "eye-hit"));
        return "";
      case "click": {
        const sets = canvas.children.filter(
          (c) => c.name.startsWith("hot/") && shown(c),
        );
        const want = `hot/${HOT[expectedScreen(spec).hot]}`;
        if (sets.length !== 1 || sets[0].name !== want)
          throw new Error(
            `the click layers showing are ${sets.map((s) => s.name).join(", ") || "none"}, expected ${want}`,
          );
        const row = find(sets[0], `row/${ev.y}`)!;
        const cell = find(row, `cell/${ev.x}`)!;
        // a cell holds only its hover, so a click on it goes to its row
        if (
          cell.reactions.map((r) => triggerOf(r.trigger)).join() !==
          "MOUSE_ENTER"
        )
          throw new Error(`${cell.name} holds more than a MOUSE_ENTER`);
        // the pointer enters a cell only when it moves to another one: the hover column stays
        if (at?.x === ev.x && at.y === ev.y) repeats++;
        else fire(one(cell, "MOUSE_ENTER"));
        at = { x: ev.x, y: ev.y };
        fire(one(row, "ON_CLICK"));
        return "";
      }
      case "handle": {
        const k = spec.layers.findIndex((l) => l.id === spec.selected);
        const selection = find(canvas, "selection")!;
        const outline = shown(selection) ? pickedLeaf(selection) : null;
        if (outline?.name !== `overlay/${k}`)
          throw new Error(
            `selection outline ${outline?.name}, expected overlay/${k}`,
          );
        click(
          under(outline).find(
            (n) => n.name === `handle/${CORNER[ev.corner]}`,
          ) ?? null,
        );
        return "";
      }
      case "delete": {
        const way = deletes++ % 3;
        if (way < 2) press([46, 8][way]);
        else click(design("delete"));
        return ["46", "8", "button"][way];
      }
      case "dup":
        return keyOr(68, slotButton("duplicate"));
      case "fwd":
        return keyOr(221, slotButton("forward"));
      case "back":
        return keyOr(219, slotButton("backward"));
      case "nudge":
        return keyOr(ARROW_CODES[ev.dir], () =>
          click(design(ARROW_BUTTONS[ev.dir])),
        );
      case "esc":
        press(27);
        return "";
      default:
        throw new Error(`no control for ${ev.k}`);
    }
  };

  const rnd = prng(seed);
  const byKey = prng(seed + 1000);
  const stays = prng(seed + 2000);
  const used = new Set<string>();
  let spec = R.initialState();
  // Present opens: the frame's timer warms the viewer up first
  fire(one(present, "AFTER_TIMEOUT"));
  const first = check(spec);
  if (first) throw new Error(`at power-on: ${first}`);
  for (let i = 0; i < events; i++) {
    let ev = uiEvent(rnd, spec);
    if (ev.k === "click" && at && stays(100) < stay)
      ev = { k: "click", x: at.x, y: at.y };
    const next = applyRef(spec, ev);
    let way: string;
    try {
      way = act(ev, spec, byKey(2) === 1);
    } catch (e) {
      throw new Error(
        `event ${i} ${JSON.stringify(ev)}: ${(e as Error).message}`,
      );
    }
    spec = next;
    used.add(way ? `${ev.k} ${way}` : ev.k);
    const err = check(spec);
    if (err) throw new Error(`after event ${i} ${JSON.stringify(ev)}: ${err}`);
  }
  return { worst, chained, longestChain, repeats, used: [...used].sort() };
}

/** A random action a user can do with the screen (silicon/nathan's self-test mix). */
function uiEvent(rnd: (n: number) => number, s: R.State): Ev {
  const n = s.layers.length;
  const x = rnd(R.GRID_W);
  const y = rnd(R.GRID_H);
  for (;;) {
    const q = rnd(100);
    if (q < 45) return { k: "click", x, y };
    if (q < 52) return { k: "tool", t: rnd(4) };
    if (q < 58) return { k: "fill", c: rnd(R.PALETTE_SIZE) };
    if (q < 63 && n) return { k: "select", slot: rnd(n) };
    if (q < 67 && n) return { k: "vis", slot: rnd(n) };
    if (q < 71) return { k: "delete" };
    if (q < 76) return { k: "dup" };
    if (q < 80) return { k: "fwd" };
    if (q < 84) return { k: "back" };
    if (q < 90) return { k: "nudge", dir: rnd(4) };
    if (q < 92) return { k: "esc" };
    if (s.selected !== null && q < 97) return { k: "handle", corner: rnd(4) };
  }
}
