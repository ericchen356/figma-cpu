// The flow against the reducer it was written from. Random sequences of editor actions run on
// os-ui's `reduce` and, as the UI events that cause them, on the flow's interpreter. After every
// single action the flow's variables must read back as exactly the reducer's state.
import { describe, expect, it } from "vitest";
import { decode, eventsFor, viewOf } from "../src/codec";
import { buildEditor } from "../src/editor";
import { Machine } from "../src/interp";
import {
  CREATE_TOOLS,
  ELLIPSE_RR,
  GRID_H,
  GRID_W,
  MAX_LAYERS,
  PALETTE,
  TOOL_KEYS,
  type Tool,
} from "../src/spec";
import {
  getSelected,
  initialState,
  reduce,
  type Action,
  type State,
} from "../../os-ui/src/model";

// ---------- a small seeded generator ----------

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
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

/** Tools the flow implements. */
const TOOLS_OK: Tool[] = ["move", "hand", "scale", ...CREATE_TOOLS];
const KEY_FOR: Partial<Record<Tool, string>> = {};
for (const [shortcut, tool] of Object.entries(TOOL_KEYS))
  KEY_FOR[tool] ??= shortcut;

/** The next batch of actions: a drag gesture, a panel click or a key. */
function actions(r: ReturnType<typeof rng>, s: State): Action[] {
  const cell = () => ({ x: r.int(GRID_W), y: r.int(GRID_H) });
  const sel = getSelected(s);
  const any = r.pick(s.layers.length ? s.layers : [undefined]);
  const roll = r.next();
  if (roll < 0.34) {
    const a = cell();
    const out: Action[] = [{ t: "down", ...a }];
    for (let i = r.int(4); i > 0; i--) out.push({ t: "move", ...cell() });
    out.push({ t: "up" });
    return out;
  }
  if (roll < 0.4 && sel) {
    const corner = r.pick(["nw", "ne", "sw", "se"] as const);
    return [
      { t: "down", ...cell(), handle: corner },
      { t: "move", ...cell() },
      { t: "move", ...cell() },
      { t: "up" },
    ];
  }
  if (roll < 0.52) {
    const tool = r.pick(TOOLS_OK);
    const shortcut = KEY_FOR[tool];
    if (shortcut && r.chance(0.6)) {
      const shift = shortcut.startsWith("shift+");
      return [{ t: "key", key: shift ? shortcut.slice(6) : shortcut, shift }];
    }
    return [{ t: "tool", tool }];
  }
  if (roll < 0.58)
    return [{ t: "select", id: any && r.chance(0.85) ? any.id : null }];
  if (roll < 0.62 && any) return [{ t: "visible", id: any.id }];
  if (roll < 0.68) return [{ t: "fill", color: r.pick(PALETTE) }];
  if (roll < 0.7)
    return [{ t: "stroke", color: r.chance(0.3) ? "" : r.pick(PALETTE) }];
  if (roll < 0.72) return [{ t: "shadow", on: r.chance(0.5) }];
  if (roll < 0.8 && sel) {
    const prop = r.pick(["x", "y", "w", "h", "opacity", "radius"] as const);
    const cur = prop === "opacity" ? sel.opacity * 10 : sel[prop];
    const step = prop === "opacity" ? 10 : 1;
    return [
      { t: "prop", prop, value: String(cur + (r.chance(0.5) ? step : -step)) },
    ];
  }
  if (roll < 0.84)
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
  if (roll < 0.9)
    return [
      {
        t: "key",
        key: r.pick([
          "Delete",
          "Backspace",
          "]",
          "[",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Escape",
        ]),
      },
    ];
  if (roll < 0.98)
    return [{ t: "key", key: r.pick(["d", "c", "x", "v"]), meta: true }];
  return [{ t: "new" }];
}

// ---------- invariants the screen depends on ----------

function checkScreen(m: Machine, K: number): void {
  const v = m.vars;
  const n = v.get("g/n") as number;
  const sel = v.get("g/sel") as number;
  for (let i = 0; i < MAX_LAYERS; i++) {
    expect(v.get(`L${i}/used`), `L${i}/used`).toBe(i < n);
    expect(v.get(`L${i}/sel`), `L${i}/sel`).toBe(i === sel);
    if (i >= n)
      expect(v.get(`L${i}/vis`), `unused slot L${i} must be hidden`).toBe(
        false,
      );
    else {
      const fill = v.get(`L${i}/fill`) as number;
      for (let k = 0; k < PALETTE.length; k++)
        expect(v.get(`L${i}/f/${k}`), `L${i}/f/${k}`).toBe(fill === k);
      const rr =
        v.get(`L${i}/kind`) === 9
          ? ELLIPSE_RR
          : (v.get(`L${i}/radius`) as number) * (K / 4);
      expect(v.get(`L${i}/rr`), `L${i}/rr`).toBe(rr);
    }
  }
}

function replay(
  seed: number,
  K: number,
  steps: number,
): { events: number; maxActions: number } {
  const r = rng(seed);
  const m = new Machine(buildEditor({ K }));
  let s = initialState();
  const history: string[] = [];
  let events = 0;
  let maxActions = 0;
  for (let step = 0; step < steps; step++) {
    for (const a of actions(r, s)) {
      history.push(JSON.stringify(a));
      const ids = eventsFor(s, a);
      s = reduce(s, a);
      for (const id of ids) {
        maxActions = Math.max(maxActions, m.fire(id));
        events++;
      }
      let got;
      try {
        got = decode(m.vars, K);
      } catch (e) {
        throw new Error(
          `decode failed after ${history.slice(-6).join(" ")}: ${e}`,
        );
      }
      // Failure message: the last few actions that led here.
      expect(got, `seed ${seed} after: ${history.slice(-6).join(" ")}`).toEqual(
        viewOf(s),
      );
      checkScreen(m, K);
    }
  }
  return { events, maxActions };
}

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
      expect(events).toBeGreaterThan(10000);
    });
  }

  it("covers the paths that matter: full canvas, delete, reorder, clipboard, handles", () => {
    // A directed script, so a regression in a rarely-reached branch cannot hide behind the random runs.
    const m = new Machine(buildEditor());
    let s = initialState();
    const step = (a: Action) => {
      for (const id of eventsFor(s, a)) m.fire(id);
      s = reduce(s, a);
      expect(decode(m.vars, 40)).toEqual(viewOf(s));
      checkScreen(m, 40);
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
});
