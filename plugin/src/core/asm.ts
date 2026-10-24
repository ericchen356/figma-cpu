// Two-pass assembler. Mnemonics and operand formats come from the opcode table
// (i.e. from the canvas), so renaming or renumbering a row changes the assembler too.
//
// Syntax:
//   label:  MNEM op, op        ; comment
//   .org expr | .equ NAME expr | .db expr|"str", ... | .dw expr, ... | .ds count
//   Registers: A B C D H L.  [HL] operands are optional sugar, [expr] means expr.
//   Expressions: + - * / % & | ^ << >> ~, parens, lo(x), hi(x),
//   numbers 42 0x2A $2A 0b101010 'c'.
import type { OpTable } from "./micro";
import { PREDEFINED_SYMBOLS, REGISTERS } from "./spec";

export interface AsmError {
  line: number;
  msg: string;
}

export interface Chunk {
  addr: number;
  bytes: number[];
}

export interface AsmResult {
  ok: boolean;
  errors: AsmError[];
  chunks: Chunk[];
  symbols: Record<string, number>;
  /** Address of the first byte emitted for each source line (1-based line numbers). */
  lineAddr: Record<number, number>;
  size: number;
  entry: number;
}

class AsmFail extends Error {}

// ---------- expressions ----------

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    const rest = src.slice(i);
    if ((m = rest.match(/^0x[0-9a-f]+/i)) || (m = rest.match(/^\$[0-9a-f]+/i))) {
      out.push({ t: "num", v: parseInt(m[0].replace(/^0x|^\$/i, ""), 16) });
    } else if ((m = rest.match(/^0b[01]+/i))) {
      out.push({ t: "num", v: parseInt(m[0].slice(2), 2) });
    } else if ((m = rest.match(/^[0-9]+/))) {
      out.push({ t: "num", v: parseInt(m[0], 10) });
    } else if ((m = rest.match(/^'(\\?.)'/))) {
      const c = m[1].length === 2 ? ({ n: 10, r: 13, t: 9, "0": 0 } as Record<string, number>)[m[1][1]] ?? m[1].charCodeAt(1) : m[1].charCodeAt(0);
      out.push({ t: "num", v: c });
    } else if ((m = rest.match(/^[A-Za-z_.][\w.]*/))) {
      out.push({ t: "id", v: m[0] });
    } else if ((m = rest.match(/^(<<|>>|[-+*/%&|^~()])/))) {
      out.push({ t: "op", v: m[0] });
    } else throw new AsmFail(`unexpected "${ch}" in expression`);
    i += m[0].length;
  }
  return out;
}

const BINOPS: Record<string, [number, (a: number, b: number) => number]> = {
  "|": [1, (a, b) => a | b],
  "^": [2, (a, b) => a ^ b],
  "&": [3, (a, b) => a & b],
  "<<": [4, (a, b) => a << b],
  ">>": [4, (a, b) => a >> b],
  "+": [5, (a, b) => a + b],
  "-": [5, (a, b) => a - b],
  "*": [6, (a, b) => a * b],
  "/": [6, (a, b) => {
    if (b === 0) throw new AsmFail("division by zero");
    return Math.trunc(a / b);
  }],
  "%": [6, (a, b) => {
    if (b === 0) throw new AsmFail("division by zero");
    return a % b;
  }],
};

/** Evaluates an expression. Unknown symbols throw, unless `lenient` (pass 1), where they read as 0. */
export function evaluate(src: string, symbols: Record<string, number>, lenient = false): number {
  const toks = lex(src);
  if (toks.length === 0) throw new AsmFail("missing value");
  let p = 0;
  const peek = () => toks[p];

  const primary = (): number => {
    const tok = toks[p++];
    if (!tok) throw new AsmFail(`incomplete expression "${src}"`);
    if (tok.t === "num") return tok.v;
    if (tok.t === "id") {
      const fn = tok.v.toLowerCase();
      if ((fn === "lo" || fn === "hi") && peek()?.t === "op" && peek()!.v === "(") {
        p++;
        const v = expr(0);
        expectClose();
        return fn === "lo" ? v & 0xff : (v >> 8) & 0xff;
      }
      if (tok.v in symbols) return symbols[tok.v];
      if (lenient) return 0;
      throw new AsmFail(`unknown symbol "${tok.v}"`);
    }
    if (tok.v === "(") {
      const v = expr(0);
      expectClose();
      return v;
    }
    if (tok.v === "-") return -primary();
    if (tok.v === "+") return primary();
    if (tok.v === "~") return ~primary();
    throw new AsmFail(`unexpected "${tok.v}"`);
  };
  const expectClose = () => {
    const tok = toks[p++];
    if (!tok || tok.v !== ")") throw new AsmFail(`missing ")" in "${src}"`);
  };
  const expr = (minPrec: number): number => {
    let left = primary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== "op" || !(tok.v in BINOPS)) break;
      const [prec, fn] = BINOPS[tok.v];
      if (prec < minPrec) break;
      p++;
      left = fn(left, expr(prec + 1));
    }
    return left;
  };
  const v = expr(0);
  if (p < toks.length) throw new AsmFail(`unexpected "${(toks[p] as { v: unknown }).v}" in "${src}"`);
  return v;
}

// ---------- lines ----------

function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === "\\") i++;
      else if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === ";") return line.slice(0, i);
  }
  return line;
}

function splitOperands(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === "\\") cur += s[++i] ?? "";
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseString(s: string): number[] {
  const body = s.slice(1, -1);
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") {
      const e = body[++i];
      out.push(({ n: 10, r: 13, t: 9, "0": 0 } as Record<string, number>)[e] ?? e.charCodeAt(0));
    } else out.push(body.charCodeAt(i) & 0xff);
  }
  return out;
}

interface Line {
  no: number;
  label?: string;
  op?: string;
  args: string[];
}

function parseLines(src: string): Line[] {
  return src.split(/\r?\n/).map((raw, i) => {
    let s = stripComment(raw).trim();
    const line: Line = { no: i + 1, args: [] };
    const lm = s.match(/^([A-Za-z_][\w]*)\s*:/);
    if (lm) {
      line.label = lm[1];
      s = s.slice(lm[0].length).trim();
    }
    if (s) {
      const om = s.match(/^(\.?[A-Za-z_][\w]*)\s*(.*)$/);
      if (!om) throw new AsmFail(`cannot parse "${s}"`);
      line.op = om[1];
      line.args = splitOperands(om[2]);
    }
    return line;
  });
}

const isReg = (s: string) => REGISTERS.includes(s.trim().toUpperCase());

function regNum(s: string | undefined): number {
  const i = REGISTERS.indexOf((s || "").trim().toUpperCase());
  if (i < 0) throw new AsmFail(`expected a register (${REGISTERS.join(" ")}), got "${s ?? ""}"`);
  return i;
}

/** Removes [HL] sugar and unwraps [expr]. */
function normalizeOperands(args: string[]): string[] {
  return args
    .filter((a) => a.replace(/\s+/g, "").toUpperCase() !== "[HL]")
    .map((a) => (/^\[.*\]$/.test(a) ? a.slice(1, -1).trim() : a));
}

function checkRange(v: number, bits: 8 | 16, what: string): number {
  const max = bits === 8 ? 0xff : 0xffff;
  if (v < -(max + 1) / 2 || v > max) throw new AsmFail(`${what} ${v} does not fit in ${bits} bits`);
  return v & max;
}

function encode(fmt: string, op: number, args: string[], val: (e: string, b: 8 | 16, w: string) => number): number[] {
  const need = (n: number) => {
    if (args.length !== n) throw new AsmFail(`expects ${n} operand${n === 1 ? "" : "s"} (format ${fmt}), got ${args.length}`);
  };
  switch (fmt) {
    case "-":
      need(0);
      return [op];
    case "r":
      need(1);
      return [op, regNum(args[0]) << 4];
    case "r,r":
      need(2);
      return [op, (regNum(args[0]) << 4) | regNum(args[1])];
    case "r,i8":
      need(2);
      return [op, regNum(args[0]) << 4, val(args[1], 8, "immediate")];
    case "r,a16": {
      need(2);
      const a = val(args[1], 16, "address");
      return [op, regNum(args[0]) << 4, a & 0xff, a >> 8];
    }
    case "i16":
    case "a16": {
      need(1);
      const a = val(args[0], 16, fmt === "i16" ? "immediate" : "address");
      return [op, a & 0xff, a >> 8];
    }
  }
  throw new AsmFail(`unknown format ${fmt}`);
}

export function assemble(src: string, table: OpTable, predefined: Record<string, number> = PREDEFINED_SYMBOLS): AsmResult {
  const errors: AsmError[] = [];
  const symbols: Record<string, number> = { ...predefined };
  let lines: Line[] = [];
  try {
    lines = parseLines(src);
  } catch (e) {
    return { ok: false, errors: [{ line: 0, msg: (e as Error).message }], chunks: [], symbols, lineAddr: {}, size: 0, entry: 0 };
  }

  const sizeOf = (line: Line, pc: number, pass: 1 | 2, emit: (b: number[]) => void, val: (e: string, b: 8 | 16, w: string) => number): number => {
    const op = line.op!;
    const dir = op.toLowerCase();
    if (dir === ".db") {
      const bytes: number[] = [];
      for (const a of line.args) {
        if (/^".*"$/.test(a)) bytes.push(...parseString(a));
        else bytes.push(pass === 2 ? val(a, 8, "byte") : 0);
      }
      emit(bytes);
      return bytes.length;
    }
    if (dir === ".dw") {
      const bytes: number[] = [];
      for (const a of line.args) {
        const v = pass === 2 ? val(a, 16, "word") : 0;
        bytes.push(v & 0xff, v >> 8);
      }
      emit(bytes);
      return bytes.length;
    }
    if (dir === ".ds") {
      const n = evaluate(line.args[0] ?? "", symbols);
      emit(new Array(n).fill(0));
      return n;
    }
    if (dir.startsWith(".")) throw new AsmFail(`unknown directive ${op}`);
    const row = table.byMnem.get(op.toUpperCase());
    if (!row) throw new AsmFail(`unknown instruction "${op}" (not in the opcode table)`);
    const args = normalizeOperands(line.args);
    const bytes = encode(row.fmt, row.op, args, pass === 2 ? val : () => 0);
    emit(bytes);
    return bytes.length;
  };

  // Pass 1: addresses of labels.
  let pc = 0;
  let entry: number | null = null;
  for (const line of lines) {
    try {
      if (line.label) {
        if (isReg(line.label)) throw new AsmFail(`"${line.label}" is a register name`);
        if (line.label in symbols && !(line.label in predefined)) throw new AsmFail(`label "${line.label}" defined twice`);
        symbols[line.label] = pc;
      }
      if (!line.op) continue;
      const dir = line.op.toLowerCase();
      if (dir === ".org") {
        pc = evaluate(line.args[0] ?? "", symbols) & 0xffff;
        if (line.label) symbols[line.label] = pc;
        continue;
      }
      if (dir === ".equ") {
        const [name, ...rest] = line.args.length === 1 ? line.args[0].split(/\s+/) : line.args;
        if (!name || rest.length === 0) throw new AsmFail(".equ NAME value");
        symbols[name] = evaluate(rest.join(" "), symbols, true);
        continue;
      }
      if (entry === null && !dir.startsWith(".")) entry = pc;
      pc += sizeOf(line, pc, 1, () => {}, () => 0);
    } catch (e) {
      errors.push({ line: line.no, msg: (e as Error).message });
    }
  }

  // Re-evaluate .equ now that every label is known.
  for (const line of lines) {
    if (line.op?.toLowerCase() !== ".equ") continue;
    try {
      const [name, ...rest] = line.args.length === 1 ? line.args[0].split(/\s+/) : line.args;
      if (name && rest.length) symbols[name] = evaluate(rest.join(" "), symbols);
    } catch (e) {
      errors.push({ line: line.no, msg: (e as Error).message });
    }
  }

  // Pass 2: emit bytes.
  const chunks: Chunk[] = [];
  const lineAddr: Record<number, number> = {};
  let cur: Chunk | null = null;
  pc = 0;
  for (const line of lines) {
    if (!line.op) continue;
    const dir = line.op.toLowerCase();
    try {
      if (dir === ".org") {
        pc = evaluate(line.args[0] ?? "", symbols) & 0xffff;
        cur = null;
        continue;
      }
      if (dir === ".equ") continue;
      const val = (e: string, bits: 8 | 16, what: string) => checkRange(evaluate(e, symbols), bits, what);
      lineAddr[line.no] = pc;
      pc += sizeOf(line, pc, 2, (bytes) => {
        if (!bytes.length) return;
        if (!cur || cur.addr + cur.bytes.length !== pc) {
          cur = { addr: pc, bytes: [] };
          chunks.push(cur);
        }
        cur.bytes.push(...bytes);
      }, val);
    } catch (e) {
      if (!errors.some((x) => x.line === line.no)) errors.push({ line: line.no, msg: (e as Error).message });
    }
  }

  errors.sort((a, b) => a.line - b.line);
  const size = chunks.reduce((n, c) => n + c.bytes.length, 0);
  return { ok: errors.length === 0, errors, chunks, symbols, lineAddr, size, entry: entry ?? 0 };
}
