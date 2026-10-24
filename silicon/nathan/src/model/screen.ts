// The screen contract. The Figma UI has no code and no numbers: every visible thing is a layer
// whose visibility is bound to a net of the machine (the same mechanism that lights the gates),
// mostly a register bit itself.
//
//   a layer's rectangle   [x0, x1) × [y0, y1) cells from four binary-weighted spacers per
//                         coordinate (frame i, 2^i cells, is visible when bit i is 1): the y1
//                         spacers give the box its height and the y0 spacers push the content down;
//                         inside, the x1 spacers give the width and the x0 spacers push the
//                         rectangle right. The auto layout does the subtraction.
//   shown                 the box is visible while the slot is used, its inside while vis is 1
//   colour, kind, outline a tree of frames with one level per bit: child 0 is visible on the
//                         inverted bit, child 1 on the bit, so exactly one leaf shows (the
//                         inverters are the screen's only gates, besides the hot lines)
//   row highlight, tool   one layer each, placed by spacers on ¬sel and on the tool bits
//   ink                   one cell-sized rectangle per pixel of the paint plane, visible on its
//                         bit, above the layers; the Erase button's "on" layer on the erase bit
//   click layers          six hotspot sets; only the set whose `hot` line is 1 receives clicks
//
// This file reads that wiring from a Probe and from the spec, so tests (and the plugin's
// self-test, which reads Figma variables) can compare what is drawn with what the editor holds.
import { HOT, LAYERS, SCREEN_NETS, STATE_NETS, TOOL_BITS } from "../hw/layout";
import type { Probe } from "./oracle";
import * as R from "./reference";

export interface ScreenLayer {
  slot: number;
  shown: boolean;
  /** Rectangle in cells, from the spacer wiring. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Palette index the colour tree shows (-1 if a level shows both children or none). */
  color: number;
  kind: R.Kind | null;
  /** The body's shape: round for an ellipse (null if both or neither shape is visible). */
  shape: "rect" | "ellipse" | null;
  selected: boolean;
  /** Layer-panel row is visible. */
  row: boolean;
}

export interface Screen {
  layers: ScreenLayer[];
  tool: number;
  color: number;
  hot: number;
  /** The ink rectangles shown, one per pixel (0 / 1). */
  ink: number[];
  /** The Erase button shows "on". */
  erase: boolean;
}

const bit = (p: Probe, bus: string, i: number) => p.peek(`${bus}[${i}]`);
const onehot = (p: Probe, bus: string, at: number, n: number) => {
  const on: number[] = [];
  for (let i = 0; i < n; i++) if (bit(p, bus, at + i)) on.push(i);
  return on.length === 1 ? on[0] : -1;
};
/** The leaf a pick tree shows: level i takes child 1 on bit i of `bus`, child 0 on the inverse line
 * (`inv` from bit `at`); a level with both or neither child visible shows no single leaf (-1). */
export function picked(p: Probe, bus: string, inv: string, at: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const b = bit(p, bus, i);
    if (b === bit(p, inv, at + i)) return -1;
    v |= b << i;
  }
  return v;
}

/** What the screen layers show, read through the nets they are bound to. */
export function readScreen(p: Probe): Screen {
  const layers: ScreenLayer[] = [];
  const sel = p.peek(STATE_NETS.hassel) ? picked(p, STATE_NETS.sel, SCREEN_NETS.nsel, 0, 3) : -1;
  for (let k = 0; k < LAYERS; k++) {
    const x0 = p.peek(STATE_NETS.x0(k), 4);
    const y0 = p.peek(STATE_NETS.y0(k), 4);
    const used = p.peek(STATE_NETS.used(k)) === 1;
    const kind = picked(p, STATE_NETS.kind(k), SCREEN_NETS.nkind, 2 * k, 2);
    layers.push({
      slot: k,
      shown: used && p.peek(STATE_NETS.vis(k)) === 1,
      x: x0,
      y: y0,
      w: p.peek(STATE_NETS.x1(k), 4) - x0,
      h: p.peek(STATE_NETS.y1(k), 4) - y0,
      color: picked(p, STATE_NETS.fill(k), SCREEN_NETS.nfill, 4 * k, 4),
      kind: kind > 0 ? R.KINDS[kind - 1] : null,
      shape:
        bit(p, SCREEN_NETS.ell, k) === bit(p, SCREEN_NETS.nell, k)
          ? null
          : bit(p, SCREEN_NETS.ell, k)
            ? "ellipse"
            : "rect",
      selected: sel === k,
      row: used,
    });
  }
  return {
    layers,
    tool: p.peek(STATE_NETS.tool, TOOL_BITS),
    color: picked(p, STATE_NETS.cur, SCREEN_NETS.ncur, 0, 4),
    hot: onehot(p, SCREEN_NETS.hot, 0, HOT.length),
    ink: Array.from({ length: R.GRID_W * R.GRID_H }, (_, i) => bit(p, STATE_NETS.pix, i)),
    erase: p.peek(STATE_NETS.erase) === 1,
  };
}

/** The hotspot set (`hot` bit) that takes canvas clicks in editor state `s`. */
export function hotOf(s: R.State): number {
  if (s.drag) return s.drag.mode === "move" ? 2 : 3;
  if (s.tool === "move") return 0;
  if (s.tool === "pen") return s.penDown ? 5 : 4;
  return 1;
}

/** What the screen must show for editor state `s`. */
export function expectedScreen(s: R.State): Screen {
  const layers: ScreenLayer[] = [];
  for (let k = 0; k < LAYERS; k++) {
    const l = s.layers[k];
    // an empty slot's registers are whatever was last there (or power-on); only its row / shown flags are defined
    layers.push({
      slot: k,
      shown: !!l && l.visible,
      x: l?.x ?? NaN,
      y: l?.y ?? NaN,
      w: l?.w ?? NaN,
      h: l?.h ?? NaN,
      color: l?.fill ?? NaN,
      kind: l?.kind ?? null,
      shape: l ? (l.kind === "ellipse" ? "ellipse" : "rect") : null,
      selected: !!l && l.id === s.selected,
      row: !!l,
    });
  }
  return {
    layers,
    tool: R.TOOLS.indexOf(s.tool),
    color: s.fill,
    hot: hotOf(s),
    ink: s.ink,
    erase: s.erase,
  };
}

/** Why the screen differs from the spec's picture, or null. Empty slots are checked only for
 * "not shown" and "no row"; used slots for everything. */
export function compareScreen(s: R.State, p: Probe): string | null {
  const got = readScreen(p);
  const want = expectedScreen(s);
  for (let k = 0; k < LAYERS; k++) {
    const [g, w] = [got.layers[k], want.layers[k]];
    if (g.row !== w.row) return `slot ${k}: row ${g.row}, spec ${w.row}`;
    if (!w.row) {
      if (g.shown) return `slot ${k}: shown although empty`;
      if (g.selected) return `slot ${k}: selected although empty`;
      continue;
    }
    if (g.shown !== w.shown)
      return `slot ${k}: shown ${g.shown}, spec ${w.shown}`;
    if (g.selected !== w.selected)
      return `slot ${k}: selected ${g.selected}, spec ${w.selected}`;
    if (g.kind !== w.kind) return `slot ${k}: kind ${g.kind}, spec ${w.kind}`;
    if (g.shape !== w.shape)
      return `slot ${k}: drawn ${g.shape}, spec ${w.shape}`;
    if (g.color !== w.color)
      return `slot ${k}: colour ${g.color}, spec ${w.color}`;
    if (g.x !== w.x || g.y !== w.y || g.w !== w.w || g.h !== w.h)
      return `slot ${k}: rectangle ${g.x},${g.y} ${g.w}×${g.h}, spec ${w.x},${w.y} ${w.w}×${w.h}`;
  }
  if (got.tool !== want.tool) return `tool lamp ${got.tool}, spec ${want.tool}`;
  if (got.color !== want.color)
    return `current colour lamp ${got.color}, spec ${want.color}`;
  if (got.hot !== want.hot) return `hotspot set ${got.hot}, spec ${want.hot}`;
  return compareInk(got, want);
}

/** Why the ink shown (and the Erase button) differ from the spec's, or null. */
export function compareInk(got: Screen, want: Screen): string | null {
  const i = want.ink.findIndex((v, k) => got.ink[k] !== v);
  if (i >= 0)
    return `ink at (${i % R.GRID_W}, ${Math.floor(i / R.GRID_W)}): shown ${got.ink[i]}, spec ${want.ink[i]}`;
  if (got.erase !== want.erase) return `Erase shows ${got.erase}, spec ${want.erase}`;
  return null;
}

/** The picture the shown layers make (topmost wins, the ink above them), from the screen wiring:
 * for comparing with R.raster. */
export function rasterOf(sc: Screen): number[] {
  const out = new Array<number>(R.GRID_W * R.GRID_H).fill(-1);
  for (const l of sc.layers) {
    if (!l.shown) continue;
    for (let y = l.y; y < l.y + l.h; y++)
      for (let x = l.x; x < l.x + l.w; x++)
        if (x < R.GRID_W && y < R.GRID_H) out[y * R.GRID_W + x] = l.color;
  }
  sc.ink.forEach((v, i) => v && (out[i] = R.INK));
  return out;
}
