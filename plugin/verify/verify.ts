// End-to-end check inside Figma, run through the Figma MCP `use_figma` tool (no plugin UI,
// no pluginData). It binds to the real Machine v2, reads the opcode table off the canvas,
// runs rect.asm on the table-driven CPU, freezes it mid-draw on a pixel store, renders
// that EXEC phase onto the machine and paints VRAM onto dev/screen.
import palette from "../../spec/palette.json";
import { bind, readTableRows } from "../src/binder";
import { CPU, SCREEN_H, SCREEN_W, Trace, VRAM_START } from "../src/cpu";
import { encodePng } from "../src/png";
import { Renderer } from "../src/render";
import { parseTable } from "../src/table";

declare const __SEGMENTS__: { start: number; bytes: number[] }[];
declare const __STOP_AT__: number;

export async function run(): Promise<string> {
  const report: Record<string, unknown> = {};
  const { bound, missing } = await bind();
  if (!bound)
    return JSON.stringify({ bind: "FAILED", missing: missing.slice(0, 40) });
  report.bind = "ok";

  const { rows, errors } = readTableRows(bound);
  const { table, errors: tableErrors } = parseTable(rows);
  report.table = {
    rows: rows.length,
    instructions: table.byMnem.size,
    errors: [...errors, ...tableErrors],
  };

  // full run: how fast is the table-driven CPU in Figma's JS sandbox?
  const full = new CPU(table);
  full.load(__SEGMENTS__);
  const t0 = Date.now();
  while (!full.halted && full.cycles < 500000) full.step();
  const ms = Math.max(1, Date.now() - t0);
  report.fullRun = {
    cycles: full.cycles,
    ms,
    ips: Math.round((full.cycles * 1000) / ms),
    halted: full.halted,
    error: full.error,
  };

  // snapshot run: stop mid-drawing on a pixel store so the canvas shows a memory write
  const cpu = new CPU(table);
  cpu.load(__SEGMENTS__);
  while (!cpu.halted && cpu.cycles < __STOP_AT__) cpu.step();
  const st = table.byMnem.get("ST")?.op;
  while (!cpu.halted && cpu.mem[cpu.pc] !== st) cpu.step();
  const tr = new Trace();
  cpu.step(tr);
  report.snapshot = {
    cycles: cpu.cycles,
    pc: cpu.pc,
    op: tr.mnem,
    wrote: tr.accesses.filter((a) => a.kind === "w"),
  };

  const r = new Renderer(bound);
  const frameById = new Map(rows.map((row) => [row.where, row.frame]));
  for (const e of table.entries)
    if (e) r.rows.set(e.op, frameById.get(e.where)!);
  const t1 = Date.now();
  r.renderExec(cpu, tr);
  const t2 = Date.now();
  r.renderExec(cpu, tr); // second pass: everything cached, measures the diff overhead
  report.render = { firstMs: t2 - t1, cachedMs: Date.now() - t2 };

  try {
    const pixels = cpu.mem.slice(VRAM_START, VRAM_START + SCREEN_W * SCREEN_H);
    const png = encodePng(pixels, SCREEN_W, SCREEN_H, palette.colors, 6);
    const image = figma.createImage(png);
    bound.screen.fills = [
      { type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" },
    ];
    report.screen = {
      pngBytes: png.length,
      litPixels: pixels.filter((p) => p !== 0).length,
    };
  } catch (e) {
    report.screen = `failed: ${(e as Error).message}`;
  }
  report.machineFrame = bound.root.id;
  return JSON.stringify(report);
}
