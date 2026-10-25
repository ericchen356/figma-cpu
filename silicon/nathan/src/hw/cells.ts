// Cells of CPU NATHAN that the generic silicon library does not have.
//   REGS<n>  an n-bit register whose bits share ONE load enable and the global inverted clock:
//            men = ¬CLK·LOAD (shared), master latch open while men, slave latch open while CLK.
//            6 gates per bit + 2 per register, against 10 per bit for DFFE (which carries its own
//            clock inverter and enable gate). Idle registers cost nothing in a Figma event: the
//            whole group sits behind `if (men)`.
//   RAMW<n>  an n-bit RAM word: ONE latch per bit (no slave), open while its word line and bit line
//            are both selected, men = ROW·COL. ROW carries ¬CLK, so a word is written only in the
//            LOW pass, from data that is stable then (silicon/docs/SILICON.md §2, rule 3). 3 gates
//            per bit + 2 per word, against 6 + 2 for REGS: the paint plane is 140 of them.
//   GE4      unsigned 4-bit A >= B, the carry out of A + ¬B + 1 (17 gates).
import { define } from "../../../src/hdl/builder";
import { place } from "../../../src/cells/util";
import type { Library } from "../../../src/netlist/types";

export function defineRegS(lib: Library, n: number): void {
  if (lib.has(`REGS${n}`)) return;
  define(
    lib,
    `REGS${n}`,
    { in: { D: n, LOAD: 1, CLK: 1, NCLK: 1 }, out: { Q: n } },
    (b) => {
      const [D, Q, LOAD, CLK, NCLK] = [
        b.in("D"),
        b.out("Q"),
        b.in1("LOAD"),
        b.in1("CLK"),
        b.in1("NCLK"),
      ];
      const men = place(b, "AND", "men", [NCLK, LOAD]);
      const nmen = place(b, "NOT", "nmen", [men]);
      for (let i = 0; i < n; i++) {
        const m = b.wire1(`m${i}`);
        const take = place(b, "AND", `m${i}_take`, [D[i], men]);
        const hold = place(b, "AND", `m${i}_hold`, [m, nmen]);
        place(b, "OR", `m${i}_merge`, [take, hold], m);
        const st = place(b, "AND", `s${i}_take`, [m, CLK]);
        const sh = place(b, "AND", `s${i}_hold`, [Q[i], NCLK]);
        place(b, "OR", `s${i}_merge`, [st, sh], Q[i]);
      }
    },
    `${n}-bit register, shared enable: master open while ¬CLK·LOAD, slave open while CLK`,
  );
}

export function defineRamWord(lib: Library, n: number): void {
  if (lib.has(`RAMW${n}`)) return;
  define(
    lib,
    `RAMW${n}`,
    { in: { D: n, ROW: 1, COL: 1 }, out: { Q: n } },
    (b) => {
      const [D, Q] = [b.in("D"), b.out("Q")];
      // the same names as a register's master latch (m<i>_take / _hold / _merge behind men): the
      // reaction compiler treats a word as a register whose master is its output
      const men = place(b, "AND", "men", [b.in1("ROW"), b.in1("COL")]);
      const nmen = place(b, "NOT", "nmen", [men]);
      for (let i = 0; i < n; i++) {
        const take = place(b, "AND", `m${i}_take`, [D[i], men]);
        const hold = place(b, "AND", `m${i}_hold`, [Q[i], nmen]);
        place(b, "OR", `m${i}_merge`, [take, hold], Q[i]);
      }
    },
    `${n}-bit RAM word: one latch per bit, open while ROW·COL (ROW = ¬CLK · word line)`,
  );
}

export function defineGe4(lib: Library): void {
  if (lib.has("GE4")) return;
  define(
    lib,
    "GE4",
    { in: { A: 4, B: 4 }, out: { GE: 1 } },
    (b) => {
      const [A, B] = [b.in("A"), b.in("B")];
      const nb = B.map((x, i) => place(b, "NOT", `nb${i}`, [x]));
      let c = place(b, "OR", "c1", [A[0], nb[0]]);
      for (let i = 1; i < 4; i++) {
        const gen = place(b, "AND", `g${i}`, [A[i], nb[i]]);
        const prop = place(b, "OR", `p${i}`, [A[i], nb[i]]);
        const carry = place(b, "AND", `t${i}`, [c, prop]);
        c = place(
          b,
          "OR",
          `c${i + 1}`,
          [gen, carry],
          i === 3 ? b.out1("GE") : undefined,
        );
      }
    },
    "4-bit unsigned A >= B (carry out of A + ¬B + 1)",
  );
}
