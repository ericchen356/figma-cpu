// Hex → 7-segment decoder. SEG[0..6] = segments a..g (active high):
//
//      aaa
//     f   b
//      ggg
//     e   c
//      ddd
//
// Glyphs 0-9 A b C d E F; 6 has its top bar, 7 is a-b-c, 9 has its bottom bar.
import { define } from "../hdl/builder";
import type { Library } from "../netlist/types";
import { orTree, place } from "./util";

/** Lit segments per hex digit — the truth table the logic below implements. */
export const HEX_GLYPHS: readonly string[] = [
  "abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc",
  "abcdefg", "abcdfg", "abcefg", "cdefg", "adef", "bcdeg", "adefg", "aefg",
];

// Multi-output minimized sum of products (found offline by search; tests check all 16 digits).
// Literals: aK = A[K], nK = ¬A[K]. Every product is one AND of two earlier nets, so products are
// shared between segments and 3/4-literal terms reuse 2-literal ones: 4 NOT + 22 AND + 28 OR.
const PRODUCTS: readonly [name: string, x: string, y: string][] = [
  // 2-literal
  ["a2a1", "a2", "a1"],
  ["n2n0", "n2", "n0"],
  ["n2n1", "n2", "n1"],
  ["a3n2", "a3", "n2"],
  ["n3a2", "n3", "a2"],
  ["a3n1", "a3", "n1"],
  ["a3a2", "a3", "a2"],
  ["a3a1", "a3", "a1"],
  ["n1n0", "n1", "n0"],
  ["a3a0", "a3", "a0"],
  ["n2a1", "n2", "a1"],
  ["a3n0", "a3", "n0"],
  ["a1a0", "a1", "a0"],
  // 3-literal, each built on a shared pair
  ["a3n2n1", "a3n2", "n1"],
  ["n3a1a0", "n3", "a1a0"],
  ["n3n1n0", "n3", "n1n0"],
  ["a3n1a0", "a3n1", "a0"],
  ["n2a1a0", "n2a1", "a0"],
  ["n3n2n0", "n3", "n2n0"],
  ["a2a1n0", "a2a1", "n0"],
  ["n3a2n1", "n3a2", "n1"],
  // 4-literal (digit 5 only)
  ["n3a2n1a0", "n3a2n1", "a0"],
];

/** Product terms ORed into each segment, a..g. */
const SEGMENTS: readonly (readonly string[])[] = [
  /* a */ ["n2n0", "a2a1", "n3a1a0", "a3n0", "a3n2n1", "n3a2n1a0"],
  /* b */ ["n2n0", "n2n1", "n3a1a0", "n3n1n0", "a3n1a0"],
  /* c */ ["n2n1", "n3a2", "a3n2", "n3a1a0", "a3n1a0"],
  /* d */ ["a3n1", "n3n2n0", "n2a1a0", "a2a1n0", "n3a2n1a0"],
  /* e */ ["n2n0", "a3a2", "a3a1", "a2a1n0"],
  /* f */ ["n1n0", "a3n2", "a3a1", "a2a1n0", "n3a2n1a0"],
  /* g */ ["n2a1", "a3a0", "a3n2n1", "n3a2n1", "a2a1n0"],
];

/** HEX7SEG — A[4] → SEG[7] (54 gates). */
export function defineHex7Seg(lib: Library): void {
  define(
    lib,
    "HEX7SEG",
    { in: { A: 4 }, out: { SEG: 7 } },
    (b) => {
      const [A, SEG] = [b.in("A"), b.out("SEG")];
      const net = new Map<string, string>();
      A.forEach((a, k) => {
        net.set(`a${k}`, a);
        net.set(`n${k}`, place(b, "NOT", `n${k}`, [a]));
      });
      const get = (x: string) => {
        const n = net.get(x);
        if (!n) throw new Error(`HEX7SEG: unknown term ${x}`);
        return n;
      };
      for (const [name, x, y] of PRODUCTS) net.set(name, place(b, "AND", name, [get(x), get(y)]));
      SEGMENTS.forEach((terms, s) => orTree(b, `seg_${"abcdefg"[s]}`, terms.map(get), SEG[s]));
    },
    "Hex to 7-segment decoder: SEG[0..6] = segments a..g, glyphs 0-9 A b C d E F",
  );
}
