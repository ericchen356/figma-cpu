import { describe, expect, it } from "vitest";
import { MENUS, MODES, RAIL, TOOLBAR, flyoutItems, menuHtml, paletteCommands, shownItem } from "../src/chrome";
import { TOOL_KEYS } from "../src/model";

describe("toolbar spec", () => {
  const live = TOOLBAR.flatMap((g) => g.items).filter((i) => i.tool);

  it("puts every shortcut tool on the toolbar, each in exactly one item", () => {
    const tools = live.map((i) => i.tool);
    expect(new Set(tools).size).toBe(tools.length);
    for (const t of new Set(Object.values(TOOL_KEYS))) expect(tools, t).toContain(t);
    // Polygon and Star have no shortcut in Figma either, but they are tools here too.
    expect(tools).toEqual(expect.arrayContaining(["polygon", "star"]));
  });

  it("shows a group's first item until something is picked from it, like the real toolbar", () => {
    for (const g of TOOLBAR) expect(shownItem(g, {})).toBe(g.items[0]);
    const creation = TOOLBAR.find((g) => g.id === "creation")!;
    expect(shownItem(creation, {}).id).toBe("pen");
    expect(shownItem(creation, { creation: "pencil" }).tool).toBe("paint");
    expect(shownItem(creation, { creation: "erase" }).tool).toBe("erase");
  });

  it("follows the last tool picked from a group and ignores picks that are not tools", () => {
    const shape = TOOLBAR.find((g) => g.id === "shape")!;
    expect(shownItem(shape, {}).id).toBe("rect");
    expect(shownItem(shape, { shape: "star" }).id).toBe("star");
    expect(shownItem(shape, { shape: "image" }).id).toBe("rect"); // Place image is a command, not a tool
  });

  it("checks only the active tool in a flyout, and every entry has a command", () => {
    const shape = TOOLBAR.find((g) => g.id === "shape")!;
    const items = flyoutItems(shape, "ellipse");
    expect(items.filter((i) => i.check).map((i) => i.cmd)).toEqual(["tool:ellipse"]);
    expect(items.find((i) => i.label === "Image…")?.cmd).toBe("image");
  });
});

describe("menus", () => {
  const all = Object.entries(MENUS).flatMap(([key, items]) =>
    items.map((i) => ({ key, i })),
  );

  it("points every submenu at a menu that exists", () => {
    for (const { i } of all)
      if (i.sub) expect(MENUS[i.sub], i.label).toBeDefined();
  });

  it("gives dividers no command and live entries exactly one action", () => {
    for (const { i } of all) {
      if (i.divider) expect(i.cmd ?? i.sub).toBeUndefined();
      else expect(Number(!!i.cmd) + Number(!!i.sub)).toBeLessThanOrEqual(1);
    }
  });

  it("draws entries without a command dimmed and unclickable", () => {
    const html = menuHtml([
      { label: "Plugins" },
      { label: "Undo", cmd: "undo" },
    ]);
    expect(html).toContain('class="mi dis"');
    expect(html.match(/data-cmd="undo"/g)).toHaveLength(1);
    expect(html.match(/data-cmd/g)).toHaveLength(1);
  });
});

describe("rail and palette", () => {
  it("has File, Assets and Tools on the rail, File first, and no Variables", () => {
    expect(RAIL.map((r) => r.id)).toEqual(["file", "assets", "tools"]);
  });

  it("lists each command once and never the palette itself", () => {
    const cmds = paletteCommands().map((c) => c.cmd);
    expect(new Set(cmds).size).toBe(cmds.length);
    expect(cmds).not.toContain("palette");
    expect(cmds).toContain("tool:rect");
    expect(cmds).toContain("toggle-rulers");
  });
});

describe("mode switcher", () => {
  it("has Draw, Design, Motion and Dev Mode, with only Motion not implemented", () => {
    expect(MODES.map((m) => m.id)).toEqual(["draw", "design", "motion", "dev"]);
    expect(MODES.filter((m) => !m.live).map((m) => m.id)).toEqual(["motion"]);
  });
});

describe("every toolbar item does something", () => {
  it("is either a tool or a command, never a dead button", () => {
    for (const g of TOOLBAR) for (const i of g.items) expect(Boolean(i.tool) !== Boolean(i.cmd), i.label).toBe(true);
  });

  it("leaves no dimmed entries in the toolbar flyouts", () => {
    for (const g of TOOLBAR) for (const i of flyoutItems(g, "move")) expect(i.cmd, i.label).toBeDefined();
  });
});
