// Turns opcode-table rows (read from the canvas, or spec/opcodes.json in tests) into a
// decode table. Each row's micro-op text is compiled into small functions; these
// micro-op primitives are the only CPU behavior defined in code.
import type { CPU } from "./cpu";

export const FMT_SIZE: Record<string, number> = {
  "-": 1,
  r: 2,
  "r,r": 2,
  "r,i8": 3,
  "r,a16": 4,
  i16: 3,
  a16: 3,
};

export const REG_NAMES = ["A", "B", "C", "D", "H", "L"];

export type MicroFn = (cpu: CPU) => void;

export interface TableRow {
  op: string;
  mnem: string;
  fmt: string;
  micro: string;
  /** Where the row came from, for error messages (e.g. a node id). */
  where?: string;
}

export interface DecodeEntry {
  op: number;
  key: string;
  mnem: string;
  fmt: string;
  size: number;
  micro: MicroFn[];
  microSrc: string;
  where?: string;
}

export interface DecodeTable {
  entries: (DecodeEntry | undefined)[];
  byMnem: Map<string, DecodeEntry>;
}

const ALU_BINARY = ["ADD", "SUB", "AND", "OR", "XOR", "CMP"];
const ALU_UNARY = ["INC", "DEC", "SHL", "SHR"];
const CONDITIONS = ["Z", "NZ", "C", "NC", "N", "NN"];

type RegRef = (cpu: CPU) => number;

function regRef(tok: string | undefined): RegRef {
  if (tok === undefined) throw new Error("missing register operand");
  if (tok === "rd") return (c) => c.rd;
  if (tok === "rs") return (c) => c.rs;
  const i = REG_NAMES.indexOf(tok.toUpperCase());
  if (i < 0)
    throw new Error(
      `"${tok}" is not a register (use rd, rs or ${REG_NAMES.join("/")})`,
    );
  return () => i;
}

function addrRef(tok: string | undefined): (cpu: CPU) => number {
  if (tok === "HL") return (c) => c.hl();
  if (tok === "W") return (c) => c.W;
  throw new Error(`address must be HL or W, got "${tok ?? ""}"`);
}

function valueRef(tok: string | undefined): (cpu: CPU) => number {
  if (tok === "T") return (c) => c.T;
  if (tok === "W") return (c) => c.W & 0xff;
  if (tok !== undefined && /^(0x[0-9a-f]+|\d+)$/i.test(tok)) {
    const n = Number(tok) & 0xff;
    return () => n;
  }
  throw new Error(`value must be T, W or a number, got "${tok ?? ""}"`);
}

function arity(args: string[], min: number, max: number, kind: string) {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : `${min}-${max}`;
    throw new Error(`${kind} takes ${want} operand(s), got ${args.length}`);
  }
}

export function compileMicroOp(src: string): MicroFn {
  const [rawKind, ...args] = src.trim().split(/\s+/);
  const kind = rawKind.toUpperCase();
  switch (kind) {
    case "HALT":
      arity(args, 0, 0, kind);
      return (c) => c.halt();
    case "REG":
      arity(args, 0, 0, kind);
      return (c) => {
        const b = c.fetchByte();
        c.rd = b >> 4;
        c.rs = b & 15;
      };
    case "IMM8":
      arity(args, 0, 0, kind);
      return (c) => {
        c.T = c.fetchByte();
      };
    case "IMM16":
      arity(args, 0, 0, kind);
      return (c) => {
        const lo = c.fetchByte();
        c.W = lo | (c.fetchByte() << 8);
      };
    case "SET": {
      arity(args, 2, 2, kind);
      const r = regRef(args[0]);
      const v = valueRef(args[1]);
      return (c) => c.setReg(r(c), v(c));
    }
    case "COPY": {
      arity(args, 2, 2, kind);
      const d = regRef(args[0]);
      const s = regRef(args[1]);
      return (c) => c.setReg(d(c), c.getReg(s(c)));
    }
    case "LOAD": {
      arity(args, 2, 2, kind);
      const r = regRef(args[0]);
      const a = addrRef(args[1]);
      return (c) => c.setReg(r(c), c.read(a(c)));
    }
    case "STORE": {
      arity(args, 2, 2, kind);
      const r = regRef(args[0]);
      const a = addrRef(args[1]);
      return (c) => c.write(a(c), c.getReg(r(c)));
    }
    case "SETHL":
      arity(args, 1, 1, kind);
      if (args[0] !== "W") throw new Error(`SETHL takes W, got "${args[0]}"`);
      return (c) => c.setHL(c.W);
    case "INCHL":
      arity(args, 0, 0, kind);
      return (c) => c.setHL((c.hl() + 1) & 0xffff);
    case "ALU": {
      arity(args, 2, 3, kind);
      const op = args[0].toUpperCase();
      const a = regRef(args[1]);
      if (ALU_BINARY.includes(op)) {
        arity(args, 3, 3, `ALU ${op}`);
        const b = regRef(args[2]);
        return (c) => c.alu(op, a(c), b(c));
      }
      if (ALU_UNARY.includes(op)) {
        arity(args, 2, 2, `ALU ${op}`);
        return (c) => c.alu(op, a(c), -1);
      }
      throw new Error(
        `unknown ALU op "${args[0]}" (${[...ALU_BINARY, ...ALU_UNARY].join(" ")})`,
      );
    }
    case "JUMP": {
      arity(args, 1, 2, kind);
      const target = addrRef(args[0]);
      const cond = args[1]?.toUpperCase();
      if (cond !== undefined && !CONDITIONS.includes(cond))
        throw new Error(
          `unknown condition "${args[1]}" (${CONDITIONS.join(" ")})`,
        );
      return (c) => {
        if (cond === undefined || c.test(cond)) c.jump(target(c));
      };
    }
    case "PUSHPC":
      arity(args, 0, 0, kind);
      return (c) => {
        c.push(c.pc >> 8);
        c.push(c.pc & 0xff);
      };
    case "POPPC":
      arity(args, 0, 0, kind);
      return (c) => {
        const lo = c.pop();
        c.jump(lo | (c.pop() << 8));
      };
    case "PUSH": {
      arity(args, 1, 1, kind);
      const r = regRef(args[0]);
      return (c) => c.push(c.getReg(r(c)));
    }
    case "POP": {
      arity(args, 1, 1, kind);
      const r = regRef(args[0]);
      return (c) => c.setReg(r(c), c.pop());
    }
    default:
      throw new Error(`unknown micro-op "${rawKind}"`);
  }
}

export function compileMicro(src: string): MicroFn[] {
  return src
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "—" && s !== "-")
    .map(compileMicroOp);
}

export function parseTable(rows: TableRow[]): {
  table: DecodeTable;
  errors: string[];
} {
  const entries: (DecodeEntry | undefined)[] = new Array(256);
  const byMnem = new Map<string, DecodeEntry>();
  const errors: string[] = [];

  for (const row of rows) {
    const label = `row ${row.op.trim() || "?"}${row.mnem ? ` (${row.mnem.trim()})` : ""}`;
    const opText = row.op.trim().replace(/^0x/i, "");
    if (!/^[0-9a-f]{1,2}$/i.test(opText)) {
      errors.push(`${label}: opcode must be a hex byte, got "${row.op}"`);
      continue;
    }
    const op = parseInt(opText, 16);
    const mnem = row.mnem.trim().toUpperCase();
    const fmt = row.fmt.trim().replace(/\s+/g, "");
    if (!mnem) {
      errors.push(`${label}: missing mnemonic`);
      continue;
    }
    if (!(fmt in FMT_SIZE)) {
      errors.push(
        `${label}: unknown format "${row.fmt}" (${Object.keys(FMT_SIZE).join(" ")})`,
      );
      continue;
    }
    let micro: MicroFn[];
    try {
      micro = compileMicro(row.micro);
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      continue;
    }
    if (entries[op]) {
      errors.push(
        `${label}: opcode ${opText.toUpperCase()} is already used by ${entries[op]!.mnem}`,
      );
      continue;
    }
    const entry: DecodeEntry = {
      op,
      key: op.toString(16).toUpperCase().padStart(2, "0"),
      mnem,
      fmt,
      size: FMT_SIZE[fmt],
      micro,
      microSrc: row.micro,
      where: row.where,
    };
    entries[op] = entry;
    if (byMnem.has(mnem))
      errors.push(`${label}: mnemonic ${mnem} is defined twice`);
    else byMnem.set(mnem, entry);
  }
  return { table: { entries, byMnem }, errors };
}
