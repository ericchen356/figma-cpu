// The shape of the synthesized OS, independent of what it computes: it flattens (silicon rejects
// multiple drivers and undriven reads), no gate has a constant input, no two generated gates are
// the same gate on the same inputs, ports are legal names, the statistics add up, and power-on
// puts every register at its initial value.
import { describe, expect, it } from "vitest";
import { GateMachine, synthesize } from "../src/gates";
import type { Program } from "../src/ir";
import { checkShape, randomProgram, rng } from "./gates-support";

describe("gates: structure", () => {
  it("random programs flatten, with no constant gate input and no duplicate gate", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const p = randomProgram(rng(seed));
      checkShape(synthesize(p), `seed ${seed}`);
      checkShape(
        synthesize(p, { constantRegisters: false }),
        `seed ${seed}, no proof`,
      );
    }
  }, 60_000);

  it("power-on holds every register at its initial value, negative and boolean ones included", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const p = randomProgram(rng(seed));
      const syn = synthesize(p);
      for (const reference of [false, true]) {
        const m = new GateMachine(syn, { reference });
        for (const d of p.vars)
          if ((d.role ?? "state") === "state")
            expect(m.read(d.name), `seed ${seed} ${d.name}`).toBe(d.init);
      }
    }
  }, 60_000);

  it("the modules: one per unit, GLUE, EVDEC, registers, and OS with CLK, EVT and the inputs", () => {
    const p: Program = {
      vars: [
        {
          name: "L0/x",
          ty: "num",
          init: -2,
          role: "state",
          bits: 6,
          signed: true,
        },
        { name: "L0/vis", ty: "bool", init: true, role: "state" },
        {
          name: "in/px",
          ty: "num",
          init: 0,
          role: "input",
          bits: 4,
          signed: false,
        },
        {
          name: "t/v",
          ty: "num",
          init: 0,
          role: "temp",
          bits: 7,
          signed: true,
        },
      ],
      events: [
        {
          id: "pointer#down",
          node: "pointer",
          trigger: { type: "down" },
          steps: [
            {
              k: "unit",
              name: "hit",
              steps: [
                {
                  k: "set",
                  name: "t/v",
                  to: {
                    k: "op",
                    fn: "sub",
                    a: { k: "var", name: "in/px" },
                    b: { k: "var", name: "L0/x" },
                  },
                },
              ],
            },
            {
              k: "unit",
              name: "drag",
              steps: [
                {
                  k: "if",
                  cond: {
                    k: "op",
                    fn: "gt",
                    a: { k: "var", name: "t/v" },
                    b: { k: "num", v: 3 },
                  },
                  then: [
                    { k: "set", name: "L0/x", to: { k: "var", name: "in/px" } },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "eye/0#click",
          node: "eye/0",
          trigger: { type: "click" },
          steps: [
            {
              k: "set",
              name: "L0/vis",
              to: { k: "op", fn: "not", a: { k: "var", name: "L0/vis" } },
            },
          ],
        },
      ],
    };
    const syn = synthesize(p);
    const top = syn.lib.get("OS")!;
    expect(top.ports.map((x) => [x.name, x.dir, x.width])).toEqual([
      ["CLK", "in", 1],
      ["EVT", "in", 2],
      ["in_px", "in", 4],
    ]);
    expect(syn.inputs.get("in/px")).toEqual({
      port: "in_px",
      bits: 4,
      signed: false,
    });
    const cells = top.instances.map((i) => i.cell);
    for (const c of ["U_hit", "U_drag", "EVDEC", "REG_W6"])
      expect(cells, c).toContain(c);
    expect(syn.lib.has("REG_W1") && syn.lib.has("REG_W6")).toBe(true);
    expect(syn.regs.get("L0/x")!.nets).toEqual([
      "L0_x[0]",
      "L0_x[1]",
      "L0_x[2]",
      "L0_x[3]",
      "L0_x[4]",
      "L0_x[5]",
    ]);
    expect(syn.pokes["L0_x[1]"]).toBe(1);
    expect(syn.pokes["r_L0_x/b1/m"]).toBe(1);
    expect(syn.pokes["L0_x[0]"]).toBe(0);
    checkShape(syn, "modules");
    const m = new GateMachine(syn);
    m.fire("pointer#down", { "in/px": 9 }); // 9 - (-2) = 11 > 3
    expect(m.read("L0/x")).toBe(9);
    m.fire("pointer#down", { "in/px": 12 }); // 12 - 9 = 3, not > 3
    expect(m.read("L0/x")).toBe(9);
    m.fire("eye/0#click");
    expect(m.read("L0/vis")).toBe(false);
  });
});
