// The bit level of the synthesizer: an and-inverter graph with XOR nodes. A literal is a node
// index times two plus a complement bit, so a NOT costs nothing here; netlist.ts later picks the
// polarity each node is built in and the gate type (AND, NAND, NOR, OR, XOR, XNOR) that needs the
// fewest inverters. Every constructor folds constants and hashes structure, so no gate it leads to
// has a constant input and no two compute the same thing from the same inputs.
//
// Each node remembers the module that created it (`owner`) and the word-level node it was made
// for (`origin`): that is how gates are grouped into the chart's blocks and buses are named.

export type Lit = number;
export const F: Lit = 0;
export const T: Lit = 1;
export const not = (x: Lit): Lit => x ^ 1;

export const KIND_CONST = 0;
export const KIND_INPUT = 1;
export const KIND_AND = 2;
export const KIND_XOR = 3;

const SHIFT = 2 ** 26;

export class Aig {
  readonly kind: number[] = [KIND_CONST];
  /** Operand literals of AND and XOR nodes (XOR operands are always uncomplemented). */
  readonly a: Lit[] = [0];
  readonly b: Lit[] = [0];
  readonly owner: number[] = [-1];
  readonly origin: number[] = [-1];
  /** External signal of each input node. */
  readonly inputKey = new Map<number, string>();
  private readonly inputs = new Map<string, Lit>();
  private readonly ands = new Map<number, number>();
  private readonly xors = new Map<number, number>();
  /** Module and origin given to the nodes created from now on. */
  ctxOwner = -1;
  ctxOrigin = -1;

  get size(): number {
    return this.kind.length;
  }

  private node(kind: number, a: Lit, b: Lit): number {
    const n = this.kind.length;
    if (n >= SHIFT / 2) throw new Error("the bit graph is too large");
    this.kind.push(kind);
    this.a.push(a);
    this.b.push(b);
    this.owner.push(this.ctxOwner);
    this.origin.push(this.ctxOrigin);
    return n;
  }

  /** The literal of an external signal: a register output, an input port bit, an EVT bit. */
  input(key: string): Lit {
    let l = this.inputs.get(key);
    if (l === undefined) {
      const n = this.node(KIND_INPUT, 0, 0);
      this.inputKey.set(n, key);
      l = 2 * n;
      this.inputs.set(key, l);
    }
    return l;
  }

  and(x: Lit, y: Lit): Lit {
    if (x > y) [x, y] = [y, x];
    if (x === F) return F;
    if (x === T) return y;
    if (x === y) return x;
    if (x === (y ^ 1)) return F;
    const r = this.absorb(x, y) ?? this.absorb(y, x);
    if (r !== undefined) return r;
    const key = x * SHIFT + y;
    let n = this.ands.get(key);
    if (n === undefined) {
      n = this.node(KIND_AND, x, y);
      this.ands.set(key, n);
    }
    return 2 * n;
  }

  /** Two-level rules for x·y when y is an AND node or its complement. */
  private absorb(x: Lit, y: Lit): Lit | undefined {
    const n = y >> 1;
    if (this.kind[n] !== KIND_AND) return undefined;
    const p = this.a[n];
    const q = this.b[n];
    if ((y & 1) === 0) {
      if (x === p || x === q) return y; // x·(x·q) = x·q
      if (x === (p ^ 1) || x === (q ^ 1)) return F; // x·(¬x·q) = 0
      const m = x >> 1;
      if ((x & 1) === 0 && this.kind[m] === KIND_AND) {
        const r = this.a[m];
        const s = this.b[m];
        if (r === (p ^ 1) || r === (q ^ 1) || s === (p ^ 1) || s === (q ^ 1))
          return F; // (r·s)·(¬r·q) = 0
      }
    } else {
      if (x === (p ^ 1) || x === (q ^ 1)) return x; // x·¬(¬x·q) = x
      if (x === p) return this.and(x, q ^ 1); // x·¬(x·q) = x·¬q
      if (x === q) return this.and(x, p ^ 1);
    }
    return undefined;
  }

  or(x: Lit, y: Lit): Lit {
    return this.and(x ^ 1, y ^ 1) ^ 1;
  }

  xor(x: Lit, y: Lit): Lit {
    const p = (x ^ y) & 1;
    x -= x & 1;
    y -= y & 1;
    if (x > y) [x, y] = [y, x];
    if (x === F) return y ^ p;
    if (x === y) return p;
    const r = this.cancel(x, y) ?? this.cancel(y, x);
    if (r !== undefined) return r ^ p;
    const key = x * SHIFT + y;
    let n = this.xors.get(key);
    if (n === undefined) {
      n = this.node(KIND_XOR, x, y);
      this.xors.set(key, n);
    }
    return (2 * n) ^ p;
  }

  /** x ⊕ (x ⊕ z) = z. */
  private cancel(x: Lit, y: Lit): Lit | undefined {
    const n = y >> 1;
    if (this.kind[n] !== KIND_XOR) return undefined;
    if (x === this.a[n]) return this.b[n];
    if (x === this.b[n]) return this.a[n];
    return undefined;
  }

  /** s ? t : e. */
  mux(s: Lit, t: Lit, e: Lit): Lit {
    if (s === T || t === e) return t;
    if (s === F) return e;
    if (t === (e ^ 1)) return this.xor(s, e);
    if (t === T || t === s) return this.or(s, e);
    if (t === F || t === (s ^ 1)) return this.and(s ^ 1, e);
    if (e === F || e === s) return this.and(s, t);
    if (e === T || e === (s ^ 1)) return this.or(s ^ 1, t);
    return this.or(this.and(s, t), this.and(s ^ 1, e));
  }

  /** Sum and carry of three bits (`carry` false: the carry is not needed, as in the top bit). A
   * constant operand turns it into a half adder. With x and y of opposite polarity (a
   * subtraction) the carry is v ⊕ p·(v ⊕ z), v the complemented one, which needs no inverter. */
  fullAdd(x: Lit, y: Lit, z: Lit, carry = true): [Lit, Lit] {
    if (x <= T) [x, z] = [z, x];
    else if (y <= T) [y, z] = [z, y];
    if (z <= T) {
      const s = this.xor(x, y);
      if (!carry) return [z === F ? s : s ^ 1, F];
      return z === F ? [s, this.and(x, y)] : [s ^ 1, this.or(x, y)];
    }
    for (const [p, q, r] of [
      [x, y, z],
      [x, z, y],
      [y, z, x],
    ]) {
      if (p === q) return [r, p];
      if (p === (q ^ 1)) return [r ^ 1, r];
    }
    const p = this.xor(x, y);
    const s = this.xor(p, z);
    if (!carry) return [s, F];
    if (((x ^ y) & 1) === 0)
      return [s, this.or(this.and(x, y), this.and(p, z))];
    const v = x & 1 ? x : y;
    return [s, this.xor(v, this.and(p, this.xor(v, z)))];
  }

  // ---------- vectors (LSB first) ----------

  /** (a + b + cin) mod 2^width; missing high bits are 0. */
  add(a: Lit[], b: Lit[], cin: Lit, width: number): Lit[] {
    const out: Lit[] = [];
    let c = cin;
    for (let i = 0; i < width; i++) {
      const [s, co] = this.fullAdd(a[i] ?? F, b[i] ?? F, c, i < width - 1);
      out.push(s);
      c = co;
    }
    return out;
  }

  /** (a - b) mod 2^width, as a + ¬b + 1 (a and b already `width` bits wide). */
  sub(a: Lit[], b: Lit[], width: number): Lit[] {
    return this.add(a, b.map(not), T, width);
  }

  /** (-a) mod 2^width (a already `width` bits wide). */
  neg(a: Lit[], width: number): Lit[] {
    return this.add(a.map(not), [], T, width);
  }

  /** (a · b) mod 2^width: one row per bit of b, added (the sign row of a signed b subtracted).
   * `a` is already `width` bits wide; `b` is its own width. */
  mul(a: Lit[], b: Lit[], bSigned: boolean, width: number): Lit[] {
    let acc: Lit[] = new Array<Lit>(width).fill(F);
    for (let i = 0; i < b.length && i < width; i++) {
      if (b[i] === F) continue;
      const row: Lit[] = new Array<Lit>(width).fill(F);
      for (let j = 0; i + j < width; j++) row[i + j] = this.and(a[j], b[i]);
      acc =
        bSigned && i === b.length - 1
          ? this.sub(acc, row, width)
          : this.add(acc, row, F, width);
    }
    return acc;
  }

  /** a = b, bit for bit (both the same width). */
  equal(a: Lit[], b: Lit[]): Lit {
    return this.andAll(a.map((x, i) => this.xor(x, b[i]) ^ 1));
  }

  andAll(xs: Lit[]): Lit {
    if (!xs.length) return T;
    let level = xs;
    while (level.length > 1) {
      const next: Lit[] = [];
      for (let i = 0; i < level.length; i += 2)
        next.push(
          i + 1 < level.length ? this.and(level[i], level[i + 1]) : level[i],
        );
      level = next;
    }
    return level[0];
  }

  orAll(xs: Lit[]): Lit {
    return this.andAll(xs.map(not)) ^ 1;
  }
}

/** A bit vector widened (sign or zero extension) or truncated to `width` bits. */
export function extend(bits: Lit[], signed: boolean, width: number): Lit[] {
  if (width <= bits.length) return bits.slice(0, width);
  const fill = signed ? bits[bits.length - 1] : F;
  return [...bits, ...new Array<Lit>(width - bits.length).fill(fill)];
}
