// A miniature of Figma's prototype action language: SET_VARIABLE with number/boolean expressions
// and nested CONDITIONAL blocks. The emulator counts EXECUTED actions (the viewer's limit).
export type E = { c: number } | { v: string } | { b: string; l: E; r: E };
export const C = (n: number): E => ({ c: n });
export const V = (n: string): E => ({ v: n });
export const B = (op: string, l: E, r: E): E => ({ b: op, l, r });
export const add = (l: E, r: E) => B("+", l, r);
export const sub = (l: E, r: E) => B("-", l, r);
export type A = { s: string; e: E } | { i: { c?: E; t: A[] }[] };
export const set = (s: string, e: E): A => ({ s, e });

export type State = Record<string, number>;
export interface Cost { sets: number; ifs: number; blocks: number }
export const newCost = (): Cost => ({ sets: 0, ifs: 0, blocks: 0 });
/** optimistic: one action per set and per conditional; conservative: one per block evaluated */
export const costA = (c: Cost) => c.sets + c.ifs;
export const costB = (c: Cost) => c.sets + c.blocks;

export function ev(e: E, st: State): number {
  if ("c" in e) return e.c;
  if ("v" in e) { const x = st[e.v]; if (x === undefined) throw new Error("undefined var " + e.v); return x; }
  const l = ev(e.l, st), r = ev(e.r, st);
  switch (e.b) {
    case "+": return l + r; case "-": return l - r; case "*": return l * r;
    case "<": return +(l < r); case "<=": return +(l <= r); case ">": return +(l > r); case ">=": return +(l >= r);
    case "==": return +(l === r); case "!=": return +(l !== r); case "&&": return +(l && r); case "||": return +(l || r);
  }
  throw new Error("op " + e.b);
}
export function run(acts: A[], st: State, cost: Cost): void {
  for (const a of acts) {
    if ("s" in a) { st[a.s] = ev(a.e, st); cost.sets++; continue; }
    cost.ifs++;
    for (const blk of a.i) {
      cost.blocks++;
      if (!blk.c || ev(blk.c, st)) { run(blk.t, st, cost); break; }
    }
  }
}
/** Binary decision tree over idx in [lo,hi): log2(n) conditionals executed instead of n. */
export function sel(idx: E, lo: number, hi: number, leaf: (i: number) => A[]): A[] {
  if (hi - lo === 1) return leaf(lo);
  const mid = (lo + hi) >> 1;
  return [{ i: [{ c: B("<", idx, C(mid)), t: sel(idx, lo, mid, leaf) }, { t: sel(idx, mid, hi, leaf) }] }];
}
export function staticSize(acts: A[]): number {
  return acts.reduce((n, a) => n + ("s" in a ? 1 : 1 + a.i.reduce((m, b) => m + staticSize(b.t), 0)), 0);
}
