// Self-test of the live Figma OS: replays a random user session through what is stored in the
// document (the reactions on the screen's layers and overlays, the variables, the visibility
// bindings) with an emulator of Figma's prototype viewer, and after every action compares every
// variable of the chip with the chip itself run on silicon's simulator, event by event.
//
// The viewer, as measured (memory: figma-prototype-facts): a trigger runs its actions in order;
// OVERLAY opens a timed overlay whose timer runs next, on a fresh stack; SWAP replaces the open
// overlay; CLOSE closes it. A press fires MOUSE_DOWN on the layer under the pointer, a release
// MOUSE_UP on the layer under it then; a key goes to the frame. Only a layer that shows takes input.
import { compile, FastSim } from "../../../src/compile";
import { varName } from "../../../src/prototype";
import type { FigmaValue } from "../../../src/prototype/emulate";
import { evalVariableData } from "../../../src/prototype/emulate";
import { osuiChip, osuiNetlist, osuiPowerOn } from "../cpu/chip";
import type { Line } from "../cpu/disp";
import { CORNERS } from "./catalog";
import { MENU_PREFIX } from "./menus";
import { romValue, slotRom } from "./rom";
import { buildEditor } from "../../../../osflow/src/editor";
import { ACTS_KEY, ACTS_NS, COLLECTION } from "./build";
import { GRID, LIVE, type Act } from "./screen";

export interface SelfTestResult {
  ok: boolean;
  steps: number;
  /** Most actions one event ran. */
  worst: number;
  /** Most events (trigger + overlays) one action took. */
  longestChain: number;
  text: string;
}

interface UiNode {
  id: string;
  name: string;
  visible: boolean;
  parent: UiNode | null;
  type: string;
  children?: readonly UiNode[];
  boundVariables?: { visible?: { id: string } };
  reactions?: ReadonlyArray<Reaction>;
  getSharedPluginData?(ns: string, k: string): string;
}

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A variable value as the emulator keeps it: a colour as a short string, so it compares. */
function norm(v: unknown): FigmaValue {
  if (v && typeof v === "object") {
    const c = v as { r: number; g: number; b: number; a?: number };
    return `rgba(${[c.r, c.g, c.b, c.a ?? 1].map((x) => Math.round(x * 255)).join(",")})`;
  }
  if (typeof v === "number") return Math.round(v * 1e6) / 1e6;
  return v as FigmaValue;
}

export async function liveSelfTest(
  api: PluginAPI,
  page: PageNode,
  o: { events: number; seed: number; budget?: number },
): Promise<SelfTestResult> {
  const live = page.children.find((n) => n.name === LIVE) as unknown as
    UiNode | undefined;
  if (!live)
    throw new Error(`no "${LIVE}" frame on the page: build the live OS first`);
  const budget = o.budget ?? 700;

  // the chip, as built, on the simulator
  const chip = osuiChip();
  const net = osuiNetlist(chip);
  const init = osuiPowerOn(net, chip);
  const sim = new FastSim(net, compile(net), init);

  // the variables as stored
  const colls = (await api.variables.getLocalVariableCollectionsAsync()).filter(
    (c) => c.name === COLLECTION || c.name.startsWith(`${COLLECTION} · `),
  );
  if (!colls.length)
    throw new Error(`no "${COLLECTION}" variables: build the live OS first`);
  const mode = new Map(colls.map((c) => [c.id, c.defaultModeId]));
  const byName = new Map<string, Variable>();
  const values = new Map<string, FigmaValue>();
  for (const v of await api.variables.getLocalVariablesAsync())
    if (mode.has(v.variableCollectionId)) {
      byName.set(v.name, v);
      values.set(v.id, norm(v.valuesByMode[mode.get(v.variableCollectionId)!]));
    }
  // what can be seen: the registers and every screen line (a reaction specialised to its event
  // leaves the scratch logic it did not need as it was, and never reads it)
  const watched = new Set<number>();
  for (const r of chip.syn.regs.values())
    for (const n of r.nets)
      if (n !== "0" && n !== "1") watched.add(net.aliases.get(n)!);
  for (const p of Object.values(chip.picks))
    for (const n of p.nets) watched.add(net.aliases.get(n)!);
  const walkLines = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walkLines);
    else if (x && typeof x === "object") {
      if ("net" in x) watched.add(net.aliases.get((x as { net: string }).net)!);
      else Object.values(x).forEach(walkLines);
    }
  };
  walkLines(chip.display);
  const netVars: Array<[number, string]> = [];
  for (const id of watched) {
    const v = byName.get(varName(net.netNames[id]));
    if (!v) throw new Error(`no variable for ${net.netNames[id]}`);
    netVars.push([id, v.id]);
  }
  // the display's look-up tables, by slot
  const roms = chip.display.slots.map((sl, k) => slotRom(sl, k));

  // the layers that do something, and the overlays
  const acted: Array<[UiNode, Act[]]> = [];
  const walk = (n: UiNode) => {
    const raw = n.getSharedPluginData?.(ACTS_NS, ACTS_KEY);
    if (raw) acted.push([n, JSON.parse(raw) as Act[]]);
    n.children?.forEach(walk);
  };
  walk(live);
  for (const f of page.children as unknown as UiNode[])
    if (f.name.startsWith(MENU_PREFIX)) walk(f);
  const stored = new Map<string, ReadonlyArray<Reaction>>();
  const reactionsOf = (n: UiNode) => {
    let r = stored.get(n.id);
    if (!r) stored.set(n.id, (r = n.reactions ?? []));
    return r;
  };
  const overlayById = new Map(
    (page.children as unknown as UiNode[])
      .filter((n) => n.type === "FRAME")
      .map((n) => [n.id, n]),
  );
  const shows = (n: UiNode | null): boolean => {
    for (let p = n; p && p !== (live.parent as UiNode | null); p = p.parent) {
      const id = p.boundVariables?.visible?.id;
      if (id !== undefined ? values.get(id) !== true : !p.visible) return false;
    }
    return true;
  };

  // ---------- the viewer ----------
  let worst = 0;
  let longestChain = 0;
  /** One event: the actions in order. Returns the navigation it ended with, if any. */
  const run = (acts: readonly Action[]) => {
    let executed = 0;
    let nav: { to: string; how: string } | null = null;
    let closed = false;
    const go = (list: readonly Action[]) => {
      for (const a of list) {
        executed++;
        if (a.type === "SET_VARIABLE") {
          const v =
            a.variableValue!.type === ("COLOR" as VariableDataType)
              ? norm(a.variableValue!.value)
              : norm(evalVariableData(a.variableValue!, values));
          values.set(a.variableId!, v);
        } else if (a.type === "CONDITIONAL") {
          for (const b of a.conditionalBlocks) {
            if (b.condition && evalVariableData(b.condition, values) !== true)
              continue;
            go(b.actions);
            break;
          }
        } else if (a.type === "NODE")
          nav = { to: a.destinationId!, how: String(a.navigation) };
        else if (a.type === "CLOSE") closed = true;
        else throw new Error(`the viewer emulator does not run ${a.type}`);
      }
    };
    go(acts);
    worst = Math.max(worst, executed);
    if (executed > budget)
      throw new Error(
        `an event ran ${executed} actions, over the budget of ${budget}`,
      );
    return { nav: nav as { to: string; how: string } | null, closed };
  };
  /** A trigger's actions, then every overlay it opens, until the last one closes. */
  /** The menu left open (an overlay without a timer waits for input), or null. */
  let menu = null as UiNode | null;
  /** The open menu (a function: the viewer's closures change it). */
  const openMenu = (): UiNode | null => menu;
  /** A trigger's actions, then every timed overlay it opens, until one closes or a menu stays. */
  const chain = (first: readonly Action[]) => {
    let acts = first;
    let open = menu !== null;
    for (let hop = 1; hop < 4000; hop++) {
      const r = run(acts);
      longestChain = Math.max(longestChain, hop);
      if (r.nav) {
        if (r.nav.how !== (open ? "SWAP" : "OVERLAY"))
          throw new Error(
            `an event ${open ? "in an overlay" : "of a trigger"} navigates with ${r.nav.how}`,
          );
        const f = overlayById.get(r.nav.to);
        if (!f)
          throw new Error(
            `navigation to ${r.nav.to}, which is not a frame of the page`,
          );
        const timed = reactionsOf(f).find(
          (x) => x.trigger?.type === "AFTER_TIMEOUT",
        );
        if (!timed) {
          // a menu: open now, waiting for the user
          menu = f;
          return;
        }
        acts = timed.actions ?? [];
        open = true;
        continue;
      }
      if (open && !r.closed)
        throw new Error("an overlay neither swaps in another nor closes");
      menu = null;
      return;
    }
    throw new Error("a chain of overlays never closes");
  };
  const fire = (n: UiNode, type: string, codes?: number[]) => {
    const r = reactionsOf(n).find(
      (x) =>
        x.trigger?.type === type &&
        (!codes ||
          JSON.stringify((x.trigger as { keyCodes?: number[] }).keyCodes) ===
            JSON.stringify(codes)),
    );
    if (!r) throw new Error(`${n.name} has no ${type} reaction`);
    chain(r.actions ?? []);
  };
  /** A click on a button or menu opener; one over the canvas cells acts on press and release. */
  const tap = (n: UiNode, a: Act) => {
    if ("over" in a && a.over) {
      fire(n, "MOUSE_DOWN");
      fire(n, "MOUSE_UP");
    } else fire(n, "ON_CLICK");
  };

  // ---------- the chip, event by event ----------
  const codes = chip.syn.codes;
  const event = (id: string, inputs: Record<string, number> = {}) => {
    const code = codes.get(id);
    if (code === undefined) throw new Error(`the chip has no event ${id}`);
    for (const [k, v] of Object.entries(inputs))
      sim.set(chip.syn.inputs.get(k)!.port, v);
    sim.set("EVT", code);
    sim.tick();
  };
  const compare = (what: string) => {
    const bad: string[] = [];
    for (const [id, vid] of netVars)
      if ((values.get(vid) === true ? 1 : 0) !== sim.v[id])
        bad.push(net.netNames[id]);
    // the look-up tables of the slots in use (an unused slot's can keep old values: nothing shows
    // them)
    const n = chip.syn.regs
      .get("g/n")!
      .nets.reduce((v, x, b) => v + (sim.v[net.aliases.get(x)!] << b), 0);
    const line = (l: Line) =>
      "k" in l ? l.k === 1 : sim.v[net.aliases.get(l.net)!] === 1;
    for (let k = 0; k < n; k++)
      for (const t of roms[k]) {
        const want = romValue(t, line);
        const v = byName.get(t.name);
        if (want === null || !v) continue;
        if (values.get(v.id) !== norm(want))
          bad.push(
            `${t.name} = ${values.get(v.id)}, the chip says ${norm(want)}`,
          );
      }
    if (bad.length)
      throw new Error(
        `after ${what}: ${bad.length} variable(s) differ from the chip: ${bad.slice(0, 8).join(", ")}`,
      );
  };

  // ---------- the user ----------
  const rnd = prng(o.seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const showing = (f: (a: Act) => boolean) =>
    acted.filter(([n, acts]) => acts.some(f) && shows(n) && within(n));
  const keyRuns = reactionsOf(live)
    .filter((r) => r.trigger?.type === "ON_KEY_DOWN")
    .map((r) => (r.trigger as unknown as { keyCodes: number[] }).keyCodes);
  /** The chip event a run of a button or menu item fires. */
  const eventOfRun = (runName: string) =>
    runName.startsWith("key/")
      ? `${runName}#key`
      : `${runName.replace(/@.*$/, "")}#click`;
  /** Inside the open menu, or on the screen when none is open. */
  const within = (n: UiNode) => {
    let p: UiNode | null = n;
    while (p && p.parent && (p.parent as UiNode).type !== "PAGE")
      p = p.parent as UiNode;
    return menu ? p === menu : p === live;
  };
  // osflow's key events by chord
  const chordOf = new Map<string, string>();
  for (const e of buildEditor({ target: "hardware" }).events)
    if (e.trigger.type === "key" && codes.has(e.id))
      chordOf.set(
        JSON.stringify((e.trigger as { keyCodes: number[] }).keyCodes),
        e.id,
      );

  compare("power-on");
  const done: string[] = [];
  let steps = 0;
  for (; steps < o.events; steps++) {
    const roll = rnd();
    let what = "";
    const m0 = openMenu();
    if (m0) {
      // a menu is open: the user picks in it (an item, a submenu) or clicks off it
      const options = showing(
        (a) => a.on === "item" || a.on === "sub" || a.on === "dismiss",
      );
      if (!options.length)
        throw new Error(`the open menu ${m0.name} offers nothing to click`);
      const [n, acts] = pick(options);
      const a = pick(
        acts.filter(
          (x) => x.on === "item" || x.on === "sub" || x.on === "dismiss",
        ),
      );
      const was = m0.name;
      if (a.on === "sub") {
        fire(n, a.click ? "ON_CLICK" : "MOUSE_ENTER");
        what = `in ${was}: to ${a.menu}`;
      } else if (a.on === "item") {
        fire(n, "ON_CLICK");
        event(eventOfRun(a.run));
        what = `in ${was}: ${a.run}`;
      } else {
        fire(n, "ON_CLICK");
        what = `in ${was}: close`;
      }
    } else if (roll >= 0.6 && roll < 0.7) {
      // open a menu: the main menu, File, Zoom, the account, a toolbar flyout, ⌘K
      const openers = showing((a) => a.on === "open");
      if (!openers.length) throw new Error("no menu opener shows");
      const [n, acts] = pick(openers);
      const a = acts.find((x) => x.on === "open")!;
      tap(n, a);
      what = `open ${(a as { menu: string }).menu}`;
      if (!openMenu()) throw new Error(`${what} left no menu open`);
    } else if (roll < 0.35) {
      // a press on the canvas and a release, often on the same cell
      const press = [Math.floor(rnd() * GRID), Math.floor(rnd() * GRID)] as [
        number,
        number,
      ];
      const rel =
        rnd() < 0.4
          ? press
          : ([Math.floor(rnd() * GRID), Math.floor(rnd() * GRID)] as [
              number,
              number,
            ]);
      const cell = (c: [number, number], on: "press" | "release") =>
        showing(
          (a) => a.on === on && a.cell[0] === c[0] && a.cell[1] === c[1],
        )[0]?.[0];
      const p = cell(press, "press");
      const r = cell(rel, "release");
      if (!p || !r) throw new Error(`no canvas cell ${press} / ${rel} shows`);
      fire(p, "MOUSE_DOWN");
      fire(r, "MOUSE_UP");
      const xy = (c: [number, number]) => ({ "in/px": c[0], "in/py": c[1] });
      event("pointer#down", xy(press));
      if (press[0] !== rel[0] || press[1] !== rel[1])
        event("pointer#enter", xy(rel));
      event("pointer#up", xy(rel));
      what = `press ${press} release ${rel}`;
    } else if (roll < 0.45) {
      // a resize handle, when the selection shows them
      const handles = showing((a) => a.on === "handle");
      if (!handles.length) continue;
      const [h, acts] = pick(handles);
      const corner = (acts.find((a) => a.on === "handle") as { corner: number })
        .corner;
      fire(h, "MOUSE_DOWN");
      event(`handle/${CORNERS[corner]}#down`);
      if (rnd() < 0.3) {
        fire(h, "MOUSE_UP");
        what = `handle ${CORNERS[corner]} click`;
      } else {
        const rel = [Math.floor(rnd() * GRID), Math.floor(rnd() * GRID)] as [
          number,
          number,
        ];
        const r = showing(
          (a) =>
            a.on === "release" && a.cell[0] === rel[0] && a.cell[1] === rel[1],
        )[0]?.[0];
        if (!r) throw new Error(`no canvas cell ${rel} shows`);
        fire(r, "MOUSE_UP");
        event("pointer#enter", { "in/px": rel[0], "in/py": rel[1] });
        what = `handle ${CORNERS[corner]} to ${rel}`;
      }
      event("pointer#up");
    } else if (roll < 0.6) {
      // a key on the frame
      // a chip shortcut (⌘K opens the actions palette: that is a menu, below)
      const codesOf = pick(
        keyRuns.filter((c) => chordOf.has(JSON.stringify(c))),
      );
      const id = chordOf.get(JSON.stringify(codesOf));
      if (!id)
        throw new Error(
          `the frame takes keys ${codesOf}, which no editor event has`,
        );
      fire(live, "ON_KEY_DOWN", codesOf);
      event(id);
      what = `key ${id}`;
    } else {
      // any button that shows: toolbar, layer rows, Styles, the Design panel
      const buttons = showing((a) => a.on === "click");
      if (!buttons.length) throw new Error("no button shows");
      const [b, acts] = pick(buttons);
      const a = acts.find((x) => x.on === "click")!;
      const runName = (a as { run: string }).run;
      tap(b, a);
      // the run's event: "tool/rect", "swatch/3@none", "prop/x/inc@2", "align/left", "layer/1"
      event(`${runName.replace(/@.*$/, "")}#click`);
      what = `click ${runName}`;
    }
    done.push(what);
    compare(
      `step ${steps} (${what}); before: ${done.slice(-4, -1).join(" · ")}`,
    );
  }
  return {
    ok: true,
    steps,
    worst,
    longestChain,
    text: `self-test passed: ${steps} actions, every chip variable matched the chip after each; the longest event ran ${worst} actions, the longest action took ${longestChain} events`,
  };
}
