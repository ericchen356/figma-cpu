// Leila's CPU in the Figma OS's CPU tab (livetab/src/patch.ts), end to end against the fake Figma API:
// a minimal live frame (the parts the patch looks for, the OS's press blocker and the extension's
// tab/cpu), the patch added, then the stored reactions replayed like the viewer in Present mode:
// presses and releases on the layers of the instance inside the live frame (they inherit the
// component's reactions), overlays opened, swapped and closed, AFTER_TIMEOUT on the overlay showing.
// Every event stays within the cap, and the CPU's wires match FastSim.
import { beforeAll, describe, expect, it } from "vitest";
import { ACTS_KEY, ACTS_NS } from "../../osui/src/live/build";
import { FastSim } from "../../src/compile";
import { PROBES } from "../../src/cpu";
import { PROGRAMS } from "../../src/isa";
import { netId } from "../../src/netlist/flatten";
import {
  boolData,
  mouseDown,
  setVariable,
} from "../../src/prototype/figma-actions";
import { cpuPrograms } from "../../src/prototype/live";
import { type FigmaValue, runFigmaActions } from "../../src/prototype";
import { collectPrefixed, listingText } from "../../src/live";
import { FakeFigma, type FakeNode } from "../../test/fake-figma";
import {
  LIVE,
  addLiveTab,
  CAP,
  COLLECTION,
  type LiveTabResult,
  NS,
  PREFIX,
  removeLiveTab,
  TAB_VAR,
  VIEW_COLLECTION,
} from "../src/patch";
import { LIVE as OS_LIVE } from "../../osui/src/live/screen";

const asApi = (f: FakeFigma) => f as unknown as PluginAPI;
const fk = (n: unknown) => n as FakeNode;

interface World {
  f: FakeFigma;
  r: LiveTabResult;
  logs: string[];
  tab: string;
  pressed: string;
  frame: FakeNode;
  before: number;
}

/** The parts of a live frame the patch uses: app › rail, left panel, canvas, right panel, a toolbar
 * that blocks presses (the OS's `{ on: "block" }`), the OS's `pressed` and the extension's tab/cpu. */
async function liveFrame(f: FakeFigma) {
  const page = f.currentPage;
  const os = f.variables.createVariableCollection("Figma OS · CPU");
  const pressed = f.variables.createVariable("ui/pressed", os, "BOOLEAN");
  pressed.setValueForMode(os.defaultModeId, false);
  const view = f.variables.createVariableCollection(VIEW_COLLECTION);
  const tab = f.variables.createVariable(TAB_VAR, view, "BOOLEAN");
  tab.setValueForMode(view.defaultModeId, false);
  const frame = f.createFrame();
  frame.name = OS_LIVE;
  frame.resize(1728, 868);
  page.appendChild(frame);
  const box = (
    parent: FakeNode,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => {
    const n = f.createFrame();
    n.name = name;
    n.resize(w, h);
    parent.appendChild(n);
    n.x = x;
    n.y = y;
    return n;
  };
  const app = box(frame, "div#app.app", 0, 0, 1728, 868);
  box(app, "header.topbar", 0, 0, 1728, 48);
  box(app, "nav#rail.rail", 0, 48, 48, 820);
  box(app, "aside.left-panel", 48, 48, 240, 820);
  const canvas = box(app, "main.canvas", 288, 48, 1200, 820);
  box(app, "aside.right-panel", 1488, 48, 240, 820);
  const toolbar = box(canvas, "toolbar", 400, 760, 400, 48);
  toolbar.setSharedPluginData(
    ACTS_NS,
    ACTS_KEY,
    JSON.stringify([{ on: "block" }]),
  );
  await toolbar.setReactionsAsync([
    {
      trigger: mouseDown(),
      actions: [setVariable(pressed.id, boolData(false))],
    },
  ]);
  return { frame, tab: tab.id, pressed: pressed.id };
}

async function build(): Promise<World> {
  const f = new FakeFigma(["Figma OS", "CPU", "UI"]);
  (globalThis as unknown as { figma: FakeFigma }).figma = f;
  const { frame, tab, pressed } = await liveFrame(f);
  for (const p of f.root.children) await p.loadAsync();
  const before = f.allNodes().length;
  const logs: string[] = [];
  const r = await addLiveTab(asApi(f), { log: (m) => logs.push(m) });
  return { f, r, logs, tab, pressed, frame, before };
}

const CLOSED = "__close__";
/** CLOSE as a navigation the emulator knows (it only runs SET_VARIABLE, CONDITIONAL and NODE). */
function closeAsNode(actions: readonly Action[]): Action[] {
  return actions.map((a) =>
    (a.type as string) === "CLOSE"
      ? ({
          type: "NODE",
          destinationId: CLOSED,
          navigation: "NAVIGATE",
          transition: null,
        } as unknown as Action)
      : a.type === "CONDITIONAL"
        ? ({
            ...a,
            conditionalBlocks: a.conditionalBlocks.map((b) => ({
              ...b,
              actions: closeAsNode(b.actions),
            })),
          } as Action)
        : a,
  );
}

/** Present mode on the live frame: what shows (bindings resolved), presses, the overlay on top. */
class Player {
  readonly vals: Map<string, FigmaValue>;
  overlay: FakeNode | null = null;
  events: number[] = [];
  constructor(readonly w: World) {
    this.vals = w.f.variableValues();
  }
  shows(n: FakeNode): boolean {
    for (let q: FakeNode | null = n; q && q.type !== "PAGE"; q = q.parent) {
      const b = q.boundVariables.visible;
      const on = b ? this.vals.get(b.id) === true : q.visible;
      if (!on) return false;
    }
    return true;
  }
  /** The one showing layer named `name` in the view (stacked layers: only one shows). */
  layer(name: string): FakeNode {
    const hits = fk(this.w.r.view).findAll((n) => n.name === name && this.shows(n));
    if (hits.length !== 1)
      throw new Error(`${hits.length} showing layers named ${name}`);
    return hits[0];
  }
  run(actions: readonly Action[]): number {
    const e = runFigmaActions(closeAsNode(actions), this.vals, {
      navigate: (d) => {
        this.overlay = d === CLOSED ? null : this.w.f.nodeById(d!);
      },
    });
    if (e > CAP) throw new Error(`an event executed ${e} actions (cap ${CAP})`);
    this.events.push(e);
    return e;
  }
  /** A press and release on `n`: both reactions, as the viewer runs them. */
  tap(n: FakeNode) {
    if (this.overlay)
      throw new Error(`an overlay (${this.overlay.name}) covers the screen`);
    if (!this.shows(n)) throw new Error(`${n.name} is not showing`);
    for (const t of ["MOUSE_DOWN", "MOUSE_UP"]) {
      const r = n.reactions.find((x) => x.trigger?.type === t);
      if (!r?.actions) throw new Error(`${n.name}: no ${t}`);
      this.run(r.actions);
    }
  }
  press(name: string) {
    this.tap(this.layer(name));
  }
  /** AFTER_TIMEOUT hops on the overlay showing until it closes; returns the hops. */
  hops(limit = 1e6): number {
    let n = 0;
    while (this.overlay) {
      const r = this.overlay.reactions.find(
        (x) => x.trigger?.type === "AFTER_TIMEOUT",
      );
      if (!r?.actions)
        throw new Error(`${this.overlay.name}: no AFTER_TIMEOUT`);
      this.run(r.actions);
      if (++n > limit) throw new Error("the overlay never closed");
    }
    return n;
  }
  ctl(name: string) {
    return this.vals.get(this.w.r.controls.get(name)!);
  }
  net(name: string) {
    return this.vals.get(this.w.r.varIds.get(netId(this.w.r.net, name))!);
  }
  bus(name: string, width: number): number {
    let x = 0;
    for (let i = 0; i < width; i++) if (this.net(`${name}[${i}]`)) x |= 1 << i;
    return x;
  }
  /** Every wire equals FastSim's value. */
  expectState(v: ArrayLike<number>, label: string) {
    const bad: string[] = [];
    for (const [n, id] of this.w.r.varIds)
      if (this.vals.get(id) !== (v[n] === 1))
        bad.push(this.w.r.net.netNames[n]);
    expect(bad, `${label}: wires that differ from FastSim`).toEqual([]);
  }
}

describe("Leila's CPU in the CPU tab", () => {
  let w: World;
  beforeAll(async () => {
    w = await build();
  }, 120_000);

  it("adds the view to the live frame, shown while tab/cpu is true, over the canvas and the right panel", () => {
    const pl = new Player(w);
    const root = fk(w.r.view).parent!;
    expect(LIVE, "the live OS's frame name").toBe(OS_LIVE);
    expect(root.name).toBe(`${PREFIX}tab`);
    expect(root.parent!.name).toBe("div#app.app");
    expect(root.parent!.children[root.parent!.children.length - 1]).toBe(root);
    expect([root.x, root.y, root.width, root.height]).toEqual([
      288, 48, 1440, 820,
    ]);
    expect(pl.shows(fk(w.r.view))).toBe(false);
    pl.vals.set(w.tab, true);
    expect(pl.shows(fk(w.r.view))).toBe(true);
    for (const m of w.r.windows) expect(fk(m).width).toBeLessThanOrEqual(1440);
    expect(pl.ctl("ctl/program")).toBe("ptrout");
    expect(w.r.problems).toEqual([]);
  });

  it("stores no reaction over the cap and none nested (what Figma rejects), every overlay at the top level", () => {
    const all = w.f.allNodes().filter((n) => n.reactions.length);
    for (const n of all)
      for (const r of n.reactions) {
        const acts = (r.actions ?? []) as Action[];
        for (const a of acts)
          if (a.type === "CONDITIONAL")
            for (const b of a.conditionalBlocks)
              for (const x of b.actions) expect(x.type).not.toBe("CONDITIONAL");
      }
    for (const o of [...w.r.overlays.runs, ...w.r.overlays.loads])
      expect(fk(o).parent!.type).toBe("PAGE");
    expect(w.r.perEvent.step).toBeLessThanOrEqual(CAP);
    expect(w.r.perEvent.diskClick).toBeLessThanOrEqual(CAP);
    expect(w.r.perEvent.loadHop).toBeLessThanOrEqual(CAP);
    expect(w.r.chunks).toBeGreaterThan(1);
  });

  it("Step: one press per chunk, K presses = one tick, equal to FastSim tick after tick", () => {
    const pl = new Player(w);
    pl.vals.set(w.tab, true);
    const sim = new FastSim(
      w.r.net,
      w.r.schedule,
      cpuPrograms(w.r.net, { ptrout: PROGRAMS.ptrout }, listingText)[0]
        .initial as Uint8Array,
    );
    pl.vals.set(w.pressed, true); // a canvas press pending: the view's press must clear it
    for (let t = 0; t < 30; t++) {
      for (let k = 0; k < w.r.chunks; k++) {
        expect(pl.ctl("ctl/phase")).toBe(k);
        pl.press("ctl/step");
      }
      sim.tick();
      expect(pl.ctl("ctl/ticks")).toBe(t + 1);
      pl.expectState(sim.v, `tick ${t + 1}`);
    }
    // the press reached the OS's blocker, so no canvas gesture is pending
    expect(pl.vals.get(w.pressed)).toBe(false);
  });

  it("Run plays in place as overlays until HALT: ptrout counts OUT down to 0", () => {
    const pl = new Player(w);
    pl.vals.set(w.tab, true);
    pl.press("ctl/run");
    expect(pl.overlay?.name).toBe(`${PREFIX}Run 1`);
    expect(pl.ctl("ctl/running")).toBe(true);
    const hops = pl.hops();
    expect(pl.overlay).toBe(null);
    expect(pl.net(PROBES.HALTED.name)).toBe(true);
    expect(pl.ctl("ctl/running")).toBe(false);
    expect(pl.bus("OUT", 8)).toBe(0);
    expect(pl.ctl("ctl/phase")).toBe(0);
    const sim = new FastSim(
      w.r.net,
      w.r.schedule,
      cpuPrograms(w.r.net, { ptrout: PROGRAMS.ptrout }, listingText)[0]
        .initial as Uint8Array,
    );
    for (let t = 0; t < (pl.ctl("ctl/ticks") as number); t++) sim.tick();
    pl.expectState(sim.v, "halted");
    expect(hops).toBeGreaterThan(100);
    expect(Math.max(...pl.events)).toBeLessThanOrEqual(CAP);
  });

  it("Stop in the Run overlay stops it; Step goes on from the same chunk", () => {
    const pl = new Player(w);
    pl.vals.set(w.tab, true);
    pl.press("disk/mul");
    pl.hops();
    pl.press("ctl/run");
    for (let i = 0; i < 25; i++) {
      const r = pl.overlay!.reactions.find(
        (x) => x.trigger?.type === "AFTER_TIMEOUT",
      )!;
      pl.run(r.actions!);
    }
    const stop = pl.overlay!.findOne((n) => n.name === "stop")!;
    for (const t of ["MOUSE_DOWN", "MOUSE_UP"])
      pl.run(stop.reactions.find((x) => x.trigger?.type === t)!.actions!);
    expect(pl.ctl("ctl/running")).toBe(false);
    pl.hops(1);
    expect(pl.overlay).toBe(null);
    const phase = pl.ctl("ctl/phase") as number;
    pl.press("ctl/step");
    expect(pl.ctl("ctl/phase")).toBe((phase + 1) % w.r.chunks);
  });

  it("a program button loads it from any state (equal to its power-on state), and Run runs it: mul → 0x2A", () => {
    const pl = new Player(w);
    pl.vals.set(w.tab, true);
    for (let i = 0; i < 17; i++) pl.press("ctl/step");
    pl.press("disk/mul");
    expect(pl.overlay?.name).toBe(`${PREFIX}Load 1`);
    expect(pl.hops()).toBe(w.r.loadHops);
    const mul = cpuPrograms(w.r.net, { mul: PROGRAMS.mul }, listingText)[0];
    pl.expectState(mul.initial, "mul loaded");
    expect(pl.ctl("ctl/ticks")).toBe(0);
    expect(pl.ctl("ctl/phase")).toBe(0);
    expect(pl.ctl("ctl/program")).toBe("mul");
    expect(pl.ctl("ctl/loading")).toBe(false);
    pl.press("ctl/run");
    pl.hops();
    expect(pl.bus("OUT", 8)).toBe(0x2a);
  });

  it("Reset reloads the program that is loaded (one Reset button per program, only its own showing)", () => {
    const pl = new Player(w);
    pl.vals.set(w.tab, true);
    pl.press("disk/fib");
    pl.hops();
    for (let i = 0; i < 40; i++) pl.press("ctl/step");
    pl.press("ctl/reset");
    pl.hops();
    pl.expectState(
      cpuPrograms(w.r.net, { fib: PROGRAMS.fib }, listingText)[0].initial,
      "fib after Reset",
    );
    expect(pl.ctl("ctl/program")).toBe("fib");
  });

  it("OS chip › hides the view (the extension's CPU page shows), ‹ Leila's CPU brings it back", () => {
    const pl = new Player(w);
    pl.vals.set(w.tab, true);
    const root = fk(w.r.view).parent!;
    const toOs = fk(w.r.view).findOne(
      (n) => n.name === `${PREFIX}show OS chip`,
    )!;
    pl.tap(toOs);
    expect(pl.shows(fk(w.r.view))).toBe(false);
    const back = root.findOne((n) => n.name === `${PREFIX}show Leila CPU`)!;
    expect(pl.shows(back)).toBe(true);
    pl.tap(back);
    expect(pl.shows(fk(w.r.view))).toBe(true);
    expect(pl.shows(back)).toBe(false);
  });

  it("the stacked Step / Run / Reset buttons sit together in the bar (none loose on the page)", () => {
    const view = fk(w.r.view);
    const steps = view.findAll((n) => n.name === "ctl/step");
    expect(steps.length).toBe(w.r.chunks);
    for (const s of steps) expect([s.parent!.name, s.x, s.y]).toEqual([`${PREFIX}view`, steps[0].x, steps[0].y]);
    expect(view.findAll((n) => n.name === "ctl/run").length).toBe(w.r.chunks);
    expect(view.findAll((n) => n.name === "ctl/reset").length).toBe(w.r.disks.length);
    const page = w.f.currentPage;
    expect(page.children.filter((n) => n.name.startsWith("ctl/")).map((n) => n.name)).toEqual([]);
  });

  it("the windows hold the CPU's own blocks drawn as gates, every gate's light bound to its output wire", () => {
    expect(w.r.windows.map((m) => m.name)).toEqual(["mag/regs", "mag/ctrl", "mag/busmux", "mag/ir", "mag/alu", "mag/mar", "mag/mdr", "mag/pc", "mag/tstate"]);
    const net = w.r.net;
    let gates = 0;
    for (const m of w.r.windows) {
      const inst = fk(m).children.find((c) => c.type === "INSTANCE")!;
      expect(inst, m.name).toBeTruthy();
      const b = collectPrefixed(inst as unknown as InstanceNode, net, `${m.name.slice(4)}/`);
      expect(b.missing, `${m.name}: gates without a light`).toEqual([]);
      for (const [gi, node] of b.gateLit) {
        const out = net.gates[gi].out;
        if (out <= 1) continue;
        expect(fk(node).boundVariables.visible?.id, net.gates[gi].path).toBe(w.r.varIds.get(out));
        gates++;
      }
    }
    expect(gates).toBeGreaterThan(500);
  });

  it("only gates: no lamps, display or diagrams, just the bar's counters (bound) and the windows", () => {
    const view = fk(w.r.view);
    for (const kind of ["lamp/", "seg/", "arrow/", "row/", "col/", "tag/"]) expect(view.findAll((n) => n.name.startsWith(kind)).map((n) => n.name)).toEqual([]);
    for (const t of ["var/ctl/tickText", "var/ctl/phaseText"]) expect(view.findOne((n) => n.name === t)!.boundVariables.characters, t).toBeTruthy();
    expect(view.children.filter((n) => n.name.startsWith("window/")).length).toBe(6);
  });

  it("removeLiveTab deletes exactly what it made and its collection; adding again works", async () => {
    const n = await removeLiveTab(asApi(w.f));
    expect(n).toBeGreaterThan(0);
    expect(w.f.allNodes().length).toBe(w.before);
    expect(
      (await w.f.variables.getLocalVariableCollectionsAsync()).map(
        (c) => c.name,
      ),
    ).not.toContain(COLLECTION);
    expect(w.f.root.getSharedPluginData(NS, "made")).toBe("");
    const again = await addLiveTab(asApi(w.f));
    expect(again.problems).toEqual([]);
    const count = w.f.allNodes().length;
    await addLiveTab(asApi(w.f));
    expect(w.f.allNodes().length).toBe(count);
  }, 120_000);
});
