import { describe, expect, it } from "vitest";
import { PX_PER_CELL, imageToCells, layerCss, nearestColor } from "../src/code";
import { GRID_H, GRID_W, Layer, PALETTE } from "../src/model";

const layer = (p: Partial<Layer>): Layer => ({
  id: 1, kind: "rect", name: "Rectangle 1", x: 6, y: 5, w: 7, h: 5, fill: "#29adff", visible: true,
  opacity: 10, radius: 0, stroke: "", shadow: false, rotation: 0, flip: false, text: "", ...p,
});

describe("Dev Mode CSS", () => {
  it("measures in screen pixels, 8 per cell", () => {
    const css = layerCss(layer({}));
    expect(PX_PER_CELL).toBe(8);
    expect(css).toContain("left: 48px;");
    expect(css).toContain("top: 40px;");
    expect(css).toContain("width: 56px;");
    expect(css).toContain("height: 40px;");
    expect(css).toContain("background: #29ADFF;");
  });

  it("writes only what differs from the defaults", () => {
    expect(layerCss(layer({})).some((l) => /opacity|transform|box-shadow|border/.test(l))).toBe(false);
    const css = layerCss(layer({ opacity: 5, rotation: 90, shadow: true, stroke: "#000000", radius: 2 }));
    expect(css).toEqual(expect.arrayContaining(["opacity: 0.5;", "transform: rotate(90deg);", "box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);", "border: 1px solid #000000;", "border-radius: 4px;"]));
  });

  it("describes each kind in its own terms", () => {
    expect(layerCss(layer({ kind: "ellipse" }))).toContain("border-radius: 50%;");
    expect(layerCss(layer({ kind: "polygon" })).some((l) => l.startsWith("clip-path"))).toBe(true);
    expect(layerCss(layer({ kind: "text", text: "hi" }))).toContain('content: "hi";');
    const line = layerCss(layer({ kind: "line", stroke: "#ff004d" }));
    expect(line).toContain("border-top: 1px solid #FF004D;");
    expect(line.some((l) => l.startsWith("background"))).toBe(false);
  });
});

describe("Place image", () => {
  it("snaps a color to the nearest palette entry", () => {
    expect(nearestColor(255, 0, 80)).toBe(PALETTE.indexOf("#ff004d"));
    expect(nearestColor(0, 0, 0)).toBe(0);
    expect(nearestColor(250, 240, 230)).toBe(PALETTE.indexOf("#fff1e8"));
  });

  const solid = (w: number, h: number, rgba: number[]) => Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => rgba[i % 4]);

  it("stretches the picture over the OS screen's window by default", () => {
    const cells = imageToCells(solid(28, 20, [255, 0, 77, 255]), 28, 20);
    expect(Object.keys(cells)).toHaveLength(GRID_W * GRID_H);
    expect(new Set(Object.values(cells))).toEqual(new Set([PALETTE.indexOf("#ff004d")]));
  });

  it("leaves transparent areas out and keeps to the region, wherever on the canvas it is", () => {
    expect(imageToCells(solid(14, 10, [0, 0, 0, 0]), 14, 10)).toEqual({});
    const cells = imageToCells(solid(4, 4, [0, 228, 54, 255]), 4, 4, { x: -2, y: 3, w: 3, h: 2 });
    expect(Object.keys(cells).sort()).toEqual(["-1,3", "-1,4", "-2,3", "-2,4", "0,3", "0,4"]);
  });

  it("averages a cell's pixels before snapping, so a half-red half-black cell is not red", () => {
    const px = Uint8ClampedArray.from([255, 0, 77, 255, 0, 0, 0, 255]);
    expect(imageToCells(px, 2, 1, { x: 0, y: 0, w: 1, h: 1 })["0,0"]).not.toBe(PALETTE.indexOf("#ff004d"));
  });
});
