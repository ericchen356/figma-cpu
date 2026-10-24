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
  keyDown,
  mouseDown,
  mouseEnter,
  mouseUp,
  onClick,
  setVariable,
} from "../../../src/prototype/figma-actions";
import { nathanLibrary, nathanPowerOn } from "../../src/hw";
import { buildCatalog, reactionSpecs } from "../../src/react/catalog";
import { splitStages } from "../../src/react/stage";
import { staticSize } from "../../src/react/synth";
import {
  buildPlatformTests,
  TEST_COLLECTION,
  TEST_PREFIX,
} from "../../src/platform/tests";
import { render } from "../../src/ui/render";
import { KEYS, UI_H, UI_W, uiSpec, type ReactionRef } from "../../src/ui/spec";
import type {
  DocStatus,
  HardwareStats,
  LogLevel,
  OsStats,
  ToMain,
  ToUi,
} from "./messages";
import { COLLECTION, FLOW, PRESENT, TOP, UI_COLLECTION } from "./names";
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
  /** "auto": every latch gate is evaluated unless a reaction would exceed `budget`, then compact. */
  latch: "auto" | "gates" | "compact";
  /** Largest number of actions meant to run in ONE event. Longer click reactions are split across
   * MOUSE_DOWN / MOUSE_UP / ON_CLICK of the same click (3 events, no timer). */
  budget: number;
  /** Turn identity gates into wires (fewer actions; those gates' lamps keep their last colour). */
  alias: boolean;
  /** Keep keyboard shortcuts even if one exceeds the budget (they cannot be split). */
  longKeys?: boolean;
}

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
              longKeys: msg.longKeys,
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

  /** Takes the machine out of the editor frame (if it is in one) and removes the frame. */
  private async releaseMachine(
    page: PageNode,
    alsoRemove: boolean,
  ): Promise<void> {
    for (const f of page.children.filter((n) => n.name === PRESENT)) {
      for (const c of (f as FrameNode).findAllWithCriteria({
        types: ["COMPONENT"],
      })) {
        if (c.name !== `${CELL_PREFIX}${TOP}` || c.parent !== f) continue;
        const x = f.x + c.x;
        const y = f.y + c.y;
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
      buildCatalog(net, reactionSpecs(), {
        latch: o.latch,
        budget: o.budget,
        alias: o.alias,
      }),
    );
    await this.breathe();

    this.progress("os", 2, steps, "variables");
    await removeCollections(this.api, COLLECTION);
    await removeCollections(this.api, UI_COLLECTION);
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
      }),
    );
    const variables = new Map<number, Variable>(
      ids.map((id, i) => [id, vars[i]]),
    );
    // the hover position: where the pointer was last seen (copied into the machine's PX / PY at the start of a click)
    const ptrSpecs: VariableSpec[] = [0, 1].flatMap((a) =>
      [0, 1, 2, 3].map((i): VariableSpec => ({
        name: `ui/${a ? "py" : "px"}/${i}`,
        type: "BOOLEAN",
        init: false,
      })),
    );
    const ptr = await this.phase("hover variables", () =>
      createVariables(this.api, UI_COLLECTION, ptrSpecs),
    );
    const [pxh, pyh] = [ptr.vars.slice(0, 4), ptr.vars.slice(4, 8)];
    await this.breathe();

    this.progress("os", 3, steps, "lamps on the gates and wires");
    const engine = findCell(page, TOP)!;
    const lits = collectBindings(engine, net);
    let bound = 0;
    const bindNet = (node: SceneNode, id: number) => {
      const v = id <= 1 ? id === 1 : variables.get(id);
      if (v === undefined) return;
      bindVisible(node, v);
      bound++;
    };
    for (const [gi, node] of lits.gateLit) bindNet(node, net.gates[gi].out);
    for (const [id, nodes] of lits.wireLit)
      for (const node of nodes) bindNet(node, id);
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
    const [pxNets, pyNets] = [port("PX"), port("PY")];
    const copyPointer = [
      ...pxNets.map((n, i) => ({ to: n, from: pxh[i] })),
      ...pyNets.map((n, i) => ({ to: n, from: pyh[i] })),
    ].map((c) =>
      setVariable(
        varIds.get(c.to)!,
        exprData("EQUALS", [aliasData(c.from.id), boolData(true)]),
      ),
    );
    const convert = (a: PlanAction[]) => figmaActions(a, varIds);
    const eventSizes = new Map<string, number[]>();
    const noteSize = (name: string, n: number[]) =>
      eventSizes.set(name, [...(eventSizes.get(name) ?? []), ...n]);
    const reactionsFor = (ref: ReactionRef): Reaction[] => {
      const t = ref.trigger;
      if (ref.run.startsWith("pointer/")) {
        const [c, r] = ref.run.slice("pointer/".length).split(",").map(Number);
        return [
          {
            trigger: mouseEnter(0),
            actions: [
              ...pxh.map((v, i) =>
                setVariable(v.id, boolData(((c >> i) & 1) === 1)),
              ),
              ...pyh.map((v, i) =>
                setVariable(v.id, boolData(((r >> i) & 1) === 1)),
              ),
            ],
          },
        ];
      }
      const entry = catalog.get(ref.run);
      if (!entry)
        throw new Error(
          `the screen refers to a reaction that does not exist: ${ref.run}`,
        );
      const { actions, screenAt } = entry.reaction;
      if (t.on === "key") {
        noteSize(ref.run, [staticSize(actions)]);
        return [{ trigger: keyDown(t.codes), actions: convert(actions) }];
      }
      const lead = ref.run.startsWith("click/") ? copyPointer : [];
      if (staticSize(actions) + lead.length <= o.budget) {
        noteSize(ref.run, [staticSize(actions) + lead.length]);
        return [
          { trigger: onClick(), actions: [...lead, ...convert(actions)] },
        ];
      }
      // too long for one event: the three events of one click, each a consecutive piece
      const parts = splitStages(actions, screenAt, 3);
      noteSize(
        ref.run,
        parts.map((p, i) => staticSize(p) + (i === 0 ? lead.length : 0)),
      );
      return [
        { trigger: mouseDown(0), actions: [...lead, ...convert(parts[0])] },
        { trigger: mouseUp(0), actions: convert(parts[1]) },
        { trigger: onClick(), actions: convert(parts[2]) },
      ];
    };

    // the editor frame, with the machine below it
    this.progress("os", 4, steps, "the editor frame");
    await loadFonts(this.api);
    await this.releaseMachine(page, false);
    const engineNow = findCell(page, TOP)!;
    const ctx = {
      api: this.api,
      variable: (netName: string) => {
        const id = net.aliases.get(netName);
        return id === undefined ? undefined : variables.get(id);
      },
      reactionsFor,
    };
    const frameW = Math.max(UI_W + 2 * PAD, engineNow.width + 2 * PAD);
    const frameH = HEADER + UI_H + GAP + engineNow.height + 2 * PAD;
    const present = box(this.api, PRESENT, frameW, frameH, COLORS.bg);
    present.clipsContent = true;
    put(
      page,
      present,
      engineNow.x - PAD,
      engineNow.y - (HEADER + UI_H + GAP + PAD),
    );
    const result = await this.phase("editor", () =>
      render(ctx, present, uiSpec()),
    );
    result.root.x = PAD;
    result.root.y = HEADER;
    put(present, engineNow, PAD, HEADER + UI_H + GAP + PAD);
    this.progress("os", 5, steps, "shortcut keys and the flow");

    // a shortcut cannot be split across events; past the budget it is left out unless asked for
    const skipped: string[] = [];
    const keyReactions: Reaction[] = KEYS.flatMap((k) => {
      const size = staticSize(catalog.get(k.run)!.reaction.actions);
      if (size > o.budget && o.longKeys === false) {
        skipped.push(k.run);
        return [];
      }
      return reactionsFor({
        trigger: { on: "key", codes: k.codes },
        run: k.run,
      });
    });
    await present.setReactionsAsync(keyReactions);
    if (skipped.length)
      this.log(
        "info",
        `left out ${skipped.length} shortcut(s) longer than ${o.budget} actions: ${skipped.join(", ")} (their buttons work)`,
      );
    setFlows(page, [{ nodeId: present.id, name: FLOW }]);

    // header
    const worst = [...eventSizes.entries()]
      .map(([name, sizes]) => ({ name, actions: Math.max(...sizes) }))
      .sort((a, b) => b.actions - a.actions)[0] ?? { name: "-", actions: 0 };
    put(
      present,
      text(
        this.api,
        "CPU NATHAN — the Figma OS editor as a gate-level machine",
        { size: 24, bold: true },
      ),
      PAD,
      28,
    );
    put(
      present,
      text(
        this.api,
        `${net.gates.length} gates · ${ids.length} wires (variables) · ${catalog.size} reactions, longest ${worst.actions} actions in one event (${worst.name})`,
        { size: 13, color: COLORS.dim },
      ),
      PAD,
      64,
    );
    put(
      present,
      text(
        this.api,
        "Click in the editor: every layer, colour and lamp on it is a gate-level register bit, and the gates of the machine below light as it computes.\nA canvas click is two clicks to move or draw (pick up / put down, first corner / opposite corner). Esc cancels.",
        { size: 12, color: COLORS.dim },
      ),
      PAD,
      88,
    );
    remember(this.api, page);
    this.progress("os", steps, steps, "done");

    const over = [...eventSizes.entries()]
      .filter(([, sizes]) => Math.max(...sizes) > o.budget)
      .map(([name]) => name);
    if (over.length)
      this.log(
        "info",
        `${over.length} reaction(s) are longer than ${o.budget} actions in one event (keyboard shortcuts cannot be split): ${over.slice(0, 8).join(", ")}${over.length > 8 ? " …" : ""}. Use the panel buttons for those, or raise the budget after the platform tests.`,
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
      bound: bound + result.bound,
      missing: result.missing.length,
      uiLayers: result.created,
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
        if (n.name === PRESENT || n.name.startsWith(TEST_PREFIX)) {
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
