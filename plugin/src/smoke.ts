// Smoke test that runs INSIDE the Figma file through the Figma MCP `use_figma` tool
// (no plugin install needed). It uses the same binder, table reader, core and renderer
// as the plugin: bind the drawn machine, read the opcode table off the canvas, assemble
// a program, run it, and paint the final state (and screen) onto the canvas.
// Built by build.mjs into dist/use-figma-smoke.js (with the shipped programs, via smoke-entry.ts).
import { assemble, buildTable, Cpu, encodeVramPng, MEMORY, REGISTERS, Rtl, run, type TResult } from "./core";
import { bindMachine, findMachine, readRows } from "./figma/bind";
import { Renderer } from "./figma/render";

export interface SmokeOptions {
  page: string;
  /** Name for the report; also the key into `programs` when `source` is not given. */
  program: string;
  source?: string;
  /** "run": run to HLT (or maxInstructions) with the fast interpreter.
   *  "watch": run `instructions` whole instructions, then `tstates` single T-states, and show that T-state. */
  mode?: "run" | "watch";
  instructions?: number;
  tstates?: number;
  maxInstructions?: number;
  frames?: number;
}

export async function smoke(o: SmokeOptions, programs: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const page = figma.root.children.find((p) => p.name === o.page);
  if (!page) throw new Error(`no page named ${o.page}`);
  await figma.setCurrentPageAsync(page);
  const root = findMachine(page);
  if (!root) throw new Error(`no "Machine v2" frame on page ${o.page}`);

  const bound = await bindMachine(root);
  const { table, errors } = buildTable(readRows(bound));
  const src = o.source ?? programs[o.program];
  if (!src) throw new Error(`unknown program ${o.program}`);
  const asm = assemble(src, table);
  if (!asm.ok) return { ok: false, tableErrors: errors, asmErrors: asm.errors };

  const cpu = new Cpu();
  for (const c of asm.chunks) cpu.load(c.addr, c.bytes);
  cpu.pc = asm.entry;
  const rtl = new Rtl(cpu, () => table);
  let tres: TResult | null = null;

  if ((o.mode ?? "run") === "run") {
    const frames = o.frames ?? 0;
    if (frames > 0)
      for (let f = 0; f < frames && !cpu.halted; f++) {
        run(cpu, table, 5000);
        cpu.frame();
      }
    else run(cpu, table, o.maxInstructions ?? 200_000);
  } else {
    for (let i = 0; i < (o.instructions ?? 0); i++) {
      do rtl.step();
      while (rtl.midInstruction && !cpu.halted);
    }
    for (let i = 0; i < (o.tstates ?? 1); i++) tres = rtl.step() ?? tres;
  }

  const renderer = new Renderer(bound);
  renderer.render({ cpu, table, mode: tres ? "watch" : "instr", tres, pinBase: MEMORY.ramStart });
  const png = encodeVramPng(cpu.mem.subarray(MEMORY.vramStart, MEMORY.vramEnd + 1), 4);
  renderer.setScreen(figma.createImage(png).hash);
  figma.viewport.scrollAndZoomIntoView([root]);

  const lit = cpu.mem.subarray(MEMORY.vramStart, MEMORY.vramEnd + 1).reduce((n, b) => n + (b ? 1 : 0), 0);
  return {
    ok: !cpu.fault,
    page: page.name,
    program: o.program,
    tableRows: table.rows.length,
    tableErrors: errors,
    missingNodes: bound.missing,
    bytes: asm.size,
    halted: cpu.halted,
    fault: cpu.fault,
    instructions: cpu.instructions,
    tstates: cpu.tstates,
    regs: Object.fromEntries(REGISTERS.map((r, i) => [r, cpu.r[i]])),
    pc: cpu.pc,
    flags: { z: cpu.z, c: cpu.c, n: cpu.n },
    ram4000: Array.from(cpu.mem.subarray(0x4000, 0x4010)),
    litPixels: lit,
    tstate: tres ? { t: tres.t, phase: tres.phase, sigs: tres.sigs.map((s) => s.s), addr: tres.addrBus, data: tres.dataBus } : null,
    ms: Date.now() - t0,
  };
}
