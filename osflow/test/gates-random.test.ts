// The synthesizer against the truncating reference on random programs: each program (random
// widths, signedness, temps, inputs, consts, views, nested if / set / half / unit over every
// operator) is synthesized and run on a random event sequence, and every state variable must
// agree after every event. FastSim runs hundreds of programs; RefSim, the golden simulator, a
// subset; and the constant-register proof is checked against a synthesis that skips it.
import { describe, expect, it } from "vitest";
import { GateMachine, synthesize } from "../src/gates";
import { lockstep, randomEvents, randomProgram, rng } from "./gates-support";

describe("gates: random programs in lockstep with the reference", () => {
  it("FastSim on 1000 programs", () => {
    let events = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed);
      const p = randomProgram(r);
      const syn = synthesize(p);
      const seqOf = randomEvents(r, p, 30);
      lockstep(p, syn, new GateMachine(syn), seqOf, `seed ${seed}`);
      events += seqOf.length;
    }
    expect(events).toBe(1000 * 30);
  }, 120_000);

  it("RefSim on 60 programs", () => {
    for (let seed = 1001; seed <= 1060; seed++) {
      const r = rng(seed);
      const p = randomProgram(r);
      const syn = synthesize(p);
      lockstep(
        p,
        syn,
        new GateMachine(syn, { reference: true }),
        randomEvents(r, p, 20),
        `seed ${seed}`,
      );
    }
  }, 120_000);

  it("the same behaviour without the constant-register proof", () => {
    for (let seed = 2001; seed <= 2100; seed++) {
      const r = rng(seed);
      const p = randomProgram(r);
      const syn = synthesize(p, { constantRegisters: false });
      lockstep(
        p,
        syn,
        new GateMachine(syn),
        randomEvents(r, p, 30),
        `seed ${seed}`,
      );
      expect(syn.stats.registers).toBeGreaterThanOrEqual(
        synthesize(p).stats.registers,
      );
    }
  }, 120_000);
});
