// Multiplexers. Wide muxes are flat AND-OR planes with one shared set of select inverters /
// decoded selects (cheaper than n copies of MUX2, each with its own NOT S).
import { define } from "../hdl/builder";
import type { Library } from "../netlist/types";
import { place } from "./util";

/** MUX2 — Y = S ? B : A (NOT + 2 AND + OR). */
export function defineMux2(lib: Library): void {
  define(
    lib,
    "MUX2",
    { in: { A: 1, B: 1, S: 1 }, out: { Y: 1 } },
    (b) => {
      const S = b.in1("S");
      const ns = place(b, "NOT", "ns", [S]);
      const pa = place(b, "AND", "pass_a", [b.in1("A"), ns]);
      const pb = place(b, "AND", "pass_b", [b.in1("B"), S]);
      place(b, "OR", "join", [pa, pb], b.out1("Y"));
    },
    "2:1 multiplexer: Y = S ? B : A",
  );
}

/** MUX2_W<n> — n-bit 2:1 mux: one shared NOT S, then per bit pass_a/pass_b/join (1 + 3n gates). */
export function defineMux2W(lib: Library, width: number): void {
  define(
    lib,
    `MUX2_W${width}`,
    { in: { A: width, B: width, S: 1 }, out: { Y: width } },
    (b) => {
      const [A, B, S, Y] = [b.in("A"), b.in("B"), b.in1("S"), b.out("Y")];
      const ns = place(b, "NOT", "ns", [S]);
      const pa = b.wire("pass_a", width);
      const pb = b.wire("pass_b", width);
      for (let i = 0; i < width; i++) {
        place(b, "AND", `pass_a${i}`, [A[i], ns], pa[i]);
        place(b, "AND", `pass_b${i}`, [B[i], S], pb[i]);
        place(b, "OR", `join${i}`, [pa[i], pb[i]], Y[i]);
      }
    },
    `${width}-bit 2:1 multiplexer: Y = S ? B : A`,
  );
}

/** MUX4_W<n> — n-bit 4:1 mux: S decoded once into one-hot selects (2 NOT + 4 AND), then per bit
 * 4 AND + a 2-level OR (6 + 7n gates). S=0 → A, 1 → B, 2 → C, 3 → D. */
export function defineMux4W(lib: Library, width: number): void {
  define(
    lib,
    `MUX4_W${width}`,
    { in: { A: width, B: width, C: width, D: width, S: 2 }, out: { Y: width } },
    (b) => {
      const ins = [b.in("A"), b.in("B"), b.in("C"), b.in("D")];
      const [s0, s1] = b.in("S");
      const Y = b.out("Y");
      const ns0 = place(b, "NOT", "ns0", [s0]);
      const ns1 = place(b, "NOT", "ns1", [s1]);
      const sel = [
        place(b, "AND", "sel_a", [ns1, ns0]),
        place(b, "AND", "sel_b", [ns1, s0]),
        place(b, "AND", "sel_c", [s1, ns0]),
        place(b, "AND", "sel_d", [s1, s0]),
      ];
      const pass = ["a", "b", "c", "d"].map((x) => b.wire(`pass_${x}`, width));
      const ab = b.wire("ab", width);
      const cd = b.wire("cd", width);
      for (let i = 0; i < width; i++) {
        ["a", "b", "c", "d"].forEach((x, k) => place(b, "AND", `pass_${x}${i}`, [ins[k][i], sel[k]], pass[k][i]));
        place(b, "OR", `ab${i}`, [pass[0][i], pass[1][i]], ab[i]);
        place(b, "OR", `cd${i}`, [pass[2][i], pass[3][i]], cd[i]);
        place(b, "OR", `join${i}`, [ab[i], cd[i]], Y[i]);
      }
    },
    `${width}-bit 4:1 multiplexer: Y = [A, B, C, D][S]`,
  );
}
