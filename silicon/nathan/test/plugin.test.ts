// The CPU NATHAN plugin, end to end against the fake Figma API. One document, one session, like a
// user clicking through the panel: Build hardware → Build the OS → Self-test (a random user
// session through the stored reaction JSON) → Platform tests → Clean → rebuild. The fake checks
// what Figma checks (fonts, colours, variables, reactions, dynamic-page access), and the stored
// reactions are also held to what Figma desktop was measured to accept and do: one CONDITIONAL
// level whose conditions are expressions, no `deprecatedVersion` on MOUSE_ENTER, at most `budget`
// actions an event (700 by default; on a cold page 1,200 overflowed the viewer's stack), and never
// mouse down / up next to a click on one layer (the click would not fire).
// A second document is a Starter-plan file (createPage throws).
import { beforeAll, describe, expect, it } from "vitest";
import { resetFonts } from "../../src/figma/style";
import { FakeFigma, type FakeNode } from "../../test/fake-figma";
import { NathanApp } from "../plugin/src/app";
import type { ToUi } from "../plugin/src/messages";
import { CHAIN_PREFIX, WARMUP } from "../plugin/src/app";
import {
  CIRCUIT,
  COLLECTION,
  FLOW,
  MACHINE,
  PAGE_NAME,
  PRESENT,
  TOP,
  UI_COLLECTION,
} from "../plugin/src/names";
import { TEST_COLLECTION, TEST_PREFIX } from "../src/platform/tests";
import { UI_H, UI_W } from "../src/ui/spec";
import { varName } from "../../src/prototype";
import { nathanNetlist } from "../src/hw";
import { classify } from "../src/react/synth";

/** Names of the variables that hold what the machine is and shows: latches and screen lines. */
const machineState = (() => {
  const net = nathanNetlist();
  return new Set(
    net.gates
      .filter((g) => ["M", "S", "D"].includes(classify(g).c))
      .map((g) => varName(net.netNames[g.out])),
  );
})();
/** Every variable an action list sets, inside its conditionals too. */
const setsIn = (acts: readonly Action[]): string[] =>
  acts.flatMap((a) =>
    a.type === "SET_VARIABLE"
      ? [a.variableId!]
      : a.type === "CONDITIONAL"
        ? a.conditionalBlocks.flatMap((b) => setsIn(b.actions))
        : [],
  );

function install(fig: FakeFigma) {
  (globalThis as unknown as { figma: FakeFigma }).figma = fig;
  resetFonts();
}

function session(fig: FakeFigma) {
  install(fig);
  fig.autoFlows = true; // like Figma: the chain overlays that swap would become flows
  const posted: ToUi[] = [];
  const app = new NathanApp(
    fig as unknown as PluginAPI,
    (m) => posted.push(m),
    {
      yield: async () => {},
    },
  );
  const errors = () =>
    posted.filter((m) => m.type === "log" && m.level === "error");
  return { app, posted, errors };
}

const kid = (n: FakeNode | null | undefined, name: string) =>
  n?.children.find((c) => c.name === name) ?? null;
const page = (fig: FakeFigma) =>
  fig.root.children.find((p) => p.name === PAGE_NAME) ?? null;

/** Top-level nodes of a page whose bounding boxes intersect. */
function overlaps(p: FakeNode): string[] {
  const ns = p.children;
  const out: string[] = [];
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) {
      const [a, b] = [ns[i], ns[j]];
      if (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      )
        out.push(`${a.name} × ${b.name}`);
    }
  return out;
}

const lastOf = <T>(a?: readonly T[]) =>
  a?.length ? a[a.length - 1] : undefined;

/** The overlays a long reaction continues through, and the checks that every chain is sound:
 * each overlay has one timer, which swaps in another overlay or closes, and none is unreachable. */
function chains(p: FakeNode) {
  const frames = p.children.filter((n) => n.name.startsWith(CHAIN_PREFIX));
  const ids = new Set(frames.map((f) => f.id));
  const problems: string[] = [];
  const entered = new Set<string>();
  for (const f of frames) {
    const timers = f.reactions.filter(
      (r) => r.trigger?.type === "AFTER_TIMEOUT",
    );
    if (f.reactions.length !== 1 || timers.length !== 1)
      problems.push(`${f.name}: ${f.reactions.length} reactions`);
    const last = lastOf(timers[0]?.actions);
    if (last?.type === "NODE") {
      if (
        String(last.navigation) !== "SWAP" ||
        !ids.has(last.destinationId ?? "")
      )
        problems.push(`${f.name}: ends with ${last.navigation}`);
      else entered.add(last.destinationId!);
    } else if (last?.type !== "CLOSE")
      problems.push(`${f.name}: does not end with SWAP or CLOSE`);
  }
  return { frames, ids, entered, problems };
}

/** Every stored reaction under `root`, with the layer it is on. */
function reactionsUnder(root: FakeNode) {
  const out: { node: FakeNode; r: Reaction }[] = [];
  const walk = (n: FakeNode) => {
    for (const r of n.reactions) out.push({ node: n, r });
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** Actions in one event if every branch ran (what the per-event limit is about). */
const size = (acts: readonly Action[]): number =>
  acts.reduce(
    (s, a) =>
      s +
      1 +
      (a.type === "CONDITIONAL"
        ? a.conditionalBlocks.reduce((t, b) => t + size(b.actions), 0)
        : 0),
    0,
  );

/** What the real Figma refuses or silently changes: a CONDITIONAL inside a CONDITIONAL
 * ("Unrecognized key 'conditionalBlocks'"), more than one condition in a CONDITIONAL (it keeps the
 * first and turns the second into the ELSE), and conditions that are not expressions. */
function realFigmaProblems(acts: readonly Action[], depth = 0): string[] {
  const out: string[] = [];
  for (const a of acts) {
    if (a.type !== "CONDITIONAL") continue;
    if (depth > 0) out.push("nested CONDITIONAL");
    if (a.conditionalBlocks.filter((b) => b.condition).length > 1)
      out.push(`${a.conditionalBlocks.length} conditional blocks`);
    for (const b of a.conditionalBlocks) {
      const c = b.condition as
        { type?: string; value?: { expressionFunction?: string } } | undefined;
      if (c && c.type !== "EXPRESSION") out.push(`condition of type ${c.type}`);
      out.push(...realFigmaProblems(b.actions, depth + 1));
    }
  }
  return out;
}

/** Every event stored on the page (triggers under the frames and the overlays' timers): what Figma
 * desktop refuses, events over `budget`, overlays nobody opens, overlays that are flows, and the
 * chains' early events writing a latch or a screen line (between two events nothing may be half
 * written). Returns how many reactions run as more than one event. */
function events(fig: FakeFigma, budget: number) {
  const p = page(fig)!;
  const all = [PRESENT, MACHINE, CIRCUIT].flatMap((n) =>
    reactionsUnder(kid(p, n)!),
  );
  const c = chains(p);
  expect(c.problems).toEqual([]);
  const timers = c.frames.flatMap((f) => f.reactions);
  expect(
    [
      ...all.map(({ node, r }) => ({ node, r })),
      ...timers.map((r) => ({ node: { name: "overlay" }, r })),
    ]
      .map(({ node, r }) => ({
        at: `${node.name} ${r.trigger?.type}`,
        n: size(r.actions ?? []),
      }))
      .filter((x) => x.n > budget),
  ).toEqual([]);
  expect(
    [...all.map(({ r }) => r), ...timers].flatMap((r) =>
      realFigmaProblems(r.actions ?? []),
    ),
  ).toEqual([]);
  const opens = all.filter(({ r }) => {
    const last = lastOf(r.actions);
    return last?.type === "NODE" && String(last.navigation) === "OVERLAY";
  });
  const opened = new Set(
    opens.map(
      ({ r }) => (lastOf(r.actions) as { destinationId: string }).destinationId,
    ),
  );
  for (const f of c.frames)
    expect(opened.has(f.id) || c.entered.has(f.id), f.name).toBe(true);
  expect(
    [...opened].filter((id) => !c.ids.has(id) && kid(p, WARMUP)?.id !== id),
  ).toEqual([]);
  expect(p.flowStartingPoints.filter((f) => c.ids.has(f.nodeId))).toEqual([]);
  const early = [
    ...opens.map(({ r }) => r),
    ...timers.filter((r) => lastOf(r.actions)?.type === "NODE"),
  ];
  const nameOf = new Map(
    fig.collections.flatMap((k) => k.vars.map((v) => [v.id, v.name] as const)),
  );
  const written = early.flatMap((r) =>
    setsIn(r.actions ?? []).map((id) => nameOf.get(id)!),
  );
  expect(written.filter((n) => machineState.has(n))).toEqual([]);
  return {
    chained: opened.size, // the first overlay of each chained reaction
    early: early.length,
    written: written.length,
  };
}

describe("CPU NATHAN plugin, end to end", () => {
  const fig = new FakeFigma(["Page 1"]);
  const s = session(fig);

  beforeAll(async () => {
    await s.app.handle({ type: "init" });
  });

  it("Build hardware draws the machine on its own page", async () => {
    const stats = await s.app.hardware({ gateLabels: false });
    expect(s.errors()).toEqual([]);
    const p = page(fig)!;
    expect(p).not.toBeNull();
    expect(fig.root.children[0].name).toBe("Page 1");
    expect(fig.root.children[0].children).toHaveLength(0); // the other page is untouched
    expect(kid(p, `cell/${TOP}`)?.type).toBe("COMPONENT");
    expect(stats.gates).toBeGreaterThan(4000);
    expect(stats.drawn).toBe(stats.modules);
    expect(overlaps(p)).toEqual([]);
  }, 600_000);

  it("Build the OS: variables, lamps, the editor frame and a flow", async () => {
    // what the panel sends by default
    await s.app.handle({
      type: "os",
      latch: "auto",
      budget: 700,
      alias: true,
    });
    expect(s.errors()).toEqual([]);
    const os = s.posted.find((m) => m.type === "os");
    expect(os?.type).toBe("os");
    const stats = os!.type === "os" ? os!.stats : null!;
    expect(stats.missing).toBe(0);
    // canvas presses and releases: pick-up per cell (14 × 10, a press), first corner per row (10,
    // a press), drop per cell (14 × 10, a release: no hover fires while the button is held, so the
    // column is built in), opposite corner per cell (14 × 10, a release), the pen's press per cell
    // (14 × 10, shared by the pen-up and pen-down sets) and its stroke per cell (14 × 10, on hover
    // and release); then 25 controls (5 tools, layer rows, eyes, Delete, Esc, Erase, Clear), and
    // for each of the 8 slots: 16 swatches, 4 handles, 4 nudges, Duplicate / Bring forward / Send
    // backward
    expect(stats.reactions).toBe(
      14 * 10 + 10 + 14 * 10 + 14 * 10 + 2 * 14 * 10 + 25 + (16 + 4 + 4 + 3) * 8,
    );
    const p = page(fig)!;
    const present = kid(p, PRESENT)!;
    expect(present).not.toBeNull();
    expect(kid(present, "editor")).not.toBeNull();
    // the editor fills the frame Present opens, 16:9: wider than a laptop's view, so it shows whole
    // (a taller frame scrolls, and the viewer turns a drag into a scroll of the whole screen)
    expect([present.width, present.height]).toEqual([UI_W, UI_H]);
    expect(UI_W / UI_H).toBeCloseTo(16 / 9, 2);
    // the gates are one button away: the Design panel's blue button jumps to them
    const toMachine = kid(kid(kid(present, "editor"), "design"), "button/machine")!;
    expect(toMachine.reactions.map((r) => r.trigger?.type)).toEqual(["ON_CLICK"]);
    // the machine: every gate as a lamp, bound to its output; the circuit: a window over the drawing
    const machine = kid(p, MACHINE)!;
    const lamps = kid(machine, "gate map")!.children.flatMap((b) =>
      b.children.filter((c) => c.name.startsWith("gate/")),
    );
    expect(lamps).toHaveLength(stats.gates);
    expect(lamps.every((l) => l.boundVariables.visible)).toBe(true);
    // all of them on one screen: the map fits the frame's window (which clips)
    expect(kid(machine, "gate map")!.height).toBeLessThanOrEqual(UI_H);
    const circuit = kid(p, CIRCUIT)!;
    const view = kid(circuit, "view")!;
    expect(view.overflowDirection).toBe("BOTH");
    expect(kid(view, `cell/${TOP}`)?.type).toBe("COMPONENT");
    const nav = (from: FakeNode, to: FakeNode) =>
      reactionsUnder(from).some(({ r }) =>
        r.actions?.some(
          (a) =>
            a.type === "NODE" &&
            a.destinationId === to.id &&
            String(a.navigation) === "NAVIGATE",
        ),
      );
    expect(nav(present, machine) && nav(machine, present)).toBe(true);
    expect(nav(machine, circuit) && nav(circuit, machine)).toBe(true);
    expect(p.flowStartingPoints).toContainEqual({
      nodeId: present.id,
      name: FLOW,
    });
    const colls = fig.collections.map((c) => c.name);
    expect(colls).toContain(COLLECTION);
    expect(colls).toContain(UI_COLLECTION);
    expect(
      Math.max(...fig.collections.map((c) => c.vars.length)),
    ).toBeLessThanOrEqual(5000);
    expect(overlaps(p)).toEqual([]);
  }, 600_000);

  it("stores only reactions Figma desktop takes, each control one event", () => {
    const present = kid(page(fig)!, PRESENT)!;
    const all = reactionsUnder(present);
    expect(
      all.filter(
        ({ r }) =>
          r.trigger?.type === "MOUSE_ENTER" && "deprecatedVersion" in r.trigger,
      ),
    ).toEqual([]);
    const mixed = [...new Set(all.map(({ node }) => node))].filter((n) => {
      const types = n.reactions.map((r) => r.trigger?.type);
      return (
        types.includes("ON_CLICK") &&
        (types.includes("MOUSE_DOWN") || types.includes("MOUSE_UP"))
      );
    });
    expect(mixed.map((n) => n.name)).toEqual([]);
    const hover = all.filter(({ r }) => r.trigger?.type === "MOUSE_ENTER");
    // every cell of the six click-layer sets stores the pointer's column on hover (the pen-down
    // set's strokes too)
    expect(hover).toHaveLength(6 * 14 * 10);
    // a stroke cell: its hover and its release ink it, its press lifts the pen, all a few actions
    const canvasNode = kid(kid(present, "editor"), "canvas")!;
    const penDown = kid(canvasNode, "hot/pen-down")!;
    const cell = kid(kid(penDown, "row/3"), "cell/5")!;
    expect(cell.reactions.map((r) => r.trigger?.type).sort()).toEqual([
      "MOUSE_DOWN",
      "MOUSE_ENTER",
      "MOUSE_UP",
    ]);
    for (const r of cell.reactions) expect(size(r.actions ?? [])).toBeLessThan(40);
    // the canvas takes presses and releases apart, never a click (a drag is one gesture); the
    // panels take clicks
    const onCanvas = new Set(reactionsUnder(canvasNode).map(({ r }) => r));
    expect(
      all.filter(
        ({ r }) => r.trigger?.type === "ON_CLICK" && onCanvas.has(r),
      ),
    ).toEqual([]);
    expect(
      all.filter(
        ({ r }) =>
          (r.trigger?.type === "MOUSE_DOWN" || r.trigger?.type === "MOUSE_UP") &&
          !onCanvas.has(r),
      ),
    ).toEqual([]);
    // every control is one event of at most 700 actions: no reaction needs the overlays
    const c = events(fig, 700);
    expect(c.chained).toBe(0);
    // the warm-up: once, when the editor first shows
    const warm = present.reactions.filter(
      (r) => r.trigger?.type === "AFTER_TIMEOUT",
    );
    expect(warm).toHaveLength(1);
    expect(size(warm[0].actions ?? [])).toBeLessThanOrEqual(700);
    // shortcuts: on each frame, and D [ ] and the arrows on the 8 key layers the selection picks, one per slot
    const codes = (rs: readonly Reaction[]) =>
      rs
        .flatMap((r) =>
          r.trigger?.type === "ON_KEY_DOWN" ? [...r.trigger.keyCodes] : [],
        )
        .sort((a, b) => a - b);
    for (const name of [PRESENT, MACHINE, CIRCUIT]) {
      const f = kid(page(fig)!, name)!;
      expect(codes(f.reactions), name).toEqual([
        8, 27, 46, 67, 69, 70, 79, 80, 82, 86,
      ]);
      const leaves = reactionsUnder(f)
        .filter(({ node }) => /^keys\/\d$/.test(node.name))
        .map(({ node }) => node);
      const slots = [...new Set(leaves)];
      expect(slots.map((n) => n.name).sort(), name).toEqual(
        Array.from({ length: 8 }, (_, k) => `keys/${k}`),
      );
      for (const leaf of slots)
        expect(codes(leaf.reactions), `${name} ${leaf.name}`).toEqual([
          37, 38, 39, 40, 68, 219, 221,
        ]);
    }
  });

  it("Self-test: a random user session through the stored reactions matches the editor spec", async () => {
    await s.app.handle({ type: "selftest", events: 300, seed: 1 });
    const r = s.posted.find((m) => m.type === "selftest");
    expect(r?.type === "selftest" && r.result.text).toMatch(/^✓/);
    expect(r?.type === "selftest" && r.result.ok).toBe(true);
    // the session drew with the pen: strokes, Erase and Clear, through their stored reactions
    const used = r?.type === "selftest" ? /used: ([^;]*);/.exec(r.result.text)![1].split(", ") : [];
    expect(used).toEqual(expect.arrayContaining(["paint", "erase", "clear", "click", "tool"]));
    expect(s.errors()).toEqual([]);
  }, 600_000);

  it("Platform tests are built beside it, and the editor's flow stays", async () => {
    const tests = await s.app.platform();
    expect(s.errors()).toEqual([]);
    expect(tests).toHaveLength(13);
    const p = page(fig)!;
    const frames = p.children.filter((n) => n.name.startsWith(TEST_PREFIX));
    expect(frames).toHaveLength(13);
    const flows = p.flowStartingPoints.map((f) => f.name);
    expect(flows).toContain(FLOW);
    expect(flows.filter((f) => f.startsWith(TEST_PREFIX))).toHaveLength(13);
    expect(overlaps(p)).toEqual([]);
  }, 120_000);

  it("Clean keeps the hardware; a second Build the OS works again", async () => {
    await s.app.clean();
    const p = page(fig)!;
    expect(kid(p, PRESENT)).toBeNull();
    expect(kid(p, MACHINE)).toBeNull();
    expect(kid(p, CIRCUIT)).toBeNull();
    expect(p.children.some((n) => n.name.startsWith(CHAIN_PREFIX))).toBe(false);
    expect(p.children.some((n) => n.name.startsWith(TEST_PREFIX))).toBe(false);
    expect(kid(p, `cell/${TOP}`)?.type).toBe("COMPONENT");
    expect(
      fig.collections.filter((c) =>
        [COLLECTION, UI_COLLECTION, TEST_COLLECTION].includes(c.name),
      ),
    ).toEqual([]);
    // a smaller budget, and every identity gate its own action: reactions too long for one event
    // run as a few, the same machine
    const before = chains(page(fig)!).frames.length;
    expect(before).toBe(0);
    await s.app.os({ latch: "auto", budget: 400, alias: false });
    const c = chains(page(fig)!);
    const e = events(fig, 400);
    expect(e.chained).toBeGreaterThan(0);
    expect(e.written).toBeGreaterThan(0); // the early events do compute
    const present = kid(page(fig)!, PRESENT)!;
    // here some chains are three events, so overlays swap: Figma made flows of them, the build removed them
    const swaps = c.frames.filter((f) => {
      const last = lastOf(f.reactions[0]?.actions);
      return last?.type === "NODE" && String(last.navigation) === "SWAP";
    });
    expect(swaps.length).toBeGreaterThan(0);
    expect(
      page(fig)!.flowStartingPoints.filter((f) => c.ids.has(f.nodeId)),
    ).toEqual([]);
    expect(
      present.reactions.filter((r) => r.trigger?.type === "ON_KEY_DOWN"),
    ).toHaveLength(10);
    const r = await s.app.selftest(200, 7);
    expect(r.text).toMatch(/^✓/);
    expect(s.errors()).toEqual([]);
  }, 600_000);

  it("at 700 every control is one event whatever the latches", async () => {
    // a reaction too long with gate-level latches is made again with Q = D, still for its slot
    for (const latch of ["gates", "compact"] as const) {
      await s.app.os({ latch, budget: 700, alias: true });
      expect(events(fig, 700).chained, latch).toBe(0);
      expect(s.errors()).toEqual([]);
    }
    const r = await s.app.selftest(100, 3);
    expect(r.text).toMatch(/^✓/);
  }, 600_000);
});

describe("CPU NATHAN on a Starter-plan file", () => {
  it("renames an empty page when Figma refuses a new one", async () => {
    const fig = new FakeFigma(["Silicon", "Page 2"]);
    fig.createPage = () => {
      throw new Error(
        "in createPage: The Starter plan only comes with 3 pages. Upgrade to Professional for unlimited pages.",
      );
    };
    // "Silicon" holds something already; "Page 2" is empty
    install(fig);
    fig.createRectangle().name = "existing work";
    const s = session(fig);
    await s.app.handle({ type: "hardware", gateLabels: false, redraw: false });
    expect(s.errors()).toEqual([]);
    expect(fig.root.children.map((p) => p.name)).toEqual([
      "Silicon",
      PAGE_NAME,
    ]);
    expect(fig.root.children[0].children.map((n) => n.name)).toEqual([
      "existing work",
    ]);
    expect(kid(page(fig), `cell/${TOP}`)).not.toBeNull();
  }, 600_000);
});
