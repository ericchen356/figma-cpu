// The word level of the synthesizer: a dataflow DAG of integer and boolean nodes. Symbolic
// execution (exec.ts) builds it from a flow handler and blast.ts turns it into bits. Every
// constructor folds constants and hashes structure, so equal computations are one node, and gives
// its node the exact range of values it can take: an intermediate is as wide as that range needs
// (two's complement when it can be negative) and never loses information. Only a write to a
// variable truncates, through `wrap`.
//
// Comparisons are the sign of a difference (`isneg`), so a < b, b > a, a >= b and b <= a share one
// subtractor. A node read from a view variable is poison: whatever is computed from it is poison
// too, and the synthesizer rejects poison that reaches a register or a condition.

export type Op =
  | "const"
  | "state"
  | "input"
  | "view"
  | "ev"
  | "add"
  | "sub"
  | "neg"
  | "mul"
  | "isneg"
  | "eq"
  | "shr1"
  | "wrap"
  | "and"
  | "or"
  | "xor"
  | "not"
  | "ite";

export interface WNode {
  op: Op;
  args: number[];
  /** const: the value (a bool as 0/1); ev: the event code; wrap: the width. */
  value: number;
  /** state, input, view: the variable; wrap: "s" (signed) or "u". */
  name: string;
  bool: boolean;
  /** The smallest and largest value the node can take (0 and 1 for a bool). */
  lo: number;
  hi: number;
  /** Width of the node's bit vector, and whether it is two's complement. */
  bits: number;
  signed: boolean;
  /** The module (a unit, GLUE or EVDEC) that created the node. */
  owner: number;
}

/** Widest intermediate the synthesizer builds. Values stay exact JS numbers below 2^53. */
export const MAX_BITS = 48;

/** Number of bits of a whole number n >= 0 (0 for 0). */
export function bitLength(n: number): number {
  let b = 0;
  while (b < 1100 && 2 ** b <= n) b++;
  return b;
}

/** The narrowest two's complement (when lo < 0) or unsigned type holding [lo, hi]. */
export function widthOf(
  lo: number,
  hi: number,
): { bits: number; signed: boolean } {
  if (lo >= 0) return { bits: Math.max(1, bitLength(hi)), signed: false };
  return {
    bits: 1 + Math.max(bitLength(-lo - 1), bitLength(hi)),
    signed: true,
  };
}

/** All values of a declared type. */
export function typeRange(bits: number, signed: boolean): [number, number] {
  return signed
    ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1]
    : [0, 2 ** bits - 1];
}

/** v truncated to `bits` bits, read back as that type (what a `set` stores). */
export function wrapValue(v: number, bits: number, signed: boolean): number {
  const m = 2 ** bits;
  let u = ((v % m) + m) % m;
  if (signed && u >= m / 2) u -= m;
  return u + 0;
}

/** The two's complement bits of v, LSB first. */
export function bitsOfValue(v: number, bits: number): number[] {
  let u = v < 0 ? v + 2 ** bits : v;
  const out: number[] = [];
  for (let i = 0; i < bits; i++) {
    out.push(u % 2);
    u = Math.floor(u / 2);
  }
  return out;
}

export class Dag {
  readonly nodes: WNode[] = [];
  private readonly table = new Map<string, number>();
  /** Module that owns the nodes created from now on. */
  owner = 0;
  readonly FALSE: number;
  readonly TRUE: number;

  constructor() {
    this.FALSE = this.bool(false);
    this.TRUE = this.bool(true);
  }

  private make(
    op: Op,
    args: number[],
    bool: boolean,
    lo: number,
    hi: number,
    value = 0,
    name = "",
  ): number {
    const key = `${op}|${args.join(",")}|${value}|${name}|${bool ? "b" : "n"}`;
    const hit = this.table.get(key);
    if (hit !== undefined) return hit;
    const { bits, signed } = bool
      ? { bits: 1, signed: false }
      : widthOf(lo, hi);
    if (bits > MAX_BITS)
      throw new Error(
        `an intermediate (${op}) needs ${bits} bits; the limit is ${MAX_BITS}`,
      );
    const id = this.nodes.length;
    this.nodes.push({
      op,
      args,
      value,
      name,
      bool,
      lo: lo + 0,
      hi: hi + 0,
      bits,
      signed,
      owner: this.owner,
    });
    this.table.set(key, id);
    return id;
  }

  /** The value of a constant node, else undefined. */
  constant(n: number): number | undefined {
    const N = this.nodes[n];
    return N.op === "const" ? N.value : undefined;
  }

  isPoison(n: number): boolean {
    return this.nodes[n].op === "view";
  }

  private poison(...xs: number[]): number | undefined {
    return xs.find((x) => this.nodes[x].op === "view");
  }

  private num1(n: number, what: string): void {
    if (this.nodes[n].bool)
      throw new Error(`${what} needs a number, got a boolean`);
  }

  private bool1(n: number, what: string): void {
    if (!this.nodes[n].bool)
      throw new Error(`${what} needs a boolean, got a number`);
  }

  // ---------- leaves ----------

  num(v: number): number {
    if (!Number.isInteger(v))
      throw new Error(
        `${v} is not a whole number: gates only compute integers`,
      );
    return this.make("const", [], false, v, v, v + 0);
  }

  bool(v: boolean): number {
    return this.make("const", [], true, +v, +v, +v);
  }

  /** A register's current value (a state variable read at the start of the event). */
  state(name: string, bool: boolean, bits: number, signed: boolean): number {
    const [lo, hi] = bool ? [0, 1] : typeRange(bits, signed);
    return this.make("state", [], bool, lo, hi, 0, name);
  }

  /** An input port's value. */
  input(name: string, bool: boolean, bits: number, signed: boolean): number {
    const [lo, hi] = bool ? [0, 1] : typeRange(bits, signed);
    return this.make("input", [], bool, lo, hi, 0, name);
  }

  /** A read of a view variable: poison. */
  view(name: string, bool: boolean): number {
    return this.make("view", [], bool, 0, 0, 0, name);
  }

  /** The decoded event line of an EVT code. */
  ev(code: number): number {
    return this.make("ev", [], true, 0, 1, code);
  }

  // ---------- arithmetic ----------

  add(a: number, b: number): number {
    const p = this.poison(a, b);
    if (p !== undefined) return p;
    this.num1(a, "add");
    this.num1(b, "add");
    const ca = this.constant(a);
    const cb = this.constant(b);
    if (ca !== undefined && cb !== undefined) return this.num(ca + cb);
    if (ca !== undefined) return this.add(b, a);
    const A = this.nodes[a];
    const B = this.nodes[b];
    if (cb !== undefined) {
      if (cb === 0) return a;
      const inner = A.op === "add" ? this.constant(A.args[1]) : undefined;
      if (inner !== undefined) return this.add(A.args[0], this.num(inner + cb));
    }
    if (B.op === "neg") return this.sub(a, B.args[0]);
    if (A.op === "neg") return this.sub(b, A.args[0]);
    if (a === b) return this.mul(a, this.num(2));
    if (cb === undefined && a > b) [a, b] = [b, a];
    return this.make("add", [a, b], false, A.lo + B.lo, A.hi + B.hi);
  }

  sub(a: number, b: number): number {
    const p = this.poison(a, b);
    if (p !== undefined) return p;
    this.num1(a, "sub");
    this.num1(b, "sub");
    const ca = this.constant(a);
    const cb = this.constant(b);
    if (ca !== undefined && cb !== undefined) return this.num(ca - cb);
    if (cb !== undefined) return this.add(a, this.num(-cb));
    if (a === b) return this.num(0);
    const A = this.nodes[a];
    const B = this.nodes[b];
    if (B.op === "neg") return this.add(a, B.args[0]);
    if (ca === 0) return this.neg(b);
    return this.make("sub", [a, b], false, A.lo - B.hi, A.hi - B.lo);
  }

  neg(a: number): number {
    const p = this.poison(a);
    if (p !== undefined) return p;
    this.num1(a, "neg");
    const ca = this.constant(a);
    if (ca !== undefined) return this.num(-ca);
    const A = this.nodes[a];
    if (A.op === "neg") return A.args[0];
    if (A.op === "sub") return this.sub(A.args[1], A.args[0]);
    return this.make("neg", [a], false, -A.hi, -A.lo);
  }

  mul(a: number, b: number): number {
    const p = this.poison(a, b);
    if (p !== undefined) return p;
    this.num1(a, "mul");
    this.num1(b, "mul");
    const ca = this.constant(a);
    const cb = this.constant(b);
    if (ca !== undefined && cb !== undefined) return this.num(ca * cb);
    if (ca !== undefined) return this.mul(b, a);
    if (cb !== undefined) {
      if (cb === 0) return this.num(0);
      if (cb === 1) return a;
      if (cb < 0) return this.neg(this.mul(a, this.num(-cb)));
    } else if (a > b) [a, b] = [b, a];
    const A = this.nodes[a];
    const B = this.nodes[b];
    const ps = [A.lo * B.lo, A.lo * B.hi, A.hi * B.lo, A.hi * B.hi];
    return this.make("mul", [a, b], false, Math.min(...ps), Math.max(...ps));
  }

  /** a / b, only for b the constant 1 (the hardware has no divider). */
  div(a: number, b: number): number {
    const p = this.poison(a, b);
    if (p !== undefined) return p;
    if (this.constant(b) !== 1 || this.nodes[b].bool)
      throw new Error("div is only supported by the constant 1");
    this.num1(a, "div");
    return a;
  }

  /** floor(a / 2): a shift right (arithmetic when a can be negative). */
  shr1(a: number): number {
    const p = this.poison(a);
    if (p !== undefined) return p;
    this.num1(a, "half");
    const ca = this.constant(a);
    if (ca !== undefined) return this.num(Math.floor(ca / 2));
    const A = this.nodes[a];
    return this.make(
      "shr1",
      [a],
      false,
      Math.floor(A.lo / 2),
      Math.floor(A.hi / 2),
    );
  }

  /** a truncated to a declared type, as a `set` stores it. Free when a always fits. */
  wrap(a: number, bits: number, signed: boolean): number {
    const p = this.poison(a);
    if (p !== undefined) return p;
    this.num1(a, "a number variable");
    const ca = this.constant(a);
    if (ca !== undefined) return this.num(wrapValue(ca, bits, signed));
    const [lo, hi] = typeRange(bits, signed);
    const A = this.nodes[a];
    if (A.lo >= lo && A.hi <= hi) return a;
    if (A.op === "wrap" && A.value >= bits)
      return this.wrap(A.args[0], bits, signed);
    return this.make("wrap", [a], false, lo, hi, bits, signed ? "s" : "u");
  }

  // ---------- comparisons ----------

  /** a < 0. */
  isneg(a: number): number {
    const p = this.poison(a);
    if (p !== undefined) return p;
    this.num1(a, "a comparison");
    const ca = this.constant(a);
    if (ca !== undefined) return this.bool(ca < 0);
    const A = this.nodes[a];
    if (A.lo >= 0) return this.FALSE;
    if (A.hi < 0) return this.TRUE;
    return this.make("isneg", [a], true, 0, 1);
  }

  lt(a: number, b: number): number {
    return this.isneg(this.sub(a, b));
  }
  gt(a: number, b: number): number {
    return this.isneg(this.sub(b, a));
  }
  le(a: number, b: number): number {
    return this.not(this.isneg(this.sub(b, a)));
  }
  ge(a: number, b: number): number {
    return this.not(this.isneg(this.sub(a, b)));
  }

  eq(a: number, b: number): number {
    const p = this.poison(a, b);
    if (p !== undefined) return p;
    const A = this.nodes[a];
    const B = this.nodes[b];
    if (A.bool !== B.bool)
      throw new Error("eq compares a boolean with a number");
    if (A.bool) return this.not(this.xor(a, b));
    if (a === b) return this.TRUE;
    const ca = this.constant(a);
    const cb = this.constant(b);
    if (ca !== undefined && cb !== undefined) return this.bool(ca === cb);
    if (A.hi < B.lo || B.hi < A.lo) return this.FALSE;
    if (ca !== undefined || (cb === undefined && a > b)) [a, b] = [b, a];
    return this.make("eq", [a, b], true, 0, 1);
  }

  ne(a: number, b: number): number {
    return this.not(this.eq(a, b));
  }

  // ---------- booleans ----------

  not(a: number): number {
    const p = this.poison(a);
    if (p !== undefined) return p;
    this.bool1(a, "not");
    const ca = this.constant(a);
    if (ca !== undefined) return this.bool(!ca);
    const A = this.nodes[a];
    if (A.op === "not") return A.args[0];
    return this.make("not", [a], true, 0, 1);
  }

  private complements(a: number, b: number): boolean {
    const A = this.nodes[a];
    const B = this.nodes[b];
    return (
      (A.op === "not" && A.args[0] === b) || (B.op === "not" && B.args[0] === a)
    );
  }

  and(a: number, b: number): number {
    const p = this.poison(a, b);
    if (p !== undefined) return p;
    this.bool1(a, "and");
    this.bool1(b, "and");
    const ca = this.constant(a);
    const cb = this.constant(b);
    if (ca !== undefined) return ca ? b : this.FALSE;
    if (cb !== undefined) return cb ? a : this.FALSE;
    if (a === b) return a;
    if (this.complements(a, b)) return this.FALSE;
    if (a > b) [a, b] = [b, a];
    return this.make("and", [a, b], true, 0, 1);
  }

  or(a: number, b: number): number {
    const p = this.poison(a, b);
    if (p !== undefined) return p;
    this.bool1(a, "or");
    this.bool1(b, "or");
    const ca = this.constant(a);
    const cb = this.constant(b);
    if (ca !== undefined) return ca ? this.TRUE : b;
    if (cb !== undefined) return cb ? this.TRUE : a;
    if (a === b) return a;
    if (this.complements(a, b)) return this.TRUE;
    if (a > b) [a, b] = [b, a];
    return this.make("or", [a, b], true, 0, 1);
  }

  xor(a: number, b: number): number {
    const p = this.poison(a, b);
    if (p !== undefined) return p;
    this.bool1(a, "ne");
    this.bool1(b, "ne");
    const ca = this.constant(a);
    const cb = this.constant(b);
    if (ca !== undefined) return ca ? this.not(b) : b;
    if (cb !== undefined) return cb ? this.not(a) : a;
    if (a === b) return this.FALSE;
    if (this.complements(a, b)) return this.TRUE;
    const A = this.nodes[a];
    const B = this.nodes[b];
    if (A.op === "not") return this.not(this.xor(A.args[0], b));
    if (B.op === "not") return this.not(this.xor(a, B.args[0]));
    if (a > b) [a, b] = [b, a];
    return this.make("xor", [a, b], true, 0, 1);
  }

  /** A balanced OR of many booleans. */
  orAll(xs: number[]): number {
    if (!xs.length) return this.FALSE;
    let level = xs;
    while (level.length > 1) {
      const next: number[] = [];
      for (let i = 0; i < level.length; i += 2)
        next.push(
          i + 1 < level.length ? this.or(level[i], level[i + 1]) : level[i],
        );
      level = next;
    }
    return level[0];
  }

  /** c ? a : b, for two numbers or two booleans. Two booleans fold into an AND or OR where they
   * can, unless `keep`: a register's merge stays a multiplexer, so the synthesizer can still read
   * off when the register is written (its LOAD) and with what (its D). The bits make the same
   * AND or OR of it either way. */
  ite(c: number, a: number, b: number, keep = false): number {
    const p = this.poison(c, a, b);
    if (p !== undefined) return p;
    this.bool1(c, "a condition");
    const A = this.nodes[a];
    const B = this.nodes[b];
    if (A.bool !== B.bool)
      throw new Error(
        "the two sides of an if give a boolean and a number to the same variable",
      );
    const cc = this.constant(c);
    if (cc !== undefined) return cc ? a : b;
    if (a === b) return a;
    const C = this.nodes[c];
    if (C.op === "not") return this.ite(C.args[0], b, a, keep);
    if (A.bool && !keep) {
      const ca = this.constant(a);
      const cb = this.constant(b);
      if (ca !== undefined)
        return ca ? this.or(c, b) : this.and(this.not(c), b);
      if (cb !== undefined)
        return cb ? this.or(this.not(c), a) : this.and(c, a);
      if (a === c) return this.or(c, b);
      if (b === c) return this.and(c, a);
      if (this.complements(a, c)) return this.and(a, b);
      if (this.complements(b, c)) return this.or(b, a);
    }
    if (A.op === "ite" && A.args[0] === c)
      return this.ite(c, A.args[1], b, keep);
    if (B.op === "ite" && B.args[0] === c)
      return this.ite(c, a, B.args[2], keep);
    return this.make(
      "ite",
      [c, a, b],
      A.bool,
      Math.min(A.lo, B.lo),
      Math.max(A.hi, B.hi),
    );
  }
}
