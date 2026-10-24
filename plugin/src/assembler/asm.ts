// LANE: asm. Two-pass assembler: labels, .org, .db only. Pure function, no Figma, tested in Node.
// Encoding is DRIVEN BY spec/opcodes.json (mnemonic -> op byte, `fmt` column -> operand layout). The only rules
// here are the generic fmt layouts documented in spec/opcodes.json "formats". No opcode constants.
import { OPCODES, type OpcodeRow } from "../contracts/spec";
import { REGS } from "../contracts/nodes";

export interface AsmResult {
  bytes: number[];
  origin: number;
  labels: Record<string, number>;
  errors: { line: number; message: string }[];
}

const BY_MNEM = new Map<string, OpcodeRow>(OPCODES.map((o) => [o.mnem.toUpperCase(), o]));

/** Operand layout per fmt: how many source operands and how many bytes each instruction takes. */
function sizeOf(fmt: string): number {
  switch (fmt) {
    case "-": return 1;
    case "r": case "r,r": return 2;
    case "r,i8": return 3;
    case "r,a16": return 4;
    case "i16": case "a16": return 3;
    default: return 1;
  }
}

interface Item {
  line: number;
  addr: number;
  kind: "ins" | "db";
  row?: OpcodeRow;
  ops: string[];
}

/** Bytes a .db operand emits: "text" and 'text' (2+ chars) are strings, 'c' is one char, anything else one value. */
function dbLen(o: string): number {
  const m = /^(["'])(.*)\1$/.exec(o);
  return m && (m[1] === '"' || m[2].length !== 1) ? m[2].length : 1;
}

const stripComment = (s: string) => {
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === inStr) inStr = null; }
    else if (c === '"' || c === "'") inStr = c;
    else if (c === ";") return s.slice(0, i);
  }
  return s;
};

/** Split operands on commas that are not inside quotes. */
function splitOps(s: string): string[] {
  const out: string[] = [];
  let cur = "", q: string | null = null;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ",") { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim() !== "" || out.length) out.push(cur.trim());
  return out;
}

export function assemble(source: string): AsmResult {
  const errors: AsmResult["errors"] = [];
  const err = (line: number, message: string) => void errors.push({ line, message });
  const labels: Record<string, number> = {};
  const items: Item[] = [];
  let pc = 0, origin: number | null = null;
  const regIndex = (t: string) => REGS.indexOf(t.toUpperCase() as (typeof REGS)[number]);

  // ---------- pass 1: addresses ----------
  const lines = source.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    let s = stripComment(raw).trim();
    while (true) {
      const m = /^([A-Za-z_.][\w.]*)\s*:\s*(.*)$/.exec(s);
      if (!m) break;
      if (m[1] in labels) err(line, `duplicate label "${m[1]}"`);
      else labels[m[1]] = pc;
      s = m[2].trim();
    }
    if (!s) return;
    const sp = s.search(/\s/);
    const head = (sp < 0 ? s : s.slice(0, sp)).toUpperCase();
    const rest = sp < 0 ? "" : s.slice(sp + 1).trim();
    if (head === ".ORG") {
      const v = evalNum(rest, {}, false);
      if (v === null || v < 0 || v > 0xffff) return err(line, `.org needs an address 0..0xFFFF, got "${rest}"`);
      if (origin === null) origin = v;
      else if (v < pc) return err(line, `.org 0x${v.toString(16)} goes backwards (at 0x${pc.toString(16)})`);
      pc = v;
      return;
    }
    if (origin === null) origin = pc;
    if (head === ".DB") {
      const ops = splitOps(rest);
      let n = 0;
      for (const o of ops) n += dbLen(o);
      if (!ops.length) return err(line, ".db needs at least one value");
      items.push({ line, addr: pc, kind: "db", ops });
      pc += n;
      return;
    }
    if (head.startsWith(".")) return err(line, `unknown directive "${head.toLowerCase()}"`);
    const row = BY_MNEM.get(head);
    if (!row) return err(line, `unknown mnemonic "${head}"`);
    items.push({ line, addr: pc, kind: "ins", row, ops: rest ? splitOps(rest) : [] });
    pc += sizeOf(row.fmt);
  });

  // ---------- pass 2: emit ----------
  const base = origin ?? 0;
  const out: number[] = [];
  const put = (addr: number, b: number) => {
    const idx = addr - base;
    while (out.length < idx) out.push(0);
    out[idx] = b & 0xff;
  };
  const val = (line: number, t: string, bits: 8 | 16): number | null => {
    const v = evalNum(t, labels, true, (m) => err(line, m));
    if (v === null) return null;
    if (bits === 8 && (v < -128 || v > 255)) return err(line, `value ${v} does not fit in 8 bits`), null;
    if (bits === 16 && (v < -32768 || v > 0xffff)) return err(line, `value ${v} does not fit in 16 bits`), null;
    return v & (bits === 8 ? 0xff : 0xffff);
  };
  const reg = (line: number, t: string | undefined): number | null => {
    if (t === undefined) return err(line, "missing register"), null;
    const i = regIndex(t);
    if (i < 0) return err(line, `"${t}" is not a register (A B C D H L)`), null;
    return i;
  };
  const addrText = (t: string) => t.replace(/^\[\s*|\s*\]$/g, "");

  for (const it of items) {
    if (it.kind === "db") {
      let a = it.addr;
      for (const o of it.ops) {
        const sm = /^(["'])(.*)\1$/.exec(o);
        if (sm && (sm[1] === '"' || sm[2].length !== 1)) {
          for (const ch of sm[2]) put(a++, ch.charCodeAt(0));
        } else {
          const v = val(it.line, o, 8);
          put(a++, v ?? 0);
        }
      }
      continue;
    }
    const row = it.row!;
    let ops = it.ops;
    // LD r,[HL] / ST r,[HL]: the pointer operand is implied by the fmt, accept and ignore it
    if (row.fmt === "r" && ops.length === 2 && /^\[?\s*HL\s*\]?$/i.test(ops[1])) ops = [ops[0]];
    const want: Record<string, number> = { "-": 0, r: 1, "r,r": 2, "r,i8": 2, "r,a16": 2, i16: 1, a16: 1 };
    if (ops.length !== want[row.fmt]) {
      err(it.line, `${row.mnem} takes ${want[row.fmt]} operand(s) (${row.fmt}), got ${ops.length}`);
      continue;
    }
    const bytes: (number | null)[] = [parseInt(row.op, 16)];
    switch (row.fmt) {
      case "-": break;
      case "r": { const r = reg(it.line, ops[0]); bytes.push(r === null ? null : r << 4); break; }
      case "r,r": { const a = reg(it.line, ops[0]), b = reg(it.line, ops[1]); bytes.push(a === null || b === null ? null : (a << 4) | b); break; }
      case "r,i8": { const a = reg(it.line, ops[0]); bytes.push(a === null ? null : a << 4); bytes.push(val(it.line, ops[1], 8)); break; }
      case "r,a16": { const a = reg(it.line, ops[0]); bytes.push(a === null ? null : a << 4); const v = val(it.line, addrText(ops[1]), 16); bytes.push(v === null ? null : v & 0xff, v === null ? null : v >> 8); break; }
      case "i16": case "a16": { const v = val(it.line, addrText(ops[0]), 16); bytes.push(v === null ? null : v & 0xff, v === null ? null : v >> 8); break; }
    }
    bytes.forEach((b, k) => put(it.addr + k, b ?? 0));
  }

  errors.sort((a, b) => a.line - b.line);
  return { bytes: out, origin: base, labels, errors };
}

/** number | 'c' | label, with optional +/- chain. Returns null (and reports) if it cannot be resolved. */
function evalNum(t: string, labels: Record<string, number>, requireLabels: boolean, report?: (m: string) => void): number | null {
  const s = t.trim();
  if (!s) return report?.("missing value"), null;
  const parts = s.match(/[+-]?\s*[^+-]+/g) ?? [];
  let total = 0;
  for (let p of parts) {
    p = p.replace(/\s+/g, "");
    let sign = 1;
    if (p[0] === "+") p = p.slice(1);
    else if (p[0] === "-") { sign = -1; p = p.slice(1); }
    let v: number;
    if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p.slice(2), 16);
    else if (/^\$[0-9a-f]+$/i.test(p)) v = parseInt(p.slice(1), 16);
    else if (/^0b[01]+$/i.test(p)) v = parseInt(p.slice(2), 2);
    else if (/^\d+$/.test(p)) v = parseInt(p, 10);
    else if (/^'.'$/.test(p)) v = p.charCodeAt(1);
    else if (/^[A-Za-z_.][\w.]*$/.test(p)) {
      if (!(p in labels)) {
        if (requireLabels) report?.(`undefined label "${p}"`);
        return null;
      }
      v = labels[p];
    } else return report?.(`cannot read value "${t}"`), null;
    total += sign * v;
  }
  return total;
}
