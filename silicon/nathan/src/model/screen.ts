// The screen contract. The Figma UI has no code and no numbers: every visible thing is a layer
// whose visibility is bound to a net of the machine (the same mechanism that lights the gates).
//
//   a layer's rectangle   inside a 15×15-cell auto-layout box, [left spacer | rect | right spacer]
//                         over [top spacer | row | bottom spacer]. A spacer is four frames of
//                         1, 2, 4 and 8 cells; frame i is visible when bit i of its register is 1.
//                         left = x0 bits, right = ¬x1 bits (15 − x1), top = y0, bottom = ¬y1 bits.
//                         The rect fills what is left, so its width is 15 − x0 − (15 − x1) = x1 − x0.
//   colour                16 stacked swatches, swatch c visible when one-hot line c is 1
//   rows, outline, tool   visible when used / selk / tool1h lines are 1
//   click layers          four hotspot sets; only the set whose `hot` line is 1 receives clicks
//
// This file reads that wiring from a Probe and from the spec, so tests (and the plugin's
// self-test, which reads Figma variables) can compare what is drawn with what the editor holds.
import { LAYERS, SCREEN_NETS, STATE_NETS } from "../hw/layout";
import type { Probe } from "./oracle";
import * as R from "./reference";

/** Cells in the layout box a layer rectangle is placed in (x1 and y1 can be 14 and 10). */
export const BOX_CELLS = 15;

export interface ScreenLayer {
  slot: number;
  shown: boolean;
  /** Rectangle in cells, from the spacer wiring. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Palette index from the one-hot colour lines (-1 if none or several are lit). */
  color: number;
  kind: R.Kind | null;
  selected: boolean;
  /** Layer-panel row is visible. */
  row: boolean;
}

export interface Screen {
  layers: ScreenLayer[];
  tool: number;
  color: number;
  hot: number;
}

const bit = (p: Probe, bus: string, i: number) => p.peek(`${bus}[${i}]`);
const word = (p: Probe, bus: string, at: number, w: number) => {
  let v = 0;
  for (let i = 0; i < w; i++) v |= bit(p, bus, at + i) << i;
  return v;
};
const onehot = (p: Probe, bus: string, at: number, n: number) => {
  const on: number[] = [];
  for (let i = 0; i < n; i++) if (bit(p, bus, at + i)) on.push(i);
  return on.length === 1 ? on[0] : -1;
};

/** What the screen layers show, read through the nets they are bound to. */
export function readScreen(p: Probe): Screen {
  const layers: ScreenLayer[] = [];
  for (let k = 0; k < LAYERS; k++) {
    const x0 = p.peek(STATE_NETS.x0(k), 4);
    const y0 = p.peek(STATE_NETS.y0(k), 4);
    const rightSpacer = word(p, SCREEN_NETS.nx1, 4 * k, 4);
    const bottomSpacer = word(p, SCREEN_NETS.ny1, 4 * k, 4);
    const kinds: Array<[string, R.Kind]> = [
      [SCREEN_NETS.kfr, "frame"],
      [SCREEN_NETS.kre, "rect"],
      [SCREEN_NETS.kel, "ellipse"],
    ];
    const kind = kinds.find(([bus]) => bit(p, bus, k))?.[1] ?? null;
    layers.push({
      slot: k,
      shown: bit(p, SCREEN_NETS.show, k) === 1,
      x: x0,
      y: y0,
      w: BOX_CELLS - x0 - rightSpacer,
      h: BOX_CELLS - y0 - bottomSpacer,
      color: onehot(p, SCREEN_NETS.fill1h, 16 * k, 16),
      kind,
      selected: bit(p, SCREEN_NETS.selk, k) === 1,
      row: p.peek(STATE_NETS.used(k)) === 1,
    });
  }
  return {
    layers,
    tool: onehot(p, SCREEN_NETS.tool1h, 0, 4),
    color: onehot(p, SCREEN_NETS.cur1h, 0, 16),
    hot: onehot(p, SCREEN_NETS.hot, 0, 4),
  };
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
      selected: !!l && l.id === s.selected,
      row: !!l,
    });
  }
  const hot = s.drag
    ? s.drag.mode === "move"
      ? 2
      : 3
    : s.tool === "move"
      ? 0
      : 1;
  return { layers, tool: R.TOOLS.indexOf(s.tool), color: s.fill, hot };
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
    if (g.color !== w.color)
      return `slot ${k}: colour ${g.color}, spec ${w.color}`;
    if (g.x !== w.x || g.y !== w.y || g.w !== w.w || g.h !== w.h)
      return `slot ${k}: rectangle ${g.x},${g.y} ${g.w}×${g.h}, spec ${w.x},${w.y} ${w.w}×${w.h}`;
  }
  if (got.tool !== want.tool) return `tool lamp ${got.tool}, spec ${want.tool}`;
  if (got.color !== want.color)
    return `current colour lamp ${got.color}, spec ${want.color}`;
  if (got.hot !== want.hot) return `hotspot set ${got.hot}, spec ${want.hot}`;
  return null;
}

/** The picture the shown layers make (topmost wins), from the screen wiring: for comparing with R.raster. */
export function rasterOf(sc: Screen): number[] {
  const out = new Array<number>(R.GRID_W * R.GRID_H).fill(-1);
  for (const l of sc.layers) {
    if (!l.shown) continue;
    for (let y = l.y; y < l.y + l.h; y++)
      for (let x = l.x; x < l.x + l.w; x++)
        if (x < R.GRID_W && y < R.GRID_H) out[y * R.GRID_W + x] = l.color;
  }
  return out;
}
