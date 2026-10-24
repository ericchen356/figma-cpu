// The five added demo programs: expected OUT sequences are computed INDEPENDENTLY here (plain JS arithmetic),
// then checked on the ISA model; test/cpu.test.ts additionally runs every PROGRAMS entry on the gate-level CPU
// in lockstep with the model, and the plugin's Verify (verifyAgainstModel) is run on each at the end.
import { describe, it, expect } from "vitest";
import { assemble, IsaModel, PROGRAMS, RAM_BYTES } from "../src/isa";
import { compile } from "../src/compile";
import { cpuNetlist } from "../src/cpu";
import { verifyAgainstModel } from "../plugin/src/program";

const run = (name: string, maxTicks = 60_000, minOutputs = Infinity) => {
  const r = assemble(PROGRAMS[name]);
  expect(r.errors, name).toEqual([]);
  expect(r.warnings, name).toEqual([]);
  const m = new IsaModel(r.bytes);
  while (!m.state.HALTED && m.ticks < maxTicks && m.outputs.length < minOutputs) m.tick();
  return { m, bytes: r.bytes };
};

describe("added programs on the ISA model", () => {
  it("pow2: 01 02 04 … 80 then halts on the carry", () => {
    const { m } = run("pow2");
    expect(m.state.HALTED).toBe(1);
    expect(m.outputs).toEqual(Array.from({ length: 8 }, (_, i) => 1 << i));
  });

  it("triangle: T(n) = n(n+1)/2 up to 253, halts when the next one overflows", () => {
    const want: number[] = [];
    for (let n = 1; (n * (n + 1)) / 2 <= 255; n++) want.push((n * (n + 1)) / 2);
    const { m } = run("triangle");
    expect(m.state.HALTED).toBe(1);
    expect(m.outputs).toEqual(want);
    expect(want.length).toBe(22);
    expect(want[want.length - 1]).toBe(253);
  });

  it("mod: 100 mod 7 = 2", () => {
    const { m } = run("mod");
    expect(m.state.HALTED).toBe(1);
    expect(m.outputs).toEqual([100 % 7]);
  });

  it("blink: AA 55 AA 55 … and never halts", () => {
    const { m } = run("blink", 2000, 40);
    expect(m.state.HALTED).toBe(0);
    expect(m.outputs.slice(0, 40)).toEqual(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0xaa : 0x55)));
  });

  it("lfsr: matches a Galois LFSR with period exactly 255 (every nonzero byte once)", () => {
    const next = (x: number) => ((x << 1) & 0xff) ^ (x & 0x80 ? 0x1d : 0);
    const want: number[] = [];
    for (let x = 1, i = 0; i < 600; i++, x = next(x)) want.push(x);
    const { m } = run("lfsr", 200_000, 600);
    expect(m.state.HALTED).toBe(0);
    expect(m.outputs.slice(0, 600)).toEqual(want);
    expect(new Set(want.slice(0, 255)).size).toBe(255); // all of 1..255, no repeats
    expect(want[255]).toBe(1); // back to the start
    expect(want.slice(0, 10)).toEqual([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1d, 0x3a]);
  });

  it("all fit below the OUT byte, so writing OUT never overwrites code", () => {
    for (const name of ["pow2", "triangle", "mod", "blink", "lfsr"]) {
      const { bytes } = run(name, 10);
      let last = RAM_BYTES - 1;
      while (last > 0 && bytes[last] === 0) last--;
      expect(last, name).toBeLessThan(RAM_BYTES - 1);
    }
  });
});

describe("added programs on the gate-level CPU (plugin Verify: gates vs model, every probe + RAM, every tick)", () => {
  const net = cpuNetlist();
  const schedule = compile(net, { inputs: [] });
  for (const name of ["pow2", "triangle", "mod", "blink", "lfsr"])
    it(`verify ${name}`, () => {
      const { bytes } = run(name, 10);
      const v = verifyAgainstModel(net, schedule, bytes, name === "triangle" ? 1500 : 800);
      expect(v.text).toMatch(/^✓/);
      expect(v.ok).toBe(true);
    });
});
