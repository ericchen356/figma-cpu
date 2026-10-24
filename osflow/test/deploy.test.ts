// The deployment, end to end, on silicon's fake Plugin API: build the editor page exactly as the
// spike plugin does, then play the prototype viewer. Pressing a hotspot runs the reaction that is
// stored on that node, in the strict emulator, against the variables the plugin created.
import { describe, expect, it } from "vitest";
import { buildSpike } from "../spike/src/spike";
import { runFigmaActions, type FigmaValue } from "../../silicon/src/prototype/emulate";
import { FakeFigma, type FakeNode, type FakeVariable } from "../../silicon/test/fake-figma";

/** The prototype viewer: variables by id, and a way to trigger what a person would do. */
class Viewer {
  readonly vars = new Map<string, FigmaValue>();
  private readonly byName = new Map<string, FakeVariable>();

  constructor(
    private fake: FakeFigma,
    private root: FakeNode,
  ) {
    for (const c of fake.collections)
      for (const v of c.vars) {
        this.vars.set(v.id, v.valuesByMode[c.defaultModeId] as FigmaValue);
        this.byName.set(v.name, v);
      }
  }

  get(name: string): FigmaValue {
    const v = this.byName.get(name);
    if (!v) throw new Error(`no variable ${name}`);
    return this.vars.get(v.id)!;
  }

  private find(name: string): FakeNode {
    let hit: FakeNode | undefined;
    this.root.walkRaw((n) => {
      if (!hit && n.name === name) hit = n;
    });
    if (!hit) throw new Error(`no node ${name}`);
    return hit;
  }

  /** Runs every reaction of `node` with this trigger (a key press is matched by its key codes). */
  fire(node: string, type: string, keyCodes?: number[]): number {
    const target = node === "root" ? this.root : this.find(node);
    let executed = 0;
    let ran = 0;
    for (const r of target.reactions) {
      const t = r.trigger as { type: string; keyCodes?: number[] };
      if (t.type !== type) continue;
      if (keyCodes && JSON.stringify(t.keyCodes) !== JSON.stringify(keyCodes)) continue;
      executed += runFigmaActions(r.actions ?? [], this.vars);
      ran++;
    }
    if (!ran) throw new Error(`${node} has no ${type} reaction${keyCodes ? ` for keys ${keyCodes}` : ""}`);
    return executed;
  }
}

async function deployed() {
  const fake = new FakeFigma();
  const report = await buildSpike(fake as unknown as PluginAPI, "editor");
  const root = fake.currentPage.children.find((n) => n.name === "OS · Editor")!;
  return { fake, report, root, viewer: new Viewer(fake, root) };
}

describe("the editor deployed to Figma", () => {
  it("builds with no errors and gets a flow", async () => {
    const { report, fake } = await deployed();
    expect(report.errors).toEqual([]);
    expect(fake.currentPage.flowStartingPoints.map((f) => f.name)).toContain("OS · Editor");
  });

  it("gives every canvas cell a down, enter and up reaction", async () => {
    const { root } = await deployed();
    let cells = 0;
    root.walkRaw((n) => {
      if (!n.name.startsWith("cell/")) return;
      cells++;
      expect(n.reactions.map((r) => (r.trigger as { type: string }).type).sort(), n.name).toEqual(["MOUSE_DOWN", "MOUSE_ENTER", "MOUSE_UP"]);
    });
    expect(cells).toBe(140);
  });

  it("draws a rectangle when a person picks the tool and drags across hotspots", async () => {
    const { viewer } = await deployed();
    viewer.fire("tool/rect", "ON_CLICK");
    viewer.fire("cell/2,1", "MOUSE_DOWN");
    viewer.fire("cell/4,2", "MOUSE_ENTER");
    viewer.fire("cell/5,3", "MOUSE_ENTER");
    viewer.fire("cell/5,3", "MOUSE_UP");
    expect(viewer.get("g/n")).toBe(1);
    expect(viewer.get("g/sel")).toBe(0);
    expect(viewer.get("g/tool")).toBe(0); // back on Move
    expect([viewer.get("L0/x"), viewer.get("L0/y"), viewer.get("L0/w"), viewer.get("L0/h")]).toEqual([80, 40, 160, 120]);
    expect(viewer.get("L0/vis")).toBe(true);
    expect(viewer.get("L0/f/12")).toBe(true); // the default fill
    expect(viewer.get("L0/used")).toBe(true);
    expect(viewer.get("L0/sel")).toBe(true);
  });

  it("moves, recolors and deletes it", async () => {
    const { viewer } = await deployed();
    viewer.fire("tool/rect", "ON_CLICK");
    viewer.fire("cell/2,1", "MOUSE_DOWN");
    viewer.fire("cell/4,2", "MOUSE_ENTER");
    viewer.fire("cell/4,2", "MOUSE_UP");
    // Press inside it and drag: it follows the pointer by the same offset.
    viewer.fire("cell/3,2", "MOUSE_DOWN");
    viewer.fire("cell/6,5", "MOUSE_ENTER");
    viewer.fire("cell/6,5", "MOUSE_UP");
    expect([viewer.get("L0/x"), viewer.get("L0/y")]).toEqual([5 * 40, 4 * 40]);
    viewer.fire("swatch/8", "ON_CLICK");
    expect(viewer.get("L0/f/8")).toBe(true);
    expect(viewer.get("L0/f/12")).toBe(false);
    viewer.fire("root", "ON_KEY_DOWN", [46]);
    expect(viewer.get("g/n")).toBe(0);
    expect(viewer.get("L0/used")).toBe(false);
  });

  it("every reaction stays within the executed-action budget on a busy canvas", async () => {
    const { viewer, root } = await deployed();
    let worst = 0;
    // Fill the canvas with layers, then press every hotspot once.
    for (let i = 0; i < 9; i++) {
      viewer.fire("tool/rect", "ON_CLICK");
      viewer.fire(`cell/${i},1`, "MOUSE_DOWN");
      viewer.fire(`cell/${i + 2},3`, "MOUSE_ENTER");
      viewer.fire(`cell/${i + 2},3`, "MOUSE_UP");
    }
    root.walkRaw((n) => {
      if (!n.name.startsWith("cell/")) return;
      for (const t of ["MOUSE_DOWN", "MOUSE_ENTER", "MOUSE_UP"]) worst = Math.max(worst, viewer.fire(n.name, t));
    });
    expect(worst).toBeLessThan(500);
  });
});

describe("the measurement tests", () => {
  it("build without errors and each is its own flow", async () => {
    const fake = new FakeFigma();
    const report = await buildSpike(fake as unknown as PluginAPI, "all");
    expect(report.errors).toEqual([]);
    expect(fake.currentPage.flowStartingPoints.map((f) => f.name).sort()).toEqual(["OS · I1 · Pointer", "OS · I2 · Keys", "OS · R1 · Size", "OS · R2 · Position", "OS · R3 · Fill"]);
  });

  it("the pointer test counts a drag: down, enters while held, up", async () => {
    const fake = new FakeFigma();
    await buildSpike(fake as unknown as PluginAPI, "input");
    const root = fake.currentPage.children.find((n) => n.name === "OS · I1 · Pointer")!;
    const viewer = new Viewer(fake, root);
    viewer.fire("cell/1,1", "MOUSE_ENTER");
    viewer.fire("cell/2,1", "MOUSE_DOWN");
    viewer.fire("cell/3,1", "MOUSE_ENTER");
    viewer.fire("cell/4,1", "MOUSE_ENTER");
    viewer.fire("cell/4,1", "MOUSE_UP");
    viewer.fire("cell/5,1", "MOUSE_ENTER");
    expect([viewer.get("i1/downs"), viewer.get("i1/enters"), viewer.get("i1/dragEnters"), viewer.get("i1/ups")]).toEqual([1, 4, 2, 1]);
    expect([viewer.get("i1/downX"), viewer.get("i1/upX"), viewer.get("i1/cursorX")]).toEqual([2, 4, 160]);
  });
});
