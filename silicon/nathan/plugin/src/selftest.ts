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
import { flatten } from "../../../src/netlist/flatten";
import type { FlatNetlist } from "../../../src/netlist/types";
import { extract } from "../../../src/figma";
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
  BOX_CELLS,
  compareScreen,
  expectedScreen,
  type Screen,
  type ScreenLayer,
} from "../../src/model/screen";
import { HOTSPOT_REACTIONS } from "../../src/react/catalog";
import { KEYS } from "../../src/ui/spec";
import { COLLECTION, PRESENT, TOP } from "./names";
import { findPage } from "./where";
import type { SelfTestResult } from "./messages";

/** The slice of a layer the self-test needs (a SceneNode satisfies it). */
interface UiNode {
  name: string;
  visible: boolean;
  children?: readonly UiNode[];
  boundVariables?: { visible?: { id: string } };
  reactions?: ReadonlyArray<Reaction>;
}

const TOOL_NAMES = ["Move", "Frame", "Rectangle", "Ellipse"];
const ARROW_CODES = [37, 39, 38, 40];
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

  // the circuit as drawn, and the variables as stored
  const net: FlatNetlist = flatten(await extract([page]), TOP);
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
  const fire = (n: UiNode, type: string, key?: number): number => {
    const r = n.reactions?.find(
      (x) =>
        x.trigger?.type === type &&
        (key === undefined ||
          (x.trigger as { keyCodes?: number[] }).keyCodes?.includes(key)),
    );
    if (!r?.actions)
      throw new Error(
        `${n.name} has no ${type} reaction${key !== undefined ? ` for key ${key}` : ""}`,
      );
    return runFigmaActions(r.actions, values);
  };
  // a click is three events in Figma: mouse down, mouse up, click (a long reaction is split across them)
  const press = (n: UiNode): number => {
    const stages = ["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"].filter((type) =>
      n.reactions?.some((x) => x.trigger?.type === type),
    );
    if (!stages.length) throw new Error(`${n.name} has no click reaction`);
    return Math.max(...stages.map((type) => fire(n, type)));
  };

  const readUi = (): Screen => {
    const sum = (box: UiNode, prefix: string) =>
      [0, 1, 2, 3].reduce(
        (s, i) =>
          s +
          (shown(find(box, prefix + i) ?? find(box, "row", prefix + i)!)
            ? 1 << i
            : 0),
        0,
      );
    const layers: ScreenLayer[] = [];
    for (let k = 0; k < LAYERS; k++) {
      const box = find(canvas, `layer/${k}`)!;
      const row = find(box, "row")!;
      const body = find(row, "body")!;
      const swatches = body
        .children!.filter((c) => shown(c))
        .map((c) => Number(c.name.split("/")[1]));
      const x = sum(row, "left");
      const y = sum(box, "top");
      const panelRow = find(present, "editor", "layers", `row/${k}`)!;
      const kinds = ["Frame", "Rectangle", "Ellipse"].filter((nm) =>
        shown(find(panelRow, `name/${nm}`)!),
      );
      layers.push({
        slot: k,
        shown: shown(box),
        x,
        y,
        w: BOX_CELLS - x - sum(row, "right"),
        h: BOX_CELLS - y - sum(box, "bottom"),
        color: swatches.length === 1 ? swatches[0] : -1,
        kind:
          kinds.length === 1
            ? (
                {
                  Frame: "frame",
                  Rectangle: "rect",
                  Ellipse: "ellipse",
                } as const
              )[kinds[0] as "Frame"]
            : null,
        selected: shown(find(canvas, `overlay/${k}`)!),
        row: shown(panelRow),
      });
    }
    const tools = TOOL_NAMES.map((n) =>
      shown(find(present, "editor", "toolbar", `tool/${n}`, "active")!),
    );
    const cur = Array.from({ length: 16 }, (_, c) =>
      shown(find(present, "editor", "design", "current", `current/${c}`)!),
    );
    const sets = canvas.children!.filter((c) => c.name.startsWith("hot/"));
    return {
      layers,
      tool: tools.filter(Boolean).length === 1 ? tools.indexOf(true) : -1,
      color: cur.filter(Boolean).length === 1 ? cur.indexOf(true) : -1,
      hot:
        sets.filter((s) => shown(s)).length === 1
          ? sets.findIndex((s) => shown(s))
          : -1,
    };
  };

  // the user: every action goes through a layer's stored reaction
  const act = (ev: Ev, spec: R.State): number => {
    const key = (code: number) => fire(present, "ON_KEY_DOWN", code);
    switch (ev.k) {
      case "tool":
        return press(
          find(present, "editor", "toolbar", `tool/${TOOL_NAMES[ev.t]}`)!,
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
        const cell = find(sets[0], `cell/${ev.x},${ev.y}`)!;
        return Math.max(fire(cell, "MOUSE_ENTER"), press(sets[0]));
      }
      case "handle": {
        const k = spec.layers.findIndex((l) => l.id === spec.selected);
        const overlay = find(canvas, `overlay/${k}`)!;
        if (!shown(overlay))
          throw new Error(`the selection overlay of slot ${k} is not visible`);
        const walk = (n: UiNode): UiNode | null =>
          n.name === `handle/${CORNER[ev.corner]}`
            ? n
            : ((n.children ?? []).map(walk).find(Boolean) ?? null);
        return press(walk(overlay)!);
      }
      case "delete":
        return key(46);
      case "dup":
        return key(68);
      case "fwd":
        return key(221);
      case "back":
        return key(219);
      case "nudge":
        return key(ARROW_CODES[ev.dir]);
      case "esc":
        return key(27);
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
      worst = Math.max(worst, act(ev, spec));
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
    text: `✓ ${o.events} random user actions through the stored reactions: registers, screen lines and UI layers all match the editor spec (heaviest single event: ${worst} actions executed; used: ${[...cov].sort().join(", ")})`,
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
