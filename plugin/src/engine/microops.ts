// LANE: engine. Parses the micro-op TEXT found on the canvas into typed steps. This is the ONLY place the
// vocabulary (Stage 1 STAGELOG) is defined; opcodes themselves are never hard-coded, they come from the table.
export type RegArg = "rd" | "rs" | "A" | "B" | "C" | "D" | "H" | "L";
export type AluOp = "ADD" | "SUB" | "AND" | "OR" | "XOR" | "CMP" | "INC" | "DEC" | "SHL" | "SHR";
export type Cond = "Z" | "NZ" | "C" | "NC" | "N" | "NN";
export type MicroOp =
  | { k: "REG" }
  | { k: "IMM8" }
  | { k: "IMM16" }
  | { k: "SET"; r: RegArg } // r <- T
  | { k: "COPY"; dst: RegArg; src: RegArg }
  | { k: "LOAD"; r: RegArg; from: "HL" | "W" }
  | { k: "STORE"; r: RegArg; to: "HL" | "W" }
  | { k: "SETHL" } // HL <- W
  | { k: "INCHL" }
  | { k: "ALU"; op: AluOp; a: RegArg; b?: RegArg }
  | { k: "JUMP"; cond?: Cond }
  | { k: "PUSH"; r: RegArg }
  | { k: "POP"; r: RegArg }
  | { k: "PUSHPC" }
  | { k: "POPPC" }
  | { k: "HALT" };

const REG_ARGS = new Set(["rd", "rs", "A", "B", "C", "D", "H", "L"]);
const ALU_OPS = new Set(["ADD", "SUB", "AND", "OR", "XOR", "CMP", "INC", "DEC", "SHL", "SHR"]);
const ALU_BINARY = new Set(["ADD", "SUB", "AND", "OR", "XOR", "CMP"]);
const CONDS = new Set(["Z", "NZ", "C", "NC", "N", "NN"]);

export interface ParsedMicro {
  ops: MicroOp[];
  errors: string[];
}

/** Canvas text is hand-editable and may drift: tolerate case, extra spaces, newlines, "—"/"-" for empty. */
export function normalizeMicro(text: string): string {
  return text
    .replace(/[—–−]/g, "-")
    .replace(/[\r\n]+/g, ";")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMicro(text: string): ParsedMicro {
  const norm = normalizeMicro(text);
  const ops: MicroOp[] = [];
  const errors: string[] = [];
  if (norm === "" || norm === "-") return { ops, errors };

  const reg = (t: string | undefined, what: string): RegArg | null => {
    if (t === undefined) return (errors.push(`${what}: missing register`), null);
    const v = t.length === 1 ? t.toUpperCase() : t.toLowerCase();
    if (REG_ARGS.has(v)) return v as RegArg;
    errors.push(`${what}: bad register "${t}"`);
    return null;
  };
  const place = (t: string | undefined, what: string): "HL" | "W" | null => {
    const v = (t || "").toUpperCase();
    if (v === "HL" || v === "W") return v;
    errors.push(`${what}: expected HL or W, got "${t ?? ""}"`);
    return null;
  };

  for (const raw of norm.split(";")) {
    const seg = raw.trim();
    if (!seg) continue;
    const [head, ...a] = seg.split(" ");
    const name = head.toUpperCase();
    const need = (n: number) => {
      if (a.length !== n) errors.push(`${name}: expected ${n} operand(s), got ${a.length} ("${seg}")`);
      return a.length === n;
    };
    switch (name) {
      case "REG": case "IMM8": case "IMM16": case "INCHL":
      case "PUSHPC": case "POPPC": case "HALT":
        if (need(0)) ops.push({ k: name } as MicroOp);
        break;
      case "SETHL": // canvas writes "SETHL W" (HL <- W); a bare "SETHL" means the same
        if (a.length > 1 || (a.length === 1 && a[0].toUpperCase() !== "W")) errors.push(`SETHL: expected "SETHL W", got "${seg}"`);
        else ops.push({ k: "SETHL" });
        break;
      case "SET": {
        if (!need(2)) break;
        if (a[1].toUpperCase() !== "T") { errors.push(`SET: source must be T, got "${a[1]}"`); break; }
        const r = reg(a[0], "SET"); if (r) ops.push({ k: "SET", r });
        break;
      }
      case "COPY": {
        if (!need(2)) break;
        const dst = reg(a[0], "COPY dst"), src = reg(a[1], "COPY src");
        if (dst && src) ops.push({ k: "COPY", dst, src });
        break;
      }
      case "LOAD": case "STORE": {
        if (!need(2)) break;
        const r = reg(a[0], name), p = place(a[1], name);
        if (r && p) ops.push(name === "LOAD" ? { k: "LOAD", r, from: p } : { k: "STORE", r, to: p });
        break;
      }
      case "ALU": {
        if (a.length < 2) { errors.push(`ALU: needs op and register ("${seg}")`); break; }
        const op = a[0].toUpperCase();
        if (!ALU_OPS.has(op)) { errors.push(`ALU: unknown op "${a[0]}"`); break; }
        const binary = ALU_BINARY.has(op);
        if (a.length !== (binary ? 3 : 2)) { errors.push(`ALU ${op}: expected ${binary ? 2 : 1} register(s)`); break; }
        const ra = reg(a[1], "ALU a"), rb = binary ? reg(a[2], "ALU b") : undefined;
        if (ra && (!binary || rb)) ops.push({ k: "ALU", op: op as AluOp, a: ra, ...(rb ? { b: rb } : {}) });
        break;
      }
      case "JUMP": {
        if (a.length < 1 || a.length > 2) { errors.push(`JUMP: expected "JUMP W [cond]"`); break; }
        if (a[0].toUpperCase() !== "W") { errors.push(`JUMP: target must be W, got "${a[0]}"`); break; }
        const c = a[1]?.toUpperCase();
        if (c !== undefined && !CONDS.has(c)) { errors.push(`JUMP: unknown condition "${a[1]}"`); break; }
        ops.push(c ? { k: "JUMP", cond: c as Cond } : { k: "JUMP" });
        break;
      }
      case "PUSH": case "POP": {
        if (!need(1)) break;
        const r = reg(a[0], name); if (r) ops.push({ k: name, r } as MicroOp);
        break;
      }
      default:
        errors.push(`unknown micro-op "${head}"`);
    }
  }
  return { ops, errors };
}
