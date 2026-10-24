// Programs: assembling the editor's source, turning a RAM image into power-on pokes for the
// RAM latches, and checking the canvas CPU against the ISA model (the "Verify" button).
// Pure: no Figma API here.
import { FastSim, powerOn } from "../../src/compile";
import type { Schedule } from "../../src/compile/types";
import { PROBES, ramBit, readProbes, readRam } from "../../src/cpu/probes";
import { assemble, type AsmError, IsaModel, OPCODES, PROGRAMS, RAM_BYTES } from "../../src/isa";
import type { FlatNetlist } from "../../src/netlist/types";

export class AsmFailed extends Error {
  constructor(readonly errors: AsmError[]) {
    super(`assembler: ${errors.map((e) => `line ${e.line}: ${e.msg}`).join("; ")}`);
  }
}

/** The 16-byte RAM image of `source`; throws AsmFailed with the assembler's errors. */
export function assembleOrThrow(source: string): number[] {
  const r = assemble(source);
  if (r.errors.length) throw new AsmFailed(r.errors);
  return r.bytes;
}

/** Name of a built-in program whose source is exactly `source`, else "custom". */
export function programName(source: string): string {
  return Object.keys(PROGRAMS).find((k) => PROGRAMS[k] === source) ?? "custom";
}

/** RAM preload as powerOn() pokes: every RAM latch output, keyed by net name. */
export function programPokes(bytes: ArrayLike<number>): Record<string, number> {
  const pokes: Record<string, number> = {};
  for (let addr = 0; addr < RAM_BYTES; addr++) {
    const v = addr < bytes.length ? bytes[addr] & 0xff : 0;
    for (let bit = 0; bit < 8; bit++) pokes[ramBit(addr, bit)] = (v >> bit) & 1;
  }
  return pokes;
}

/** Power-on state of the CPU with `bytes` in RAM (what the prototype's variables start at). */
export function powerOnWith(net: FlatNetlist, bytes: ArrayLike<number>): Uint8Array {
  return powerOn(net, programPokes(bytes));
}

export interface VerifyResult {
  ok: boolean;
  /** Ticks compared. */
  ticks: number;
  /** Tick at which the model halted (null if it never did). */
  haltedAt: number | null;
  out: number;
  /** Every value latched into OUT. */
  outputs: number[];
  /** First mismatch: where and which probes differ. */
  mismatch?: { tick: number; where: string; diffs: string[] };
  text: string;
}

/** Runs the (canvas-extracted) CPU on FastSim with the schedule the prototype uses, side by
 * side with the T-state model, comparing every probe, every RAM byte and the LOW-pass bus after
 * every tick. Stops `extra` ticks after the model halts, or after `maxTicks`. */
export function verifyAgainstModel(net: FlatNetlist, schedule: Schedule, bytes: number[], maxTicks = 2000, extra = 3): VerifyResult {
  const sim = new FastSim(net, schedule, powerOnWith(net, bytes));
  const model = new IsaModel(bytes);
  const compare = (busLow: number | null): string[] => {
    const got = readProbes(sim);
    const want: Record<string, number> = { ...model.probes(), BUS: model.nextBus() };
    const diffs = Object.keys(want)
      .filter((k) => got[k] !== want[k])
      .map((k) => `${k} gate ${got[k]} ≠ model ${want[k]}`);
    if (busLow !== null && busLow !== model.state.BUS) diffs.push(`bus during the LOW pass ${busLow} ≠ ${model.state.BUS}`);
    for (let addr = 0; addr < RAM_BYTES; addr++) {
      const r = readRam(sim, addr);
      if (r !== model.state.RAM[addr]) diffs.push(`RAM[${addr}] ${r} ≠ ${model.state.RAM[addr]}`);
    }
    return diffs;
  };
  const fail = (tick: number, where: string, diffs: string[]): VerifyResult => ({
    ok: false,
    ticks: tick,
    haltedAt: null,
    out: sim.peek(PROBES.OUT.name, 8),
    outputs: model.outputs,
    mismatch: { tick, where, diffs },
    text: `✗ ${tick ? `tick ${tick}` : "power-on"} (${where}): ${diffs.slice(0, 4).join("; ")}${diffs.length > 4 ? ` (+${diffs.length - 4} more)` : ""}`,
  });

  const start = compare(null);
  if (start.length) return fail(0, "before the first tick", start);
  let haltedAt: number | null = null;
  let ticks = 0;
  while (ticks < maxTicks && (haltedAt === null || ticks < haltedAt + extra)) {
    const s = model.state;
    const where = s.HALTED ? "halted" : `${OPCODES[s.IR >> 4]?.mnem ?? "?"} T${s.T}, PC=${s.PC}`;
    sim.pass(0);
    const busLow = sim.peek(PROBES.BUS.name, 8);
    sim.pass(1);
    model.tick();
    ticks++;
    const diffs = compare(busLow);
    if (diffs.length) return fail(ticks, where, diffs);
    if (model.state.HALTED && haltedAt === null) haltedAt = ticks;
  }
  const out = sim.peek(PROBES.OUT.name, 8);
  const tail = haltedAt !== null ? `halted at tick ${haltedAt}` : "still running";
  return {
    ok: true,
    ticks,
    haltedAt,
    out,
    outputs: model.outputs,
    text: `✓ matches the ISA model for ${ticks} ticks (${tail}, OUT = ${out} = 0x${out.toString(16).toUpperCase().padStart(2, "0")})`,
  };
}
