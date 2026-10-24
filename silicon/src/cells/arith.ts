// Arithmetic cells: adders, incrementers and the zero detector.
import { define } from "../hdl/builder";
import type { Library } from "../netlist/types";
import { place } from "./util";

/** HALF_ADDER — S = A ⊕ B, CO = A·B. */
export function defineHalfAdder(lib: Library): void {
  define(
    lib,
    "HALF_ADDER",
    { in: { A: 1, B: 1 }, out: { S: 1, CO: 1 } },
    (b) => {
      const [A, B] = [b.in1("A"), b.in1("B")];
      place(b, "XOR", "sum", [A, B], b.out1("S"));
      place(b, "AND", "carry", [A, B], b.out1("CO"));
    },
    "Half adder: S = A ⊕ B, CO = A·B",
  );
}

/** FULL_ADDER — 2 XOR + 2 AND + OR: p = A⊕B, S = p⊕CI, CO = A·B + p·CI. */
export function defineFullAdder(lib: Library): void {
  define(
    lib,
    "FULL_ADDER",
    { in: { A: 1, B: 1, CI: 1 }, out: { S: 1, CO: 1 } },
    (b) => {
      const [A, B, CI] = [b.in1("A"), b.in1("B"), b.in1("CI")];
      const p = place(b, "XOR", "p", [A, B]); // propagate
      place(b, "XOR", "sum", [p, CI], b.out1("S"));
      const gen = place(b, "AND", "gen", [A, B]); // generate
      const pc = place(b, "AND", "pc", [p, CI]); // propagate the carry in
      place(b, "OR", "carry", [gen, pc], b.out1("CO"));
    },
    "Full adder: S = A ⊕ B ⊕ CI, CO = A·B + (A ⊕ B)·CI",
  );
}

/** ADDER_W<n> — ripple-carry adder of FULL_ADDER cells fa0..fa(n-1); carries c1..c(n-1). */
export function defineAdder(lib: Library, width: number): void {
  define(
    lib,
    `ADDER_W${width}`,
    { in: { A: width, B: width, CI: 1 }, out: { S: width, CO: 1 } },
    (b) => {
      const [A, B, S] = [b.in("A"), b.in("B"), b.out("S")];
      let carry = b.in1("CI");
      for (let i = 0; i < width; i++) {
        const co = i === width - 1 ? b.out1("CO") : b.wire1(`c${i + 1}`);
        b.use("FULL_ADDER", { A: A[i], B: B[i], CI: carry, S: S[i], CO: co }, `fa${i}`);
        carry = co;
      }
    },
    `${width}-bit ripple-carry adder: {CO, S} = A + B + CI`,
  );
}

/** INC_W<n> — Y = A + 1, CO = 1 iff A was all ones. Bit 0 is a NOT (its carry out is A[0]);
 * bits 1..n-1 are HALF_ADDER cells b1..b(n-1) adding the ripple carry. */
export function defineInc(lib: Library, width: number): void {
  if (width < 2) throw new Error(`INC_W${width}: width must be ≥ 2`);
  define(
    lib,
    `INC_W${width}`,
    { in: { A: width }, out: { Y: width, CO: 1 } },
    (b) => {
      const [A, Y] = [b.in("A"), b.out("Y")];
      place(b, "NOT", "b0", [A[0]], Y[0]);
      let carry = A[0];
      for (let i = 1; i < width; i++) {
        const co = i === width - 1 ? b.out1("CO") : b.wire1(`c${i + 1}`);
        b.use("HALF_ADDER", { A: A[i], B: carry, S: Y[i], CO: co }, `b${i}`);
        carry = co;
      }
    },
    `${width}-bit incrementer: {CO, Y} = A + 1`,
  );
}

/** ZERO_W<n> — Z = 1 iff A = 0: balanced OR tree, NOR at the root (n - 1 gates). */
export function defineZero(lib: Library, width: number): void {
  if (width < 2) throw new Error(`ZERO_W${width}: width must be ≥ 2`);
  define(
    lib,
    `ZERO_W${width}`,
    { in: { A: width }, out: { Z: 1 } },
    (b) => {
      let level = b.in("A");
      let depth = 1;
      while (level.length > 2) {
        const next: string[] = [];
        for (let i = 0; i < level.length; i += 2)
          next.push(i + 1 === level.length ? level[i] : place(b, "OR", `or${depth}_${i / 2}`, [level[i], level[i + 1]]));
        level = next;
        depth++;
      }
      place(b, "NOR", "nor", [level[0], level[1]], b.out1("Z"));
    },
    `${width}-bit zero detector: Z = 1 iff A = 0`,
  );
}
