import { describe, expect, it } from "vitest";
import { STACK_TOP, Trace } from "../src/cpu";
import { parseTable } from "../src/table";
import { boot, readProgram, run, specRows, specTable } from "./helpers";

const exec = (src: string) => {
  const cpu = boot(`${src}\nHLT`);
  run(cpu);
  return cpu;
};
const A = 0,
  B = 1,
  C = 2,
  D = 3,
  H = 4,
  L = 5;

describe("data movement", () => {
  it("LDI / MOV", () => {
    const cpu = exec("LDI A, 42\nMOV D, A");
    expect(cpu.regs[D]).toBe(42);
  });
  it("LD / ST through HL, INHL", () => {
    const cpu = exec("LHL 0x40FF\nLDI A, 7\nST A\nINHL\nST A\nLD B");
    expect(cpu.mem[0x40ff]).toBe(7);
    expect(cpu.mem[0x4100]).toBe(7);
    expect(cpu.hl()).toBe(0x4100);
    expect(cpu.regs[B]).toBe(7);
  });
  it("LDA / STA absolute", () => {
    const cpu = exec("LDI C, 9\nSTA C, 0x5000\nLDA L, 0x5000");
    expect(cpu.regs[L]).toBe(9);
  });
  it("LHL sets H and L", () => {
    const cpu = exec("LHL 0xABCD");
    expect([cpu.regs[H], cpu.regs[L]]).toEqual([0xab, 0xcd]);
  });
});

describe("ALU and flags", () => {
  const flags = (cpu: { Z: boolean; C: boolean; N: boolean }) => ({
    Z: cpu.Z,
    C: cpu.C,
    N: cpu.N,
  });
  it("ADD sets carry on overflow", () => {
    const cpu = exec("LDI A, 200\nLDI B, 100\nADD A, B");
    expect(cpu.regs[A]).toBe(44);
    expect(flags(cpu)).toEqual({ Z: false, C: true, N: false });
  });
  it("SUB sets carry on borrow and N on bit 7", () => {
    const cpu = exec("LDI A, 1\nLDI B, 2\nSUB A, B");
    expect(cpu.regs[A]).toBe(0xff);
    expect(flags(cpu)).toEqual({ Z: false, C: true, N: true });
  });
  it("CMP only sets flags", () => {
    const cpu = exec("LDI A, 5\nLDI B, 5\nCMP A, B");
    expect(cpu.regs[A]).toBe(5);
    expect(cpu.Z).toBe(true);
  });
  it("logic ops clear carry", () => {
    const cpu = exec(
      "LDI A, 255\nLDI B, 1\nADD A, B\nLDI A, 0x0F\nLDI B, 0xF0\nOR A, B",
    );
    expect(cpu.regs[A]).toBe(0xff);
    expect(cpu.C).toBe(false);
    expect(exec("LDI A, 0x0F\nLDI B, 0xF0\nAND A, B").Z).toBe(true);
    expect(exec("LDI A, 0xFF\nLDI B, 0x0F\nXOR A, B").regs[A]).toBe(0xf0);
  });
  it("INC / DEC wrap and leave carry alone", () => {
    const cpu = exec("LDI A, 255\nLDI B, 1\nADD A, B\nLDI C, 255\nINC C");
    expect(cpu.regs[C]).toBe(0);
    expect(cpu.Z).toBe(true);
    expect(cpu.C).toBe(true);
    expect(exec("LDI A, 0\nDEC A").regs[A]).toBe(0xff);
  });
  it("SHL / SHR shift the outgoing bit into carry", () => {
    const l = exec("LDI A, 0x81\nSHL A");
    expect([l.regs[A], l.C]).toEqual([0x02, true]);
    const r = exec("LDI A, 0x03\nSHR A");
    expect([r.regs[A], r.C]).toEqual([0x01, true]);
  });
});

describe("control flow and stack", () => {
  it("conditional jumps", () => {
    const cpu = exec(`
      LDI A, 0
      LDI B, 0
      CMP A, B
      JZ z
      LDI C, 1
z:    JNZ bad
      LDI B, 1
      SUB A, B      ; borrow
      JNC bad
      JC ok
bad:  LDI D, 0xBB
ok:   NOP`);
    expect(cpu.regs[C]).toBe(0);
    expect(cpu.regs[D]).toBe(0);
  });
  it("CALL / RET / PUSH / POP", () => {
    const cpu = exec(`
      LDI A, 1
      PUSH A
      CALL f
      POP B
      JMP end
f:    LDI A, 2
      RET
end:  NOP`);
    expect(cpu.regs[A]).toBe(2);
    expect(cpu.regs[B]).toBe(1);
    expect(cpu.sp).toBe(STACK_TOP);
  });
  it("CALL pushes the return address high byte first", () => {
    const cpu = boot("CALL f\nf: HLT");
    run(cpu);
    expect(cpu.sp).toBe(STACK_TOP - 2);
    expect([cpu.mem[STACK_TOP - 1], cpu.mem[STACK_TOP - 2]]).toEqual([
      0x00, 0x03,
    ]);
  });
  it("HLT stops and further steps do nothing", () => {
    const cpu = exec("LDI A, 1");
    const cycles = cpu.cycles;
    cpu.step();
    expect(cpu.halted).toBe(true);
    expect(cpu.cycles).toBe(cycles);
  });
  it("illegal opcodes halt with an error", () => {
    const cpu = boot(".db 0xEE");
    cpu.step();
    expect(cpu.halted).toBe(true);
    expect(cpu.error).toBe("illegal opcode EE at 0000");
  });
  it("bad register encodings halt with an error", () => {
    const cpu = boot(".db 0x26, 0x90"); // INC with register 9
    cpu.step();
    expect(cpu.error).toMatch(/bad register index 9/);
  });
});

describe("IO and VRAM", () => {
  it("reads memory-mapped IO", () => {
    const cpu = boot(
      '.include "hw.asm"\nLDA A, MOUSE_X\nLDA B, MOUSE_Y\nLDA C, TICK\nLDA D, RAND\nLDA H, RAND\nHLT',
    );
    Object.assign(cpu.io, { mouseX: 12, mouseY: 34, tick: 56 });
    run(cpu);
    expect([cpu.regs[A], cpu.regs[B], cpu.regs[C]]).toEqual([12, 34, 56]);
    expect(cpu.regs[D]).not.toBe(cpu.regs[H]);
  });
  it("writing KEY acknowledges it", () => {
    const cpu = boot(
      '.include "hw.asm"\nLDA A, KEY\nLDI B, 0\nSTA B, KEY\nHLT',
    );
    cpu.io.key = 0x38;
    run(cpu);
    expect(cpu.regs[A]).toBe(0x38);
    expect(cpu.io.key).toBe(0);
  });
  it("bumps the VRAM version only on screen writes", () => {
    const cpu = boot("LDI A, 1\nSTA A, 0x4000\nHLT");
    const before = cpu.vramVersion;
    run(cpu);
    expect(cpu.vramVersion).toBe(before);
    const v = boot("LDI A, 1\nSTA A, 0x8000\nHLT");
    const vBefore = v.vramVersion;
    run(v);
    expect(v.vramVersion).toBe(vBefore + 1);
  });
});

describe("trace (drives Watch mode)", () => {
  it("records fetch, accesses, register writes and the ALU", () => {
    const cpu = boot("LDI A, 3\nLDI B, 4\nADD A, B\nSTA A, 0x4000\nHLT");
    cpu.step();
    cpu.step();
    const add = new Trace();
    cpu.step(add);
    expect(add).toMatchObject({
      fetchAddr: 6,
      opcode: 0x20,
      mnem: "ADD",
      alu: { op: "ADD", a: 3, b: 4, out: 7 },
    });
    expect([...add.regsWritten]).toEqual([A]);
    const sta = new Trace();
    cpu.step(sta);
    expect(sta.accesses.at(-1)).toEqual({ kind: "w", addr: 0x4000, value: 7 });
  });
});

describe("the decoder table is the CPU's logic", () => {
  it("rewiring ADD to SUB makes count.asm count down", () => {
    const rows = specRows().map((r) =>
      r.mnem === "ADD" ? { ...r, micro: "REG; ALU SUB rd rs" } : r,
    );
    const cpu = boot(readProgram("count.asm"), specTable(rows));
    const seen: number[] = [];
    while (!cpu.halted) {
      cpu.step();
      if (cpu.ir === 0x20) seen.push(cpu.regs[A]);
    }
    expect(seen.slice(0, 3)).toEqual([0xff, 0xfe, 0xfd]);
    expect(cpu.regs[A]).toBe(10);
  });
  it("renumbering an opcode re-targets the assembler", () => {
    const rows = specRows().map((r) =>
      r.mnem === "HLT" ? { ...r, op: "FE" } : r,
    );
    const cpu = boot("LDI A, 1", specTable(rows));
    expect(boot("HLT", specTable(rows)).mem[0]).toBe(0xfe);
    expect(cpu.mem[0]).toBe(0x10);
  });
  it("reports bad rows instead of crashing", () => {
    const rows = [
      ...specRows(),
      { op: "50", mnem: "WAT", fmt: "-", micro: "FROB A" },
      { op: "zz", mnem: "BAD", fmt: "-", micro: "" },
      { op: "01", mnem: "DUP", fmt: "-", micro: "" },
      { op: "51", mnem: "FMT", fmt: "r,r,r", micro: "" },
      { op: "52", mnem: "ARGS", fmt: "-", micro: "ALU ADD rd" },
    ];
    const { errors, table } = parseTable(rows);
    expect(errors).toEqual([
      'row 50 (WAT): unknown micro-op "FROB"',
      'row zz (BAD): opcode must be a hex byte, got "zz"',
      "row 01 (DUP): opcode 01 is already used by HLT",
      'row 51 (FMT): unknown format "r,r,r" (- r r,r r,i8 r,a16 i16 a16)',
      "row 52 (ARGS): ALU ADD takes 3 operand(s), got 2",
    ]);
    expect(table.byMnem.size).toBe(29);
  });
});
