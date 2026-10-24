// Word nodes to bits. Each DAG node becomes a vector of AIG literals (LSB first, two's complement
// when signed), built while the AIG's context names the node's module, so its gates land in that
// module. Arithmetic is ripple-carry; a product is an array of shifted rows; a comparison is the
// sign bit of an exact difference; a multiplexer is per bit, and a tree of them that only it reads
// is an AND-OR over one-hot paths when that is cheaper; `shr1` and `wrap` are wiring.
import { Aig, extend, F, T, type Lit } from "./aig";
import { bitsOfValue, widthOf, type Dag } from "./dag";

/** The AIG input key of bit i of a register (state variable) or an input port. */
export const qKey = (name: string, i: number) => `q:${i}:${name}`;
export const inKey = (name: string, i: number) => `i:${i}:${name}`;
export const evtKey = (i: number) => `e:${i}`;

export class Blaster {
  private readonly memo = new Map<number, Lit[]>();

  constructor(
    readonly dag: Dag,
    readonly aig: Aig,
    /** Bits of EVT. */
    readonly evtBits: number,
    /** Origin index (bus name) of a node. */
    readonly originOf: (node: number) => number,
    /** How many live nodes read a node (multiplexer trees read by one parent are flattened). */
    readonly parents?: (node: number) => number,
    /** Whether a multiplexer's only reader is another multiplexer, as one of its two values. Such
     * a node is never flattened on its own: if its tree would be, its reader's tree (the same
     * leaves and more, as wide or wider) is, and that never reads the inner node's bits. So a
     * chain of n multiplexers is flattened once, not n times. */
    readonly absorbed?: (node: number) => boolean,
  ) {}

  /** The node's bits, building them (and its operands' first) if needed. */
  bits(n: number): Lit[] {
    const hit = this.memo.get(n);
    if (hit) return hit;
    // Operands first, iteratively: a deep chain must not overflow the JS stack.
    const stack = [n];
    while (stack.length) {
      const m = stack[stack.length - 1];
      if (this.memo.has(m)) {
        stack.pop();
        continue;
      }
      const pending = this.dag.nodes[m].args.filter((x) => !this.memo.has(x));
      if (pending.length) {
        stack.push(...pending);
        continue;
      }
      stack.pop();
      this.memo.set(m, this.build(m));
    }
    return this.memo.get(n)!;
  }

  private arg(n: number, i: number, width: number): Lit[] {
    const A = this.dag.nodes[this.dag.nodes[n].args[i]];
    return extend(this.memo.get(this.dag.nodes[n].args[i])!, A.signed, width);
  }

  private build(n: number): Lit[] {
    const N = this.dag.nodes[n];
    const aig = this.aig;
    const saved = [aig.ctxOwner, aig.ctxOrigin];
    aig.ctxOwner = N.owner;
    aig.ctxOrigin = this.originOf(n);
    try {
      const W = N.bits;
      switch (N.op) {
        case "const":
          return bitsOfValue(N.value, W).map((b) => (b ? T : F));
        case "state":
          return Array.from({ length: W }, (_, i) =>
            aig.input(qKey(N.name, i)),
          );
        case "input":
          return Array.from({ length: W }, (_, i) =>
            aig.input(inKey(N.name, i)),
          );
        case "view":
          throw new Error(`the view variable ${N.name} reaches a register`);
        case "ev":
          return [this.decode(N.value)];
        case "add":
          return aig.add(this.arg(n, 0, W), this.arg(n, 1, W), F, W);
        case "sub":
          return aig.sub(this.arg(n, 0, W), this.arg(n, 1, W), W);
        case "neg":
          return aig.neg(this.arg(n, 0, W), W);
        case "mul": {
          // Rows come from the operand with fewer non-constant bits (a constant gives few rows).
          const [x, y] = N.args.map((a) => this.dag.nodes[a]);
          const live = (a: number) =>
            this.memo.get(N.args[a])!.filter((l) => l > T).length;
          const rowsFrom = live(1) <= live(0) ? 1 : 0;
          const other = 1 - rowsFrom;
          const b = this.memo.get(N.args[rowsFrom])!;
          return aig.mul(
            this.arg(n, other, W),
            b,
            (rowsFrom ? y : x).signed,
            W,
          );
        }
        case "isneg": {
          const a = this.memo.get(N.args[0])!;
          return [a[a.length - 1]];
        }
        case "eq": {
          // Both operands in one type that holds the two ranges, then bit for bit.
          const [x, y] = N.args.map((a) => this.dag.nodes[a]);
          const w = widthOf(Math.min(x.lo, y.lo), Math.max(x.hi, y.hi)).bits;
          return [aig.equal(this.arg(n, 0, w), this.arg(n, 1, w))];
        }
        case "shr1":
          return extend(
            this.memo.get(N.args[0])!,
            this.dag.nodes[N.args[0]].signed,
            W + 1,
          ).slice(1);
        case "wrap":
          return this.arg(n, 0, W);
        case "not":
          return [this.memo.get(N.args[0])![0] ^ 1];
        case "and":
          return [
            aig.and(this.memo.get(N.args[0])![0], this.memo.get(N.args[1])![0]),
          ];
        case "or":
          return [
            aig.or(this.memo.get(N.args[0])![0], this.memo.get(N.args[1])![0]),
          ];
        case "xor":
          return [
            aig.xor(this.memo.get(N.args[0])![0], this.memo.get(N.args[1])![0]),
          ];
        case "ite": {
          const flat = this.oneHot(n);
          if (flat) {
            const vecs = flat.map((l) =>
              extend(this.memo.get(l.node)!, this.dag.nodes[l.node].signed, W),
            );
            return Array.from({ length: W }, (_, i) =>
              aig.orAll(flat.map((l, k) => aig.and(l.path, vecs[k][i]))),
            );
          }
          const c = this.memo.get(N.args[0])![0];
          const a = this.arg(n, 1, W);
          const b = this.arg(n, 2, W);
          return a.map((x, i) => aig.mux(c, x, b[i]));
        }
      }
    } finally {
      [aig.ctxOwner, aig.ctxOrigin] = saved;
    }
  }

  /** A tree of multiplexers whose inner nodes nothing else reads (a read over slots, say) as its
   * leaves with one-hot path conditions, when an AND-OR of them is cheaper than the tree:
   * 2L - 1 gates per bit for L leaves, against 3 per bit per multiplexer. A run of ifs makes a
   * tree as deep as the run, so both walks keep their own stack instead of recursing. */
  private oneHot(n: number): { path: Lit; node: number }[] | undefined {
    const parents = this.parents;
    if (!parents || this.absorbed?.(n)) return undefined;
    const inner = (m: number) =>
      m === n || (this.dag.nodes[m].op === "ite" && parents(m) === 1);
    // L counts a leaf once per path that reaches it.
    let L = 0;
    for (const todo = [n]; todo.length;) {
      const m = todo.pop()!;
      if (inner(m))
        todo.push(this.dag.nodes[m].args[1], this.dag.nodes[m].args[2]);
      else L++;
    }
    const W = this.dag.nodes[n].bits;
    if ((2 * L - 1) * W + L >= 3 * (L - 1) * W) return undefined;
    // Depth first, the `then` side first: each path condition is made just before its subtree.
    const leaves: { path: Lit; node: number }[] = [];
    const stack: { m: number; path: Lit; side: 0 | 1 }[] = [
      { m: n, path: T, side: 0 },
    ];
    while (stack.length) {
      const f = stack[stack.length - 1];
      if (!inner(f.m)) {
        leaves.push({ path: f.path, node: f.m });
        stack.pop();
        continue;
      }
      const [c, a, b] = this.dag.nodes[f.m].args;
      const s = this.memo.get(c)![0];
      if (f.side === 0) {
        f.side = 1;
        stack.push({ m: a, path: this.aig.and(f.path, s), side: 0 });
      } else {
        stack.pop();
        stack.push({ m: b, path: this.aig.and(f.path, s ^ 1), side: 0 });
      }
    }
    return leaves;
  }

  /** The one-hot line of an EVT code: an AND of EVT literals, split in halves so lines share
   * their partial products. */
  private decode(code: number): Lit {
    const bit = bitsOfValue(code, this.evtBits);
    const term = (lo: number, hi: number): Lit => {
      if (hi - lo === 1) return this.aig.input(evtKey(lo)) ^ (bit[lo] ? 0 : 1);
      const mid = lo + Math.ceil((hi - lo) / 2);
      return this.aig.and(term(lo, mid), term(mid, hi));
    };
    return term(0, this.evtBits);
  }
}
