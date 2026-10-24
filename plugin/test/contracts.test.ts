import { describe, it, expect } from "vitest";
import { N, requiredNames, REGS } from "../src/contracts/nodes";
import { OPCODES, MEM, PALETTE } from "../src/contracts/spec";

describe("contracts", () => {
  it("spec has 29 opcodes, 16 colors, 12KB vram", () => {
    expect(OPCODES.length).toBe(29);
    expect(PALETTE.length).toBe(16);
    expect(MEM.vramW * MEM.vramH).toBe(12288);
  });
  it("node names match draw.js conventions", () => {
    expect(N.reg("A")).toBe("cpu/reg/A");
    expect(N.ramCell(0x4f)).toBe("mem/ram/cell/4F");
    expect(N.io("TICK")).toBe("mem/io/TICK");
    expect(REGS.length).toBe(6);
  });
  it("required names are unique", () => {
    const r = requiredNames();
    expect(new Set(r).size).toBe(r.length);
  });
});
