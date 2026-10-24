import { describe, expect, it } from "vitest";
import { assemble, disassemble, IsaModel, microcode, OPCODES, PROBE_KEYS, PROGRAMS, REGISTERS } from "../src/isa/index";

/** Assembles, failing the test on any error. */
function asm(src: string): number[] {
  const r = assemble(src);
  expect(r.errors).toEqual([]);
  return r.bytes;
}

const boot = (src: string) => new IsaModel(asm(src));

function pick<K extends string>(m: IsaModel, keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, m.probe(k as never)])) as Record<K, number>;
}

/** One sample line per opcode with its hand-encoded bytes ([7:4] op · [3:2] Rd · [1:0] Rs, operand). */
const SAMPLES: Record<string, [string, number[]]> = {
  NOP: ["NOP", [0x00]],
  LDI: ["LDI R2, 0x5A", [0x18, 0x5a]],
  LD: ["LD R3, [7]", [0x2c, 0x07]],
  ST: ["ST R2, [15]", [0x32, 0x0f]],
  MOV: ["MOV R1, R2", [0x46]],
  ADD: ["ADD R0, R1", [0x51]],
  SUB: ["SUB R3, R2", [0x6e]],
  AND: ["AND R1, R3", [0x77]],
  OR: ["OR R2, R0", [0x88]],
  XOR: ["XOR R3, R3", [0x9f]],
  LDR: ["LDR R3, [R1]", [0xad]],
  JMP: ["JMP 9", [0xb0, 0x09]],
  JZ: ["JZ 1", [0xc0, 0x01]],
  JC: ["JC 14", [0xd0, 0x0e]],
  STR: ["STR R2, [R1]", [0xe6]],
  HLT: ["HLT", [0xf0]],
};

describe("assembler: encoding", () => {
  it("has a hand-checked sample for every opcode", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(OPCODES.map((o) => o.mnem).sort());
    for (const [src, bytes] of Object.values(SAMPLES)) {
      const out = asm(src);
      expect(out.slice(0, bytes.length), src).toEqual(bytes);
      expect(out.slice(bytes.length).every((b) => b === 0), src).toBe(true);
    }
  });

  it("encodes every opcode × register from the operand list, and disassembles back", () => {
    for (const op of OPCODES)
      for (let d = 0; d < 4; d++)
        for (let s = 0; s < 4; s++) {
          const args = op.operands.map(
            (k) => ({ Rd: REGISTERS[d], Rs: REGISTERS[s], "[Rd]": `[${REGISTERS[d]}]`, "[Rs]": `[${REGISTERS[s]}]`, imm: "200", addr: "[6]" })[k],
          );
          const text = `${op.mnem} ${args.join(", ")}`.trim();
          const hasRd = op.operands.includes("Rd") || op.operands.includes("[Rd]");
          const hasRs = op.operands.includes("Rs") || op.operands.includes("[Rs]");
          const first = (op.code << 4) | (hasRd ? d << 2 : 0) | (hasRs ? s : 0);
          const second = op.operands.includes("imm") ? [200] : op.operands.includes("addr") ? [6] : [];
          const bytes = asm(text);
          expect(bytes.slice(0, 1 + second.length), text).toEqual([first, ...second]);
          const dis = disassemble(bytes);
          expect(dis.size).toBe(1 + second.length);
          expect(asm(dis.text), dis.text).toEqual(bytes);
        }
  });

  it("disassembles jumps bare, memory operands in brackets", () => {
    expect(disassemble([0xb0, 9]).text).toBe("JMP 9");
    expect(disassemble([0x2c, 7]).text).toBe("LD R3, [7]");
    expect(disassemble([0x32, 15]).text).toBe("ST R2, [OUT]");
    expect(disassemble([0x18, 0x5a]).text).toBe("LDI R2, 90");
    expect(disassemble([0xff, 0, 0, 0xad], 3)).toEqual({ text: "LDR R3, [R1]", size: 1 });
    expect(disassemble([0xe6]).text).toBe("STR R2, [R1]");
  });

  it("pointer operands need brackets around a register", () => {
    for (const bad of ["LDR R0, R1", "LDR R0, [5]", "STR R0, [x]", "STR [R1], R0"]) {
      const r = assemble(bad);
      expect(r.errors.length, bad).toBe(1);
      expect(r.errors[0].msg, bad).toMatch(/register/);
    }
    expect(asm("ldr r0, [ r2 ]").slice(0, 1)).toEqual([0xa2]);
  });

  it("zero-fills the 16-byte image", () => {
    const r = assemble("HLT");
    expect(r.ok).toBe(true);
    expect(r.bytes).toEqual([0xf0, ...new Array(15).fill(0)]);
  });

  it("is case-insensitive for mnemonics and registers, accepts [addr] or addr", () => {
    expect(asm("ldi r2, 5\nAdd R2, r3\nhlt").slice(0, 4)).toEqual([0x18, 5, 0x5b, 0xf0]);
    expect(asm("JMP [3]")).toEqual(asm("JMP 3"));
    expect(asm("ST R1, OUT")).toEqual(asm("ST R1, [15]"));
    expect(asm("ST R1, [OUT]")).toEqual(asm("st r1, [15]"));
  });

  it("resolves labels (forward and back), records lineAddr and symbols", () => {
    const r = assemble(["start:  LDI R0, 1", "", "loop:   ADD R0, R0  ; double", "        JMP loop", "        JZ end", "end:"].join("\n"));
    expect(r.errors).toEqual([]);
    expect(r.bytes.slice(0, 7)).toEqual([0x10, 1, 0x50, 0xb0, 2, 0xc0, 7]);
    expect(r.lineAddr).toEqual({ 1: 0, 3: 2, 4: 3, 5: 5 });
    expect(r.symbols).toEqual({ OUT: 15, start: 0, loop: 2, end: 7 });
  });

  it("numbers, characters, expressions, .db and .org", () => {
    const r = assemble(
      [
        ".db 10, 0x1f, 0b101, 'A', '\\n', ';', ','  ; a comment",
        ".db -1, -128, 255, last - 1, OUT - 1 + 2, -(3 - 1)",
        "x: .org 14",
        "last: .db 7, 8",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    expect(r.bytes).toEqual([10, 0x1f, 5, 65, 10, 59, 44, 0xff, 0x80, 255, 13, 16, 0xfe, 0, 7, 8]);
    expect(r.symbols).toMatchObject({ x: 14, last: 14 });
    expect(r.lineAddr).toEqual({ 1: 0, 2: 7, 4: 14 });
  });

  it("negative immediates are two's complement", () => {
    expect(asm("LDI R0, -1").slice(0, 2)).toEqual([0x10, 0xff]);
    expect(asm("LDI R0, -128").slice(0, 2)).toEqual([0x10, 0x80]);
  });

  it("instruction sizes follow the operand lists", () => {
    for (const op of OPCODES) {
      const size = disassemble([op.code << 4]).size;
      expect(size, op.mnem).toBe(op.operands.some((k) => k === "imm" || k === "addr") ? 2 : 1);
    }
  });
});

describe("assembler: errors", () => {
  const bad: [string, number, RegExp][] = [
    ["NOP\nFOO R1", 2, /unknown instruction "FOO"/],
    ["ADD R0", 1, /ADD Rd, Rs: expects 2 operands, got 1/],
    ["HLT R0", 1, /HLT: expects 0 operands, got 1/],
    ["LDI R4, 1", 1, /expected a register \(R0 R1 R2 R3\), got "R4"/],
    ["MOV R0, 5", 1, /expected a register/],
    ["LDI R0, 256", 1, /256 does not fit in a byte/],
    ["LDI R0, -129", 1, /-129 does not fit in a byte/],
    ["ST R0, [16]", 1, /address 16 is outside RAM \(0\.\.15\)/],
    ["JMP -1", 1, /address -1 is outside RAM/],
    ["\n\nJMP nowhere", 3, /unknown symbol "nowhere"/],
    ["LDI R0, out", 1, /unknown symbol "out" \(did you mean "OUT"\?\)/],
    ["LDI R0, [5]", 1, /\[5\] is a memory operand, LDI takes a value/],
    ["LD R0, R1", 1, /expected an address, got register R1/],
    ["LDI R0, 1 +", 1, /incomplete expression/],
    ["LDI R0, (1", 1, /missing "\)"/],
    ["LDI R0, 1 2", 1, /unexpected "2"/],
    ["LDI R0, #1", 1, /unexpected "#"/],
    [".dw 5", 1, /unknown directive ".dw"/],
    [".db", 1, /.db expects at least one value/],
    ["x: NOP\nx: NOP", 2, /label "x" is already defined on line 1/],
    ["R2: NOP", 1, /"R2" is a register name/],
    ["OUT: NOP", 1, /"OUT" is predefined/],
    ["@@@", 1, /cannot parse "@@@"/],
    [".org 16", 1, /.org 16 is outside RAM/],
    [".org later\nlater: NOP", 1, /unknown symbol "later"/],
    ["NOP\n.org 0\nHLT", 3, /address 0 is already used by line 1/],
    [".org 15\nLDI R0, 1", 2, /program needs 17 bytes but RAM has 16/],
    [new Array(9).fill("LDI R0, 1").join("\n"), 9, /program needs 18 bytes but RAM has 16/],
  ];
  for (const [src, line, msg] of bad)
    it(`${JSON.stringify(src).slice(0, 40)} → line ${line}: ${msg.source}`, () => {
      const r = assemble(src);
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].line).toBe(line);
      expect(r.errors[0].msg).toMatch(msg);
    });

  it("reports every bad line, in order, and still emits the good ones", () => {
    const r = assemble(["LDI R0, 5", "FOO", "ADD R0", "ST R0, [99]", "HLT"].join("\n"));
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(r.bytes.slice(0, 2)).toEqual([0x10, 5]);
    expect(r.lineAddr[5]).toBe(4); // the bad ST still reserved its 2 bytes
    expect(r.bytes[4]).toBe(0xf0);
  });

  it("exactly 16 bytes fits", () => {
    expect(assemble(new Array(8).fill("LDI R0, 1").join("\n")).ok).toBe(true);
  });

  it("warns when code sits at the OUT address and the program stores to [OUT]", () => {
    const r = assemble("LDI R0, 1\nST R0, [OUT]\n.org 15\nHLT");
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([{ line: 4, msg: expect.stringMatching(/OUT port/) }]);
    expect(assemble(".org 15\nHLT").warnings).toEqual([]); // nothing writes OUT
  });
});

describe("model: T-state behaviour", () => {
  it("fetch / operand / write-back, tick by tick (LDI R1, 0x2A at address 1)", () => {
    const m = boot("NOP\nLDI R1, 0x2A"); // 00 14 2A
    m.step();
    expect(m.nextBus()).toBe(1); // T0 drives PC
    const rows = [];
    for (let i = 0; i < 6; i++) {
      m.tick();
      rows.push(pick(m, ["T", "BUS", "MAR", "MDR", "IR", "PC", "R1"] as const));
    }
    expect(rows).toEqual([
      { T: 1, BUS: 0x01, MAR: 1, MDR: 0x00, IR: 0x00, PC: 1, R1: 0x00 }, // T0 PC_OUT MAR_LOAD
      { T: 2, BUS: 0x00, MAR: 1, MDR: 0x14, IR: 0x00, PC: 2, R1: 0x00 }, // T1 MEM_READ PC_INC
      { T: 3, BUS: 0x14, MAR: 1, MDR: 0x14, IR: 0x14, PC: 2, R1: 0x00 }, // T2 MDR_OUT IR_LOAD
      { T: 4, BUS: 0x02, MAR: 2, MDR: 0x14, IR: 0x14, PC: 2, R1: 0x00 }, // T3 PC_OUT MAR_LOAD
      { T: 5, BUS: 0x00, MAR: 2, MDR: 0x2a, IR: 0x14, PC: 3, R1: 0x00 }, // T4 MEM_READ PC_INC
      { T: 0, BUS: 0x2a, MAR: 2, MDR: 0x2a, IR: 0x14, PC: 3, R1: 0x2a }, // T5 MDR_OUT REG_LOAD_D T_RESET
    ]);
    expect([...m.lastSignals].sort()).toEqual(["MDR_OUT", "REG_LOAD_D", "T_RESET"]);
    expect(m.instructions).toBe(2);
  });

  it("ALU ops go through the A and Y latches (ADD R0, R1)", () => {
    const m = boot("LDI R0, 5\nLDI R1, 7\nADD R0, R1");
    m.step();
    m.step();
    for (let i = 0; i < 3; i++) m.tick(); // fetch
    m.tick();
    expect(pick(m, ["BUS", "A", "Y", "R0"] as const)).toEqual({ BUS: 5, A: 5, Y: 0, R0: 5 }); // T3 REG_OUT_D A_LOAD
    m.tick();
    expect(pick(m, ["BUS", "A", "Y", "R0"] as const)).toEqual({ BUS: 7, A: 5, Y: 12, R0: 5 }); // T4 REG_OUT_S Y_LOAD
    m.tick();
    expect(pick(m, ["BUS", "A", "Y", "R0", "T"] as const)).toEqual({ BUS: 12, A: 5, Y: 12, R0: 12, T: 0 }); // T5 Y_OUT
  });

  for (const op of OPCODES)
    it(`${op.mnem} takes ${microcode(op).length} T-states`, () => {
      for (const flag of [0, 1]) {
        const m = boot(SAMPLES[op.mnem][0]);
        m.state.Z = m.state.C = m.state.N = flag;
        expect(m.step(), `flags = ${flag}`).toBe(microcode(op).length);
        expect(m.ticks).toBe(microcode(op).length);
        expect(m.instructions).toBe(1);
        expect(m.state.HALTED).toBe(op.mnem === "HLT" ? 1 : 0);
      }
    });

  it("every probe key reads", () => {
    const m = boot("LDI R3, 0x81\nLDI R2, 0xFF\nXOR R3, R2");
    m.step();
    m.step();
    m.step();
    expect(Object.keys(m.probes())).toEqual([...PROBE_KEYS]);
    expect(m.probes()).toMatchObject({ R3: 0x7e, A: 0x81, Y: 0x7e, Z: 0, C: 0, N: 0, PC: 5, T: 0, IR: 0x9e });
  });
});

describe("model: instructions", () => {
  // op, a, b → result, Z, C, N. Flags are preset to the opposite so every one is shown to be written.
  const cases: [string, number, number, number, number, number, number][] = [
    ["ADD", 2, 3, 5, 0, 0, 0],
    ["ADD", 200, 100, 44, 0, 1, 0],
    ["ADD", 0x80, 0x80, 0, 1, 1, 0],
    ["ADD", 0x7f, 1, 0x80, 0, 0, 1],
    ["SUB", 5, 3, 2, 0, 1, 0], // no borrow → C = 1
    ["SUB", 3, 5, 0xfe, 0, 0, 1], // borrow → C = 0
    ["SUB", 7, 7, 0, 1, 1, 0],
    ["SUB", 0, 1, 0xff, 0, 0, 1],
    ["SUB", 0x80, 0, 0x80, 0, 1, 1],
    ["AND", 0xf0, 0x3c, 0x30, 0, 0, 0],
    ["AND", 0x0f, 0xf0, 0, 1, 0, 0],
    ["OR", 0x80, 0x01, 0x81, 0, 0, 1],
    ["OR", 0, 0, 0, 1, 0, 0],
    ["XOR", 0x5a, 0x5a, 0, 1, 0, 0],
    ["XOR", 0xff, 0x0f, 0xf0, 0, 0, 1],
  ];
  for (const [op, a, b, y, Z, C, N] of cases)
    it(`${op} ${a}, ${b} = ${y} (Z${Z} C${C} N${N})`, () => {
      const m = boot(`LDI R0, ${a}\nLDI R1, ${b}\n${op} R0, R1`);
      m.step();
      m.step();
      Object.assign(m.state, { Z: 1 - Z, C: 1 - C, N: 1 - N });
      m.step();
      expect(pick(m, ["R0", "R1", "Z", "C", "N"] as const)).toEqual({ R0: y, R1: b, Z, C, N });
    });

  it("LDR and STR go through a pointer register and leave the flags alone", () => {
    const m = boot(["LDI R1, data", "LDI R2, 0x5A", "STR R2, [R1]", "LDR R3, [R1]", "LDI R0, OUT", "STR R3, [R0]", "HLT", "data: .db 0"].join("\n"));
    Object.assign(m.state, { Z: 1, C: 0, N: 1 });
    m.runUntilHalt();
    expect(m.state.RAM[10]).toBe(0x5a); // data: the byte after HLT
    expect(pick(m, ["R3", "OUT", "Z", "C", "N"] as const)).toEqual({ R3: 0x5a, OUT: 0x5a, Z: 1, C: 0, N: 1 });
    expect(m.outputs).toEqual([0x5a]); // STR to 15 latches OUT like ST
  });

  it("LDR and STR use the low 4 bits of the pointer as the address", () => {
    const m = boot(["LDI R1, 0x1D", "LDR R0, [R1]", "LDI R2, 0x77", "LDI R1, 0xFE", "STR R2, [R1]", "HLT", ".org 13", ".db 0x42"].join("\n"));
    m.runUntilHalt();
    expect(m.state.R[0]).toBe(0x42); // 0x1D → address 13
    expect(m.state.RAM[14]).toBe(0x77); // 0xFE → address 14
  });

  it("ADD/SUB/... with Rd = Rs", () => {
    const m = boot("LDI R3, 0x81\nADD R3, R3\nSUB R3, R3");
    m.step();
    m.step();
    expect(pick(m, ["R3", "C"] as const)).toEqual({ R3: 0x02, C: 1 });
    m.step();
    expect(pick(m, ["R3", "Z", "C"] as const)).toEqual({ R3: 0, Z: 1, C: 1 });
  });

  it("LDI and MOV leave the flags alone", () => {
    const m = boot("LDI R0, 0\nMOV R1, R0\nLDI R2, 0x80");
    Object.assign(m.state, { Z: 0, C: 1, N: 0 });
    m.step();
    m.step();
    m.step();
    expect(pick(m, ["R0", "R1", "R2", "Z", "C", "N"] as const)).toEqual({ R0: 0, R1: 0, R2: 0x80, Z: 0, C: 1, N: 0 });
  });

  it("MOV Rd, Rs copies", () => {
    const m = boot("LDI R3, 77\nMOV R0, R3");
    m.step();
    m.step();
    expect(pick(m, ["R0", "R3"] as const)).toEqual({ R0: 77, R3: 77 });
  });

  it("LD and ST", () => {
    const m = boot(["LDI R1, 0x77", "ST R1, [data]", "LD R2, [data]", "LD R3, [peek]", "HLT", "data: .db 0", "peek: .db 0x5C"].join("\n"));
    m.runUntilHalt();
    expect(m.state.RAM[9]).toBe(0x77);
    expect(pick(m, ["R2", "R3", "OUT", "MAR"] as const)).toEqual({ R2: 0x77, R3: 0x5c, OUT: 0, MAR: 8 }); // MAR: HLT's fetch
    expect(m.outputs).toEqual([]);
  });

  it("ST to address 15 also latches OUT; other addresses do not", () => {
    const m = boot("LDI R3, 9\nST R3, [OUT]\nLDI R3, 4\nST R3, [14]\nLD R0, [OUT]\nHLT");
    m.step();
    m.step();
    expect(pick(m, ["OUT"] as const)).toEqual({ OUT: 9 });
    expect(m.state.RAM[15]).toBe(9);
    m.runUntilHalt();
    expect(pick(m, ["OUT", "R0"] as const)).toEqual({ OUT: 9, R0: 9 });
    expect(m.state.RAM[14]).toBe(4);
    expect(m.outputs).toEqual([9]);
  });

  it("JMP always jumps", () => {
    for (const f of [0, 1]) {
      const m = boot("JMP 9");
      Object.assign(m.state, { Z: f, C: f, N: f });
      m.step();
      expect(m.state.PC).toBe(9);
    }
  });

  for (const [mnem, flag] of [["JZ", "Z"], ["JC", "C"]] as const)
    it(`${mnem} jumps iff ${flag} = 1 (other flags ignored)`, () => {
      for (const v of [0, 1]) {
        const m = boot(`NOP\n${mnem} 9`);
        m.step();
        Object.assign(m.state, { Z: 1 - v, C: 1 - v, N: 1 - v, [flag]: v });
        m.step();
        expect(m.state.PC, `${flag} = ${v}`).toBe(v ? 9 : 3);
      }
    });

  it("PC wraps from 15 to 0", () => {
    const m = boot("JMP 15\n.org 15\nNOP");
    m.step();
    m.step();
    expect(m.state.PC).toBe(0);
  });

  it("HLT stops the clock: nothing changes afterwards", () => {
    const m = boot("LDI R0, 3\nHLT\nLDI R0, 9");
    expect(m.runUntilHalt()).toBe(6 + 4);
    const frozen = JSON.stringify(m.state);
    for (let i = 0; i < 40; i++) m.tick();
    expect(JSON.stringify(m.state)).toBe(frozen);
    expect(m.probes()).toMatchObject({ T: 0, PC: 3, R0: 3, BUS: 0, HALTED: 1 });
    expect(m.nextSignals().size).toBe(0);
    expect(m.step()).toBe(0);
    expect(m.runUntilHalt()).toBe(0);
    expect(m.instructions).toBe(2);
  });

  it("reset() restarts at address 0 and keeps the other state", () => {
    const m = boot("LDI R1, 1\nADD R0, R1\nHLT");
    m.runUntilHalt();
    expect(m.state.R[0]).toBe(1);
    m.reset();
    expect(pick(m, ["PC", "T", "HALTED", "R0", "R1"] as const)).toEqual({ PC: 0, T: 0, HALTED: 0, R0: 1, R1: 1 });
    m.runUntilHalt();
    expect(m.state.R[0]).toBe(2);
  });

  it("reset() mid-instruction", () => {
    const m = boot("LDI R0, 5\nHLT");
    m.tick();
    m.tick();
    m.reset();
    expect(m.step()).toBe(6);
    expect(m.state.R[0]).toBe(5);
  });
});

describe("model: microcode implements the ISA", () => {
  interface Arch {
    pc: number;
    r: number[];
    z: number;
    c: number;
    n: number;
    halted: number;
    out: number;
    ram: number[];
  }

  /** Instruction-level semantics written from the opcode docs, independent of the microcode. */
  function refStep(s: Arch): void {
    if (s.halted) return;
    const fetch = () => {
      const b = s.ram[s.pc];
      s.pc = (s.pc + 1) & 15;
      return b;
    };
    const ir = fetch();
    const rd = (ir >> 2) & 3;
    const rs = ir & 3;
    const logic = (y: number) => {
      s.r[rd] = y & 0xff;
      s.z = s.r[rd] === 0 ? 1 : 0;
      s.n = s.r[rd] >> 7;
      s.c = 0;
    };
    const jump = (taken: boolean) => {
      const a = fetch() & 15;
      if (taken) s.pc = a;
    };
    switch (OPCODES[ir >> 4].mnem) {
      case "NOP":
        break;
      case "LDI":
        s.r[rd] = fetch();
        break;
      case "LD":
        s.r[rd] = s.ram[fetch() & 15];
        break;
      case "ST": {
        const a = fetch() & 15;
        s.ram[a] = s.r[rs];
        if (a === 15) s.out = s.r[rs];
        break;
      }
      case "MOV":
        s.r[rd] = s.r[rs];
        break;
      case "ADD": {
        const sum = s.r[rd] + s.r[rs];
        logic(sum);
        s.c = sum > 255 ? 1 : 0;
        break;
      }
      case "SUB": {
        const noBorrow = s.r[rd] >= s.r[rs] ? 1 : 0;
        logic(s.r[rd] - s.r[rs]);
        s.c = noBorrow;
        break;
      }
      case "AND":
        logic(s.r[rd] & s.r[rs]);
        break;
      case "OR":
        logic(s.r[rd] | s.r[rs]);
        break;
      case "XOR":
        logic(s.r[rd] ^ s.r[rs]);
        break;
      case "LDR":
        s.r[rd] = s.ram[s.r[rs] & 15];
        break;
      case "STR": {
        const a = s.r[rd] & 15;
        s.ram[a] = s.r[rs];
        if (a === 15) s.out = s.r[rs];
        break;
      }
      case "JMP":
        jump(true);
        break;
      case "JZ":
        jump(s.z === 1);
        break;
      case "JC":
        jump(s.c === 1);
        break;
      case "HLT":
        s.halted = 1;
        break;
    }
  }

  it("matches an instruction-level interpreter on random programs", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    for (let prog = 0; prog < 300; prog++) {
      // Mostly non-HLT opcodes so runs are long; any byte doubles as data / operand.
      const ram = Array.from({ length: 16 }, () => ((rnd(50) ? rnd(15) : 15) << 4) | rnd(16));
      const m = new IsaModel(ram);
      const ref: Arch = { pc: 0, r: [0, 0, 0, 0], z: 0, c: 0, n: 0, halted: 0, out: 0, ram: [...ram] };
      for (let i = 0; i < 200 && !ref.halted; i++) {
        const before = m.ticks;
        m.step();
        refStep(ref);
        const s = m.state;
        const got: Arch = { pc: s.PC, r: s.R, z: s.Z, c: s.C, n: s.N, halted: s.HALTED, out: s.OUT, ram: s.RAM };
        expect(got, `program ${ram.map((b) => b.toString(16)).join(" ")}, instruction ${i}`).toEqual(ref);
        expect(m.ticks - before).toBe(microcode(OPCODES[s.IR >> 4]).length);
      }
    }
  });
});

describe("programs", () => {
  function load(name: string): { m: IsaModel; symbols: Record<string, number> } {
    const r = assemble(PROGRAMS[name]);
    expect(r.errors, name).toEqual([]);
    expect(r.warnings, name).toEqual([]);
    return { m: new IsaModel(r.bytes), symbols: r.symbols };
  }

  it("all assemble cleanly into 16 bytes", () => {
    expect(Object.keys(PROGRAMS).sort()).toEqual(["blink", "copy", "count", "dump", "echo", "fib", "keypad", "lfsr", "logic", "mem", "mod", "mul", "pow2", "ptrout", "sub", "triangle"]);
    for (const name of Object.keys(PROGRAMS)) load(name);
  });

  it("count: OUT shows 1, 2, 3, … and wraps after 255", () => {
    const { m } = load("count");
    while (m.outputs.length < 300 && m.ticks < 10_000) m.tick();
    expect(m.outputs.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(m.outputs).toEqual(m.outputs.map((_, i) => (i + 1) & 0xff));
    expect(m.ticks).toBe(26 + 299 * 20); // LDI LDI ADD ST, then 20 T-states per pass
    expect(m.state.HALTED).toBe(0);
  });

  it("mul: 6 × 7 = 42 on OUT, then halt", () => {
    const { m } = load("mul");
    expect(m.runUntilHalt()).toBe(162);
    expect(m.state.HALTED).toBe(1);
    expect(m.state.OUT).toBe(42);
    expect(m.outputs).toEqual([42]);
    expect(m.instructions).toBe(27);
  });

  it("fib: 1 1 2 3 5 … 233 on OUT, halt on carry", () => {
    const { m } = load("fib");
    m.runUntilHalt();
    expect(m.state.HALTED).toBe(1);
    expect(m.outputs).toEqual([1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]);
    expect(pick(m, ["OUT", "C", "R1"] as const)).toEqual({ OUT: 233, C: 1, R1: (144 + 233) & 0xff });
  });

  it("sub: 5 4 3 2 1 0, halt when negative", () => {
    const { m } = load("sub");
    m.runUntilHalt();
    expect(m.outputs).toEqual([5, 4, 3, 2, 1, 0]);
    expect(pick(m, ["R0", "Z", "C", "N", "HALTED"] as const)).toEqual({ R0: 0xff, Z: 0, C: 0, N: 1, HALTED: 1 });
  });

  it("logic: XOR, AND, OR", () => {
    const { m } = load("logic");
    m.runUntilHalt();
    expect(m.outputs).toEqual([0x33, 0x30, 0x3c]);
    expect(pick(m, ["Z", "C", "N", "HALTED"] as const)).toEqual({ Z: 0, C: 0, N: 0, HALTED: 1 });
  });

  it("ptrout: STR through a pointer to OUT shows 7 … 0", () => {
    const { m } = load("ptrout");
    m.runUntilHalt();
    expect(m.outputs).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(m.state.HALTED).toBe(1);
  });

  it("copy: LDR / STR copy a byte between two pointers", () => {
    const { m, symbols } = load("copy");
    m.runUntilHalt();
    expect(m.outputs).toEqual([0x5a]);
    expect(m.state.RAM[symbols.dst]).toBe(0x5a);
  });

  it("dump: LDR walks memory and shows the program's own bytes", () => {
    const r = assemble(PROGRAMS.dump);
    const m = new IsaModel(r.bytes);
    while (m.outputs.length < 15 && m.ticks < 10_000) m.tick();
    expect(m.outputs).toEqual(r.bytes.slice(0, 15));
    expect(m.state.HALTED).toBe(0);
  });

  it("mem: z = x + y through LD / ST", () => {
    const { m, symbols } = load("mem");
    m.runUntilHalt();
    expect(m.outputs).toEqual([0x42]);
    expect(m.state.RAM[symbols.z]).toBe(0x42);
    expect(m.state.R[2]).toBe(0x42);
  });
});
