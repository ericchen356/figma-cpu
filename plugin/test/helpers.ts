import { readFileSync } from "node:fs";
import { join } from "node:path";
import spec from "../../spec/opcodes.json";
import { assemble } from "../src/assembler";
import { CPU } from "../src/cpu";
import { parseTable, type TableRow } from "../src/table";

export const PROGRAM_DIR = join(__dirname, "..", "programs");
export const LIBS = ["hw.asm", "gfx.asm"];

export function specRows(): TableRow[] {
  return spec.opcodes.map((o) => ({ ...o }));
}

export function specTable(rows = specRows()) {
  const { table, errors } = parseTable(rows);
  if (errors.length) throw new Error(errors.join("\n"));
  return table;
}

export function readProgram(name: string): string {
  return readFileSync(join(PROGRAM_DIR, name), "utf8");
}

export function includes(): Record<string, string> {
  return Object.fromEntries(LIBS.map((n) => [n, readProgram(n)]));
}

/** Assembles `source` (throwing on errors) and returns a CPU with it loaded. */
export function boot(source: string, table = specTable()): CPU {
  const res = assemble(source, table, { includes: includes() });
  if (!res.ok)
    throw new Error(
      res.errors.map((e) => `${e.file}:${e.line}: ${e.message}`).join("\n"),
    );
  const cpu = new CPU(table);
  cpu.load(res.segments);
  return cpu;
}

export function run(cpu: CPU, maxSteps = 1_000_000): number {
  let n = 0;
  while (!cpu.halted && n < maxSteps) {
    cpu.step();
    n++;
  }
  if (cpu.error) throw new Error(cpu.error);
  return n;
}
