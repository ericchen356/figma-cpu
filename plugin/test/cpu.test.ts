// The real stepper must match the independent test oracle on all four demo programs, driven by the REAL canvas table.
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/decoder-table.json";
import countAsm from "../programs/count.asm?raw";
import fibAsm from "../programs/fib.asm?raw";
import rectAsm from "../programs/rect.asm?raw";
import bounceAsm from "../programs/bounce.asm?raw";
import { createCpu } from "../src/engine/cpu";
import { readTable, type TreeNode } from "../src/engine/table";
import { assemble } from "../src/assembler/asm";
import { run } from "./helpers/oracle";
import { Io } from "../src/screen/io";
import { MEM } from "../src/contracts/spec";

const table = readTable(fixture as TreeNode);
const prog = (src: string) => { const r = assemble(src); expect(r.errors).toEqual([]); return r.bytes; };
const regsOf = (R: number[]) => ({ A: R[0], B: R[1], C: R[2], D: R[3], H: R[4], L: R[5] });

function exec(bytes: number[], maxSteps: number, io?: Io, frame?: number) {
  const cpu = createCpu(table.rows, io ? { read: (a) => io.read(a), write: (a, v) => io.write(a, v) } : {});
  cpu.load(bytes, 0);
  let n = 0;
  while (!cpu.state.halted && n < maxSteps) { cpu.step(); n++; if (frame && n % frame === 0) io!.tickFrame(); }
  return { cpu, n };
}

describe("stepper == oracle (table read from the canvas)", () => {
  it("the canvas table had no problems", () => expect(table.problems).toEqual([]));
  for (const [name, src] of [["count", countAsm], ["fib", fibAsm], ["rect", rectAsm]] as const) {
    it(`${name}.asm: same registers, pc, steps and RAM`, () => {
      const bytes = prog(src);
      const o = run(bytes, { maxSteps: 100000 });
      const { cpu, n } = exec(bytes, 100000);
      expect(cpu.state.halted).toBe(true);
      expect(n).toBe(o.steps);
      expect(cpu.state.regs).toEqual(regsOf(Array.from(o.R)));
      expect(cpu.mem).toEqual(o.mem);
    });
  }
  it("count.asm ends with A = 10; fib.asm writes the sequence", () => {
    expect(exec(prog(countAsm), 1000).cpu.state.regs.A).toBe(10);
    expect(Array.from(exec(prog(fibAsm), 5000).cpu.mem.slice(0x4000, 0x400d))).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]);
  });
  it("bounce.asm: identical VRAM + registers to the oracle after 120 frames with the same TICK schedule", () => {
    const bytes = prog(bounceAsm), FRAME = 3000, STEPS = FRAME * 120;
    const ioO = new Io();
    const o = run(bytes, { maxSteps: STEPS, ioRead: (a) => ioO.read(a), ioWrite: (a, v) => ioO.write(a, v), onStep: (s) => { if (s % FRAME === 0) ioO.tickFrame(); } });
    const { cpu } = exec(bytes, STEPS, new Io(), FRAME);
    expect(cpu.state.regs).toEqual(regsOf(Array.from(o.R)));
    expect(cpu.state.pc).toBe(o.pc);
    expect(cpu.mem.slice(MEM.vramStart, MEM.vramStart + 12288)).toEqual(o.mem.slice(MEM.vramStart, MEM.vramStart + 12288));
  });
});

describe("behavior comes from the table, not the code", () => {
  it("swapping ADD and SUB micro-ops on the canvas swaps what the CPU does, with zero code change", () => {
    const t = JSON.parse(JSON.stringify(fixture)) as TreeNode;
    const row = (op: string) => t.children!.find((c) => c.name === `row/${op}`)!;
    const micro = (op: string) => row(op).children!.find((c) => c.name === "micro")!;
    const a = micro("20").characters!; micro("20").characters = micro("21").characters!; micro("21").characters = a;
    const swapped = readTable(t);
    const bytes = prog("LDI A, 10\nLDI B, 3\nADD A, B\nHLT"); // normally 13
    const cpu = createCpu(swapped.rows); cpu.load(bytes, 0);
    while (!cpu.state.halted) cpu.step();
    expect(cpu.state.regs.A).toBe(7);
  });
  it("setTable hot-swaps the decoder", () => {
    const cpu = createCpu(table.rows); cpu.load(prog("LDI A, 1\nHLT"), 0);
    cpu.setTable(table.rows.filter((r) => r.mnem !== "LDI"));
    const info = cpu.step();
    expect(info!.fault).toContain("unknown opcode");
    expect(cpu.state.halted).toBe(true);
  });
  it("StepInfo describes the instruction for the animator", () => {
    const cpu = createCpu(table.rows); cpu.load(prog("LDI A, 5\nLDI B, 2\nADD A, B"), 0);
    cpu.step(); cpu.step();
    const i = cpu.step()!;
    expect(i.row!.mnem).toBe("ADD");
    expect(i.alu).toEqual({ op: "ADD", in1: 5, in2: 2, out: 7 });
    expect(i.regsWritten).toEqual(["A"]);
    expect(i.pcBefore).toBe(6);
  });
  it("reset restores power-on state; stack ops round-trip", () => {
    const cpu = createCpu(table.rows);
    cpu.load(prog("LDI A, 9\nPUSH A\nPOP B\nCALL f\nHLT\nf: RET"), 0);
    while (!cpu.state.halted) cpu.step();
    expect(cpu.state.regs.B).toBe(9);
    expect(cpu.state.sp).toBe(0x7f00);
    cpu.reset();
    expect(cpu.state).toMatchObject({ pc: 0, sp: 0x7f00, halted: false, cycles: 0 });
  });
});
