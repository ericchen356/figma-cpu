// Two-pass assembler. Mnemonics, opcodes and operand formats come from the decode
// table (i.e. from the canvas), so renumbering a row on the canvas re-targets programs.
//
// Syntax:
//   label:  MNEM op, op      ; comment
//   .org expr                ; set the address
//   .db expr|"text", ...     ; bytes
//   .dw expr, ...            ; little-endian words
//   .equ NAME, expr          ; constant (also: NAME = expr)
//   .include "file.asm"
// Expressions: 10, 0x1F, $1F, 0b101, 'a', labels, + - * / % & | ^ << >> ~, lo(x), hi(x)
import { FMT_SIZE, REG_NAMES, type DecodeTable } from "./table";

export interface AsmError {
  file: string;
  line: number;
  message: string;
}

export interface Segment {
  start: number;
  bytes: number[];
}

export interface ListingLine {
  addr: number;
  bytes: number[];
  file: string;
  line: number;
  text: string;
}

export interface AsmResult {
  ok: boolean;
  errors: AsmError[];
  segments: Segment[];
  symbols: Map<string, number>;
  listing: ListingLine[];
  size: number;
}

export interface AsmOptions {
  file?: string;
  includes?: Record<string, string>;
}

interface SrcLine {
  file: string;
  line: number;
  text: string;
}

interface Stmt extends SrcLine {
  label?: string;
  op?: string;
  args: string[];
  addr: number;
}

class AsmFail extends Error {}
class Undefined extends Error {}

function stripComment(s: string): string {
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ";") return s.slice(0, i);
  }
  return s;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

function expandIncludes(
  source: string,
  file: string,
  includes: Record<string, string>,
  errors: AsmError[],
  stack: string[] = [],
): SrcLine[] {
  const out: SrcLine[] = [];
  source.split(/\r?\n/).forEach((text, i) => {
    const m = /^\s*\.include\s+"([^"]+)"/i.exec(stripComment(text));
    if (!m) {
      out.push({ file, line: i + 1, text });
      return;
    }
    const name = m[1];
    if (stack.includes(name))
      errors.push({
        file,
        line: i + 1,
        message: `circular .include "${name}"`,
      });
    else if (!(name in includes))
      errors.push({ file, line: i + 1, message: `unknown include "${name}"` });
    else
      out.push(
        ...expandIncludes(includes[name], name, includes, errors, [
          ...stack,
          file,
        ]),
      );
  });
  return out;
}

// ---- expressions ----

function tokenize(expr: string): string[] {
  const re =
    /\s*(0x[0-9a-f]+|\$[0-9a-f]+|0b[01]+|\d+|'(?:\\.|[^'])'|[A-Za-z_.][\w.]*|<<|>>|[-+*/%&|^~()])/iy;
  const out: string[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(expr);
    if (!m) throw new AsmFail(`can't parse "${expr.slice(i)}"`);
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

export function evaluate(expr: string, symbols: Map<string, number>): number {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const take = (t?: string) => {
    const tok = toks[p++];
    if (t !== undefined && tok !== t)
      throw new AsmFail(`expected "${t}" in "${expr}"`);
    return tok;
  };
  const levels: string[][] = [
    ["|"],
    ["^"],
    ["&"],
    ["<<", ">>"],
    ["+", "-"],
    ["*", "/", "%"],
  ];
  const binary = (level: number): number => {
    if (level === levels.length) return unary();
    let v = binary(level + 1);
    while (levels[level].includes(peek())) {
      const op = take();
      const r = binary(level + 1);
      switch (op) {
        case "|":
          v |= r;
          break;
        case "^":
          v ^= r;
          break;
        case "&":
          v &= r;
          break;
        case "<<":
          v <<= r;
          break;
        case ">>":
          v >>= r;
          break;
        case "+":
          v += r;
          break;
        case "-":
          v -= r;
          break;
        case "*":
          v *= r;
          break;
        case "/":
          if (r === 0) throw new AsmFail("division by zero");
          v = Math.trunc(v / r);
          break;
        default:
          if (r === 0) throw new AsmFail("division by zero");
          v %= r;
      }
    }
    return v;
  };
  const unary = (): number => {
    const t = peek();
    if (t === "-") return (take(), -unary());
    if (t === "+") return (take(), unary());
    if (t === "~") return (take(), ~unary() & 0xffff);
    return primary();
  };
  const primary = (): number => {
    const t = take();
    if (t === undefined) throw new AsmFail(`unexpected end of "${expr}"`);
    if (t === "(") {
      const v = binary(0);
      take(")");
      return v;
    }
    if (/^0x/i.test(t)) return parseInt(t.slice(2), 16);
    if (t[0] === "$") return parseInt(t.slice(1), 16);
    if (/^0b/i.test(t)) return parseInt(t.slice(2), 2);
    if (/^\d/.test(t)) return parseInt(t, 10);
    if (t[0] === "'")
      return t.length === 4
        ? JSON.parse(`"${t.slice(1, -1)}"`).charCodeAt(0)
        : t.charCodeAt(1);
    const fn = t.toLowerCase();
    if ((fn === "lo" || fn === "hi") && peek() === "(") {
      take("(");
      const v = binary(0);
      take(")");
      return fn === "lo" ? v & 0xff : (v >> 8) & 0xff;
    }
    const v = symbols.get(t);
    if (v === undefined) throw new Undefined(`undefined symbol "${t}"`);
    return v;
  };
  const v = binary(0);
  if (p !== toks.length)
    throw new AsmFail(`unexpected "${toks[p]}" in "${expr}"`);
  return v;
}

// ---- assembler ----

function parseLine(src: SrcLine): Omit<Stmt, "addr"> {
  let text = stripComment(src.text).trim();
  const stmt: Omit<Stmt, "addr"> = { ...src, args: [] };
  const label = /^([A-Za-z_.][\w.]*)\s*:/.exec(text);
  if (label) {
    stmt.label = label[1];
    text = text.slice(label[0].length).trim();
  }
  const assign = /^([A-Za-z_][\w.]*)\s*=\s*(.+)$/.exec(text);
  if (assign) {
    stmt.op = ".EQU";
    stmt.args = [assign[1], assign[2]];
    return stmt;
  }
  const m = /^(\.?[A-Za-z][\w]*)\s*(.*)$/.exec(text);
  if (text && !m) throw new AsmFail(`can't parse "${text}"`);
  if (m) {
    stmt.op = m[1].toUpperCase();
    stmt.args = splitArgs(m[2]);
  }
  return stmt;
}

function dbSize(args: string[]): number {
  return args.reduce((n, a) => n + (a.startsWith('"') ? a.length - 2 : 1), 0);
}

function reg(arg: string | undefined): number {
  const i = REG_NAMES.indexOf((arg ?? "").toUpperCase());
  if (i < 0)
    throw new AsmFail(
      `expected a register (${REG_NAMES.join(" ")}), got "${arg ?? ""}"`,
    );
  return i;
}

export function assemble(
  source: string,
  table: DecodeTable,
  opts: AsmOptions = {},
): AsmResult {
  const file = opts.file ?? "main.asm";
  const errors: AsmError[] = [];
  const symbols = new Map<string, number>();
  const lines = expandIncludes(source, file, opts.includes ?? {}, errors);
  const fail = (s: SrcLine, e: unknown) => {
    if (e instanceof AsmFail || e instanceof Undefined)
      errors.push({ file: s.file, line: s.line, message: e.message });
    else throw e;
  };

  // pass 1: addresses and constants
  const stmts: Stmt[] = [];
  let pc = 0;
  for (const src of lines) {
    let s: Stmt | undefined;
    try {
      s = { ...parseLine(src), addr: pc };
      stmts.push(s);
      if (s.label) {
        if (symbols.has(s.label))
          throw new AsmFail(`"${s.label}" is already defined`);
        symbols.set(s.label, pc);
      }
      if (!s.op) continue;
      switch (s.op) {
        case ".ORG":
          if (s.args.length !== 1) throw new AsmFail(".org takes one address");
          pc = evaluate(s.args[0], symbols);
          if (pc < 0 || pc > 0xffff)
            throw new AsmFail(`.org address ${pc} out of range`);
          s.addr = pc;
          break;
        case ".EQU": {
          if (s.args.length !== 2) throw new AsmFail(".equ takes NAME, value");
          const name = s.args[0];
          if (symbols.has(name))
            throw new AsmFail(`"${name}" is already defined`);
          symbols.set(name, evaluate(s.args[1], symbols));
          break;
        }
        case ".DB":
          pc += dbSize(s.args);
          break;
        case ".DW":
          pc += 2 * s.args.length;
          break;
        default: {
          const entry = table.byMnem.get(s.op);
          if (!entry) throw new AsmFail(`unknown instruction "${s.op}"`);
          pc += FMT_SIZE[entry.fmt];
        }
      }
      if (pc > 0x10000) throw new AsmFail("program runs past FFFF");
    } catch (e) {
      fail(src, e);
      if (s) s.op = undefined; // already reported; don't encode it in pass 2
    }
  }

  // pass 2: encode
  const image = new Map<number, number>();
  const listing: ListingLine[] = [];
  for (const s of stmts) {
    if (!s.op || s.op === ".ORG" || s.op === ".EQU") continue;
    try {
      const bytes: number[] = [];
      const val = (expr: string, min: number, max: number) => {
        const v = evaluate(expr, symbols);
        if (v < min || v > max)
          throw new AsmFail(`${expr} = ${v} is out of range ${min}..${max}`);
        return v;
      };
      const word = (v: number) => bytes.push(v & 0xff, (v >> 8) & 0xff);
      if (s.op === ".DB") {
        for (const a of s.args) {
          if (a.startsWith('"'))
            for (const ch of JSON.parse(a) as string)
              bytes.push(ch.charCodeAt(0) & 0xff);
          else bytes.push(val(a, -128, 255) & 0xff);
        }
      } else if (s.op === ".DW") {
        for (const a of s.args) word(val(a, -32768, 0xffff));
      } else {
        const e = table.byMnem.get(s.op)!;
        const want = e.fmt === "-" ? 0 : e.fmt.split(",").length;
        if (s.args.length !== want)
          throw new AsmFail(
            `${e.mnem} takes ${want} operand(s) (${e.fmt}), got ${s.args.length}`,
          );
        bytes.push(e.op);
        switch (e.fmt) {
          case "r":
            bytes.push(reg(s.args[0]) << 4);
            break;
          case "r,r":
            bytes.push((reg(s.args[0]) << 4) | reg(s.args[1]));
            break;
          case "r,i8":
            bytes.push(reg(s.args[0]) << 4, val(s.args[1], -128, 255) & 0xff);
            break;
          case "r,a16":
            bytes.push(reg(s.args[0]) << 4);
            word(val(s.args[1], 0, 0xffff));
            break;
          case "i16":
          case "a16":
            word(val(s.args[0], 0, 0xffff));
            break;
        }
      }
      bytes.forEach((b, i) => {
        const at = s.addr + i;
        if (image.has(at))
          throw new AsmFail(
            `overlaps code already at ${at.toString(16).toUpperCase()}`,
          );
        image.set(at, b);
      });
      listing.push({
        addr: s.addr,
        bytes,
        file: s.file,
        line: s.line,
        text: s.text.trim(),
      });
    } catch (e) {
      fail(s, e);
    }
  }

  const segments: Segment[] = [];
  for (const addr of [...image.keys()].sort((a, b) => a - b)) {
    const last = segments[segments.length - 1];
    if (last && last.start + last.bytes.length === addr)
      last.bytes.push(image.get(addr)!);
    else segments.push({ start: addr, bytes: [image.get(addr)!] });
  }
  return {
    ok: errors.length === 0,
    errors,
    segments,
    symbols,
    listing,
    size: image.size,
  };
}
