import { describe, expect, it } from "vitest";
import { assemble, evaluate } from "../src/assembler";
import { includes, specTable } from "./helpers";

const table = specTable();
const asm = (src: string) => assemble(src, table, { includes: includes() });
const bytes = (src: string) => {
  const r = asm(src);
  expect(r.errors).toEqual([]);
  return r.segments.flatMap((s) => s.bytes);
};

describe("encoding", () => {
  it("encodes every operand format", () => {
    expect(bytes("NOP")).toEqual([0x00]);
    expect(bytes("INC C")).toEqual([0x26, 0x20]);
    expect(bytes("MOV H, L")).toEqual([0x11, 0x45]);
    expect(bytes("LDI B, 200")).toEqual([0x10, 0x10, 200]);
    expect(bytes("LDI A, -1")).toEqual([0x10, 0x00, 0xff]);
    expect(bytes("STA D, 0x4010")).toEqual([0x15, 0x30, 0x10, 0x40]);
    expect(bytes("LHL 0x8001")).toEqual([0x16, 0x01, 0x80]);
    expect(bytes("JMP 0x1234")).toEqual([0x30, 0x34, 0x12]);
  });

  it("is case-insensitive for mnemonics and registers", () => {
    expect(bytes("mov a, b")).toEqual([0x11, 0x01]);
  });

  it("resolves forward and backward labels", () => {
    expect(bytes("start: JMP end\nNOP\nend: JMP start")).toEqual([
      0x30, 0x04, 0x00, 0x00, 0x30, 0x00, 0x00,
    ]);
  });

  it("handles .org, .db, .dw, .equ and NAME = value", () => {
    const r = asm(
      '.equ BASE, 0x10\nTOP = BASE + 2\n.org BASE\n.db 1, "hi", TOP\n.dw 0xBEEF',
    );
    expect(r.errors).toEqual([]);
    expect(r.segments).toEqual([
      { start: 0x10, bytes: [1, 0x68, 0x69, 0x12, 0xef, 0xbe] },
    ]);
  });

  it("splits non-contiguous code into segments", () => {
    const r = asm("NOP\n.org 0x100\nHLT");
    expect(r.segments).toEqual([
      { start: 0, bytes: [0] },
      { start: 0x100, bytes: [1] },
    ]);
  });

  it("ignores comments, including ';' inside quotes", () => {
    expect(bytes(".db ';' ; a semicolon\n.db \";\"")).toEqual([0x3b, 0x3b]);
  });

  it("expands includes", () => {
    const r = asm('.include "hw.asm"\nLHL VRAM');
    expect(r.errors).toEqual([]);
    expect(r.segments[0].bytes).toEqual([0x16, 0x00, 0x80]);
  });
});

describe("expressions", () => {
  const sym = new Map([["X", 0x1234]]);
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["0x10 | 0b0001", 17],
    ["$FF & 0x0F", 15],
    ["1 << 4 + 1", 32],
    ["lo(X)", 0x34],
    ["hi(X)", 0x12],
    ["X - 4", 0x1230],
    ["'A'", 65],
    ["-5 + 10", 5],
  ])("%s = %i", (expr, want) => {
    expect(evaluate(expr, sym)).toBe(want);
  });
});

describe("errors", () => {
  const firstError = (src: string) => asm(src).errors[0];
  it("reports unknown instructions with a line number", () => {
    expect(firstError("NOP\nFOO A")).toMatchObject({
      line: 2,
      message: 'unknown instruction "FOO"',
    });
  });
  it("reports wrong operand counts", () => {
    expect(firstError("ADD A").message).toMatch(/ADD takes 2 operand/);
  });
  it("reports bad registers", () => {
    expect(firstError("INC X").message).toMatch(/expected a register/);
  });
  it("reports undefined symbols", () => {
    expect(firstError("JMP nowhere").message).toBe(
      'undefined symbol "nowhere"',
    );
  });
  it("reports duplicate labels", () => {
    expect(firstError("a: NOP\na: NOP").message).toMatch(/already defined/);
  });
  it("reports out-of-range values", () => {
    expect(firstError("LDI A, 300").message).toMatch(/out of range/);
  });
  it("reports overlapping code", () => {
    expect(firstError("NOP\n.org 0\nHLT").message).toMatch(/overlaps/);
  });
  it("reports unknown includes", () => {
    expect(firstError('.include "nope.asm"').message).toBe(
      'unknown include "nope.asm"',
    );
  });
  it("collects every error, not just the first", () => {
    expect(asm("FOO\nBAR\nJMP x").errors).toHaveLength(3);
  });
});
