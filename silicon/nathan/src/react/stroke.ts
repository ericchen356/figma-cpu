// The pen's straight strokes. No hover fires while the mouse button is held (measured in the
// viewer), so a drag with the pen cannot ink the cells it crosses; what the viewer does report is
// where the button went down (the press stores that cell, the anchor) and where it came up (the
// cell that takes the release). The release then draws the straight line between the two from a
// table: one IF per anchor cell, each writing the paint-plane bits of its line. A release on the
// anchor itself is a click: the pen stays down and the hover strokes go on (freehand); any other
// release ends the stroke and lifts the pen. This part is a lookup table in the reaction, not gates.
import { GRID_H, GRID_W } from "../model/reference";

/** The cells of the straight line from (x0, y0) to (x1, y1), both ends included (Bresenham). */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let [x, y] = [x0, y0];
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** The paint-plane bit of cell (x, y). */
export const pixOf = (x: number, y: number) => y * GRID_W + x;

export interface StrokePlan {
  /** The release cell's bit, inked whatever the anchor. */
  at: number;
  /** For every other anchor cell, the bits strictly between it and the release cell (its own bit
   * was inked by the press). */
  lines: Array<{ x: number; y: number; bits: number[] }>;
}

/** What a release over canvas cell (`col`, `row`) of the pen-down layer draws. */
export function strokePlan(row: number, col: number): StrokePlan {
  const lines: StrokePlan["lines"] = [];
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      if (x === col && y === row) continue;
      const cells = lineCells(x, y, col, row).slice(1, -1);
      lines.push({ x, y, bits: cells.map(([cx, cy]) => pixOf(cx, cy)) });
    }
  return { at: pixOf(col, row), lines };
}

/** The reaction name of that release. */
export const strokeRun = (row: number, col: number) => `stroke/${row}/${col}`;
