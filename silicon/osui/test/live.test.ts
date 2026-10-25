// The live Figma OS built against the fake Plugin API, then used: a random session of presses,
// drags, handles, keys and buttons through the stored reactions (the viewer emulated), with every
// chip variable checked against the chip itself after each action.
import { describe, expect, it } from "vitest";
import { resetFonts } from "../../src/figma/style";
import { FakeFigma } from "../../test/fake-figma";
import parts from "../data/parts.json";
import screens from "../data/screens.json";
import type { ScreensFile } from "../src/layers";
import { buildLive } from "../src/live/build";
import type { CaptureData } from "../src/live/screen";
import { liveSelfTest } from "../src/live/selftest";

const data: CaptureData = {
  screens: screens as unknown as ScreensFile,
  parts: parts as unknown as CaptureData["parts"],
};

describe("the live Figma OS (os-ui on the gate-level chip)", () => {
  it("builds, and every control drives the chip exactly", async () => {
    const fig = new FakeFigma(["Figma OS"]);
    (globalThis as unknown as { figma: FakeFigma }).figma = fig;
    resetFonts();
    const page = fig.root.children[0];
    const logs: string[] = [];
    const { stats } = await buildLive(
      fig as unknown as PluginAPI,
      page as unknown as PageNode,
      data,
      { budget: 700, log: (m) => logs.push(m) },
    );
    console.log(
      JSON.stringify(
        { ...stats, problems: stats.problems.slice(0, 12) },
        null,
        1,
      ),
    );
    expect(stats.problems).toEqual([]);
    expect(stats.longestEvent).toBeLessThanOrEqual(700);
    const r = await liveSelfTest(
      fig as unknown as PluginAPI,
      page as unknown as PageNode,
      { events: 150, seed: 7 },
    );
    console.log(r.text);
    expect(r.ok).toBe(true);
  }, 900_000);
});
