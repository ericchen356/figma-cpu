// One-hot decoders with an enable. Address inverters n0..n(k-1) are shared by every output;
// wider decoders predecode address-bit pairs and AND the partial terms together.
import { define, type ModuleBuilder } from "../hdl/builder";
import type { Library } from "../netlist/types";
import { place } from "./util";

/** The four minterms of an address-bit pair (lo, hi) in value order: ¬hi·¬lo, ¬hi·lo, hi·¬lo,
 * hi·lo, as gates `${p}0..3`. An enable is folded in first (`${en.name}0` = EN·¬hi,
 * `${en.name}1` = EN·hi) so all four are 0 when EN=0. `outs` overrides the output nets. */
function minterms2(
  b: ModuleBuilder,
  p: string,
  [lo, nlo]: [string, string],
  [hi, nhi]: [string, string],
  en?: { net: string; name: string },
  outs?: string[],
): string[] {
  const h = en
    ? [place(b, "AND", `${en.name}0`, [en.net, nhi]), place(b, "AND", `${en.name}1`, [en.net, hi])]
    : [nhi, hi];
  return [0, 1, 2, 3].map((v) => place(b, "AND", `${p}${v}`, [h[v >> 1], v & 1 ? lo : nlo], outs?.[v]));
}

const inverters = (b: ModuleBuilder, A: string[]) => A.map((a, i) => place(b, "NOT", `n${i}`, [a]));

/** DEC2 — 2 NOT + 6 AND. */
export function defineDec2(lib: Library): void {
  define(
    lib,
    "DEC2",
    { in: { A: 2, EN: 1 }, out: { Y: 4 } },
    (b) => {
      const A = b.in("A");
      const n = inverters(b, A);
      minterms2(b, "y", [A[0], n[0]], [A[1], n[1]], { net: b.in1("EN"), name: "en" }, b.out("Y"));
    },
    "2→4 one-hot decoder: Y[A] = EN, all other outputs 0",
  );
}

/** DEC3 — low pair predecoded (lo0..lo3), A[2] gated by EN (hi0, hi1), 8 output ANDs: 17 gates. */
export function defineDec3(lib: Library): void {
  define(
    lib,
    "DEC3",
    { in: { A: 3, EN: 1 }, out: { Y: 8 } },
    (b) => {
      const [A, EN, Y] = [b.in("A"), b.in1("EN"), b.out("Y")];
      const n = inverters(b, A);
      const lo = minterms2(b, "lo", [A[0], n[0]], [A[1], n[1]]);
      const hi = [place(b, "AND", "hi0", [EN, n[2]]), place(b, "AND", "hi1", [EN, A[2]])];
      for (let v = 0; v < 8; v++) place(b, "AND", `y${v}`, [hi[v >> 2], lo[v & 3]], Y[v]);
    },
    "3→8 one-hot decoder: Y[A] = EN, all other outputs 0",
  );
}

/** DEC4 — low pair predecoded (lo0..lo3), high pair predecoded with EN (hi0..hi3),
 * 16 output ANDs: 30 gates. */
export function defineDec4(lib: Library): void {
  define(
    lib,
    "DEC4",
    { in: { A: 4, EN: 1 }, out: { Y: 16 } },
    (b) => {
      const [A, EN, Y] = [b.in("A"), b.in1("EN"), b.out("Y")];
      const n = inverters(b, A);
      const lo = minterms2(b, "lo", [A[0], n[0]], [A[1], n[1]]);
      const hi = minterms2(b, "hi", [A[2], n[2]], [A[3], n[3]], { net: EN, name: "hi_en" });
      for (let v = 0; v < 16; v++) place(b, "AND", `y${v}`, [hi[v >> 2], lo[v & 3]], Y[v]);
    },
    "4→16 one-hot decoder: Y[A] = EN, all other outputs 0",
  );
}

/** DEC<N> for any N ≥ 2 (the wide RAMs use it from N = 5): address pairs predecoded from the low
 * bits up, the top group carrying EN (an odd top bit is a group of two: EN·¬a, EN·a), then the
 * groups ANDed together from the bottom, the last AND per output being Y. Returns the name. */
export function defineDecN(lib: Library, N: number): string {
  const name = `DEC${N}`;
  if (lib.has(name)) return name;
  if (N < 2) throw new Error(`DEC${N}: needs at least 2 address bits`);
  define(
    lib,
    name,
    { in: { A: N, EN: 1 }, out: { Y: 1 << N } },
    (b) => {
      const [A, EN, Y] = [b.in("A"), b.in1("EN"), b.out("Y")];
      const n = inverters(b, A);
      const groups: string[][] = [];
      for (let lo = 0, g = 0; lo < N; lo += 2, g++) {
        const en = lo + 2 >= N ? { net: EN, name: `g${g}_en` } : undefined;
        if (lo + 1 < N) groups.push(minterms2(b, `g${g}_`, [A[lo], n[lo]], [A[lo + 1], n[lo + 1]], en));
        else groups.push([place(b, "AND", `g${g}_0`, [EN, n[lo]]), place(b, "AND", `g${g}_1`, [EN, A[lo]])]);
      }
      let acc = groups[0];
      for (let g = 1; g < groups.length; g++) {
        const [low, hi, last] = [acc, groups[g], g === groups.length - 1];
        acc = Array.from({ length: low.length * hi.length }, (_, v) =>
          place(b, "AND", last ? `y${v}` : `c${g}_${v}`, [hi[Math.floor(v / low.length)], low[v % low.length]], last ? Y[v] : undefined),
        );
      }
    },
    `${N}→${1 << N} one-hot decoder: Y[A] = EN, all other outputs 0`,
  );
  return name;
}
