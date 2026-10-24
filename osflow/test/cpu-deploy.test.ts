// The no-plugin build of silicon's 8-bit CPU, end to end on the fake Plugin API: run every chunk,
// then load each program with its button and run it through the stored reactions (silicon's
// strict emulator of Figma's prototype engine): Step one tick at a time, Instruction and Run
// through the running overlays' timers. Every register, flag, T-state and RAM byte must equal
// silicon's ISA model at every point we stop, until the program halts.
import { beforeAll, describe, expect, it } from "vitest";
import { generateCpu, type CpuGenerated } from "../deploy/cpu";
import {
  runFigmaActions,
  type FigmaValue,
} from "../../silicon/src/prototype/emulate";
import { FakeFigma, type FakeNode } from "../../silicon/test/fake-figma";
import { PROBES, ramBit } from "../../silicon/src/cpu";
import { assemble, IsaModel, PROGRAMS, RAM_BYTES } from "../../silicon/src/isa";
import { figmaShapeErrors, withClose } from "./figma-shape";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
// Figma's viewer runs a reaction's actions recursively (about three stack frames each): a 1,250-action
// Load overflowed Chrome's stack on a cold page and left the prototype dead, so every event stays small
const EVENT_BUDGET = 600;
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
function session(program: "count" | "mul" | "fib") {
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
  const loadCost = fire(byName(`load/${program}`), "ON_CLICK");
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
    row.children.slice(1).reduce((v, lamp) => {
      const id = lamp.children[0].boundVariables.visible?.id;
      return v | ((id && values.get(id) === true ? 1 : 0) << Number(lamp.name.slice(3)));
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
      const step = s.byName("step");
      for (let tick = 1; tick <= 400; tick++) {
        worst = Math.max(worst, s.fire(step, "ON_CLICK"));
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
      expect(s.values.get(s.ids.get("cpu/ticksText")!)).toBe(`ticks ${s.model.ticks}`);
    });

  for (const program of ["mul", "fib"] as const)
    it(`runs ${program} one Instruction at a time through the running overlays`, () => {
      const s = session(program);
      const button = s.byName("instruction");
      let worst = 0;
      for (let i = 1; i <= 120 && !s.model.state.HALTED; i++) {
        s.fire(button, "ON_CLICK");
        expect(s.overlay()?.name).toBe(gen.names.overlays[0]);
        const events = s.runTimers(8, (n) => (worst = Math.max(worst, n)));
        const ticks = s.model.step();
        expect(events, `instruction ${i}`).toBe(ticks);
        s.compare(`instruction ${i}`);
      }
      expect(s.model.state.HALTED).toBe(1);
      expect(worst).toBeLessThanOrEqual(EVENT_BUDGET);
    });

  it("runs mul to HALT with one Run click, and pauses when the pill is clicked", () => {
    const s = session("mul");
    s.fire(s.byName("run"), "ON_CLICK");
    for (let k = 0; k < 25; k++) {
      s.fire(s.overlay()!, "AFTER_TIMEOUT");
      s.model.tick();
    }
    s.compare("25 ticks into the run");
    s.fire(s.overlay()!, "ON_CLICK");
    expect(s.overlay()).toBeNull();
    s.fire(s.byName("run"), "ON_CLICK");
    const events = s.runTimers(2000);
    const ticks = s.model.runUntilHalt();
    expect(events).toBe(ticks);
    s.compare("after Run");
    s.comparePanel("after Run");
    expect(s.peek(PROBES.OUT.name, 8)).toBe(42);
    expect(s.values.get(s.ids.get("cpu/ticksText")!)).toBe(
      `ticks ${25 + ticks}`,
    );
  });
});
