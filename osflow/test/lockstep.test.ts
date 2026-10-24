// The flow against the reducer it was written from. Random sequences of editor actions run on
// os-ui's `reduce` and, as the UI events that cause them, on the flow's interpreter. After every
// single action the flow's variables must read back as exactly the reducer's state.
//
// os-ui is still changing, so this suite is also the alarm that the flow is out of date: when the
// reducer's behaviour moves, the first failing run names the actions that expose it.
import { describe, expect, it } from "vitest";
import { decode, viewOf } from "../src/codec";
import { buildEditor } from "../src/editor";
import { Machine } from "../src/interp";
import { WORLD } from "../src/spec";
import { MAX_LAYERS, PALETTE } from "../src/spec";
import { initialState, type Action } from "../../os-ui/src/model";
import { lockstep, replay } from "./support";

describe("lockstep with the os-ui reducer", () => {
  it("starts in the reducer's initial state", () => {
    const m = new Machine(buildEditor());
    expect(decode(m.vars, 40)).toEqual(viewOf(initialState()));
  });

  for (const K of [40, 3]) {
    it(`matches after every action of 40 random sessions (K = ${K})`, () => {
      let events = 0;
      for (let seed = 1; seed <= 40; seed++)
        events += replay(seed, K, 120).events;
      expect(events).toBeGreaterThan(8000);
    });
  }

  it("covers the paths that matter: full canvas, delete, reorder, clipboard, handles", () => {
    // A directed script, so a regression in a rarely-reached branch cannot hide behind the random runs.
    const m = new Machine(buildEditor());
    const origin = { x: 0, y: 0 };
    const history: string[] = [];
    let s = initialState();
    const step = (a: Action) => {
      const out = lockstep(m, 40, s, a, origin, history);
      expect(out.ran, JSON.stringify(a)).toBe(true);
      s = out.s;
    };
    const drag = (x0: number, y0: number, x1: number, y1: number) => {
      step({ t: "down", x: x0, y: y0 });
      step({ t: "move", x: x1, y: y1 });
      step({ t: "up" });
    };
    // Fill all eight slots, each a different shape and color, then try for a ninth.
    for (let i = 0; i <= MAX_LAYERS; i++) {
      step({ t: "key", key: ["r", "o", "f", "l"][i % 4] });
      step({ t: "fill", color: PALETTE[i % 16] });
      drag(i, 1, i + 2, 4);
    }
    expect(s.layers).toHaveLength(MAX_LAYERS);
    // Delete from the bottom, middle and top while the canvas is full.
    for (const id of [
      s.layers[0].id,
      s.layers[3].id,
      s.layers[s.layers.length - 1].id,
    ]) {
      step({ t: "select", id });
      step({ t: "key", key: "Delete" });
    }
    // Reorder at both ends, then duplicate, copy, cut and paste.
    step({ t: "select", id: s.layers[0].id });
    step({ t: "key", key: "[" });
    step({ t: "key", key: "]" });
    step({ t: "select", id: s.layers[s.layers.length - 1].id });
    step({ t: "key", key: "]" });
    step({ t: "key", key: "d", meta: true });
    step({ t: "key", key: "c", meta: true });
    step({ t: "key", key: "x", meta: true });
    step({ t: "key", key: "v", meta: true });
    // Resize from every handle.
    for (const handle of ["nw", "ne", "sw", "se"] as const) {
      step({ t: "down", x: 0, y: 0, handle });
      step({ t: "move", x: 7, y: 5 });
      step({ t: "up" });
    }
    step({ t: "new" });
    expect(s.layers).toHaveLength(0);
  });

  it("aligns to the smallest containing frame, with ties to the lowest slot", () => {
    const m = new Machine(buildEditor());
    const origin = { x: 0, y: 0 };
    const history: string[] = [];
    let s = initialState();
    const step = (a: Action) => {
      const out = lockstep(m, 40, s, a, origin, history);
      expect(out.ran, JSON.stringify(a)).toBe(true);
      s = out.s;
    };
    const make = (
      key: string,
      shift: boolean,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ) => {
      step({ t: "key", key, shift });
      step({ t: "down", x: x0, y: y0 });
      step({ t: "move", x: x1, y: y1 });
      step({ t: "up" });
    };
    make("f", false, 0, 0, 11, 8); // a big frame
    make("f", false, 2, 2, 9, 6); // a frame inside it
    make("f", false, 2, 2, 9, 6); // an identical twin: the lower slot wins
    make("s", true, 1, 1, 12, 9); // a section around everything but the big frame
    make("r", false, 4, 3, 6, 4); // a rectangle inside all of them
    for (const to of [
      "left",
      "hcenter",
      "right",
      "top",
      "vcenter",
      "bottom",
    ] as const)
      step({ t: "align", to });
    // The twin frames contain each other's box with equal area: the one with the lower id is the other's parent.
    for (const id of [s.layers[1].id, s.layers[2].id]) {
      step({ t: "select", id });
      for (const to of ["left", "hcenter", "bottom"] as const) step({ t: "align", to });
    }
    step({ t: "select", id: s.layers[0].id }); // the big frame has no parent: align does nothing
    step({ t: "align", to: "hcenter" });
    expect(s.layers[0].x).toBe(0);
  });

  it("stops at the edge of the canvas", () => {
    const m = new Machine(buildEditor());
    const origin = { x: 0, y: 0 };
    const history: string[] = [];
    let s = initialState();
    const step = (a: Action) => {
      s = lockstep(m, 40, s, a, origin, history).s;
    };
    step({ t: "key", key: "r" });
    step({ t: "down", x: 3, y: 3 });
    step({ t: "up" });
    // Walk the layer to the far edge and back past the near edge with the x stepper, then grow it.
    for (let i = 0; i < WORLD + 4; i++)
      step({ t: "prop", prop: "x", value: String(s.layers[0].x + 1) });
    expect(s.layers[0].x).toBe(WORLD);
    for (let i = 0; i < 2 * WORLD + 4; i++)
      step({ t: "prop", prop: "x", value: String(s.layers[0].x - 1) });
    expect(s.layers[0].x).toBe(-WORLD);
    for (let i = 0; i < WORLD + 4; i++)
      step({ t: "prop", prop: "w", value: String(s.layers[0].w + 1) });
    expect(s.layers[0].w).toBe(WORLD);
  });
});
