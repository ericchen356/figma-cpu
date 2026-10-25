// The CPU NATHAN plugin, minus the window: every button of the panel is a method here. It takes the
// Plugin API object and a `post` callback so the whole flow runs against a fake Figma in Node
// (test/plugin.test.ts). The silicon drawing code uses the `figma` global, so the `api` passed
// here must be that same object (it is, in the plugin and in the tests).
//
//   Build hardware   gates + every cell + cell/ENGINE as components, on the page "CPU NATHAN"
//   Build the OS     canvas → extract → flatten → synthesise one reaction per control → variables →
//                    lamps on the gates → the editor frame (layers bound to nets, reactions on
//                    the controls) with the machine below it → a flow to ▶ Present
//   Self-test        replays a random user session through the stored reactions and checks it
//   Platform tests   small prototypes that check what Figma's viewer actually does
//   Clean            removes the frame, the variables and the tests (the drawn hardware stays)
//
// Nothing here runs at prototype time: in Present mode Figma's engine does all the computing.
import {
  collectBindings,
  dependencyOrder,
  drawGates,
  drawLibrary,
  extract,
} from "../../../src/figma";
import { CELL_PREFIX } from "../../../src/figma/names";
import { flatten } from "../../../src/netlist/flatten";
import {
  type FlatNetlist,
  GATE_PREFIX,
  NET0,
  NET1,
} from "../../../src/netlist/types";
import { varName } from "../../../src/prototype";
import type { PlanAction } from "../../../src/prototype/types";
import {
  COLORS,
  box,
  bindVisible,
  button,
  createVariables,
  loadFonts,
  put,
  removeCollections,
  setFlows,
  text,
  type VariableSpec,
} from "../../../src/prototype/draw";
import {
  aliasData,
  boolData,
  exprData,
  figmaActions,
  afterTimeout,
  conditional,
  keyDown,
  mouseDown,
  mouseEnter,
  mouseUp,
  navigate,
  navigateWith,
  onClick,
  setVariable,
} from "../../../src/prototype/figma-actions";
import { nathanLibrary, nathanPowerOn } from "../../src/hw";
import { buildCatalogGently, reactionSpecs } from "../../src/react/catalog";
import {
  type Commit,
  masterToQ,
  type Reaction as Synthesized,
  staticSize,
  synthesize,
} from "../../src/react/synth";
import {
  buildPlatformTests,
  TEST_COLLECTION,
  TEST_PREFIX,
} from "../../src/platform/tests";
import { gateMap } from "../../src/ui/gatemap";
import { render } from "../../src/ui/render";
import {
  KEYS,
  slotKeys,
  UI_H,
  UI_W,
  uiSpec,
  type ReactionRef,
} from "../../src/ui/spec";
import type {
  DocStatus,
  HardwareStats,
  LogLevel,
  OsStats,
  ToMain,
  ToUi,
} from "./messages";
import {
  CIRCUIT,
  COLLECTION,
  FLOW,
  MACHINE,
  PRESENT,
  TOP,
  UI_COLLECTION,
} from "./names";
import { selfTest } from "./selftest";
import {
  cellsBottom,
  CELLS_DY,
  ensurePage,
  findPage,
  MACHINE_GAP,
  onePage,
  origin,
  placeGates,
  remember,
  Shelf,
} from "./where";

const PAD = 48;
const HEADER = 132;
const GAP = 160;

export interface AppOptions {
  /** Lets Figma breathe between modules / phases (default: setTimeout 0). */
  yield?: () => Promise<void>;
  now?: () => number;
}

export interface OsOptions {
  /** "auto": every latch gate is evaluated unless a reaction would exceed `gatesUpTo`, then Q = D. */
  latch: "auto" | Commit;
  /** Most actions ONE event may run. The viewer runs a reaction's actions recursively: on a cold
   * page 1,200 overflowed its stack (and left the prototype dead to clicks), so a longer reaction
   * continues through timed overlays, a part per event. */
  budget: number;
  /** Largest reaction (actions) whose latches "auto" evaluates gate by gate. Default: the budget,
   * so a reaction that fits one event shows every latch gate, and a longer one commits Q = D
   * (fewer events). */
  gatesUpTo?: number;
  /** Turn identity gates into wires (fewer actions; those gates' lamps keep their last colour). */
  alias: boolean;
}

/** Prefix of the 1×1 overlay frames that continue a long reaction ("<prefix><run> <part>"). */
export const CHAIN_PREFIX = "NATHAN · then ";
/** The empty overlay the editor opens and closes once when ▶ Present starts (a warm-up). */
export const WARMUP = "NATHAN · warm-up";

export interface HardwareOptions {
  gateLabels?: boolean;
  redraw?: boolean;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class NathanApp {
  private busy: string | null = null;
  private readonly now: () => number;
  private readonly breathe: () => Promise<void>;

  constructor(
    private readonly api: PluginAPI,
    private readonly post: (m: ToUi) => void,
    opts: AppOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.breathe = opts.yield ?? (() => new Promise((r) => setTimeout(r, 0)));
  }

  // ---------- messages ----------

  /** Handles one panel message. Never throws: errors go to the panel log. */
  async handle(msg: ToMain): Promise<void> {
    try {
      switch (msg.type) {
        case "init":
          this.post({ type: "hello", status: await this.status() });
          return;
        case "hardware":
          await this.task("Build hardware", () =>
            this.hardware({ gateLabels: msg.gateLabels, redraw: msg.redraw }),
          );
          return;
        case "os":
          await this.task("Build the OS", () =>
            this.os({
              latch: msg.latch,
              budget: msg.budget,
              alias: msg.alias,
            }),
          );
          return;
        case "selftest":
          await this.task("Self-test", () =>
            this.selftest(msg.events, msg.seed),
          );
          return;
        case "platform":
          await this.task("Platform tests", () => this.platform());
          return;
        case "clean":
          await this.task("Clean", () => this.clean());
          return;
      }
    } catch (e) {
      this.log("error", errText(e));
    }
  }

  private async task<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    if (this.busy) {
      this.log("error", `busy: ${this.busy} is still running`);
      return undefined;
    }
    this.busy = name;
    this.post({ type: "busy", task: name });
    try {
      return await fn();
    } catch (e) {
      this.log("error", `${name} failed: ${errText(e)}`);
      return undefined;
    } finally {
      this.busy = null;
      this.post({ type: "busy", task: null });
      try {
        this.post({ type: "status", status: await this.status() });
      } catch {
        /* status is best effort */
      }
    }
  }

  private log(level: LogLevel, text: string) {
    this.post({ type: "log", level, text });
  }
  private progress(task: string, done: number, total: number, label: string) {
    this.post({ type: "progress", task, done, total, label });
  }
  private async phase<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw new Error(`${name}: ${errText(e)}`);
    }
  }

  /** What the document holds (cheap checks only). */
  async status(): Promise<DocStatus> {
    const page = await findPage(this.api);
    if (!page) return { page: null, hardware: false, built: false };
    await page.loadAsync();
    const colls = await this.api.variables.getLocalVariableCollectionsAsync();
    return {
      page: page.name,
      hardware: !!findCell(page, TOP),
      built:
        !!page.children.find((n) => n.name === PRESENT) &&
        colls.some((c) => c.name === COLLECTION),
    };
  }

  // ---------- 1. hardware ----------

  async hardware(o: HardwareOptions = {}): Promise<HardwareStats> {
    const t0 = this.now();
    const gateLabels = o.gateLabels !== false;
    const lib = nathanLibrary();
    const { page, how } = await ensurePage(this.api, (m) =>
      this.log("info", m),
    );
    if (how === "created") this.log("info", `created the page "${page.name}"`);
    remember(this.api, page);
    await page.loadAsync();
    await this.api.setCurrentPageAsync(page);
    const pages = onePage(page);

    // a previous Build the OS moved the machine into the editor frame: take it out first
    await this.releaseMachine(page, !!o.redraw);
    if (o.redraw) {
      let removed = 0;
      for (const n of [...page.children])
        if (
          n.type === "COMPONENT" &&
          n.name.startsWith(CELL_PREFIX) &&
          lib.has(n.name.slice(CELL_PREFIX.length))
        ) {
          n.remove();
          removed++;
        }
      if (removed)
        this.log("info", `redraw: removed ${removed} old cell components`);
    }

    const at = origin(page);
    const order = dependencyOrder(lib);
    this.progress("hardware", 0, order.length, "gates");
    const before = new Set(
      page.children
        .filter((n) => n.type === "COMPONENT" && n.name.startsWith(GATE_PREFIX))
        .map((n) => n.name),
    );
    const gates = await this.phase("drawing gates", () =>
      drawGates(page, { labels: gateLabels, redraw: o.redraw }),
    );
    if ([...gates.values()].some((g) => !before.has(g.name)))
      placeGates([...gates.values()], at);
    await this.breathe();

    const existing = new Set<string>();
    for (const n of page.children)
      if (n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX))
        existing.add(n.name.slice(CELL_PREFIX.length));
    let shelf: Shelf | null = null;
    let drawn = 0;
    let reused = 0;
    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      this.progress("hardware", i, order.length, name);
      if (existing.has(name)) {
        reused++;
        continue;
      }
      const r = await this.phase(`drawing ${name}`, () =>
        drawLibrary(lib, pages, { only: [name], gateLabels }),
      );
      const comp = r.cells.get(name);
      if (!comp || r.reused.includes(name)) {
        reused++;
        continue;
      }
      drawn++;
      if (name === TOP) {
        const below =
          Math.max(cellsBottom(page, comp.name), at.y + CELLS_DY) + MACHINE_GAP;
        comp.x = at.x;
        comp.y = Math.round(below);
      } else {
        if (!shelf)
          shelf = new Shelf(
            at.x,
            Math.max(
              at.y + CELLS_DY,
              cellsBottom(page, `${CELL_PREFIX}${TOP}`) + 192,
            ),
          );
        shelf.place(comp);
      }
      await this.breathe();
    }

    const engine = findCell(page, TOP);
    const stats: HardwareStats = {
      modules: order.length,
      drawn,
      reused,
      gates: flatten(lib, TOP).gates.length,
      ms: this.now() - t0,
      engineSize: {
        w: Math.round(engine?.width ?? 0),
        h: Math.round(engine?.height ?? 0),
      },
      page: page.name,
    };
    this.progress("hardware", order.length, order.length, "done");
    this.post({ type: "hardware", stats });
    this.log(
      "ok",
      `hardware on the page "${page.name}": ${drawn} module(s) drawn, ${reused} reused, ${stats.gates} gates (${(stats.ms / 1000).toFixed(1)} s). Next: Build the OS.`,
    );
    try {
      if (engine) this.api.viewport.scrollAndZoomIntoView([engine]);
    } catch {
      /* cosmetic */
    }
    return stats;
  }

  /** Takes the machine out of the editor / machine frames (where Build the OS put it) and removes
   * those frames. The machine keeps its place on the page. */
  private async releaseMachine(
    page: PageNode,
    alsoRemove: boolean,
  ): Promise<void> {
    for (const f of page.children.filter(
      (n) => n.name.startsWith(CHAIN_PREFIX) || n.name === WARMUP,
    ))
      f.remove();
    for (const f of page.children.filter(
      (n) => n.name === PRESENT || n.name === MACHINE || n.name === CIRCUIT,
    )) {
      for (const c of (f as FrameNode).findAllWithCriteria({
        types: ["COMPONENT"],
      })) {
        if (c.name !== `${CELL_PREFIX}${TOP}`) continue;
        let x = 0;
        let y = 0;
        for (let n: BaseNode | null = c; n && n !== page; n = n.parent) {
          x += (n as SceneNode).x;
          y += (n as SceneNode).y;
        }
        page.appendChild(c);
        c.x = x;
        c.y = y;
        if (alsoRemove) c.remove();
      }
      f.remove();
    }
  }

  // ---------- 2. the OS ----------

  async os(o: OsOptions): Promise<OsStats> {
    const t0 = this.now();
    const page = await findPage(this.api);
    if (!page) throw new Error(`no "CPU NATHAN" page: Build hardware first`);
    await page.loadAsync();
    await this.api.setCurrentPageAsync(page);
    if (!findCell(page, TOP))
      throw new Error(`no cell/${TOP} on the page: Build hardware first`);
    const steps = 7;

    this.progress("os", 0, steps, "reading the circuit off the canvas");
    const lib = await this.phase("extract", () => extract([page]));
    if (!lib.has(TOP))
      throw new Error(`no cell/${TOP} component found: Build hardware first`);
    const net: FlatNetlist = await this.phase("flatten", () =>
      flatten(lib, TOP),
    );
    await this.breathe();

    this.progress(
      "os",
      1,
      steps,
      `one reaction per control (${net.gates.length} gates)`,
    );
    const catalog = await this.phase("reactions", () =>
      buildCatalogGently(
        net,
        reactionSpecs(),
        { latch: o.latch, budget: o.gatesUpTo ?? o.budget, alias: o.alias },
        () => this.breathe(),
      ),
    );
    await this.breathe();

    this.progress("os", 2, steps, "variables");
    await this.removeGently(COLLECTION);
    await this.removeGently(UI_COLLECTION);
    const init = nathanPowerOn(net);
    const used = new Set<number>();
    for (const g of net.gates) {
      used.add(g.out);
      for (const n of g.in) used.add(n);
    }
    for (const p of net.ports) for (const n of p.nets) used.add(n);
    used.delete(NET0);
    used.delete(NET1);
    const ids = [...used].sort((a, b) => a - b);
    const specs: VariableSpec[] = ids.map((id) => ({
      name: varName(net.netNames[id]),
      type: "BOOLEAN",
      init: init[id] === 1,
    }));
    const { collections, vars } = await this.phase("variables", () =>
      createVariables(this.api, COLLECTION, specs, {
        log: (m) => this.log("info", m),
        yieldEvery: 250,
      }),
    );
    const variables = new Map<number, Variable>(
      ids.map((id, i) => [id, vars[i]]),
    );
    // the hover column: where the pointer was last seen (copied into the machine's PX at the start
    // of a click; the row is the clicked layer's own, its reaction has PY built in)
    const ptrSpecs: VariableSpec[] = [
      ...[0, 1, 2, 3].map((i): VariableSpec => ({
        name: `ui/px/${i}`,
        type: "BOOLEAN",
        init: false,
      })),
      // the warm-up when ▶ Present opens: done once, and a bit it flips to get the viewer going
      { name: "ui/warm", type: "BOOLEAN", init: false },
      { name: "ui/scratch", type: "BOOLEAN", init: false },
    ];
    const ptr = await this.phase("hover variables", () =>
      createVariables(this.api, UI_COLLECTION, ptrSpecs),
    );
    const pxh = ptr.vars.slice(0, 4);
    const [warmed, scratch] = [ptr.vars[4], ptr.vars[5]];
    await this.breathe();

    this.progress("os", 3, steps, "lamps on the gates and wires");
    const engine = findCell(page, TOP)!;
    const lits = collectBindings(engine, net);
    // a master latch equals its slave between events: its lamps show Q (the direct commit never writes it)
    const shadow = masterToQ(net);
    let bound = 0;
    const bindNet = (node: SceneNode, wire: number) => {
      const id = shadow.get(wire) ?? wire;
      const v = id <= 1 ? id === 1 : variables.get(id);
      if (v === undefined) return;
      bindVisible(node, v);
      bound++;
    };
    // a few hundred at a time: a long uninterrupted run starves Figma's connection to its server
    for (const [gi, node] of lits.gateLit) {
      bindNet(node, net.gates[gi].out);
      if (bound % 400 === 399) await this.breathe();
    }
    for (const [id, nodes] of lits.wireLit)
      for (const node of nodes) {
        bindNet(node, id);
        if (bound % 400 === 399) await this.breathe();
      }
    this.log(
      "info",
      `bound ${bound} lit layers${lits.missing.length ? `, ${lits.missing.length} gate(s) without a lit layer` : ""}`,
    );
    await this.breathe();

    // reactions → stored Figma reactions
    const varIds = new Map<number, string>(
      [...variables].map(([id, v]) => [id, v.id]),
    );
    const port = (n: string) => net.ports.find((p) => p.name === n)!.nets;
    const copyPointer = port("PX")
      .map((n, i) => ({ to: n, from: pxh[i] }))
      .map((c) =>
      setVariable(
        varIds.get(c.to)!,
        exprData("EQUALS", [aliasData(c.from.id), boolData(true)]),
      ),
    );
    const convert = (a: PlanAction[]) => figmaActions(a, varIds);
    const eventSizes = new Map<string, number[]>();

    // The viewer runs a reaction's actions recursively, about three stack frames each: on a cold
    // page 1,200 in one event overflowed its stack and left the prototype dead to clicks. So a
    // reaction longer than the budget is cut between top-level actions: the event runs the first
    // part and opens an invisible 1×1 overlay, whose timer runs the next part on a fresh stack and
    // then swaps in the next overlay, or closes. The same machine, in a few events.
    // Only the logic is cut: everything that changes what the machine holds or shows (the register
    // commits and the screen lines, the reaction's tail from its first write) runs in the last event,
    // so between two events nothing is half written. That needs the tail to fit one event (a budget
    // of 352 or more with the default settings); below that a reaction is cut anywhere, and the build
    // says so in an error.
    this.progress("os", 4, steps, "reactions, cut into events");
    // the previous build's frames go first (the new chain overlays are made right below)
    await loadFonts(this.api);
    await this.releaseMachine(page, false);
    const triggered = new Map<string, Action[]>(); // run → what its trigger runs
    const chainFrames: FrameNode[] = [];
    const torn: string[] = [];
    // every event ends with the action that opens, swaps in or closes an overlay: +1
    const greedy = (list: PlanAction[], first: number) => {
      const out: PlanAction[][] = [[]];
      let size = first + 1;
      for (const a of list) {
        const n = staticSize([a]);
        if (out[out.length - 1].length && size + n > o.budget) {
          out.push([]);
          size = 1;
        }
        out[out.length - 1].push(a);
        size += n;
      }
      return out;
    };
    for (const [run, entry] of catalog) {
      // a canvas click takes the hovered column, unless its reaction has the column built in
      const lead =
        run.startsWith("click/") && !("PX" in entry.spec.ties) ? copyPointer : [];
      // the first event also runs what the layer puts before the reaction: the copy of the hover
      // column, and on a canvas cell the store of the pointer's column (reactionsFor)
      const first =
        lead.length + (run.startsWith("click/") || run.startsWith("paint/") ? pxh.length : 0);
      // a reaction as events: the logic (everything before its first register write) cut anywhere,
      // the writes and the screen lines all in the last event; null if those do not fit one
      const eventsOf = (r: Synthesized): PlanAction[][] | null => {
        const acts = r.actions;
        if (first + staticSize(acts) <= o.budget) return [acts];
        const [head, tail] = [acts.slice(0, r.commitAt), acts.slice(r.commitAt)];
        const tailSize = staticSize(tail);
        if (tailSize + 1 > o.budget) return null;
        const parts = greedy(head, first);
        const last = parts[parts.length - 1];
        const lastSize =
          staticSize(last) + (parts.length === 1 ? first : 0) + 1;
        if (lastSize + tailSize <= o.budget)
          parts[parts.length - 1] = [...last, ...tail];
        else parts.push(tail);
        return parts;
      };
      let parts = eventsOf(entry.reaction);
      // more than one event: the commit Q = D is much shorter, and logic kept out of the register
      // blocks can go in the early events; take whichever needs the fewest
      if (!parts || parts.length > 1)
        for (const alt of [
          { latch: "direct" },
          { latch: "direct", inside: false },
        ] as const) {
          const r = synthesize(net, entry.spec.ties, {
            ...alt,
            alias: o.alias,
            given: entry.spec.given,
          });
          const p = eventsOf(r);
          if (p && (!parts || p.length < parts.length)) {
            entry.reaction = r;
            parts = p;
          }
        }
      if (!parts) {
        torn.push(run); // cannot keep the writes together: cut anywhere
        parts = greedy(entry.reaction.actions, first);
      }
      const chained = parts.length > 1;
      eventSizes.set(
        run,
        parts.map((p, k) => staticSize(p) + (k ? 0 : first) + (chained ? 1 : 0)),
      );
      if (!chained) {
        triggered.set(run, [...lead, ...convert(parts[0])]);
        continue;
      }
      const frames = parts.slice(1).map((_, k) => {
        const f = box(this.api, `${CHAIN_PREFIX}${run} ${k + 1}`, 1, 1, COLORS.bg);
        f.fills = [];
        chainFrames.push(f);
        return f;
      });
      for (let k = 1; k < parts.length; k++)
        await frames[k - 1].setReactionsAsync([
          {
            trigger: afterTimeout(0.001),
            actions: [
              ...convert(parts[k]),
              k + 1 < parts.length
                ? navigateWith(frames[k].id, "SWAP")
                : ({ type: "CLOSE" } as Action),
            ],
          },
        ]);
      triggered.set(run, [
        ...lead,
        ...convert(parts[0]),
        navigateWith(frames[0].id, "OVERLAY"),
      ]);
      await this.breathe();
    }
    // a hover stores the pointer's column (column c)
    const store = (c: number): Action[] =>
      pxh.map((v, i) => setVariable(v.id, boolData(((c >> i) & 1) === 1)));
    // the frames a "go/<name>" control jumps to (made before the editor is drawn)
    const goTo = new Map<string, string>();
    const triggerOf = (t: ReactionRef["trigger"]) =>
      t.on === "key"
        ? keyDown(t.codes)
        : t.on === "enter"
          ? mouseEnter(0)
          : t.on === "down"
            ? mouseDown(0)
            : t.on === "up"
              ? mouseUp(0)
              : onClick();
    const reactionsFor = (ref: ReactionRef): Reaction[] => {
      const t = ref.trigger;
      if (ref.run.startsWith("pointer/"))
        return [
          {
            trigger: triggerOf(t),
            actions: store(Number(ref.run.slice("pointer/".length))),
          },
        ];
      if (ref.run.startsWith("go/")) {
        const to = goTo.get(ref.run.slice("go/".length));
        if (!to) throw new Error(`the screen jumps to a frame that does not exist: ${ref.run}`);
        return [{ trigger: triggerOf(t), actions: [navigate(to)] }];
      }
      const actions = triggered.get(ref.run);
      if (!actions)
        throw new Error(
          `the screen refers to a reaction that does not exist: ${ref.run}`,
        );
      return [
        {
          trigger: triggerOf(t),
          actions:
            ref.pointer === undefined
              ? actions
              : [...store(ref.pointer), ...actions],
        },
      ];
    };

    // ▶ Present opens the editor. "see the machine" shows every gate as a lamp, all at once; "the
    // circuit" a scrolling window over the full drawing. The frames share the variables, so all of
    // them show the live state.
    this.progress("os", 5, steps, "the editor, machine and circuit frames");
    const engineNow = findCell(page, TOP)!;
    const ctx = {
      api: this.api,
      variable: (netName: string) => {
        const id = net.aliases.get(netName);
        return id === undefined ? undefined : variables.get(id);
      },
      reactionsFor,
      breathe: () => this.breathe(),
    };
    const frame = (name: string) => {
      const f = box(this.api, name, UI_W + 2 * PAD, HEADER + UI_H + PAD, COLORS.bg);
      f.clipsContent = true;
      return f;
    };
    // the editor fills the frame Present opens: 16:9, so it shows whole without scrolling (a
    // taller frame scrolls, and the viewer then turns a drag into a scroll of the whole screen)
    const present = box(this.api, PRESENT, UI_W, UI_H, COLORS.bg);
    present.clipsContent = true;
    const machine = frame(MACHINE);
    const circuit = frame(CIRCUIT);
    goTo.set("machine", machine.id);
    // the drawing stays where it is on the page: the circuit window opens on its top-left corner
    put(page, circuit, engineNow.x - PAD, engineNow.y - HEADER);
    put(page, present, circuit.x, circuit.y - GAP - present.height);
    put(page, machine, present.x + present.width + GAP, present.y);
    chainFrames.forEach((f, i) =>
      put(page, f, machine.x + machine.width + GAP, machine.y + i * 8),
    );
    const view = box(this.api, "view", UI_W, UI_H, COLORS.bg);
    view.clipsContent = true;
    view.overflowDirection = "BOTH";
    put(circuit, view, PAD, HEADER);
    put(view, engineNow, 0, 0);
    const result = await this.phase("editor", () =>
      // the gates are in their own frame here, one button away
      render(
        ctx,
        present,
        uiSpec(),
      ),
    );
    result.root.x = 0;
    result.root.y = 0;
    const blocks = new Map(lib.get(TOP)!.instances.map((i) => [i.name, i.cell]));
    const map = await this.phase("gate map", () =>
      render(
        ctx,
        machine,
        gateMap(net, {
          width: UI_W,
          columns: 5,
          lamp: 7,
          gap: 2,
          netOf: (gi) => net.netNames[shadow.get(net.gates[gi].out) ?? net.gates[gi].out],
          title: (b, n) => `${b}${blocks.has(b) ? ` · ${blocks.get(b)!.replace(CELL_PREFIX, "")}` : ""} · ${n} gates`,
          colours: {
            block: COLORS.panel,
            text: COLORS.dim,
            lamp: COLORS.lampOn,
            off: COLORS.lampOff,
          },
        }),
      ),
    );
    map.root.x = PAD;
    map.root.y = HEADER;
    // the Arrange shortcuts (D, [ and ]) work in the other two frames too: the same stack of key
    // layers picked by the selection register
    let keysBound = 0;
    for (const f of [machine, circuit])
      keysBound += (await render(ctx, f, slotKeys(COLORS.bg))).bound;
    const go = async (from: FrameNode, to: FrameNode, label: string, slot = 0) => {
      const b = put(from, button(this.api, label, COLORS.step, 200, 40), from.width - PAD - 200 - slot * 216, 32);
      await b.setReactionsAsync([{ trigger: onClick(), actions: [navigate(to.id)] }]);
    };
    await go(machine, present, "◂ back to the editor");
    await go(machine, circuit, "the circuit ▸", 1);
    await go(circuit, machine, "◂ back to the machine");
    // the drawing is 70,000 px wide: one button per module scrolls the window to it
    let bx = PAD;
    for (const part of engineNow.children) {
      if (part.type !== "INSTANCE" || !blocks.has(part.name) || /^g\d+$/.test(part.name)) continue;
      const w = 16 + part.name.length * 9;
      const b = put(circuit, button(this.api, part.name, COLORS.panel, w, 28), bx, 92);
      await b.setReactionsAsync([
        { trigger: onClick(), actions: [navigateWith(part.id, "SCROLL_TO")] },
      ]);
      bx += w + 6;
    }
    this.progress("os", 6, steps, "shortcut keys and the flow");

    const keyReactions: Reaction[] = KEYS.flatMap((k) =>
      reactionsFor({ trigger: { on: "key", codes: k.codes }, run: k.run }),
    );
    // the shortcuts work in every frame: press them while watching the gates
    // A fresh viewer is slow at its first long reaction and first overlay (a canvas click took ~2 s
    // and the click after it was lost behind the overlay): when the editor first shows, run a few
    // hundred throwaway actions, and when some reactions run as chains of overlays, open and close
    // an empty overlay, before the user's first click.
    let warmup: FrameNode | null = null;
    if (chainFrames.length) {
      warmup = box(this.api, WARMUP, 1, 1, COLORS.bg);
      warmup.fills = [];
      put(page, warmup, machine.x + machine.width + GAP, machine.y - 40);
      await warmup.setReactionsAsync([
        { trigger: afterTimeout(0.001), actions: [{ type: "CLOSE" } as Action] },
      ]);
    }
    const flip = setVariable(
      scratch.id,
      exprData("NOT", [aliasData(scratch.id)]),
    );
    const warm: Reaction = {
      trigger: afterTimeout(0.001),
      actions: [
        conditional(exprData("EQUALS", [aliasData(warmed.id), boolData(false)]), [
          setVariable(warmed.id, boolData(true)),
          ...Array.from({ length: Math.min(500, o.budget - 3) }, () => flip),
          ...(warmup ? [navigateWith(warmup.id, "OVERLAY")] : []),
        ]),
      ],
    };
    await present.setReactionsAsync([...keyReactions, warm]);
    for (const f of [machine, circuit]) await f.setReactionsAsync(keyReactions);
    setFlows(page, [{ nodeId: present.id, name: FLOW }]);
    // Figma makes a flow of its own for a top-level frame that gets a navigation (the overlays that
    // swap in the next one): they are not places to start, so they go
    const overlayIds = new Set(
      [...chainFrames, ...(warmup ? [warmup] : [])].map((f) => f.id),
    );
    page.flowStartingPoints = page.flowStartingPoints.filter(
      (f) => !overlayIds.has(f.nodeId),
    );

    // header
    const worst = [...eventSizes.entries()]
      .map(([name, sizes]) => ({ name, actions: Math.max(...sizes) }))
      .sort((a, b) => b.actions - a.actions)[0] ?? { name: "-", actions: 0 };
    const heading = (f: FrameNode, title: string, sub: string) => {
      put(f, text(this.api, title, { size: 24, bold: true }), PAD, 28);
      put(f, text(this.api, sub, { size: 13, color: COLORS.dim }), PAD, 64);
    };
    heading(
      machine,
      "CPU NATHAN — the machine",
      `All ${net.gates.length} gates, one lamp each, by module · ${ids.length} wires (variables) · ${catalog.size} reactions, longest ${worst.actions} actions in one event (${worst.name}). Press the editor's shortcut keys here and watch them compute.`,
    );
    heading(
      circuit,
      "CPU NATHAN — the circuit",
      `Every gate and wire, live. Pick a module to scroll the window to it, or scroll inside the window.`,
    );
    remember(this.api, page);
    this.progress("os", steps, steps, "done");

    if (torn.length)
      this.log(
        "error",
        `the register writes of ${torn.join(", ")} do not fit one event of ${o.budget}: they are cut, so a fast second input could see them half done`,
      );
    const chainedRuns = [...eventSizes.entries()].filter(([, sizes]) => sizes.length > 1);
    if (chainedRuns.length)
      this.log(
        "info",
        `${chainedRuns.length} reaction(s) longer than ${o.budget} actions run as a few events through timed overlays: ${chainedRuns.map(([n, sizes]) => `${n} (${sizes.length})`).join(", ")}`,
      );
    const tooLong = [...eventSizes.entries()].filter(([, sizes]) => Math.max(...sizes) > o.budget);
    if (tooLong.length)
      this.log(
        "error",
        `${tooLong.length} reaction(s) have a single step longer than ${o.budget} actions: ${tooLong.map(([n]) => n).join(", ")}`,
      );
    if (result.missing.length)
      this.log(
        "error",
        `${result.missing.length} screen binding(s) have no variable, e.g. ${result.missing.slice(0, 3).join(", ")}`,
      );
    const stats: OsStats = {
      gates: net.gates.length,
      variables: ids.length + ptrSpecs.length,
      collections: collections.length + 1,
      reactions: catalog.size,
      worstReaction: worst,
      bound: bound + result.bound + map.bound + keysBound,
      missing: result.missing.length + map.missing.length,
      uiLayers: result.created + map.created,
      ms: this.now() - t0,
    };
    this.post({ type: "os", stats });
    this.log(
      "ok",
      `built: ${stats.uiLayers} editor layers, ${stats.variables} variables, ${stats.bound} bindings, longest event ${worst.actions} actions (${(stats.ms / 1000).toFixed(1)} s). ▶ Present the flow "${FLOW}" (from the frame "${PRESENT}"), or press Self-test.`,
    );
    try {
      this.api.viewport.scrollAndZoomIntoView([present]);
    } catch {
      /* cosmetic */
    }
    return stats;
  }

  /** Removes the collections `createVariables(name)` made, a few hundred variables at a time with a
   * breath in between: removing thousands at once can drop Figma's connection to its server. */
  private async removeGently(name: string): Promise<void> {
    const isOurs = (c: string) =>
      c === name || new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · \\d+$`).test(c);
    const colls = (await this.api.variables.getLocalVariableCollectionsAsync()).filter((c) => isOurs(c.name));
    if (!colls.length) return;
    const ids = new Set(colls.map((c) => c.id));
    const vars = (await this.api.variables.getLocalVariablesAsync()).filter((v) => ids.has(v.variableCollectionId));
    for (let i = 0; i < vars.length; i++) {
      vars[i].remove();
      if (i % 250 === 249) await this.breathe();
    }
    for (const c of colls) c.remove();
    await this.breathe();
  }

  // ---------- 3. self-test ----------

  async selftest(events: number, seed: number) {
    const r = await this.phase("self-test", () =>
      selfTest(this.api, { events, seed }),
    );
    this.post({ type: "selftest", result: r });
    this.log(r.ok ? "ok" : "error", r.text);
    return r;
  }

  // ---------- 4. platform tests ----------

  async platform() {
    const { page } = await ensurePage(this.api, (m) => this.log("info", m));
    remember(this.api, page);
    await page.loadAsync();
    await this.api.setCurrentPageAsync(page);
    const { frames, tests } = await this.phase("platform tests", () =>
      buildPlatformTests(this.api, page, (m) => this.log("info", m)),
    );
    this.post({ type: "platform", tests });
    this.log(
      "ok",
      `${frames.length} platform tests built. ▶ Present, choose a flow named "${TEST_PREFIX}…", follow the text in its frame. The first one finds your viewer's real limit.`,
    );
    try {
      this.api.viewport.scrollAndZoomIntoView(frames);
    } catch {
      /* cosmetic */
    }
    return tests;
  }

  // ---------- 5. clean ----------

  async clean() {
    const page = await findPage(this.api);
    let removed = 0;
    if (page) {
      await page.loadAsync();
      await this.releaseMachine(page, false);
      for (const n of [...page.children])
        if (
          n.name === PRESENT ||
          n.name === MACHINE ||
          n.name === CIRCUIT ||
          n.name.startsWith(TEST_PREFIX)
        ) {
          n.remove();
          removed++;
        }
    }
    for (const c of [COLLECTION, UI_COLLECTION, TEST_COLLECTION])
      removed += await removeCollections(this.api, c);
    this.log(
      "ok",
      `removed ${removed} thing(s) (frames and variable collections); the drawn hardware stays`,
    );
  }
}

/** The `cell/<name>` component on `page`, wherever it sits (top level or in a frame). */
export function findCell(page: PageNode, name: string): ComponentNode | null {
  const full = `${CELL_PREFIX}${name}`;
  const top = page.children.find(
    (n): n is ComponentNode => n.type === "COMPONENT" && n.name === full,
  );
  if (top) return top;
  return (
    (page
      .findAllWithCriteria({ types: ["COMPONENT"] })
      .find((n) => n.name === full) as ComponentNode | undefined) ?? null
  );
}
