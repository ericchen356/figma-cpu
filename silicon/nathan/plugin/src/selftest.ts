// Self-test: runs the editor in the DOCUMENT, without Present mode. It reads what is really stored
// in the file (the reactions on the UI layers, the variables' values, the visibility bindings),
// replays a random user session through the exact reaction JSON with the prototype emulator, and
// after every action compares
//   · the machine's registers with the editor spec,
//   · the screen lines with the spec's picture,
//   · the UI layers themselves (which spacers / swatches / outlines are visible through their
//     bindings) with the spec's picture, and which click layer is on top,
// so it proves the build is wired right: reactions on the right layers, bindings on the right
// nets, the dispatch sets matching the machine's state. What it cannot prove is how Figma's own
// viewer behaves (that is what the platform tests are for).
import { varName } from "../../../src/prototype";
import {
  type FigmaValue,
  runFigmaActions,
} from "../../../src/prototype/emulate";
import type { FlatNetlist } from "../../../src/netlist/types";
import { nathanNetlist } from "../../src/hw";
import { LAYERS } from "../../src/hw/layout";
import {
  type Ev,
  type Probe,
  applyRef,
  compare,
  prng,
} from "../../src/model/oracle";
import * as R from "../../src/model/reference";
import {
  compareScreen,
  expectedScreen,
  type Screen,
  type ScreenLayer,
} from "../../src/model/screen";
import { HOTSPOT_REACTIONS } from "../../src/react/catalog";
import { KEYS, KIND_NAMES } from "../../src/ui/spec";
import { COLLECTION, PRESENT } from "./names";
import { findPage } from "./where";
import type { SelfTestResult } from "./messages";

/** The slice of a layer the self-test needs (a SceneNode satisfies it). */
interface UiNode {
  id: string;
  name: string;
  visible: boolean;
  children?: readonly UiNode[];
  boundVariables?: { visible?: { id: string } };
  reactions?: ReadonlyArray<Reaction>;
}

const TOOL_NAMES = ["Move", "Frame", "Rectangle", "Ellipse"];
const TOOL_CODES = [86, 70, 82, 79];
const ARROW_CODES = [37, 39, 38, 40];
const ARROW_BUTTONS = ["left", "right", "up", "down"];
const CORNER = ["se", "sw", "ne", "nw"]; // by code: bit0 = west, bit1 = north

export async function selfTest(
  api: PluginAPI,
  o: { events: number; seed: number },
): Promise<SelfTestResult> {
  const page = await findPage(api);
  if (!page)
    throw new Error(
      "no CPU NATHAN page: Build hardware and Build the OS first",
    );
  await page.loadAsync();
  const present = page.children.find((n) => n.name === PRESENT) as
    (FrameNode & UiNode) | undefined;
  if (!present) throw new Error(`no "${PRESENT}" frame: Build the OS first`);
  const editor = present.children.find((n) => n.name === "editor") as
    UiNode | undefined;
  if (!editor) throw new Error("the editor frame is missing");

  // the circuit (the netlist Build the OS read off the canvas: same gates, same net names; not read
  // again here, the drawing is large), and the variables as stored
  const net: FlatNetlist = nathanNetlist();
  const colls = (await api.variables.getLocalVariableCollectionsAsync()).filter(
    (c) => c.name === COLLECTION || c.name.startsWith(`${COLLECTION} · `),
  );
  if (!colls.length)
    throw new Error(`no "${COLLECTION}" variables: Build the OS first`);
  const mode = new Map(colls.map((c) => [c.id, c.defaultModeId]));
  const byName = new Map<string, Variable>();
  for (const v of await api.variables.getLocalVariablesAsync())
    if (mode.has(v.variableCollectionId)) byName.set(v.name, v);
  const values = new Map<string, FigmaValue>();
  for (const v of byName.values())
    values.set(
      v.id,
      v.valuesByMode[mode.get(v.variableCollectionId)!] as FigmaValue,
    );
  const varOfNet = (id: number): string => {
    const v = byName.get(varName(net.netNames[id]));
    if (!v)
      throw new Error(
        `no variable for net ${net.netNames[id]}: Build the OS again`,
      );
    return v.id;
  };

  const probe: Probe = {
    peek(name, width = 1) {
      let out = 0;
      for (let i = 0; i < width; i++) {
        const id = net.aliases.get(width === 1 ? name : `${name}[${i}]`);
        if (id === undefined) throw new Error(`no net ${name}`);
        if (values.get(varOfNet(id)) === true) out |= 1 << i;
      }
      return out;
    },
  };

  // the UI as stored
  const find = (root: UiNode, ...path: string[]): UiNode | null =>
    path.reduce<UiNode | null>(
      (n, name) => n?.children?.find((c) => c.name === name) ?? null,
      root,
    );
  const canvas = find(editor, "canvas")!;
  const shown = (n: UiNode): boolean => {
    const id = n.boundVariables?.visible?.id;
    return id !== undefined ? values.get(id) === true : n.visible;
  };
  // a layer's stored reactions, read once: every read of `reactions` is a fresh deep copy, and the
  // long ones (a thousand actions or more) would fill the plugin's memory over a session
  const stored = new Map<string, ReadonlyArray<Reaction>>();
  const reactionsOf = (n: UiNode): ReadonlyArray<Reaction> => {
    let r = stored.get(n.id);
    if (!r) {
      r = n.reactions ?? [];
      stored.set(n.id, r);
    }
    return r;
  };
  const fire = (n: UiNode, type: string, key?: number): number => {
    const r = reactionsOf(n).find(
      (x) =>
        x.trigger?.type === type &&
        (key === undefined ||
          (x.trigger as { keyCodes?: number[] }).keyCodes?.includes(key)),
    );
    if (!r?.actions)
      throw new Error(
        `${n.name} has no ${type} reaction${key !== undefined ? ` for key ${key}` : ""}`,
      );
    return runChain(r.actions);
  };
  /** Runs an action list as the viewer does: when it ends by opening (or swapping in) a timed
   * overlay, that overlay's timer runs the next part on a fresh stack, until one closes. Returns the
   * most actions any one of those events ran. */
  const runChain = (first: readonly Action[]): number => {
    let acts = first;
    let worst = 0;
    for (let hop = 0; hop < 64; hop++) {
      const last = acts[acts.length - 1];
      const control =
        last?.type === "NODE" || last?.type === "CLOSE" ? last : undefined;
      const body = control ? acts.slice(0, -1) : acts;
      worst = Math.max(worst, runFigmaActions(body, values) + (control ? 1 : 0));
      // a trigger may open the first overlay; an overlay's timer must swap in the next or close
      if (hop > 0 && !control)
        throw new Error("an overlay's timer neither swaps in the next overlay nor closes");
      if (!control || control.type !== "NODE") return worst;
      const nav = String(control.navigation);
      if (nav !== (hop === 0 ? "OVERLAY" : "SWAP"))
        throw new Error(`a reaction ${hop === 0 ? "opens" : "continues with"} ${nav}`);
      const overlay = page.children.find(
        (n) => n.id === control.destinationId,
      ) as UiNode | undefined;
      const timed = overlay
        ? reactionsOf(overlay).find((x) => x.trigger?.type === "AFTER_TIMEOUT")
        : undefined;
      if (!timed?.actions)
        throw new Error(
          `a reaction continues to ${overlay?.name ?? control.destinationId}, which has no timer`,
        );
      acts = timed.actions;
    }
    throw new Error("a reaction's chain of overlays never closes");
  };
  // a click: its click reaction, or mouse down then mouse up when a long one was split across them
  const press = (n: UiNode): number => {
    const stages = ["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"].filter((type) =>
      reactionsOf(n).some((x) => x.trigger?.type === type),
    );
    if (!stages.length) throw new Error(`${n.name} has no click reaction`);
    return Math.max(...stages.map((type) => fire(n, type)));
  };

  /** The value a row of binary-weighted spacer frames adds up to (frame `<prefix>i` counts 2^i). */
  const spacers = (n: UiNode, prefix: string): number =>
    (n.children ?? []).reduce(
      (v, c) =>
        c.name.startsWith(prefix) && shown(c)
          ? v + (1 << Number(c.name.slice(prefix.length)))
          : v,
      0,
    );
  /** The leaf a pick tree shows (null when a level shows both children or none). */
  const pickedLeaf = (root: UiNode): UiNode | null => {
    let n = root;
    do {
      const on = (n.children ?? []).filter(shown);
      if (on.length !== 1) return null;
      n = on[0];
    } while (n.name.startsWith("pick/"));
    return n;
  };
  const leafIndex = (leaf: UiNode | null) =>
    leaf ? Number(leaf.name.split("/")[1]) : -1;

  const readUi = (): Screen => {
    const selection = find(canvas, "selection")!;
    const outlined = shown(selection) ? pickedLeaf(selection) : null;
    const highlight = find(editor, "layers", "highlight")!;
    const lit = shown(highlight)
      ? LAYERS - 1 - spacers(highlight, "nsel/")
      : -1;
    const layers: ScreenLayer[] = [];
    for (let k = 0; k < LAYERS; k++) {
      const box = find(canvas, `layer/${k}`)!;
      const col = find(box, "col")!;
      const row = find(col, "xbox", "row")!;
      const x0 = spacers(row, "x0/");
      const y0 = spacers(col, "y0/");
      const panelRow = find(editor, "layers", `row/${k}`)!;
      const name = pickedLeaf(find(panelRow, "name")!);
      const swatch = pickedLeaf(find(row, "body")!);
      const [square, round] = ["rect", "ellipse"].map((s) =>
        swatch ? shown(find(swatch, s)!) : false,
      );
      const kind = name
        ? KIND_NAMES.indexOf(name.name.slice("name/".length))
        : -1;
      layers.push({
        slot: k,
        shown: shown(box) && shown(col),
        x: x0,
        y: y0,
        w: spacers(find(col, "xbox", "x1")!, "x1/") - x0,
        h: spacers(find(box, "y1")!, "y1/") - y0,
        color: leafIndex(swatch),
        kind: kind > 0 ? R.KINDS[kind - 1] : null,
        shape: square === round ? null : round ? "ellipse" : "rect",
        selected: outlined?.name === `overlay/${k}` && lit === k,
        row: shown(panelRow),
      });
    }
    const sets = canvas.children!.filter((c) => c.name.startsWith("hot/"));
    return {
      layers,
      tool: spacers(find(editor, "toolbar", "highlight")!, "t/"),
      color: leafIndex(pickedLeaf(find(editor, "design", "current")!)),
      hot:
        sets.filter((s) => shown(s)).length === 1
          ? sets.findIndex((s) => shown(s))
          : -1,
    };
  };

  // the user: every action goes through a layer's stored reaction, by its shortcut or its button.
  // A shortcut is on the frame, or on the one showing layer of the stack of key layers that the
  // selection picks (Figma gives a key to a layer that shows, never to a hidden one).
  const keyed = (n: UiNode, code: number) =>
    reactionsOf(n).some(
      (x) =>
        x.trigger?.type === "ON_KEY_DOWN" && x.trigger.keyCodes.includes(code),
    );
  const shortcuts = find(editor, "shortcuts");
  const holderOf = (code: number): UiNode | null => {
    if (keyed(present, code)) return present;
    const leaf = shortcuts ? pickedLeaf(shortcuts) : null;
    return leaf && keyed(leaf, code) ? leaf : null;
  };
  let viaKeys = 0;
  const act = (ev: Ev, spec: R.State, preferKey: boolean): number => {
    const keyOr = (code: number, button: () => number) => {
      if (!preferKey) return button();
      const holder = holderOf(code);
      if (!holder) throw new Error(`no layer that shows takes key ${code}`);
      viaKeys++;
      return fire(holder, "ON_KEY_DOWN", code);
    };
    // a per-slot button is a pick tree of them: the one showing
    const button = (name: string) => () => {
      const b = find(present, "editor", "design", `button/${name}`)!;
      const leaf = b.children?.some((c) => c.name.startsWith("pick/"))
        ? pickedLeaf(b)
        : b;
      if (!leaf) throw new Error(`button/${name}: no single slot button shows`);
      return press(leaf);
    };
    switch (ev.k) {
      case "tool":
        return keyOr(TOOL_CODES[ev.t], () =>
          press(
            find(present, "editor", "toolbar", `tool/${TOOL_NAMES[ev.t]}`)!,
          ),
        );
      case "fill":
        return press(find(present, "editor", "design", `color/${ev.c}`)!);
      case "select":
        return press(find(present, "editor", "layers", `row/${ev.slot}`)!);
      case "vis":
        return press(
          find(present, "editor", "layers", `row/${ev.slot}`, "eye-hit")!,
        );
      case "click": {
        const sets = canvas.children!.filter(
          (c) => c.name.startsWith("hot/") && shown(c),
        );
        if (sets.length !== 1)
          throw new Error(
            `${sets.length} click layers are visible, expected exactly 1`,
          );
        const want = spec.drag
          ? spec.drag.mode === "move"
            ? 2
            : 3
          : spec.tool === "move"
            ? 0
            : 1;
        const name = `hot/${["idle-move", "idle-create", "drag-move", "drag-span"][want]}`;
        if (sets[0].name !== name)
          throw new Error(
            `the visible click layer is ${sets[0].name}, expected ${name}`,
          );
        const row = find(sets[0], `row/${ev.y}`)!;
        const cell = find(row, `cell/${ev.x}`)!;
        return Math.max(fire(cell, "MOUSE_ENTER"), press(row));
      }
      case "handle": {
        const k = spec.layers.findIndex((l) => l.id === spec.selected);
        const selection = find(canvas, "selection")!;
        const overlay = shown(selection) ? pickedLeaf(selection) : null;
        if (overlay?.name !== `overlay/${k}`)
          throw new Error(
            `the visible selection outline is ${overlay?.name ?? "none"}, expected overlay/${k}`,
          );
        const walk = (n: UiNode): UiNode | null =>
          n.name === `handle/${CORNER[ev.corner]}`
            ? n
            : ((n.children ?? []).map(walk).find(Boolean) ?? null);
        return press(walk(overlay)!);
      }
      case "delete":
        return keyOr(46, button("delete"));
      case "dup":
        return keyOr(68, button("duplicate"));
      case "fwd":
        return keyOr(221, button("forward"));
      case "back":
        return keyOr(219, button("backward"));
      case "nudge":
        return keyOr(ARROW_CODES[ev.dir], button(ARROW_BUTTONS[ev.dir]));
      case "esc":
        viaKeys++;
        return fire(present, "ON_KEY_DOWN", 27);
      default:
        throw new Error(`the editor has no control for ${ev.k}`);
    }
  };

  const rnd = prng(o.seed);
  let spec = R.initialState();
  let worst = 0;
  const cov = new Set<string>();
  for (let i = 0; i < o.events; i++) {
    const ev = uiEvent(rnd, spec);
    const next = applyRef(spec, ev);
    try {
      worst = Math.max(worst, act(ev, spec, rnd(2) === 1));
    } catch (e) {
      return {
        ok: false,
        events: i,
        text: `event ${i} ${JSON.stringify(ev)}: ${e instanceof Error ? e.message : e}`,
      };
    }
    spec = next;
    cov.add(ev.k);
    const err =
      compare(spec, probe) ??
      compareScreen(spec, probe) ??
      uiDiff(spec, readUi());
    if (err)
      return {
        ok: false,
        events: i + 1,
        text: `after event ${i} ${JSON.stringify(ev)}: ${err}`,
      };
  }
  return {
    ok: true,
    events: o.events,
    text: `✓ ${o.events} random user actions through the stored reactions: registers, screen lines and UI layers all match the editor spec (heaviest single event: ${worst} actions executed; used: ${[...cov].sort().join(", ")}; ${viaKeys} by shortcut key)`,
  };
}

/** What the UI layers show vs the spec's picture. */
function uiDiff(spec: R.State, ui: Screen): string | null {
  const want = expectedScreen(spec);
  for (let k = 0; k < LAYERS; k++) {
    const [g, w] = [ui.layers[k], want.layers[k]];
    if (g.row !== w.row)
      return `UI: layer row ${k} is ${g.row ? "visible" : "hidden"}, the spec says ${w.row}`;
    if (!w.row) {
      if (g.shown || g.selected) return `UI: empty slot ${k} is drawn`;
      continue;
    }
    if (g.shown !== w.shown)
      return `UI: layer ${k} shown=${g.shown}, spec ${w.shown}`;
    if (g.selected !== w.selected)
      return `UI: layer ${k} selected=${g.selected}, spec ${w.selected}`;
    if (g.kind !== w.kind)
      return `UI: layer ${k} name ${g.kind}, spec ${w.kind}`;
    if (g.shape !== w.shape)
      return `UI: layer ${k} drawn ${g.shape}, spec ${w.shape}`;
    if (g.color !== w.color)
      return `UI: layer ${k} colour ${g.color}, spec ${w.color}`;
    if (g.x !== w.x || g.y !== w.y || g.w !== w.w || g.h !== w.h)
      return `UI: layer ${k} drawn at ${g.x},${g.y} ${g.w}×${g.h}, spec ${w.x},${w.y} ${w.w}×${w.h}`;
  }
  if (ui.tool !== want.tool) return `UI: tool ${ui.tool}, spec ${want.tool}`;
  if (ui.color !== want.color)
    return `UI: current colour ${ui.color}, spec ${want.color}`;
  if (ui.hot !== want.hot) return `UI: click layer ${ui.hot}, spec ${want.hot}`;
  return null;
}

/** A random action a user can do with the screen (no raw DOWN / MOVE / UP: the canvas has CLICK). */
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

export { HOTSPOT_REACTIONS, KEYS };
