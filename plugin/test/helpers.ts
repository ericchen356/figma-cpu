import { readFileSync } from "node:fs";
import { join } from "node:path";
import opcodes from "../../spec/opcodes.json";
import { assemble, buildTable, Cpu, type OpTable, type RowSource } from "../src/core";

export const specRows: RowSource[] = opcodes.opcodes;

export function specTable(rows: RowSource[] = specRows): OpTable {
  const { table, errors } = buildTable(rows);
  if (errors.length) throw new Error(JSON.stringify(errors));
  return table;
}

export function program(name: string): string {
  return readFileSync(join(__dirname, "..", "programs", `${name}.asm`), "utf8");
}

/** Assembles source and loads it into a fresh CPU. */
export function boot(src: string, table: OpTable = specTable()): Cpu {
  const res = assemble(src, table);
  if (!res.ok) throw new Error(res.errors.map((e) => `line ${e.line}: ${e.msg}`).join("\n"));
  const cpu = new Cpu();
  for (const c of res.chunks) cpu.load(c.addr, c.bytes);
  cpu.pc = res.entry;
  return cpu;
}

export const PROGRAMS = ["count", "fib", "rect", "bounce", "paint"];
