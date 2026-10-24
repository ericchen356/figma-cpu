// ENGINE v3: the whole budgeted editor as one single-cycle gate-level machine. One tick = one editor event.
//   state   : 8 layer records (used, vis, kind, x0 x1 y0 y1, fill) as an ordered stack, SEL/HASSEL, TOOL, CUR, DRAG, R1/R2
//   units   : HIT8, MOVE, SPAN, NUDGE, free-slot encoder, read plane on one layer, parallel record shift (delete / reorder)
//   EVT     : 1 TOOL 2 FILL 3 DOWN 4 MOVE 5 UP 6 SELECT 7 HANDLE 8 VIS 9 DELETE 10 DUP 11 FWD 12 BACK 13 NUDGE 14 ESC
import { place } from "../silicon/src/cells/util";
import { define } from "../silicon/src/hdl/builder";
import { CONST0, CONST1, type GateType, type Library } from "../silicon/src/netlist/types";
import { defineRegS } from "./defs";

export const EV = { NOP: 0, TOOL: 1, FILL: 2, DOWN: 3, MOVE: 4, UP: 5, SELECT: 6, HANDLE: 7, VIS: 8, DELETE: 9, DUP: 10, FWD: 11, BACK: 12, NUDGE: 13, ESC: 14 } as const;

export function defineEngine(lib: Library): void {
  for (const n of [1, 2, 3, 4, 16]) defineRegS(lib, n);
  define(lib, "ENGINE", { in: { CLK: 1, PX: 4, PY: 4, EVT: 4, ARG: 4 }, out: { HIT: 1 } }, (b) => {
    const CLK = b.in1("CLK"), PX = b.in("PX"), PY = b.in("PY"), EVT = b.in("EVT"), ARG = b.in("ARG");
    let n = 0;
    const g = (t: GateType, ins: string[]) => place(b, t, `g${n++}`, ins);
    const AND = (x: string, y: string) => g("AND", [x, y]);
    const OR = (x: string, y: string) => g("OR", [x, y]);
    const NOT = (x: string) => g("NOT", [x]);
    const reduceTree = (op: (x: string, y: string) => string, xs: string[], empty: string) => {
      if (!xs.length) return empty;
      let l = xs;
      while (l.length > 1) { const nx: string[] = []; for (let i = 0; i < l.length; i += 2) nx.push(i + 1 < l.length ? op(l[i], l[i + 1]) : l[i]); l = nx; }
      return l[0];
    };
    const orAll = (xs: string[]) => reduceTree(OR, xs, CONST0);
    const and3 = (x: string, y: string, z: string) => AND(AND(x, y), z);
    const mux2 = (A: string[], B: string[], S: string) => { const ns = NOT(S); return A.map((a, i) => OR(AND(a, ns), AND(B[i], S))); };
    const andOr = (terms: [string, string[]][], w: number) => Array.from({ length: w }, (_, i) => orAll(terms.map(([s, bus]) => AND(s, bus[i]))));
    const dec = (A: string[], name: string) => b.use(`DEC${A.length}`, { A, EN: CONST1 }, name).Y;
    const NCLK = place(b, "NOT", "nclk", [CLK]);
    const reg = (name: string, D: string[], LOAD: string, Q: string[]) => b.use(`REGS${Q.length}`, { D, LOAD, CLK, NCLK, Q }, name);

    // ---- state (register outputs)
    const L = Array.from({ length: 8 }, (_, k) => ({
      used: b.wire1(`used${k}`), vis: b.wire1(`vis${k}`), kind: b.wire(`kind${k}`, 2),
      x0: b.wire(`x0_${k}`, 4), y0: b.wire(`y0_${k}`, 4), x1: b.wire(`x1_${k}`, 4), y1: b.wire(`y1_${k}`, 4), fill: b.wire(`fill${k}`, 4),
    }));
    type Layer = (typeof L)[number];
    const geom = (l: Layer) => [...l.x0, ...l.x1, ...l.y0, ...l.y1];
    const sel = b.wire("sel", 3), hassel = b.wire1("hassel"), tool = b.wire("tool", 2), cur = b.wire("cur", 4);
    const drag = b.wire("drag", 2), r1 = b.wire("r1", 4), r2 = b.wire("r2", 4);

    // ---- decode
    const ev = dec(EVT, "evdec");
    const evTool = ev[1], evFill = ev[2], evDown = ev[3], evMove = ev[4], evUp = ev[5], evSelect = ev[6], evHandle = ev[7];
    const evVis = ev[8], evDel = ev[9], evDup = ev[10], evFwd = ev[11], evBack = ev[12], evNudge = ev[13], evEsc = ev[14];
    const isMoveTool = place(b, "NOR", "is_move_tool", [tool[0], tool[1]]);
    const creating = place(b, "NOT", "creating", [isMoveTool]);
    const dg = dec(drag, "dragdec"); // 0 none, 1 move, 2 create, 3 resize
    const dragging = orAll([dg[1], dg[2], dg[3]]);
    const s1h = dec(sel, "seldec");
    const argDec = dec(ARG.slice(0, 3), "argdec");

    // ---- hit test, free slot
    const usable = L.map((l) => AND(l.used, l.vis));
    const hit = b.use("HIT8", { PX, PY, USED: usable, X0: L.flatMap((l) => l.x0), Y0: L.flatMap((l) => l.y0), X1: L.flatMap((l) => l.x1), Y1: L.flatMap((l) => l.y1) }, "hit");
    const hitIdx = hit.IDX, hitAny = hit.ANY[0];
    const free = L.map((l) => NOT(l.used));
    const pfx: string[] = [];
    free.forEach((f, k) => pfx.push(k === 0 ? f : OR(pfx[k - 1], f)));
    const ff = free.map((f, k) => (k === 0 ? f : AND(f, NOT(pfx[k - 1]))));
    const anyFree = pfx[7];
    const freeIdx = [orAll([ff[1], ff[3], ff[5], ff[7]]), orAll([ff[2], ff[3], ff[6], ff[7]]), orAll([ff[4], ff[5], ff[6], ff[7]])];

    // ---- read plane: the layer at hit index (on DOWN) or at SEL (otherwise)
    const pIdx = mux2(sel, hitIdx, evDown);
    const pl = dec(pIdx, "pldec");
    const plane = (get: (l: Layer) => string[], w: number) => andOr(L.map((l, k) => [pl[k], get(l)] as [string, string[]]), w);
    const pX0 = plane((l) => l.x0, 4), pY0 = plane((l) => l.y0, 4), pX1 = plane((l) => l.x1, 4), pY1 = plane((l) => l.y1, 4);
    const pFill = plane((l) => l.fill, 4), pKind = plane((l) => l.kind, 2), pVis = plane((l) => [l.vis], 1)[0];

    // ---- controls
    const hitMove = AND(evDown, isMoveTool);
    const grab = AND(hitMove, hitAny);
    const createOk = and3(evDown, creating, anyFree);
    const dupOk = and3(evDup, hassel, anyFree);
    const handleOk = AND(evHandle, hassel);
    const delOk = AND(evDel, hassel);
    const usedNext = orAll(L.slice(0, 7).map((_, k) => AND(s1h[k], L[k + 1].used)));       // layer above SEL exists
    const selNot0 = NOT(s1h[0]);
    const fwdOk = and3(evFwd, hassel, usedNext);
    const backOk = and3(evBack, hassel, selNot0);
    const nudgeOk = AND(evNudge, hassel);
    const moveOk = and3(evMove, dragging, hassel);

    // ---- geometry units and the geometry bus
    const mv = b.use("MOVE", { PX, PY, OX: r1, OY: r2, X0: pX0, X1: pX1, Y0: pY0, Y1: pY1 }, "move");
    const sp = b.use("SPAN", { AX: mux2(r1, PX, evDown), AY: mux2(r2, PY, evDown), PX, PY }, "span");
    const argIs = (v: number) => and3(evNudge, ...([0, 1, 2].map((i) => ((v >> i) & 1 ? ARG[i] : NOT(ARG[i]))) as [string, string, string]));
    const nd = b.use("NUDGE", { X0: pX0, X1: pX1, Y0: pY0, Y1: pY1, R: OR(argIs(1), dupOk), L: argIs(0), D: OR(argIs(3), dupOk), U: argIs(2) }, "nudge");
    const useMove = AND(evMove, dg[1]);
    const useSpan = OR(AND(evMove, OR(dg[2], dg[3])), createOk);
    const useNudge = OR(evNudge, dupOk);
    const gbus = andOr([[useMove, [...mv.NX0, ...mv.NX1, ...mv.NY0, ...mv.NY1]], [useSpan, [...sp.X0, ...sp.X1, ...sp.Y0, ...sp.Y1]], [useNudge, [...nd.NX0, ...nd.NX1, ...nd.NY0, ...nd.NY1]]], 16);

    // ---- per-layer write controls
    const prefixSel: string[] = []; // sel <= k
    s1h.forEach((s, k) => prefixSel.push(k === 0 ? s : OR(prefixSel[k - 1], s)));
    const sBus = L.map((_, k) => AND(OR(createOk, dupOk), ff[k]));                            // new record from the buses
    const sNext = L.map((l, k) => (k === 7 ? AND(AND(delOk, prefixSel[k]), l.used)
      : orAll([AND(AND(delOk, prefixSel[k]), l.used), AND(fwdOk, s1h[k]), AND(backOk, s1h[k + 1])])));
    const sPrev = L.map((_, k) => (k === 0 ? CONST0 : OR(AND(fwdOk, s1h[k - 1]), AND(backOk, s1h[k]))));
    const wSel = L.map((_, k) => AND(s1h[k], OR(moveOk, nudgeOk)));                           // geometry write at SEL
    const wFill = L.map((_, k) => and3(evFill, hassel, s1h[k]));
    const wVis = L.map((l, k) => and3(evVis, argDec[k], l.used));
    const isFrame = AND(tool[0], NOT(tool[1]));
    const newFill = mux2(cur, [CONST1, CONST1, CONST1, CONST0], isFrame);
    const dupSel = evDup;
    const fillNew = mux2(newFill, pFill, dupSel);
    const kindNew = mux2(tool, pKind, dupSel);
    const visNew = OR(AND(NOT(dupSel), CONST1), AND(dupSel, pVis));

    L.forEach((l, k) => {
      const nx = k < 7 ? L[k + 1] : null, pv = k > 0 ? L[k - 1] : null;
      const any = (...xs: string[]) => orAll(xs.filter((x) => x !== CONST0));
      const terms = (bus: string[] | null, next: string[] | null, prev: string[] | null, w: number, busSel: string, extra: [string, string[]][] = []) => {
        const t: [string, string[]][] = [[busSel, bus ?? Array(w).fill(CONST0)], ...extra];
        if (next) t.push([sNext[k], next]);
        if (prev && k > 0) t.push([sPrev[k], prev]);
        return andOr(t, w);
      };
      reg(`l${k}_used`, terms(null, [nx?.used ?? CONST0], [pv?.used ?? CONST0], 1, CONST0, [[sBus[k], [CONST1]]]), any(sBus[k], sNext[k], sPrev[k]), [l.used]);
      reg(`l${k}_vis`, terms(null, [nx?.vis ?? CONST0], [pv?.vis ?? CONST0], 1, CONST0, [[sBus[k], [visNew]], [wVis[k], [NOT(l.vis)]]]), any(sBus[k], sNext[k], sPrev[k], wVis[k]), [l.vis]);
      reg(`l${k}_kind`, terms(null, nx?.kind ?? null, pv?.kind ?? null, 2, CONST0, [[sBus[k], kindNew]]), any(sBus[k], sNext[k], sPrev[k]), l.kind);
      reg(`l${k}_geom`, terms(null, nx ? geom(nx) : null, pv ? geom(pv) : null, 16, CONST0, [[OR(sBus[k], wSel[k]), gbus]]), any(sBus[k], wSel[k], sNext[k], sPrev[k]), geom(l));
      reg(`l${k}_fill`, terms(null, nx?.fill ?? null, pv?.fill ?? null, 4, CONST0, [[sBus[k], fillNew], [wFill[k], ARG]]), any(sBus[k], wFill[k], sNext[k], sPrev[k]), l.fill);
    });

    // ---- selection, tool, colour, drag state
    const usedArg = orAll(L.map((l, k) => AND(l.used, argDec[k])));
    const dec3 = (A: string[], name: string) => b.use("ADDER_W4", { A: [...A, CONST0], B: [CONST1, CONST1, CONST1, CONST1], CI: CONST0 }, name).S.slice(0, 3);
    const inc3 = b.use("INC_W3", { A: sel }, "selinc").Y;
    const selLoad = orAll([hitMove, createOk, dupOk, evSelect, fwdOk, backOk]);
    reg("sel", andOr([[hitMove, hitIdx], [OR(createOk, dupOk), freeIdx], [evSelect, ARG.slice(0, 3)], [fwdOk, inc3], [backOk, dec3(sel, "seldec1")]], 3), selLoad, sel);
    reg("hassel", [orAll([grab, createOk, dupOk, AND(evSelect, usedArg), fwdOk, backOk])], orAll([selLoad, delOk, evEsc]), [hassel]);
    reg("drag", [OR(grab, handleOk), OR(createOk, handleOk)], orAll([grab, createOk, handleOk, evUp, evEsc]), drag);
    reg("tool", andOr([[evTool, ARG.slice(0, 2)]], 2), orAll([evTool, and3(evDown, creating, NOT(anyFree)), AND(evUp, dg[2]), evEsc]), tool);
    reg("cur", ARG, evFill, cur);

    // ---- R1/R2: grab offset (move), anchor (create / resize)
    const sub4 = (A: string[], Bv: string[], name: string) => b.use("ADDER_W4", { A, B: Bv.map(NOT), CI: CONST1 }, name).S;
    const dec1 = (A: string[], name: string) => b.use("ADDER_W4", { A, B: [CONST1, CONST1, CONST1, CONST1], CI: CONST0 }, name).S;
    const oxn = sub4(PX, pX0, "oxn"), oyn = sub4(PY, pY0, "oyn");
    const anchorX = mux2(pX0, dec1(pX1, "x1m1"), ARG[0]), anchorY = mux2(pY0, dec1(pY1, "y1m1"), ARG[1]);
    const rLoad = orAll([grab, createOk, handleOk]);
    reg("r1", andOr([[grab, oxn], [createOk, PX], [handleOk, anchorX]], 4), rLoad, r1);
    reg("r2", andOr([[grab, oyn], [createOk, PY], [handleOk, anchorY]], 4), rLoad, r2);
    place(b, "BUF", "hit_out", [hitAny], b.out1("HIT"));
  }, "the editor engine v3: one tick = one editor event");
}
