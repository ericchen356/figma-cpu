// The CPU v2 cost model (tools/cost-model.ts): calibrated against the real CPU, monotonic in the
// address width, its layer count equal to a real draw on the fake Figma API, the proposed v2
// microcode running at gate level, and the CLI wrapper working.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile, FastSim, powerOn } from "../src/compile";
import { cpuLibrary, cpuNetlist, gatesByBlock } from "../src/cpu/cpu";
import { drawLibrary, ensurePages } from "../src/figma";
import { resetFonts } from "../src/figma/style";
import type { FlatNetlist, Library } from "../src/netlist/types";
import {
  BASE,
  buildLibrary,
  countLayers,
  type CpuConfig,
  cpuNetlistFor,
  estimate,
  formatMicrocode,
  ioMap,
  measureParts,
  spInfo,
  ticksOf,
  V2_ALL,
  v2Isa,
} from "../tools/cost-model.js";
import { FakeFigma } from "./fake-figma";

const SILICON = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Layers on the silicon pages after drawLibrary on the fake Figma (page nodes excluded). */
async function drawnLayers(lib: Library): Promise<number> {
  const fig = new FakeFigma(["Page 1"]);
  (globalThis as unknown as { figma: FakeFigma }).figma = fig;
  resetFonts();
  await drawLibrary(lib, ensurePages(), {});
  let n = 0;
  for (const p of fig.root.children) if (p.name !== "Page 1") n += p.findAll().length;
  return n;
}

describe("calibration against the real CPU", () => {
  const real = cpuNetlist();
  const model = cpuNetlistFor(BASE);

  it("the base configuration builds exactly the real CPU (same gates, nets, order)", () => {
    expect(model.gates.length).toBe(2285);
    expect(model.gates).toEqual(real.gates);
    expect(model.netNames).toEqual(real.netNames);
    expect(model.ports).toEqual(real.ports);
  });

  it("RAM(4) = 808, PC(4) = 67, MAR(4) = 40, DEC(4) = 30, and the PLA = the real CONTROL", () => {
    const blocks = gatesByBlock(real);
    expect(blocks.ram).toBe(808);
    expect(measureParts(4)).toEqual({ ram: blocks.ram, pc: blocks.pc, mar: blocks.mar, dec: 30 });
    expect(gatesByBlock(model)).toEqual(blocks);
  });

  it("estimate() of the base matches the real plan: 2,287 variables, 3,860 actions, 11 events per tick", () => {
    const r = estimate(BASE);
    expect(r).toMatchObject({ gates: 2285, variables: 2287, plan: { actionsPerTick: 3860, eventsPerTick: 11 }, isa: "v1" });
    expect(r.blocks.ram).toBe(808);
  });

  it("counted layers equal a real draw on the fake Figma: base (= the real library) and a v2 configuration", async () => {
    const base = countLayers(buildLibrary(BASE)).total;
    expect(base).toBe(countLayers(cpuLibrary()).total);
    expect(await drawnLayers(cpuLibrary())).toBe(base);
    expect(base).toBe(72333);
    const v2 = buildLibrary({ ...V2_ALL, registers: 8, addrBits: 5 });
    expect(await drawnLayers(v2)).toBe(countLayers(v2).total);
  });
});

describe("monotonic in the address width", () => {
  it("RAM, PC, MAR and the decoder grow with every address bit (N = 4..10); RAM roughly doubles", () => {
    const parts = [4, 5, 6, 7, 8, 9, 10].map(measureParts);
    for (let i = 1; i < parts.length; i++) {
      for (const k of ["ram", "pc", "mar", "dec"] as const) expect(parts[i][k]).toBeGreaterThan(parts[i - 1][k]);
      expect(parts[i].ram / parts[i - 1].ram).toBeGreaterThan(1.9);
    }
  });

  it("whole CPU: gates, variables, layers and actions per tick grow with N (v1 and v2)", () => {
    for (const feats of [BASE, { ...V2_ALL, addrBits: 4 }]) {
      const rows = [4, 5, 6].map((addrBits) => estimate({ ...feats, addrBits } as CpuConfig));
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].gates).toBeGreaterThan(rows[i - 1].gates);
        expect(rows[i].variables).toBeGreaterThan(rows[i - 1].variables);
        expect(rows[i].layers).toBeGreaterThan(rows[i - 1].layers);
        expect(rows[i].plan.actionsPerTick).toBeGreaterThan(rows[i - 1].plan.actionsPerTick);
        expect(rows[i].plan.eventsPerTick).toBeGreaterThanOrEqual(rows[i - 1].plan.eventsPerTick!);
      }
    }
  });

  it("every feature costs gates on top of the base", () => {
    const base = estimate({ ...BASE, addrBits: 5 }).gates;
    for (const f of [{ inputPort: true }, { callRet: true }, { indirectLoadStore: true }, { registers: 8 as const }])
      expect(estimate({ ...BASE, addrBits: 5, ...f }).gates).toBeGreaterThan(base);
  });
});

describe("the proposed v2 ISA", () => {
  it("fills the 16 opcodes, fits the 3-bit T counter, and drops NOP / merges the jumps", () => {
    const isa = v2Isa({ indirectLoadStore: true, callRet: true });
    expect(isa.ops.map((o) => o.code)).toEqual([...Array(16).keys()]);
    expect(Math.max(...isa.ops.map(ticksOf))).toBeLessThanOrEqual(8);
    expect(isa.ops.map((o) => o.mnem)).toEqual(["HLT", "LDI", "LD", "ST", "LDR", "STR", "MOV", "ADD", "SUB", "AND", "OR", "XOR", "NOT", "J", "CALL", "RET"]);
    expect(formatMicrocode(isa)).toContain("0xE CALL");
  });

  /** Runs `bytes` on a gate-level v2 CPU (N = 6) until HALTED; returns the simulator. */
  function run(net: FlatNetlist, bytes: number[], input = 0): FastSim {
    const pokes: Record<string, number> = {};
    bytes.forEach((v, k) => {
      for (let bit = 0; bit < 8; bit++) pokes[`ram/row${k}/b${bit}/Q`] = (v >> bit) & 1;
    });
    const sim = new FastSim(net, compile(net, { inputs: ["IN"] }), powerOn(net, pokes));
    sim.set("IN", input);
    for (let i = 0; i < 2000 && !sim.peek("halted"); i++) sim.tick();
    expect(sim.peek("halted")).toBe(1);
    return sim;
  }
  const ram = (sim: FastSim, k: number) => sim.peek(`ram/mem${k}`, 8);

  const cfg: CpuConfig = { ...V2_ALL, addrBits: 6 };
  const net = cpuNetlistFor(cfg);
  const io = ioMap(cfg);

  it("CALL / RET, LDR / STR and the IN port work at gate level", () => {
    expect([io.out, io.in]).toEqual([63, 62]);
    // 0: LDI R0,5   2: CALL 10   4: ST R0,[63]   6: HLT
    // 10: LDI R1,40  12: STR R0,[R1]  13: LDR R2,[R1]  14: ADD R0,R2  15: LD R3,[62]  17: ADD R0,R3  18: RET
    const prog = [0x10, 5, 0xe0, 10, 0x30, 63, 0x00, 0, 0, 0, 0x14, 40, 0x51, 0x49, 0x72, 0x2c, 62, 0x73, 0xf0];
    const sim = run(net, prog, 7);
    expect(sim.peek("OUT", 8)).toBe(5 + 5 + 7);
    expect(sim.peek("r2", 8)).toBe(5);
    expect(ram(sim, 40)).toBe(5);
    const sp = spInfo(cfg);
    expect(sim.peek("sp", sp.width)).toBe(sp.init); // balanced CALL / RET
    expect(ram(sim, sp.init)).toBe(3); // the pushed return slot: CALL's operand address
  });

  it("J<cc>: a countdown loop with JZ (cc = 01) and JMP (cc = 00)", () => {
    // 0: LDI R0,3  2: LDI R1,1  4: SUB R0,R1  5: JZ 9  7: JMP 4  9: ST R0,[63]  11: HLT
    const sim = run(net, [0x10, 3, 0x14, 1, 0x81, 0xd4, 9, 0xd0, 4, 0x30, 63, 0x00]);
    expect(sim.peek("OUT", 8)).toBe(0);
    expect(sim.peek("r0", 8)).toBe(0);
  });
});

describe("CLI wrapper", () => {
  it("tools/cost-model.mjs runs and reports the same numbers as estimate()", () => {
    const r = spawnSync(process.execPath, ["tools/cost-model.mjs", "--addr", "5", "--v2", "--json"], { cwd: SILICON, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    const want = estimate({ ...V2_ALL, addrBits: 5 });
    expect(out).toMatchObject({ gates: want.gates, layers: want.layers, variables: want.variables, plan: want.plan });
    const t = spawnSync(process.execPath, ["tools/cost-model.mjs", "--sweep", "4..5"], { cwd: SILICON, encoding: "utf8" });
    expect(t.status, t.stderr).toBe(0);
    expect(t.stdout).toContain("| 16 | v1 | 2285 | 808 |");
  });
});
