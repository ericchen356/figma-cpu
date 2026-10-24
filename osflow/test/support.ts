// Shared by the lockstep and compile tests: a seeded generator of editor sessions, the screen
// invariants, and the one-action lockstep step.
import { expect } from "vitest";
import { decode, eventsFor, Unsupported, viewOf, type Origin } from "../src/codec";
import { buildEditor } from "../src/editor";
import { Machine } from "../src/interp";
import { CREATE_TOOLS, ELLIPSE_RR, GRID_H, GRID_W, MAX_LAYERS, PALETTE, TOOL_KEYS, toolCode, type Tool } from "../src/spec";
import { getSelected, initialState, reduce, type Action, type State } from "../../os-ui/src/model";

// ---------- a small seeded generator ----------

export function rng(seed: number) {
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
export type Rng = ReturnType<typeof rng>;

/** Tools whose canvas gestures the flow implements. */
export const TOOLS_OK: Tool[] = ["move", "hand", "scale", ...CREATE_TOOLS];
export const KEY_FOR: Partial<Record<Tool, string>> = {};
for (const [shortcut, tool] of Object.entries(TOOL_KEYS))
  KEY_FOR[tool] ??= shortcut;

/** The next batch of actions: a drag gesture, a panel click or a key. Pointer cells are canvas cells. */
export function actions(r: Rng, s: State, origin: Origin): Action[] {
  const cell = () => ({
    x: origin.x + r.int(GRID_W),
    y: origin.y + r.int(GRID_H),
  });
  const sel = getSelected(s);
  const any = r.pick(s.layers.length ? s.layers : [undefined]);
  const roll = r.next();
  if (roll < 0.34) {
    const out: Action[] = [{ t: "down", ...cell() }];
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
  if (roll < 0.86)
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
  if (roll < 0.91)
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

export function checkScreen(m: Machine, K: number): void {
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
        v.get(`L${i}/kind`) === toolCode("ellipse")
          ? ELLIPSE_RR
          : (v.get(`L${i}/radius`) as number) * (K / 4);
      expect(v.get(`L${i}/rr`), `L${i}/rr`).toBe(rr);
    }
  }
}

/** Applies `a` to the reducer and to the flow, and checks they still agree. Returns false if the flow does not do this yet. */
export function lockstep(
  m: Machine,
  K: number,
  s: State,
  a: Action,
  origin: Origin,
  history: string[],
): { s: State; ran: boolean; maxActions: number } {
  let ids: string[];
  try {
    ids = eventsFor(s, a, origin);
  } catch (e) {
    if (e instanceof Unsupported) return { s, ran: false, maxActions: 0 };
    throw e;
  }
  history.push(JSON.stringify(a));
  const next = reduce(s, a);
  let maxActions = 0;
  for (const id of ids) maxActions = Math.max(maxActions, m.fire(id));
  expect(decode(m.vars, K), `after: ${history.slice(-7).join(" ")}`).toEqual(
    viewOf(next),
  );
  checkScreen(m, K);
  return { s: next, ran: true, maxActions };
}

export function replay(
  seed: number,
  K: number,
  steps: number,
): { events: number; maxActions: number } {
  const r = rng(seed);
  const m = new Machine(buildEditor({ K }));
  let s = initialState();
  let origin: Origin = { x: 0, y: 0 };
  const history: string[] = [`seed ${seed}`];
  let events = 0;
  let maxActions = 0;
  for (let step = 0; step < steps; step++) {
    // Sometimes slide the window over the canvas, as panning will.
    if (r.chance(0.08)) {
      origin = { x: r.int(41) - 20, y: r.int(41) - 20 };
      m.vars.set("v/x", origin.x * K);
      m.vars.set("v/y", origin.y * K);
    }
    for (const a of actions(r, s, origin)) {
      const out = lockstep(m, K, s, a, origin, history);
      s = out.s;
      if (out.ran) events++;
      maxActions = Math.max(maxActions, out.maxActions);
    }
  }
  return { events, maxActions };
}


/** Drives a random session through the reducer and calls `fire` with each event id it causes, so
 * other tests can run the same plausible sequences on any back end. */
export function drive(seed: number, K: number, steps: number, fire: (id: string) => void): number {
  const r = rng(seed);
  let s = initialState();
  let origin: Origin = { x: 0, y: 0 };
  let events = 0;
  for (let step = 0; step < steps; step++) {
    if (r.chance(0.08)) {
      origin = { x: r.int(41) - 20, y: r.int(41) - 20 };
      fire(`@origin ${origin.x * K} ${origin.y * K}`);
    }
    for (const a of actions(r, s, origin)) {
      let ids: string[];
      try {
        ids = eventsFor(s, a, origin);
      } catch (e) {
        if (e instanceof Unsupported) continue;
        throw e;
      }
      s = reduce(s, a);
      for (const id of ids) {
        fire(id);
        events++;
      }
    }
  }
  return events;
}
