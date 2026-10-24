// Glue between the executable spec (reference.ts) and the machine: the same editor event as a
// spec action and as the engine's inputs (EVT, ARG, PX, PY), a comparison of the machine's
// registers with the spec's state, and a random event generator. Used by the hardware tests, the
// reaction tests, the plugin's "Self-test" and the fuzz CLI. The machine is reached through a
// Probe, so the same code compares a simulator, or variables read out of a Figma file.
import { EV, LAYERS, PALETTE_SIZE, STATE_NETS, TOOL_BITS } from "../hw/layout";
import * as R from "./reference";

/** Anything that can read a net (or a bus, LSB first) of the machine. */
export interface Probe {
  peek(name: string, width?: number): number;
}

export type Ev =
  | { k: "tool"; t: number } // 0 move, 1 frame, 2 rectangle, 3 ellipse, 4 pen
  | { k: "fill"; c: number }
  | { k: "down"; x: number; y: number }
  | { k: "move"; x: number; y: number }
  | { k: "up" }
  | { k: "select"; slot: number }
  | { k: "handle"; corner: number } // bit0 = west, bit1 = north
  | { k: "vis"; slot: number }
  | { k: "delete" }
  | { k: "dup" }
  | { k: "fwd" }
  | { k: "back" }
  | { k: "nudge"; dir: number } // 0 left, 1 right, 2 up, 3 down
  | { k: "esc" }
  | { k: "click"; x: number; y: number }
  | { k: "paint"; x: number; y: number } // the pointer entered a cell (inks it while the pen is down)
  | { k: "erase" }
  | { k: "clear" };

/** The event as the machine's inputs. */
export interface Inputs {
  evt: number;
  arg: number;
  px: number;
  py: number;
}

export function engineInputs(ev: Ev): Inputs {
  const at = (evt: number, arg = 0, px = 0, py = 0): Inputs => ({
    evt,
    arg,
    px,
    py,
  });
  switch (ev.k) {
    case "tool":
      return at(EV.TOOL, ev.t);
    case "fill":
      return at(EV.FILL, ev.c);
    case "down":
      return at(EV.DOWN, 0, ev.x, ev.y);
    case "move":
      return at(EV.MOVE, 0, ev.x, ev.y);
    case "up":
      return at(EV.UP);
    case "select":
      return at(EV.SELECT, ev.slot);
    case "handle":
      return at(EV.HANDLE, ev.corner);
    case "vis":
      return at(EV.VIS, ev.slot);
    case "delete":
      return at(EV.DELETE);
    case "dup":
      return at(EV.DUP);
    case "fwd":
      return at(EV.FWD);
    case "back":
      return at(EV.BACK);
    case "nudge":
      return at(EV.NUDGE, ev.dir);
    case "esc":
      return at(EV.ESC);
    case "click":
      return at(EV.CLICK, 0, ev.x, ev.y);
    case "paint":
      return at(EV.PAINT, 0, ev.x, ev.y);
    case "erase":
      return at(EV.ERASE);
    case "clear":
      return at(EV.CLEAR);
  }
}

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/** The same event applied to the spec. */
export function applyRef(s: R.State, ev: Ev): R.State {
  const idOf = (slot: number) => s.layers[slot]?.id ?? -1;
  switch (ev.k) {
    case "tool":
      return R.reduce(s, { t: "tool", tool: R.TOOLS[ev.t] });
    case "fill":
      return R.reduce(s, { t: "fill", color: ev.c });
    case "down":
      return R.reduce(s, { t: "down", x: ev.x, y: ev.y });
    case "move":
      return R.reduce(s, { t: "move", x: ev.x, y: ev.y });
    case "up":
      return R.reduce(s, { t: "up" });
    case "select":
      return R.reduce(s, { t: "select", id: idOf(ev.slot) });
    case "handle":
      return R.reduce(s, {
        t: "down",
        x: 0,
        y: 0,
        handle:
          `${ev.corner & 2 ? "n" : "s"}${ev.corner & 1 ? "w" : "e"}` as R.Corner,
      });
    case "vis":
      return R.reduce(s, { t: "visible", id: idOf(ev.slot) });
    case "delete":
      return R.reduce(s, { t: "key", key: "Delete" });
    case "dup":
      return R.reduce(s, { t: "key", key: "d", meta: true });
    case "fwd":
      return R.reduce(s, { t: "key", key: "]" });
    case "back":
      return R.reduce(s, { t: "key", key: "[" });
    case "nudge":
      return R.reduce(s, { t: "key", key: ARROWS[ev.dir] });
    case "esc":
      return R.reduce(s, { t: "key", key: "Escape" });
    case "click":
      return R.click(s, ev.x, ev.y);
    case "paint":
      return R.reduce(s, { t: "paint", x: ev.x, y: ev.y });
    case "erase":
      return R.reduce(s, { t: "erase" });
    case "clear":
      return R.reduce(s, { t: "clear" });
  }
}

const DRAGS = [null, "move", "create", "resize"] as const;

/** Why the machine's registers differ from the spec's state, or null if they agree. Only the
 * architectural state is compared (layer stack, selection, tool, colour, pending drag, the pen and
 * the paint plane). */
export function compare(ref: R.State, p: Probe): string | null {
  const n = ref.layers.length;
  for (let k = 0; k < LAYERS; k++) {
    const used = p.peek(STATE_NETS.used(k));
    if (used !== (k < n ? 1 : 0))
      return `layer ${k}: used=${used}, the spec has ${n} layer(s)`;
  }
  for (let k = 0; k < n; k++) {
    const l = ref.layers[k];
    const got = [
      p.peek(STATE_NETS.x0(k), 4),
      p.peek(STATE_NETS.x1(k), 4),
      p.peek(STATE_NETS.y0(k), 4),
      p.peek(STATE_NETS.y1(k), 4),
      p.peek(STATE_NETS.fill(k), 4),
      p.peek(STATE_NETS.kind(k), 2),
      p.peek(STATE_NETS.vis(k)),
    ];
    const want = [
      l.x,
      l.x + l.w,
      l.y,
      l.y + l.h,
      l.fill,
      R.KINDS.indexOf(l.kind) + 1,
      l.visible ? 1 : 0,
    ];
    if (got.join() !== want.join())
      return `layer ${k} (x0 x1 y0 y1 fill kind vis): machine ${got.join(" ")}, spec ${want.join(" ")}`;
  }
  const selWant =
    ref.selected === null
      ? -1
      : ref.layers.findIndex((l) => l.id === ref.selected);
  const selGot = p.peek(STATE_NETS.hassel) ? p.peek(STATE_NETS.sel, 3) : -1;
  if (selGot !== selWant)
    return `selection: machine ${selGot}, spec ${selWant}`;
  if (p.peek(STATE_NETS.tool, TOOL_BITS) !== R.TOOLS.indexOf(ref.tool))
    return `tool: machine ${p.peek(STATE_NETS.tool, TOOL_BITS)}, spec ${ref.tool}`;
  if (p.peek(STATE_NETS.cur, 4) !== ref.fill)
    return `current colour: machine ${p.peek(STATE_NETS.cur, 4)}, spec ${ref.fill}`;
  const dm = ref.drag?.mode ?? null;
  const dg = DRAGS[p.peek(STATE_NETS.drag, 2)];
  if (dg !== dm) return `pending drag: machine ${dg}, spec ${dm}`;
  if (p.peek(STATE_NETS.pendown) !== +ref.penDown)
    return `pen down: machine ${p.peek(STATE_NETS.pendown)}, spec ${ref.penDown}`;
  if (p.peek(STATE_NETS.erase) !== +ref.erase)
    return `erase: machine ${p.peek(STATE_NETS.erase)}, spec ${ref.erase}`;
  for (let i = 0; i < ref.ink.length; i++) {
    const got = p.peek(`${STATE_NETS.pix}[${i}]`);
    if (got !== ref.ink[i])
      return `pixel (${i % R.GRID_W}, ${Math.floor(i / R.GRID_W)}): machine ${got}, spec ${ref.ink[i]}`;
  }
  return null;
}

/** Deterministic PRNG (mulberry32): the low bits of a plain LCG have tiny periods and make
 * random tests vacuous. */
export function prng(seed: number): (n: number) => number {
  let a = seed | 0;
  return (n) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

export interface Mix {
  /** Weights of the event families; the rest are the plain DOWN / MOVE / UP events. */
  click: number;
  /** With the pen and nothing pending: the share (%) of pen events (strokes, pen clicks, erase,
   * clear). Default 70. */
  pen?: number;
}

/** A cell for the pen: half the time next to a cell already inked, so strokes grow as lines. */
export function strokeCell(
  rnd: (n: number) => number,
  s: R.State,
): { x: number; y: number } {
  const inked = s.ink.flatMap((v, i) => (v ? [i] : []));
  if (!inked.length || rnd(2)) return { x: rnd(R.GRID_W), y: rnd(R.GRID_H) };
  const i = inked[rnd(inked.length)];
  const near = (v: number, d: number, n: number) => Math.max(0, Math.min(n - 1, v + d - 1));
  return {
    x: near(i % R.GRID_W, rnd(3), R.GRID_W),
    y: near(Math.floor(i / R.GRID_W), rnd(3), R.GRID_H),
  };
}

/** One step of a pen session (the pen is the tool and nothing is pending): mostly strokes while
 * the pen is down, clicks that put it down or lift it, now and then Erase or Clear. */
export function penEvent(rnd: (n: number) => number, s: R.State): Ev {
  const r = rnd(100);
  if (s.penDown && r < 75) return { k: "paint", ...strokeCell(rnd, s) };
  if (r < 90) return { k: "click", ...strokeCell(rnd, s) };
  if (r < 97) return { k: "erase" };
  return { k: "clear" };
}

/** A random event that is legal in state `s` (no SELECT of an empty slot, no HANDLE without a selection). */
export function randomEvent(
  rnd: (n: number) => number,
  s: R.State,
  mix: Mix = { click: 40 },
): Ev {
  const n = s.layers.length;
  if (s.tool === "pen" && !s.drag && rnd(100) < (mix.pen ?? 70))
    return penEvent(rnd, s);
  const x = rnd(R.GRID_W);
  const y = rnd(R.GRID_H);
  for (;;) {
    const r = rnd(100);
    if (r < mix.click) return { k: "click", x, y };
    const q = rnd(100);
    if (q < 7) return { k: "tool", t: rnd(R.TOOLS.length) };
    if (q < 12) return { k: "fill", c: rnd(PALETTE_SIZE) };
    if (q < 28) return { k: "down", x, y };
    if (q < 44) return { k: "move", x, y };
    if (q < 52) return { k: "up" };
    if (q < 57 && n) return { k: "select", slot: rnd(n) };
    if (q < 62 && n) return { k: "vis", slot: rnd(n) };
    if (q < 66) return { k: "delete" };
    if (q < 71) return { k: "dup" };
    if (q < 76) return { k: "fwd" };
    if (q < 81) return { k: "back" };
    if (q < 87) return { k: "nudge", dir: rnd(4) };
    if (q < 89) return { k: "esc" };
    if (q < 96) {
      if (s.selected !== null) return { k: "handle", corner: rnd(4) };
      continue;
    }
    // the pen's events outside a pen session: a hover inks nothing, Erase and Clear still work
    if (q < 97) return { k: "paint", x, y };
    if (q < 98) return { k: "erase" };
    if (q < 99) return { k: "clear" };
  }
}

export const eventName = (ev: Ev): string => ev.k;
