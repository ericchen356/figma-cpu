// Gate-level units of the editor engine (all built from the repo's primitive gates and cells).
import { defineAdder } from "../silicon/src/cells/arith";
import { place } from "../silicon/src/cells/util";
import { constBus, define } from "../silicon/src/hdl/builder";
import { CONST0, CONST1, type Library } from "../silicon/src/netlist/types";
import { GRID_H, GRID_W } from "../os-ui/src/model";

export function defineRegS(lib: Library, n: number): void {
  if (lib.has(`REGS${n}`)) return;
  define(lib, `REGS${n}`, { in: { D: n, LOAD: 1, CLK: 1, NCLK: 1 }, out: { Q: n } }, (b) => {
    const [D, Q, LOAD, CLK, NCLK] = [b.in("D"), b.out("Q"), b.in1("LOAD"), b.in1("CLK"), b.in1("NCLK")];
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
  }, `${n}-bit register, shared enable: master open while ¬CLK·LOAD, slave open while CLK`);
}


export function defineUnits(lib: Library): void {
  defineAdder(lib, 4);
  defineAdder(lib, 5);
  // A >= B (unsigned, 4 bit) = carry out of A + ~B + 1: 17 gates.
  define(lib, "GE4", { in: { A: 4, B: 4 }, out: { GE: 1 } }, (b) => {
    const [A, B] = [b.in("A"), b.in("B")];
    const nb = B.map((x, i) => place(b, "NOT", `nb${i}`, [x]));
    let c = place(b, "OR", "c1", [A[0], nb[0]]);
    for (let i = 1; i < 4; i++) {
      const g = place(b, "AND", `g${i}`, [A[i], nb[i]]);
      const p = place(b, "OR", `p${i}`, [A[i], nb[i]]);
      const t = place(b, "AND", `t${i}`, [c, p]);
      c = place(b, "OR", `c${i + 1}`, [g, t], i === 3 ? b.out1("GE") : undefined);
    }
  }, "4-bit unsigned A >= B");

  // One layer under the pointer: used·(px >= x0)·(px < x1)·(py >= y0)·(py < y1).
  define(lib, "COVERS", { in: { PX: 4, PY: 4, USED: 1, X0: 4, Y0: 4, X1: 4, Y1: 4 }, out: { C: 1 } }, (b) => {
    const ge = (a: string[], bb: string[], n: string) => b.use("GE4", { A: a, B: bb }, n).GE[0];
    const gx0 = ge(b.in("PX"), b.in("X0"), "gx0"), gx1 = ge(b.in("PX"), b.in("X1"), "gx1");
    const gy0 = ge(b.in("PY"), b.in("Y0"), "gy0"), gy1 = ge(b.in("PY"), b.in("Y1"), "gy1");
    const ltx = place(b, "NOT", "ltx", [gx1]), lty = place(b, "NOT", "lty", [gy1]);
    const a = place(b, "AND", "a", [b.in1("USED"), gx0]);
    const c = place(b, "AND", "b", [a, ltx]);
    const d = place(b, "AND", "c", [c, gy0]);
    place(b, "AND", "d", [d, lty], b.out1("C"));
  }, "does this layer cover the pointer cell?");

  // All 8 layers at once; the topmost (highest index) wins.
  define(lib, "HIT8", { in: { PX: 4, PY: 4, USED: 8, X0: 32, Y0: 32, X1: 32, Y1: 32 }, out: { IDX: 3, ANY: 1 } }, (b) => {
    const c: string[] = [];
    for (let k = 0; k < 8; k++) {
      const s = (bus: string[]) => bus.slice(4 * k, 4 * k + 4);
      c.push(b.use("COVERS", { PX: b.in("PX"), PY: b.in("PY"), USED: b.in("USED")[k], X0: s(b.in("X0")), Y0: s(b.in("Y0")), X1: s(b.in("X1")), Y1: s(b.in("Y1")) }, `l${k}`).C[0]);
    }
    const pre: string[] = new Array(8);
    pre[7] = c[7];
    for (let k = 6; k >= 0; k--) pre[k] = place(b, "OR", `pre${k}`, [pre[k + 1], c[k]]);
    const h: string[] = new Array(8);
    h[7] = c[7];
    for (let k = 0; k < 7; k++) h[k] = place(b, "AND", `h${k}`, [c[k], place(b, "NOT", `npre${k}`, [pre[k + 1]])]);
    const idx = b.out("IDX");
    b.reduce("OR", [h[1], h[3], h[5], h[7]], idx[0]);
    b.reduce("OR", [h[2], h[3], h[6], h[7]], idx[1]);
    b.reduce("OR", [h[4], h[5], h[6], h[7]], idx[2]);
    place(b, "BUF", "any", [pre[0]], b.out1("ANY"));
  }, "topmost layer under the pointer");

  const moveAxis = (name: string, limit: number) =>
    define(lib, name, { in: { P: 4, O: 4, LO: 4, HI: 4 }, out: { NLO: 4, NHI: 4 } }, (b) => {
      const [P, O, LO, HI] = [b.in("P"), b.in("O"), b.in("LO"), b.in("HI")];
      const nLO = LO.map((x, i) => place(b, "NOT", `nlo${i}`, [x]));
      const w = b.use("ADDER_W4", { A: HI, B: nLO, CI: CONST1 }, "w").S;
      const nO = O.map((x, i) => place(b, "NOT", `no${i}`, [x]));
      const t = b.use("ADDER_W5", { A: [...P, CONST0], B: [...nO, CONST1], CI: CONST1 }, "t").S;
      const nW = w.map((x, i) => place(b, "NOT", `nw${i}`, [x]));
      const lim = b.use("ADDER_W4", { A: constBus(limit, 4), B: nW, CI: CONST1 }, "lim").S;
      const ok = b.use("GE4", { A: lim, B: t.slice(0, 4) }, "cmp").GE[0];
      const pick = b.use("MUX2_W4", { A: lim, B: t.slice(0, 4), S: ok }, "pick").Y;
      const notNeg = place(b, "NOT", "notneg", [t[4]]);
      const nlo = pick.map((x, i) => place(b, "AND", `nlo_${i}`, [x, notNeg], b.out("NLO")[i]));
      b.use("ADDER_W4", { A: nlo, B: w, CI: CONST0, S: b.out("NHI") }, "hi");
    }, `drag-move one axis: LO' = clamp(P - O, 0, ${limit} - w), HI' = LO' + w`);
  moveAxis("MOVE_X", GRID_W);
  moveAxis("MOVE_Y", GRID_H);
  define(lib, "MOVE", { in: { PX: 4, PY: 4, OX: 4, OY: 4, X0: 4, X1: 4, Y0: 4, Y1: 4 }, out: { NX0: 4, NX1: 4, NY0: 4, NY1: 4 } }, (b) => {
    b.use("MOVE_X", { P: b.in("PX"), O: b.in("OX"), LO: b.in("X0"), HI: b.in("X1"), NLO: b.out("NX0"), NHI: b.out("NX1") }, "x");
    b.use("MOVE_Y", { P: b.in("PY"), O: b.in("OY"), LO: b.in("Y0"), HI: b.in("Y1"), NLO: b.out("NY0"), NHI: b.out("NY1") }, "y");
  }, "drag-move a layer with clamping");
  define(lib, "SPAN_AXIS", { in: { A: 4, P: 4 }, out: { LO: 4, HI: 4 } }, (b) => {
    const [A, P] = [b.in("A"), b.in("P")];
    const ge = b.use("GE4", { A, B: P }, "cmp").GE[0];
    b.use("MUX2_W4", { A, B: P, S: ge, Y: b.out("LO") }, "lo");
    const mx = b.use("MUX2_W4", { A: P, B: A, S: ge }, "hi").Y;
    b.use("INC_W4", { A: mx, Y: b.out("HI") }, "inc");
  }, "span of two corner cells on one axis: LO = min, HI = max + 1");
  define(lib, "SPAN", { in: { AX: 4, AY: 4, PX: 4, PY: 4 }, out: { X0: 4, X1: 4, Y0: 4, Y1: 4 } }, (b) => {
    b.use("SPAN_AXIS", { A: b.in("AX"), P: b.in("PX"), LO: b.out("X0"), HI: b.out("X1") }, "x");
    b.use("SPAN_AXIS", { A: b.in("AY"), P: b.in("PY"), LO: b.out("Y0"), HI: b.out("Y1") }, "y");
  }, "create-drag / resize rectangle from two corner cells");
}

/** NUDGE: move a rectangle one cell, saturating at the canvas edge (arrow keys, duplicate offset). */
export function defineNudge(lib: Library): void {
  define(lib, "NUDGE", { in: { X0: 4, X1: 4, Y0: 4, Y1: 4, R: 1, L: 1, D: 1, U: 1 }, out: { NX0: 4, NX1: 4, NY0: 4, NY1: 4 } }, (b) => {
    let n = 0;
    const g = (t: "AND" | "OR" | "NOT", ins: string[]) => place(b, t, `g${n++}`, ins);
    const orAll = (xs: string[]) => xs.reduce((a, c) => g("OR", [a, c]));
    const andAll = (xs: string[]) => xs.reduce((a, c) => g("AND", [a, c]));
    const andOr = (terms: [string, string[]][]) => Array.from({ length: 4 }, (_, i) => orAll(terms.map(([s, bus]) => g("AND", [s, bus[i]]))));
    const axis = (lo: string[], hi: string[], plus: string, minus: string, limit: number, tag: string, outLo: string[], outHi: string[]) => {
      const edge = andAll(hi.map((x, i) => ((limit >> i) & 1 ? x : g("NOT", [x]))));        // hi == limit
      const canPlus = g("NOT", [edge]);
      const canMinus = orAll(lo);                                                              // lo != 0
      const goP = g("AND", [plus, canPlus]), goM = g("AND", [minus, canMinus]);
      const stay = g("NOT", [g("OR", [goP, goM])]);
      const incLo = b.use("INC_W4", { A: lo }, `${tag}il`).Y, incHi = b.use("INC_W4", { A: hi }, `${tag}ih`).Y;
      const decLo = b.use("ADDER_W4", { A: lo, B: [CONST1, CONST1, CONST1, CONST1], CI: CONST0 }, `${tag}dl`).S;
      const decHi = b.use("ADDER_W4", { A: hi, B: [CONST1, CONST1, CONST1, CONST1], CI: CONST0 }, `${tag}dh`).S;
      andOr([[goP, incLo], [goM, decLo], [stay, lo]]).forEach((x, i) => place(b, "BUF", `${tag}ol${i}`, [x], outLo[i]));
      andOr([[goP, incHi], [goM, decHi], [stay, hi]]).forEach((x, i) => place(b, "BUF", `${tag}oh${i}`, [x], outHi[i]));
    };
    axis(b.in("X0"), b.in("X1"), b.in1("R"), b.in1("L"), GRID_W, "x", b.out("NX0"), b.out("NX1"));
    axis(b.in("Y0"), b.in("Y1"), b.in1("D"), b.in1("U"), GRID_H, "y", b.out("NY0"), b.out("NY1"));
  }, "nudge a rectangle by one cell (R/L/D/U), stopping at the canvas edge");
}
