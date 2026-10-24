// Runs the real draw script, binder, renderer and smoke entry against a fake Figma API.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildTable, Cpu, MEMORY, Rtl } from "../src/core";
import { bindMachine, findMachine, readRows } from "../src/figma/bind";
import { Renderer } from "../src/figma/render";
import { smoke } from "../src/smoke-entry";
import { FakeFigma, type FakeNode } from "./fake-figma";
import { boot, program, specRows } from "./helpers";

const root = join(__dirname, "..", "..");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

let fig: FakeFigma;

async function drawOn(page: string): Promise<string> {
  execFileSync("node", [join(root, "tools/draw-machine/build.mjs"), "--page", page]);
  const body = readFileSync(join(root, "tools/draw-machine/use-figma.js"), "utf8");
  return new AsyncFunction("figma", body)(fig);
}

beforeAll(async () => {
  fig = new FakeFigma(["Machine v2", "Leila", "Eric"]);
  (globalThis as unknown as { figma: FakeFigma }).figma = fig;
});

describe("draw script → binder → renderer", () => {
  it("draws the machine on the Eric page with every contract node", async () => {
    const msg = await drawOn("Eric");
    expect(msg).toMatch(/on page "Eric"/);
    const eric = fig.root.children.find((p) => p.name === "Eric")!;
    await fig.setCurrentPageAsync(eric);
    const machine = findMachine(eric as unknown as PageNode)!;
    expect(machine).toBeTruthy();
    const bound = await bindMachine(machine);
    expect(bound.missing).toEqual([]);
    expect(bound.rows).toHaveLength(29);
    expect(readRows(bound)).toEqual(specRows.map((r) => ({ ...r, micro: r.micro || "—" })));
    // Other pages untouched
    expect(fig.root.children.find((p) => p.name === "Leila")!.children).toHaveLength(0);
  });

  it("is idempotent: a second draw changes nothing", async () => {
    const before = fig.root.children.find((p) => p.name === "Eric")!.findAll().length;
    expect(await drawOn("Eric")).toMatch(/already drawn/);
    expect(fig.root.children.find((p) => p.name === "Eric")!.findAll().length).toBe(before);
  });

  it("renders Watch-mode T-states and instruction state without font or range errors", async () => {
    const eric = fig.root.children.find((p) => p.name === "Eric")!;
    const bound = await bindMachine(findMachine(eric as unknown as PageNode)!);
    const { table } = buildTable(readRows(bound));
    const cpu = boot(program("fib"), table);
    const rtl = new Rtl(cpu, () => table);
    const r = new Renderer(bound);
    for (let i = 0; i < 400; i++) {
      const tres = rtl.step();
      r.render({ cpu, table, mode: "watch", tres, pinBase: MEMORY.ramStart });
    }
    r.render({ cpu, table, mode: "instr", tres: null, pinBase: MEMORY.ramStart });
    const text = (name: string, child = "value") =>
      (bound.byName.get(name) as unknown as FakeNode).findOne((n) => n.name === child)?.characters;
    expect(text("cpu/reg/PC")).toBe(cpu.pc.toString(16).toUpperCase().padStart(4, "0"));
    expect(text("cpu/reg/A")).toBe(cpu.r[0].toString(16).toUpperCase().padStart(2, "0"));
    expect(text("cpu/reg/MAR")).toBe(cpu.mar.toString(16).toUpperCase().padStart(4, "0"));
    expect(text("mem/pin/cell/01", "v")).toBe("01");
    const micro = bound.rows.find((x) => x.mnem.characters === "ADD")!.micro as unknown as FakeNode;
    expect(micro.rangeFills.length).toBeGreaterThan(0);
  });

  it("diffs writes: re-rendering an unchanged CPU writes nothing", async () => {
    const eric = fig.root.children.find((p) => p.name === "Eric")!;
    const bound = await bindMachine(findMachine(eric as unknown as PageNode)!);
    const { table } = buildTable(readRows(bound));
    const cpu = new Cpu();
    const r = new Renderer(bound);
    r.render({ cpu, table, mode: "instr", tres: null, pinBase: 0x4000 });
    const writes = fig.writes;
    r.render({ cpu, table, mode: "instr", tres: null, pinBase: 0x4000 });
    expect(fig.writes).toBe(writes);
  });

  it("the MCP smoke entry runs rect.asm against the canvas table and paints the screen", async () => {
    const report = await smoke({ page: "Eric", program: "rect" });
    expect(report.ok).toBe(true);
    expect(report.tableErrors).toEqual([]);
    expect(report.missingNodes).toEqual([]);
    expect(report.halted).toBe(true);
    expect(report.litPixels).toBe(40 * 32);
    expect(fig.images[fig.images.length - 1].slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("the smoke entry can stop mid-instruction in Watch mode", async () => {
    const report = await smoke({ page: "Eric", program: "count", mode: "watch", instructions: 2, tstates: 4 });
    expect(report.tstate).toMatchObject({ t: 3, phase: "EXEC", sigs: ["PC_OUT", "MAR_LOAD"] });
  });
});
