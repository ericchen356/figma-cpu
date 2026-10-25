// Every os-ui screen built from its capture, against the fake Figma API: each captured layer
// becomes one node, at the page position it had in the browser, with its text and images.
import { describe, expect, it } from "vitest";
import { resetFonts } from "../../src/figma/style";
import { FakeFigma, type FakeNode } from "../../test/fake-figma";
import { screenLayers } from "../src/layers";
import { OsuiApp, PAGE, SCREEN_PREFIX, SCREENS } from "../plugin/src/app";
import type { ToUi } from "../plugin/src/messages";

function session() {
  const fig = new FakeFigma(["Page 1"]);
  (globalThis as unknown as { figma: FakeFigma }).figma = fig;
  resetFonts();
  const posted: ToUi[] = [];
  const app = new OsuiApp(fig as unknown as PluginAPI, (m) => posted.push(m), {
    yield: async () => {},
  });
  return { fig, app, posted };
}

/** A node's position on the page: its x/y plus every ancestor's, up to the screen frame. */
const absolute = (n: FakeNode, stop: FakeNode) => {
  let x = 0;
  let y = 0;
  for (let p: FakeNode | null = n; p && p !== stop; p = p.parent) {
    x += p.x;
    y += p.y;
  }
  return { x, y };
};

describe("os-ui in Figma, 1:1 from its capture", () => {
  it("has every screen of the app", () => {
    const ids = SCREENS.screens.map((s) => s.id);
    for (const id of [
      "default",
      "frame-selected",
      "fly-shape",
      "menu-main-file",
      "menu-context",
      "palette",
      "prototype-frames",
      "present",
      "dev-selected",
      "draw",
      "share",
      "shapes",
      "text-selected",
      "comment-selected",
      "star-styled",
      "frame-export",
      "assets",
      "tools",
      "no-rulers-grid",
      "min-ui",
      "viewonly-present",
    ])
      expect(ids, id).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds every captured layer of every screen at its page position", async () => {
    const { fig, app, posted } = session();
    await app.handle({ type: "editor" });
    expect(
      posted.filter((m) => m.type === "log" && m.level === "error"),
    ).toEqual([]);
    const page = fig.root.children.find((p) => p.name === PAGE)!;
    // nothing loose on the page: every node is inside its screen
    expect(
      page.children
        .filter((n) => !n.name.startsWith(SCREEN_PREFIX))
        .map((n) => n.name),
    ).toEqual([]);
    const frames = page.children.filter((n) =>
      n.name.startsWith(SCREEN_PREFIX),
    );
    expect(frames.map((f) => f.name)).toEqual(
      SCREENS.screens.map((s) => `${SCREEN_PREFIX}${s.title}`),
    );
    let checked = 0;
    for (const [k, screen] of SCREENS.screens.entries()) {
      const frame = frames[k];
      expect([frame.width, frame.height]).toEqual(SCREENS.viewport);
      const layers = screenLayers(SCREENS, screen);
      // every layer is one node; an SVG brings its paths along as vector children
      const top = frame.findAll().filter((n) => n.type !== "VECTOR");
      expect(top.length, screen.id).toBe(layers.length);
      const byId = new Map(layers.map((l) => [l.id, l]));
      const turned = (l: (typeof layers)[number]): boolean =>
        l.parent != null &&
        (!!byId.get(l.parent)!.rotation || turned(byId.get(l.parent)!));
      for (const [i, l] of layers.entries()) {
        const n = top[i];
        expect(n.name, `${screen.id} layer ${l.id}`).toBe(
          l.type === "SVG" ? l.name : l.svg ? "svg" : l.name,
        );
        if (l.rotation || l.type === "TEXT") continue;
        if (turned(l)) {
          // under a rotated layer: placed in that layer's own (unrotated) frame
          const p = byId.get(l.parent!)!;
          expect(n.x, `${screen.id} ${l.name} x in its parent`).toBeCloseTo(
            l.x - p.x,
            2,
          );
          expect(n.y, `${screen.id} ${l.name} y in its parent`).toBeCloseTo(
            l.y - p.y,
            2,
          );
          continue;
        }
        const at = absolute(n, frame);
        expect(at.x, `${screen.id} ${l.name} x`).toBeCloseTo(l.x, 2);
        expect(at.y, `${screen.id} ${l.name} y`).toBeCloseTo(l.y, 2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15000);
    // text keeps os-ui's words, and images their pixels
    const texts = page
      .findAll()
      .filter((n) => n.type === "TEXT")
      .map((n) => n.characters);
    for (const word of [
      "Layers",
      "Design",
      "Prototype",
      "Canvas",
      "Styles",
      "Export",
      "Drafts",
      "Share",
      "Position",
      "Layout",
      "Fill",
    ])
      expect(texts, word).toContain(word);
    expect(fig.images.size).toBeGreaterThan(0);
  }, 120_000);
});
