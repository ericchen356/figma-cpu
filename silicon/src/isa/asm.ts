// Two-pass assembler for the handoff ISA. Mnemonics, operand order and the encoding all come
// from OPCODES in ./spec, so changing a row there changes the assembler too.
//
// Syntax: one statement per line, `;` starts a comment. Mnemonics and registers are
// case-insensitive; symbols (labels) are case-sensitive.
//   label:  MNEM op, op
//   .org expr            the next byte goes to address expr (0–63)
//   .db expr, ...        raw bytes
// Operands, by kind (OpcodeSpec.operands):
//   Rd, Rs   R0–R3; Rd → bits 3:2, Rs → bits 1:0 of the instruction byte
//   [Rd], [Rs]  the same fields written as a pointer, e.g. LDR R0, [R1] (brackets required)
//   [Rs+]    a pointer the instruction steps afterwards, e.g. LDRI R0, [R1+]
//   imm      expr, −128…255 (negatives stored as two's complement) → 2nd byte
//   addr     [expr] or expr, 0–63 → 2nd byte
// Expressions: numbers 42 0x2A 0b101010 'c', symbols (labels; OUT = 63 and IN = 62 are
// predefined), unary −, binary + and −, parentheses.
// NOP is not an opcode (its code is LDRI's): it assembles as MOV R0, R0, the same 4-tick no-op.
import { IN_ADDR, OPCODES, type OpcodeSpec, OUT_ADDR, RAM_BYTES, REGISTERS } from "./spec";

export interface AsmError {
  /** 1-based source line. */
  line: number;
  msg: string;
}

export interface AsmResult {
  ok: boolean;
  /** The RAM image: always RAM_BYTES long, unused bytes are 0. */
  bytes: number[];
  errors: AsmError[];
  /** Problems that still assemble (e.g. code at the OUT address that `ST …, [OUT]` overwrites). */
  warnings: AsmError[];
  /** Labels and predefined symbols → value. */
  symbols: Record<string, number>;
  /** Address of the first byte emitted by each source line (1-based line numbers). */
  lineAddr: Record<number, number>;
}

/** Symbols every program can use. */
export const PREDEFINED_SYMBOLS: Readonly<Record<string, number>> = { OUT: OUT_ADDR, IN: IN_ADDR };

/** Mnemonics that are another instruction: NOP → MOV R0, R0. */
const ALIASES: Readonly<Record<string, { op: string; args: string[] }>> = { NOP: { op: "MOV", args: ["R0", "R0"] } };

const BY_MNEM = new Map(OPCODES.map((o) => [o.mnem, o]));
const ADDR_MASK = RAM_BYTES - 1;

class AsmFail extends Error {}

const isData = (kind: string) => kind === "imm" || kind === "addr";
const usage = (op: OpcodeSpec) => [op.mnem, op.operands.join(", ")].filter(Boolean).join(" ");
const writesMemory = (op: OpcodeSpec) => op.steps.some((s) => s.signals.includes("MEM_WRITE"));
const loadsPc = (op: OpcodeSpec) =>
  op.steps.some((s) => s.signals.includes("PC_LOAD") || !!s.when?.signals.includes("PC_LOAD"));

function regIndex(s: string): number {
  return (REGISTERS as readonly string[]).indexOf(s.trim().toUpperCase());
}

// ---------- expressions ----------

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

const CHAR = /^'(\\.|[^\\'])'/;
const ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, "0": 0 };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^0x[0-9a-f]+/i))) out.push({ t: "num", v: parseInt(m[0].slice(2), 16) });
    else if ((m = rest.match(/^0b[01]+/i))) out.push({ t: "num", v: parseInt(m[0].slice(2), 2) });
    else if ((m = rest.match(/^[0-9]+/))) out.push({ t: "num", v: parseInt(m[0], 10) });
    else if ((m = rest.match(CHAR))) {
      const c = m[1];
      out.push({ t: "num", v: c.length === 2 ? (ESCAPES[c[1]] ?? c.charCodeAt(1)) : c.charCodeAt(0) });
    } else if ((m = rest.match(/^[A-Za-z_]\w*/))) out.push({ t: "id", v: m[0] });
    else if ((m = rest.match(/^[-+()]/))) out.push({ t: "op", v: m[0] });
    else throw new AsmFail(`unexpected "${src[i]}" in "${src.trim()}"`);
    i += m[0].length;
  }
  return out;
}

/** Evaluates `term (± term)*`; a term is a number, a symbol, (expr) or a signed term. */
function evaluate(src: string, symbols: ReadonlyMap<string, number>): number {
  const toks = lex(src);
  if (toks.length === 0) throw new AsmFail("missing value");
  let p = 0;
  const term = (): number => {
    const tok = toks[p++];
    if (!tok) throw new AsmFail(`incomplete expression "${src.trim()}"`);
    if (tok.t === "num") return tok.v;
    if (tok.t === "id") {
      const v = symbols.get(tok.v);
      if (v !== undefined) return v;
      const near = [...symbols.keys()].find((k) => k.toLowerCase() === tok.v.toLowerCase());
      throw new AsmFail(`unknown symbol "${tok.v}"${near ? ` (did you mean "${near}"?)` : ""}`);
    }
    if (tok.v === "(") {
      const v = sum();
      if (toks[p++]?.v !== ")") throw new AsmFail(`missing ")" in "${src.trim()}"`);
      return v;
    }
    if (tok.v === "-") return -term();
    if (tok.v === "+") return term();
    throw new AsmFail(`unexpected "${tok.v}" in "${src.trim()}"`);
  };
  const sum = (): number => {
    let v = term();
    for (let tok = toks[p]; tok?.t === "op" && (tok.v === "+" || tok.v === "-"); tok = toks[p]) {
      p++;
      v = tok.v === "+" ? v + term() : v - term();
    }
    return v;
  };
  const v = sum();
  if (p < toks.length) throw new AsmFail(`unexpected "${toks[p].v}" in "${src.trim()}"`);
  return v;
}

// ---------- lines ----------

interface Stmt {
  line: number;
  label?: string;
  /** Mnemonic or directive, as written. */
  op?: string;
  args: string[];
  /** Address of the first byte (set in pass 1). */
  addr: number;
  /** Cleared once the statement has an error; pass 2 skips it. */
  ok: boolean;
}

/** Walks `s`, skipping over character literals (so `';'` and `','` are not syntax). */
function scan(s: string, visit: (ch: string, i: number) => boolean | void): void {
  for (let i = 0; i < s.length; i++) {
    const lit = s[i] === "'" ? s.slice(i).match(CHAR) : null;
    if (lit) i += lit[0].length - 1;
    else if (visit(s[i], i)) return;
  }
}

function stripComment(line: string): string {
  let end = line.length;
  scan(line, (ch, i) => {
    if (ch !== ";") return false;
    end = i;
    return true;
  });
  return line.slice(0, end);
}

/** Splits on commas outside brackets/parentheses. */
function splitOperands(s: string): string[] {
  if (!s.trim()) return [];
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  scan(s, (ch, i) => {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  });
  out.push(s.slice(start).trim());
  return out;
}

function parse(raw: string, line: number): Stmt {
  const st: Stmt = { line, args: [], addr: 0, ok: true };
  let s = stripComment(raw).trim();
  const lm = s.match(/^([A-Za-z_]\w*)\s*:/);
  if (lm) {
    st.label = lm[1];
    s = s.slice(lm[0].length).trim();
  }
  if (!s) return st;
  const om = s.match(/^(\.?[A-Za-z_]\w*)(?:\s+(.*))?$/);
  if (!om) throw new AsmFail(`cannot parse "${s}"`);
  st.op = om[1];
  st.args = splitOperands(om[2] ?? "");
  const alias = ALIASES[st.op.toUpperCase()];
  if (alias) {
    if (om[2]?.trim()) throw new AsmFail(`${st.op.toUpperCase()} takes no operands`);
    st.op = alias.op;
    st.args = [...alias.args];
  }
  return st;
}

// ---------- operands ----------

function value(arg: string, symbols: ReadonlyMap<string, number>, what: string): number {
  if (regIndex(arg) >= 0) throw new AsmFail(`expected ${what}, got register ${arg.trim().toUpperCase()}`);
  return evaluate(arg, symbols);
}

function byte(arg: string, symbols: ReadonlyMap<string, number>): number {
  const v = value(arg, symbols, "a value");
  if (v < -128 || v > 255) throw new AsmFail(`${v} does not fit in a byte (-128..255)`);
  return v & 0xff;
}

/** Bytes of one instruction, from its row's operand list. */
function encode(op: OpcodeSpec, args: string[], symbols: ReadonlyMap<string, number>): number[] {
  let first = op.code << 4;
  const rest: number[] = [];
  op.operands.forEach((kind, i) => {
    const arg = args[i];
    if (kind === "Rd" || kind === "Rs") {
      const r = regIndex(arg);
      if (r < 0) throw new AsmFail(`${usage(op)}: expected a register (${REGISTERS.join(" ")}), got "${arg}"`);
      first |= kind === "Rd" ? r << 2 : r;
    } else if (kind === "[Rd]" || kind === "[Rs]") {
      const inner = /^\[(.*)\]$/.exec(arg.trim());
      const r = inner ? regIndex(inner[1]) : -1;
      if (r < 0) throw new AsmFail(`${usage(op)}: expected a register in brackets, like [R1], got "${arg}"`);
      first |= kind === "[Rd]" ? r << 2 : r;
    } else if (kind === "[Rs+]") {
      const inner = /^\[(.*)\+\s*\]$/.exec(arg.trim());
      const r = inner ? regIndex(inner[1]) : -1;
      if (r < 0) throw new AsmFail(`${usage(op)}: expected a stepped pointer, like [R1+], got "${arg}"`);
      first |= r;
    } else if (kind === "imm") {
      if (/^\[.*\]$/.test(arg)) throw new AsmFail(`${usage(op)}: ${arg} is a memory operand, ${op.mnem} takes a value`);
      rest.push(byte(arg, symbols));
    } else {
      const bare = /^\[.*\]$/.test(arg) ? arg.slice(1, -1) : arg;
      const a = value(bare, symbols, "an address");
      if (a < 0 || a > ADDR_MASK) throw new AsmFail(`address ${a} is outside RAM (0..${ADDR_MASK})`);
      rest.push(a);
    }
  });
  return [first, ...rest];
}

/** Size in bytes (pass 1); validates everything that does not need symbol values. */
function sizeOf(st: Stmt): number {
  const dir = st.op!.toLowerCase();
  if (dir === ".db") {
    if (!st.args.length) throw new AsmFail(".db expects at least one value");
    return st.args.length;
  }
  if (dir.startsWith(".")) throw new AsmFail(`unknown directive "${st.op}" (use .org or .db)`);
  const op = BY_MNEM.get(st.op!.toUpperCase());
  if (!op) throw new AsmFail(`unknown instruction "${st.op}"`);
  if (st.args.length !== op.operands.length) {
    const n = op.operands.length;
    throw new AsmFail(`${usage(op)}: expects ${n} operand${n === 1 ? "" : "s"}, got ${st.args.length}`);
  }
  return 1 + op.operands.filter(isData).length;
}

// ---------- assembler ----------

export function assemble(src: string): AsmResult {
  const errors: AsmError[] = [];
  const warnings: AsmError[] = [];
  const symbols = new Map<string, number>(Object.entries(PREDEFINED_SYMBOLS));
  const labelLine = new Map<string, number>();
  const report = (line: number, e: unknown) => {
    if (!(e instanceof AsmFail)) throw e;
    errors.push({ line, msg: e.message });
  };

  const stmts = src.split(/\r?\n/).map((raw, i): Stmt => {
    try {
      return parse(raw, i + 1);
    } catch (e) {
      report(i + 1, e);
      return { line: i + 1, args: [], addr: 0, ok: false };
    }
  });

  const define = (st: Stmt, name: string, at: number) => {
    if (regIndex(name) >= 0) throw new AsmFail(`"${name}" is a register name`);
    if (name in PREDEFINED_SYMBOLS) throw new AsmFail(`"${name}" is predefined (= ${PREDEFINED_SYMBOLS[name]})`);
    if (labelLine.has(name)) throw new AsmFail(`label "${name}" is already defined on line ${labelLine.get(name)}`);
    symbols.set(name, at);
    labelLine.set(name, st.line);
  };

  // Pass 1: addresses and labels. Sizes depend only on the mnemonic, so forward references work.
  let pc = 0;
  let end = 0;
  const tooFar: Stmt[] = [];
  for (const st of stmts) {
    if (!st.ok) continue;
    const isOrg = st.op?.toLowerCase() === ".org";
    if (isOrg) {
      try {
        if (st.args.length !== 1) throw new AsmFail(".org expects one address");
        const a = evaluate(st.args[0], symbols);
        if (a < 0 || a > ADDR_MASK) throw new AsmFail(`.org ${a} is outside RAM (0..${ADDR_MASK})`);
        pc = a;
      } catch (e) {
        report(st.line, e);
        st.ok = false;
      }
    }
    if (st.label) {
      try {
        define(st, st.label, pc);
      } catch (e) {
        report(st.line, e);
      }
    }
    if (!st.op || isOrg || !st.ok) continue;
    try {
      const size = sizeOf(st);
      st.addr = pc;
      pc += size;
      end = Math.max(end, pc);
      if (pc > RAM_BYTES) {
        tooFar.push(st);
        st.ok = false;
      }
    } catch (e) {
      report(st.line, e);
      st.ok = false;
    }
  }
  if (tooFar.length)
    errors.push({
      line: tooFar[0].line,
      msg: `program needs ${end} bytes but RAM has ${RAM_BYTES} (0..${ADDR_MASK}); this is the first line that does not fit`,
    });

  // Pass 2: emit bytes.
  const bytes = new Array<number>(RAM_BYTES).fill(0);
  const owner: (number | undefined)[] = new Array(RAM_BYTES);
  const lineAddr: Record<number, number> = {};
  let storesToOut = false;
  for (const st of stmts) {
    if (!st.ok || !st.op || st.op.toLowerCase() === ".org") continue;
    try {
      const op = BY_MNEM.get(st.op.toUpperCase());
      const out = op ? encode(op, st.args, symbols) : st.args.map((a) => byte(a, symbols));
      out.forEach((_, i) => {
        const prev = owner[st.addr + i];
        if (prev !== undefined) throw new AsmFail(`address ${st.addr + i} is already used by line ${prev}`);
      });
      out.forEach((b, i) => {
        bytes[st.addr + i] = b;
        owner[st.addr + i] = st.line;
      });
      lineAddr[st.line] = st.addr;
      if (op && writesMemory(op))
        op.operands.filter(isData).forEach((kind, i) => {
          if (kind === "addr" && out[1 + i] === OUT_ADDR) storesToOut = true;
        });
    } catch (e) {
      report(st.line, e);
    }
  }
  const atOut = owner[OUT_ADDR];
  if (storesToOut && atOut !== undefined)
    warnings.push({
      line: atOut,
      msg: `address ${OUT_ADDR} is the OUT port: storing to [OUT] overwrites the byte placed here`,
    });

  errors.sort((a, b) => a.line - b.line);
  return { ok: errors.length === 0, bytes, errors, warnings, symbols: Object.fromEntries(symbols), lineAddr };
}

/** Decodes the instruction at `addr` of a RAM image (for displays and traces). */
export function disassemble(ram: ArrayLike<number>, addr = 0): { text: string; size: number } {
  const at = (a: number) => (ram[a & ADDR_MASK] ?? 0) & 0xff;
  const b = at(addr);
  const op = OPCODES[b >> 4];
  let next = addr + 1;
  const args = op.operands.map((kind) => {
    switch (kind) {
      case "Rd":
        return REGISTERS[(b >> 2) & 3];
      case "Rs":
        return REGISTERS[b & 3];
      case "[Rd]":
        return `[${REGISTERS[(b >> 2) & 3]}]`;
      case "[Rs]":
        return `[${REGISTERS[b & 3]}]`;
      case "[Rs+]":
        return `[${REGISTERS[b & 3]}+]`;
      case "imm":
        return String(at(next++));
      case "addr": {
        const a = at(next++) & ADDR_MASK;
        if (loadsPc(op)) return String(a);
        return a === OUT_ADDR ? "[OUT]" : `[${a}]`;
      }
    }
  });
  return { text: [op.mnem, args.join(", ")].filter(Boolean).join(" "), size: next - addr };
}
