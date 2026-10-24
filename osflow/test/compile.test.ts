// The compiled Figma actions against the interpreter. The exact objects handed to
// setReactionsAsync are replayed in silicon's strict emulator of Figma's prototype engine
// (it rejects malformed shapes and type mismatches), on the same random sessions as the lockstep
// test. Every variable and every executed-action count must agree after every event.
import { describe, expect, it } from "vitest";
import { compileSteps, statsOf, typesOf, type VarIds } from "../src/compile";
import { buildEditor } from "../src/editor";
import { Machine } from "../src/interp";
import { runFigmaActions, type FigmaValue } from "../../silicon/src/prototype/emulate";
import { drive } from "./support";

function setup(K: number, copy: "expr" | "alias") {
  const ed = buildEditor({ K });
  const types = typesOf(ed.vars);
  const ids: VarIds = new Map(ed.vars.map((v) => [v.name, `id:${v.name}`]));
  const actions = new Map(ed.events.map((e) => [e.id, compileSteps(e.steps, ids, types, { copy })]));
  const machine = new Machine(ed);
  const figma = new Map<string, FigmaValue>(ed.vars.map((v) => [`id:${v.name}`, v.init as FigmaValue]));
  return { ed, ids, actions, machine, figma };
}

describe("compiled Figma actions", () => {
  it("every event compiles and is type-correct", () => {
    const { actions, ed } = setup(40, "expr");
    expect(actions.size).toBe(ed.events.length);
    for (const [id, list] of actions) expect(list.length, id).toBeGreaterThan(0);
  });

  for (const copy of ["expr", "alias"] as const)
    it(`replay in the emulator matches the interpreter on random sessions (copy: ${copy})`, () => {
      let events = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const { ed, actions, machine, figma } = setup(40, copy);
        events += drive(seed, 40, 100, (id) => {
          if (id.startsWith("@origin")) {
            // The window corner is set from outside, like a pan.
            const [, x, y] = id.split(" ").map(Number);
            machine.vars.set("v/x", x);
            machine.vars.set("v/y", y);
            figma.set("id:v/x", x);
            figma.set("id:v/y", y);
            return;
          }
          const executedInterp = machine.fire(id);
          const executedFigma = runFigmaActions(actions.get(id)!, figma);
          expect(executedFigma, `${id}: executed actions`).toBe(executedInterp);
          for (const v of ed.vars) {
            if (figma.get(`id:${v.name}`) !== machine.vars.get(v.name)) expect.fail(`${id}: ${v.name} is ${figma.get(`id:${v.name}`)} in Figma, ${machine.vars.get(v.name)} in the interpreter`);
          }
        });
      }
      expect(events).toBeGreaterThan(2000);
    });

  it("an event never reads or writes a variable that was not declared", () => {
    const ed = buildEditor();
    const names = new Set(ed.vars.map((v) => v.name));
    expect(names.size).toBe(ed.vars.length);
    for (const e of ed.events) expect(() => compileSteps(e.steps, new Map([...names].map((n) => [n, `id:${n}`])), typesOf(ed.vars)), e.id).not.toThrow();
  });
});

describe("how big the flow is", () => {
  const stats = statsOf(buildEditor());

  it("no event can execute more actions than the viewer survives (500 is the proven-safe size)", () => {
    const worst = [...stats.byEvent].sort((a, b) => b.worst - a.worst).slice(0, 5);
    expect(worst[0].worst, JSON.stringify(worst)).toBeLessThan(500);
  });

  it("expressions stay shallow", () => {
    expect(stats.maxDepth).toBeLessThanOrEqual(9);
  });
});
