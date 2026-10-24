// The synthesizer on small hand-written programs, one construct at a time: the gate-level OS
// (silicon FastSim, RefSim for some) must hold exactly what the truncating reference holds after
// every event, and the pieces of the contract that are not values (EVT codes, which registers
// load, which modules exist) are checked directly.
import { describe, expect, it } from "vitest";
import { powerOn } from "../../silicon/src/compile";
import { flatten } from "../../silicon/src/netlist/flatten";
import { RefSim } from "../../silicon/src/sim/reference";
import { GateMachine, ReactionMachine, synthesize } from "../src/gates";
import {
  add,
  and,
  bool,
  div,
  eq,
  ge,
  gt,
  half,
  le,
  lt,
  mul,
  ne,
  neg,
  not,
  num,
  or,
  ref,
  seq,
  set,
  sub,
  switchOn,
  unit,
  when,
  type Expr,
  type FlowEvent,
  type Program,
  type Step,
  type VarDecl,
} from "../src/ir";
import { lockstep, randomEvents, rng } from "./gates-support";

const ev = (id: string, ...steps: Step[][]): FlowEvent => ({
  id,
  node: id,
  trigger: { type: "click" },
  steps: seq(...steps),
});
const n = (
  name: string,
  bits: number,
  signed: boolean,
  init: number,
  role: VarDecl["role"] = "state",
): VarDecl => ({ name, ty: "num", init, role, bits, signed });
const b = (
  name: string,
  init: boolean,
  role: VarDecl["role"] = "state",
): VarDecl => ({ name, ty: "bool", init, role });

/** The editor in miniature: four slots of (x, c), a selection, a scratch record and a clipboard,
 * written the way docs/GATES.md §1 asks (load the selected slot, compute, store it back). */
const MINI: Program = (() => {
  const SLOTS = [0, 1, 2, 3];
  const sel = ref("sel");
  const slot = (i: number) => (f: string) => `L${i}/${f}`;
  const TMP = (f: string) => `tmp/${f}`;
  const copy = (dst: (f: string) => string, src: (f: string) => string) =>
    seq(set(dst("x"), ref(src("x"))), set(dst("c"), ref(src("c"))));
  const isSel = ge(sel, num(0));
  const load = switchOn(sel, 0, 3, (i) => [copy(TMP, slot(i))]);
  const store = switchOn(sel, 0, 3, (i) => [set(`L${i}/x`, ref("tmp/x"))]);
  const nudge = (d: number) => {
    const t = add(ref("tmp/x"), num(d));
    return unit(
      "nudge",
      when(isSel, [
        load,
        when(
          lt(t, num(-20)),
          [set("tmp/x", num(-20))],
          [when(gt(t, num(20)), [set("tmp/x", num(20))], [set("tmp/x", t)])],
        ),
        store,
      ]),
    );
  };
  const remove = unit(
    "remove",
    when(isSel, [
      ...[0, 1, 2].map((j) =>
        when(le(sel, num(j)), [copy(slot(j), slot(j + 1))]),
      ),
      set("sel", num(-1)),
    ]),
  );
  // Loads straight into the clipboard, as the editor's copy does: the same switch as `load`.
  const copySel = unit(
    "copy",
    when(isSel, [switchOn(sel, 0, 3, (i) => [set("clip/x", ref(`L${i}/x`))])]),
  );
  const events: FlowEvent[] = [
    ...[-1, 0, 1, 2, 3].map((i) =>
      ev(`select/${i}`, unit("select", set("sel", num(i)))),
    ),
    ev("nudge/right", nudge(1)),
    ev("nudge/left", nudge(-1)),
    ev("delete", remove),
    ev(
      "up",
      unit(
        "reorder",
        when(and(isSel, lt(sel, num(3))), [
          switchOn(sel, 0, 2, (i) => [
            copy(TMP, slot(i)),
            copy(slot(i), slot(i + 1)),
            copy(slot(i + 1), TMP),
          ]),
          set("sel", add(sel, num(1))),
        ]),
      ),
    ),
    ev("copy", copySel),
    // Cut writes the clipboard with the same multiplexer as copy, so the two share one D term.
    ev("cut", copySel, remove),
    ...[0, 1, 2, 3].map((k) =>
      ev(
        `recolor/${k}`,
        unit(
          "recolor",
          when(isSel, [switchOn(sel, 0, 3, (i) => [set(`L${i}/c`, num(k))])]),
        ),
      ),
    ),
  ];
  return {
    vars: [
      n("sel", 3, true, -1),
      ...SLOTS.flatMap((i) => [
        n(`L${i}/x`, 6, true, i * 3 - 4),
        n(`L${i}/c`, 2, false, i % 4),
      ]),
      n("tmp/x", 6, true, 0, "temp"),
      n("tmp/c", 2, false, 0, "temp"),
      n("clip/x", 6, true, 0),
    ],
    events,
  };
})();
/** Gates of MINI when this test was written; 410 of them are its 41 register bits. */
const MINI_GATES = 773;

describe("gates: hand-written programs", () => {
  it("a counter wraps at its declared width, unsigned and two's complement", () => {
    const p: Program = {
      vars: [n("c", 3, false, 6), n("s", 4, true, -7)],
      events: [
        ev("inc", set("c", add(ref("c"), num(1)))),
        ev("dec", set("s", sub(ref("s"), num(1)))),
      ],
    };
    for (const reference of [false, true]) {
      const m = new GateMachine(synthesize(p), { reference });
      expect([m.read("c"), m.read("s")]).toEqual([6, -7]);
      for (let i = 0; i < 9; i++) m.fire("inc");
      expect(m.read("c")).toBe(7); // (6 + 9) mod 8
      for (const want of [-8, 7, 6]) {
        m.fire("dec");
        expect(m.read("s")).toBe(want);
      }
      expect(m.read("c")).toBe(7);
    }
  });

  it("nested ifs, temps and a unit: a clamped accumulator", () => {
    const x = ref("x");
    const t = ref("t");
    const p: Program = {
      vars: [
        n("x", 5, true, 0),
        n("t", 6, true, 0, "temp"),
        n("d", 3, true, 0, "input"),
        b("hit", false),
      ],
      events: [
        ev(
          "step",
          unit(
            "clamp",
            set("t", add(x, ref("d"))),
            when(
              lt(t, num(-10)),
              [set("t", num(-10)), set("hit", bool(true))],
              [
                when(
                  gt(t, num(10)),
                  [set("t", num(10)), set("hit", bool(true))],
                  [set("hit", bool(false))],
                ),
              ],
            ),
            set("x", t),
          ),
        ),
        // Reads the temp before writing it: it starts every event at 0.
        ev("peek", set("x", add(t, num(1)))),
      ],
    };
    const syn = synthesize(p);
    expect(syn.lib.has("U_clamp")).toBe(true);
    expect(syn.stats.byModule.U_clamp).toBeGreaterThan(0);
    const m = new GateMachine(syn);
    const seqOf: [number, number, boolean][] = [
      [3, 3, false],
      [3, 6, false],
      [3, 9, false],
      [3, 10, true],
      [-4, 6, false],
      [-4, 2, false],
      [-4, -2, false],
      [-4, -6, false],
      [-4, -10, false],
      [-1, -10, true],
    ];
    for (const [d, x1, hit] of seqOf) {
      m.fire("step", { d });
      expect([m.read("x"), m.read("hit")]).toEqual([x1, hit]);
    }
    m.fire("peek");
    expect(m.read("x")).toBe(1);
    lockstep(
      p,
      syn,
      new GateMachine(syn, { reference: true }),
      randomEvents(rng(7), p, 60),
      "clamp",
    );
  });

  it("half is floor(x / 2), also for negative x, and truncates into its destination", () => {
    const p: Program = {
      vars: [
        n("h", 4, true, 0),
        n("u", 2, false, 0),
        n("a", 5, true, 0, "input"),
      ],
      events: [
        ev("half", half("h", ref("a")), half("u", add(ref("a"), num(16)))),
      ],
    };
    const m = new GateMachine(synthesize(p));
    for (let a = -16; a <= 15; a++) {
      m.fire("half", { a });
      expect(m.read("h"), `half(${a})`).toBe(Math.floor(a / 2));
      expect(m.read("u"), `half(${a} + 16) mod 4`).toBe(
        Math.floor((a + 16) / 2) % 4,
      );
    }
  });

  it("every operator, signed and unsigned, exhaustively over two small inputs", () => {
    const a = ref("a");
    const bb = ref("b");
    const ops: [string, Expr, VarDecl][] = [
      ["add", add(a, bb), n("r_add", 5, true, 0)],
      ["sub", sub(a, bb), n("r_sub", 5, true, 0)],
      ["rsub", sub(bb, a), n("r_rsub", 5, true, 0)],
      ["mul", mul(a, bb), n("r_mul", 7, true, 0)],
      ["mulk", mul(a, num(-3)), n("r_mulk", 6, true, 0)],
      ["neg", neg(a), n("r_neg", 5, true, 0)],
      ["div", div(bb, num(1)), n("r_div", 3, false, 0)],
      ["trunc", mul(a, bb), n("r_trunc", 3, false, 0)], // the product wrapped into 3 unsigned bits
      ["trunc_s", add(a, num(9)), n("r_trunc_s", 3, true, 0)],
      ["lt", lt(a, bb), b("r_lt", false)],
      ["le", le(a, bb), b("r_le", false)],
      ["gt", gt(a, bb), b("r_gt", false)],
      ["ge", ge(a, bb), b("r_ge", false)],
      ["eq", eq(a, bb), b("r_eq", false)],
      ["ne", ne(a, bb), b("r_ne", false)],
      ["eqk", eq(a, num(-3)), b("r_eqk", false)],
      ["ltk", lt(a, num(5)), b("r_ltk", true)],
      ["and", and(lt(a, num(0)), gt(bb, num(3))), b("r_and", false)],
      ["or", or(lt(a, num(-4)), eq(bb, num(7))), b("r_or", false)],
      ["not", not(ge(a, bb)), b("r_not", false)],
      ["beq", eq(lt(a, num(0)), lt(bb, num(4))), b("r_beq", false)],
      ["bne", ne(lt(a, num(0)), lt(bb, num(4))), b("r_bne", false)],
    ];
    const p: Program = {
      vars: [
        n("a", 4, true, 0, "input"),
        n("b", 3, false, 0, "input"),
        ...ops.map(([, , d]) => d),
      ],
      events: ops.map(([id, e, d]) => ev(id, set(d.name, e))),
    };
    const syn = synthesize(p);
    const events: [string, Record<string, number>][] = [];
    for (let av = -8; av <= 7; av++)
      for (let bv = 0; bv <= 7; bv++)
        for (const [id] of ops) events.push([id, { a: av, b: bv }]);
    lockstep(p, syn, new GateMachine(syn), events, "operators");
    lockstep(
      p,
      syn,
      new GateMachine(syn, { reference: true }),
      events.filter((_, i) => i % 7 === 0),
      "operators (RefSim)",
    );
  });

  it("view writes are not synthesized; a view read that reaches a register is an error", () => {
    const p: Program = {
      vars: [
        n("x", 4, false, 1),
        { name: "label", ty: "str", init: "", role: "view" },
        n("shown", 4, false, 0, "view"),
      ],
      events: [
        ev(
          "go",
          set("label", { k: "str", v: "hello" }),
          set("shown", add(ref("x"), num(1))),
          set("x", add(ref("x"), num(2))),
        ),
      ],
    };
    const m = new GateMachine(synthesize(p));
    m.fire("go");
    expect(m.read("x")).toBe(3);
    expect(() => m.read("shown")).toThrow(/not a state variable/);
    const bad: Program = {
      vars: p.vars,
      events: [ev("go", set("x", ref("shown")))],
    };
    expect(() => synthesize(bad)).toThrow(/view variable shown/);
    const badIf: Program = {
      vars: p.vars,
      events: [ev("go", when(eq(ref("shown"), num(0)), [set("x", num(1))]))],
    };
    expect(() => synthesize(badIf)).toThrow(/view variable shown/);
  });

  it("boolean multiplexers that fold into AND / OR / XOR", () => {
    // if c then f = <x> else f = <y>, for every shape the DAG simplifies.
    const c = lt(ref("a"), num(0));
    const d = gt(ref("a"), num(-3));
    const shapes: [string, Expr, Expr][] = [
      ["c_t", c, d],
      ["c_e", d, c],
      ["nc_t", not(c), d],
      ["nc_e", d, not(c)],
      ["one", bool(true), d],
      ["zero", bool(false), d],
      ["e_one", d, bool(true)],
      ["e_zero", d, bool(false)],
      ["flip", not(d), d],
      ["same", d, d],
    ];
    const p: Program = {
      vars: [
        n("a", 4, true, 0, "input"),
        ...shapes.map(([id]) => b(`f_${id}`, false)),
      ],
      events: [
        ...shapes.map(([id, x, y]) =>
          ev(id, when(c, [set(`f_${id}`, x)], [set(`f_${id}`, y)])),
        ),
        ...shapes.map(([id, x, y]) =>
          ev(
            `${id}_not`,
            when(not(c), [set(`f_${id}`, y)], [set(`f_${id}`, x)]),
          ),
        ),
      ],
    };
    const syn = synthesize(p);
    const events: [string, Record<string, number>][] = [];
    for (let a = -8; a <= 7; a++)
      for (const e of p.events) events.push([e.id, { a }]);
    lockstep(p, syn, new GateMachine(syn), events, "bool ite");
  });

  it("const variables are their value; a write must give that same value", () => {
    const vars = [
      n("x", 6, true, 0),
      n("k", 4, true, -3, "const"),
      b("flag", true, "const"),
    ];
    const p: Program = {
      vars,
      events: [
        ev(
          "go",
          set("k", num(-3)),
          set("x", sub(ref("x"), ref("k"))),
          when(ref("flag"), [set("x", add(ref("x"), num(10)))]),
        ),
      ],
    };
    const m = new GateMachine(synthesize(p));
    m.fire("go");
    expect(m.read("x")).toBe(13);
    expect(() =>
      synthesize({ vars, events: [ev("go", set("k", num(2)))] }),
    ).toThrow(/const/);
    expect(() =>
      synthesize({ vars, events: [ev("go", set("k", ref("x")))] }),
    ).toThrow(/const/);
  });

  it("events with identical handlers share an EVT code", () => {
    const body = () => set("x", add(ref("x"), num(1)));
    const p: Program = {
      vars: [n("x", 8, false, 0)],
      events: [
        ev("a", body()),
        ev("b", set("x", num(0))),
        ev("c", body()),
        ev("d", body()),
        ev("e", set("x", num(9))),
        ev("f", []),
      ],
    };
    const syn = synthesize(p);
    expect(syn.codes).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 1],
        ["d", 1],
        ["e", 3],
        ["f", 4],
      ]),
    );
    expect(syn.evtBits).toBe(3);
    const m = new GateMachine(syn);
    for (const id of ["a", "c", "d", "f", "a"]) m.fire(id);
    expect(m.read("x")).toBe(4);
    m.fire("e");
    expect(m.read("x")).toBe(9);
    m.fire("b");
    expect(m.read("x")).toBe(0);
  });

  it("handlers with the same steps in another order get their own EVT codes", () => {
    const p: Program = {
      vars: [n("x", 8, false, 1)],
      events: [
        ev(
          "incThenDouble",
          set("x", add(ref("x"), num(1))),
          set("x", mul(ref("x"), num(2))),
        ),
        ev(
          "doubleThenInc",
          set("x", mul(ref("x"), num(2))),
          set("x", add(ref("x"), num(1))),
        ),
      ],
    };
    const syn = synthesize(p);
    expect(syn.codes.get("incThenDouble")).not.toBe(
      syn.codes.get("doubleThenInc"),
    );
    const m = new GateMachine(syn);
    m.fire("incThenDouble");
    expect(m.read("x")).toBe(4); // (1 + 1) * 2
    m.fire("doubleThenInc");
    expect(m.read("x")).toBe(9); // 4 * 2 + 1
  });

  it("an input a fire does not set keeps its value: its init from power-on, then the last one set (FastSim, RefSim, reactions)", () => {
    const p: Program = {
      vars: [n("in", 3, false, 5, "input"), n("x", 3, false, 0)],
      events: [ev("go", set("x", ref("in")))],
    };
    const syn = synthesize(p);
    for (const m of [
      new GateMachine(syn),
      new GateMachine(syn, { reference: true }),
      new ReactionMachine(syn),
    ]) {
      m.fire("go");
      expect(m.read("x"), "the input's init").toBe(5);
      m.fire("go", { in: 3 });
      expect(m.read("x")).toBe(3);
      m.fire("go");
      expect(m.read("x"), "the input keeps 3").toBe(3);
    }
  });

  it("a constant that wraps to the most negative value reads back as it in the same event", () => {
    const p: Program = {
      vars: [n("s", 4, true, 0), b("neg", false)],
      events: [ev("go", set("s", num(8)), set("neg", lt(ref("s"), num(0))))],
    };
    const m = new GateMachine(synthesize(p));
    m.fire("go");
    expect([m.read("s"), m.read("neg")]).toEqual([-8, true]);
  });

  it("half of a 1-bit two's complement value: floor(-1 / 2) = -1", () => {
    const p: Program = {
      vars: [n("a", 1, true, 0, "input"), n("h", 2, true, 0)],
      events: [ev("half", half("h", ref("a")))],
    };
    const m = new GateMachine(synthesize(p));
    for (const a of [0, -1]) {
      m.fire("half", { a });
      expect(m.read("h"), `half(${a})`).toBe(Math.floor(a / 2));
    }
  });

  it("one value written under two conditions loads under either", () => {
    // if in = 1 then x = 5 else if in = 2 then x = 5: LOAD is (in = 1) OR (in = 2).
    const p: Program = {
      vars: [n("in", 2, false, 0, "input"), n("x", 3, false, 0)],
      events: [
        ev(
          "go",
          when(
            eq(ref("in"), num(1)),
            [set("x", num(5))],
            [when(eq(ref("in"), num(2)), [set("x", num(5))])],
          ),
        ),
      ],
    };
    const m = new GateMachine(synthesize(p));
    m.fire("go", { in: 1 });
    expect(m.read("x")).toBe(5);
    m.fire("go", { in: 0 });
    expect(m.read("x")).toBe(5);
  });

  it("a run of 10,000 ifs on one register: nothing recurses down a chain of multiplexers", () => {
    // Each if writes a few distinct values, so the run costs gates in proportion to its length.
    const k = 10_000;
    const p: Program = {
      vars: [n("x", 2, false, 0), b("f", false), n("i", 8, false, 0, "input")],
      events: [
        ev(
          "go",
          Array.from({ length: k }, (_, j) =>
            when(eq(ref("i"), num(j % 256)), [
              set("x", num(j % 3)),
              set("f", bool(j % 2 === 0)),
            ]),
          ).flat(),
        ),
      ],
    };
    const m = new GateMachine(synthesize(p));
    for (const i of [0, 7, 255]) {
      const last = i + 256 * Math.floor((k - 1 - i) / 256);
      m.fire("go", { i });
      expect([m.read("x"), m.read("f")], `i = ${i}`).toEqual([
        last % 3,
        last % 2 === 0,
      ]);
    }
  });

  it("a register loads only when its event writes it: LOAD is the event line AND the write's condition", () => {
    const p: Program = {
      vars: [
        n("x", 4, false, 0),
        n("y", 4, false, 5),
        n("c", 2, false, 0, "input"),
      ],
      events: [
        ev("setx", when(eq(ref("c"), num(2)), [set("x", num(7))])),
        ev("bumpy", set("y", add(ref("y"), num(1)))),
        ev("none", []),
      ],
    };
    const syn = synthesize(p);
    const net = flatten(syn.lib, syn.top);
    const sim = new RefSim(net);
    sim.v.set(powerOn(net, syn.pokes));
    const loads = (id: string, c: number) => {
      sim.set("EVT", syn.codes.get(id)!);
      sim.set(syn.inputs.get("c")!.port, c);
      sim.settle();
      return [sim.peek("r_x/LOAD"), sim.peek("r_y/LOAD")];
    };
    expect(loads("setx", 2)).toEqual([1, 0]);
    expect(loads("setx", 1)).toEqual([0, 0]);
    expect(loads("bumpy", 2)).toEqual([0, 1]);
    expect(loads("none", 2)).toEqual([0, 0]);
  });

  it("so does a bool register, whatever value the write gives it", () => {
    // if c then f = x, with x a constant, the condition or its negation: values a boolean
    // multiplexer could fold into an AND or OR with the register, which would hide the write's
    // condition. g gets the register h, which keeps its multiplexer either way.
    const c = eq(ref("c"), num(2));
    const shapes: [string, Expr, boolean][] = [
      ["true", bool(true), false],
      ["false", bool(false), true],
      ["cond", c, false],
      ["notcond", not(c), true],
      ["control", ref("h"), false],
    ];
    const p: Program = {
      vars: [
        n("c", 2, false, 0, "input"),
        b("h", true),
        ...shapes.map(([id, , init]) => b(`f_${id}`, init)),
      ],
      events: [
        ev("toggle", set("h", not(ref("h")))),
        ...shapes.map(([id, x]) =>
          ev(`set_${id}`, when(c, [set(`f_${id}`, x)])),
        ),
      ],
    };
    const syn = synthesize(p);
    for (const [id] of shapes)
      expect(syn.regs.get(`f_${id}`)!.nets, `f_${id} is a register`).toEqual([
        `f_${id}`,
      ]);
    const net = flatten(syn.lib, syn.top);
    const sim = new RefSim(net);
    sim.v.set(powerOn(net, syn.pokes));
    const loads = (cv: number) =>
      Object.fromEntries(
        shapes.map(([id]) => {
          sim.set("EVT", syn.codes.get(`set_${id}`)!);
          sim.set(syn.inputs.get("c")!.port, cv);
          sim.settle();
          return [id, sim.peek(`r_f_${id}/LOAD`)];
        }),
      );
    const every = (v: number) =>
      Object.fromEntries(shapes.map(([id]) => [id, v]));
    expect(loads(2), "c holds: every event writes its register").toEqual(
      every(1),
    );
    expect(loads(1), "c does not: no event may load").toEqual(every(0));
    lockstep(
      p,
      syn,
      new GateMachine(syn),
      randomEvents(rng(5), p, 60),
      "bool LOAD",
    );
  });

  it("a register no event can change is a constant", () => {
    const p: Program = {
      vars: [n("x", 4, false, 3), n("y", 4, false, 3), n("z", 4, false, 1)],
      // x is only ever written with its own value; y = x + 0 is then 3 too; z really changes.
      events: [
        ev("a", set("x", num(3)), set("y", ref("x"))),
        ev("b", set("z", add(ref("z"), ref("y")))),
      ],
    };
    const syn = synthesize(p);
    expect(syn.regs.get("x")!.nets).toEqual(["1", "1", "0", "0"]);
    expect(syn.regs.get("y")!.nets).toEqual(["1", "1", "0", "0"]);
    expect(syn.stats.registers).toBe(4);
    const plain = synthesize(p, { constantRegisters: false });
    expect(plain.stats.registers).toBe(12);
    for (const s of [syn, plain]) {
      const m = new GateMachine(s);
      m.fire("a");
      m.fire("b");
      m.fire("b");
      expect([m.read("x"), m.read("y"), m.read("z")]).toEqual([3, 3, 7]);
    }
  });

  it("a register whose every load writes its initial value is a constant", () => {
    // x = 4·in truncated to 2 bits is always 0; f = ¬c under c is always false, and g = c under
    // c always true. The words cannot see it (a product, a write's condition), the bits can.
    const c = eq(ref("in"), num(2));
    const p: Program = {
      vars: [
        n("in", 3, false, 0, "input"),
        n("x", 2, false, 0),
        n("y", 3, false, 0),
        b("f", false),
        b("g", true),
      ],
      events: [
        ev("go", set("x", mul(ref("in"), num(4))), set("y", ref("in"))),
        ev("flags", when(c, [set("f", not(c)), set("g", c)])),
      ],
    };
    const syn = synthesize(p);
    expect(syn.regs.get("x")!.nets).toEqual(["0", "0"]);
    expect(syn.regs.get("f")!.nets).toEqual(["0"]);
    expect(syn.regs.get("g")!.nets).toEqual(["1"]);
    expect(syn.stats.registers).toBe(3);
    // Without the proof they are registers, and compute the same.
    const plain = synthesize(p, { constantRegisters: false });
    expect(plain.stats.registers).toBe(3 + 2 + 1 + 1);
    for (const s of [syn, plain]) {
      const m = new GateMachine(s);
      for (let v = 0; v < 8; v++) {
        m.fire("go", { in: v });
        m.fire("flags");
        expect([m.read("x"), m.read("y"), m.read("f"), m.read("g")]).toEqual([
          0,
          v,
          false,
          true,
        ]);
      }
    }
  });

  it("a miniature editor: slots, a selection, load / compute / store, delete, reorder, copy", () => {
    const syn = synthesize(MINI);
    lockstep(
      MINI,
      syn,
      new GateMachine(syn),
      randomEvents(rng(11), MINI, 400),
      "mini",
    );
    lockstep(
      MINI,
      syn,
      new GateMachine(syn, { reference: true }),
      randomEvents(rng(12), MINI, 80),
      "mini (RefSim)",
    );
    // A unit is a module only if it creates logic: nudge builds the read multiplexer and the
    // clamp; copy reuses that multiplexer and delete the comparisons nudge's switch made first;
    // select only writes constants, which are GLUE's.
    expect([...syn.lib.keys()].filter((k) => k.startsWith("U_"))).toEqual([
      "U_nudge",
      "U_reorder",
    ]);
    // A budget that pins the register-write synthesis: the read multiplexer is built once and
    // shared by nudge and copy; delete's and reorder's slot copies share their D terms.
    expect(syn.stats.registers).toBe(4 * 6 + 4 * 2 + 3 + 6);
    expect(syn.stats.gates).toBeLessThanOrEqual(MINI_GATES);
  });

  it("a register written only under a condition that is false at bit level is a constant", () => {
    // -(2·in) is even, so t (its 1-bit truncation) is always 0; the word level cannot see it,
    // the bits can. This once made the constant-register proof go round forever.
    const p: Program = {
      vars: [
        n("in", 3, false, 0, "input"),
        n("t", 1, false, 0, "temp"),
        b("f", true),
        n("x", 3, false, 0),
      ],
      events: [
        ev(
          "go",
          set("t", neg(mul(ref("in"), num(2)))),
          when(eq(ref("t"), num(1)), [set("f", bool(false))]),
          set("x", ref("in")),
        ),
      ],
    };
    for (const constantRegisters of [true, false]) {
      const syn = synthesize(p, { constantRegisters });
      expect(syn.regs.get("f")!.nets).toEqual(["1"]);
      lockstep(
        p,
        syn,
        new GateMachine(syn),
        randomEvents(rng(3), p, 20),
        "bit-level constant",
      );
    }
  });

  it("rejects what gates cannot compute", () => {
    const x = n("x", 4, false, 0);
    const go = (...steps: Step[][]) => [ev("go", ...steps)];
    expect(() =>
      synthesize({ vars: [x], events: go(set("x", div(ref("x"), num(2)))) }),
    ).toThrow(/div/);
    expect(() =>
      synthesize({
        vars: [{ name: "s", ty: "str", init: "", role: "state" }],
        events: [],
      }),
    ).toThrow(/strings/);
    expect(() =>
      synthesize({
        vars: [{ name: "c", ty: "col", init: "#000000", role: "temp" }],
        events: [],
      }),
    ).toThrow(/colors/);
    expect(() =>
      synthesize({ vars: [{ name: "w", ty: "num", init: 0 }], events: [] }),
    ).toThrow(/bit width/);
    expect(() =>
      synthesize({
        vars: [x, n("i", 2, false, 0, "input")],
        events: go(set("i", num(1))),
      }),
    ).toThrow(/input/);
    expect(() =>
      synthesize({ vars: [x], events: go(set("x", bool(true))) }),
    ).toThrow(/boolean into a number/);
    expect(() =>
      synthesize({
        vars: [x],
        events: go(
          set("x", { k: "op", fn: "add", a: { k: "str", v: "a" }, b: num(1) }),
        ),
      }),
    ).toThrow(/strings/);
    expect(() =>
      synthesize({ vars: [x], events: go(set("x", num(0.5))) }),
    ).toThrow(/whole number/);
    expect(() =>
      synthesize({ vars: [n("x", 4, false, 16)], events: [] }),
    ).toThrow(/does not fit/);
  });
});
