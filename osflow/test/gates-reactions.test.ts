// Per-event reactions (src/gates/reaction.ts, docs/GATES.md §4): with EVT tied to an event's code
// and the constants folded, the cone of gates that feeds the LOAD and D of every register that can
// load, then one commit per bit, must compute exactly what a whole clock tick of the gates does.
// That is what makes the costs cli/gates.ts prints real costs: ReactionMachine runs nothing but
// the reactions, and it is held to the reference on random programs and to the gates on the editor.
import { describe, expect, it } from "vitest";
import { buildEditor } from "../src/editor";
import {
  GateMachine,
  ReactionMachine,
  synthesize,
  type Synth,
} from "../src/gates";
import { add, num, ref, seq, set, type Program } from "../src/ir";
import type { Feature } from "../src/spec";
import { lockstep, randomEvents, randomProgram, rng } from "./gates-support";
import { drive } from "./support";

/** The module (top-level cell) each flat gate belongs to. */
function moduleOf(syn: Synth, m: ReactionMachine): (gate: number) => string {
  const cellOf = new Map(
    syn.lib.get(syn.top)!.instances.map((i) => [i.name, i.cell]),
  );
  return (gate) => cellOf.get(m.net.gates[gate].path.split("/")[0])!;
}

describe("per-event reactions", () => {
  it("compute what a clock tick computes, on 300 random programs", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const p = randomProgram(r);
      const syn = synthesize(p);
      lockstep(
        p,
        syn,
        new ReactionMachine(syn),
        randomEvents(r, p, 30),
        `seed ${seed}`,
      );
    }
  }, 60_000);

  it("commit from the values before the event: one register loads another's old output", () => {
    // y = x reads x's register output straight (no gate between), and x changes in the same event.
    const p: Program = {
      vars: [
        {
          name: "x",
          ty: "num",
          init: 3,
          role: "state",
          bits: 4,
          signed: false,
        },
        {
          name: "y",
          ty: "num",
          init: 0,
          role: "state",
          bits: 4,
          signed: false,
        },
      ],
      events: [
        {
          id: "go",
          node: "go",
          trigger: { type: "click" },
          steps: seq(set("y", ref("x")), set("x", add(ref("x"), num(1)))),
        },
      ],
    };
    const syn = synthesize(p);
    for (const m of [new GateMachine(syn), new ReactionMachine(syn)]) {
      m.fire("go");
      expect([m.read("x"), m.read("y")]).toEqual([4, 3]);
      m.fire("go");
      expect([m.read("x"), m.read("y")]).toEqual([5, 4]);
    }
  });

  for (const omit of [[], ["style", "clipboard", "align"]] as Feature[][])
    it(`compute what a clock tick computes on the editor${omit.length ? ` without ${omit.join(", ")}` : ""}, every register after every event`, () => {
      const opts = { target: "hardware", omit } as const;
      const ed = buildEditor(opts);
      const syn = synthesize(ed);
      const gates = new GateMachine(syn);
      const reactions = new ReactionMachine(syn);
      const states = ed.vars
        .filter((d) => d.role === "state")
        .map((d) => d.name);
      let events = 0;
      for (let seed = 1; seed <= 12; seed++) {
        gates.reset();
        reactions.reset();
        events += drive(
          seed,
          1,
          120,
          (id, inputs) => {
            gates.fire(id, inputs);
            reactions.fire(id, inputs);
            for (const name of states)
              if (reactions.read(name) !== gates.read(name))
                expect.fail(
                  `seed ${seed}, ${id} ${JSON.stringify(inputs)}: ${name} is ${String(reactions.read(name))} after the reaction, ${String(gates.read(name))} after the tick`,
                );
          },
          opts,
        );
      }
      expect(events).toBeGreaterThan(12 * 150);
    });

  it("cost one action per gate of the cone and one per commit; a cone has no latch, no event decoder and no gate nothing reads", () => {
    const syn = synthesize(buildEditor({ target: "hardware" }));
    const m = new ReactionMachine(syn);
    const moduleAt = moduleOf(syn, m);
    expect(m.reactions.map((r) => r.code)).toEqual(
      [...new Set(syn.codes.values())].sort((a, b) => a - b),
    );
    for (const r of m.reactions) {
      expect(r.cost).toBe(r.gates.length + r.commits.length);
      const read = new Set(r.commits.flatMap((c) => [c.load, c.d]));
      for (const g of r.gates) {
        expect(moduleAt(g), r.ids[0]).not.toMatch(/^(REG_W|EVDEC$)/);
        for (const x of m.net.gates[g].in) read.add(x);
      }
      for (const g of r.gates)
        if (!read.has(m.net.gates[g].out))
          expect.fail(`${r.ids[0]}: ${m.net.gates[g].path} feeds nothing`);
    }
    const of = (id: string) => m.reactions[syn.codes.get(id)! - 1];
    // A tool button writes constants into the tool register and its two flags: nothing to compute.
    expect(of("tool/move#click")).toMatchObject({ gates: [], cost: 5 + 1 + 1 });
    // Two keys with one handler are one reaction.
    expect(of("key/Backspace#key")).toBe(of("key/Delete#key"));
    // The parent search's multipliers are most of an align, and no other reaction needs them.
    const parent = (id: string) =>
      of(id).gates.filter((g) => moduleAt(g) === "U_parent").length;
    expect(parent("align/left#click")).toBeGreaterThan(
      of("align/left#click").cost / 2,
    );
    expect(parent("pointer#down")).toBe(0);
  });
});
