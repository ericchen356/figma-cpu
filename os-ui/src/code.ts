// Pure helpers that need no DOM: the CSS Dev Mode shows for a layer, and the picture-to-cells
// conversion behind Place image. Both are tested without a browser.
import { GRID_H, GRID_W, Layer, PALETTE, Paint, cellKey } from "./model";

/** One cell is an 8x8 tile of the 128x96 screen, so design units are screen pixels. */
export const PX_PER_CELL = 8;

const px = (cells: number) => `${cells * PX_PER_CELL}px`;

/** The CSS a layer would need on the OS screen, one declaration per line, as Dev Mode shows it. */
export function layerCss(l: Layer): string[] {
  const css = [
    "position: absolute;",
    `left: ${px(l.x)};`,
    `top: ${px(l.y)};`,
    `width: ${px(l.w)};`,
    `height: ${px(l.h)};`,
  ];
  const hollow = l.kind === "line" || l.kind === "arrow";
  if (l.kind === "text") {
    css.push(
      `color: ${l.fill.toUpperCase()};`,
      `font: 700 ${PX_PER_CELL}px/${PX_PER_CELL}px monospace;`,
      `content: "${l.text}";`,
    );
  } else if (hollow) {
    css.push(
      `border-top: 1px solid ${(l.stroke || l.fill).toUpperCase()};`,
      l.flip ? "transform-origin: bottom left;" : "transform-origin: top left;",
    );
  } else if (l.kind !== "comment" && l.kind !== "slice") {
    css.push(`background: ${l.fill.toUpperCase()};`);
  }
  if (l.kind === "ellipse") css.push("border-radius: 50%;");
  else if (l.radius) css.push(`border-radius: ${px(l.radius / 4)};`);
  if (l.kind === "polygon")
    css.push("clip-path: polygon(50% 0, 100% 100%, 0 100%);");
  if (l.kind === "star")
    css.push(
      "clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);",
    );
  if (l.stroke && !hollow)
    css.push(`border: 1px solid ${l.stroke.toUpperCase()};`);
  if (l.opacity < 10) css.push(`opacity: ${l.opacity / 10};`);
  if (l.rotation) css.push(`transform: rotate(${l.rotation}deg);`);
  if (l.shadow) css.push("box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);");
  return css;
}

/** Index of the palette color nearest to (r, g, b), by squared distance. */
export function nearestColor(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  PALETTE.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    const d =
      (r - (n >> 16)) ** 2 + (g - ((n >> 8) & 255)) ** 2 + (b - (n & 255)) ** 2;
    if (d < bestD) ((best = i), (bestD = d));
  });
  return best;
}

/**
 * Turns picture pixels into canvas cells: the picture is stretched over `region` (cells), each cell
 * takes the average color of the pixels under it, snapped to the 16-color palette. Mostly transparent
 * cells are left out, so they paint nothing.
 */
export function imageToCells(
  rgba: Uint8ClampedArray | number[],
  width: number,
  height: number,
  region = { x: 0, y: 0, w: GRID_W, h: GRID_H },
): Paint {
  const cells: Paint = {};
  for (let cy = 0; cy < region.h; cy++) {
    for (let cx = 0; cx < region.w; cx++) {
      const x0 = Math.floor((cx * width) / region.w);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / region.w));
      const y0 = Math.floor((cy * height) / region.h);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / region.h));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          r += rgba[i] * rgba[i + 3];
          g += rgba[i + 1] * rgba[i + 3];
          b += rgba[i + 2] * rgba[i + 3];
          a += rgba[i + 3];
          n++;
        }
      if (a / n < 128) continue;
      cells[cellKey(region.x + cx, region.y + cy)] = nearestColor(r / a, g / a, b / a);
    }
  }
  return cells;
}
