// The synthesized editor against its own program (docs/GATES.md §3). src/gates/ turns the hardware
// target of the flow into 2-input gates, one clock tick per event, and the gates must hold exactly
// what the interpreter holds, in every state variable after every event: on the random sessions of
// test/support.ts (a pointer action sets in/px, in/py and fires pointer#…), on every event fired in
// any order, and on the directed scripts, on FastSim and on RefSim. test/hardware.test.ts holds the
// interpreter to the os-ui reducer, so together they say: reducer = flow = gates.
import { beforeAll, describe, expect, it } from "vitest";
import { powerOn } from "../../silicon/src/compile";
import { flatten } from "../../silicon/src/netlist/flatten";
import { RefSim } from "../../silicon/src/sim/reference";
import { buildEditor, type Editor } from "../src/editor";
import { GateMachine, synthesize, type Synth } from "../src/gates";
import { sanitize } from "../src/gates/netlist";
import type { Feature } from "../src/spec";
import { checkShape } from "./gates-support";
import { drive, rng, Runner, SCRIPTS, Session } from "./support";

/** The whole editor and the trims the chart is measured at (cli/gates.ts prints the same four). */
const CONFIGS: Feature[][] = [
  [],
  ["style"],
  ["style", "clipboard"],
  ["style", "clipboard", "align"],
];
const label = (omit: readonly Feature[]) =>
  omit.length ? `without ${omit.join(", ")}` : "every feature";

/** The interpreter with the gates beside it: every event fires on both, then every state variable
 * must agree. A new Twin puts the gates back to power-on, where they must agree too. */
class Twin extends Runner {
  private readonly states: string[];
  private readonly recent: string[] = [];

  constructor(
    ed: Editor,
    readonly gates: GateMachine,
    private readonly where: string,
  ) {
    super(ed);
    this.states = ed.vars.filter((d) => d.role === "state").map((d) => d.name);
    gates.reset();
    this.agree("at power-on");
  }

  override fire(id: string, inputs: Record<string, number> = {}): number {
    const n = super.fire(id, inputs);
    this.gates.fire(id, inputs);
    this.recent.push(
      Object.keys(inputs).length ? `${id} ${JSON.stringify(inputs)}` : id,
    );
    if (this.recent.length > 8) this.recent.shift();
    this.agree(`after ${this.recent.join(", ")}`);
    return n;
  }

  private agree(when: string): void {
    for (const name of this.states) {
      const got = this.gates.read(name);
      const want = this.vars.get(name);
      if (got !== want)
        expect.fail(
          `${this.where}, ${when}: ${name} is ${String(got)} in the gates, ${String(want)} in the flow`,
        );
    }
  }
}

for (const omit of CONFIGS) {
  describe(`the editor in gates, ${label(omit)}`, () => {
    const opts = { target: "hardware", omit } as const;
    const ed = buildEditor(opts);
    const seeds = omit.length ? 16 : 40;
    let syn: Synth;
    let fast: GateMachine;
    beforeAll(() => {
      syn = synthesize(ed);
      fast = new GateMachine(syn);
    });

    it("is a netlist of 2-input gates: a register per state variable, a port per input, a code per handler", () => {
      checkShape(syn, label(omit));
      const states = ed.vars.filter((d) => d.role === "state");
      expect([...syn.regs.keys()]).toEqual(states.map((d) => d.name));
      expect([...syn.inputs]).toEqual([
        ["in/px", { port: "in_px", bits: 4, signed: false }],
        ["in/py", { port: "in_py", bits: 4, signed: false }],
      ]);
      expect([...syn.codes.keys()]).toEqual(ed.events.map((e) => e.id));
      const codes = new Set(syn.codes.values());
      expect(Math.max(...codes)).toBe(codes.size);
      expect(codes.size).toBeLessThan(2 ** syn.evtBits);
      // Two keys with one handler are one code.
      expect(syn.codes.get("key/Delete#key")).toBe(
        syn.codes.get("key/Backspace#key"),
      );
    });

    it("powers on in the program's initial state, on FastSim and on RefSim", () => {
      for (const m of [fast, new GateMachine(syn, { reference: true })]) {
        m.reset();
        for (const d of ed.vars)
          if (d.role === "state") expect(m.read(d.name), d.name).toBe(d.init);
      }
    });

    it(`matches the flow after every event of ${seeds} random sessions (FastSim)`, () => {
      let events = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const t = new Twin(ed, fast, `seed ${seed}`);
        events += drive(seed, 1, 120, (id, inputs) => t.fire(id, inputs), opts);
      }
      expect(events).toBeGreaterThan(seeds * 150);
    });

    it("matches the flow on every event, fired in any order, with any pointer cell", () => {
      const ids = ed.events.map((e) => e.id);
      const fired = new Set<string>();
      for (let seed = 1; seed <= 20; seed++) {
        const r = rng(seed);
        const t = new Twin(ed, fast, `random events, seed ${seed}`);
        for (let i = 0; i < 250; i++) {
          const id = r.pick(ids);
          t.fire(
            id,
            id.startsWith("pointer#")
              ? { "in/px": r.int(16), "in/py": r.int(16) }
              : {},
          );
          fired.add(id);
        }
      }
      expect([...fired].sort()).toEqual([...ids].sort());
    });

    it("matches the flow on RefSim, the golden simulator, for a few hundred events", () => {
      const ref = new GateMachine(syn, { reference: true });
      let events = 0;
      for (let seed = 101; events < 300; seed++) {
        const t = new Twin(ed, ref, `RefSim, seed ${seed}`);
        events += drive(seed, 1, 30, (id, inputs) => t.fire(id, inputs), opts);
      }
    });

    for (const [name, script] of Object.entries(SCRIPTS))
      it(`matches the flow and the reducer on the script: ${name}`, () =>
        script(new Session(new Twin(ed, fast, name))));
  });
}

describe("the editor in gates: a register loads only when its event writes it", () => {
  it("at power-on (nothing selected, no drag) the pointer, Delete, Copy and Cut leave the tool flags, the clipboard and slot 7 alone", () => {
    const syn = synthesize(buildEditor({ target: "hardware" }));
    const net = flatten(syn.lib, syn.top);
    const sim = new RefSim(net);
    sim.v.set(powerOn(net, syn.pokes));
    const loads = (pairs: [event: string, register: string][]) =>
      Object.fromEntries(
        pairs.map(([event, register]) => {
          sim.set("EVT", syn.codes.get(event)!);
          sim.settle();
          return [
            `${event} ${register}`,
            sim.peek(`r_${sanitize(register)}/LOAD`),
          ];
        }),
      );
    const every = (pairs: [string, string][], v: number) =>
      Object.fromEntries(pairs.map(([e, r]) => [`${e} ${r}`, v]));
    // Each of these writes its register only under a condition that is false at power-on: the
    // create tool with a full canvas, the end of a drag that created a layer, a selection.
    const alone: [string, string][] = [
      ["pointer#down", "g/tCreate"],
      ["pointer#up", "g/tCreate"],
      ["pointer#up", "g/tSelect"],
      ["key/meta+c#key", "clip/has"],
      ["key/meta+x#key", "clip/has"],
      ["key/Delete#key", "L7/vis"],
      ["key/meta+x#key", "L7/vis"],
    ];
    expect(loads(alone)).toEqual(every(alone, 0));
    // These write them whatever the state.
    const written: [string, string][] = [
      ["tool/rect#click", "g/tCreate"],
      ["key/Escape#key", "g/tSelect"],
      ["new#click", "clip/has"],
      ["new#click", "L7/vis"],
    ];
    expect(loads(written)).toEqual(every(written, 1));
  });
});
