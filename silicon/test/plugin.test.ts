// Lane G: the FigmaCPU Silicon plugin, end to end against the fake Figma API. One document,
// one session, like a user clicking through the panel: Build hardware → Front panel →
// Compile (from the circuit extracted off the canvas) → Load program → run the exact Step
// reaction JSON through lane F's emulator → plugin clock → Verify. The main document is a
// Starter-plan file (createPage throws), so everything must live on one page.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NAME, SiliconApp } from "../plugin/src/app";
import { redirect, STEP_FRAME } from "../plugin/src/canvas";
import type { ToUi } from "../plugin/src/messages";
import { PANEL_NAME, panelLits } from "../plugin/src/panel";
import { verifyAgainstModel } from "../plugin/src/program";
import { locate, SINGLE_PAGE } from "../plugin/src/where";
import { compile } from "../src/compile";
import { cpuNetlist, PROBES, ramBit } from "../src/cpu";
import { PAGE_CELLS, PAGE_CPU, PAGE_GATES, propName } from "../src/figma";
import { resetFonts } from "../src/figma/style";
import { assemble, PROGRAMS } from "../src/isa";
import { runFigmaActions, type FigmaValue, varName } from "../src/prototype";
import { FakeFigma, type FakeNode } from "./fake-figma";

const STARTER = "in createPage: The Starter plan only comes with 3 pages. Upgrade to Professional for unlimited pages.";

/** A fake of a Starter-plan file: one page, and createPage throws like Figma does. */
function starterFigma(pages = ["Page 1"]): FakeFigma {
  const fig = new FakeFigma(pages);
  fig.createPage = () => {
    throw new Error(STARTER);
  };
  return fig;
}

function install(fig: FakeFigma) {
  (globalThis as unknown as { figma: FakeFigma }).figma = fig;
  resetFonts();
}

const asApi = (f: FakeFigma) => f as unknown as PluginAPI;
const fk = (n: unknown) => n as FakeNode;
const kid = (n: FakeNode | null | undefined, name: string) => n?.children.find((c) => c.name === name) ?? null;
const onClick = (n: FakeNode | null) => {
  const r = n?.reactions.find((x) => x.trigger?.type === "ON_CLICK");
  if (!r?.actions) throw new Error(`${n?.name}: no ON_CLICK reaction`);
  return r.actions;
};

/** Top-level nodes of a page whose bounding boxes intersect. */
function overlaps(page: FakeNode): string[] {
  const ns = page.children;
  const out: string[] = [];
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) {
      const [a, b] = [ns[i], ns[j]];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) out.push(`${a.name} × ${b.name}`);
    }
  return out;
}

const isDescendant = (n: FakeNode, ancestor: FakeNode) => {
  for (let p = n.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
};

/** The variable of a net, by any of its hierarchical names (variables are named after the
 * net's shallowest name, e.g. a RAM bit is not called ram/row0/b0/Q). */
const CPU_NET = cpuNetlist();
function varOf(fig: FakeFigma, netName: string) {
  const id = CPU_NET.aliases.get(netName);
  if (id === undefined) throw new Error(`no net ${netName}`);
  return fig.variableNamed(NAME, varName(CPU_NET.netNames[id]));
}

/** The tick counter in `vals` (the first ctl/tick… variable: FLOAT, or STRING for a text). */
function ticksIn(fig: FakeFigma, vals: Map<string, FigmaValue>): number {
  const v = [...fig.variableById.values()].find((x) => x.collection.name.startsWith(NAME) && x.name.startsWith("ctl/tick"));
  if (!v) throw new Error("no tick counter variable");
  return Number(vals.get(v.id));
}

/** One clock tick in the prototype: Step events until the tick counter moves. That is one
 * event for a single-reaction Step, several when lane F splits a tick into chunks (one chunk
 * per event). Returns the number of events. */
function tickOnce(fig: FakeFigma, step: readonly Action[], vals: Map<string, FigmaValue>): number {
  const t = ticksIn(fig, vals);
  for (let e = 1; e <= 64; e++) {
    runFigmaActions(step, vals);
    if (ticksIn(fig, vals) !== t) return e;
  }
  throw new Error("the tick counter never moved");
}

/** Text layers bound to a non-STRING variable (real Figma refuses those bindings). */
function badTextBindings(fig: FakeFigma, roots: FakeNode[]): string[] {
  const out: string[] = [];
  for (const r of roots)
    for (const n of [r, ...r.findAll((x) => x.type === "TEXT")]) {
      const id = n.boundVariables.characters?.id;
      const v = id ? fig.variableById.get(id) : undefined;
      if (id && v?.resolvedType !== "STRING") out.push(`${n.name} → ${v?.resolvedType}`);
    }
  return out;
}

/** A probe read from the variables. */
function probeFromVars(fig: FakeFigma, vals: Map<string, FigmaValue>, key: string): number {
  const p = PROBES[key];
  let v = 0;
  for (let i = 0; i < p.width; i++) if (vals.get(varOf(fig, p.width === 1 ? p.name : `${p.name}[${i}]`).id) === true) v |= 1 << i;
  return v;
}

describe("plugin on a Starter-plan file (one page; createPage throws)", () => {
  const fig = starterFigma();
  const msgs: ToUi[] = [];
  let app: SiliconApp;
  let page: FakeNode;
  const logs = (level?: string) => msgs.filter((m): m is Extract<ToUi, { type: "log" }> => m.type === "log" && (!level || m.level === level)).map((m) => m.text);

  beforeAll(() => {
    install(fig);
    app = new SiliconApp(asApi(fig), (m) => msgs.push(m), { yield: async () => {}, clockFrameMs: 0 });
    page = fig.root.children[0];
    // The user's own design is already on the page: the silicon must go next to it, not on it.
    const mine = fig.createFrame();
    mine.name = "My design";
    mine.resize(1200, 800);
  });

  it("Build hardware: gates, every cell and cell/CPU on the current page, in regions, with progress", async () => {
    const t0 = performance.now();
    const stats = await app.build({ gateLabels: true });
    const ms = Math.round(performance.now() - t0);
    expect(fig.root.children.map((p) => p.name)).toEqual(["Page 1"]); // no page was created
    expect(stats).toMatchObject({ modules: 33, drawn: 33, reused: 0, gates: cpuNetlist().gates.length, page: "Page 1" });
    const comps = page.children.filter((n) => n.type === "COMPONENT");
    expect(comps.filter((n) => n.name.startsWith("gate/")).length).toBe(8);
    expect(comps.filter((n) => n.name.startsWith("cell/")).length).toBe(33);
    const progress = msgs.filter((m): m is Extract<ToUi, { type: "progress" }> => m.type === "progress" && m.task === "build");
    expect(progress.length).toBeGreaterThanOrEqual(34);
    expect(progress.map((p) => p.label)).toContain("ALU");
    expect(progress[progress.length - 1]).toMatchObject({ done: 33, total: 33 });
    // Regions: below the user's design, gates above cells above the CPU, nothing overlapping.
    const cpu = kid(page, "cell/CPU")!;
    const cells = comps.filter((n) => n.name.startsWith("cell/") && n !== cpu);
    const gates = comps.filter((n) => n.name.startsWith("gate/"));
    expect(Math.min(...gates.map((g) => g.y))).toBeGreaterThan(800);
    expect(Math.max(...gates.map((g) => g.y + g.height))).toBeLessThan(Math.min(...cells.map((c) => c.y)));
    expect(Math.max(...cells.map((c) => c.y + c.height))).toBeLessThan(cpu.y - 264);
    expect(page.children.filter((n) => n.name.startsWith("silicon/label/")).map((n) => n.name)).toEqual([
      "silicon/label/Gates",
      "silicon/label/Cells",
      "silicon/label/CPU",
    ]);
    expect(overlaps(page)).toEqual([]);
    const cpuLayers = cpu.findAll().length;
    console.log(`[plugin] build: ${fig.allNodes().length} layers in the document (cell/CPU ${cpuLayers}), ${Math.round(cpu.width)}×${Math.round(cpu.height)} px, ${ms} ms in the fake`);
  });

  it("Front panel: 7-segment digits and probe lamps, created once, left of the CPU", async () => {
    const comp = fk(await app.frontPanel());
    expect(comp.name).toBe(PANEL_NAME);
    expect(comp.parent).toBe(page);
    const net = cpuNetlist();
    const lits = panelLits(comp as unknown as ComponentNode, net);
    const lampBits = ["OUT", "BUS", "IR", "PC", "T", "R0", "R1", "R2", "R3", "Z", "C", "N", "HALTED"].reduce((n, k) => n + PROBES[k].width, 0);
    expect(lits.missing).toEqual([]);
    expect(lits.lamps).toBe(lampBits + 14); // + 2 digits × 7 segments
    for (const k of ["SEG_LO[0]", "SEG_HI[6]", "pc[3]", "flag_z", "halted", "OUT[7]", "bus[0]", "t[2]"]) expect(lits.wireLit.has(net.aliases.get(k)!), k).toBe(true);
    expect(comp.findAll().length).toBeLessThan(400); // small: it is instanced into every frame
    const cpu = kid(page, "cell/CPU")!;
    expect(comp.x + comp.width).toBeLessThan(cpu.x - 48);
    expect(fk(await app.frontPanel())).toBe(comp);
    expect(page.children.filter((n) => n.name === PANEL_NAME).length).toBe(1);
    expect(overlaps(page)).toEqual([]);
  });

  it("Compile: canvas → variables, lit bindings, Step / Run / Reset, and the CPU · Step frame", async () => {
    const t0 = performance.now();
    const r = await app.compile(PROGRAMS.count);
    const ms = Math.round(performance.now() - t0);
    // The compiled circuit is the one read off the canvas, and it is the CPU.
    const ref = cpuNetlist();
    expect(r.net.gates).toEqual(ref.gates);
    expect(r.net.netNames).toEqual(ref.netNames);
    const s = r.stats;
    expect(s.gates).toBe(ref.gates.length);
    expect(s.variables).toBe(fig.collections.reduce((n, c) => n + c.vars.length, 0));
    expect(s.variables).toBeGreaterThan(r.plan.variables.length);
    expect(s.actionsPerTick).toBe(compile(ref, { inputs: [] }).stats.actionsPerTick + 2);
    expect(s.actionsPerStep).toBeGreaterThan(0);
    expect(s).toMatchObject({ collections: 1, missingLits: 0, unbound: 0 });
    expect(s.panelLamps).toBe(panelLits(fk(kid(page, PANEL_NAME)) as unknown as ComponentNode, ref).lamps);
    expect(fig.collections.map((c) => `${c.name}:${c.vars.length}`)).toEqual([`${NAME}:${s.variables}`]);

    // The Step frame holds the CPU main component itself, the front panel and the buttons.
    const frame = kid(page, STEP_FRAME)!;
    const cpu = page.findAll((n) => n.type === "COMPONENT" && n.name === "cell/CPU");
    expect(cpu.length).toBe(1);
    expect(cpu[0].parent).toBe(frame);
    const header = kid(frame, "header")!;
    expect(header.children.some((n) => n.type === "INSTANCE" && n.name === PANEL_NAME)).toBe(true);
    // Its controls are copies of the ones apply() built in the Control frame: same reactions
    // (navigation back to Control redirected here), same frame-level triggers. None hand-built.
    const control = kid(page, `${NAME} · Control`)!;
    const buttons = control.children.filter((n) => n.name.startsWith("button/"));
    expect(buttons.map((b) => b.name)).toEqual(expect.arrayContaining(["button/Step", "button/Run", "button/Reset"]));
    for (const b of buttons) expect(kid(header, b.name)!.reactions, b.name).toEqual(redirect(b.reactions, control.id, frame.id));
    expect(frame.reactions).toEqual(redirect(control.reactions, control.id, frame.id));
    expect(onClick(kid(header, "button/Step")).length).toBe(s.actionsPerStep);
    expect(page.flowStartingPoints.map((f) => f.name).sort()).toEqual([NAME, STEP_FRAME].sort());
    // No text is bound to a FLOAT (Figma refuses it); the front panel binds no text at all.
    const roots = [frame, control, kid(page, `${NAME} · Run A`)!, kid(page, `${NAME} · Run B`)!];
    expect(badTextBindings(fig, [...roots.slice(1), header])).toEqual([]);
    expect(fk(kid(page, PANEL_NAME))!.findAll((n) => !!n.boundVariables.characters)).toEqual([]);

    // Every gate's lit layer inside cell/CPU and the panel lamps are bound to CPU variables.
    const gateLits = cpu[0].findAll((n) => n.name === "lit" && n.parent?.type === "INSTANCE" && n.parent.name !== PANEL_NAME);
    expect(gateLits.length).toBe(ref.gates.length);
    for (const l of gateLits) expect(fig.variableById.get(l.boundVariables.visible?.id)?.collection.name).toBe(NAME);
    const lamp = fk(kid(page, PANEL_NAME))!.findOne((n) => n.name === "lamp/OUT[0]")!;
    expect(kid(lamp, "lit")!.boundVariables.visible.id).toBe(varOf(fig, "OUT[0]").id);
    expect(overlaps(page)).toEqual([]);
    console.log(
      `[plugin] compile: ${s.gates} gates, ${s.variables} variables, ${s.actionsPerTick} actions/tick (${s.actionsPerStep} per Step), ${s.bound} lit layers bound, ${ms} ms in the fake`,
    );
  });

  it("Load program (mul) → the compiled Step reaction, emulated, reaches OUT = 42 and HALTED at tick 162", async () => {
    const res = await app.loadProgram(PROGRAMS.mul);
    expect(res).toMatchObject({ name: "mul", resets: 2 }); // the Reset buttons of Control and Step
    expect(res.writes).toBeGreaterThan(0);
    expect(res.literals).toBeGreaterThan(0);
    const vals = fig.variableValues();
    // The RAM latches now hold mul.
    const bytes = assemble(PROGRAMS.mul).bytes;
    for (let addr = 0; addr < 16; addr++)
      for (let bit = 0; bit < 8; bit++)
        expect(vals.get(varOf(fig, ramBit(addr, bit)).id), `RAM ${addr}.${bit}`).toBe(((bytes[addr] >> bit) & 1) === 1);

    const header = kid(kid(page, STEP_FRAME), "header");
    expect(kid(header, "subtitle")!.characters).toMatch(/program: mul$/);
    const step = onClick(kid(header, "button/Step"));
    const t0 = performance.now();
    let events = 0;
    for (let t = 1; t <= 162; t++) {
      events += tickOnce(fig, step, vals);
      if (t === 161) expect(probeFromVars(fig, vals, "HALTED"), "halted early").toBe(0);
    }
    const perTick = (performance.now() - t0) / 162;
    expect(probeFromVars(fig, vals, "OUT")).toBe(42);
    expect(probeFromVars(fig, vals, "HALTED")).toBe(1);
    expect(probeFromVars(fig, vals, "R0")).toBe(42);
    expect(ticksIn(fig, vals)).toBe(162);
    console.log(`[plugin] emulated Step: ${step.length} actions per event, ${events / 162} event(s) per tick, ${perTick.toFixed(1)} ms per tick in the emulator`);

    // Reset (rewritten for mul) restores the power-on state exactly.
    runFigmaActions(onClick(kid(header, "button/Reset")), vals);
    expect([...vals]).toEqual([...fig.variableValues()]);
  });

  it("the Control frame's Run loop runs mul until HALTED and returns to Control", async () => {
    const vals = fig.variableValues();
    const control = kid(page, `${NAME} · Control`)!;
    let at = control.id;
    const hooks = { navigate: (d: string | null) => void (at = d!) };
    runFigmaActions(onClick(kid(control, "button/Run")), vals, hooks);
    let frames = 0;
    while (at !== control.id && frames < 400) {
      const f = fig.nodeById(at)!;
      runFigmaActions(f.reactions.find((x) => x.trigger?.type === "AFTER_TIMEOUT")!.actions!, vals, hooks);
      frames++;
    }
    expect(at).toBe(control.id);
    expect(ticksIn(fig, vals)).toBe(162);
    expect(probeFromVars(fig, vals, "OUT")).toBe(42);
    expect(vals.get(fig.variableNamed(NAME, "ctl/running").id)).toBe(false);
  });

  it("Plugin clock: FastSim from the variables, writes only what changed, reaches the same OUT = 42 / HALTED", async () => {
    const before = fig.variableValues();
    const w0 = fig.variableWrites;
    const st = await app.clock.step(1);
    expect(st.ticks).toBe(1);
    const after = fig.variableValues();
    const changed = [...after].filter(([id, v]) => before.get(id) !== v).length;
    expect(changed).toBeGreaterThan(0);
    expect(fig.variableWrites - w0).toBe(changed); // every write changed a value (ticks included)
    expect(st.writes).toBe(changed - 1);

    const w1 = fig.variableWrites;
    await app.clock.run(0);
    const s = app.clock.status();
    expect(s).toMatchObject({ running: false, halted: true, ticks: 162 });
    expect(s.probes).toMatchObject({ OUT: 42, HALTED: 1, R0: 42 });
    const vals = fig.variableValues();
    expect(probeFromVars(fig, vals, "OUT")).toBe(42);
    expect(probeFromVars(fig, vals, "HALTED")).toBe(1);
    expect(ticksIn(fig, vals)).toBe(162);
    expect(fig.variableWrites - w1).toBeLessThan(fig.variableById.size); // a diff, not a full rewrite
    // Halted is frozen; a slow run stops at once.
    await app.clock.run(5);
    expect(app.clock.status().ticks).toBe(162);
    const clockMsgs = msgs.filter((m) => m.type === "clock");
    expect(clockMsgs.length).toBeGreaterThan(0);
  });

  it("Plugin clock at a finite speed ticks in frames and pauses", async () => {
    await app.loadProgram(PROGRAMS.count);
    const run = app.clock.run(1000);
    await vi.waitFor(() => expect(app.clock.status().ticks).toBeGreaterThan(3), { timeout: 2000, interval: 5 });
    app.clock.pause();
    await run;
    const t = app.clock.status().ticks;
    expect(app.clock.status().running).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(app.clock.status().ticks).toBe(t);
    // Pause + Run in quick succession, then Load while running: one loop at a time, no errors.
    const a = app.clock.run(1000);
    app.clock.pause();
    const b = app.clock.run(1000);
    await vi.waitFor(() => expect(app.clock.status().ticks).toBeGreaterThan(t + 2), { timeout: 2000, interval: 5 });
    await app.loadProgram(PROGRAMS.mul); // invalidates the running clock
    await Promise.all([a, b]);
    expect(app.clock.isRunning).toBe(false);
    expect(logs("error")).toEqual([]);
    const vals = fig.variableValues();
    expect(probeFromVars(fig, vals, "PC")).toBe(0); // the power-on state of mul, not overwritten by a stale loop
    expect(ticksIn(fig, vals)).toBe(0);
  });

  it("Verify: the canvas CPU matches the ISA model; editing the canvas is caught", async () => {
    const ok = await app.verify(PROGRAMS.mul);
    expect(ok.ok).toBe(true);
    expect(ok.text).toBe("✓ matches the ISA model for 165 ticks (halted at tick 162, OUT = 42 = 0x2A)");
    expect(msgs.some((m) => m.type === "verify" && m.ok)).toBe(true);
    for (const name of ["fib", "count", "sub", "logic", "mem"]) expect((await app.verify(PROGRAMS[name], 700)).ok, name).toBe(true);

    // Swap two bits of the output register's input on the canvas: the machine changes.
    const cpu = page.findAll((n) => n.name === "cell/CPU" && n.type === "COMPONENT")[0];
    const outreg = kid(cpu, "outreg")!;
    const key = Object.keys(outreg.componentProperties).find((k) => propName(k) === "D")!;
    expect(outreg.componentProperties[key].value).toBe("mdr[0:7]");
    outreg.setProperties({ [key]: "mdr[1], mdr[0], mdr[2:7]" });
    const bad = await app.verify(PROGRAMS.mul);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/^✗ tick \d+ \(ST T\d.*\): OUT gate 41 ≠ model 42/);
    outreg.setProperties({ [key]: "mdr[0:7]" });
    expect((await app.verify(PROGRAMS.mul)).ok).toBe(true);
  });

  it("re-compile (options passed through to plan/apply) and re-build are idempotent", async () => {
    await app.compile(PROGRAMS.mul);
    expect(fig.collections.map((c) => c.name)).toEqual([NAME]);
    // plan() / apply() options pass straight through: flat expressions, collection size, delay.
    const plain = (await app.compile(PROGRAMS.mul)).stats.actionsPerTick;
    const r = await app.compile(PROGRAMS.mul, { runDelayMs: 7, maxActionsPerEvent: 600, plan: { flat: true }, apply: { maxPerCollection: 1500 } });
    expect(r.stats.actionsPerTick).toBeGreaterThan(plain);
    expect(fig.collections.map((c) => c.name)).toEqual([NAME, `${NAME} · 2`]);
    expect(kid(page, `${NAME} · Run A`)!.reactions[0].trigger).toEqual({ type: "AFTER_TIMEOUT", timeout: 7 });
    for (const n of [STEP_FRAME, `${NAME} · Control`, `${NAME} · Run A`, `${NAME} · Run B`, PANEL_NAME]) expect(page.children.filter((c) => c.name === n).length, n).toBe(1);
    expect(page.flowStartingPoints.length).toBe(2);

    const stats = await app.build({ gateLabels: true });
    expect(stats).toMatchObject({ drawn: 0, reused: 33 });
    const cpu = page.findAll((n) => n.name === "cell/CPU" && n.type === "COMPONENT");
    expect(cpu.length).toBe(1);
    expect(cpu[0].parent?.name).toBe(STEP_FRAME);
    expect(page.children.filter((n) => n.name.startsWith("silicon/label/")).length).toBe(3);
    expect(overlaps(page)).toEqual([]);
    expect((await app.verify(PROGRAMS.mul)).ok).toBe(true);
    expect(fig.root.children.length).toBe(1);
  });

  it("a new session (plugin reopened) attaches to the existing variables: Load + clock without recompiling", async () => {
    const msgs2: ToUi[] = [];
    const app2 = new SiliconApp(asApi(fig), (m) => msgs2.push(m), { yield: async () => {}, clockFrameMs: 0 });
    expect(await app2.status()).toMatchObject({ hardware: true, panel: true, compiled: true, program: "mul", page: "Page 1" });
    expect((await app2.loadProgram(PROGRAMS.mul)).literals).toBe(0); // already loaded: nothing to patch
    expect(await app2.loadProgram(PROGRAMS.count)).toMatchObject({ name: "count", resets: 2 });
    expect(await app2.loadProgram(PROGRAMS.mul)).toMatchObject({ name: "mul", resets: 2 });
    await app2.clock.run(0);
    expect(app2.clock.status().probes).toMatchObject({ OUT: 42, HALTED: 1 });
  });

  it("panel messages: errors are reported in the log, never thrown", async () => {
    msgs.length = 0;
    await app.handle({ type: "load", source: "LDI R9, 300" });
    expect(msgs.some((m) => m.type === "asm" && m.errors.length > 0)).toBe(true);
    expect(logs("error").some((t) => t.startsWith("Load program failed: assembler"))).toBe(true);
    await app.handle({ type: "init" });
    expect(msgs.some((m) => m.type === "hello")).toBe(true);
    expect(msgs.filter((m) => m.type === "busy").map((m) => (m as { task: string | null }).task)).toEqual(["Load program", null]);
  });
});

describe("where the silicon goes", () => {
  it("separate pages on a Starter file: falls back to the current page and leaves no pages behind", async () => {
    // One page exists; Figma allows two more, then refuses the third.
    const fig = new FakeFigma(["Page 1"]);
    install(fig);
    const create = fig.createPage.bind(fig);
    let made = 0;
    fig.createPage = () => {
      if (++made > 2) throw new Error(STARTER);
      return create();
    };
    const log: string[] = [];
    const w = await locate(asApi(fig), { build: true, separate: true, log: (m) => log.push(m) });
    expect(w?.single).toBe(true);
    expect(w?.pages.cpu).toBe(fig.currentPage);
    expect(fig.root.children.map((p) => p.name)).toEqual(["Page 1"]);
    expect(log[0]).toMatch(/separate pages are not available \(in createPage: The Starter plan only comes with 3 pages/);
  });

  it("finds nothing on an empty file, and prefers an existing page named Silicon", async () => {
    const empty = starterFigma(["Page 1"]);
    install(empty);
    expect(await locate(asApi(empty))).toBeNull();
    expect((await locate(asApi(empty), { build: true }))?.pages.cpu).toBe(empty.currentPage);
    const fig = starterFigma(["Page 1", SINGLE_PAGE]);
    install(fig);
    for (const w of [await locate(asApi(fig)), await locate(asApi(fig), { build: true, separate: true })]) {
      expect(w?.pages.cells.name).toBe(SINGLE_PAGE);
      expect(w?.single).toBe(true);
    }
  });

  it("separate pages when Figma allows them: build, compile and verify across Gates / Cells / CPU", async () => {
    const fig = new FakeFigma(["Page 1"]);
    install(fig);
    const msgs: ToUi[] = [];
    const app = new SiliconApp(asApi(fig), (m) => msgs.push(m), { yield: async () => {} });
    const stats = await app.build({ separatePages: true, gateLabels: false });
    expect(stats).toMatchObject({ drawn: 33, page: "separate pages" });
    expect(fig.root.children.map((p) => p.name)).toEqual(["Page 1", PAGE_GATES, PAGE_CELLS, PAGE_CPU]);
    const cpuPage = fig.root.children[3];
    expect(cpuPage.children.map((n) => n.name)).toEqual(["cell/CPU"]);
    await app.compile(PROGRAMS.mul);
    expect(kid(cpuPage, STEP_FRAME)).not.toBeNull();
    expect(overlaps(cpuPage)).toEqual([]);
    expect((await app.verify(PROGRAMS.mul)).ok).toBe(true);
    // A second build finds the same pages again.
    expect((await app.build({ separatePages: true })).reused).toBe(33);
  });
});

describe("verifyAgainstModel", () => {
  it("reports the first mismatch with the instruction and T-state", () => {
    const net = cpuNetlist();
    const sched = compile(net, { inputs: [] });
    const bytes = assemble(PROGRAMS.mul).bytes;
    expect(verifyAgainstModel(net, sched, bytes).ok).toBe(true);
    // A schedule that never evaluates the HIGH pass cannot match the model.
    const broken = { ...sched, passes: [sched.passes[0], { clk: 1 as const, order: [] }] as typeof sched.passes };
    const r = verifyAgainstModel(net, broken, bytes);
    expect(r.ok).toBe(false);
    expect(r.mismatch?.tick).toBe(1);
    expect(r.text).toMatch(/^✗ tick 1 \(NOP T0, PC=0\)/);
  });
});

describe("plugin entry (main.ts)", () => {
  it("opens the panel, answers init and reports errors in the log", async () => {
    const fig = starterFigma();
    install(fig);
    const posted: ToUi[] = [];
    const ui = { postMessage: (m: ToUi) => void posted.push(m), onmessage: null as null | ((m: unknown) => void) };
    let shown: unknown = null;
    Object.assign(fig, { showUI: (html: string, opts: unknown) => void (shown = { html, opts }), ui, on: () => {} });
    (globalThis as unknown as { __html__: string }).__html__ = "<html></html>";
    vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../plugin/src/main");
    expect(shown).toMatchObject({ html: "<html></html>" });
    ui.onmessage!({ type: "init" });
    await vi.waitFor(() => expect(posted.find((m) => m.type === "hello")).toMatchObject({ status: { hardware: false, compiled: false, page: null } }));
    ui.onmessage!({ type: "compile", source: PROGRAMS.mul });
    await vi.waitFor(() =>
      expect(posted.some((m) => m.type === "log" && m.level === "error" && /Compile failed: extract: no hardware found/.test(m.text))).toBe(true),
    );
    vi.restoreAllMocks();
  });
});
