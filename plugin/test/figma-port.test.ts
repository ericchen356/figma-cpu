// Runs the REAL renderer + port against a fake Figma built from the REAL "Machine v2" node tree (names/types/text).
// Catches every name or child-field mismatch before anyone opens Figma, and proves the read-only guard.
import { describe, it, expect } from "vitest";
import page from "./fixtures/machine-v2.json";
import decoder from "./fixtures/decoder-table.json";
import countAsm from "../programs/count.asm?raw";
import { FigmaPort, type FigmaApi } from "../src/engine/figma-port";
import { Renderer } from "../src/engine/render";
import { createCpu } from "../src/engine/cpu";
import { readTable, type TreeNode } from "../src/engine/table";
import { assemble } from "../src/assembler/asm";
import { N } from "../src/contracts/nodes";

let nextId = 1;
class FakeNode {
  id = `n${nextId++}`;
  name: string; type: string; characters?: string;
  fills: any[] = []; strokes: any[] = []; strokeWeight = 0;
  fontName = { family: "Inter", style: "Regular" };
  componentProperties?: Record<string, { value: string }>;
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  writes = 0;
  constructor(j: any) {
    this.name = j.name; this.type = j.type;
    if (j.type === "TEXT") this.characters = j.characters ?? "";
    if (j.props) this.componentProperties = Object.fromEntries(Object.entries(j.props).map(([k, v]) => [k, { value: v as string }]));
    for (const c of j.children ?? []) { const k = new FakeNode(c); k.parent = this; this.children.push(k); }
  }
  findAll(cb: (n: FakeNode) => boolean): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => { for (const c of n.children) { if (cb(c)) out.push(c); walk(c); } };
    walk(this); return out;
  }
  findOne(cb: (n: FakeNode) => boolean) { return this.findAll(cb)[0] ?? null; }
  findChild(cb: (n: FakeNode) => boolean) { return this.children.find(cb) ?? null; }
  setProperties(p: Record<string, string>) { for (const [k, v] of Object.entries(p)) this.componentProperties![k].value = v; }
}
const snapshot = (n: FakeNode): string => JSON.stringify([n.name, n.characters, n.fills, n.strokes, n.strokeWeight, n.componentProperties, n.children.map(snapshot)]);

function setup(pageName: string, writable: boolean) {
  const root = new FakeNode({ name: pageName, type: "PAGE", children: (page as any).children });
  const images: Uint8Array[] = [];
  const api: FigmaApi = { loadFontAsync: async () => {}, createImage: (b) => (images.push(b), { hash: `h${images.length}` }) };
  const port = new FigmaPort(root as any, api, writable);
  return { root, port, images };
}
const find = (root: FakeNode, name: string) => root.findOne((n) => n.name === name)!;
const child = (n: FakeNode, f: string) => n.findChild((c) => c.name === f)!;
const cpuFor = () => {
  const cpu = createCpu(readTable(decoder as TreeNode).rows);
  cpu.load(assemble(countAsm).bytes, 0);
  return cpu;
};

describe("FigmaPort on the real Machine v2 tree (writable test page)", () => {
  it("runs count.asm and the canvas shows the result, with ZERO unresolved names", async () => {
    const { root, port } = setup(N.testPage, true);
    const cpu = cpuFor();
    const r = new Renderer(port);
    r.render(cpu.state, cpu.mem, null);
    while (!cpu.state.halted) r.render(cpu.state, cpu.mem, cpu.step());
    await port.flush();
    expect(port.stats.missing).toBe(0);
    expect(child(find(root, "cpu/reg/A"), "value").characters).toBe("0A");
    expect(child(find(root, "cpu/reg/A"), "dec").characters).toBe("10");
    expect(child(find(root, "cpu/reg/B"), "value").characters).toBe("01");
    expect(child(find(root, "cpu/reg/PC"), "value").characters).toBe(cpu.state.pc.toString(16).toUpperCase().padStart(4, "0"));
    expect(child(find(root, "cpu/reg/IR"), "mnem").characters).toBe("HLT");
    expect(find(root, "cpu/cycles").characters).toBe(`cycles ${cpu.state.cycles}`);
    expect(child(find(root, "mem/ram/cell/00"), "v").characters).toBe(cpu.mem[0].toString(16).toUpperCase().padStart(2, "0"));
    // Z flag lamp lit (CMP A,C equal at the end), N not
    expect(child(find(root, "cpu/flag/Z"), "lamp").fills[0].color.r).toBeGreaterThan(0.9);
    expect(child(find(root, "cpu/flag/N"), "lamp").fills[0].color.r).toBeLessThan(0.3);
  });
  it("highlights the executed register variant and the decoder row, and clears the previous one", () => {
    const { root, port } = setup(N.testPage, true);
    const cpu = cpuFor();
    const r = new Renderer(port);
    r.render(cpu.state, cpu.mem, cpu.step()); // LDI A,0
    expect(find(root, "cpu/reg/A").componentProperties!.State.value).toBe("active");
    expect(find(root, "row/10").strokes.length).toBe(1);
    r.render(cpu.state, cpu.mem, cpu.step()); // LDI B,1
    expect(find(root, "cpu/reg/A").componentProperties!.State.value).toBe("idle");
    expect(find(root, "cpu/reg/B").componentProperties!.State.value).toBe("active");
  });
  it("sets the screen rectangle to an image fill", () => {
    const { root, port, images } = setup(N.testPage, true);
    expect(port.applyScreen(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(images.length).toBe(1);
    expect(find(root, "dev/screen").fills[0]).toMatchObject({ type: "IMAGE", imageHash: "h1", scaleMode: "FILL" });
  });
});

describe("READ-ONLY guard: bound to the canvas team's page", () => {
  it("a full run changes NOTHING and creates no image", async () => {
    const { root, port, images } = setup(N.page, false);
    const before = snapshot(root);
    const cpu = cpuFor();
    const r = new Renderer(port);
    r.render(cpu.state, cpu.mem, null);
    while (!cpu.state.halted) r.render(cpu.state, cpu.mem, cpu.step());
    await port.flush();
    expect(port.applyScreen(new Uint8Array([1]))).toBe(false);
    expect(images.length).toBe(0);
    expect(snapshot(root)).toBe(before);
    expect(port.stats.blocked).toBeGreaterThan(100);
    expect(port.stats.writes).toBe(0);
  });
});
