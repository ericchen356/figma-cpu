import { describe, it, expect } from "vitest";
import { Runner, TURBO_SLICE_MS } from "../src/engine/runner";
import { createCpu } from "../src/engine/cpu";
import { readTable, type TreeNode } from "../src/engine/table";
import fixture from "./fixtures/decoder-table.json";
import { assemble } from "../src/assembler/asm";
import countAsm from "../programs/count.asm?raw";
import { Io } from "../src/screen/io";
import { MEM } from "../src/contracts/spec";

const table = readTable(fixture as TreeNode);

/** Deterministic clock + scheduler: run() advances virtual time to each due task. */
function sim() {
  let t = 0, id = 0;
  const q: { id: number; at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => { const h = ++id; q.push({ id: h, at: t + Math.max(ms, 1), fn }); return h; /* min 1 ms so virtual time always moves */ },
    cancel: (h: unknown) => { const i = q.findIndex((x) => x.id === h); if (i >= 0) q.splice(i, 1); },
    advance(ms: number) { // run due tasks until virtual time reaches t+ms
      const end = t + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        if (!q.length || q[0].at > end) { t = end; return; }
        const x = q.shift()!; t = Math.max(t, x.at); x.fn();
      }
    },
    pending: () => q.length,
  };
}

function mk(src: string) {
  const s = sim();
  const io = new Io();
  const cpu = createCpu(table.rows, { read: (a) => io.read(a), write: (a, v) => io.write(a, v) });
  cpu.load(assemble(src).bytes, 0);
  const ev = { frames: 0, steps: 0, stops: [] as string[] };
  const r = new Runner({
    cpu,
    onFrame: () => { ev.frames++; io.tickFrame(); },
    onStep: () => { ev.steps++; },
    onStop: (why) => ev.stops.push(why),
    // each executed instruction costs 1 microsecond of virtual wall time, so Turbo's slice budget is reached
    schedule: s.schedule, cancel: s.cancel, now: () => s.now() + cpu.state.cycles * 0.001,
  });
  return { s, io, cpu, ev, r };
}

describe("Runner", () => {
  it("manual step executes exactly one instruction and notifies", () => {
    const { cpu, ev, r } = mk("LDI A, 7\nHLT");
    r.stepOnce();
    expect(cpu.state.regs.A).toBe(7);
    expect(ev.steps).toBe(1);
    expect(ev.frames).toBe(1);
  });
  it("watch mode runs one instruction per 1/hz seconds and stops on HLT", () => {
    const { s, cpu, ev, r } = mk("LDI A, 1\nLDI B, 2\nHLT");
    r.start("watch", 2); // 500 ms per instruction
    s.advance(1); // first step is scheduled immediately (1 ms in the sim)
    expect(cpu.state.pc).toBe(3);
    s.advance(500); expect(cpu.state.pc).toBe(6);
    s.advance(500); expect(cpu.state.halted).toBe(true);
    expect(ev.stops).toEqual(["halt"]);
    expect(r.running).toBe(false);
    expect(s.pending()).toBe(0);
  });
  it("pause stops a watch run and resume continues", () => {
    const { s, cpu, ev, r } = mk(countAsm);
    r.start("watch", 4);
    s.advance(1000);
    const pc = cpu.state.pc;
    r.pause();
    s.advance(5000);
    expect(cpu.state.pc).toBe(pc);
    expect(ev.stops).toEqual(["pause"]);
    r.start("watch", 4); s.advance(60_000);
    expect(cpu.state.halted).toBe(true);
    expect(cpu.state.regs.A).toBe(10);
  });
  it("turbo runs count.asm to completion within one slice and emits a state-only frame", () => {
    const { s, cpu, ev, r } = mk(countAsm);
    r.start("turbo");
    s.advance(100);
    expect(cpu.state.regs.A).toBe(10);
    expect(ev.stops).toEqual(["halt"]);
    expect(ev.frames).toBeGreaterThanOrEqual(1);
  });
  it("turbo with an endless program keeps yielding frames and TICK advances once per frame", () => {
    const { s, ev, io, r } = mk("loop: INC A\nJMP loop");
    r.start("turbo");
    s.advance(TURBO_SLICE_MS * 4);
    expect(ev.frames).toBeGreaterThan(1);
    expect(io.read(MEM.io.TICK)).toBe(ev.frames & 255);
    r.pause();
  });
  it("a fault (unknown opcode) stops the run and reports it", () => {
    const { s, ev, r } = mk(".db 0xEE");
    r.start("turbo"); s.advance(100);
    expect(ev.stops).toEqual(["fault"]);
  });
});
