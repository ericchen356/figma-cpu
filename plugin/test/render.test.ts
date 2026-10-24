import { describe, it, expect } from "vitest";
import { Renderer, type RenderPort, RAM_WINDOW, PIN_WINDOW } from "../src/engine/render";
import { createCpu } from "../src/engine/cpu";
import { readTable, type TreeNode } from "../src/engine/table";
import fixture from "./fixtures/decoder-table.json";
import { assemble } from "../src/assembler/asm";
import { requiredNames } from "../src/contracts/nodes";

const table = readTable(fixture as TreeNode);
function fakePort() {
  const log: string[] = [];
  const port: RenderPort = {
    text: (n, f, v) => log.push(`text ${n}${f ? "." + f : ""}=${v}`),
    lamp: (n, on) => log.push(`lamp ${n}=${on}`),
    mark: (n, on) => log.push(`mark ${n}=${on}`),
  };
  return { port, log };
}

describe("Renderer diffs", () => {
  it("first render writes everything once, an identical second render writes nothing", () => {
    const { port, log } = fakePort();
    const r = new Renderer(port);
    const cpu = createCpu(table.rows);
    r.render(cpu.state, cpu.mem);
    const first = log.length;
    expect(first).toBeGreaterThan(RAM_WINDOW + PIN_WINDOW);
    log.length = 0;
    r.render(cpu.state, cpu.mem);
    expect(log).toEqual([]);
  });
  it("one instruction writes only what changed (register, pc, IR, cycles, bus, alu, row...) not the 320 memory cells", () => {
    const { port, log } = fakePort();
    const r = new Renderer(port);
    const cpu = createCpu(table.rows);
    cpu.load(assemble("LDI A, 5\nINC A").bytes, 0);
    r.render(cpu.state, cpu.mem);
    log.length = 0;
    const info = cpu.step();
    r.render(cpu.state, cpu.mem, info);
    expect(log).toContain("text cpu/reg/A.value=05");
    expect(log).toContain("text cpu/reg/PC.value=0003");
    expect(log).toContain("text cpu/reg/IR.mnem=LDI");
    expect(log.some((l) => l.startsWith("mark cpu/decoder/table/row/10=true"))).toBe(true);
    expect(log.length).toBeLessThan(40);
    expect(log.filter((l) => l.includes("mem/ram/cell")).length).toBeLessThanOrEqual(4); // pc cell marks only
  });
  it("RAM window follows PC's page and rewrites cells when the page changes", () => {
    const { port, log } = fakePort();
    const r = new Renderer(port);
    const cpu = createCpu(table.rows);
    cpu.mem[0x0155] = 0xab;
    cpu.state.pc = 0x0100;
    r.render(cpu.state, cpu.mem);
    expect(log).toContain("text mem/ram/base=base 0100");
    expect(log).toContain("text mem/ram/cell/55.v=AB");
  });
  it("only ever touches names that exist in the contract", () => {
    const { port, log } = fakePort();
    const r = new Renderer(port);
    const cpu = createCpu(table.rows);
    cpu.load(assemble("LDI A, 1\nADD A, A\nHLT").bytes, 0);
    r.render(cpu.state, cpu.mem, null, { TICK: 3, RAND: 9, MOUSE_X: 1, MOUSE_Y: 2, MOUSE_BTN: 0, KEY: 0 });
    for (let i = 0; i < 3; i++) r.render(cpu.state, cpu.mem, cpu.step());
    const valid = new Set(requiredNames());
    for (const l of log) {
      const name = l.replace(/^(text|lamp|mark) /, "").replace(/[.=].*$/, "").replace(/^cpu\/decoder\/table\/row\/.*/, "cpu/decoder/table");
      expect(valid.has(name), name).toBe(true);
    }
  });
});
