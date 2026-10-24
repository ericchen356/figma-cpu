// The Figma OS editor built from os-ui's capture, against the fake Figma API: every captured layer
// becomes one node, at the page position it had in the browser, with its paint and text.
import { describe, expect, it } from "vitest";
import { resetFonts } from "../../src/figma/style";
import { FakeFigma, type FakeNode } from "../../test/fake-figma";
import empty from "../data/empty.json";
import type { Capture } from "../src/layers";
import { EDITOR, OsuiApp, PAGE } from "../plugin/src/app";
import type { ToUi } from "../plugin/src/messages";

const capture = empty as unknown as Capture;

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

/** A node's position on the page: its x/y plus every ancestor's, up to the editor frame. */
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
  it("builds every captured layer at its page position", async () => {
    const { fig, app, posted } = session();
    await app.handle({ type: "editor" });
    expect(
      posted.filter((m) => m.type === "log" && m.level === "error"),
    ).toEqual([]);
    const page = fig.root.children.find((p) => p.name === PAGE)!;
    const frame = page.children.find((n) => n.name === EDITOR)!;
    expect([frame.width, frame.height]).toEqual(capture.viewport);
    const nodes = frame.findAll();
    // every layer is one node; an SVG brings its paths along as vector children
    const svgPaths = nodes.filter((n) => n.type === "VECTOR").length;
    expect(nodes.length - svgPaths).toBe(capture.layers.length);
    // the same tree, in the same order, at the same places
    const top = nodes.filter((n) => n.type !== "VECTOR");
    let checked = 0;
    for (const [i, l] of capture.layers.entries()) {
      const n = top[i];
      expect(n.name, `layer ${l.id}`).toBe(
        l.type === "SVG" ? l.name : l.svg ? "svg" : l.name,
      );
      if (l.rotation || l.type === "TEXT") continue;
      const at = absolute(n, frame);
      expect(at.x, `${l.name} x`).toBeCloseTo(l.x, 2);
      expect(at.y, `${l.name} y`).toBeCloseTo(l.y, 2);
      expect(n.width, `${l.name} w`).toBeCloseTo(Math.max(0.01, l.w), 2);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
    // text keeps os-ui's words, and the logo its pixels
    const texts = nodes
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
    ])
      expect(texts, word).toContain(word);
    expect(fig.images.size).toBe(1);
  });
});
