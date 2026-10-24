// Two-pass assembler. Mnemonics and operand formats come from the opcode table on the canvas.
// label:  MNEM op, op   ; comment
// .org expr | .equ NAME expr | .db expr|"str", ... | .dw expr, ... | .ds count
// Registers A B C D H L. [HL] operands are optional sugar, [expr] means expr.
// Expressions: + - * / % & | ^ << >> ~ ( ), lo(x), hi(x), numbers 42 0x2A $2A 0b101 'c'.

function lex(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = rest.match(/^0x[0-9a-f]+/i)) || (m = rest.match(/^\$[0-9a-f]+/i))) out.push({ t: "num", v: parseInt(m[0].replace(/^0x|^\$/i, ""), 16) });
    else if ((m = rest.match(/^0b[01]+/i))) out.push({ t: "num", v: parseInt(m[0].slice(2), 2) });
    else if ((m = rest.match(/^[0-9]+/))) out.push({ t: "num", v: parseInt(m[0], 10) });
    else if ((m = rest.match(/^'(\\?.)'/))) {
      const esc = { n: 10, r: 13, t: 9, "0": 0 };
      const c = m[1].length === 2 ? (m[1][1] in esc ? esc[m[1][1]] : m[1].charCodeAt(1)) : m[1].charCodeAt(0);
      out.push({ t: "num", v: c });
    } else if ((m = rest.match(/^[A-Za-z_.][\w.]*/))) out.push({ t: "id", v: m[0] });
    else if ((m = rest.match(/^(<<|>>|[-+*/%&|^~()])/))) out.push({ t: "op", v: m[0] });
    else throw new AsmFail(`unexpected "${ch}" in expression`);
    i += m[0].length;
  }
  return out;
}

const BINOPS = {
  "|": [1, (a, b) => a | b], "^": [2, (a, b) => a ^ b], "&": [3, (a, b) => a & b],
  "<<": [4, (a, b) => a << b], ">>": [4, (a, b) => a >> b],
  "+": [5, (a, b) => a + b], "-": [5, (a, b) => a - b], "*": [6, (a, b) => a * b],
  "/": [6, (a, b) => { if (b === 0) throw new AsmFail("division by zero"); return Math.trunc(a / b); }],
  "%": [6, (a, b) => { if (b === 0) throw new AsmFail("division by zero"); return a % b; }],
};

/** Unknown symbols throw, unless lenient (pass 1), where they read as 0. */
function evaluate(src, symbols, lenient) {
  const toks = lex(src);
  if (toks.length === 0) throw new AsmFail("missing value");
  let p = 0;
  const peek = () => toks[p];
  const expectClose = () => {
    const tok = toks[p++];
    if (!tok || tok.v !== ")") throw new AsmFail(`missing ")" in "${src}"`);
  };
  const primary = () => {
    const tok = toks[p++];
    if (!tok) throw new AsmFail(`incomplete expression "${src}"`);
    if (tok.t === "num") return tok.v;
    if (tok.t === "id") {
      const fn = tok.v.toLowerCase();
      const next = peek();
      if ((fn === "lo" || fn === "hi") && next && next.t === "op" && next.v === "(") {
        p++;
        const v = expr(0);
        expectClose();
        return fn === "lo" ? v & 0xff : (v >> 8) & 0xff;
      }
      if (tok.v in symbols) return symbols[tok.v];
      if (lenient) return 0;
      throw new AsmFail(`unknown symbol "${tok.v}"`);
    }
    if (tok.v === "(") { const v = expr(0); expectClose(); return v; }
    if (tok.v === "-") return -primary();
    if (tok.v === "+") return primary();
    if (tok.v === "~") return ~primary();
    throw new AsmFail(`unexpected "${tok.v}"`);
  };
  const expr = (minPrec) => {
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
  if (p < toks.length) throw new AsmFail(`unexpected "${toks[p].v}" in "${src}"`);
  return v;
}

function stripComment(line) {
  let q = null;
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

function splitOperands(s) {
  const out = [];
  let cur = "";
  let depth = 0;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === "\\") cur += s[++i] || "";
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseString(s) {
  const esc = { n: 10, r: 13, t: 9, "0": 0 };
  const body = s.slice(1, -1);
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") {
      const e = body[++i];
      out.push(e in esc ? esc[e] : e.charCodeAt(0));
    } else out.push(body.charCodeAt(i) & 0xff);
  }
  return out;
}

function parseLines(src) {
  return src.split(/\r?\n/).map((raw, i) => {
    let s = stripComment(raw).trim();
    const line = { no: i + 1, args: [] };
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

const isReg = (s) => REGISTERS.indexOf(s.trim().toUpperCase()) >= 0;

function regNum(s) {
  const i = REGISTERS.indexOf((s || "").trim().toUpperCase());
  if (i < 0) throw new AsmFail(`expected a register (${REGISTERS.join(" ")}), got "${s || ""}"`);
  return i;
}

function normalizeOperands(args) {
  return args
    .filter((a) => a.replace(/\s+/g, "").toUpperCase() !== "[HL]")
    .map((a) => (/^\[.*\]$/.test(a) ? a.slice(1, -1).trim() : a));
}

function checkRange(v, bits, what) {
  const max = bits === 8 ? 0xff : 0xffff;
  if (v < -(max + 1) / 2 || v > max) throw new AsmFail(`${what} ${v} does not fit in ${bits} bits`);
  return v & max;
}

function encode(fmt, op, args, val) {
  const need = (n) => {
    if (args.length !== n) throw new AsmFail(`expects ${n} operand${n === 1 ? "" : "s"} (format ${fmt}), got ${args.length}`);
  };
  switch (fmt) {
    case "-": need(0); return [op];
    case "r": need(1); return [op, regNum(args[0]) << 4];
    case "r,r": need(2); return [op, (regNum(args[0]) << 4) | regNum(args[1])];
    case "r,i8": need(2); return [op, regNum(args[0]) << 4, val(args[1], 8, "immediate")];
    case "r,a16": {
      need(2);
      const a = val(args[1], 16, "address");
      return [op, regNum(args[0]) << 4, a & 0xff, a >> 8];
    }
    case "i16": case "a16": {
      need(1);
      const a = val(args[0], 16, fmt === "i16" ? "immediate" : "address");
      return [op, a & 0xff, a >> 8];
    }
  }
  throw new AsmFail(`unknown format ${fmt}`);
}

/** Two-pass assembler. Mnemonics and formats come from the opcode table on the canvas. */
function assemble(src, table, predefined) {
  predefined = predefined || PREDEFINED_SYMBOLS;
  const errors = [];
  const symbols = Object.assign({}, predefined);
  let lines;
  try {
    lines = parseLines(src);
  } catch (e) {
    return { ok: false, errors: [{ line: 0, msg: e.message }], chunks: [], symbols, lineAddr: {}, size: 0, entry: 0 };
  }
  const equArgs = (line) => (line.args.length === 1 ? line.args[0].split(/\s+/) : line.args);

  const sizeOf = (line, pass, emit, val) => {
    const op = line.op;
    const dir = op.toLowerCase();
    if (dir === ".db") {
      const bytes = [];
      for (const a of line.args) {
        if (/^".*"$/.test(a)) bytes.push(...parseString(a));
        else bytes.push(pass === 2 ? val(a, 8, "byte") : 0);
      }
      emit(bytes);
      return bytes.length;
    }
    if (dir === ".dw") {
      const bytes = [];
      for (const a of line.args) {
        const v = pass === 2 ? val(a, 16, "word") : 0;
        bytes.push(v & 0xff, v >> 8);
      }
      emit(bytes);
      return bytes.length;
    }
    if (dir === ".ds") {
      const n = evaluate(line.args[0] || "", symbols);
      emit(new Array(n).fill(0));
      return n;
    }
    if (dir[0] === ".") throw new AsmFail(`unknown directive ${op}`);
    const row = table.byMnem.get(op.toUpperCase());
    if (!row) throw new AsmFail(`unknown instruction "${op}" (not in the opcode table)`);
    const bytes = encode(row.fmt, row.op, normalizeOperands(line.args), pass === 2 ? val : () => 0);
    emit(bytes);
    return bytes.length;
  };

  // Pass 1: label addresses.
  let pc = 0;
  let entry = null;
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
        pc = evaluate(line.args[0] || "", symbols) & 0xffff;
        if (line.label) symbols[line.label] = pc;
        continue;
      }
      if (dir === ".equ") {
        const parts = equArgs(line);
        if (!parts[0] || parts.length < 2) throw new AsmFail(".equ NAME value");
        symbols[parts[0]] = evaluate(parts.slice(1).join(" "), symbols, true);
        continue;
      }
      if (entry === null && dir[0] !== ".") entry = pc;
      pc += sizeOf(line, 1, () => {}, () => 0);
    } catch (e) {
      errors.push({ line: line.no, msg: e.message });
    }
  }
  // .equ again now that every label is known.
  for (const line of lines) {
    if (!line.op || line.op.toLowerCase() !== ".equ") continue;
    try {
      const parts = equArgs(line);
      if (parts[0] && parts.length > 1) symbols[parts[0]] = evaluate(parts.slice(1).join(" "), symbols);
    } catch (e) {
      errors.push({ line: line.no, msg: e.message });
    }
  }
  // Pass 2: bytes.
  const chunks = [];
  const lineAddr = {};
  let cur = null;
  pc = 0;
  for (const line of lines) {
    if (!line.op) continue;
    const dir = line.op.toLowerCase();
    try {
      if (dir === ".org") {
        pc = evaluate(line.args[0] || "", symbols) & 0xffff;
        cur = null;
        continue;
      }
      if (dir === ".equ") continue;
      const val = (e, bits, what) => checkRange(evaluate(e, symbols), bits, what);
      lineAddr[line.no] = pc;
      pc += sizeOf(line, 2, (bytes) => {
        if (!bytes.length) return;
        if (!cur || cur.addr + cur.bytes.length !== pc) {
          cur = { addr: pc, bytes: [] };
          chunks.push(cur);
        }
        cur.bytes.push(...bytes);
      }, val);
    } catch (e) {
      if (!errors.some((x) => x.line === line.no)) errors.push({ line: line.no, msg: e.message });
    }
  }
  errors.sort((a, b) => a.line - b.line);
  const size = chunks.reduce((n, c) => n + c.bytes.length, 0);
  return { ok: errors.length === 0, errors, chunks, symbols, lineAddr, size, entry: entry === null ? 0 : entry };
}
