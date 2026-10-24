// Parses the opcode table (op | mnem | fmt | micro) into executable micro-op lists. The micro-op
// vocabulary is the only behavior defined in code; which opcode does what is data on the canvas.

const BINARY_ALU = ["ADD", "SUB", "AND", "OR", "XOR", "CMP"];
const UNARY_ALU = ["INC", "DEC", "SHL", "SHR"];
const CONDS = ["Z", "NZ", "C", "NC", "N", "NN"];

function parseReg(tok, where) {
  if (!tok) throw new MicroError(`${where}: missing register`);
  const t = tok.toLowerCase();
  if (t === "rd" || t === "rs") return { kind: t };
  const index = REGISTERS.indexOf(tok.toUpperCase());
  if (index < 0) throw new MicroError(`${where}: "${tok}" is not rd, rs or a register`);
  return { kind: "fixed", index };
}

function parsePtr(tok, where) {
  const t = (tok || "").toUpperCase();
  if (t === "HL" || t === "W") return t;
  throw new MicroError(`${where}: address must be HL or W, got "${tok || ""}"`);
}

function arity(parts, n, where) {
  if (parts.length - 1 !== n) throw new MicroError(`${where} takes ${n} operand${n === 1 ? "" : "s"}`);
}

function splitSteps(src) {
  const s = src.trim();
  if (s === "" || s === "-" || s === "—") return [];
  return s.split(";").map((x) => x.trim()).filter((x) => x.length > 0);
}

function parseStep(step) {
  const parts = step.split(/\s+/);
  const name = parts[0].toUpperCase();
  switch (name) {
    case "REG": case "IMM8": case "IMM16": case "INCHL": case "PUSHPC": case "POPPC": case "HALT":
      arity(parts, 0, name);
      return { k: name };
    case "SETHL":
      arity(parts, 1, name);
      if (parts[1].toUpperCase() !== "W") throw new MicroError("SETHL only takes W");
      return { k: name };
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
      const op = (parts[1] || "").toUpperCase();
      if (BINARY_ALU.indexOf(op) >= 0) {
        arity(parts, 3, "ALU " + op);
        return { k: "ALU", op, d: parseReg(parts[2], name), s: parseReg(parts[3], name) };
      }
      if (UNARY_ALU.indexOf(op) >= 0) {
        arity(parts, 2, "ALU " + op);
        return { k: "ALU", op, d: parseReg(parts[2], name) };
      }
      throw new MicroError(`unknown ALU op "${parts[1] || ""}"`);
    }
    case "JUMP": {
      if (parts.length < 2 || parts.length > 3 || parts[1].toUpperCase() !== "W") throw new MicroError("JUMP W [Z|NZ|C|NC|N|NN]");
      if (parts.length === 2) return { k: "JUMP", cond: null };
      const cond = parts[2].toUpperCase();
      if (CONDS.indexOf(cond) < 0) throw new MicroError(`unknown condition "${parts[2]}"`);
      return { k: "JUMP", cond };
    }
    case "PUSH":
      arity(parts, 1, name);
      return { k: "PUSH", s: parseReg(parts[1], name) };
    case "POP":
      arity(parts, 1, name);
      return { k: "POP", d: parseReg(parts[1], name) };
  }
  throw new MicroError(`unknown micro-op "${parts[0]}"`);
}

function operandBytesRead(micro) {
  let n = 0;
  for (const m of micro) n += m.k === "IMM16" ? 2 : m.k === "REG" || m.k === "IMM8" ? 1 : 0;
  return n;
}

function parseRow(src) {
  const opText = src.op.trim();
  if (!/^[0-9a-fA-F]{1,2}$/.test(opText)) throw new MicroError(`op "${src.op}" is not a hex byte`);
  const mnem = src.mnem.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*$/.test(mnem)) throw new MicroError(`mnemonic "${src.mnem}" is invalid`);
  const fmt = src.fmt.trim();
  if (FORMATS.indexOf(fmt) < 0) throw new MicroError(`format "${src.fmt}" must be one of ${FORMATS.join(" ")}`);
  const steps = splitSteps(src.micro);
  const micro = steps.map((s, i) => {
    try {
      return parseStep(s);
    } catch (e) {
      throw new MicroError(`step ${i + 1} "${s}": ${e.message}`);
    }
  });
  const read = operandBytesRead(micro);
  if (read !== FORMAT_OPERAND_BYTES[fmt])
    throw new MicroError(`micro-ops read ${read} operand byte(s) but format "${fmt}" encodes ${FORMAT_OPERAND_BYTES[fmt]}`);
  return { op: parseInt(opText, 16), mnem, fmt, micro, steps };
}

/** Builds the decoder from table rows. Bad rows are skipped and reported, never fatal. */
function buildTable(sources) {
  const byOp = new Array(256);
  const byMnem = new Map();
  const rows = [];
  const errors = [];
  for (const src of sources) {
    const label = `${src.op.trim() || "??"} ${src.mnem.trim()}`;
    let row;
    try {
      row = parseRow(src);
    } catch (e) {
      errors.push({ row: label, msg: e.message });
      continue;
    }
    if (byOp[row.op]) {
      errors.push({ row: label, msg: `opcode ${src.op} is already used by ${byOp[row.op].mnem}` });
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
