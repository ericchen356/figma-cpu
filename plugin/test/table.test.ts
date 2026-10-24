import { describe, it, expect } from "vitest";
import fixture from "./fixtures/decoder-table.json";
import { readTable, type TreeNode } from "../src/engine/table";
import { parseMicro } from "../src/engine/microops";
import { OPCODES } from "../src/contracts/spec";

const clone = () => JSON.parse(JSON.stringify(fixture)) as TreeNode;
const row = (t: TreeNode, op: string) => t.children!.find((c) => c.name === `row/${op}`)!;
const setText = (r: TreeNode, field: string, v: string) => (r.children!.find((c) => c.name === field)!.characters = v);

describe("readTable on the REAL canvas fixture", () => {
  it("reads all 29 rows with no problems", () => {
    const t = readTable(clone());
    expect(t.problems).toEqual([]);
    expect(t.rows.length).toBe(29);
  });
  it("matches spec/opcodes.json today (and that is only a comparison, not the source)", () => {
    const t = readTable(clone());
    for (const s of OPCODES) {
      const r = t.byOp.get(parseInt(s.op, 16))!;
      expect(r.mnem).toBe(s.mnem);
      expect(r.fmt).toBe(s.fmt);
      expect(parseMicro(r.micro).ops).toEqual(r.ops);
    }
  });
  it("parses LDI into the vocabulary", () => {
    expect(readTable(clone()).byOp.get(0x10)!.ops).toEqual([{ k: "REG" }, { k: "IMM8" }, { k: "SET", r: "rd" }]);
  });
});

describe("live drift (canvas edited after the plugin was written)", () => {
  it("swapping two rows' micro text changes behavior data with no code change", () => {
    const t = clone();
    const add = row(t, "20"), sub = row(t, "21");
    const a = add.children!.find((c) => c.name === "micro")!.characters!;
    setText(add, "micro", sub.children!.find((c) => c.name === "micro")!.characters!);
    setText(sub, "micro", a);
    const r = readTable(t);
    expect(r.byOp.get(0x20)!.ops).toEqual([{ k: "REG" }, { k: "ALU", op: "SUB", a: "rd", b: "rs" }]);
  });
  it("tolerates case, extra spaces, newlines and an em dash", () => {
    const t = clone();
    setText(row(t, "20"), "micro", "reg;\n  alu   add rd   rs ");
    setText(row(t, "00"), "micro", "—");
    const r = readTable(t);
    expect(r.problems).toEqual([]);
    expect(r.byOp.get(0x20)!.ops).toEqual([{ k: "REG" }, { k: "ALU", op: "ADD", a: "rd", b: "rs" }]);
    expect(r.byOp.get(0x00)!.ops).toEqual([]);
  });
  it("reports a bad micro-op loudly and drops only that row", () => {
    const t = clone();
    setText(row(t, "20"), "micro", "REG; FLIP rd");
    const r = readTable(t);
    expect(r.problems.some((p) => p.includes("ADD") && p.includes('unknown micro-op "FLIP"'))).toBe(true);
    expect(r.byOp.has(0x20)).toBe(false);
    expect(r.rows.length).toBe(28);
  });
  it("flags duplicate opcodes, non-hex ops and a missing table", () => {
    const t = clone();
    setText(row(t, "21"), "op", "20");
    expect(readTable(t).problems.join("|")).toContain("duplicate opcode 20");
    const t2 = clone();
    setText(row(t2, "21"), "op", "ZZ");
    expect(readTable(t2).problems.join("|")).toContain("not a hex byte");
    expect(readTable({ name: "x" }).problems[0]).toContain("not found");
  });
});

describe("parseMicro", () => {
  it.each([
    ["JUMP W NZ", [{ k: "JUMP", cond: "NZ" }]],
    ["IMM16; PUSHPC; JUMP W", [{ k: "IMM16" }, { k: "PUSHPC" }, { k: "JUMP" }]],
    ["REG; ALU INC rd", [{ k: "REG" }, { k: "ALU", op: "INC", a: "rd" }]],
    ["LOAD rd HL", [{ k: "LOAD", r: "rd", from: "HL" }]],
    ["SETHL W", [{ k: "SETHL" }]],
  ])("%s", (s, ops) => expect(parseMicro(s as string).ops).toEqual(ops));
  it.each(["ALU ADD rd", "JUMP W QQ", "SET rd X", "LOAD rd PC", "COPY rd"])("rejects %s", (s) =>
    expect(parseMicro(s).errors.length).toBeGreaterThan(0));
});
