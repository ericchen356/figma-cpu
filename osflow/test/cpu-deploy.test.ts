// The no-plugin build of silicon's 8-bit CPU, end to end on the fake Plugin API: run every chunk,
// then load each program with its button and run it through the stored reactions (silicon's
// strict emulator of Figma's prototype engine): Step one tick at a time, Instruction and Run
// through the running overlays' timers, a batch of ticks per timer event. Every register, flag,
// T-state and RAM byte must equal silicon's ISA model at every point we stop, until the program
// halts.
import { beforeAll, describe, expect, it } from "vitest";
import { EVENT_BUDGET, generateCpu, type CpuGenerated } from "../deploy/cpu";
import { latchMap, leaves } from "../deploy/tick";
import {
  runFigmaActions,
  type FigmaValue,
} from "../../silicon/src/prototype/emulate";
import type { Expr, PlanAction } from "../../silicon/src/prototype/types";
import { NET0, NET1 } from "../../silicon/src/netlist/types";
import { FakeFigma, type FakeNode } from "../../silicon/test/fake-figma";
import { PROBES, ramBit } from "../../silicon/src/cpu";
import { assemble, IsaModel, PROGRAMS, RAM_BYTES } from "../../silicon/src/isa";
import { figmaShapeErrors, withClose } from "./figma-shape";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
let gen: CpuGenerated;
let fake: FakeFigma;

beforeAll(async () => {
  gen = generateCpu();
  fake = new FakeFigma(["Page 1"]);
  (globalThis as { figma?: unknown }).figma = fake;
  for (const c of gen.chunks) await new AsyncFunction("figma", c.code)(fake);
}, 300000);

const PROBED = [
  "PC",
  "MAR",
  "MDR",
  "IR",
  "R0",
  "R1",
  "R2",
  "R3",
  "A",
  "Y",
  "Z",
  "C",
  "N",
  "T",
  "HALTED",
  "OUT",
] as const;

/** Panel row labels and the probes they show. */
const PANEL_ROWS = {
  PC: "PC",
  MAR: "MAR",
  IR: "IR",
  MDR: "MDR",
  A: "A",
  "Y (ALU)": "Y",
  R0: "R0",
  R1: "R1",
  R2: "R2",
  R3: "R3",
  OUT: "OUT",
  "T-state": "T",
  Z: "Z",
  C: "C",
  N: "N",
  HALTED: "HALTED",
} as const;
/** Segments a..g lit for each hex digit. */
const SEVEN_SEG = [
  "1111110",
  "0110000",
  "1101101",
  "1111001",
  "0110011",
  "1011011",
  "1011111",
  "1110000",
  "1111111",
  "1111011",
  "1110111",
  "0011111",
  "1001110",
  "0111101",
  "1001111",
  "1000111",
];

/** A fresh prototype session on the built file with `program` loaded by its button. */
function session(program: "count" | "mul" | "fib" | "perceptron") {
  const values = fake.variableValues() as Map<string, FigmaValue>;
  const ids = new Map<string, string>();
  for (const c of fake.collections)
    for (const v of c.vars) ids.set(v.name, v.id);
  const wireVar = new Map<number, string>();
  for (const [name, id] of ids) {
    const m = /^c\/.*\/(\d+)$/.exec(name);
    if (m) wireVar.set(Number(m[1]), id);
  }
  const bitOf = (name: string): number => {
    const id = gen.net.aliases.get(name);
    if (id === undefined) throw new Error(`no net ${name}`);
    return values.get(wireVar.get(gen.wireOf.get(id)!)!) === true ? 1 : 0;
  };
  const peek = (name: string, width: number) => {
    let v = 0;
    for (let i = 0; i < width; i++)
      v |= bitOf(width === 1 ? name : `${name}[${i}]`) << i;
    return v;
  };
  const page = fake.currentPage.children;
  const frame = page.find((n) => n.name === gen.names.frame)!;
  const root = frame.children.find((n) => n.name === gen.names.root)!;
  const byName = (name: string) => root.children.find((c) => c.name === name)!;
  let overlay: FakeNode | null = null;
  /** Fires `node`'s reaction of `trigger`; returns the actions it executed. */
  const fire = (node: FakeNode, trigger: string) => {
    const r = node.reactions.find((x) => x.trigger?.type === trigger);
    if (!r?.actions) throw new Error(`${node.name} has no ${trigger}`);
    return runFigmaActions(withClose(r.actions), values, {
      navigate: (id) => {
        overlay = id === "close" ? null : fake.nodeById(id!);
        if (id !== "close" && !gen.names.overlays.includes(overlay!.name))
          throw new Error(`navigated to ${overlay?.name}`);
      },
    });
  };
  /** Lets the open overlay's timer fire until the overlay closes; returns the timer events. */
  const runTimers = (max: number, onEvent?: (executed: number) => void) => {
    let events = 0;
    while (overlay) {
      if (++events > max)
        throw new Error(`still running after ${max} timer events`);
      const n = fire(overlay, "AFTER_TIMEOUT");
      onEvent?.(n);
    }
    return events;
  };
  /** Clicks a panel button and lets the overlay it opens run until it closes; returns the most
   * actions one of those events executed. */
  const click = (name: string, max = 32) => {
    let worst = fire(byName(name), "ON_CLICK");
    runTimers(max, (n) => (worst = Math.max(worst, n)));
    return worst;
  };
  const loadCost = click(`load/${program}`);
  const model = new IsaModel(assemble(PROGRAMS[program]).bytes);
  const compare = (when: string) => {
    for (const key of PROBED) {
      const p = PROBES[key];
      const got = peek(p.name, p.width);
      const want = model.probe(key);
      if (got !== want)
        throw new Error(
          `${when}: ${key} is ${got}, the ISA model says ${want}`,
        );
    }
    for (let a = 0; a < RAM_BYTES; a++) {
      let got = 0;
      for (let b = 0; b < 8; b++) got |= bitOf(ramBit(a, b)) << b;
      if (got !== model.state.RAM[a])
        throw new Error(
          `${when}: RAM[${a}] is ${got}, the ISA model says ${model.state.RAM[a]}`,
        );
    }
  };
  /** What a panel row's lamps show (bit k = the lamp named bit<k>). */
  const shown = (row: FakeNode) =>
    row.children
      .filter((lit) => /^bit\d$/.test(lit.name))
      .reduce((v, lit) => {
        const id = lit.boundVariables.visible?.id;
        return (
          v |
          ((id && values.get(id) === true ? 1 : 0) << Number(lit.name.slice(3)))
        );
      }, 0);
  /** Every register row, RAM row and the OUT digits must show the ISA model's state. */
  const comparePanel = (when: string) => {
    for (const [label, key] of Object.entries(PANEL_ROWS))
      expect(shown(byName(`reg/${label}`)), `${when}: the ${label} row`).toBe(
        model.probe(key),
      );
    for (let a = 0; a < RAM_BYTES; a++)
      expect(
        shown(byName(`ram/${a.toString(16).toUpperCase()}`)),
        `${when}: RAM row ${a}`,
      ).toBe(model.state.RAM[a]);
    const out = model.probe("OUT");
    for (const [digit, nibble] of [
      ["digit/hi", out >> 4],
      ["digit/lo", out & 15],
    ] as const) {
      const segs = byName(digit)
        .children.filter((n) => /^seg\d$/.test(n.name))
        .map((n) => (values.get(n.boundVariables.visible!.id) === true ? 1 : 0))
        .join("");
      expect(segs, `${when}: ${digit}`).toBe(SEVEN_SEG[nibble]);
    }
  };
  compare("after Load");
  return {
    loadCost,
    comparePanel,
    values,
    ids,
    peek,
    byName,
    fire,
    click,
    runTimers,
    model,
    compare,
    overlay: () => overlay,
  };
}

describe("the CPU build", () => {
  it("stores only reactions Figma keeps as written", () => {
    expect(figmaShapeErrors(fake.allNodes())).toEqual([]);
  });

  it("keeps Step's large reaction off every variable a run changes", () => {
    // Figma's cost of changing a variable grows with the size of every stored reaction that names
    // it, so the every-gate Step must not name what Run writes (deploy/README.md)
    const named = (node: FakeNode) => {
      const reads = new Set<string>();
      const writes = new Set<string>();
      const read = (v: unknown): void => {
        const x = v as {
          type?: string;
          value?: { id?: string; expressionArguments?: unknown[] };
        };
        if (x?.type === "VARIABLE_ALIAS") reads.add(x.value!.id!);
        else if (x?.type === "EXPRESSION")
          x.value!.expressionArguments!.forEach(read);
      };
      const walk = (acts: readonly Action[]) => {
        for (const a of acts)
          if (a.type === "CONDITIONAL")
            for (const b of a.conditionalBlocks)
              (read(b.condition), walk(b.actions));
          else if (a.type === "SET_VARIABLE")
            (writes.add(a.variableId!), read(a.variableValue));
      };
      for (const r of node.reactions) walk(r.actions ?? []);
      return { reads, writes };
    };
    const top = (name: string) =>
      fake.currentPage.children.find((n) => n.name === name)!;
    const run = gen.names.overlays
      .slice(0, 2)
      .flatMap((n) => [...named(top(n)).writes]);
    const step = named(top(gen.names.stepBody));
    expect(
      run.filter((id) => step.reads.has(id) || step.writes.has(id)),
    ).toEqual([]);
  });

  it("draws every gate", () => {
    for (const c of gen.chunks)
      expect(c.code.length, c.note).toBeLessThanOrEqual(2000000);
    const frame = fake.currentPage.children.find(
      (n) => n.name === gen.names.frame,
    )!;
    let lamps = 0;
    frame.walkRaw((n) => {
      if (
        n.name === "lit" &&
        n.boundVariables.visible &&
        n.parent?.name.startsWith("unit/")
      )
        lamps++;
    });
    expect(lamps).toBe(gen.stats.gates);
  });

  for (const program of ["mul", "fib", "count"] as const)
    it(`runs ${program} through the stored Step reaction, tick for tick with the ISA model`, () => {
      const s = session(program);
      let worst = 0;
      let haltedAt = -1;
      for (let tick = 1; tick <= 400; tick++) {
        worst = Math.max(worst, s.click("step"));
        expect(s.overlay()).toBeNull();
        s.model.tick();
        s.compare(`tick ${tick}`);
        if (tick % 16 === 0) s.comparePanel(`tick ${tick}`);
        if (s.model.state.HALTED && haltedAt < 0) haltedAt = tick;
        if (haltedAt > 0 && tick > haltedAt + 3) break;
      }
      expect(worst).toBeLessThanOrEqual(EVENT_BUDGET);
      expect(s.loadCost).toBeLessThanOrEqual(EVENT_BUDGET);
      if (program === "mul") {
        expect(haltedAt).toBeGreaterThan(0);
        expect(s.peek(PROBES.OUT.name, 8)).toBe(42);
      }
      expect(s.values.get(s.ids.get("cpu/ticksText")!)).toBe(
        `ticks ${s.model.ticks}`,
      );
    });

  for (const program of ["mul", "fib"] as const)
    it(`runs ${program} one Instruction a click`, () => {
      const s = session(program);
      let worst = 0;
      for (let i = 1; i <= 120 && !s.model.state.HALTED; i++) {
        worst = Math.max(worst, s.click("instruction", 1));
        expect(s.overlay()).toBeNull();
        s.model.step();
        s.compare(`instruction ${i}`);
        expect(s.values.get(s.ids.get("cpu/ticksText")!)).toBe(
          `ticks ${s.model.ticks}`,
        );
      }
      expect(s.model.state.HALTED).toBe(1);
      expect(worst).toBeLessThanOrEqual(EVENT_BUDGET);
      // a halted CPU stays put
      s.click("instruction", 1);
      s.compare("an Instruction after HALT");
      expect(s.values.get(s.ids.get("cpu/ticksText")!)).toBe(
        `ticks ${s.model.ticks}`,
      );
    });

  for (const program of ["mul", "fib", "perceptron"] as const)
    it(`runs ${program} to HALT with one Run click, and pauses when the pill is clicked`, () => {
      const s = session(program);
      const per = gen.stats.instructionsPerEvent;
      s.fire(s.byName("run"), "ON_CLICK");
      for (let k = 0; k < 8; k++) s.fire(s.overlay()!, "AFTER_TIMEOUT");
      for (let k = 0; k < 8 * per; k++) s.model.step();
      s.compare(`${8 * per} instructions into the run`);
      s.fire(s.overlay()!, "ON_CLICK");
      expect(s.overlay()).toBeNull();
      // Steps in the middle of an instruction, after a run left the flip-flops' masters behind
      for (let k = 0; k < 3; k++) {
        s.click("step");
        s.model.tick();
        s.compare(`Step ${k + 1} after the pause`);
      }
      s.fire(s.byName("run"), "ON_CLICK");
      let worst = 0;
      const events = s.runTimers(2000, (n) => (worst = Math.max(worst, n)));
      let instructions = 0;
      while (!s.model.state.HALTED) {
        s.model.step();
        instructions++;
      }
      expect(events).toBe(Math.ceil(instructions / per));
      expect(worst).toBeLessThanOrEqual(EVENT_BUDGET);
      s.compare("after Run");
      s.comparePanel("after Run");
      // mul 6 × 7, fib's last term, the perceptron's verdict on 9 (odd: 9·16 + 0)
      expect(s.peek(PROBES.OUT.name, 8)).toBe({ mul: 42, fib: 0xe9, perceptron: 0x90 }[program]);
      expect(s.values.get(s.ids.get("cpu/ticksText")!)).toBe(
        `ticks ${s.model.ticks}`,
      );
      // Run on a halted CPU closes at once
      s.fire(s.byName("run"), "ON_CLICK");
      expect(s.runTimers(1)).toBe(1);
      s.compare("a Run after HALT");
    });

  it("ends every Run tick in the state its Step tick does, from random states", () => {
    // the bodies run on every wire at random (a body that read a wire it had not written this tick
    // would read noise, and a flip-flop's master may be anything, as a run leaves it), with the bits
    // the dispatch judged set to the body's case and, as every tick leaves them, the OUT digits
    // showing OUT. A master is internal to its flip-flop: what must agree is every other latch.
    const net = gen.net;
    const lm = latchMap(net);
    const masters = new Set(lm.slaves.map((sl) => sl.master!.q));
    const halted = net.aliases.get(PROBES.HALTED.name)!;
    const watched = [
      ...lm.latches.map((l) => l.q).filter((q) => !masters.has(q)),
      ...net.ports.filter((p) => /^SEG_/.test(p.name)).flatMap((p) => p.nets),
    ];
    const bitOf = (name: string, i: number) =>
      net.aliases.get(`${name}[${i}]`)!;
    const opBits = [4, 5, 6, 7].map((i) => bitOf(PROBES.IR.name, i));
    const tBits = [0, 1, 2].map((i) => bitOf(PROBES.T.name, i));
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 16) & 1;
    };
    const value = (e: Expr, s: Uint8Array): number => {
      if ("var" in e) return s[e.var];
      if ("const" in e) return e.const;
      if ("not" in e) return value(e.not, s) ^ 1;
      if ("and" in e) return value(e.and[0], s) & value(e.and[1], s);
      if ("or" in e) return value(e.or[0], s) | value(e.or[1], s);
      if ("eq" in e) return value(e.eq[0], s) === value(e.eq[1], s) ? 1 : 0;
      return value(e.neq[0], s) !== value(e.neq[1], s) ? 1 : 0;
    };
    const run = (list: PlanAction[], s: Uint8Array) => {
      for (const a of list) {
        if (!("set" in a)) throw new Error("a conditional in a tick body");
        s[a.set] = value(a.to, s);
      }
    };
    let checked = 0;
    // Step's shadows and Run's temporaries are variables beyond the netlist's nets
    const lists = [
      ...gen.ticks.flatMap((tk) => [tk.full, ...tk.fast.map((f) => f.actions)]),
      ...gen.tNext,
      gen.stepping.sync,
      gen.stepping.finish,
    ];
    let size = net.netNames.length;
    for (const a of lists.flat())
      if ("set" in a)
        size = Math.max(size, a.set + 1, ...leaves(a.to).map((n) => n + 1));
    for (const tk of gen.ticks)
      for (const f of tk.fast)
        for (let r = 0; r < 24; r++) {
          const s = new Uint8Array(size).map(() => random());
          s[NET0] = 0;
          s[NET1] = 1;
          s[net.aliases.get("RESET")!] = 0;
          opBits.forEach((id, b) => (s[id] = (tk.op >> b) & 1));
          tBits.forEach((id, b) => (s[id] = (tk.t >> b) & 1));
          for (const [id, v] of f.extra) s[id] = v;
          let out = 0;
          for (let i = 0; i < 8; i++)
            out |= s[net.aliases.get(`OUT[${i}]`)!] << i;
          for (const [port, nibble] of [
            ["SEG_HI", out >> 4],
            ["SEG_LO", out & 15],
          ] as const)
            net.ports
              .find((p) => p.name === port)!
              .nets.forEach(
                (n, i) => (s[n] = SEVEN_SEG[nibble][i] === "1" ? 1 : 0),
              );
          const step = s.slice();
          // Step: the copies in (shadows, masters), the body, the copies out
          run(gen.stepping.sync, step);
          run(tk.full, step);
          run(gen.stepping.finish, step);
          run(f.actions, s);
          // T's move after the body, while the CPU runs (a tick that halts moves T itself)
          if (!tk.halts)
            for (const x of [step, s]) if (!x[halted]) run(gen.tNext[tk.t], x);
          for (const n of watched)
            if (s[n] !== step[n])
              throw new Error(
                `op ${tk.op} T${tk.t} ${f.extra.map(([id, v]) => `${net.netNames[id]}=${v}`).join(" ")}: ${net.netNames[n]} is ${s[n]} after Run's tick, ${step[n]} after Step's`,
              );
          checked++;
        }
    expect(checked).toBeGreaterThan(128 * 24);
  });
});
