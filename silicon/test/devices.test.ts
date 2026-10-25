// Device layer (plugin/src/devices.ts): a memory-mapped input byte at RAM[14] that the plugin
// clock pokes between ticks, with no new gates. Runs the real gate-level CPU, through PluginClock
// on a session of fake Figma variables built exactly like SiliconApp.clockSession().
import { describe, expect, it } from "vitest";
import { type ClockSession, PluginClock, type VarRef } from "../plugin/src/clock";
import { DeviceBus, IN_ADDR, readFramebuffer } from "../plugin/src/devices";
import type { ClockStatus } from "../plugin/src/messages";
import { powerOnWith } from "../plugin/src/program";
import { compile, FastSim } from "../src/compile";
import { cpuNetlist, PROBES, ramBit, readProbes, readRam, type SimLike } from "../src/cpu";
import { assemble, IsaModel, OUT_ADDR, PROGRAMS, RAM_BYTES } from "../src/isa";
import { NET1 } from "../src/netlist/types";
import { plan } from "../src/prototype";

const net = cpuNetlist();
const schedule = compile(net, { inputs: [] });
const MODE = "m";

function bytesOf(name: string): number[] {
  const r = assemble(PROGRAMS[name]);
  expect(r.errors, name).toEqual([]);
  expect(r.warnings, name).toEqual([]);
  return r.bytes;
}

/** A minimal stand-in for a Figma Variable: one mode, counts writes. */
class FakeVar {
  valuesByMode: Record<string, boolean | number | string>;
  constructor(
    value: boolean | number | string,
    readonly resolvedType: "BOOLEAN" | "FLOAT" | "STRING",
    private readonly counter: { writes: number },
  ) {
    this.valuesByMode = { [MODE]: value };
  }
  setValueForMode(mode: string, value: boolean | number | string) {
    this.valuesByMode[mode] = value;
    this.counter.writes++;
  }
}

/** The variables a compiled document holds for `program` (plan() picks the nets), as a session. */
function fakeSession(program: string) {
  const counter = { writes: 0 };
  const p = plan(net, schedule, { initial: powerOnWith(net, bytesOf(program)), name: "Silicon", halt: PROBES.HALTED.name });
  const base = new Uint8Array(net.netNames.length);
  base[NET1] = 1;
  const vars = new Map<number, VarRef>();
  for (const v of p.variables) {
    base[v.net] = v.init ? 1 : 0;
    vars.set(v.net, { v: new FakeVar(!!v.init, "BOOLEAN", counter) as unknown as Variable, mode: MODE });
  }
  const ticks: VarRef[] = [{ v: new FakeVar(0, "FLOAT", counter) as unknown as Variable, mode: MODE }];
  const session: ClockSession = { net, schedule, base, vars, ticks, halt: p.halt ?? -1 };
  const varOf = (name: string) => {
    const id = net.aliases.get(name);
    const r = id === undefined ? undefined : vars.get(id);
    if (!r) throw new Error(`no variable for ${name}`);
    return r.v.valuesByMode[MODE];
  };
  return { session, counter, varOf };
}

function makeClock(program: string, devices?: DeviceBus) {
  const f = fakeSession(program);
  const reports: ClockStatus[] = [];
  const clock = new PluginClock(async () => f.session, (s) => reports.push(s), { frameMs: 0, devices });
  return { ...f, clock, reports };
}

/** RAM byte `addr` as the Figma variables show it. */
function ramFromVars(varOf: (n: string) => unknown, addr: number): number {
  let v = 0;
  for (let bit = 0; bit < 8; bit++) if (varOf(ramBit(addr, bit)) === true) v |= 1 << bit;
  return v;
}

/** Records every SimLike call while forwarding to a real sim. */
function recording(sim: FastSim) {
  const pokes: string[] = [];
  const sets: Array<[string, number]> = [];
  const rec: SimLike = {
    set: (port, value) => {
      sets.push([port, value]);
      sim.set(port, value);
    },
    settle: () => sim.settle(),
    peek: (name, width) => sim.peek(name, width),
    poke: (name, value, width) => {
      pokes.push(name);
      sim.poke(name, value, width);
    },
  };
  return { rec, pokes, sets };
}

describe("device layer: DeviceBus (pure)", () => {
  it("IN_ADDR is 14, the byte below OUT (15)", () => {
    expect(IN_ADDR).toBe(14);
    expect(IN_ADDR).toBe(OUT_ADDR - 1);
    expect(() => new DeviceBus(OUT_ADDR)).toThrow(/OUT/);
    expect(() => new DeviceBus(RAM_BYTES)).toThrow();
  });

  it("pokes exactly the 8 RAM[14] latch nets and nothing else; other RAM untouched", () => {
    const bytes = bytesOf("echo");
    const sim = new FastSim(net, schedule, powerOnWith(net, bytes));
    sim.run(5);
    const before = readFramebuffer(sim);
    const bus = new DeviceBus();
    const { rec, pokes } = recording(sim);
    expect(bus.apply(rec)).toBe(0); // nothing pending
    expect(pokes).toEqual([]);
    bus.input(0xa5);
    expect(bus.isPending).toBe(true);
    expect(bus.apply(rec)).toBe(8);
    expect(pokes.sort()).toEqual(Array.from({ length: 8 }, (_, b) => ramBit(IN_ADDR, b)).sort());
    expect(readRam(sim, IN_ADDR)).toBe(0xa5);
    const after = readFramebuffer(sim);
    expect(after.filter((_, a) => a !== IN_ADDR)).toEqual(before.filter((_, a) => a !== IN_ADDR));
    // Applied once: no second poke; the same value again pokes nothing (latch already holds it).
    pokes.length = 0;
    expect(bus.apply(rec)).toBe(0);
    bus.input(0xa5);
    expect(bus.apply(rec)).toBe(0);
    expect(pokes).toEqual([]);
    expect(bus.pokes).toBe(1);
  });

  it("rejects non-bytes; readFramebuffer reads RAM rows and checks bounds", () => {
    const bus = new DeviceBus();
    for (const bad of [-1, 256, 1.5, Number.NaN]) expect(() => bus.input(bad)).toThrow(/byte/);
    const bytes = bytesOf("mem");
    const sim = new FastSim(net, schedule, powerOnWith(net, bytes));
    const want = Array.from({ length: RAM_BYTES }, (_, a) => bytes[a] ?? 0);
    expect(readFramebuffer(sim)).toEqual(want);
    expect(readFramebuffer(sim, 4, 3)).toEqual(want.slice(4, 7));
    expect(readFramebuffer(sim, 16, 0)).toEqual([]);
    expect(() => readFramebuffer(sim, 10, 7)).toThrow(/outside RAM/);
  });
});

describe("device layer on the gate-level CPU (PluginClock + fake variables)", () => {
  it("echo.asm: OUT mirrors the input byte (A5, 3C, 0); the variables follow", async () => {
    const devices = new DeviceBus();
    const { clock, varOf } = makeClock("echo", devices);
    await clock.step(30);
    expect(clock.status().probes.OUT).toBe(0);
    for (const v of [0xa5, 0x3c, 0x00]) {
      devices.input(v);
      const st = await clock.step(30); // one loop is 22 ticks (LD 8 + ST 8 + JMP 6)
      expect(st.probes.OUT, `input ${v}`).toBe(v);
      expect(ramFromVars(varOf, IN_ADDR)).toBe(v);
      let out = 0;
      for (let b = 0; b < 8; b++) if (varOf(`OUT[${b}]`) === true) out |= 1 << b;
      expect(out).toBe(v);
    }
  });

  it("echo.asm under run(): the input is applied at a frame boundary", async () => {
    const devices = new DeviceBus();
    const f = fakeSession("echo");
    let frames = 0;
    let clock!: PluginClock;
    const sleep = async () => {
      frames++;
      if (frames === 1) devices.input(0x77);
      if (frames >= 3) clock.pause();
    };
    clock = new PluginClock(async () => f.session, () => {}, { frameMs: 0, budgetMs: 5, sleep, devices });
    await clock.run(0);
    expect(frames).toBe(3);
    expect(clock.status().probes.OUT).toBe(0x77);
  });

  it("keypad.asm: adds each key into R1 and shows the sum; a key is consumed, so repeats count", async () => {
    const devices = new DeviceBus();
    const { clock, varOf } = makeClock("keypad", devices);
    await clock.step(40);
    expect(clock.status().probes).toMatchObject({ OUT: 0, R1: 0 });
    let sum = 0;
    for (const k of [3, 4, 4, 0x0f, 0xf0]) {
      devices.input(k);
      const st = await clock.step(60);
      sum = (sum + k) & 0xff;
      expect(st.probes, `key ${k}`).toMatchObject({ OUT: sum, R1: sum });
      expect(ramFromVars(varOf, IN_ADDR), `key ${k} consumed`).toBe(0);
    }
    expect(sum).toBe(0x0a); // 3 + 4 + 4 + 15 + 240 = 266, wraps to 0x0A
  });

  it("keypad.asm on FastSim matches the ISA model tick for tick with input pokes", () => {
    const bytes = bytesOf("keypad");
    const sim = new FastSim(net, schedule, powerOnWith(net, bytes));
    const model = new IsaModel(bytes);
    const bus = new DeviceBus();
    const keys = new Map([
      [10, 5],
      [90, 7],
      [200, 7],
    ]);
    for (let t = 0; t < 320; t++) {
      const k = keys.get(t);
      if (k !== undefined) {
        bus.input(k);
        bus.apply(sim);
        model.state.RAM[IN_ADDR] = k;
      }
      sim.tick();
      model.tick();
      const want: Record<string, number> = { ...model.probes(), BUS: model.nextBus() };
      expect(readProbes(sim), `tick ${t + 1}`).toEqual(want);
      expect(readFramebuffer(sim), `RAM tick ${t + 1}`).toEqual(model.state.RAM);
    }
    expect(model.outputs).toEqual([5, 12, 19]);
  });

  it("a clock without devices (or with an idle bus) runs exactly as before", async () => {
    const a = makeClock("count");
    const b = makeClock("count", new DeviceBus());
    for (let i = 0; i < 6; i++) {
      const wa = a.counter.writes;
      const wb = b.counter.writes;
      const sa = await a.clock.step(7);
      const sb = await b.clock.step(7);
      expect(sb).toEqual(sa);
      expect(b.counter.writes - wb).toBe(a.counter.writes - wa);
    }
    expect(a.clock.status().probes.OUT).toBeGreaterThan(0);
  });

  it("an input change writes the poked variables through the diff, and only a few (< 40)", async () => {
    const devices = new DeviceBus();
    const { clock, counter, varOf } = makeClock("echo", devices);
    await clock.step(25);
    for (const v of [0xa5, 0x5a, 0xff, 0x01]) {
      devices.input(v);
      const w0 = counter.writes;
      const st = await clock.step(0); // apply the device at the tick boundary, no ticks
      const writes = counter.writes - w0;
      expect(ramFromVars(varOf, IN_ADDR)).toBe(v);
      expect(st.writes).toBe(writes); // no tick counter write: every write is a CPU net
      expect(writes).toBeGreaterThanOrEqual(1);
      expect(writes).toBeLessThan(40);
    }
  });
});
