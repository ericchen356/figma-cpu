import { describe, expect, it } from "vitest";
import {
  alu,
  assemble,
  buildTable,
  Cpu,
  evaluate,
  expand,
  FETCH,
  IO,
  MEMORY,
  parseStep,
  REGISTERS,
  run,
  Rtl,
  SIGNALS,
  stepInstruction,
} from "../src/core";
import { boot, program, PROGRAMS, specRows, specTable } from "./helpers";

const A = REGISTERS.indexOf("A");
const B = REGISTERS.indexOf("B");

describe("opcode table (the canvas data)", () => {
  it("parses every row of spec/opcodes.json", () => {
    const { table, errors } = buildTable(specRows);
    expect(errors).toEqual([]);
    expect(table.rows).toHaveLength(29);
  });

  it("reports bad rows without failing the rest", () => {
    const rows = [...specRows, { op: "50", mnem: "BAD", fmt: "-", micro: "FLY A" }];
    const { table, errors } = buildTable(rows);
    expect(table.rows).toHaveLength(29);
    expect(errors[0].msg).toMatch(/unknown micro-op "FLY"/);
  });

  it("rejects micro-ops that read a different number of bytes than the format encodes", () => {
    const { errors } = buildTable([{ op: "10", mnem: "LDI", fmt: "r,r", micro: "REG; IMM8; SET rd T" }]);
    expect(errors[0].msg).toMatch(/read 2 operand byte/);
  });

  it("rejects duplicate opcodes", () => {
    const { errors } = buildTable([...specRows, { op: "20", mnem: "ADD2", fmt: "r,r", micro: "REG; ALU ADD rd rs" }]);
    expect(errors[0].msg).toMatch(/already used by ADD/);
  });

  it("parses every micro-op form", () => {
    expect(parseStep("ALU ADD rd rs")).toEqual({ k: "ALU", op: "ADD", d: { kind: "rd" }, s: { kind: "rs" } });
    expect(parseStep("JUMP W NZ")).toEqual({ k: "JUMP", cond: "NZ" });
    expect(parseStep("SET A T")).toEqual({ k: "SET", d: { kind: "fixed", index: A } });
    expect(() => parseStep("ALU INC rd rs")).toThrow();
    expect(() => parseStep("LOAD rd SP")).toThrow();
  });
});

describe("ALU flags", () => {
  it("ADD carries out of bit 7", () => expect(alu("ADD", 0xf0, 0x20)).toEqual({ y: 0x10, z: false, c: true, n: false }));
  it("SUB borrows", () => expect(alu("SUB", 1, 2)).toEqual({ y: 0xff, z: false, c: true, n: true }));
  it("CMP equal sets Z", () => expect(alu("CMP", 7, 7).z).toBe(true));
  it("INC wraps with carry", () => expect(alu("INC", 0xff, 0)).toEqual({ y: 0, z: true, c: true, n: false }));
  it("DEC borrows at 0", () => expect(alu("DEC", 0, 0)).toEqual({ y: 0xff, z: false, c: true, n: true }));
  it("SHL / SHR shift out into C", () => {
    expect(alu("SHL", 0x81, 0)).toEqual({ y: 0x02, z: false, c: true, n: false });
    expect(alu("SHR", 0x03, 0)).toEqual({ y: 0x01, z: false, c: true, n: false });
  });
  it("logic ops clear C", () => expect(alu("AND", 0xf0, 0x0f)).toEqual({ y: 0, z: true, c: false, n: false }));
});

describe("assembler", () => {
  const table = specTable();

  it("encodes every format", () => {
    const res = assemble(
      `LDI A, 5\nMOV B, A\nLD C, [HL]\nSTA D, [0x4000]\nLHL 0x8000\nJMP 0x0010\nHLT`,
      table,
    );
    expect(res.errors).toEqual([]);
    expect(res.chunks[0].bytes).toEqual([
      0x10, 0x00, 5, 0x11, 0x10, 0x12, 0x20, 0x15, 0x30, 0x00, 0x40, 0x16, 0x00, 0x80, 0x30, 0x10, 0x00, 0x01,
    ]);
  });

  it("resolves forward labels, .equ, .org, .db and expressions", () => {
    const res = assemble(
      `.equ N, 3*4+1\n.org 0x100\nstart: JMP end\n.db 1, "hi", N\nend: LDI A, lo(start) + hi(VRAM)\n`,
      table,
    );
    expect(res.errors).toEqual([]);
    expect(res.chunks[0]).toEqual({ addr: 0x100, bytes: [0x30, 0x07, 0x01, 1, 104, 105, 13, 0x10, 0x00, 0x80] });
    expect(res.entry).toBe(0x100);
  });

  it("reports errors with line numbers", () => {
    const res = assemble(`LDI A, 5\nFOO B\nLDI Q, 1\nJMP nowhere\nLDI A, 300`, table);
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
  });

  it("evaluates precedence and functions", () => {
    expect(evaluate("1 + 2 * 3", {})).toBe(7);
    expect(evaluate("(1 + 2) * 3", {})).toBe(9);
    expect(evaluate("hi(0x8123) << 1 | 1", {})).toBe(0x103);
    expect(evaluate("'A' + 1", {})).toBe(66);
  });

  it("assembles every shipped program", () => {
    for (const p of PROGRAMS) expect(assemble(program(p), table).errors, p).toEqual([]);
  });
});

describe("programs (instruction level)", () => {
  it("count.asm counts A to 10 and halts", () => {
    const cpu = boot(program("count"));
    run(cpu, specTable(), 1000);
    expect(cpu.halted).toBe(true);
    expect(cpu.fault).toBeNull();
    expect(cpu.r[A]).toBe(10);
  });

  it("fib.asm writes the Fibonacci numbers that fit in a byte", () => {
    const cpu = boot(program("fib"));
    run(cpu, specTable(), 10_000);
    expect(cpu.halted).toBe(true);
    expect(Array.from(cpu.mem.slice(0x4000, 0x400e))).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]);
  });

  it("rect.asm fills exactly the 40×32 rectangle", () => {
    const cpu = boot(program("rect"));
    run(cpu, specTable(), 100_000);
    expect(cpu.halted).toBe(true);
    let lit = 0;
    for (let y = 0; y < MEMORY.height; y++)
      for (let x = 0; x < MEMORY.width; x++) {
        const v = cpu.mem[MEMORY.vramStart + y * 128 + x];
        const inside = x >= 20 && x < 60 && y >= 16 && y < 48;
        expect(v, `pixel ${x},${y}`).toBe(inside ? 8 : 0);
        if (v) lit++;
      }
    expect(lit).toBe(40 * 32);
  });

  it("bounce.asm moves one 8×8 square one pixel per frame and bounces", () => {
    const cpu = boot(program("bounce"));
    const table = specTable();
    const squareAt = () => {
      const pts: [number, number][] = [];
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 128; x++) if (cpu.mem[0x8000 + y * 128 + x] === 12) pts.push([x, y]);
      return pts;
    };
    const positions: [number, number][] = [];
    for (let f = 0; f < 140; f++) {
      run(cpu, table, 5_000); // plenty to finish a frame and spin in the wait loop
      const pts = squareAt();
      expect(pts).toHaveLength(64);
      positions.push(pts[0]);
      cpu.frame();
    }
    expect(cpu.fault).toBeNull();
    expect(positions[0]).toEqual([10, 30]);
    expect(positions[1]).toEqual([11, 31]);
    // x reaches the right edge (120) and comes back; y bounces off the bottom (88).
    expect(Math.max(...positions.map((p) => p[0]))).toBe(120);
    expect(Math.max(...positions.map((p) => p[1]))).toBe(88);
    expect(positions[139][0]).toBeLessThan(120);
  });

  it("paint.asm paints where the mouse is pressed", () => {
    const cpu = boot(program("paint"));
    const table = specTable();
    run(cpu, table, 200);
    cpu.mem[IO.MOUSE_X] = 33;
    cpu.mem[IO.MOUSE_Y] = 77;
    cpu.mem[IO.MOUSE_BTN] = 1;
    run(cpu, table, 200);
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2], [1, 1]]) expect(cpu.mem[0x8000 + (77 + dy) * 128 + 33 + dx]).toBe(7);
    expect(cpu.mem[0x8000 + 77 * 128 + 36]).toBe(0);
    cpu.mem[IO.KEY] = "c".charCodeAt(0);
    cpu.mem[IO.MOUSE_X] = 5;
    run(cpu, table, 200);
    expect(cpu.mem[IO.KEY]).toBe(0);
    expect(cpu.mem[0x8000 + 77 * 128 + 5]).toBe(3);
  });

  it("an illegal opcode faults instead of crashing", () => {
    const cpu = new Cpu();
    cpu.mem[0] = 0xee;
    stepInstruction(cpu, specTable());
    expect(cpu.halted).toBe(true);
    expect(cpu.fault).toMatch(/illegal opcode EE/);
  });
});

describe("live table edits change behavior (the canvas is the logic)", () => {
  it("rewiring ADD to subtract changes the program's result", () => {
    const src = "LDI A, 5\nLDI B, 3\nADD A, B\nHLT";
    const normal = boot(src);
    run(normal, specTable(), 10);
    expect(normal.r[A]).toBe(8);

    const rows = specRows.map((r) => (r.mnem === "ADD" ? { ...r, micro: "REG; ALU SUB rd rs" } : r));
    const table = specTable(rows);
    const edited = boot(src, table);
    run(edited, table, 10);
    expect(edited.r[A]).toBe(2);
  });

  it("swapping two opcode numbers is picked up by the assembler", () => {
    const rows = specRows.map((r) => (r.mnem === "INC" ? { ...r, op: "27" } : r.mnem === "DEC" ? { ...r, op: "26" } : r));
    const table = specTable(rows);
    const cpu = boot("LDI A, 1\nINC A\nHLT", table);
    expect(cpu.mem[3]).toBe(0x27);
    run(cpu, table, 10);
    expect(cpu.r[A]).toBe(2);
  });
});

describe("T-state engine (Watch mode)", () => {
  it("fetch is PC→MAR, MEM→MDR + PC++, MDR→IR", () => {
    expect(FETCH.map((t) => t.sigs.map((s) => s.s))).toEqual([
      ["PC_OUT", "MAR_LOAD"],
      ["MEM_READ", "PC_INC"],
      ["MDR_OUT", "IR_LOAD"],
    ]);
  });

  it("never drives a bus twice in one T-state, for every opcode and register byte", () => {
    const addr = new Set(SIGNALS.filter((s) => s.drives === "addr").map((s) => s.name));
    const data = new Set(SIGNALS.filter((s) => s.drives === "data").map((s) => s.name));
    const table = specTable();
    const cpu = new Cpu();
    for (const row of table.rows)
      for (let opr = 0; opr < 0x66; opr++) {
        if ((opr >> 4) > 5 || (opr & 15) > 5) continue;
        cpu.opr = opr;
        for (const flags of [false, true]) {
          cpu.z = cpu.c = cpu.n = flags;
          for (const m of row.micro)
            for (const t of expand(m, cpu)) {
              expect(t.sigs.filter((s) => addr.has(s.s)).length).toBeLessThanOrEqual(1);
              expect(t.sigs.filter((s) => data.has(s.s)).length).toBeLessThanOrEqual(1);
            }
        }
      }
  });

  it("ADD takes FETCH + REG + 3 ALU T-states and ends with T_RESET", () => {
    const table = specTable();
    const cpu = boot("LDI A, 5\nLDI B, 3\nADD A, B\nHLT", table);
    const rtl = new Rtl(cpu, () => table);
    const results = [];
    let r;
    while ((r = rtl.step())) results.push(r);
    const add = results.filter((x) => x.row?.mnem === "ADD" && x.phase === "EXEC");
    expect(add.map((x) => x.t)).toEqual([3, 4, 5, 6, 7, 8]); // T0–T2 fetch (T2 decodes), T3+ execute
    expect(add[add.length - 1].sigs.map((s) => s.s)).toEqual(["Y_OUT", "REG_LOAD", "T_RESET"]);
    const compute = add.find((x) => x.alu)!;
    expect(compute.alu).toEqual({ op: "ADD", a: 5, b: 3, y: 8 });
    expect(compute.dataBus).toBe(3);
    expect(cpu.r[A]).toBe(8);
    expect(cpu.r[B]).toBe(3);
  });

  it("CALL pushes the return address and RET pops it", () => {
    const table = specTable();
    const cpu = boot("CALL sub\nHLT\nsub: LDI A, 9\nRET", table);
    const rtl = new Rtl(cpu, () => table);
    while (rtl.step());
    expect(cpu.fault).toBeNull();
    expect(cpu.r[A]).toBe(9);
    expect(cpu.sp).toBe(MEMORY.stackTop);
    expect(cpu.mem[MEMORY.stackTop - 1]).toBe(0x00); // high byte of return address 0x0003
    expect(cpu.mem[MEMORY.stackTop - 2]).toBe(0x03);
  });
});

describe("interpreter ≡ T-state engine", () => {
  for (const name of PROGRAMS)
    it(`${name}.asm leaves identical state at every instruction boundary`, () => {
      const table = specTable();
      const fast = boot(program(name), table);
      const slow = boot(program(name), table);
      const rtl = new Rtl(slow, () => table);
      for (let i = 0; i < 4000 && !fast.halted; i++) {
        if (name === "paint" && i === 300) {
          for (const c of [fast, slow]) {
            c.mem[IO.MOUSE_X] = 40;
            c.mem[IO.MOUSE_Y] = 41;
            c.mem[IO.MOUSE_BTN] = 1;
            c.mem[IO.KEY] = 0x39;
          }
        }
        if (i % 97 === 0) {
          fast.frame();
          slow.frame();
        }
        stepInstruction(fast, table);
        do rtl.step();
        while (rtl.midInstruction);
        expect(slow.snapshot(), `${name} after instruction ${i}`).toEqual(fast.snapshot());
      }
      expect(slow.mem).toEqual(fast.mem);
    });
});

describe("mouse input queue", () => {
  it("keeps every stroke and click sample but collapses hover moves", () => {
    const cpu = new Cpu();
    for (let x = 0; x < 50; x++) cpu.pushMouse(x, 5, 0); // hover
    expect(cpu.mouseQueue.length).toBeLessThanOrEqual(2);
    cpu.pushMouse(10, 10, 1);
    cpu.pushMouse(11, 10, 1);
    cpu.pushMouse(11, 10, 0);
    const n = cpu.mouseQueue.length;
    expect(cpu.mouseQueue.slice(n - 3)).toEqual([[10, 10, 1], [11, 10, 1], [11, 10, 0]]);
    while (cpu.mouseQueue.length) cpu.read(IO.MOUSE_BTN);
    expect([cpu.mem[IO.MOUSE_X], cpu.mem[IO.MOUSE_Y], cpu.mem[IO.MOUSE_BTN]]).toEqual([11, 10, 0]);
  });
});
