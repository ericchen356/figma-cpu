import { expect, it } from "vitest";
import { linePoints } from "../ui/line";

it("fills every pixel between two samples, 8-connected, ending at the target", () => {
  for (const [x0, y0, x1, y1] of [[0, 0, 10, 0], [5, 5, 0, 20], [100, 3, 90, 90], [7, 7, 7, 7]]) {
    const pts = linePoints(x0, y0, x1, y1);
    if (x0 === x1 && y0 === y1) {
      expect(pts).toEqual([]);
      continue;
    }
    expect(pts[pts.length - 1]).toEqual([x1, y1]);
    let [px, py] = [x0, y0];
    for (const [x, y] of pts) {
      expect(Math.max(Math.abs(x - px), Math.abs(y - py))).toBe(1);
      [px, py] = [x, y];
    }
    expect(pts.length).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
  }
});
