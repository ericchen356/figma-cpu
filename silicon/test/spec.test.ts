import { expect, it } from "vitest";
import { BUS_DRIVERS, microcode, OPCODES, signalsAt } from "../src/isa/spec";

it("microcode table is well formed", () => {
  expect(OPCODES.map((o) => o.code)).toEqual([...Array(16).keys()]);
  for (const op of OPCODES) {
    const steps = microcode(op);
    expect(steps.map((s) => s.t), op.mnem).toEqual(steps.map((_, i) => i));
    expect(steps.length).toBeLessThanOrEqual(8);
    const last = steps[steps.length - 1];
    expect(last.signals.includes("T_RESET"), op.mnem).toBe(true);
    for (const t of steps.map((s) => s.t))
      for (const f of [false, true]) {
        const sig = signalsAt(op.code, t, { Z: f, C: f, N: f });
        expect([...sig].filter((s) => BUS_DRIVERS.includes(s)).length, `${op.mnem} T${t}`).toBeLessThanOrEqual(1);
      }
  }
});
