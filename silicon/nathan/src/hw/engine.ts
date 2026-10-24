// ENGINE: the Figma OS editor as a gate-level machine. One clock tick is one editor event.
// The chart reads like a block diagram:
//
//   EVT ─► evdec ──► conds ──► layerctl ──► l0 … l7 (layer file: 8 × 24-bit records, stack order = slot)
//          (decode)   │  ▲  hit (HIT8)        ▲
//   PX PY ────────────┤  └─ free (FREESLOT)   │ next/prev record: delete and reorder shift whole records
//                     └──► state (sel hassel tool cur drag r1 r2)
//   plane (READPLANE) reads one record; geom (MOVE SPAN NUDGE) computes the new rectangle
//   newrec builds the data for a new / duplicated / refilled record
//   disp  decodes the registers into the lines the screen layers are bound to
//
// Everything is gates (REGS registers are gates too: latches). The rules of silicon/docs/SILICON.md
// apply: registers load on the rising edge, the load enables come from register outputs and
// combinational logic only. Behaviour is checked against os-ui/src/model.ts (test/hw.test.ts).
import { place } from "../../../src/cells/util";
import { define } from "../../../src/hdl/builder";
import { CONST0, CONST1, type Library } from "../../../src/netlist/types";
import { defineRegS } from "./cells";
import { type Bus, logic, slice, zeros } from "./dsl";
import { LAYERS, REC } from "./layout";
import { defineUnits } from "./units";

// ---------- event / mode decode ----------

function defineEvdec(lib: Library): void {
  define(
    lib,
    "EVDEC",
    {
      in: { EVT: 4, TOOL: 2, DRAG: 2 },
      out: {
        EV_TOOL: 1,
        EV_FILL: 1,
        EV_DOWN: 1,
        EV_MOVE: 1,
        EV_UP: 1,
        EV_SELECT: 1,
        EV_HANDLE: 1,
        EV_VIS: 1,
        EV_DEL: 1,
        EV_DUP: 1,
        EV_FWD: 1,
        EV_BACK: 1,
        EV_NUDGE: 1,
        EV_ESC: 1,
        IS_MOVE_TOOL: 1,
        CREATING: 1,
        DG: 4,
        DRAGGING: 1,
      },
    },
    (b) => {
      const L = logic(b);
      const [TOOL, DRAG] = [b.in("TOOL"), b.in("DRAG")];
      // one-hot event lines; the plain DOWN / MOVE / UP lines are ORed with CLICK below
      const pick = (name: string) => b.out1(name);
      const evNets = Array.from({ length: 16 }, (_, i) => b.wire1(`ev${i}`));
      const named: Record<number, string> = {
        1: "EV_TOOL",
        2: "EV_FILL",
        6: "EV_SELECT",
        7: "EV_HANDLE",
        8: "EV_VIS",
        9: "EV_DEL",
        10: "EV_DUP",
        11: "EV_FWD",
        12: "EV_BACK",
        13: "EV_NUDGE",
        14: "EV_ESC",
      };
      for (const [i, n] of Object.entries(named)) evNets[Number(i)] = pick(n);
      L.dec(b.in("EVT"), "evdec", evNets);
      b.use("DEC2", { A: DRAG, EN: CONST1, Y: b.out("DG") }, "dragdec");
      const dg = b.out("DG");
      place(
        b,
        "NOR",
        "is_move_tool",
        [TOOL[0], TOOL[1]],
        b.out1("IS_MOVE_TOOL"),
      );
      place(b, "NOT", "creating", [b.out1("IS_MOVE_TOOL")], b.out1("CREATING"));
      L.orAll([dg[1], dg[2], dg[3]], b.out1("DRAGGING"));
      const click = evNets[15];
      const dragging = b.out1("DRAGGING");
      // a click starts a drag when nothing is pending, and finishes it (MOVE then UP) when one is
      L.g("OR", [evNets[3], L.AND(click, dg[0])], b.out1("EV_DOWN"));
      L.g("OR", [evNets[4], L.AND(click, dragging)], b.out1("EV_MOVE"));
      L.g("OR", [evNets[5], L.AND(click, dragging)], b.out1("EV_UP"));
    },
    "event and mode decode: one line per event, tool and drag mode; CLICK = DOWN, or MOVE + UP while a drag is pending",
  );
}

// ---------- free slot ----------

function defineFreeslot(lib: Library): void {
  define(
    lib,
    "FREESLOT",
    { in: { USED: 8 }, out: { FF: 8, IDX: 3, ANY: 1 } },
    (b) => {
      const L = logic(b);
      const used = b.in("USED");
      const free = used.map((u) => L.NOT(u));
      const pfx: string[] = [];
      free.forEach((f, k) => pfx.push(k === 0 ? f : L.OR(pfx[k - 1], f)));
      const ff = b.out("FF");
      free.forEach((f, k) =>
        k === 0 ? L.buf(f, ff[0]) : L.g("AND", [f, L.NOT(pfx[k - 1])], ff[k]),
      );
      const idx = b.out("IDX");
      L.orAll([ff[1], ff[3], ff[5], ff[7]], idx[0]);
      L.orAll([ff[2], ff[3], ff[6], ff[7]], idx[1]);
      L.orAll([ff[4], ff[5], ff[6], ff[7]], idx[2]);
      L.buf(pfx[7], b.out1("ANY"));
    },
    "lowest unused layer slot: one-hot FF, its index, and whether any slot is free",
  );
}

// ---------- read plane ----------

function defineReadplane(lib: Library): void {
  define(
    lib,
    "READPLANE",
    {
      in: { SEL: 3, HIT_IDX: 3, USE_HIT: 1, REC: LAYERS * REC.bits },
      out: { OUT: REC.bits },
    },
    (b) => {
      const L = logic(b);
      const idx = L.mux2(b.in("SEL"), b.in("HIT_IDX"), b.in1("USE_HIT"));
      const pl = L.dec(idx, "pldec");
      const rec = b.in("REC");
      const out = b.out("OUT");
      for (let bit = 0; bit < REC.bits; bit++)
        L.orAll(
          pl.map((p, k) => L.AND(p, rec[k * REC.bits + bit])),
          out[bit],
        );
    },
    "reads one layer record: the layer under the pointer on DOWN, the selected layer otherwise",
  );
}

// ---------- geometry units + bus ----------

function defineGeom(lib: Library): void {
  define(
    lib,
    "GEOM",
    {
      in: {
        PX: 4,
        PY: 4,
        R1: 4,
        R2: 4,
        SELG: 16,
        EV_DOWN: 1,
        USE_MOVE: 1,
        USE_SPAN: 1,
        USE_NUDGE: 1,
        NR: 1,
        NL: 1,
        ND: 1,
        NU: 1,
        ARG: 2,
      },
      out: { G: 16, OFFS: 8, ANCH: 8 },
    },
    (b) => {
      const L = logic(b);
      const [PX, PY, R1, R2, SELG] = [
        b.in("PX"),
        b.in("PY"),
        b.in("R1"),
        b.in("R2"),
        b.in("SELG"),
      ];
      const [x0, x1, y0, y1] = [
        slice(SELG, 0, 4),
        slice(SELG, 1, 4),
        slice(SELG, 2, 4),
        slice(SELG, 3, 4),
      ];
      const mv = b.use(
        "MOVE",
        { PX, PY, OX: R1, OY: R2, X0: x0, X1: x1, Y0: y0, Y1: y1 },
        "move",
      );
      const sp = b.use(
        "SPAN",
        {
          AX: L.mux2(R1, PX, b.in1("EV_DOWN")),
          AY: L.mux2(R2, PY, b.in1("EV_DOWN")),
          PX,
          PY,
        },
        "span",
      );
      const nd = b.use(
        "NUDGE",
        {
          X0: x0,
          X1: x1,
          Y0: y0,
          Y1: y1,
          R: b.in1("NR"),
          L: b.in1("NL"),
          D: b.in1("ND"),
          U: b.in1("NU"),
        },
        "nudge",
      );
      const cat = (
        u: Record<string, Bus>,
        k: [string, string, string, string],
      ) => [...u[k[0]], ...u[k[1]], ...u[k[2]], ...u[k[3]]];
      L.andOr(
        [
          [b.in1("USE_MOVE"), cat(mv, ["NX0", "NX1", "NY0", "NY1"])],
          [b.in1("USE_SPAN"), cat(sp, ["X0", "X1", "Y0", "Y1"])],
          [b.in1("USE_NUDGE"), cat(nd, ["NX0", "NX1", "NY0", "NY1"])],
        ],
        16,
        b.out("G"),
      );
      // grab offsets (pointer - rectangle origin) and resize anchors (the corner opposite the handle)
      const sub4 = (A: Bus, B: Bus, name: string) =>
        b.use("ADDER_W4", { A, B: B.map((n) => L.NOT(n)), CI: CONST1 }, name).S;
      const dec1 = (A: Bus, name: string) =>
        b.use(
          "ADDER_W4",
          { A, B: [CONST1, CONST1, CONST1, CONST1], CI: CONST0 },
          name,
        ).S;
      const offs = b.out("OFFS");
      sub4(PX, x0, "oxn").forEach((n, i) => L.buf(n, offs[i]));
      sub4(PY, y0, "oyn").forEach((n, i) => L.buf(n, offs[4 + i]));
      const anch = b.out("ANCH");
      const arg = b.in("ARG");
      L.mux2(x0, dec1(x1, "x1m1"), arg[0], anch.slice(0, 4));
      L.mux2(y0, dec1(y1, "y1m1"), arg[1], anch.slice(4, 8));
    },
    "rectangle units (MOVE, SPAN, NUDGE) and their bus; also the grab offsets and the resize anchors",
  );
}

// ---------- conditions ----------

function defineConds(lib: Library): void {
  define(
    lib,
    "CONDS",
    {
      in: {
        EV_DOWN: 1,
        EV_MOVE: 1,
        EV_DEL: 1,
        EV_DUP: 1,
        EV_FWD: 1,
        EV_BACK: 1,
        EV_NUDGE: 1,
        EV_HANDLE: 1,
        IS_MOVE_TOOL: 1,
        CREATING: 1,
        DG: 4,
        HASSEL: 1,
        SEL: 3,
        USED: 8,
        HIT_ANY: 1,
        ANY_FREE: 1,
        ARG: 3,
      },
      out: {
        HIT_MOVE: 1,
        GRAB: 1,
        CREATE_OK: 1,
        DUP_OK: 1,
        HANDLE_OK: 1,
        DEL_OK: 1,
        FWD_OK: 1,
        BACK_OK: 1,
        NUDGE_OK: 1,
        MOVE_OK: 1,
        USE_MOVE: 1,
        USE_SPAN: 1,
        USE_NUDGE: 1,
        NR: 1,
        NL: 1,
        ND: 1,
        NU: 1,
        S1H: 8,
        ARGDEC: 8,
        USED_ARG: 1,
      },
    },
    (b) => {
      const L = logic(b);
      const dg = b.in("DG");
      const hassel = b.in1("HASSEL");
      const used = b.in("USED");
      const s1h = L.dec(b.in("SEL"), "seldec", b.out("S1H"));
      const argDec = L.dec(b.in("ARG"), "argdec", b.out("ARGDEC"));
      const usedNext = L.orAll(
        s1h.slice(0, 7).map((s, k) => L.AND(s, used[k + 1])),
      );
      L.g("AND", [b.in1("EV_DOWN"), b.in1("IS_MOVE_TOOL")], b.out1("HIT_MOVE"));
      L.g("AND", [b.out1("HIT_MOVE"), b.in1("HIT_ANY")], b.out1("GRAB"));
      L.g(
        "AND",
        [L.AND(b.in1("EV_DOWN"), b.in1("CREATING")), b.in1("ANY_FREE")],
        b.out1("CREATE_OK"),
      );
      L.g(
        "AND",
        [L.AND(b.in1("EV_DUP"), hassel), b.in1("ANY_FREE")],
        b.out1("DUP_OK"),
      );
      L.g("AND", [b.in1("EV_HANDLE"), hassel], b.out1("HANDLE_OK"));
      L.g("AND", [b.in1("EV_DEL"), hassel], b.out1("DEL_OK"));
      L.g("AND", [L.AND(b.in1("EV_FWD"), hassel), usedNext], b.out1("FWD_OK"));
      L.g(
        "AND",
        [L.AND(b.in1("EV_BACK"), hassel), L.NOT(s1h[0])],
        b.out1("BACK_OK"),
      );
      L.g("AND", [b.in1("EV_NUDGE"), hassel], b.out1("NUDGE_OK"));
      L.g(
        "AND",
        [L.AND(b.in1("EV_MOVE"), L.orAll([dg[1], dg[2], dg[3]])), hassel],
        b.out1("MOVE_OK"),
      );
      L.g("AND", [b.in1("EV_MOVE"), dg[1]], b.out1("USE_MOVE"));
      L.g(
        "OR",
        [L.AND(b.in1("EV_MOVE"), L.OR(dg[2], dg[3])), b.out1("CREATE_OK")],
        b.out1("USE_SPAN"),
      );
      L.g("OR", [b.in1("EV_NUDGE"), b.out1("DUP_OK")], b.out1("USE_NUDGE"));
      const arg = b.in("ARG");
      const argIs = (v: number) =>
        L.and3(
          b.in1("EV_NUDGE"),
          ...([0, 1, 2].map((i) => ((v >> i) & 1 ? arg[i] : L.NOT(arg[i]))) as [
            string,
            string,
            string,
          ]),
        );
      L.g("OR", [argIs(1), b.out1("DUP_OK")], b.out1("NR"));
      L.buf(argIs(0), b.out1("NL"));
      L.g("OR", [argIs(3), b.out1("DUP_OK")], b.out1("ND"));
      L.buf(argIs(2), b.out1("NU"));
      L.orAll(
        used.map((u, k) => L.AND(u, argDec[k])),
        b.out1("USED_ARG"),
      );
    },
    "what this event does to the layer stack: create / duplicate / delete / reorder / move are allowed?",
  );
}

// ---------- per-layer write controls ----------

function defineLayerctl(lib: Library): void {
  define(
    lib,
    "LAYERCTL",
    {
      in: {
        CREATE_OK: 1,
        DUP_OK: 1,
        DEL_OK: 1,
        FWD_OK: 1,
        BACK_OK: 1,
        MOVE_OK: 1,
        NUDGE_OK: 1,
        EV_FILL: 1,
        EV_VIS: 1,
        HASSEL: 1,
        S1H: 8,
        ARGDEC: 8,
        USED: 8,
        FF: 8,
      },
      out: { SBUS: 8, SNEXT: 8, SPREV: 8, WSEL: 8, WFILL: 8, WVIS: 8 },
    },
    (b) => {
      const L = logic(b);
      const [s1h, used, ff, argDec] = [
        b.in("S1H"),
        b.in("USED"),
        b.in("FF"),
        b.in("ARGDEC"),
      ];
      const [del, fwd, back] = [
        b.in1("DEL_OK"),
        b.in1("FWD_OK"),
        b.in1("BACK_OK"),
      ];
      const create = L.OR(b.in1("CREATE_OK"), b.in1("DUP_OK"));
      const writeSel = L.OR(b.in1("MOVE_OK"), b.in1("NUDGE_OK"));
      const prefix: string[] = []; // SEL <= k
      s1h.forEach((s, k) => prefix.push(k === 0 ? s : L.OR(prefix[k - 1], s)));
      const [sbus, snext, sprev, wsel, wfill, wvis] = [
        "SBUS",
        "SNEXT",
        "SPREV",
        "WSEL",
        "WFILL",
        "WVIS",
      ].map((n) => b.out(n));
      for (let k = 0; k < LAYERS; k++) {
        L.g("AND", [create, ff[k]], sbus[k]);
        const shiftDown = L.AND(L.AND(del, prefix[k]), used[k]); // delete: every layer from SEL up takes its upper neighbour
        if (k === 7) L.buf(shiftDown, snext[k]);
        else
          L.orAll(
            [shiftDown, L.AND(fwd, s1h[k]), L.AND(back, s1h[k + 1])],
            snext[k],
          );
        if (k === 0) L.buf(CONST0, sprev[k]);
        else L.g("OR", [L.AND(fwd, s1h[k - 1]), L.AND(back, s1h[k])], sprev[k]);
        L.g("AND", [s1h[k], writeSel], wsel[k]);
        L.g(
          "AND",
          [L.AND(b.in1("EV_FILL"), b.in1("HASSEL")), s1h[k]],
          wfill[k],
        );
        L.g("AND", [L.AND(b.in1("EV_VIS"), argDec[k]), used[k]], wvis[k]);
      }
    },
    "one write enable per layer: new record, take the upper / lower neighbour (delete, reorder), rectangle, fill, eye",
  );
}

// ---------- data for new records ----------

function defineNewrec(lib: Library): void {
  define(
    lib,
    "NEWREC",
    {
      in: { TOOL: 2, CUR: 4, EV_DUP: 1, EV_FILL: 1, ARG: 4, PREC: REC.bits },
      out: { FILLD: 4, KINDD: 2, VISD: 1 },
    },
    (b) => {
      const L = logic(b);
      const [tool, cur, arg, prec] = [
        b.in("TOOL"),
        b.in("CUR"),
        b.in("ARG"),
        b.in("PREC"),
      ];
      const dup = b.in1("EV_DUP");
      const isFrame = L.AND(tool[0], L.NOT(tool[1])); // a frame is white (palette 7), anything else takes the current colour
      const fresh = L.mux2(cur, [CONST1, CONST1, CONST1, CONST0], isFrame);
      const fromPlane = L.mux2(fresh, prec.slice(REC.fill, REC.fill + 4), dup);
      L.mux2(fromPlane, arg, b.in1("EV_FILL"), b.out("FILLD"));
      L.mux2(tool, prec.slice(REC.kind, REC.kind + 2), dup, b.out("KINDD"));
      L.g("OR", [L.NOT(dup), prec[REC.vis]], b.out1("VISD"));
    },
    "the data a new record starts with: colour (frame = white), kind = tool, visible; a duplicate copies the selected record",
  );
}

// ---------- state registers ----------

function defineState(lib: Library): void {
  define(
    lib,
    "STATE",
    {
      in: {
        CLK: 1,
        NCLK: 1,
        PX: 4,
        PY: 4,
        ARG: 4,
        EV_TOOL: 1,
        EV_FILL: 1,
        EV_SELECT: 1,
        EV_UP: 1,
        EV_ESC: 1,
        EV_DOWN: 1,
        CREATING: 1,
        DG2: 1,
        HIT_MOVE: 1,
        GRAB: 1,
        CREATE_OK: 1,
        DUP_OK: 1,
        HANDLE_OK: 1,
        DEL_OK: 1,
        FWD_OK: 1,
        BACK_OK: 1,
        ANY_FREE: 1,
        USED_ARG: 1,
        HIT_IDX: 3,
        FREE_IDX: 3,
        OFFS: 8,
        ANCH: 8,
      },
      out: { SEL: 3, HASSEL: 1, TOOL: 2, CUR: 4, DRAG: 2, R1: 4, R2: 4 },
    },
    (b) => {
      const L = logic(b);
      const [CLK, NCLK, PX, PY, ARG] = [
        b.in1("CLK"),
        b.in1("NCLK"),
        b.in("PX"),
        b.in("PY"),
        b.in("ARG"),
      ];
      const reg = (name: string, D: Bus, LOAD: string, Q: Bus) =>
        b.use(`REGS${Q.length}`, { D, LOAD, CLK, NCLK, Q }, name);
      const i1 = (n: string) => b.in1(n);
      const sel = b.out("SEL");
      const create = L.OR(i1("CREATE_OK"), i1("DUP_OK"));
      const selLoad = L.orAll([
        i1("HIT_MOVE"),
        i1("CREATE_OK"),
        i1("DUP_OK"),
        i1("EV_SELECT"),
        i1("FWD_OK"),
        i1("BACK_OK"),
      ]);
      const inc3 = b.use("INC_W3", { A: sel }, "selinc").Y;
      const dec3 = b
        .use(
          "ADDER_W4",
          {
            A: [...sel, CONST0],
            B: [CONST1, CONST1, CONST1, CONST1],
            CI: CONST0,
          },
          "seldecr",
        )
        .S.slice(0, 3);
      reg(
        "sel",
        L.andOr(
          [
            [i1("HIT_MOVE"), b.in("HIT_IDX")],
            [create, b.in("FREE_IDX")],
            [i1("EV_SELECT"), ARG.slice(0, 3)],
            [i1("FWD_OK"), inc3],
            [i1("BACK_OK"), dec3],
          ],
          3,
        ),
        selLoad,
        sel,
      );
      reg(
        "hassel",
        [
          L.orAll([
            i1("GRAB"),
            i1("CREATE_OK"),
            i1("DUP_OK"),
            L.AND(i1("EV_SELECT"), i1("USED_ARG")),
            i1("FWD_OK"),
            i1("BACK_OK"),
          ]),
        ],
        L.orAll([selLoad, i1("DEL_OK"), i1("EV_ESC")]),
        [b.out1("HASSEL")],
      );
      reg(
        "drag",
        [
          L.OR(i1("GRAB"), i1("HANDLE_OK")),
          L.OR(i1("CREATE_OK"), i1("HANDLE_OK")),
        ],
        L.orAll([
          i1("GRAB"),
          i1("CREATE_OK"),
          i1("HANDLE_OK"),
          i1("EV_UP"),
          i1("EV_ESC"),
        ]),
        b.out("DRAG"),
      );
      const noSlot = L.and3(
        i1("EV_DOWN"),
        i1("CREATING"),
        L.NOT(i1("ANY_FREE")),
      );
      reg(
        "tool",
        L.andOr([[i1("EV_TOOL"), ARG.slice(0, 2)]], 2),
        L.orAll([
          i1("EV_TOOL"),
          noSlot,
          L.AND(i1("EV_UP"), i1("DG2")),
          i1("EV_ESC"),
        ]),
        b.out("TOOL"),
      );
      reg("cur", ARG, i1("EV_FILL"), b.out("CUR"));
      const offs = b.in("OFFS");
      const anch = b.in("ANCH");
      const rLoad = L.orAll([i1("GRAB"), i1("CREATE_OK"), i1("HANDLE_OK")]);
      reg(
        "r1",
        L.andOr(
          [
            [i1("GRAB"), offs.slice(0, 4)],
            [i1("CREATE_OK"), PX],
            [i1("HANDLE_OK"), anch.slice(0, 4)],
          ],
          4,
        ),
        rLoad,
        b.out("R1"),
      );
      reg(
        "r2",
        L.andOr(
          [
            [i1("GRAB"), offs.slice(4, 8)],
            [i1("CREATE_OK"), PY],
            [i1("HANDLE_OK"), anch.slice(4, 8)],
          ],
          4,
        ),
        rLoad,
        b.out("R2"),
      );
    },
    "selection, tool, current colour, pending drag and the grab offset / resize anchor",
  );
}

// ---------- one layer ----------

function defineLayer(lib: Library): void {
  define(
    lib,
    "LAYER",
    {
      in: {
        CLK: 1,
        NCLK: 1,
        SBUS: 1,
        SNEXT: 1,
        SPREV: 1,
        WSEL: 1,
        WFILL: 1,
        WVIS: 1,
        GBUS: REC.geomBits,
        FILLD: 4,
        KINDD: 2,
        VISD: 1,
        NEXT: REC.bits,
        PREV: REC.bits,
      },
      out: { REC: REC.bits },
    },
    (b) => {
      const L = logic(b);
      const [CLK, NCLK] = [b.in1("CLK"), b.in1("NCLK")];
      const [sbus, snext, sprev] = [
        b.in1("SBUS"),
        b.in1("SNEXT"),
        b.in1("SPREV"),
      ];
      const rec = b.out("REC");
      const [next, prev] = [b.in("NEXT"), b.in("PREV")];
      const moves = L.orAll([sbus, snext, sprev]); // a record is loaded as a whole (new, or shifted from a neighbour)
      const reg = (
        name: string,
        D: Bus,
        LOAD: string,
        at: number,
        width: number,
      ) =>
        b.use(
          `REGS${width}`,
          { D, LOAD, CLK, NCLK, Q: rec.slice(at, at + width) },
          name,
        );
      const field = (bus: Bus, at: number, w: number) => bus.slice(at, at + w);
      const gather = (
        bus: Bus | null,
        nb: Bus,
        pv: Bus,
        at: number,
        w: number,
        own: Array<[string, Bus]> = [],
      ) =>
        L.andOr(
          [
            ...own,
            [snext, field(nb, at, w)],
            [sprev, field(pv, at, w)],
            ...(bus ? ([[sbus, bus]] as Array<[string, Bus]>) : []),
          ],
          w,
        );
      reg(
        "used",
        L.andOr(
          [
            [sbus, [CONST1]],
            [snext, [next[REC.used]]],
            [sprev, [prev[REC.used]]],
          ],
          1,
        ),
        moves,
        REC.used,
        1,
      );
      reg(
        "vis",
        L.andOr(
          [
            [sbus, [b.in1("VISD")]],
            [snext, [next[REC.vis]]],
            [sprev, [prev[REC.vis]]],
            [b.in1("WVIS"), [L.NOT(rec[REC.vis])]],
          ],
          1,
        ),
        L.OR(moves, b.in1("WVIS")),
        REC.vis,
        1,
      );
      reg(
        "kind",
        gather(b.in("KINDD"), next, prev, REC.kind, 2),
        moves,
        REC.kind,
        2,
      );
      reg(
        "geom",
        L.andOr(
          [
            [L.OR(sbus, b.in1("WSEL")), b.in("GBUS")],
            [snext, field(next, REC.geom, REC.geomBits)],
            [sprev, field(prev, REC.geom, REC.geomBits)],
          ],
          REC.geomBits,
        ),
        L.OR(moves, b.in1("WSEL")),
        REC.geom,
        REC.geomBits,
      );
      reg(
        "fill",
        L.andOr(
          [
            [L.OR(sbus, b.in1("WFILL")), b.in("FILLD")],
            [snext, field(next, REC.fill, 4)],
            [sprev, field(prev, REC.fill, 4)],
          ],
          4,
        ),
        L.OR(moves, b.in1("WFILL")),
        REC.fill,
        4,
      );
    },
    "one layer record in registers (used, vis, kind, rectangle, fill); loads a new record or its neighbour's",
  );
}

// ---------- screen decode ----------

function defineDisplay(lib: Library): void {
  define(
    lib,
    "DISPLAY",
    {
      in: {
        REC: LAYERS * REC.bits,
        SEL: 3,
        HASSEL: 1,
        TOOL: 2,
        DRAG: 2,
        CUR: 4,
      },
      out: {
        SHOW: 8,
        SELK: 8,
        NX1: 32,
        NY1: 32,
        KFR: 8,
        KRE: 8,
        KEL: 8,
        FILL1H: 128,
        CUR1H: 16,
        TOOL1H: 4,
        HOT: 4,
      },
    },
    (b) => {
      const L = logic(b);
      const rec = b.in("REC");
      const f = (k: number, at: number, w = 1) =>
        rec.slice(k * REC.bits + at, k * REC.bits + at + w);
      const [show, selk, nx1, ny1, kfr, kre, kel, fill1h] = [
        "SHOW",
        "SELK",
        "NX1",
        "NY1",
        "KFR",
        "KRE",
        "KEL",
        "FILL1H",
      ].map((n) => b.out(n));
      const seld = L.dec(b.in("SEL"), "seldec");
      for (let k = 0; k < LAYERS; k++) {
        L.g("AND", [f(k, REC.used)[0], f(k, REC.vis)[0]], show[k]);
        L.g("AND", [b.in1("HASSEL"), seld[k]], selk[k]);
        f(k, REC.x1, 4).forEach((n, i) => L.g("NOT", [n], nx1[k * 4 + i]));
        f(k, REC.y1, 4).forEach((n, i) => L.g("NOT", [n], ny1[k * 4 + i]));
        const [k0, k1] = f(k, REC.kind, 2);
        L.g("AND", [k0, L.NOT(k1)], kfr[k]);
        L.g("AND", [L.NOT(k0), k1], kre[k]);
        L.g("AND", [k0, k1], kel[k]);
        L.dec(f(k, REC.fill, 4), `fill${k}`, fill1h.slice(k * 16, k * 16 + 16));
      }
      L.dec(b.in("CUR"), "curdec", b.out("CUR1H"));
      const tool1h = L.dec(b.in("TOOL"), "tooldec", b.out("TOOL1H"));
      const dg = L.dec(b.in("DRAG"), "dragdec");
      const hot = b.out("HOT");
      L.g("AND", [dg[0], tool1h[0]], hot[0]); // nothing pending, move tool
      L.g("AND", [dg[0], L.NOT(tool1h[0])], hot[1]); // nothing pending, a creation tool
      L.buf(dg[1], hot[2]); // a move is pending
      L.g("OR", [dg[2], dg[3]], hot[3]); // a create / resize is pending
    },
    "the screen: the registers decoded into the lines the UI layers are bound to (visibility only, no code)",
  );
}

// ---------- the machine ----------

export function defineEngine(lib: Library): void {
  defineUnits(lib);
  for (const n of [1, 2, 3, 4, 16]) defineRegS(lib, n);
  if (lib.has("ENGINE")) return;
  defineEvdec(lib);
  defineFreeslot(lib);
  defineReadplane(lib);
  defineGeom(lib);
  defineConds(lib);
  defineLayerctl(lib);
  defineNewrec(lib);
  defineState(lib);
  defineLayer(lib);
  defineDisplay(lib);

  define(
    lib,
    "ENGINE",
    { in: { CLK: 1, PX: 4, PY: 4, EVT: 4, ARG: 4 }, out: { HIT: 1 } },
    (b) => {
      const L = logic(b);
      const [CLK, PX, PY, EVT, ARG] = [
        b.in1("CLK"),
        b.in("PX"),
        b.in("PY"),
        b.in("EVT"),
        b.in("ARG"),
      ];
      const NCLK = place(b, "NOT", "nclk", [CLK]);

      // state (register outputs); the field wires keep their names so probes and the screen can find them
      const layers = Array.from({ length: LAYERS }, (_, k) => ({
        used: b.wire1(`used${k}`),
        vis: b.wire1(`vis${k}`),
        kind: b.wire(`kind${k}`, 2),
        x0: b.wire(`x0_${k}`, 4),
        x1: b.wire(`x1_${k}`, 4),
        y0: b.wire(`y0_${k}`, 4),
        y1: b.wire(`y1_${k}`, 4),
        fill: b.wire(`fill${k}`, 4),
      }));
      type Rec = (typeof layers)[number];
      const recBus = (l: Rec): Bus => [
        l.used,
        l.vis,
        ...l.kind,
        ...l.x0,
        ...l.x1,
        ...l.y0,
        ...l.y1,
        ...l.fill,
      ];
      const sel = b.wire("sel", 3);
      const hassel = b.wire1("hassel");
      const tool = b.wire("tool", 2);
      const cur = b.wire("cur", 4);
      const drag = b.wire("drag", 2);
      const r1 = b.wire("r1", 4);
      const r2 = b.wire("r2", 4);
      const allRecs: Bus = layers.flatMap(recBus);
      const used = layers.map((l) => l.used);

      // decode
      const ev = Object.fromEntries(
        [
          "TOOL",
          "FILL",
          "DOWN",
          "MOVE",
          "UP",
          "SELECT",
          "HANDLE",
          "VIS",
          "DEL",
          "DUP",
          "FWD",
          "BACK",
          "NUDGE",
          "ESC",
        ].map((n) => [n, b.wire1(`ev_${n.toLowerCase()}`)]),
      );
      const isMoveTool = b.wire1("is_move_tool");
      const creating = b.wire1("creating");
      const dg = b.wire("dg", 4);
      const dragging = b.wire1("dragging");
      b.use(
        "EVDEC",
        {
          EVT,
          TOOL: tool,
          DRAG: drag,
          IS_MOVE_TOOL: isMoveTool,
          CREATING: creating,
          DG: dg,
          DRAGGING: dragging,
          ...Object.fromEntries(
            Object.entries(ev).map(([n, w]) => [`EV_${n}`, w]),
          ),
        },
        "evdec",
      );

      // search units
      const usable = layers.map((l) => L.AND(l.used, l.vis));
      const hit = b.use(
        "HIT8",
        {
          PX,
          PY,
          USED: usable,
          X0: layers.flatMap((l) => l.x0),
          Y0: layers.flatMap((l) => l.y0),
          X1: layers.flatMap((l) => l.x1),
          Y1: layers.flatMap((l) => l.y1),
        },
        "hit",
      );
      const ff = b.wire("ff", 8);
      const freeIdx = b.wire("free_idx", 3);
      const anyFree = b.wire1("any_free");
      b.use(
        "FREESLOT",
        { USED: used, FF: ff, IDX: freeIdx, ANY: anyFree },
        "free",
      );

      // conditions
      const c = Object.fromEntries(
        [
          "HIT_MOVE",
          "GRAB",
          "CREATE_OK",
          "DUP_OK",
          "HANDLE_OK",
          "DEL_OK",
          "FWD_OK",
          "BACK_OK",
          "NUDGE_OK",
          "MOVE_OK",
          "USE_MOVE",
          "USE_SPAN",
          "USE_NUDGE",
          "NR",
          "NL",
          "ND",
          "NU",
          "USED_ARG",
        ].map((n) => [n, b.wire1(n.toLowerCase())]),
      );
      const s1h = b.wire("s1h", 8);
      const argdec = b.wire("argdec", 8);
      b.use(
        "CONDS",
        {
          EV_DOWN: ev.DOWN,
          EV_MOVE: ev.MOVE,
          EV_DEL: ev.DEL,
          EV_DUP: ev.DUP,
          EV_FWD: ev.FWD,
          EV_BACK: ev.BACK,
          EV_NUDGE: ev.NUDGE,
          EV_HANDLE: ev.HANDLE,
          IS_MOVE_TOOL: isMoveTool,
          CREATING: creating,
          DG: dg,
          HASSEL: hassel,
          SEL: sel,
          USED: used,
          HIT_ANY: hit.ANY[0],
          ANY_FREE: anyFree,
          ARG: ARG.slice(0, 3),
          S1H: s1h,
          ARGDEC: argdec,
          ...c,
        },
        "conds",
      );

      // the selected / hit record and the rectangle units
      const prec = b.wire("prec", REC.bits);
      b.use(
        "READPLANE",
        {
          SEL: sel,
          HIT_IDX: hit.IDX,
          USE_HIT: ev.DOWN,
          REC: allRecs,
          OUT: prec,
        },
        "plane",
      );
      const g = b.wire("g", REC.geomBits);
      const offs = b.wire("offs", 8);
      const anch = b.wire("anch", 8);
      b.use(
        "GEOM",
        {
          PX,
          PY,
          R1: r1,
          R2: r2,
          SELG: prec.slice(REC.geom, REC.geom + REC.geomBits),
          EV_DOWN: ev.DOWN,
          USE_MOVE: c.USE_MOVE,
          USE_SPAN: c.USE_SPAN,
          USE_NUDGE: c.USE_NUDGE,
          NR: c.NR,
          NL: c.NL,
          ND: c.ND,
          NU: c.NU,
          ARG: ARG.slice(0, 2),
          G: g,
          OFFS: offs,
          ANCH: anch,
        },
        "geom",
      );

      // write controls and data for new records
      const lc = Object.fromEntries(
        ["SBUS", "SNEXT", "SPREV", "WSEL", "WFILL", "WVIS"].map((n) => [
          n,
          b.wire(n.toLowerCase(), LAYERS),
        ]),
      );
      b.use(
        "LAYERCTL",
        {
          CREATE_OK: c.CREATE_OK,
          DUP_OK: c.DUP_OK,
          DEL_OK: c.DEL_OK,
          FWD_OK: c.FWD_OK,
          BACK_OK: c.BACK_OK,
          MOVE_OK: c.MOVE_OK,
          NUDGE_OK: c.NUDGE_OK,
          EV_FILL: ev.FILL,
          EV_VIS: ev.VIS,
          HASSEL: hassel,
          S1H: s1h,
          ARGDEC: argdec,
          USED: used,
          FF: ff,
          ...lc,
        },
        "layerctl",
      );
      const filld = b.wire("filld", 4);
      const kindd = b.wire("kindd", 2);
      const visd = b.wire1("visd");
      b.use(
        "NEWREC",
        {
          TOOL: tool,
          CUR: cur,
          EV_DUP: ev.DUP,
          EV_FILL: ev.FILL,
          ARG,
          PREC: prec,
          FILLD: filld,
          KINDD: kindd,
          VISD: visd,
        },
        "newrec",
      );

      // the layer file
      layers.forEach((l, k) => {
        b.use(
          "LAYER",
          {
            CLK,
            NCLK,
            SBUS: lc.SBUS[k],
            SNEXT: lc.SNEXT[k],
            SPREV: lc.SPREV[k],
            WSEL: lc.WSEL[k],
            WFILL: lc.WFILL[k],
            WVIS: lc.WVIS[k],
            GBUS: g,
            FILLD: filld,
            KINDD: kindd,
            VISD: visd,
            NEXT: k < LAYERS - 1 ? recBus(layers[k + 1]) : zeros(REC.bits),
            PREV: k > 0 ? recBus(layers[k - 1]) : zeros(REC.bits),
            REC: recBus(l),
          },
          `l${k}`,
        );
      });

      // selection, tool, colour, pending drag
      b.use(
        "STATE",
        {
          CLK,
          NCLK,
          PX,
          PY,
          ARG,
          EV_TOOL: ev.TOOL,
          EV_FILL: ev.FILL,
          EV_SELECT: ev.SELECT,
          EV_UP: ev.UP,
          EV_ESC: ev.ESC,
          EV_DOWN: ev.DOWN,
          CREATING: creating,
          DG2: dg[2],
          HIT_MOVE: c.HIT_MOVE,
          GRAB: c.GRAB,
          CREATE_OK: c.CREATE_OK,
          DUP_OK: c.DUP_OK,
          HANDLE_OK: c.HANDLE_OK,
          DEL_OK: c.DEL_OK,
          FWD_OK: c.FWD_OK,
          BACK_OK: c.BACK_OK,
          ANY_FREE: anyFree,
          USED_ARG: c.USED_ARG,
          HIT_IDX: hit.IDX,
          FREE_IDX: freeIdx,
          OFFS: offs,
          ANCH: anch,
          SEL: sel,
          HASSEL: hassel,
          TOOL: tool,
          CUR: cur,
          DRAG: drag,
          R1: r1,
          R2: r2,
        },
        "state",
      );

      // the screen
      b.use(
        "DISPLAY",
        {
          REC: allRecs,
          SEL: sel,
          HASSEL: hassel,
          TOOL: tool,
          DRAG: drag,
          CUR: cur,
          SHOW: b.wire("show", 8),
          SELK: b.wire("selk", 8),
          NX1: b.wire("nx1", 32),
          NY1: b.wire("ny1", 32),
          KFR: b.wire("kfr", 8),
          KRE: b.wire("kre", 8),
          KEL: b.wire("kel", 8),
          FILL1H: b.wire("fill1h", 128),
          CUR1H: b.wire("cur1h", 16),
          TOOL1H: b.wire("tool1h", 4),
          HOT: b.wire("hot", 4),
        },
        "disp",
      );
      L.buf(hit.ANY[0], b.out1("HIT"));
    },
    "CPU NATHAN: the Figma OS editor as a gate-level machine; one tick = one editor event",
  );
}
