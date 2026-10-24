// The FigmaCPU Silicon plugin, minus the window: every button of the panel is a method here.
// It takes the Plugin API object and a `post` callback so the whole flow runs against a fake
// Figma in Node (test/plugin.test.ts). Lane E's canvas code uses the `figma` global, so the
// `api` passed here must be that same object (it is, in the plugin and in the tests).
//
//   Build hardware   gates + every cell + cell/CPU as components, one module at a time, on ONE
//                    page by default (Starter plan files allow 3 pages; see where.ts)
//   Front panel      a small component: two 7-segment digits + one lamp per probe bit
//   Compile          canvas → extract → flatten → compile → plan → apply (+ the CPU · Step frame,
//                    a copy of apply's controls: no reaction is hand-built here, so plan/apply
//                    options such as chunked ticks pass straight through)
//   Load program     new RAM image → power-on values written as the variables' initial values,
//                    and the power-on literals in the existing reactions (Reset) patched
//   Plugin clock     FastSim on the extracted circuit, writing changed variables every frame
//   Verify           the extracted circuit vs the ISA model, tick by tick
import { compile, type CompiledSchedule } from "../../src/compile";
import { cpuLibrary, PROBES } from "../../src/cpu";
import { collectBindings, dependencyOrder, drawGates, drawLibrary, extract } from "../../src/figma";
import { CELL_PREFIX } from "../../src/figma/names";
import { PROGRAMS } from "../../src/isa";
import { flatten } from "../../src/netlist/flatten";
import { type FlatNetlist, GATE_PREFIX, NET1 } from "../../src/netlist/types";
import { apply, type ApplyOptions, bindVisible, plan, type PlanOptions, type PrototypePlan } from "../../src/prototype";
import { loadFonts } from "../../src/prototype/draw";
import { buildStepFrame, child, dismantleStepFrame, findCell, liftCells, restore, setFlow, STEP_FRAME } from "./canvas";
import { type ClockSession, PluginClock, type VarRef } from "./clock";
import type { BuildStats, CompileStats, DocStatus, LogLevel, ToMain, ToUi } from "./messages";
import { ensureFrontPanel, findFrontPanel, panelLits } from "./panel";
import { AsmFailed, assembleOrThrow, powerOnWith, programName, verifyAgainstModel, type VerifyResult } from "./program";
import {
  CELLS_DY,
  cellsBottom,
  CPU_GAP,
  labelRegions,
  locate,
  pageBottom,
  placeGates,
  remember,
  Shelf,
  siliconOrigin,
  uniquePages,
  type Where,
} from "./where";

/** Plan name: variable collection "CPU" (+ "CPU · 2" …), frames "CPU · Control", "CPU · Run A/B". */
export const NAME = "CPU";
const CPU_MODULE = "CPU";
const DOC_PROGRAM = "silicon.program";
const TITLE = "FigmaCPU — a gate-level CPU that Figma computes";
/** Where the front panel's top edge sits above the CPU (left of the Step frame's header). */
const STEP_TOP = 264;
/** Control variables that count ticks (FLOAT, or STRING for a text binding). */
const TICKS_PREFIX = "ctl/tick";

const isOurCollection = (name: string) => name === NAME || new RegExp(`^${NAME} · \\d+$`).test(name);
/** createVariables' fallback for names Figma rejects (src/prototype/draw.ts). */
const safeName = (name: string) => name.replace(/[^\w/ -]/g, "_");

/** The compiled circuit and its variables, kept between button presses. */
interface Session {
  net: FlatNetlist;
  schedule: CompiledSchedule;
  plan: PrototypePlan;
  vars: Map<number, VarRef>;
  /** Tick counters (ctl/tick…): the plugin clock advances them, Load program zeroes them. */
  ticks: VarRef[];
  source: string;
  /** The plan options of the compile (Load program re-plans with them). */
  planOpts: Partial<PlanOptions>;
}

export interface AppOptions {
  /** Lets Figma breathe between modules / phases (default: setTimeout 0). */
  yield?: () => Promise<void>;
  now?: () => number;
  /** Plugin clock frame pause, ms (tests use 0). */
  clockFrameMs?: number;
}

export interface BuildOptions {
  gateLabels?: boolean;
  redraw?: boolean;
  /** Separate pages Silicon · Gates / Cells / CPU (falls back to one page if Figma refuses). */
  separatePages?: boolean;
}

export interface CompileOptions {
  flat?: boolean;
  runDelayMs?: number;
  /** Largest reaction (actions per event) the viewer survives; passed to plan() and apply()
   * for chunked ticks (lane F). Unset: their default. */
  maxActionsPerEvent?: number;
  /** Extra plan() options, passed through (initial, name and halt are set here). */
  plan?: Partial<PlanOptions> & Record<string, unknown>;
  /** Extra apply() options, passed through (bindings, display, page, at are set here). */
  apply?: Partial<ApplyOptions> & Record<string, unknown>;
}

export interface CompileReport {
  stats: CompileStats;
  plan: PrototypePlan;
  net: FlatNetlist;
  stepFrame: FrameNode;
  frames: { control: FrameNode; runA: FrameNode; runB: FrameNode };
}

export class SiliconApp {
  private busy: string | null = null;
  private session: Session | null = null;
  readonly clock: PluginClock;
  private readonly now: () => number;
  private readonly breathe: () => Promise<void>;

  constructor(
    private readonly api: PluginAPI,
    private readonly post: (m: ToUi) => void,
    opts: AppOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.breathe = opts.yield ?? (() => new Promise((r) => setTimeout(r, 0)));
    this.clock = new PluginClock(
      () => this.clockSession(),
      (status) => this.post({ type: "clock", status }),
      { frameMs: opts.clockFrameMs, now: this.now, onError: (e) => this.log("error", `plugin clock stopped: ${errText(e)}`) },
    );
  }

  // ---------- messages ----------

  /** Handles one panel message. Never throws: errors go to the panel log. */
  async handle(msg: ToMain): Promise<void> {
    try {
      switch (msg.type) {
        case "init":
          this.post({ type: "hello", status: await this.status() });
          return;
        case "build":
          await this.task("Build hardware", () => this.build({ gateLabels: msg.gateLabels, redraw: msg.redraw, separatePages: msg.separatePages }));
          return;
        case "panel":
          await this.task("Front panel", () => this.frontPanel());
          return;
        case "compile":
          await this.task("Compile", () =>
            this.compile(msg.source, { flat: msg.flat, runDelayMs: msg.runDelayMs, maxActionsPerEvent: msg.maxActionsPerEvent }),
          );
          return;
        case "load":
          await this.task("Load program", () => this.loadProgram(msg.source));
          return;
        case "verify":
          await this.task("Verify", () => this.verify(msg.source, msg.maxTicks));
          return;
        case "clock":
          if (msg.action === "pause") {
            this.clock.pause();
            return;
          }
          if (msg.action === "reset") {
            await this.task("Reset (plugin clock)", () => this.loadProgram(msg.source ?? this.session?.source ?? PROGRAMS.mul));
            return;
          }
          if (this.busy) {
            this.log("error", `busy: ${this.busy} is still running`);
            return;
          }
          if (msg.action === "step") await this.clock.step(1);
          else void this.clock.run(msg.tps ?? 10);
          return;
      }
    } catch (e) {
      this.fail(e);
    }
  }

  private async task<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.busy) {
      this.log("error", `busy: ${this.busy} is still running`);
      return undefined;
    }
    this.busy = name;
    this.post({ type: "busy", task: name });
    try {
      return await fn();
    } catch (e) {
      this.fail(e, name);
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

  private fail(e: unknown, where?: string) {
    if (e instanceof AsmFailed) this.post({ type: "asm", errors: e.errors });
    this.log("error", `${where ? `${where} failed: ` : ""}${errText(e)}`);
  }

  private log(level: LogLevel, text: string) {
    this.post({ type: "log", level, text });
  }

  private progress(task: string, done: number, total: number, label: string) {
    this.post({ type: "progress", task, done, total, label });
  }

  /** Runs one named phase; a failure says which phase it was. */
  private async phase<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw new Error(`${name}: ${errText(e)}`);
    }
  }

  /** What the document holds (cheap checks only). */
  async status(): Promise<DocStatus> {
    const where = await locate(this.api);
    let hardware = false;
    let panel = false;
    if (where) {
      await where.pages.cpu.loadAsync();
      hardware = !!findCell(where.pages.cpu, CPU_MODULE);
      panel = !!findFrontPanel(where.pages.cpu);
    }
    const colls = await this.api.variables.getLocalVariableCollectionsAsync();
    const src = this.api.root.getPluginData(DOC_PROGRAM);
    return {
      hardware,
      panel,
      compiled: colls.some((c) => isOurCollection(c.name)),
      program: src ? programName(src) : null,
      page: where ? (where.single ? where.pages.cpu.name : `${where.pages.gates.name} / ${where.pages.cells.name} / ${where.pages.cpu.name}`) : null,
    };
  }

  // ---------- 1. build hardware ----------

  async build(o: BuildOptions = {}): Promise<BuildStats> {
    const t0 = this.now();
    const gateLabels = o.gateLabels !== false;
    const lib = cpuLibrary();
    this.clock.invalidate();
    this.session = null;
    const where = (await locate(this.api, { build: true, separate: o.separatePages, log: (m) => this.log("info", m) }))!;
    const { pages, single } = where;
    if (o.separatePages && single) this.log("info", `building on the page "${pages.cpu.name}"`);
    for (const p of uniquePages(where)) await p.loadAsync();
    await this.api.setCurrentPageAsync(pages.cpu);
    const origin = single ? siliconOrigin(this.api, pages.cpu) : null;

    // drawLibrary reuses top-level `cell/*` components only; cell/CPU may sit in the Step frame.
    const cellPages = [...new Set([pages.cells, pages.cpu])];
    let lifted = liftCells(cellPages);
    if (o.redraw) {
      lifted = []; // they stay at the top level and are removed with the others below
      dismantleStepFrame(pages.cpu, null);
      let removed = 0;
      for (const page of cellPages)
        for (const n of [...page.children])
          if (n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX) && lib.has(n.name.slice(CELL_PREFIX.length))) {
            n.remove();
            removed++;
          }
      if (removed) this.log("info", `redraw: removed ${removed} old cell components`);
    }

    const order = dependencyOrder(lib);
    this.progress("build", 0, order.length, "gates");
    const gatesBefore = new Set(pages.gates.children.filter((n) => n.type === "COMPONENT" && n.name.startsWith(GATE_PREFIX)).map((n) => n.name));
    const gates = await this.phase("drawing gates", () => drawGates(pages.gates, { labels: gateLabels, redraw: o.redraw }));
    // New gates (drawGates puts them at y = 0) go into the gates row of the silicon area.
    if (origin && [...gates.values()].some((g) => !gatesBefore.has(g.name))) placeGates([...gates.values()], origin);
    await this.breathe();
    const existing = new Set<string>();
    for (const page of cellPages)
      for (const n of page.children) if (n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX)) existing.add(n.name.slice(CELL_PREFIX.length));

    // One module per drawLibrary call, yielding in between so Figma stays responsive. New
    // modules go on a shelf in the cells region; the CPU below them (or on its own page).
    let shelf: Shelf | null = null;
    let drawn = 0;
    let reused = 0;
    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      this.progress("build", i, order.length, name);
      if (existing.has(name)) {
        reused++;
        continue;
      }
      const r = await this.phase(`drawing ${name}`, () => drawLibrary(lib, pages, { only: [name], gateLabels }));
      const comp = r.cells.get(name);
      if (!comp || r.reused.includes(name)) {
        reused++;
        continue;
      }
      drawn++;
      if (name === CPU_MODULE) {
        const below = origin ? Math.max(cellsBottom(pages.cpu), origin.y + CELLS_DY) + CPU_GAP : pageBottom(pages.cpu, comp) + 192 + STEP_TOP;
        comp.x = origin ? origin.x : 0;
        comp.y = Math.round(Number.isFinite(below) ? below : STEP_TOP);
      } else {
        if (!shelf) {
          const bottom = origin ? cellsBottom(pages.cells) : pageBottom(pages.cells, comp);
          const y0 = origin ? Math.max(origin.y + CELLS_DY, bottom + 192) : Number.isFinite(bottom) ? bottom + 192 : 0;
          shelf = new Shelf(origin ? origin.x : 0, y0);
        }
        shelf.place(comp);
      }
      await this.breathe();
    }
    const gone = restore(lifted);
    if (gone.length) this.log("info", `${gone.length} component(s) were replaced; compile again`);
    if (single) await this.phase("labels", () => labelRegions(this.api, pages.cpu, STEP_FRAME));
    remember(this.api, where, origin ?? undefined);

    const cpu = findCell(pages.cpu, CPU_MODULE);
    const stats: BuildStats = {
      modules: order.length,
      drawn,
      reused,
      gates: flatten(lib, CPU_MODULE).gates.length,
      ms: this.now() - t0,
      cpuSize: { w: Math.round(cpu?.width ?? 0), h: Math.round(cpu?.height ?? 0) },
      page: single ? pages.cpu.name : "separate pages",
    };
    this.progress("build", order.length, order.length, "done");
    this.post({ type: "build", stats });
    this.log(
      "ok",
      `hardware on ${single ? `the page "${pages.cpu.name}"` : "pages Silicon · Gates / Cells / CPU"}: ${drawn} module(s) drawn, ${reused} reused, ${stats.gates} gates in cell/CPU (${(stats.ms / 1000).toFixed(1)} s)`,
    );
    try {
      if (cpu) this.api.viewport.scrollAndZoomIntoView([cpu]);
    } catch {
      /* cosmetic */
    }
    return stats;
  }

  // ---------- 2. front panel ----------

  async frontPanel(): Promise<ComponentNode> {
    const where = (await locate(this.api, { build: true }))!;
    const page = where.pages.cpu;
    await this.api.setCurrentPageAsync(page);
    const cpu = findCell(page, CPU_MODULE);
    const { comp, created } = await ensureFrontPanel(this.api, page, cpu ? this.panelSpot(cpu) : undefined);
    if (!created) {
      this.log("info", `the front panel already exists (delete "${comp.name}" to redraw it)`);
      return comp;
    }
    remember(this.api, where);
    // Already compiled: bind it right away; otherwise Compile binds it.
    let bound = 0;
    try {
      const s = await this.ensureSession();
      for (const [net, nodes] of panelLits(comp, s.net).wireLit)
        for (const node of nodes) {
          const ref = s.vars.get(net);
          if (ref) bindVisible(node, ref.v);
          else bindVisible(node, net === NET1);
          bound++;
        }
    } catch {
      /* not compiled yet */
    }
    this.log("ok", `front panel drawn (${Math.round(comp.width)}×${Math.round(comp.height)})${bound ? `, ${bound} lamps bound` : "; Compile binds its lamps"}`);
    try {
      this.api.viewport.scrollAndZoomIntoView([comp]);
    } catch {
      /* cosmetic */
    }
    return comp;
  }

  /** Left of the CPU's Step frame, top-aligned with it. */
  private panelSpot(cpu: ComponentNode) {
    return (w: number) => ({ x: cpu.x - 48 - 400 - w, y: cpu.y - STEP_TOP });
  }

  // ---------- 3. compile ----------

  /** Reads the circuit off the canvas (the source of truth) and builds the prototype. */
  async compile(source: string, o: CompileOptions = {}): Promise<CompileReport> {
    const bytes = assembleOrThrow(source);
    this.post({ type: "asm", errors: [] });
    this.clock.invalidate();
    this.session = null;
    const t0 = this.now();
    const steps = 6;
    this.progress("compile", 0, steps, "reading the circuit off the canvas");
    const { net, where } = await this.phase("extract", () => this.extractCpu());
    const tExtract = this.now();
    this.progress("compile", 1, steps, `compiling ${net.gates.length} gates`);
    await this.breathe();
    const schedule = await this.phase("compile", () => compile(net, { inputs: [] }));
    // Options pass straight through to lane F (chunking etc.); only the essentials are fixed.
    const chunk = o.maxActionsPerEvent ? { maxActionsPerEvent: o.maxActionsPerEvent } : {};
    const planOpts: Partial<PlanOptions> = { ...o.plan, ...chunk, ...(o.flat !== undefined ? { flat: o.flat } : {}) };
    const p = await this.phase("plan", () => this.plan(net, schedule, bytes, planOpts));
    const tCompile = this.now();

    this.progress("compile", 2, steps, "front panel and bindings");
    await this.breathe();
    const page = where.pages.cpu;
    await this.api.setCurrentPageAsync(page);
    const cpu = findCell(page, CPU_MODULE);
    if (!cpu) throw new Error(`no cell/CPU on the page "${page.name}": Build hardware first`);
    dismantleStepFrame(page, cpu);
    const { comp: panel } = await this.phase("front panel", () => ensureFrontPanel(this.api, page, this.panelSpot(cpu)));
    const lits = collectBindings(cpu, net);
    const pl = panelLits(panel, net);
    const wireLit = new Map(lits.wireLit);
    for (const [id, nodes] of pl.wireLit) wireLit.set(id, [...(wireLit.get(id) ?? []), ...nodes]);
    if (lits.missing.length) this.log("info", `${lits.missing.length} gate(s) have no lit layer, e.g. ${lits.missing.slice(0, 3).join(", ")}`);
    if (pl.missing.length) this.log("error", `front panel lamps with unknown nets: ${pl.missing.slice(0, 5).join(", ")}`);

    this.progress("compile", 3, steps, `variables for ${p.variables.length} nets, bindings, reactions`);
    await this.breathe();
    const applyOpts = {
      ...o.apply,
      ...chunk,
      ...(o.runDelayMs !== undefined ? { runDelayMs: o.runDelayMs } : {}),
      bindings: { gateLit: lits.gateLit, wireLit },
      display: panel,
      page,
      at: { x: Math.round(cpu.x - 48), y: Math.round(cpu.y + cpu.height + 400) },
      log: (m: string) => this.log("info", m),
    } as ApplyOptions;
    const res = await this.phase("apply", () => apply(this.api, p, applyOpts));
    const tApply = this.now();

    // The Step frame copies the controls apply() built (no reaction is built here).
    this.progress("compile", 5, steps, "CPU · Step frame");
    await this.breathe();
    const sf = await this.phase("Step frame", () =>
      buildStepFrame(this.api, page, cpu, res.frames.control, { title: TITLE, subtitle: subtitle(p, source), log: (m) => this.log("info", m) }),
    );
    try {
      setFlow(page, STEP_FRAME, sf.frame);
    } catch (e) {
      this.log("info", `could not add the "${STEP_FRAME}" flow: ${errText(e)}`);
    }
    if (where.single) await this.phase("labels", () => labelRegions(this.api, page, STEP_FRAME));

    this.session = await this.phase("variables", () => this.bindSession(net, schedule, p, source, planOpts));
    this.api.root.setPluginData(DOC_PROGRAM, source);
    remember(this.api, where);

    const stats: CompileStats = {
      gates: p.stats.gates,
      nets: net.netNames.length,
      variables: res.collections.reduce((n, c) => n + c.variableIds.length, 0),
      collections: res.collections.length,
      actionsPerTick: p.stats.actionsPerTick,
      actionsPerStep: res.actionsPerStep,
      lowPass: p.stats.lowPass,
      highPass: p.stats.highPass,
      maxDepth: p.stats.maxDepth,
      bound: res.bound,
      unbound: res.unbound,
      missingLits: lits.missing.length,
      panelLamps: pl.lamps,
      ms: { extract: tExtract - t0, compile: tCompile - tExtract, apply: tApply - tCompile, total: this.now() - t0 },
    };
    this.progress("compile", steps, steps, "done");
    this.post({ type: "compile", stats });
    this.log(
      "ok",
      `compiled ${programName(source)}: ${stats.gates} gates, ${stats.variables} variables, ${stats.actionsPerTick} actions/tick, ${stats.bound} lit layers bound (${(stats.ms.total / 1000).toFixed(1)} s). ▶ Present: flows "${STEP_FRAME}" and "${NAME}".`,
    );
    try {
      this.api.viewport.scrollAndZoomIntoView([sf.header]);
    } catch {
      /* cosmetic */
    }
    return { stats, plan: p, net, stepFrame: sf.frame, frames: res.frames };
  }

  // ---------- 4. load program ----------

  /** Writes the program's power-on state as the variables' values (no recompile), zeroes the
   * tick counters, and patches the power-on literals in the existing reactions (the Reset
   * buttons restore the power-on state as literals), whatever shape apply() gave them. */
  async loadProgram(source: string): Promise<{ writes: number; resets: number; literals: number; name: string }> {
    const t0 = this.now();
    const bytes = assembleOrThrow(source);
    this.post({ type: "asm", errors: [] });
    this.clock.invalidate();
    const s = await this.ensureSession(source);
    const old = new Map(s.plan.variables.map((v) => [v.net, v.init]));
    const p = this.plan(s.net, s.schedule, bytes, s.planOpts);
    let writes = 0;
    for (const v of p.variables) {
      const r = s.vars.get(v.net);
      if (!r) throw new Error(`no variable for ${v.name}: compile again`);
      if (r.v.valuesByMode[r.mode] !== v.init) {
        r.v.setValueForMode(r.mode, v.init);
        writes++;
      }
    }
    for (const t of s.ticks) writeCount(t, 0);

    // Nets whose power-on value can depend on the program: only their literals are patched,
    // so a tick's own literals (CLK = 0, constant gates) are never touched.
    const zeros = powerOnWith(s.net, []);
    const ones = powerOnWith(s.net, new Array(16).fill(0xff));
    const patch = new Map<string, boolean>();
    for (const v of p.variables) {
      const r = s.vars.get(v.net)!;
      if (v.init !== old.get(v.net) || zeros[v.net] !== ones[v.net]) patch.set(r.v.id, v.init);
    }
    let resets = 0;
    let literals = 0;
    let sub: SceneNode | null = null;
    const where = await locate(this.api);
    if (where) {
      const page = where.pages.cpu;
      await page.loadAsync();
      for (const node of this.reactionNodes(page)) {
        const r = patchLiterals(node.reactions, patch);
        if (!r.patched) continue;
        await node.setReactionsAsync(r.reactions);
        resets++;
        literals += r.patched;
      }
      sub = child(child(child(page, STEP_FRAME) as FrameNode | null, "header") as FrameNode | null, "subtitle");
    }
    if (sub && sub.type === "TEXT") {
      await loadFonts(this.api);
      sub.characters = subtitle(p, source);
    }
    s.plan = p;
    s.source = source;
    this.api.root.setPluginData(DOC_PROGRAM, source);
    const name = programName(source);
    this.log(
      "ok",
      `loaded ${name}: ${writes} variable(s) changed, ${literals} power-on literal(s) patched in ${resets} reaction(s) (${this.now() - t0} ms). Restart the prototype (R) to run it.`,
    );
    this.post({ type: "clock", status: this.clock.status() });
    return { writes, resets, literals, name };
  }

  /** Layers of the prototype frames that can carry reactions: the Control / Run frames and
   * their controls, the Step frame and its header (never the CPU drawing or instances). */
  private reactionNodes(page: PageNode): Array<SceneNode & ReactionMixin> {
    const out: Array<SceneNode & ReactionMixin> = [];
    const walk = (n: SceneNode, deep: boolean) => {
      if ("reactions" in n && n.reactions.length) out.push(n as SceneNode & ReactionMixin);
      if (!deep || n.type === "INSTANCE" || !("children" in n)) return;
      for (const c of n.children) walk(c, true);
    };
    for (const c of page.children) {
      if ([`${NAME} · Control`, `${NAME} · Run A`, `${NAME} · Run B`].includes(c.name)) walk(c, true);
      if (c.name === STEP_FRAME) {
        walk(c, false);
        const h = child(c as FrameNode, "header");
        if (h) walk(h, true);
      }
    }
    return out;
  }

  // ---------- 5. plugin clock: see PluginClock; the session it runs on ----------

  private async clockSession(): Promise<ClockSession> {
    const s = await this.ensureSession();
    const base = new Uint8Array(s.net.netNames.length);
    base[NET1] = 1;
    for (const v of s.plan.variables) base[v.net] = v.init ? 1 : 0;
    return { net: s.net, schedule: s.schedule, base, vars: s.vars, ticks: s.ticks, halt: s.plan.halt ?? -1 };
  }

  /** plan() for the CPU with `bytes` in RAM; `opts` pass through (chunking etc.). */
  private plan(net: FlatNetlist, schedule: CompiledSchedule, bytes: number[], opts: Partial<PlanOptions>): PrototypePlan {
    return plan(net, schedule, { ...opts, initial: powerOnWith(net, bytes), name: NAME, halt: PROBES.HALTED.name } as PlanOptions);
  }

  // ---------- 6. verify ----------

  /** Runs the circuit on the canvas against the ISA model for the program. */
  async verify(source: string, maxTicks = 2000): Promise<VerifyResult> {
    const bytes = assembleOrThrow(source);
    this.post({ type: "asm", errors: [] });
    const { net } = await this.phase("extract", () => this.extractCpu());
    const r = verifyAgainstModel(net, compile(net, { inputs: [] }), bytes, maxTicks);
    this.post({ type: "verify", ok: r.ok, text: `${programName(source)}: ${r.text}` });
    this.log(r.ok ? "ok" : "error", `verify ${programName(source)}: ${r.text}`);
    return r;
  }

  // ---------- shared ----------

  /** The circuit on the canvas, flattened, and where it is. */
  private async extractCpu(): Promise<{ net: FlatNetlist; where: Where }> {
    const where = await locate(this.api);
    if (!where) throw new Error("no hardware found (no cell/CPU): Build hardware first");
    const lib = await extract(uniquePages(where));
    if (!lib.has(CPU_MODULE)) throw new Error("no cell/CPU component on the canvas: Build hardware first");
    return { net: flatten(lib, CPU_MODULE), where };
  }

  /** The session of the last compile, or one rebuilt from the canvas and the existing
   * variables (after the plugin was closed and reopened). */
  private async ensureSession(source?: string): Promise<Session> {
    if (this.session) return this.session;
    const colls = (await this.api.variables.getLocalVariableCollectionsAsync()).filter((c) => isOurCollection(c.name));
    if (!colls.length) throw new Error(`no "${NAME}" variables yet: press Compile first`);
    const { net } = await this.phase("extract", () => this.extractCpu());
    const schedule = compile(net, { inputs: [] });
    const src = source ?? (this.api.root.getPluginData(DOC_PROGRAM) || PROGRAMS.mul);
    const p = this.plan(net, schedule, assembleOrThrow(src), {});
    this.session = await this.bindSession(net, schedule, p, src, {});
    return this.session;
  }

  /** Finds the plan's variables (by name) in the "CPU" collection(s). */
  private async bindSession(net: FlatNetlist, schedule: CompiledSchedule, p: PrototypePlan, source: string, planOpts: Partial<PlanOptions>): Promise<Session> {
    const colls = (await this.api.variables.getLocalVariableCollectionsAsync()).filter((c) => isOurCollection(c.name));
    if (!colls.length) throw new Error(`no "${NAME}" variables: press Compile`);
    const modeOf = new Map(colls.map((c) => [c.id, c.defaultModeId]));
    const byName = new Map<string, Variable>();
    for (const v of await this.api.variables.getLocalVariablesAsync()) if (modeOf.has(v.variableCollectionId)) byName.set(v.name, v);
    const ref = (v: Variable): VarRef => ({ v, mode: modeOf.get(v.variableCollectionId)! });
    const vars = new Map<number, VarRef>();
    const missing: string[] = [];
    for (const pv of p.variables) {
      const v = byName.get(pv.name) ?? byName.get(safeName(pv.name));
      if (v) vars.set(pv.net, ref(v));
      else missing.push(pv.name);
    }
    if (missing.length)
      throw new Error(`the circuit on the canvas does not match the "${NAME}" variables (${missing.length} nets without a variable, e.g. ${missing.slice(0, 3).join(", ")}): press Compile`);
    const ticks = [...byName.values()].filter((v) => v.name.startsWith(TICKS_PREFIX)).map(ref);
    return { net, schedule, plan: p, vars, ticks, source, planOpts };
  }

  /** Stops the clock (plugin closing). */
  dispose(): void {
    this.clock.pause();
  }
}

/** A copy of `reactions` in which every SET_VARIABLE of a BOOLEAN literal on a variable in
 * `values` gets that value. Returns how many literals changed. */
export function patchLiterals(reactions: readonly Reaction[], values: Map<string, boolean>): { reactions: Reaction[]; patched: number } {
  const copy = JSON.parse(JSON.stringify(reactions)) as Array<Reaction & { action?: Action }>;
  let patched = 0;
  const walk = (acts: Action[]) => {
    for (const a of acts) {
      if (a.type === "SET_VARIABLE" && a.variableId && a.variableValue?.type === "BOOLEAN" && values.has(a.variableId)) {
        const want = values.get(a.variableId)!;
        if (a.variableValue.value !== want) {
          (a.variableValue as { value: boolean }).value = want;
          patched++;
        }
      }
      if (a.type === "CONDITIONAL") for (const b of a.conditionalBlocks) walk(b.actions as Action[]);
    }
  };
  for (const r of copy) {
    if (r.actions) {
      delete r.action;
      walk(r.actions as Action[]);
    } else if (r.action) walk([r.action]);
  }
  return { reactions: copy, patched };
}

/** Sets a tick counter to `n` in its own type (FLOAT, or STRING for a text binding). */
export function writeCount(t: VarRef, n: number): void {
  if (t.v.resolvedType === "FLOAT") t.v.setValueForMode(t.mode, n);
  else if (t.v.resolvedType === "STRING") t.v.setValueForMode(t.mode, String(n));
}

function subtitle(p: PrototypePlan, source: string): string {
  return `${p.stats.gates} gates · ${p.variables.length} wires (variables) · ${p.stats.actionsPerTick} actions per Step · program: ${programName(source)}`;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
