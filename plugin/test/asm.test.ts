import { describe, it, expect } from "vitest";
import countAsm from "../programs/count.asm?raw";
import fibAsm from "../programs/fib.asm?raw";
import { assemble } from "../src/assembler/asm";
import { OPCODES } from "../src/contracts/spec";
import { run } from "./helpers/oracle";

const op = (m: string) => parseInt(OPCODES.find((o) => o.mnem === m)!.op, 16);
const asm = (s: string) => { const r = assemble(s); expect(r.errors).toEqual([]); return r.bytes; };

describe("encoding by fmt class (opcode bytes come from spec)", () => {
  it("- : NOP / HLT", () => expect(asm("NOP\nHLT")).toEqual([op("NOP"), op("HLT")]));
  it("r : INC B / LD A,[HL] / ST C", () =>
    expect(asm("INC B\nLD A,[HL]\nST C")).toEqual([op("INC"), 1 << 4, op("LD"), 0, op("ST"), 2 << 4]));
  it("r,r : MOV D,A packs rd<<4|rs", () => expect(asm("MOV D,A")).toEqual([op("MOV"), (3 << 4) | 0]));
  it("r,i8 : LDI L, 0x2A  (and dec / bin / char / negative)", () => {
    expect(asm("LDI L, 0x2A")).toEqual([op("LDI"), 5 << 4, 0x2a]);
    expect(asm("LDI A, 7\nLDI A, 0b101\nLDI A, 'A'\nLDI A, -1")).toEqual([
      op("LDI"), 0, 7, op("LDI"), 0, 5, op("LDI"), 0, 65, op("LDI"), 0, 255]);
  });
  it("r,a16 : LDA/STA little-endian, brackets optional", () =>
    expect(asm("LDA B,[0x4005]\nSTA B, 0x8001")).toEqual([op("LDA"), 1 << 4, 0x05, 0x40, op("STA"), 1 << 4, 0x01, 0x80]));
  it("i16 / a16 : LHL, JMP little-endian", () =>
    expect(asm("LHL 0x8000\nJMP 0x1234")).toEqual([op("LHL"), 0x00, 0x80, op("JMP"), 0x34, 0x12]));
  it("case-insensitive mnemonics and registers", () => expect(asm("mov d,a")).toEqual(asm("MOV D,A")));
});

describe("labels, .org, .db, comments", () => {
  it("forward and backward labels", () => {
    const r = assemble("start: JMP end\nloop: NOP\nJMP loop\nend: HLT");
    expect(r.errors).toEqual([]);
    expect(r.labels).toEqual({ start: 0, loop: 3, end: 7 });
    expect(r.bytes).toEqual([op("JMP"), 7, 0, op("NOP"), op("JMP"), 3, 0, op("HLT")]);
  });
  it("label arithmetic and label as i8/a16", () => {
    expect(asm("x: NOP\nJMP x+2")).toEqual([op("NOP"), op("JMP"), 2, 0]);
  });
  it(".org pads with zeros and reports origin", () => {
    const r = assemble(".org 0x10\nNOP\n.org 0x14\nHLT");
    expect(r.errors).toEqual([]);
    expect(r.origin).toBe(0x10);
    expect(r.bytes).toEqual([op("NOP"), 0, 0, 0, op("HLT")]);
  });
  it(".db numbers, strings, chars, labels", () => {
    expect(asm('.db 1, 0x02, "Hi", \'!\'')).toEqual([1, 2, 72, 105, 33]);
    const r = assemble("lbl: .db 5\n.db lbl");
    expect(r.errors).toEqual([]);
    expect(r.bytes).toEqual([5, 0]);
  });
  it("comments, blank lines, label on its own line, ; inside strings", () => {
    expect(asm("; hi\n\nstart:\n  NOP ; trailing\n.db \"a;b\"")).toEqual([op("NOP"), 97, 59, 98]);
  });
});

describe("errors carry line numbers and never throw", () => {
  const e = (s: string) => assemble(s).errors;
  it("unknown mnemonic", () => expect(e("NOP\nFOO A")).toEqual([{ line: 2, message: 'unknown mnemonic "FOO"' }]));
  it("wrong operand count", () => expect(e("MOV A")[0].message).toContain("takes 2 operand"));
  it("bad register", () => expect(e("INC Q")[0].message).toContain("not a register"));
  it("undefined label", () => expect(e("JMP nowhere")[0].message).toContain('undefined label "nowhere"'));
  it("duplicate label", () => expect(e("a: NOP\na: NOP")[0].message).toContain("duplicate label"));
  it("8-bit overflow", () => expect(e("LDI A, 300")[0].message).toContain("8 bits"));
  it("16-bit overflow", () => expect(e("JMP 0x10000")[0].message).toContain("16 bits"));
  it(".org backwards", () => expect(e("NOP\nNOP\n.org 1")[0].message).toContain("backwards"));
  it("unknown directive", () => expect(e(".foo 1")[0].message).toContain("unknown directive"));
  it("garbage does not throw", () => expect(() => assemble("@@@ ??? ,,, [[")).not.toThrow());
  it("reports every bad line, sorted", () => expect(e("FOO\nNOP\nBAR").map((x) => x.line)).toEqual([1, 3]));
});

describe("demo programs (assembled, then run on the test oracle)", () => {
  it("count.asm assembles clean and ends with A = 10", () => {
    const r = assemble(countAsm);
    expect(r.errors).toEqual([]);
    const s = run(r.bytes);
    expect(s.halted).toBe(true);
    expect(s.R[0]).toBe(10);
  });
  it("fib.asm assembles clean and writes the Fibonacci bytes at 0x4000", () => {
    const r = assemble(fibAsm);
    expect(r.errors).toEqual([]);
    const s = run(r.bytes);
    expect(s.halted).toBe(true);
    expect(Array.from(s.mem.slice(0x4000, 0x4000 + 13))).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]);
    expect(s.mem[0x4000 + 13]).toBe(0);
  });
});
