// The CPU tab's chip (src/cpu.ts) beside the reducer: every action fires the chip's events or loads
// the editor's state into it, and afterwards the chip holds exactly what the editor holds, or the
// editor holds something the chip cannot (and the status says what). The nets a step reports are
// exactly the ones whose value changed, and a load lands on the very state the encoder boots.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { representable, stateVars } from "../../osflow/src/codec";
import { pokesFor } from "../../osflow/src/gates/load";
import { synthesize, type Synth } from "../../osflow/src/gates/synthesize";
import { buildEditor } from "../../osflow/src/editor";
import { powerOn } from "../../silicon/src/compile";
import { RAIL } from "../src/chrome";
import { Cpu, actionWords, type CpuStep } from "../src/cpu";
import { chipWindow, cpuPanel, floorplan } from "../src/cpuview";
import { I } from "../src/icons";
import {
  GRID_H,
  GRID_W,
  PALETTE,
  initialState,
  reduce,
  type Action,
  type Corner,
  type State,
  type Tool,
} from "../src/model";

/** A small seeded generator (the one osflow's tests use). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

const CHIP_TOOLS: Tool[] = [
  "move",
  "scale",
  "frame",
  "section",
  "slice",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
];
const OTHER_TOOLS: Tool[] = [
  "hand",
  "pen",
  "paint",
  "erase",
  "text",
  "comment",
];

/** The next gesture of a plausible session: mostly what the chip has events for, sometimes not
 * (a pointer outside its window, a tool it lacks, a typed jump, a rename, an ignored key). */
function gesture(r: Rng, s: State): Action[] {
  const cell = () =>
    r.chance(0.08)
      ? { x: r.int(GRID_W + 12) - 6, y: r.int(GRID_H + 12) - 6 }
      : { x: r.int(GRID_W), y: r.int(GRID_H) };
  const any = r.pick(s.layers.length ? s.layers : [undefined]);
  const sel = s.layers.find((l) => l.id === s.selected);
  const roll = r.int(100);
  if (roll < 34) {
    const out: Action[] = [{ t: "down", ...cell() }];
    for (let i = r.int(4); i > 0; i--) out.push({ t: "move", ...cell() });
    return [...out, { t: "up" }];
  }
  if (roll < 40 && sel) {
    const handle = r.pick(["nw", "ne", "sw", "se"] as Corner[]);
    return [
      { t: "down", ...cell(), handle },
      { t: "move", ...cell() },
      { t: "up" },
    ];
  }
  if (roll < 52)
    return [
      {
        t: "tool",
        tool: r.chance(0.1) ? r.pick(OTHER_TOOLS) : r.pick(CHIP_TOOLS),
      },
    ];
  if (roll < 58)
    return [
      {
        t: "key",
        key: r.pick(["r", "o", "f", "l", "v", "k", "s"]),
        shift: r.chance(0.2),
      },
    ];
  if (roll < 63)
    return [{ t: "select", id: any && r.chance(0.85) ? any.id : null }];
  if (roll < 66 && any) return [{ t: "visible", id: any.id }];
  if (roll < 70) return [{ t: "fill", color: r.pick(PALETTE) }];
  if (roll < 72)
    return [{ t: "stroke", color: r.chance(0.3) ? "" : r.pick(PALETTE) }];
  if (roll < 74) return [{ t: "shadow", on: r.chance(0.5) }];
  if (roll < 80 && sel) {
    const prop = r.pick(["x", "y", "w", "h", "opacity", "radius"] as const);
    const cur = prop === "opacity" ? sel.opacity * 10 : sel[prop];
    const step = prop === "opacity" ? 10 : 1;
    const by = r.chance(0.85) ? r.pick([step, -step]) : r.pick([5, -7]) * step; // a typed jump, now and then
    return [{ t: "prop", prop, value: String(cur + by) }];
  }
  if (roll < 84)
    return [
      {
        t: "align",
        to: r.pick([
          "left",
          "hcenter",
          "right",
          "top",
          "vcenter",
          "bottom",
        ] as const),
      },
    ];
  if (roll < 90)
    return [
      {
        t: "key",
        key: r.pick([
          "Delete",
          "]",
          "[",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Escape",
          "Shift",
          "a",
        ]),
      },
    ];
  if (roll < 96)
    return [{ t: "key", key: r.pick(["d", "c", "x", "v"]), meta: true }];
  if (roll < 98 && any)
    return [{ t: "layer-rename", id: any.id, name: "renamed" }];
  return [{ t: "new" }];
}

/** The nets whose value differs between two snapshots. */
function changed(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

let syn: Synth;
let c: Cpu;
beforeAll(() => {
  syn = synthesize(buildEditor({ target: "hardware" }));
  c = new Cpu();
  c.build(syn);
});

/** Applies `a` to the editor and the chip, and checks the chip's report of it. */
function act(s: State, a: Action): State {
  const values = c.chip!.sim.v.slice();
  const last = c.last;
  const after = reduce(s, a);
  c.step(s, a, after);
  const where = `${JSON.stringify(a)} → ${c.status.text}`;
  expect(c.status.kind, where).not.toBe("bug");
  // The chip holds the editor's state exactly, or the editor holds one the chip cannot.
  if (c.status.kind === "off")
    expect(representable(after), where).not.toBeNull();
  else expect(c.mismatch(after), where).toBeNull();
  // A step is reported exactly when nets changed, and its nets are exactly those.
  const diff = changed(values, c.chip!.sim.v);
  if (c.last === last) expect(diff, where).toEqual([]);
  else {
    expect([...c.last!.nets], where).toEqual(diff);
    // Its gates are the nets a gate drives, and the busiest modules share out every one of them.
    const gates = diff.filter((n) => c.chip!.net.driver[n] >= 0).length;
    expect(c.last!.gates, where).toBe(gates);
    const busy = c.busiest(c.last!.nets);
    expect(
      busy.reduce((n, b) => n + b.switched, 0),
      where,
    ).toBe(gates);
  }
  return after;
}

const IN_STEP =
  "In step: the chip's registers hold exactly what the editor holds.";

describe("the CPU tab's chip", () => {
  it("is the editor's synthesis: 24,893 gates, 738 register bits in 128 registers, every gate in one block", () => {
    expect(c.chip!.syn.stats).toMatchObject({ gates: 24893, registers: 738 });
    expect(c.chip!.syn.regs.size).toBe(128);
    const gates = c.chip!.net.gates.length;
    expect(gates).toBe(24893);
    expect(c.blocks.reduce((n, b) => n + b.gates.length, 0)).toBe(gates);
    const seen = new Uint8Array(gates);
    for (const [k, b] of c.blocks.entries())
      for (const g of b.gates) {
        expect(seen[g]).toBe(0);
        seen[g] = 1;
        expect(c.blockOf[g]).toBe(k);
      }
    const names = Object.fromEntries(c.blocks.map((b) => [b.id, b.name]));
    expect(names).toMatchObject({
      U_parent: "parent search",
      U_hit: "hit test",
      U_align: "align",
      U_handle: "resize handles",
      U_prop: "properties",
      U_drag: "drag",
      U_span: "draw span",
      U_duplicate: "duplicate",
      GLUE: "glue logic",
      EVDEC: "event decoder",
      REG: "registers",
    });
    expect(c.blocks.find((b) => b.id === "REG")!.gates.length).toBe(738 * 10);
    expect(c.status.kind).toBe("step");
    expect(c.timing.boot).toBeGreaterThan(0);
  });

  it("fires a drawn rectangle as gate events, one tick each, and stays in step", () => {
    let s = initialState();
    c.sync(s, "New");
    s = act(s, { t: "tool", tool: "rect" });
    expect(c.last!.fired.map((f) => f.id)).toEqual(["tool/rect#click"]);
    expect(c.last!.words).toBe("Rectangle tool");
    s = act(s, { t: "down", x: 2, y: 3 });
    expect(c.last!.fired).toEqual([
      {
        id: "pointer#down",
        code: syn.codes.get("pointer#down"),
        inputs: { "in/px": 2, "in/py": 3 },
      },
    ]);
    s = act(s, { t: "move", x: 6, y: 5 });
    expect(c.last!.fired[0].id).toBe("pointer#enter");
    // The same cell again changes no net: nothing new to show.
    const moved = c.last;
    s = act(s, { t: "move", x: 6, y: 5 });
    expect(c.last).toBe(moved);
    s = act(s, { t: "up" });
    expect(s.layers).toMatchObject([{ kind: "rect", x: 2, y: 3, w: 5, h: 3 }]);
    expect(c.status).toEqual({
      kind: "step",
      text: "In step: the chip's registers hold exactly what the editor holds.",
    });
    const step = c.last as CpuStep;
    expect(step.loaded).toBe(false);
    expect(step.gates).toBeGreaterThan(0);
    // The busiest modules account for every gate that switched.
    const busy = c.busiest(step.nets);
    expect(busy.reduce((n, b) => n + b.switched, 0)).toBe(step.gates);
    expect(busy.map((b) => b.switched)).toEqual(
      [...busy.map((b) => b.switched)].sort((a, b) => b - a),
    );
  });

  it("flashes something for every edit, and exactly the nets that changed", () => {
    let s = initialState();
    c.sync(s, "New");
    const edits: Action[] = [
      { t: "key", key: "f" },
      { t: "down", x: 0, y: 0 },
      { t: "move", x: 9, y: 7 },
      { t: "up" },
      { t: "key", key: "r" },
      { t: "down", x: 2, y: 2 },
      { t: "up" },
      { t: "fill", color: PALETTE[8] },
      { t: "key", key: "ArrowRight" },
      { t: "prop", prop: "w", value: "2" },
      { t: "align", to: "right" },
      { t: "stroke", color: PALETTE[1] },
      { t: "shadow", on: true },
      { t: "key", key: "d", meta: true },
      { t: "key", key: "c", meta: true },
      { t: "key", key: "v", meta: true },
      { t: "key", key: "[" },
      { t: "visible", id: 1 },
      { t: "select", id: 1 },
      { t: "key", key: "Delete" },
      { t: "key", key: "Escape" },
      { t: "new" },
    ];
    for (const a of edits) {
      const last = c.last;
      s = act(s, a);
      expect(c.last, JSON.stringify(a)).not.toBe(last);
      expect(c.last!.loaded, JSON.stringify(a)).toBe(false);
      expect(c.last!.nets.length, JSON.stringify(a)).toBeGreaterThan(0);
      expect(c.last!.gates, JSON.stringify(a)).toBeGreaterThan(0);
    }
    expect(s.layers).toEqual([]);
  });

  it("stays in step over 24 seeded random sessions, firing most actions and loading the rest", () => {
    let fired = 0;
    let loaded = 0;
    let off = 0;
    let actions = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const r = rng(seed);
      let s = initialState();
      c.sync(s, "New");
      const history: State[] = [s];
      for (let i = 0; i < 90; i++) {
        for (const a of gesture(r, s)) {
          const last = c.last;
          s = act(s, a);
          actions++;
          if (c.status.kind === "off") off++;
          else if (c.last !== last) c.last!.loaded ? loaded++ : fired++;
        }
        history.push(s);
        if (r.chance(0.04)) {
          // Undo or redo: the editor puts back an older state.
          s = history[r.int(history.length)];
          c.sync(s, "Undo");
          if (c.status.kind === "off") expect(representable(s)).not.toBeNull();
          else expect(c.mismatch(s)).toBeNull();
        }
      }
    }
    expect(actions).toBeGreaterThan(24 * 90);
    expect(fired).toBeGreaterThan(actions * 0.6);
    expect(loaded).toBeGreaterThan(20);
    expect(off).toBeGreaterThan(0);
  });

  it("resyncs when undo puts back an older file, landing on exactly the state the encoder boots", () => {
    let s = initialState();
    c.sync(s, "New");
    for (const a of [
      { t: "key", key: "o" },
      { t: "down", x: 1, y: 1 },
      { t: "move", x: 4, y: 3 },
      { t: "up" },
    ] as Action[])
      s = act(s, a);
    const older = s;
    for (const a of [
      { t: "key", key: "d", meta: true },
      { t: "key", key: "ArrowDown" },
    ] as Action[])
      s = act(s, a);
    c.sync(older, "Undo");
    expect(c.status).toEqual({
      kind: "resync",
      text: "Resynced because undo replaced the file.",
    });
    expect(c.last).toMatchObject({ words: "Undo", loaded: true, fired: [] });
    expect(c.mismatch(older)).toBeNull();
    const booted = powerOn(c.chip!.net, pokesFor(syn, stateVars(older)));
    expect(changed(booted, c.chip!.sim.v)).toEqual([]);
    // It goes on from there as if it had computed it: the next edit fires again.
    act(older, { t: "key", key: "ArrowLeft" });
    expect(c.status.kind).toBe("step");
    expect(c.last!.loaded).toBe(false);
  });

  it("says why when it loads instead of computing, and when it can't hold the file", () => {
    let s = initialState();
    c.sync(s, "New");
    const go = (a: Action) => (s = act(s, a));
    go({ t: "key", key: "r" });
    go({ t: "down", x: 2, y: 2 });
    go({ t: "up" });
    // A typed value the steppers can't reach in one press.
    go({ t: "prop", prop: "x", value: "9" });
    expect(c.status).toEqual({
      kind: "resync",
      text: "Resynced because the typed X jumps from 2 to 9, and the chip's steppers move by one.",
    });
    expect(s.layers[0].x).toBe(9);
    // A rename has no event, and needs none: the chip holds no title.
    const named = c.last;
    go({ t: "title", name: "Chip test" });
    expect(c.status.text).toBe(IN_STEP);
    expect(c.last).toBe(named);
    // A rotated layer fits no register: the chip can't hold the file until it's turned back.
    go({ t: "prop", prop: "rotation", value: "90" });
    expect(c.status).toEqual({
      kind: "off",
      text: "Can't hold this file yet: layer 1: rotated 90°; the chip has no rotation.",
    });
    go({ t: "prop", prop: "rotation", value: "0" });
    expect(c.status).toEqual({
      kind: "resync",
      text: "Resynced because the file fits the chip again.",
    });
    // Text: the chip has no Text tool, and then the file holds a text layer.
    go({ t: "key", key: "t" });
    expect(c.status.kind).toBe("step");
    go({ t: "down", x: 5, y: 5 });
    expect(c.status).toEqual({
      kind: "off",
      text: `Can't hold this file yet: layer 2: text layers aren't on the chip yet.`,
    });
    const was = c.last;
    go({ t: "key", key: "Escape" });
    expect(c.status.kind).toBe("off");
    expect(c.last).toBe(was);
    go({ t: "select", id: 2 });
    go({ t: "key", key: "Delete" });
    expect(c.status).toEqual({
      kind: "resync",
      text: "Resynced because the file fits the chip again.",
    });
    // Paint: a stroke in progress, then painted cells.
    go({ t: "tool", tool: "paint" });
    go({ t: "down", x: 1, y: 1 });
    expect(c.status.text).toBe(
      "Can't hold this file yet: the drag: a Paint stroke is being drawn.",
    );
    go({ t: "up" });
    expect(c.status.text).toBe(
      "Can't hold this file yet: 1 painted cell; the chip holds no paint.",
    );
    go({ t: "new" });
    expect(c.status.kind).toBe("resync");
    expect(c.mismatch(s)).toBeNull();
  });

  it("does not compute a pointer outside its 14 x 10 window: it says so and loads the result", () => {
    let s = initialState();
    c.sync(s, "New");
    const go = (a: Action) => (s = act(s, a));
    go({ t: "key", key: "r" });
    go({ t: "down", x: 20, y: 3 });
    expect(c.status).toEqual({
      kind: "resync",
      text: "Resynced because the pointer at 20, 3 is outside the chip's 14 × 10 window, so the chip didn't compute it.",
    });
    expect(c.last).toMatchObject({ words: "Press at 20, 3", loaded: true });
    go({ t: "move", x: -2, y: 12 });
    expect(c.status.text).toContain(
      "the pointer at -2, 12 is outside the chip's 14 × 10 window",
    );
    // Back inside, the chip computes the drag on from the state it was loaded with.
    go({ t: "move", x: 4, y: 4 });
    expect(c.status.kind).toBe("step");
    expect(c.last!.fired).toEqual([
      {
        id: "pointer#enter",
        code: syn.codes.get("pointer#enter"),
        inputs: { "in/px": 4, "in/py": 4 },
      },
    ]);
    go({ t: "up" });
    expect(s.layers).toMatchObject([{ x: 4, y: 3, w: 17, h: 2 }]);
    expect(c.mismatch(s)).toBeNull();
  });

  it("fires nothing for a key the editor ignores, and keeps the last event", () => {
    let s = initialState();
    c.sync(s, "New");
    s = act(s, { t: "key", key: "o" });
    const last = c.last;
    for (const key of ["Shift", "a", "Enter"]) {
      s = act(s, { t: "key", key });
      expect(c.last).toBe(last);
      expect(c.status.kind).toBe("step");
    }
    // ⇧+arrow nudges in the reducer, but the chip only has the plain arrows: it loads the result.
    s = act(s, { t: "down", x: 3, y: 3 });
    s = act(s, { t: "up" });
    s = act(s, { t: "key", key: "ArrowLeft", shift: true });
    expect(c.status.text).toBe(
      "Resynced because the chip has no event key/shift+ArrowLeft#key.",
    );
  });

  it("steps a typed value as the reducer took it: a cleared field changes nothing, 90% is one step", () => {
    let s = initialState();
    c.sync(s, "New");
    const go = (a: Action) => (s = act(s, a));
    go({ t: "key", key: "r" });
    go({ t: "down", x: 1, y: 1 });
    go({ t: "up" });
    go({ t: "prop", prop: "radius", value: "1" });
    // Blank, a space, not a number: the reducer keeps the value, so there is nothing to fire
    // (the text as a number, 0, would be one step down from 1 and put the chip out of step).
    const kept = c.last;
    for (const [prop, value] of [
      ["x", ""],
      ["y", " "],
      ["radius", ""],
      ["opacity", ""],
      ["x", "abc"],
    ] as const) {
      go({ t: "prop", prop, value });
      expect(c.status.text, `${prop} "${value}"`).toBe(IN_STEP);
      expect(c.last, `${prop} "${value}"`).toBe(kept);
    }
    // The Opacity field shows "100%": 90% is one step down. 2.4 rounds to one step right.
    go({ t: "prop", prop: "opacity", value: "90%" });
    expect(c.last!.fired.map((f) => f.id)).toEqual(["prop/opacity/dec#click"]);
    go({ t: "prop", prop: "x", value: "2.4" });
    expect(c.last!.fired.map((f) => f.id)).toEqual(["prop/x/inc#click"]);
    expect(s.layers[0]).toMatchObject({ x: 2, y: 1, opacity: 9, radius: 1 });
  });

  it("releases the pointer where it is: no stand-in cell, so the hit test stays quiet", () => {
    let s = initialState();
    c.sync(s, "New");
    for (const a of [
      { t: "key", key: "r" },
      { t: "down", x: 2, y: 2 },
      { t: "move", x: 6, y: 5 },
      { t: "up" },
    ] as Action[])
      s = act(s, a);
    expect(c.last!.fired).toEqual([
      { id: "pointer#up", code: syn.codes.get("pointer#up"), inputs: {} },
    ]);
    const pin = (name: string) => c.chip!.sim.get(syn.inputs.get(name)!.port);
    expect([pin("in/px"), pin("in/py")]).toEqual([6, 5]);
    expect(c.busiest(c.last!.nets).map((b) => b.block.id)).not.toContain(
      "U_hit",
    );
    expect(s.layers).toMatchObject([{ kind: "rect", x: 2, y: 2, w: 5, h: 4 }]);
  });

  it("loads nothing for a rename, which changes nothing the chip holds", () => {
    let s = initialState();
    c.sync(s, "New");
    const go = (a: Action) => (s = act(s, a));
    // A deleted layer leaves its slot and the drag's anchors at old values, which a load rewrites.
    for (const a of [
      { t: "key", key: "r" },
      { t: "down", x: 1, y: 1 },
      { t: "move", x: 4, y: 3 },
      { t: "up" },
      { t: "key", key: "Delete" },
      { t: "key", key: "o" },
      { t: "down", x: 6, y: 2 },
      { t: "up" },
    ] as Action[])
      go(a);
    const last = c.last;
    go({ t: "title", name: "Plans" });
    go({ t: "layer-rename", id: s.layers[0].id, name: "Logo" });
    expect(c.last).toBe(last);
    expect(c.status.text).toBe(IN_STEP);
    expect([s.title, s.layers[0].name]).toEqual(["Plans", "Logo"]);
    // Opening another file is a load, and says why.
    go({ t: "load", doc: { title: "Other", layers: [], nextId: 1 } });
    expect(c.status.text).toBe(
      "Resynced because the chip has no event for opening a file.",
    );
    expect(c.last).toMatchObject({ words: "Open file", loaded: true });
  });

  it("compares the tool flags too, which the decoded view leaves out", () => {
    let s = initialState();
    c.sync(s, "New");
    s = act(s, { t: "key", key: "r" });
    // Every register decode() reads agrees; g/tCreate says the Rectangle tool draws nothing.
    c.chip!.load(new Map(stateVars(s)).set("g/tCreate", false));
    expect(c.mismatch(s)).toBe(
      "g/tCreate is false on the chip, true in the editor",
    );
    c.sync(s, "Undo");
    expect(c.mismatch(s)).toBeNull();
  });

  it("says it is out of step when the chip computes something else than the editor", () => {
    let s = initialState();
    c.sync(s, "New");
    for (const a of [
      { t: "key", key: "r" },
      { t: "down", x: 2, y: 2 },
      { t: "up" },
    ] as Action[])
      s = act(s, a);
    // A fault on the chip: its layer is at x 5, the editor's at 2.
    c.chip!.load(new Map(stateVars(s)).set("L0/x", 5));
    const a: Action = { t: "key", key: "ArrowRight" };
    const after = reduce(s, a);
    c.step(s, a, after);
    expect(c.status).toEqual({
      kind: "bug",
      text: "Out of step after Right arrow key: the state.layers[0].x is 6 on the chip, 3 in the editor. Resynced.",
    });
    expect(c.last).toMatchObject({ words: "Right arrow key", loaded: true });
    expect(c.mismatch(after)).toBeNull();
  });

  it("notices an editor state it wasn't told about, and loads it instead of computing", () => {
    let s = initialState();
    c.sync(s, "New");
    for (const a of [
      { t: "key", key: "r" },
      { t: "down", x: 2, y: 2 },
      { t: "up" },
    ] as Action[])
      s = act(s, a);
    // Another object with the same contents is the state the chip holds: it computes on.
    s = act(structuredClone(s), { t: "key", key: "ArrowRight" });
    expect(c.status.text).toBe(IN_STEP);
    expect(c.last!.loaded).toBe(false);
    // Changed with no step or sync: computing from what the chip holds would be wrong.
    s = { ...s, layers: s.layers.map((l) => ({ ...l, x: l.x + 3 })) };
    s = act(s, { t: "key", key: "ArrowRight" });
    expect(c.status).toEqual({
      kind: "resync",
      text: "Resynced because the editor changed without a chip event.",
    });
    expect(s.layers[0].x).toBe(7);
  });

  it("keeps and schedules nothing before start(), which the CPU tab's first showing calls", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const idle = new Cpu();
      let s = initialState();
      for (const a of [
        { t: "key", key: "r" },
        { t: "down", x: 1, y: 1 },
        { t: "up" },
      ] as Action[]) {
        const after = reduce(s, a);
        idle.step(s, a, after);
        s = after;
      }
      idle.sync(s, "Undo");
      expect(vi.getTimerCount()).toBe(0);
      idle.start(s);
      vi.runAllTimers();
      // Built at the editor's state then, with nothing from before to replay.
      expect(idle.status).toEqual({
        kind: "resync",
        text: "Resynced because the editor was already past its initial state.",
      });
      expect(idle.last).toMatchObject({ words: "Start", loaded: true });
      expect(idle.mismatch(s)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting when its build fails, and the panel says there is no chip", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const failed = new Cpu();
      failed.build = () => {
        throw new Error("out of memory");
      };
      let s = initialState();
      failed.start(s);
      vi.runAllTimers();
      expect(failed.status).toEqual({
        kind: "bug",
        text: "The chip stopped: out of memory.",
      });
      for (let i = 0; i < 40; i++) {
        const a: Action = { t: "key", key: i % 2 ? "r" : "o" };
        const after = reduce(s, a);
        failed.step(s, a, after);
        s = after;
      }
      // Nothing waits for a chip that won't come (the queue is private: looked at directly).
      expect((failed as unknown as { pending: unknown[] }).pending).toEqual([]);
      const html = cpuPanel(failed);
      expect(html).toContain(">not built</span>");
      expect(html).toContain('<div class="cpu-wait">No chip to show.</div>');
      expect(html).not.toContain("building…");
      expect(html).not.toContain("Building the chip…");
    } finally {
      vi.useRealTimers();
    }
  });

  it("buffers the actions before it is built, then builds off the first paint and catches up", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const late = new Cpu();
      let s = initialState();
      late.start(s);
      expect(late.chip).toBeNull();
      expect(late.status.kind).toBe("wait");
      for (const a of [
        { t: "key", key: "r" },
        { t: "down", x: 1, y: 1 },
        { t: "move", x: 3, y: 2 },
        { t: "up" },
      ] as Action[]) {
        const after = reduce(s, a);
        late.step(s, a, after);
        s = after;
      }
      expect(late.chip).toBeNull();
      vi.runAllTimers();
      expect(late.chip).not.toBeNull();
      expect(late.timing.synth).toBeGreaterThan(0);
      expect(late.status.kind).toBe("step");
      expect(late.mismatch(s)).toBeNull();
      expect(late.last).toMatchObject({ words: "Release", loaded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts every action into words", () => {
    const s = reduce(
      reduce(reduce(initialState(), { t: "key", key: "r" }), {
        t: "down",
        x: 1,
        y: 1,
      }),
      { t: "up" },
    );
    const words = (a: Action) => actionWords(s, a);
    expect(words({ t: "tool", tool: "rect" })).toBe("Rectangle tool");
    expect(words({ t: "down", x: 3, y: 4 })).toBe("Press at 3, 4");
    expect(words({ t: "down", x: 0, y: 0, handle: "se" })).toBe(
      "Press the bottom-right handle",
    );
    expect(words({ t: "move", x: 5, y: 6 })).toBe("Drag to 5, 6");
    expect(words({ t: "up" })).toBe("Release");
    expect(words({ t: "key", key: "d", meta: true })).toBe("⌘D");
    expect(words({ t: "key", key: "l", shift: true })).toBe("⇧L key");
    expect(words({ t: "key", key: "ArrowLeft" })).toBe("Left arrow key");
    expect(words({ t: "select", id: 1 })).toBe("Select Rectangle 1");
    expect(words({ t: "visible", id: 1 })).toBe("Hide Rectangle 1");
    expect(words({ t: "fill", color: "#ff004d" })).toBe("Fill FF004D");
    expect(words({ t: "align", to: "hcenter" })).toBe(
      "Align horizontal centers",
    );
    expect(words({ t: "prop", prop: "opacity", value: "50%" })).toBe(
      "Opacity 50%",
    );
    expect(words({ t: "new" })).toBe("New file");
  });
});

describe("the CPU tab", () => {
  it("sits on the rail after File, Assets and Tools, with lucide's Cpu icon", () => {
    expect(RAIL.map((r) => r.id)).toEqual(["file", "assets", "tools", "cpu"]);
    expect(RAIL[3]).toEqual({ id: "cpu", label: "CPU", icon: I.cpu });
    expect(I.cpu).toContain("<svg");
  });

  it("shows the chip's size, the map, the legend, the last event and the status", () => {
    let s = initialState();
    c.sync(s, "New");
    s = act(s, { t: "tool", tool: "rect" });
    const html = cpuPanel(c);
    expect(html).toContain('<div class="section-title"><span>CPU</span>');
    expect(html).toContain(">24,893 gates · 738 register bits</span>");
    expect(html).toContain("<canvas");
    expect(html).toContain("operations</span>");
    expect(html).toContain("registers</span>");
    expect(html).toContain("control</span>");
    expect(html).toContain("Last event");
    expect(html).toContain(
      'Rectangle tool <span class="dim">→</span> <code>tool/rect#click</code>',
    );
    expect(html).toMatch(/EVT \d+ · [\d,]+ gates switched/);
    expect(html).toContain("Busiest modules");
    expect(html).toContain(
      "In step: the chip's registers hold exactly what the editor holds.",
    );
    // Before the chip is built, it says so.
    const fresh = cpuPanel(new Cpu());
    expect(fresh).toContain(">building…</span>");
    expect(fresh).toContain("Building the chip…");
    expect(fresh).not.toContain("Last event");
  });

  it("outlines the chip's 14 x 10 window on the editor canvas", () => {
    expect(chipWindow(10)).toBe(
      `<div class="chip-window" style="width:${GRID_W * 10}px;height:${GRID_H * 10}px"><span>CPU window · 14 × 10 cells</span></div>`,
    );
  });

  it("gives every gate its own dot inside its block, at every pixel density", () => {
    const counts = c.blocks.map((b) => b.gates.length);
    for (const dpr of [1, 1.5, 2, 3]) {
      const W = Math.round(224 * dpr);
      const pitch = Math.max(2, Math.round(1.5 * dpr));
      const dot = pitch - 1;
      // Label widths as Inter measures them, about 5.5px a character at 9px.
      const names = c.blocks.map((b) => b.name.length * 5.5 * dpr);
      const { plots, height } = floorplan(counts, names, W, pitch, dpr);
      const taken = new Uint8Array(W * height);
      plots.forEach((p, k) => {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(W);
        expect(p.y + p.h).toBeLessThanOrEqual(height);
        for (let i = 0; i < counts[k]; i++) {
          const x = p.gx + (i % p.cols) * pitch;
          const y = p.gy + Math.floor(i / p.cols) * pitch;
          // Inside the block, below its label.
          expect(
            x >= p.x &&
              y >= p.y + p.label &&
              x + dot <= p.x + p.w &&
              y + dot <= p.y + p.h,
            `${dpr}x block ${k} gate ${i}`,
          ).toBe(true);
          for (let dy = 0; dy < dot; dy++)
            for (let dx = 0; dx < dot; dx++) {
              const at = (y + dy) * W + x + dx;
              if (taken[at]) expect.fail(`${dpr}x: two dots on pixel ${at}`);
              taken[at] = 1;
            }
        }
      });
      // Blocks keep a gap between them.
      for (const a of plots)
        for (const b of plots)
          if (a !== b)
            expect(
              a.x + a.w <= b.x ||
                b.x + b.w <= a.x ||
                a.y + a.h <= b.y ||
                b.y + b.h <= a.y,
            ).toBe(true);
      // The four biggest blocks are labelled, and the map stays short enough for the panel.
      expect(
        plots.slice(0, 4).every((p) => p.label > 0),
        `${dpr}x`,
      ).toBe(true);
      expect(height / dpr).toBeLessThan(dpr >= 2 ? 440 : 640);
    }
  });
});
