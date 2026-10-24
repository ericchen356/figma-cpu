// Lane L2: the native Present-mode runtime of FigmaCPU Live (src/prototype/live.ts), end to end against the
// fake Figma API. The real CPU is compiled and applied, a minimal fake dashboard (a component with the layer
// names of docs/LIVE.md §2) is wired, and then the exact reaction JSON is replayed with the strict emulator,
// like a viewer in Present mode: clicks and hovers on the layers INSIDE the instance of the frame on screen
// (they inherit the component's reactions), AFTER_TIMEOUT hops on the frame, NAVIGATE moving between frames.
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorst, type RestAction } from "../src/audit/audit";
import { counterNetlist } from "../spike/src/circuits";
import { compile, type CompiledSchedule, FastSim, powerOn } from "../src/compile";
import { cpuNetlist, PROBES } from "../src/cpu";
import { PROGRAMS } from "../src/isa";
import { netId } from "../src/netlist/flatten";
import type { FlatNetlist } from "../src/netlist/types";
import {
  apply,
  type ApplyResult,
  asmListing,
  cpuPrograms,
  type FigmaValue,
  LIVE_LOCK,
  liveFrameNames,
  type LiveOptions,
  type LiveProgram,
  type LiveResult,
  plan,
  type PrototypePlan,
  runFigmaActions,
  wireLive,
} from "../src/prototype";
import { nestedConditional } from "../src/prototype/figma-actions";
import { FakeFigma, type FakeNode } from "./fake-figma";

const CAP = 400;
const PAD = 16;
const DISKS = ["mul", "fib", "count", "pow2"];

const asApi = (f: FakeFigma) => f as unknown as PluginAPI;
const fk = (n: unknown) => n as FakeNode;

/** A minimal stand-in for lane L1's dashboard: a component with the named layers wireLive looks for, plus
 * a decoy: a nested button instance whose inner layer is also called ctl/step (must not be wired). */
function fakeDashboard(f: FakeFigma, o: { padCell?: FakeNode; disks?: string[] } = {}): FakeNode {
  const comp = f.createComponent();
  comp.name = "Live · Dashboard";
  comp.resize(1920, 1200);
  comp.x = 0;
  comp.y = -1600;
  const add = (parent: FakeNode, name: string, x: number, y: number, w = 120, h = 40) => {
    const n = f.createFrame();
    n.name = name;
    n.resize(w, h);
    parent.appendChild(n);
    n.x = x;
    n.y = y;
    return n;
  };
  ["ctl/step", "ctl/run", "ctl/stop", "ctl/reset"].forEach((n, i) => add(comp, n, 24 + i * 140, 24));
  const pad = add(comp, "ctl/pad", 24, 100, PAD * 40, 40);
  for (let i = 0; i < PAD; i++) {
    if (o.padCell) {
      const cell = o.padCell.createInstance();
      cell.name = `ctl/pad/${i}`;
      pad.appendChild(cell);
      cell.x = i * 40;
    } else add(pad, `ctl/pad/${i}`, i * 40, 0, 40, 40);
  }
  (o.disks ?? DISKS).forEach((d, i) => add(comp, `disk/${d}`, 24 + i * 140, 180));
  add(comp, "disk/nonesuch", 24, 240); // a disk without a program: left unwired
  const btn = f.createComponent();
  btn.name = "button";
  add(btn, "ctl/step", 0, 0); // decoy inside a nested instance
  const decoy = btn.createInstance();
  comp.appendChild(decoy);
  decoy.x = 1500;
  return comp;
}

interface World {
  f: FakeFigma;
  net: FlatNetlist;
  sched: CompiledSchedule;
  p: PrototypePlan;
  res: ApplyResult;
  comp: FakeNode;
  disks: LiveProgram[];
  live: LiveResult;
  logs: string[];
}

async function build(o: LiveOptions = {}, dash: { padCell?: boolean } = {}): Promise<World> {
  const f = new FakeFigma();
  const net = cpuNetlist();
  const sched = compile(net, { inputs: [] });
  const disks = cpuPrograms(net, PROGRAMS);
  const mul = disks.find((d) => d.name === "mul")!;
  const p = plan(net, sched, { initial: mul.initial as Uint8Array, name: "CPU", halt: PROBES.HALTED.name });
  const res = await apply(asApi(f), p, { maxActionsPerEvent: CAP });
  let padCell: FakeNode | undefined;
  if (dash.padCell) {
    padCell = f.createComponent();
    padCell.name = "ctl/pad/cell";
    padCell.resize(40, 40);
    padCell.y = -2000;
  }
  const comp = fakeDashboard(f, { padCell });
  const logs: string[] = [];
  const live = await wireLive(asApi(f), p, res, comp as unknown as ComponentNode, disks, {
    ...o,
    ...(padCell ? { padCell: padCell as unknown as ComponentNode } : {}),
    log: (m) => logs.push(m),
  });
  return { f, net, sched, p, res, comp, disks, live, logs };
}

/** Present mode: the frame on screen, its instance's layers, events and hops (each within the cap). */
class Player {
  at: string;
  events: number[] = [];
  navigations = 0;
  readonly vals: Map<string, FigmaValue>;
  constructor(readonly w: World) {
    this.vals = w.f.variableValues();
    this.at = w.live.frames.main.id;
  }
  get frame(): FakeNode {
    return this.w.f.nodeById(this.at)!;
  }
  get frameName() {
    return this.frame.name;
  }
  /** The layer `name` inside the dashboard instance of the frame on screen (not in nested instances). */
  layer(name: string): FakeNode {
    const inst = this.frame.children[0];
    if (inst?.type !== "INSTANCE") throw new Error(`${this.frameName} shows no instance`);
    const hits = inside(inst, name);
    if (hits.length !== 1) throw new Error(`${hits.length} layers named ${name} in ${this.frameName}`);
    return hits[0];
  }
  run(actions: readonly Action[]): number {
    const e = runFigmaActions(actions, this.vals, { navigate: (d) => ((this.at = d!), this.navigations++) });
    if (e > CAP) throw new Error(`an event executed ${e} actions (cap ${CAP})`);
    this.events.push(e);
    return e;
  }
  fire(name: string, trigger = "ON_CLICK"): number {
    const r = this.layer(name).reactions.find((x) => x.trigger?.type === trigger);
    if (!r?.actions) throw new Error(`${name} in ${this.frameName}: no ${trigger} reaction`);
    return this.run(r.actions);
  }
  hop(): number {
    const r = this.frame.reactions.find((x) => x.trigger?.type === "AFTER_TIMEOUT");
    if (!r?.actions) throw new Error(`${this.frameName}: no AFTER_TIMEOUT`);
    return this.run(r.actions);
  }
  /** AFTER_TIMEOUT hops until Main is on screen; returns the hops. */
  home(max = 20000): number {
    let n = 0;
    for (; this.at !== this.w.live.frames.main.id; n++) {
      if (n >= max) throw new Error(`no way back to Main after ${max} hops (at ${this.frameName})`);
      this.hop();
    }
    return n;
  }
  /** Loads a disk from Present mode: the click, then the hops. Returns the events of the load. */
  load(disk: string): number[] {
    const from = this.events.length;
    this.fire(`disk/${disk}`);
    expect(this.frameName).toBe(liveFrameNames().loadA);
    this.home();
    return this.events.slice(from);
  }
  v(id: string) {
    return this.vals.get(id);
  }
  /** A bus of net variables (LSB first). */
  bus(name: string, width: number): number {
    let x = 0;
    for (let i = 0; i < width; i++) if (this.vals.get(this.w.res.varIds.get(netId(this.w.net, `${name}[${i}]`))!)) x |= 1 << i;
    return x;
  }
  get halted() {
    return this.vals.get(this.w.res.varIds.get(netId(this.w.net, PROBES.HALTED.name))!) === true;
  }
  get phase() {
    return this.vals.get(this.w.res.phase!.id);
  }
  get ticks() {
    return this.vals.get(this.w.res.ticks.id);
  }
}

/** Every net variable equals `want` (per net id), every flag is false, and the controls are at power-on. */
function expectPowerOn(pl: Player, want: ArrayLike<number>, label: string) {
  const { p, res, live } = pl.w;
  const bad = p.variables.filter((v) => pl.v(res.varIds.get(v.net)!) !== (want[v.net] === 1)).map((v) => v.name);
  expect(bad, `${label}: nets off their power-on value`).toEqual([]);
  for (const fl of p.flags) expect(pl.v(res.varIds.get(fl.net)!), fl.name).toBe(false);
  expect(pl.ticks, `${label}: ticks`).toBe(0);
  expect(pl.v(res.tickText!.id)).toBe("0");
  if (res.phase) {
    expect(pl.phase, `${label}: phase`).toBe(0);
    expect(pl.v(res.runtime.controls.get("ctl/phaseText")!.id)).toBe("0");
  }
  expect(pl.v(res.running.id)).toBe(false);
  expect(pl.v(live.variables.busy.id)).toBe(0);
  expect(pl.v(live.variables.loading.id)).toBe(false);
}

/** FastSim from `init` until HALTED: the ticks, and the final state. */
function haltAfter(w: World, init: ArrayLike<number>) {
  const s = new FastSim(w.net, w.sched, init as Uint8Array);
  const h = netId(w.net, PROBES.HALTED.name);
  let t = 0;
  while (!s.v[h]) {
    s.tick();
    if (++t > 5000) throw new Error("does not halt");
  }
  return { ticks: t, v: s.v };
}

/** Every net variable equals the simulator's value. */
function expectState(pl: Player, v: ArrayLike<number>, label: string) {
  const bad = pl.w.p.variables.filter((x) => pl.v(pl.w.res.varIds.get(x.net)!) !== (v[x.net] === 1)).map((x) => x.name);
  expect(bad, `${label}: nets that differ from FastSim`).toEqual([]);
}

/** Layers named `name` in an instance, not counting the layers of instances nested in it. */
function inside(inst: FakeNode, name: string): FakeNode[] {
  const hits: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    for (const c of n.children) {
      if (c.name === name) hits.push(c);
      if (c.type !== "INSTANCE") walk(c);
    }
  };
  walk(inst);
  return hits;
}

const disk = (w: World, name: string) => w.disks.find((d) => d.name === name)!.initial;
const allReactions = (f: FakeFigma) =>
  f.allNodes().flatMap((n) => (((n as unknown as { reactions?: Reaction[] }).reactions ?? []) as Reaction[]).map((r) => ({ node: n, r })));
const stats: Record<string, unknown> = {};

describe("FigmaCPU Live: the native Present-mode runtime (real CPU, cap 400)", () => {
  let w: World;
  beforeAll(async () => {
    w = await build();
  }, 60_000);

  it("frames: five instances of the dashboard in a free region, Main is the flow, the controls found inside each instance", () => {
    const { f, live, comp } = w;
    const page = f.currentPage;
    const names = liveFrameNames();
    for (const [role, fr] of Object.entries(live.frames)) {
      const n = fk(fr);
      expect(n.name).toBe(names[role as keyof typeof names]);
      expect(n.parent).toBe(page);
      expect(n.children.length).toBe(1);
      const inst = n.children[0];
      expect(inst.type).toBe("INSTANCE");
      expect(inst._main).toBe(comp);
      // every control by name inside the instance (the pad's cells and the disks too)
      for (const name of ["ctl/step", "ctl/run", "ctl/stop", "ctl/reset", "ctl/pad", ...Array.from({ length: PAD }, (_, i) => `ctl/pad/${i}`), ...DISKS.map((d) => `disk/${d}`)])
        expect(inside(inst, name).length, `${name} in ${n.name}`).toBe(1);
    }
    // the free region: below everything else, no overlap with the other top-level nodes
    const others = page.children.filter((c) => !Object.values(names).includes(c.name));
    const bottom = Math.max(...others.map((c) => c.y + c.height));
    for (const fr of Object.values(live.frames)) expect(fk(fr).y).toBeGreaterThan(bottom);
    // flows: Main once, apply's own flow kept, no duplicate node ids
    const flows = page.flowStartingPoints;
    expect(flows.filter((x) => x.nodeId === live.frames.main.id)).toEqual([{ nodeId: live.frames.main.id, name: "FigmaCPU Live" }]);
    expect(new Set(flows.map((x) => x.nodeId)).size).toBe(flows.length);
    expect(flows.some((x) => x.nodeId === w.res.frames.control.id)).toBe(true);
    // triggers (defaults): Step ON_CLICK, pad MOUSE_ENTER, hops AFTER_TIMEOUT on Run/Load frames, nothing on Main
    const trig = (n: unknown) => fk(n).reactions.map((r) => r.trigger?.type);
    expect(trig(live.controls.step[0])).toEqual(["ON_CLICK"]);
    expect(live.controls.padCells.map(trig)).toEqual(Array(PAD).fill(["MOUSE_ENTER"]));
    for (const fr of [live.frames.runA, live.frames.runB, live.frames.loadA, live.frames.loadB]) expect(trig(fr)).toEqual(["AFTER_TIMEOUT"]);
    expect(trig(live.frames.main)).toEqual([]);
    // the decoy inside a nested instance and the disk without a program are left alone
    expect(fk(comp).findAll((x) => x.name === "ctl/step" && x.inInstance).every((x) => x.reactions.length === 0)).toBe(true);
    expect(trig(fk(comp).findOne((x) => x.name === "disk/nonesuch"))).toEqual([]);
    expect(w.logs.some((m) => m.includes("disk/nonesuch"))).toBe(true);
    // disks: all programs, boot = mul (the variables start in mul's power-on state)
    expect(live.disks).toEqual(Object.keys(PROGRAMS));
    expect(live.disks[live.boot]).toBe("mul");
  });

  it("every reaction in the file is flat (no nested CONDITIONAL) and within the cap as the audit counts it", () => {
    const all = allReactions(w.f);
    expect(all.length).toBeGreaterThan(30);
    for (const { node, r } of all) {
      expect(nestedConditional((r.actions ?? []) as Action[]), `${node.name} ${r.trigger?.type}`).toBeNull();
      expect(eventWorst((r.actions ?? []) as unknown as RestAction[]), `${node.name} ${r.trigger?.type}`).toBeLessThanOrEqual(CAP);
    }
    const pe = w.live.perEvent;
    for (const [k, v] of Object.entries(pe)) expect(v, k).toBeLessThanOrEqual(CAP);
    expect(Math.max(...w.live.loadChunking.perEvent)).toBeLessThanOrEqual(CAP);
    expect(w.live.diskNets).toBeGreaterThan(0);
    expect(w.live.diskNets + w.live.sharedNets).toBe(w.p.variables.length + w.p.flags.length);
    Object.assign(stats, {
      eventsPerTick: w.live.eventsPerTick,
      eventsPerLoad: w.live.eventsPerLoad,
      perEvent: pe,
      diskNets: w.live.diskNets,
      sharedNets: w.live.sharedNets,
      stored: w.live.stored,
    });
  });

  it("disk mul, loaded inside Present mode from a dirty state: every net equals powerOn(mul), then Step clicks run it to OUT = 0x2A", () => {
    const pl = new Player(w);
    for (let i = 0; i < 5 * w.live.eventsPerTick + 3; i++) pl.fire("ctl/step"); // mid-tick, counters nonzero
    expect(pl.ticks).toBe(5);
    const ev = pl.load("mul");
    expect(ev.length).toBe(w.live.eventsPerLoad);
    expect(pl.frameName).toBe(liveFrameNames().main);
    expectPowerOn(pl, disk(w, "mul"), "after disk/mul");
    expect(pl.v(w.live.variables.program.id)).toBe("mul");
    expect(pl.v(w.live.variables.listing!.id)).toBe(asmListing(PROGRAMS.mul));
    // Step: one chunk per click, until HALTED at a tick boundary
    const want = haltAfter(w, disk(w, "mul"));
    const from = pl.events.length;
    let clicks = 0;
    while (!(pl.halted && pl.phase === 0)) {
      pl.fire("ctl/step");
      if (++clicks > 200 * w.live.eventsPerTick) throw new Error("mul does not halt");
    }
    expect(clicks).toBe(want.ticks * w.live.eventsPerTick);
    expect(pl.ticks).toBe(want.ticks);
    expect(pl.bus("OUT", 8)).toBe(0x2a);
    expectState(pl, want.v, "mul by Step");
    expect(pl.frameName).toBe(liveFrameNames().main);
    stats.stepEventMax = Math.max(...pl.events.slice(from));
    stats.loadEvents = ev;
    stats.mulTicks = want.ticks;
  }, 60_000);

  it("the clock pad: MOUSE_ENTER sweeps across the cells clock mul to OUT = 0x2A (Reset first reloads the current disk)", () => {
    const pl = new Player(w);
    for (let i = 0; i < 7; i++) pl.fire("ctl/pad/3", "MOUSE_ENTER");
    expect(pl.phase).toBe(7 % w.live.eventsPerTick);
    pl.fire("ctl/reset");
    expect(pl.frameName).toBe(liveFrameNames().loadA);
    expect(pl.home() + 1).toBe(w.live.eventsPerLoad);
    expectPowerOn(pl, disk(w, "mul"), "after Reset");
    const want = haltAfter(w, disk(w, "mul"));
    const from = pl.events.length;
    let i = 0;
    // a back-and-forth sweep: 0 1 … 15 14 … 1 0 1 …
    while (!(pl.halted && pl.phase === 0)) {
      const k = i % (2 * PAD - 2);
      pl.fire(`ctl/pad/${k < PAD ? k : 2 * PAD - 2 - k}`, "MOUSE_ENTER");
      if (++i > 200 * w.live.eventsPerTick) throw new Error("mul does not halt");
    }
    expect(i).toBe(want.ticks * w.live.eventsPerTick);
    expect(pl.bus("OUT", 8)).toBe(0x2a);
    expectState(pl, want.v, "mul by the pad");
    stats.padEventMax = Math.max(...pl.events.slice(from));
  }, 60_000);

  it("Run loop: Run → Run A ⇄ B, one chunk per hop, stops on HALTED at a tick boundary and returns to Main", () => {
    const pl = new Player(w);
    pl.load("mul");
    pl.fire("ctl/run");
    expect(pl.frameName).toBe(liveFrameNames().runA);
    const hops = pl.home();
    const want = haltAfter(w, disk(w, "mul"));
    expect(hops).toBe(want.ticks * w.live.eventsPerTick + 1); // HALTED is seen at the next hop, which stops
    expect(pl.v(w.res.running.id)).toBe(false);
    expect(pl.phase).toBe(0);
    expect(pl.ticks).toBe(want.ticks);
    expect(pl.bus("OUT", 8)).toBe(0x2a);
    expectState(pl, want.v, "mul by Run");
  }, 60_000);

  it("disk fib loaded mid-run (from a Run frame, mid-tick): state equals powerOn(fib), then Run runs it to OUT = 0xE9", () => {
    const pl = new Player(w);
    pl.load("mul");
    pl.fire("ctl/run");
    for (let i = 0; i < 40 * w.live.eventsPerTick + 5; i++) pl.hop(); // 40 ticks and 5 chunks into mul
    expect([liveFrameNames().runA, liveFrameNames().runB]).toContain(pl.frameName);
    expect(pl.phase).toBe(5);
    const ev = pl.load("fib");
    expect(ev.length).toBe(w.live.eventsPerLoad);
    expectPowerOn(pl, disk(w, "fib"), "after disk/fib mid-run");
    expect(pl.v(w.live.variables.disk.id)).toBe(w.live.disks.indexOf("fib"));
    expect(pl.v(w.live.variables.program.id)).toBe("fib");
    pl.fire("ctl/run");
    pl.home();
    const want = haltAfter(w, disk(w, "fib"));
    expect(pl.ticks).toBe(want.ticks);
    expect(pl.bus("OUT", 8)).toBe(0xe9);
    expectState(pl, want.v, "fib by Run");
    // Reset now reloads fib (the current disk), not the boot program
    pl.fire("ctl/reset");
    pl.home();
    expectPowerOn(pl, disk(w, "fib"), "Reset after fib");
    stats.fibTicks = want.ticks;
  }, 120_000);

  it("while a load runs, Step / pad / Run / Stop do nothing; another disk restarts the load; the result is exact", () => {
    const pl = new Player(w);
    for (let i = 0; i < 3; i++) pl.fire("ctl/step");
    pl.fire("disk/count");
    pl.hop(); // one chunk in, now on Load B
    expect(pl.frameName).toBe(liveFrameNames().loadB);
    expect(pl.v(w.live.variables.busy.id)).toBe(LIVE_LOCK);
    expect(pl.v(w.live.variables.loading.id)).toBe(true);
    const phaseNow = w.res.runtime.controls.get("ctl/phaseNow")!.id;
    const before = new Map(pl.vals);
    pl.fire("ctl/step");
    pl.fire("ctl/pad/0", "MOUSE_ENTER");
    pl.fire("ctl/run");
    pl.fire("ctl/stop");
    expect(pl.frameName).toBe(liveFrameNames().loadB); // no navigation
    for (const [id, v] of before) if (id !== phaseNow) expect(pl.vals.get(id), id).toBe(v); // only the scratch snapshot moved
    pl.fire("disk/pow2"); // restart with another disk, mid-load
    expect(pl.frameName).toBe(liveFrameNames().loadA);
    pl.home();
    expectPowerOn(pl, disk(w, "pow2"), "pow2 after an interrupted count load");
    for (let i = 0; i < 2 * w.live.eventsPerTick; i++) pl.fire("ctl/step");
    expect(pl.ticks).toBe(2); // Step works again
  });

  it("Stop returns to Main mid-tick and Step carries on; Stop on Main and Run on a Run frame do not navigate", () => {
    const pl = new Player(w);
    pl.load("mul");
    let nav = pl.navigations;
    pl.fire("ctl/stop"); // not running: nothing
    expect(pl.navigations).toBe(nav);
    pl.fire("ctl/run");
    for (let i = 0; i < 3 * w.live.eventsPerTick + 4; i++) pl.hop();
    nav = pl.navigations;
    pl.fire("ctl/run"); // already running: nothing
    expect(pl.navigations).toBe(nav);
    pl.fire("ctl/stop");
    expect(pl.frameName).toBe(liveFrameNames().main);
    expect(pl.v(w.res.running.id)).toBe(false);
    expect(pl.phase).toBe(4);
    for (let i = 0; i < w.live.eventsPerTick - 4; i++) pl.fire("ctl/step");
    expect(pl.phase).toBe(0);
    expect(pl.ticks).toBe(4);
  });

  it("measured counts", () => {
    console.log(`[live] ${JSON.stringify(stats)}`);
    expect(stats.stepEventMax).toBeLessThanOrEqual(CAP);
  });
});

describe("FigmaCPU Live: options and rewiring", () => {
  it("wiring again replaces the frames and reuses the variables (no duplicates)", async () => {
    const w = await build();
    const again = await wireLive(asApi(w.f), w.p, w.res, w.comp as unknown as ComponentNode, w.disks, {});
    const names = Object.values(liveFrameNames());
    expect(w.f.currentPage.children.filter((c) => names.includes(c.name)).length).toBe(5);
    expect(fk(w.live.frames.main).removed).toBe(true);
    const vars = [...w.f.variableById.values()].filter((v) => v.name === "ctl/disk");
    expect(vars.length).toBe(1);
    expect(again.variables.disk.id).toBe(w.live.variables.disk.id);
    expect(w.f.currentPage.flowStartingPoints.filter((x) => x.name === "FigmaCPU Live")).toEqual([{ nodeId: again.frames.main.id, name: "FigmaCPU Live" }]);
    const pl = new Player({ ...w, live: again });
    pl.load("fib");
    expectPowerOn(pl, disk(w, "fib"), "after rewiring");
  }, 60_000);

  it("pad cells as instances of one component: the reaction is stored once, and works two instance levels down", async () => {
    const w = await build({}, { padCell: true });
    const cell = w.f.currentPage.children.find((c) => c.name === "ctl/pad/cell")!;
    expect(cell.reactions.map((r) => r.trigger?.type)).toEqual(["MOUSE_ENTER"]);
    for (const n of w.live.controls.padCells) expect(fk(n).reactions.length).toBe(1); // inherited from the cell component
    const plain = await build();
    expect(plain.live.stored - w.live.stored).toBe((PAD - 1) * eventWorstStored(plain));
    console.log(`[live] stored actions: ${plain.live.stored} with ${PAD} plain pad cells, ${w.live.stored} with a padCell component; ${eventWorstStored(plain)} per pad cell`);
    const pl = new Player(w);
    for (let i = 0; i < w.live.eventsPerTick; i++) pl.fire(`ctl/pad/${i % PAD}`, "MOUSE_ENTER");
    expect(pl.ticks).toBe(1);
  }, 120_000);

  it("stepTriggers / padTriggers / keys: each extra trigger is one more event of one chunk", async () => {
    const w = await build({ stepTriggers: ["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"], padTriggers: ["MOUSE_ENTER", "MOUSE_DOWN"], keys: [32] });
    const trig = (n: unknown) => fk(n).reactions.map((r) => r.trigger?.type);
    expect(trig(w.live.controls.step[0])).toEqual(["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"]);
    expect(trig(w.live.controls.padCells[0])).toEqual(["MOUSE_ENTER", "MOUSE_DOWN"]);
    expect(trig(w.live.frames.main)).toEqual(["ON_KEY_DOWN"]);
    expect(trig(w.live.frames.runA)).toEqual(["AFTER_TIMEOUT", "ON_KEY_DOWN"]);
    const pl = new Player(w);
    for (const t of ["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"]) pl.fire("ctl/step", t);
    pl.fire("ctl/pad/0", "MOUSE_DOWN");
    pl.run(fk(w.live.frames.main).reactions[0].actions!);
    expect(pl.phase).toBe(5);
  }, 60_000);

  it("a dashboard without ctl/step (or any control) is refused with the missing name", async () => {
    const f = new FakeFigma();
    const net = cpuNetlist();
    const disks = cpuPrograms(net, { mul: PROGRAMS.mul });
    const p = plan(net, compile(net, { inputs: [] }), { initial: disks[0].initial as Uint8Array, name: "CPU", halt: PROBES.HALTED.name });
    const res = await apply(asApi(f), p, { maxActionsPerEvent: CAP });
    const comp = f.createComponent();
    comp.name = "empty";
    await expect(wireLive(asApi(f), p, res, comp as unknown as ComponentNode, disks)).rejects.toThrow(/no layer named ctl\/step/);
  }, 60_000);

  it("a small circuit whose tick fits in one event (unchunked) and one disk: Step, disk load, Run / Stop", async () => {
    const f = new FakeFigma();
    const net = counterNetlist();
    const sched = compile(net);
    const zero: LiveProgram = { name: "zero", initial: powerOn(net) };
    const p = plan(net, sched, { initial: zero.initial as Uint8Array, maxActionsPerEvent: Infinity });
    const res = await apply(asApi(f), p, { maxActionsPerEvent: Infinity });
    expect(res.chunks).toBe(1);
    const comp = fakeDashboard(f, { disks: ["zero"] });
    const live = await wireLive(asApi(f), p, res, comp as unknown as ComponentNode, [zero]);
    expect(live.diskNets).toBe(0);
    expect(live.eventsPerLoad).toBe(2); // the click and one hop
    const w = { f, net, sched, p, res, comp, disks: [zero], live, logs: [] } as World;
    const pl = new Player(w);
    for (let i = 0; i < 3; i++) pl.fire("ctl/step");
    expect(pl.bus("Q", 4)).toBe(3);
    pl.fire("ctl/pad/2", "MOUSE_ENTER");
    expect(pl.ticks).toBe(4);
    pl.load("zero");
    expectPowerOn(pl, zero.initial, "counter after disk/zero");
    pl.fire("ctl/run");
    for (let i = 0; i < 5; i++) pl.hop();
    pl.fire("ctl/stop");
    expect(pl.frameName).toBe(liveFrameNames().main);
    expect(pl.bus("Q", 4)).toBe(5);
    for (const { node, r } of allReactions(f)) expect(nestedConditional((r.actions ?? []) as Action[]), node.name).toBeNull();
  });

  it("disk/custom holds the program Compile put in (here sub, not among the disks); it is the boot disk", async () => {
    const f = new FakeFigma();
    const net = cpuNetlist();
    const sched = compile(net, { inputs: [] });
    const [sub] = cpuPrograms(net, { sub: PROGRAMS.sub });
    const disks = cpuPrograms(net, { mul: PROGRAMS.mul }, (src) => `listing of ${src.length} chars`);
    const p = plan(net, sched, { initial: sub.initial as Uint8Array, name: "CPU", halt: PROBES.HALTED.name });
    const res = await apply(asApi(f), p, { maxActionsPerEvent: CAP });
    const comp = fakeDashboard(f, { disks: ["mul", "custom"] });
    const live = await wireLive(asApi(f), p, res, comp as unknown as ComponentNode, disks, { bootListing: "sub's listing" });
    expect(live.disks).toEqual(["mul", "custom"]);
    expect(live.boot).toBe(1);
    const w = { f, net, sched, p, res, comp, disks: [...disks, { name: "custom", initial: sub.initial }], live, logs: [] } as World;
    const pl = new Player(w);
    expect(pl.v(live.variables.program.id)).toBe("custom");
    expect(pl.v(live.variables.listing!.id)).toBe("sub's listing");
    pl.load("mul");
    expectPowerOn(pl, disk(w, "mul"), "mul");
    expect(pl.v(live.variables.listing!.id)).toBe(`listing of ${PROGRAMS.mul.length} chars`);
    pl.load("custom");
    expectPowerOn(pl, sub.initial, "custom = sub");
    pl.fire("ctl/run");
    pl.home();
    expect(pl.halted).toBe(true);
    expect(pl.ticks).toBe(haltAfter(w, sub.initial).ticks);
  }, 60_000);

  it("asmListing drops comments and blank lines", () => {
    expect(asmListing(PROGRAMS.mul).split("\n")).toEqual([
      "LDI R0, 0",
      "LDI R1, 6",
      "LDI R2, 7-1",
      "LDI R3, 1",
      "loop: ADD R0, R1",
      "SUB R2, R3",
      "JC loop",
      "ST R0, [OUT]",
      "HLT",
    ]);
  });
});

/** Actions stored in one pad cell's reaction (the step event, every branch). */
function eventWorstStored(w: World): number {
  const acts = fk(w.live.controls.padCells[0]).reactions[0].actions!;
  const count = (a: readonly Action[]): number => a.reduce((n, x) => n + 1 + (x.type === "CONDITIONAL" ? x.conditionalBlocks.reduce((s, b) => s + count(b.actions), 0) : 0), 0);
  return count(acts);
}
