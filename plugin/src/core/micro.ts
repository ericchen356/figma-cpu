// Parses the opcode table (op | mnem | fmt | micro) into executable micro-op lists.
// The micro-op vocabulary below is the ONLY behavior defined in code; which opcode does
// what is data, read from the canvas.
import { FORMATS, FORMAT_OPERAND_BYTES, REGISTERS } from "./spec";

export type AluOp = "ADD" | "SUB" | "AND" | "OR" | "XOR" | "CMP" | "INC" | "DEC" | "SHL" | "SHR";
export const BINARY_ALU: AluOp[] = ["ADD", "SUB", "AND", "OR", "XOR", "CMP"];
export const UNARY_ALU: AluOp[] = ["INC", "DEC", "SHL", "SHR"];

export type Cond = "Z" | "NZ" | "C" | "NC" | "N" | "NN";
const CONDS: Cond[] = ["Z", "NZ", "C", "NC", "N", "NN"];

/** A register operand: decoded from the OPR byte (rd = high nibble, rs = low nibble) or fixed. */
export type RegRef = { kind: "rd" } | { kind: "rs" } | { kind: "fixed"; index: number };
export type Ptr = "HL" | "W";

export type Micro =
  | { k: "REG" }
  | { k: "IMM8" }
  | { k: "IMM16" }
  | { k: "SET"; d: RegRef }
  | { k: "COPY"; d: RegRef; s: RegRef }
  | { k: "LOAD"; d: RegRef; ptr: Ptr }
  | { k: "STORE"; s: RegRef; ptr: Ptr }
  | { k: "SETHL" }
  | { k: "INCHL" }
  | { k: "ALU"; op: AluOp; d: RegRef; s?: RegRef }
  | { k: "JUMP"; cond: Cond | null }
  | { k: "PUSH"; s: RegRef }
  | { k: "POP"; d: RegRef }
  | { k: "PUSHPC" }
  | { k: "POPPC" }
  | { k: "HALT" };

export interface RowSource {
  op: string;
  mnem: string;
  fmt: string;
  micro: string;
}

export interface OpRow {
  op: number;
  mnem: string;
  fmt: string;
  micro: Micro[];
  /** The micro-op source split per step, for highlighting the current step. */
  steps: string[];
}

export interface OpTable {
  byOp: (OpRow | undefined)[];
  byMnem: Map<string, OpRow>;
  rows: OpRow[];
}

export interface TableError {
  row: string;
  msg: string;
}

export class MicroError extends Error {}

function parseReg(tok: string | undefined, where: string): RegRef {
  if (!tok) throw new MicroError(`${where}: missing register`);
  const t = tok.toLowerCase();
  if (t === "rd") return { kind: "rd" };
  if (t === "rs") return { kind: "rs" };
  const index = REGISTERS.indexOf(tok.toUpperCase());
  if (index < 0) throw new MicroError(`${where}: "${tok}" is not rd, rs or a register`);
  return { kind: "fixed", index };
}

function parsePtr(tok: string | undefined, where: string): Ptr {
  const t = (tok || "").toUpperCase();
  if (t === "HL" || t === "W") return t;
  throw new MicroError(`${where}: address must be HL or W, got "${tok ?? ""}"`);
}

function arity(parts: string[], n: number, where: string) {
  if (parts.length - 1 !== n)
    throw new MicroError(`${where} takes ${n} operand${n === 1 ? "" : "s"}`);
}

/** Splits the micro column into steps. Empty, "-" and "—" mean no micro-ops. */
export function splitSteps(src: string): string[] {
  const s = src.trim();
  if (s === "" || s === "-" || s === "—") return [];
  return s
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function parseStep(step: string): Micro {
  const parts = step.split(/\s+/);
  const name = parts[0].toUpperCase();
  switch (name) {
    case "REG":
    case "IMM8":
    case "IMM16":
    case "SETHL":
    case "INCHL":
    case "PUSHPC":
    case "POPPC":
    case "HALT":
      if (name === "SETHL") {
        arity(parts, 1, name);
        if (parts[1].toUpperCase() !== "W") throw new MicroError("SETHL only takes W");
      } else arity(parts, 0, name);
      return { k: name } as Micro;
    case "SET":
      arity(parts, 2, name);
      if (parts[2].toUpperCase() !== "T") throw new MicroError("SET copies from T: SET <reg> T");
      return { k: "SET", d: parseReg(parts[1], name) };
    case "COPY":
      arity(parts, 2, name);
      return { k: "COPY", d: parseReg(parts[1], name), s: parseReg(parts[2], name) };
    case "LOAD":
      arity(parts, 2, name);
      return { k: "LOAD", d: parseReg(parts[1], name), ptr: parsePtr(parts[2], name) };
    case "STORE":
      arity(parts, 2, name);
      return { k: "STORE", s: parseReg(parts[1], name), ptr: parsePtr(parts[2], name) };
    case "ALU": {
      const op = (parts[1] || "").toUpperCase() as AluOp;
      if (BINARY_ALU.includes(op)) {
        arity(parts, 3, "ALU " + op);
        return { k: "ALU", op, d: parseReg(parts[2], name), s: parseReg(parts[3], name) };
      }
      if (UNARY_ALU.includes(op)) {
        arity(parts, 2, "ALU " + op);
        return { k: "ALU", op, d: parseReg(parts[2], name) };
      }
      throw new MicroError(`unknown ALU op "${parts[1] ?? ""}"`);
    }
    case "JUMP": {
      if (parts.length < 2 || parts.length > 3 || parts[1].toUpperCase() !== "W")
        throw new MicroError("JUMP W [Z|NZ|C|NC|N|NN]");
      if (parts.length === 2) return { k: "JUMP", cond: null };
      const cond = parts[2].toUpperCase() as Cond;
      if (!CONDS.includes(cond)) throw new MicroError(`unknown condition "${parts[2]}"`);
      return { k: "JUMP", cond };
    }
    case "PUSH":
      arity(parts, 1, name);
      return { k: "PUSH", s: parseReg(parts[1], name) };
    case "POP":
      arity(parts, 1, name);
      return { k: "POP", d: parseReg(parts[1], name) };
    default:
      throw new MicroError(`unknown micro-op "${parts[0]}"`);
  }
}

/** Operand bytes a micro-op list reads from the instruction stream. */
export function operandBytesRead(micro: Micro[]): number {
  let n = 0;
  for (const m of micro) n += m.k === "IMM16" ? 2 : m.k === "REG" || m.k === "IMM8" ? 1 : 0;
  return n;
}

export function parseRow(src: RowSource): OpRow {
  const opText = src.op.trim();
  if (!/^[0-9a-fA-F]{1,2}$/.test(opText)) throw new MicroError(`op "${src.op}" is not a hex byte`);
  const mnem = src.mnem.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*$/.test(mnem)) throw new MicroError(`mnemonic "${src.mnem}" is invalid`);
  const fmt = src.fmt.trim();
  if (!FORMATS.includes(fmt)) throw new MicroError(`format "${src.fmt}" must be one of ${FORMATS.join(" ")}`);
  const steps = splitSteps(src.micro);
  const micro = steps.map((s, i) => {
    try {
      return parseStep(s);
    } catch (e) {
      throw new MicroError(`step ${i + 1} "${s}": ${(e as Error).message}`);
    }
  });
  const read = operandBytesRead(micro);
  const encoded = FORMAT_OPERAND_BYTES[fmt];
  if (read !== encoded)
    throw new MicroError(`micro-ops read ${read} operand byte(s) but format "${fmt}" encodes ${encoded}`);
  return { op: parseInt(opText, 16), mnem, fmt, micro, steps };
}

/** Builds the decoder from table rows. Bad rows are skipped and reported, never fatal. */
export function buildTable(sources: RowSource[]): { table: OpTable; errors: TableError[] } {
  const byOp: (OpRow | undefined)[] = new Array(256);
  const byMnem = new Map<string, OpRow>();
  const rows: OpRow[] = [];
  const errors: TableError[] = [];
  for (const src of sources) {
    const label = `${src.op.trim() || "??"} ${src.mnem.trim()}`;
    let row: OpRow;
    try {
      row = parseRow(src);
    } catch (e) {
      errors.push({ row: label, msg: (e as Error).message });
      continue;
    }
    if (byOp[row.op]) {
      errors.push({ row: label, msg: `opcode ${src.op} is already used by ${byOp[row.op]!.mnem}` });
      continue;
    }
    if (byMnem.has(row.mnem)) {
      errors.push({ row: label, msg: `mnemonic ${row.mnem} appears twice` });
      continue;
    }
    byOp[row.op] = row;
    byMnem.set(row.mnem, row);
    rows.push(row);
  }
  return { table: { byOp, byMnem, rows }, errors };
}
