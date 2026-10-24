import { describe, expect, it } from "vitest";
import { buildSpike, CHUNKED, counterPlan, selfTest, STRESS_SIZES, stressActions } from "../spike/src/spike";
import { V2_COLLECTION, V2_LIMITS, V2_PREFIX, V2_TRIGGER_N } from "../spike/src/v2";
import type { Schedule } from "../src/compile/types";
import { cpuNetlist, PROBES, ramBit } from "../src/cpu";
import { assemble, PROGRAMS } from "../src/isa";
import { counterLib, counterNetlist } from "../spike/src/circuits";
import { compile, FastSim, powerOn } from "../src/compile";
import { define } from "../src/hdl/builder";
import { flatten, netId } from "../src/netlist/flatten";
import { type FlatNetlist, GATE_TYPES, evalGate, type Library } from "../src/netlist/types";
import { apply } from "../src/prototype/apply";
import { runFigmaActions, type FigmaValue } from "../src/prototype/emulate";
import { aliasData, boolData, conditional, exprData, figmaActions, increment, navigate, toFigmaActions, worstCase } from "../src/prototype/figma-actions";
import { initialState, interpret, interpretChunked, runPlanActions } from "../src/prototype/interpret";
import { dispatchOverhead, gateExpr, plan, splitActions, varName, worstActions } from "../src/prototype/plan";
import { powerOnState, simpleSchedule } from "../src/prototype/schedule";
import type { Expr, PlanAction, PrototypePlan } from "../src/prototype/types";
import { RefSim } from "../src/sim/reference";
import { powerOnWith } from "../plugin/src/program";

// ---------- lane A (src/compile) ----------

const laneA = { compile, FastSim, powerOn };

// ---------- test circuits ----------

/** Foundation's cells plus a few sequential circuits with inputs and constants. */
function testLib(): Library {
  const lib = counterLib(); // DLATCH, DFF, COUNTER4
  define(lib, "COUNTER2", { in: { CLK: 1 }, out: { Q: 2 } }, (b) => {
    const [q0, q1] = b.out("Q");
    b.use("DFF", { D: b.NOT(q0), CLK: b.in1("CLK"), Q: q0 }, "b0");
    b.use("DFF", { D: b.XOR(q0, q1), CLK: b.in1("CLK"), Q: q1 }, "b1");
  });
  // Load-enable flip-flop per SILICON.md §2: master EN = ¬CLK·LOAD.
  define(lib, "DFFE", { in: { D: 1, LOAD: 1, CLK: 1 }, out: { Q: 1 } }, (b) => {
    const en = b.AND(b.NOT(b.in1("CLK")), b.in1("LOAD"));
    const m = b.use("DLATCH", { D: b.in1("D"), EN: en }, "master").Q[0];
    b.use("DLATCH", { D: m, EN: b.in1("CLK"), Q: b.out1("Q") }, "slave");
  });
  // 4-bit register + accumulator-ish feedback: Q ← LOAD ? D ⊕ Q : Q, with constants mixed in.
  define(lib, "ACC4", { in: { D: 4, LOAD: 1, CLK: 1 }, out: { Q: 4, Z: 1 } }, (b) => {
    const q = b.out("Q");
    const d = b.in("D");
    q.forEach((qi, i) => {
      const x = b.XOR(d[i], qi);
      const y = b.AND(x, "1"); // constant input: folds to x
      const z = b.OR(y, "0"); // folds to y
      b.use("DFFE", { D: z, LOAD: b.in1("LOAD"), CLK: b.in1("CLK"), Q: qi }, `r${i}`);
    });
    b.NOR(b.OR(q[0], q[1]), b.OR(q[2], q[3]), b.out1("Z"));
  });
  // D latch from four NANDs (cross-coupled SR core) and a DFF from two of them.
  define(lib, "NLATCH", { in: { D: 1, EN: 1 }, out: { Q: 1 } }, (b) => {
    const s = b.NAND(b.in1("D"), b.in1("EN"));
    const r = b.NAND(b.NOT(b.in1("D")), b.in1("EN"));
    const qb = b.wire1("qb");
    b.NAND(s, qb, b.out1("Q"));
    b.NAND(r, b.out1("Q"), qb);
  });
  define(lib, "NDFF", { in: { D: 1, CLK: 1 }, out: { Q: 1 } }, (b) => {
    const m = b.use("NLATCH", { D: b.in1("D"), EN: b.NOT(b.in1("CLK")) }, "master").Q[0];
    b.use("NLATCH", { D: m, EN: b.in1("CLK"), Q: b.out1("Q") }, "slave");
  });
  // 5-bit LFSR-ish shift register of NAND flip-flops with an XNOR tap and a serial input.
  define(lib, "SHIFT5", { in: { SIN: 1, CLK: 1 }, out: { Q: 5 } }, (b) => {
    const q = b.out("Q");
    const fb = b.XNOR(b.XOR(q[4], q[2]), b.in1("SIN"));
    q.forEach((qi, i) => b.use("NDFF", { D: i === 0 ? fb : q[i - 1], CLK: b.in1("CLK"), Q: qi }, `s${i}`));
  });
  return lib;
}

const CIRCUITS: Array<{ top: string; inputs: Record<string, number> }> = [
  { top: "COUNTER2", inputs: {} },
  { top: "COUNTER4", inputs: {} },
  { top: "ACC4", inputs: { D: 4, LOAD: 1 } },
  { top: "SHIFT5", inputs: { SIN: 1 } },
];

/** Deterministic PRNG for stimuli. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Steps the plan (via `step`) and RefSim side by side from the plan's power-on state, with
 * the same random inputs; checks every variable after every tick. */
function lockstep(
  net: FlatNetlist,
  p: PrototypePlan,
  inputs: Record<string, number>,
  ticks: number,
  step: (s: Map<number, boolean>, stimulus: Record<string, number>) => void,
) {
  const ref = new RefSim(net);
  for (const v of p.variables) ref.v[v.net] = v.init ? 1 : 0;
  expect(ref.settle(), "power-on state is settled").toBe(1);
  const state = initialState(p);
  const rand = rng(net.gates.length);
  for (let t = 0; t < ticks; t++) {
    const stimulus: Record<string, number> = {};
    for (const [name, width] of Object.entries(inputs)) {
      const value = Math.floor(rand() * 2 ** width);
      stimulus[name] = value;
      ref.set(name, value);
      net.ports.find((x) => x.name === name)!.nets.forEach((n, i) => state.set(n, ((value >> i) & 1) === 1));
    }
    step(state, stimulus);
    ref.tick();
    for (const v of p.variables) if (state.get(v.net) !== (ref.v[v.net] === 1)) throw new Error(`tick ${t + 1}: ${v.name} differs from RefSim`);
  }
  return ref;
}

// ---------- plan + interpret ----------

describe("prototype plan: interpret ≡ RefSim", () => {
  for (const { top, inputs } of CIRCUITS) {
    it(`${top}: every wire matches RefSim for 40 ticks (simple schedule)`, () => {
      const net = flatten(testLib(), top);
      const p = plan(net, simpleSchedule(net), { initial: powerOnState(net) });
      lockstep(net, p, inputs, 40, (s) => interpret(p, s));
    });
    it(`${top}: flat plan (no nested expressions) matches too`, () => {
      const net = flatten(testLib(), top);
      const p = plan(net, simpleSchedule(net), { initial: powerOnState(net), flat: true });
      expect(p.stats.maxDepth).toBeLessThanOrEqual(1);
      lockstep(net, p, inputs, 40, (s) => interpret(p, s));
    });
  }

  it("with lane A's compile() + powerOn(): interpret ≡ RefSim ≡ FastSim, nested and flat", () => {
    for (const { top, inputs } of CIRCUITS)
      for (const flat of [false, true]) {
        const net = flatten(testLib(), top);
        const sched = laneA.compile(net);
        const init = laneA.powerOn(net);
        expect([...init], "powerOnState ≡ powerOn").toEqual([...powerOnState(net)]);
        const p = plan(net, sched, { initial: init, flat });
        const fast = laneA.FastSim ? new laneA.FastSim(net, sched, init) : null;
        lockstep(net, p, inputs, 40, (s, stimulus) => {
          interpret(p, s);
          if (!fast) return;
          for (const [name, value] of Object.entries(stimulus)) fast.set(name, value);
          fast.tick();
          for (const v of p.variables) if (s.get(v.net) !== (fast.v[v.net] === 1)) throw new Error(`${top}: ${v.name} differs from FastSim`);
        });
        // the pruned schedule never costs more than the every-gate-every-pass fallback
        expect(p.stats.actionsPerTick).toBeLessThanOrEqual(plan(net, simpleSchedule(net), { initial: init, flat }).stats.actionsPerTick);
      }
  });

  it("the spike counter counts 1..15, 0, 1… and its plan is small", () => {
    const net = counterNetlist();
    const p = plan(net, simpleSchedule(net), { initial: powerOnState(net) });
    const state = initialState(p);
    const q = net.ports.find((x) => x.name === "Q")!.nets;
    const seen: number[] = [];
    for (let t = 0; t < 20; t++) {
      interpret(p, state);
      seen.push(q.reduce((acc, n, i) => acc | ((state.get(n) ? 1 : 0) << i), 0));
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4]);
    expect(p.stats).toMatchObject({ gates: 42, variables: 43, actionsPerTick: 86, lowPass: 42, highPass: 42, maxDepth: 1 });
    // the spike uses lane A's pruned schedule: fewer actions, same behavior
    const spike = counterPlan(net);
    expect(spike.stats.actionsPerTick).toBeLessThan(86);
    lockstep(net, spike, {}, 20, (s) => interpret(spike, s));
  });

  it("inlines constants, names variables net/<hier>, and stays JSON-able", () => {
    const net = flatten(testLib(), "ACC4");
    const p = plan(net, simpleSchedule(net), { initial: powerOnState(net), name: "T" });
    const vars = new Set(p.variables.map((v) => v.net));
    expect(vars.has(0) || vars.has(1)).toBe(false);
    const refs = (e: Expr): number[] =>
      "var" in e ? [e.var] : "const" in e ? [] : "not" in e ? refs(e.not) : Object.values(e)[0].flatMap(refs);
    const walk = (l: PlanAction[]): number[] => l.flatMap((a) => ("set" in a ? [a.set, ...refs(a.to)] : [...refs(a.if), ...walk(a.then), ...walk(a.else ?? [])]));
    for (const n of walk(p.tick)) expect(vars.has(n), `net ${n}`).toBe(true);
    // canonical = shallowest name: the DFFE's unconnected master output is r2/master_Q
    expect(p.variables.find((v) => v.net === netId(net, "r2/master/Q"))?.name).toBe("net/r2/master_Q");
    expect(p.variables.find((v) => v.net === netId(net, "r2/slave/and_1"))?.name).toBe("net/r2/slave/and_1");
    expect(p.tick[0]).toEqual({ set: p.clk, to: { const: 0 } });
    expect(p.tick[p.stats.lowPass + 1]).toEqual({ set: p.clk, to: { const: 1 } });
    const copy: PrototypePlan = JSON.parse(JSON.stringify(p));
    const a = initialState(p);
    const b = initialState(copy);
    for (let t = 0; t < 5; t++) {
      a.set(netId(net, "LOAD"), true).set(netId(net, "D[1]"), true);
      b.set(netId(net, "LOAD"), true).set(netId(net, "D[1]"), true);
      interpret(p, a);
      interpret(copy, b);
    }
    expect([...b]).toEqual([...a]);
    // reset returns every variable to power-on
    runPlanActions(p.reset, a);
    expect([...a]).toEqual([...initialState(p)]);
  });

  it("gate expressions: NAND = not(and), XOR = neq, XNOR = eq; constants fold away", () => {
    expect(gateExpr({ type: "NAND", in: [5, 6] })).toEqual({ not: { and: [{ var: 5 }, { var: 6 }] } });
    expect(gateExpr({ type: "NOR", in: [5, 6] })).toEqual({ not: { or: [{ var: 5 }, { var: 6 }] } });
    expect(gateExpr({ type: "XOR", in: [5, 6] })).toEqual({ neq: [{ var: 5 }, { var: 6 }] });
    expect(gateExpr({ type: "XNOR", in: [5, 6] })).toEqual({ eq: [{ var: 5 }, { var: 6 }] });
    expect(gateExpr({ type: "BUF", in: [5] })).toEqual({ var: 5 });
    expect(gateExpr({ type: "AND", in: [5, 1] })).toEqual({ var: 5 });
    expect(gateExpr({ type: "AND", in: [0, 5] })).toEqual({ const: 0 });
    expect(gateExpr({ type: "NAND", in: [5, 0] })).toEqual({ const: 1 });
    expect(gateExpr({ type: "OR", in: [5, 1] })).toEqual({ const: 1 });
    expect(gateExpr({ type: "XOR", in: [5, 1] })).toEqual({ not: { var: 5 } });
    expect(gateExpr({ type: "XNOR", in: [0, 5] })).toEqual({ not: { var: 5 } });
    expect(gateExpr({ type: "NOT", in: [1] })).toEqual({ const: 0 });
    // every gate type, every input combination, through constants and through variables
    for (const type of GATE_TYPES)
      for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const lits = gateExpr({ type, in: [a, b] });
        expect(lits, `${type}(${a},${b})`).toEqual({ const: evalGate(type, a, b) });
        const s = new Map([[5, a === 1], [6, b === 1], [7, false]]);
        runPlanActions([{ set: 7, to: gateExpr({ type, in: [5, 6] }) }], s);
        expect(s.get(7), `${type}(${a},${b})`).toBe(evalGate(type, a, b) === 1);
      }
    expect(varName("regs/r0/b3/master/Q")).toBe("net/regs/r0/b3/master/Q");
    expect(varName("a.b/{x}//c")).toBe("net/a_b/_x_/c");
  });
});

// ---------- Figma action shapes ----------

describe("toFigmaActions: Plugin API shapes", () => {
  const id = (n: number) => `VariableID:1:${n}`;
  const A = (n: number) => ({ type: "VARIABLE_ALIAS", resolvedType: "BOOLEAN", value: { type: "VARIABLE_ALIAS", id: id(n) } });

  it("encodes each operator, nesting, literals and copies exactly", () => {
    const p = {
      tick: [
        { set: 2, to: { const: 0 } },
        { set: 3, to: { and: [{ var: 4 }, { var: 5 }] } },
        { set: 6, to: { not: { and: [{ var: 4 }, { var: 5 }] } } },
        { set: 7, to: { neq: [{ var: 4 }, { var: 5 }] } },
        { set: 8, to: { eq: [{ var: 4 }, { var: 5 }] } },
        { set: 9, to: { or: [{ var: 4 }, { var: 5 }] } },
        { set: 10, to: { var: 4 } },
        { if: { var: 4 }, then: [{ set: 11, to: { const: 1 } }], else: [{ set: 11, to: { not: { var: 11 } } }] },
      ],
    } as unknown as PrototypePlan;
    const ids = new Map([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => [n, id(n)]));
    const acts: Action[] = toFigmaActions(p, ids);
    const ex = (fn: string, args: unknown[]) => ({ type: "EXPRESSION", resolvedType: "BOOLEAN", value: { expressionFunction: fn, expressionArguments: args } });
    const set = (n: number, v: unknown) => ({ type: "SET_VARIABLE", variableId: id(n), variableValue: v });
    expect(acts).toEqual([
      set(2, { type: "BOOLEAN", resolvedType: "BOOLEAN", value: false }),
      set(3, ex("AND", [A(4), A(5)])),
      set(6, ex("NOT", [ex("AND", [A(4), A(5)])])),
      set(7, ex("NOT_EQUAL", [A(4), A(5)])),
      set(8, ex("EQUALS", [A(4), A(5)])),
      set(9, ex("OR", [A(4), A(5)])),
      set(10, ex("EQUALS", [A(4), { type: "BOOLEAN", resolvedType: "BOOLEAN", value: true }])),
      {
        type: "CONDITIONAL",
        conditionalBlocks: [
          { condition: A(4), actions: [set(11, { type: "BOOLEAN", resolvedType: "BOOLEAN", value: true })] },
          { actions: [set(11, ex("NOT", [A(11)]))] },
        ],
      },
    ]);
    // the bare-alias copy option
    expect(figmaActions([{ set: 10, to: { var: 4 } }], ids, { copy: "alias" })).toEqual([set(10, A(4))]);
    expect(() => figmaActions([{ set: 99, to: { var: 4 } }], ids)).toThrow(/no Figma variable for net 99/);
  });

  it("control helpers: navigate, increment, conditional", () => {
    expect(navigate("1:23")).toEqual({ type: "NODE", destinationId: "1:23", navigation: "NAVIGATE", transition: null });
    expect(increment("V:1")).toEqual({
      type: "SET_VARIABLE",
      variableId: "V:1",
      variableValue: {
        type: "EXPRESSION",
        resolvedType: "FLOAT",
        value: {
          expressionFunction: "ADDITION",
          expressionArguments: [
            { type: "VARIABLE_ALIAS", resolvedType: "FLOAT", value: { type: "VARIABLE_ALIAS", id: "V:1" } },
            { type: "FLOAT", resolvedType: "FLOAT", value: 1 },
          ],
        },
      },
    });
    const c = conditional(exprData("EQUALS", [aliasData("V:2"), boolData(true)]), [navigate("1:2")]);
    expect(c).toEqual({
      type: "CONDITIONAL",
      conditionalBlocks: [{ condition: exprData("EQUALS", [aliasData("V:2"), boolData(true)]), actions: [navigate("1:2")] }],
    });
  });

  it("the emulated Figma actions reproduce interpret() and RefSim on the counter", () => {
    const net = flatten(testLib(), "SHIFT5");
    const p = plan(net, simpleSchedule(net), { initial: powerOnState(net) });
    const ids = new Map(p.variables.map((v) => [v.net, `V:${v.net}`]));
    const acts = toFigmaActions(p, ids);
    const fv = new Map<string, FigmaValue>(p.variables.map((v) => [`V:${v.net}`, v.init]));
    lockstep(net, p, { SIN: 1 }, 30, (s) => {
      for (const v of p.variables) fv.set(`V:${v.net}`, s.get(v.net)!); // inputs set by lockstep
      runFigmaActions(acts, fv);
      for (const v of p.variables) s.set(v.net, fv.get(`V:${v.net}`) as boolean);
    });
  });
});

// ---------- a fake Plugin API (just what apply() and the spike use) ----------

let nextId = 1;
class FNode {
  id = `${nextId++}:1`;
  name = "";
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  visible = true;
  fills: unknown = [];
  cornerRadius = 0;
  clipsContent = true;
  children: FNode[] = [];
  parent: FNode | null = null;
  removed = false;
  boundVariables: Record<string, { type: "VARIABLE_ALIAS"; id: string }> = {};
  reactions: Reaction[] = [];
  characters = "";
  fontName: unknown;
  fontSize = 12;
  textAlignHorizontal = "LEFT";
  textAlignVertical = "TOP";
  private flows: Array<{ nodeId: string; name: string }> = [];
  constructor(
    readonly type: string,
    readonly api: FakeFigma,
  ) {
    api.nodes.set(this.id, this);
  }
  /** PAGE: like Figma, duplicate node ids are rejected ("Found duplicate input nodeIds"). */
  get flowStartingPoints() {
    return this.flows;
  }
  set flowStartingPoints(f: Array<{ nodeId: string; name: string }>) {
    if (new Set(f.map((x) => x.nodeId)).size !== f.length) throw new Error("in set_flowStartingPoints: Found duplicate input nodeIds");
    this.flows = f.map((x) => ({ ...x }));
  }
  get topFrame(): FNode {
    let n: FNode = this;
    while (n.parent && n.parent.type !== "PAGE") n = n.parent;
    return n;
  }
  get page(): FNode | null {
    let n: FNode | null = this;
    while (n && n.type !== "PAGE") n = n.parent;
    return n;
  }
  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  appendChild(c: FNode) {
    if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
    c.parent = this;
    this.children.push(c);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.removed = true;
    this.api.nodes.delete(this.id);
  }
  setBoundVariable(field: string, v: FVar) {
    if (!(v instanceof FVar) || !this.api.vars.has(v.id)) throw new Error(`bind ${field}: not a live variable`);
    if (field === "visible" && v.resolvedType !== "BOOLEAN") throw new Error("visible needs a BOOLEAN variable");
    // Like real Figma (spike v1): "variable of resolved type 'FLOAT' cannot be bound to 'characters'".
    if (field === "characters" && (this.type !== "TEXT" || v.resolvedType !== "STRING"))
      throw new Error(`variable of resolved type '${v.resolvedType}' cannot be bound to 'characters'`);
    this.boundVariables[field] = { type: "VARIABLE_ALIAS", id: v.id };
  }
  async setReactionsAsync(r: Reaction[]) {
    const isVariant = this.type === "COMPONENT" && this.parent?.type === "COMPONENT_SET";
    let navigates = false;
    for (const re of r) {
      const t = re.trigger as (Trigger & { timeout?: number; delay?: number; keyCodes?: number[] }) | null;
      if (t?.type === "AFTER_TIMEOUT" && (typeof t.timeout !== "number" || (this.parent?.type !== "PAGE" && !isVariant)))
        throw new Error("AFTER_TIMEOUT only on top-level frames and variants");
      if ((t?.type === "MOUSE_DOWN" || t?.type === "MOUSE_UP" || t?.type === "MOUSE_ENTER") && typeof t.delay !== "number") throw new Error(`${t.type} needs a delay`);
      if (t?.type === "ON_KEY_DOWN" && !t.keyCodes?.length) throw new Error("ON_KEY_DOWN needs keyCodes");
      const check = (acts: readonly Action[]) => {
        for (const a of acts) {
          if (a.type === "SET_VARIABLE" && !this.api.vars.has(a.variableId!)) throw new Error(`unknown variable ${a.variableId}`);
          if (a.type === "NODE") {
            const dest = this.api.nodes.get(a.destinationId!);
            const nav = a.navigation as unknown as string; // typings' Navigation collides with the DOM's
            if (nav === "CHANGE_TO") {
              if (dest?.type !== "COMPONENT" || dest.parent?.type !== "COMPONENT_SET") throw new Error("CHANGE_TO needs a variant");
            } else if (dest?.parent?.type !== "PAGE") throw new Error("navigate to non-top-level");
            if (nav === "NAVIGATE") navigates = true;
          }
          if (a.type === "CONDITIONAL") a.conditionalBlocks.forEach((b) => check(b.actions));
        }
      };
      check(re.actions ?? []);
    }
    this.reactions = JSON.parse(JSON.stringify(r));
    // Like Figma: the first navigation on a page creates a flow for its frame by itself.
    const page = this.page;
    if (navigates && page && page.flows.length === 0) page.flows = [{ nodeId: this.topFrame.id, name: "Flow 1" }];
  }
  createInstance() {
    const i = new FNode("INSTANCE", this.api);
    i.name = this.name;
    i.resize(this.width, this.height);
    return i;
  }
  /** Deep copy with bindings and reactions, appended next to the original. */
  clone(): FNode {
    const copy = (src: FNode): FNode => {
      const n = new FNode(src.type, this.api);
      Object.assign(n, { name: src.name, x: src.x, y: src.y, width: src.width, height: src.height, visible: src.visible, characters: src.characters });
      n.boundVariables = { ...src.boundVariables };
      n.reactions = JSON.parse(JSON.stringify(src.reactions));
      for (const c of src.children) n.appendChild(copy(c));
      return n;
    };
    const n = copy(this);
    this.parent?.appendChild(n);
    return n;
  }
  findAll(pred: (n: FNode) => boolean): FNode[] {
    return this.children.flatMap((c) => [...(pred(c) ? [c] : []), ...c.findAll(pred)]);
  }
}

class FVar {
  id = `VariableID:${nextId++}:0`;
  valuesByMode: Record<string, unknown> = {};
  constructor(
    public name: string,
    readonly coll: FColl,
    readonly resolvedType: string,
  ) {}
  setValueForMode(mode: string, v: unknown) {
    if (mode !== this.coll.defaultModeId) throw new Error("bad mode");
    const want = this.resolvedType === "BOOLEAN" ? "boolean" : this.resolvedType === "FLOAT" ? "number" : "string";
    if (typeof v !== want) throw new Error(`${this.name}: wrong value type`);
    this.valuesByMode[mode] = v;
  }
}

class FColl {
  id = `VariableCollectionId:${nextId++}:0`;
  defaultModeId = `${nextId++}:0`;
  modes = [{ modeId: this.defaultModeId, name: "Mode 1" }];
  vars: FVar[] = [];
  constructor(
    public name: string,
    readonly api: FakeFigma,
  ) {}
  remove() {
    for (const v of this.vars) this.api.vars.delete(v.id);
    this.api.colls = this.api.colls.filter((c) => c !== this);
  }
}

class FakeFigma {
  nodes = new Map<string, FNode>();
  vars = new Map<string, FVar>();
  colls: FColl[] = [];
  root: FNode;
  currentPage: FNode;
  command = "";
  constructor() {
    this.root = new FNode("DOCUMENT", this);
    this.currentPage = this.createPage();
    this.currentPage.name = "Page 1";
  }
  createPage() {
    const p = new FNode("PAGE", this);
    this.root.appendChild(p);
    return p;
  }
  async setCurrentPageAsync(p: FNode) {
    this.currentPage = p;
  }
  async loadFontAsync() {}
  private make(type: string) {
    const n = new FNode(type, this);
    this.currentPage.appendChild(n);
    return n;
  }
  createFrame = () => this.make("FRAME");
  createText = () => this.make("TEXT");
  createEllipse = () => this.make("ELLIPSE");
  createComponent = () => this.make("COMPONENT");
  combineAsVariants(nodes: FNode[], parent: FNode) {
    const set = new FNode("COMPONENT_SET", this);
    parent.appendChild(set);
    for (const n of nodes) {
      if (n.type !== "COMPONENT") throw new Error("combineAsVariants needs components");
      set.appendChild(n);
    }
    return set;
  }
  variables = {
    createVariableCollection: (name: string) => {
      const c = new FColl(name, this);
      this.colls.push(c);
      return c;
    },
    createVariable: (name: string, c: FColl, type: string) => {
      if (!(c instanceof FColl)) throw new Error("pass the collection object");
      if (/[.{}]/.test(name)) throw new Error(`invalid variable name ${name}`);
      if (c.vars.length >= 5000) throw new Error("collection is full (5000)");
      if (c.vars.some((v) => v.name === name)) throw new Error(`duplicate variable name ${name}`);
      const v = new FVar(name, c, type);
      c.vars.push(v);
      this.vars.set(v.id, v);
      return v;
    },
    getLocalVariableCollectionsAsync: async () => [...this.colls],
  };
  /** Variable values as the prototype starts (default mode). */
  values(): Map<string, FigmaValue> {
    return new Map([...this.vars.values()].map((v) => [v.id, v.valuesByMode[v.coll.defaultModeId] as FigmaValue]));
  }
  byName(name: string, type?: string): FNode {
    const n = this.root.findAll((x) => x.name === name && (!type || x.type === type));
    if (n.length !== 1) throw new Error(`${n.length} nodes named ${name}`);
    return n[0];
  }
  varNamed(coll: string, name: string): FVar {
    const v = [...this.vars.values()].find((x) => x.coll.name === coll && x.name === name);
    if (!v) throw new Error(`no variable ${coll}/${name}`);
    return v;
  }
}
const asApi = (f: FakeFigma) => f as unknown as PluginAPI;
const onClick = (n: FNode) => n.reactions.find((r) => r.trigger?.type === "ON_CLICK")!.actions!;
const afterTimeout = (n: FNode) => n.reactions.find((r) => r.trigger?.type === "AFTER_TIMEOUT")!;
const last = <T>(xs: readonly T[]) => xs[xs.length - 1];

// ---------- the spike, built against the fake API ----------

describe("spike plugin (fake Figma API)", () => {
  it("builds every part without errors, chunking big collections", async () => {
    const f = new FakeFigma();
    const r = await buildSpike(asApi(f), "all");
    expect(r.errors).toEqual([]);
    expect(f.currentPage.name).toBe("Silicon · Spike");
    const colls = f.colls.map((c) => `${c.name}:${c.vars.length}`);
    expect(colls).toEqual(["Spike:46", "Spike Test:84", "Spike Stress 500:503", "Spike Stress 2000:2003", "Spike Stress 5000:4000", "Spike Stress 5000 · 2:1003"]);
    expect(f.currentPage.flowStartingPoints.map((x) => x.name)).toEqual(["Counter", "Self-test", "Stress 500", "Stress 2000", "Stress 5000"]);
    expect(f.byName("Spike log").characters).toMatch(/done in .* with 0 error/);
    // Running it again replaces everything instead of duplicating.
    const r2 = await buildSpike(asApi(f), "all");
    expect(r2.errors).toEqual([]);
    expect(f.colls.map((c) => `${c.name}:${c.vars.length}`)).toEqual(colls);
    expect(f.root.findAll((n) => n.name === "Counter").length).toBe(1);
    expect(f.currentPage.flowStartingPoints.length).toBe(5);
  });

  it("Step on the counter (the exact reaction JSON, emulated) reproduces RefSim for 20 ticks", async () => {
    const f = new FakeFigma();
    await buildSpike(asApi(f), "basic");
    const net = counterNetlist();
    const p = counterPlan(net);
    const vals = f.values();
    const idOf = new Map(p.variables.map((v) => [v.net, f.varNamed("Spike", v.name).id]));
    const stepActs = onClick(f.byName("button/Step"));
    expect(stepActs.length).toBe(p.stats.actionsPerTick + 2); // + ticks += 1, tickText = "" + ticks
    const ref = new RefSim(net);
    ref.v.set(powerOnState(net));
    for (let t = 1; t <= 20; t++) {
      runFigmaActions(stepActs, vals);
      ref.tick();
      for (const v of p.variables) expect(vals.get(idOf.get(v.net)!), `tick ${t} ${v.name}`).toBe(ref.v[v.net] === 1);
    }
    expect(ref.get("Q")).toBe(4);
    expect(vals.get(f.varNamed("Spike", "ctl/ticks").id)).toBe(20);
    // Lamps: one per wire in the display component plus the 4 big Q lamps, all bound.
    const comp = f.byName("Counter / display", "COMPONENT");
    const lits = comp.findAll((n) => n.name === "lit");
    expect(lits.length).toBe(p.variables.length + 4);
    for (const l of lits) expect(f.vars.get(l.boundVariables.visible.id)?.coll.name).toBe("Spike");
    // Reset restores power-on values and the counter.
    runFigmaActions(onClick(f.byName("button/Reset")), vals);
    expect([...vals]).toEqual([...f.values()]);
  });

  it("Run loop: Run → A ⇄ B ticking until Stop, then back to Counter", async () => {
    const f = new FakeFigma();
    await buildSpike(asApi(f), "basic");
    const vals = f.values();
    const control = f.byName("Counter", "FRAME");
    const a = f.byName("Counter · Run A", "FRAME");
    const b = f.byName("Counter · Run B", "FRAME");
    let at = control.id;
    const hooks = { navigate: (d: string | null) => void (at = d!) };
    const run = f.root.findAll((n) => n.name === "button/Run" && n.parent === control)[0];
    runFigmaActions(onClick(run), vals, hooks);
    expect(at).toBe(a.id);
    expect(afterTimeout(a).trigger).toEqual({ type: "AFTER_TIMEOUT", timeout: 1 });
    for (let i = 0; i < 7; i++) runFigmaActions(afterTimeout(f.nodes.get(at)!).actions!, vals, hooks);
    expect(at).toBe(b.id);
    expect(vals.get(f.varNamed("Spike", "ctl/ticks").id)).toBe(7);
    const stop = b.findAll((n) => n.name === "button/Stop")[0];
    runFigmaActions(onClick(stop), vals, hooks);
    runFigmaActions(afterTimeout(f.nodes.get(at)!).actions!, vals, hooks);
    expect(at).toBe(control.id);
    expect(vals.get(f.varNamed("Spike", "ctl/ticks").id)).toBe(7);
  });

  it("self-test: every probe lights when Figma behaves as the emulator assumes", async () => {
    const f = new FakeFigma();
    await buildSpike(asApi(f), "basic");
    const vals = f.values();
    const ok = (n: string) => vals.get(f.varNamed("Spike Test", n).id);
    for (const n of ["ok/nested", "ok/flat", "ok/sequential", "ok/if", "ok/alias"]) expect(ok(n)).toBe(false);
    for (const label of ["Run nested", "Run flat", "Seq probe", "If probe", "Alias probe"]) runFigmaActions(onClick(f.byName(`button/${label}`)), vals);
    for (const n of ["ok/nested", "ok/flat", "ok/sequential", "ok/if", "ok/alias"]) expect(ok(n), n).toBe(true);
    // clicking again keeps them lit (the probes are repeatable)
    for (const label of ["Run nested", "Run flat", "Seq probe", "If probe", "Alias probe"]) runFigmaActions(onClick(f.byName(`button/${label}`)), vals);
    for (const n of ["ok/nested", "ok/flat", "ok/sequential", "ok/if", "ok/alias"]) expect(ok(n), n).toBe(true);
    runFigmaActions(onClick(f.byName("button/Clear")), vals);
    for (const n of ["ok/nested", "ok/flat", "ok/sequential", "ok/if", "ok/alias"]) expect(ok(n), n).toBe(false);
    // flat actions really are flat: no EXPRESSION argument is itself an EXPRESSION
    const deep = (d: VariableData): boolean =>
      d.type === "EXPRESSION" && (d.value as Expression).expressionArguments.some((x) => x.type === "EXPRESSION");
    const flatActs = onClick(f.byName("button/Run flat"));
    expect(flatActs.some((a) => a.type === "SET_VARIABLE" && deep(a.variableValue!))).toBe(false);
    expect(selfTest().outs.length).toBe(GATE_TYPES.length * 4);
  });

  it("stress: N gate actions + the tick counter per click, matching the JS chain", async () => {
    const f = new FakeFigma();
    await buildSpike(asApi(f), "stress");
    for (const n of STRESS_SIZES) {
      const main = f.byName(`Stress ${n}`, "FRAME");
      const click = main.findAll((x) => x.name === "button/Click ×1")[0];
      const acts = onClick(click);
      expect(acts.length).toBe(n + 2);
      expect(acts[acts.length - 2]).toEqual(increment(f.varNamed(`Spike Stress ${n}`, "ctl/ticks").id));
      const vals = f.values();
      const model = new Map(Array.from({ length: n }, (_, i) => [i, false]));
      for (let t = 0; t < 5; t++) {
        runFigmaActions(acts, vals);
        runPlanActions(stressActions(n), model);
      }
      const coll = (i: number) => (i < 3998 ? `Spike Stress ${n}` : `Spike Stress ${n} · 2`);
      for (const i of [0, 1, 2, 3, 7, n - 1]) expect(vals.get(f.varNamed(coll(i), `s/${i}`).id), `s/${i}`).toBe(model.get(i));
      expect(vals.get(f.varNamed(`Spike Stress ${n}`, "ctl/ticks").id)).toBe(5);
      expect(afterTimeout(f.byName(`Stress ${n} · Run A`, "FRAME")).actions![0].type).toBe("CONDITIONAL");
    }
  });
});

// ---------- apply() with lane E style bindings ----------

describe("apply()", () => {
  it("creates variables, binds gate and wire lit layers, and wires Step / Reset / Run", async () => {
    const f = new FakeFigma();
    const net = flatten(testLib(), "ACC4");
    const p = plan(net, simpleSchedule(net), { initial: powerOnState(net), name: "Silicon" });
    const display = f.createComponent();
    display.name = "cell/ACC4";
    const gateLit = new Map<number, SceneNode>();
    net.gates.forEach((_, i) => {
      const n = f.createEllipse();
      display.appendChild(n);
      gateLit.set(i, n as unknown as SceneNode);
    });
    const one = f.createEllipse();
    const z = f.createEllipse();
    display.appendChild(one);
    display.appendChild(z);
    one.visible = false;
    const wireLit = new Map<number, SceneNode[]>([
      [1, [one as unknown as SceneNode]],
      [netId(net, "Z"), [z as unknown as SceneNode]],
    ]);
    const res = await apply(asApi(f), p, { bindings: { gateLit, wireLit }, display: display as unknown as ComponentNode, maxPerCollection: 20 });
    expect(res.bound).toBe(net.gates.length + 2);
    expect(res.unbound).toBe(0);
    expect(one.visible).toBe(true); // constant 1 net: fixed, not bound
    expect(z.boundVariables.visible.id).toBe(res.varIds.get(netId(net, "Z")));
    expect(res.collections.map((c) => c.name)).toEqual(["Silicon", "Silicon · 2", "Silicon · 3", "Silicon · 4"].slice(0, Math.ceil((p.variables.length + 2) / 20)));
    // Step, emulated, equals interpret().
    const vals = f.values();
    const state = initialState(p);
    const load = netId(net, "LOAD");
    for (let t = 0; t < 10; t++) {
      const d = (t * 5) & 15;
      state.set(load, t % 3 !== 0);
      vals.set(res.varIds.get(load)!, t % 3 !== 0);
      for (let i = 0; i < 4; i++) {
        state.set(netId(net, `D[${i}]`), ((d >> i) & 1) === 1);
        vals.set(res.varIds.get(netId(net, `D[${i}]`))!, ((d >> i) & 1) === 1);
      }
      runFigmaActions(onClick(res.buttons.step as unknown as FNode), vals);
      interpret(p, state);
      for (const v of p.variables) expect(vals.get(res.varIds.get(v.net)!)).toBe(state.get(v.net));
    }
    expect(vals.get(res.ticks.id)).toBe(10);
    runFigmaActions(onClick(res.buttons.reset as unknown as FNode), vals);
    expect([...vals]).toEqual([...f.values()]);
    // Applying again replaces the old collections and frames.
    await apply(asApi(f), p, { maxPerCollection: 20 });
    expect(f.colls.length).toBe(res.collections.length);
    expect(f.root.findAll((n) => n.name === "Silicon · Control").length).toBe(1);
  });

  it("the Run loop stops on the halt net", async () => {
    const lib = counterLib();
    define(lib, "HALTER", { in: { CLK: 1 }, out: { Q: 4, HALTED: 1 } }, (b) => {
      const q = b.use("COUNTER4", { CLK: b.in1("CLK") }, "c").Q;
      q.forEach((qi, i) => b.BUF(qi, b.out("Q")[i]));
      b.AND(q[0], q[1], b.out1("HALTED")); // halts when the count reaches 3
    });
    const net = flatten(lib, "HALTER");
    const p = plan(net, simpleSchedule(net), { initial: powerOnState(net), halt: "HALTED" });
    const f = new FakeFigma();
    const res = await apply(asApi(f), p, {});
    const vals = f.values();
    let at = res.frames.control.id;
    const hooks = { navigate: (d: string | null) => void (at = d!) };
    runFigmaActions(onClick(res.buttons.run as unknown as FNode), vals, hooks);
    for (let i = 0; i < 10 && at !== res.frames.control.id; i++) runFigmaActions(afterTimeout(f.nodes.get(at)!).actions!, vals, hooks);
    expect(at).toBe(res.frames.control.id);
    expect(vals.get(res.ticks.id)).toBe(3);
    expect(vals.get(res.running.id)).toBe(false);
  });
});

// ---------- chunked ticks ----------

/** CPU circuit + program helpers (lanes D1/D2/C). */
function cpuWith(program: string) {
  const net = cpuNetlist();
  const sched = compile(net, { inputs: [] });
  const bytes = assemble(PROGRAMS[program]).bytes;
  const pokes: Record<string, number> = {};
  bytes.forEach((v, a) => {
    for (let b = 0; b < 8; b++) pokes[ramBit(a, b)] = (v >> b) & 1;
  });
  return { net, sched, init: powerOn(net, pokes), halted: netId(net, PROBES.HALTED.name) };
}

/** Steps `p` by `step` and FastSim side by side; every net with a variable must match after
 * every tick, and every flag must be false at the tick boundary. Returns ticks run. */
function vsFast(net: FlatNetlist, sched: Schedule, init: Uint8Array, p: PrototypePlan, ticks: number, step: (s: Map<number, boolean>) => void, stopNet?: number) {
  const fast = new FastSim(net, sched, init);
  const s = initialState(p);
  for (let t = 1; t <= ticks; t++) {
    step(s);
    fast.tick();
    for (const v of p.variables) if (s.get(v.net) !== (fast.v[v.net] === 1)) throw new Error(`tick ${t}: ${v.name} differs from FastSim`);
    for (const f of p.flags) if (s.get(f.net)) throw new Error(`tick ${t}: flag ${f.name} still set`);
    if (stopNet !== undefined && fast.v[stopNet]) return t;
  }
  return ticks;
}

describe("chunked ticks (maxActionsPerEvent)", () => {
  for (const { top, inputs } of CIRCUITS)
    for (const gate of [false, true])
      it(`${top}${gate ? " gated" : ""}: chunks in order ≡ one tick ≡ RefSim, each event within the cap`, () => {
        const net = flatten(testLib(), top);
        for (const cap of [60, 100, 400]) {
          const p = plan(net, compile(net), { initial: powerOn(net), maxActionsPerEvent: cap, gate });
          if (!p.chunking) {
            // fits in one event: no dispatch at all
            expect(p.stats.worstCase + 4 + 2).toBeLessThanOrEqual(cap);
            continue;
          }
          const ch = p.chunking;
          expect(Math.max(...ch.perEvent)).toBeLessThanOrEqual(cap);
          expect(p.stats.chunks).toBe(ch.chunks.length);
          lockstep(net, p, inputs, 30, (s) => {
            const ex = interpretChunked(p, s);
            ex.forEach((e, k) => expect(e + dispatchOverhead(ex.length) + (k === ex.length - 1 ? ch.tickExtra : 0)).toBeLessThanOrEqual(cap));
          });
        }
      });

  it("the CPU (gated, cap 400): every chunk within the cap, chunks ≡ FastSim on every net until HLT", () => {
    const { net, sched, init, halted } = cpuWith("mul");
    const p = plan(net, sched, { initial: init, gate: true, maxActionsPerEvent: 400 });
    const ch = p.chunking!;
    expect(Math.max(...ch.perEvent)).toBeLessThanOrEqual(400);
    let maxExec = 0;
    const t = vsFast(net, sched, init, p, 400, (s) => (maxExec = Math.max(maxExec, ...interpretChunked(p, s))), halted);
    expect(t).toBeLessThan(400); // mul halts
    expect(maxExec + dispatchOverhead(ch.chunks.length) + ch.tickExtra).toBeLessThanOrEqual(400);
  });

  it("splitActions splits a big conditional into same-condition pieces, and refuses unsafe splits", () => {
    const big: PlanAction = { if: { var: 2 }, then: Array.from({ length: 10 }, (_, i) => ({ set: 10 + i, to: { not: { var: 10 + i } } })) };
    const pieces = splitActions([big], 4);
    expect(pieces.length).toBe(4);
    for (const piece of pieces) expect(worstActions(piece)).toBeLessThanOrEqual(4);
    const a = new Map<number, boolean>([[2, true], ...Array.from({ length: 10 }, (_, i): [number, boolean] => [10 + i, false])]);
    const b = new Map(a);
    runPlanActions([big], a);
    for (const piece of pieces) runPlanActions(piece, b);
    expect([...b]).toEqual([...a]);
    // the body clears its own condition first: splitting would change which branch runs
    const unsafe: PlanAction = { if: { var: 2 }, then: [{ set: 2, to: { const: 0 } }, ...big.then] };
    expect(() => splitActions([unsafe], 4)).toThrow(/cannot split/);
    // …but clearing it last (the HIGH dirty flag) is fine
    expect(() => splitActions([{ if: { var: 2 }, then: [...big.then, { set: 2, to: { const: 0 } }] }], 4)).not.toThrow();
  });
});

// ---------- clock gating ----------

describe("clock gating (gate: true)", () => {
  it("is exact on every net: gated ≡ ungated ≡ RefSim, random inputs, all test circuits", () => {
    for (const { top, inputs } of CIRCUITS) {
      const net = flatten(testLib(), top);
      const p = plan(net, compile(net), { initial: powerOn(net), gate: true });
      lockstep(net, p, inputs, 60, (s) => {
        interpret(p, s);
        for (const f of p.flags) expect(s.get(f.net)).toBe(false);
      });
    }
    // ACC4 has load-enable registers: gating must find them
    const acc = flatten(testLib(), "ACC4");
    expect(plan(acc, compile(acc), { initial: powerOn(acc), gate: true }).stats.gatedBlocks).toBeGreaterThan(0);
  });

  it("the CPU: gated ≡ FastSim on every net, every tick, for count / mul / fib; fewer actions executed", () => {
    const stats: Record<string, unknown> = {};
    for (const program of ["count", "mul", "fib"]) {
      const { net, sched, init, halted } = cpuWith(program);
      const plain = plan(net, sched, { initial: init });
      const p = plan(net, sched, { initial: init, gate: true });
      expect(p.stats.gatedBlocks).toBeGreaterThan(20);
      const exec: number[] = [];
      const ticks = vsFast(net, sched, init, p, 300, (s) => exec.push(runPlanActions(p.tick, s)), halted);
      const avg = exec.reduce((a, b) => a + b, 0) / exec.length;
      expect(avg).toBeLessThan(plain.stats.actionsPerTick * 0.8);
      expect(Math.max(...exec)).toBeLessThanOrEqual(p.stats.worstCase);
      stats[program] = { ticks, ungated: plain.stats.actionsPerTick, avg: Math.round(avg), min: Math.min(...exec), max: Math.max(...exec), worst: p.stats.worstCase, blocks: p.stats.gatedBlocks, flags: p.flags.length };
    }
    console.log("CPU executed actions per tick (gated):", JSON.stringify(stats));
  });
});

// ---------- apply() chunked ----------

describe("apply() with chunked ticks", () => {
  it("Step = one chunk; K Steps = one tick ≡ FastSim; events within the cap; Step ×3, keys, reset", async () => {
    const f = new FakeFigma();
    const net = flatten(testLib(), "ACC4");
    const sched = compile(net);
    const init = powerOn(net);
    const p = plan(net, sched, { initial: init, gate: true, maxActionsPerEvent: 60 });
    const res = await apply(asApi(f), p, { multiTrigger: true, keys: [32, 75] });
    expect(res.chunks).toBe(p.chunking!.chunks.length);
    expect(res.chunks).toBeGreaterThan(1);
    expect(res.actionsPerStep + 2).toBeLessThanOrEqual(60);
    const vals = f.values();
    const step = onClick(res.buttons.step as unknown as FNode);
    const fast = new FastSim(net, sched, init);
    const phase = res.phase!.id;
    for (let t = 1; t <= 12; t++) {
      for (let k = 0; k < res.chunks; k++) {
        expect(vals.get(phase)).toBe(k);
        expect(runFigmaActions(step, vals)).toBeLessThanOrEqual(res.actionsPerStep);
      }
      fast.tick();
      for (const v of p.variables) expect(vals.get(res.varIds.get(v.net)!), `tick ${t} ${v.name}`).toBe(fast.v[v.net] === 1);
      expect(vals.get(res.ticks.id)).toBe(t);
      expect(vals.get(res.tickText!.id)).toBe(String(t));
    }
    // Step ×3: three triggers, each one event (one chunk)
    const multi = (res.buttons.stepMulti as unknown as FNode).reactions.map((r) => r.trigger?.type);
    expect(multi).toEqual(["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"]);
    // keys on the Control and Run frames
    for (const fr of [res.frames.control, res.frames.runA, res.frames.runB])
      expect((fr as unknown as FNode).reactions.find((r) => r.trigger?.type === "ON_KEY_DOWN")?.trigger).toEqual({ type: "ON_KEY_DOWN", device: "KEYBOARD", keyCodes: [32, 75] });
    // a half-done tick, then Reset: everything back to power-on, phase 0. At this tiny cap the reset is itself
    // chunked, so it is a hop chain (Reset A ⇄ B) that returns to Control, every event within the cap.
    runFigmaActions(step, vals);
    expect(res.resetChunks).toBeGreaterThan(1);
    for (const e of clickReset(f, res, vals)) expect(e).toBeLessThanOrEqual(60);
    expect([...vals]).toEqual([...f.values()]);
    // the tick text is a STRING bound to the frame's text; flows: one, no duplicate
    const t = (res.frames.control as unknown as FNode).findAll((n) => n.name === "ticks" && !!n.boundVariables.characters)[0];
    expect(f.vars.get(t.boundVariables.characters.id)?.resolvedType).toBe("STRING");
    expect(f.currentPage.flowStartingPoints).toEqual([{ nodeId: res.frames.control.id, name: p.name }]);
  });

  it("the Run loop runs one chunk per hop and stops on HALTED mid-tick", async () => {
    const lib = counterLib();
    define(lib, "HALTER", { in: { CLK: 1 }, out: { Q: 4, HALTED: 1 } }, (b) => {
      const q = b.use("COUNTER4", { CLK: b.in1("CLK") }, "c").Q;
      q.forEach((qi, i) => b.BUF(qi, b.out("Q")[i]));
      b.AND(q[0], q[1], b.out1("HALTED"));
    });
    const net = flatten(lib, "HALTER");
    const p = plan(net, compile(net), { initial: powerOn(net), halt: "HALTED", maxActionsPerEvent: 30 });
    const f = new FakeFigma();
    const res = await apply(asApi(f), p, {});
    const vals = f.values();
    let at = res.frames.control.id;
    const hooks = { navigate: (d: string | null) => void (at = d!) };
    runFigmaActions(onClick(res.buttons.run as unknown as FNode), vals, hooks);
    let hops = 0;
    for (; hops < 100 && at !== res.frames.control.id; hops++)
      expect(runFigmaActions(afterTimeout(f.nodes.get(at)!).actions!, vals, hooks)).toBeLessThanOrEqual(30);
    expect(at).toBe(res.frames.control.id);
    expect(vals.get(res.ticks.id)).toBe(3);
    expect(hops).toBe(3 * res.chunks + 1); // HALTED is seen at the next hop, which stops instead
  });

  it("tickDisplay 'digits' counts in STRING digits within the event budget", async () => {
    const net = counterNetlist();
    const p = plan(net, compile(net), { initial: powerOn(net), maxActionsPerEvent: 80 });
    const f = new FakeFigma();
    const res = await apply(asApi(f), p, { tickDisplay: "digits" });
    expect(res.tickText).toBeUndefined();
    const vals = f.values();
    const step = onClick(res.buttons.step as unknown as FNode);
    for (let i = 0; i < 123 * res.chunks; i++) expect(runFigmaActions(step, vals)).toBeLessThanOrEqual(80 - 2);
    const digit = (i: number) => vals.get(f.varNamed(p.name, `ctl/digitText/${i}`).id);
    expect([3, 2, 1, 0].map(digit).join("")).toBe("0123");
  });
});

// ---------- spike v2 ----------

describe("spike v2 (fake Figma API)", () => {
  it("builds every v2 test without errors, one flow each, no duplicate flows", async () => {
    const f = new FakeFigma();
    const r = await buildSpike(asApi(f), "v2");
    expect(r.errors).toEqual([]);
    const flows = f.currentPage.flowStartingPoints.map((x) => x.name);
    for (const n of V2_LIMITS) expect(flows).toContain(`${V2_PREFIX}Limit ${n}`);
    for (const n of ["Triggers", "Keys", "Hover", "Text", "Loops", "chunked counter", "If false ×3000", "5 × If true ×400"]) expect(flows).toContain(`${V2_PREFIX}${n}`);
    expect(new Set(f.currentPage.flowStartingPoints.map((x) => x.nodeId)).size).toBe(flows.length);
    // rebuilding replaces it
    expect((await buildSpike(asApi(f), "v2")).errors).toEqual([]);
    expect(f.colls.filter((c) => c.name === V2_COLLECTION).length).toBe(1);
  });

  it("limits: a click executes exactly N actions; conditionals execute what they claim", async () => {
    const f = new FakeFigma();
    await buildSpike(asApi(f), "v2-limits");
    const vals = f.values();
    const click = (frame: string, label?: string) =>
      onClick(f.byName(`${V2_PREFIX}${frame}`, "FRAME").findAll((n) => n.name.startsWith(`button/${label ?? ""}`))[0]);
    for (const n of V2_LIMITS) {
      const acts = click(`Limit ${n}`, "Click");
      expect(acts.length).toBe(n);
      expect(runFigmaActions(acts, vals)).toBe(n);
    }
    expect(runFigmaActions(click("If false ×3000"), vals)).toBe(1 + 3);
    expect(runFigmaActions(click("If true ×2500"), vals)).toBe(1 + 2500 + 3);
    expect(runFigmaActions(click("5 × If true ×400"), vals)).toBe(5 * 401 + 3);
    expect(runFigmaActions(click("Nested 4 × 500"), vals)).toBe(4 + 2000 + 3);
    expect(worstCase(click("If false ×3000"))).toBe(3004);
  });

  it("triggers, keys, hover: the reactions and their counters", async () => {
    const f = new FakeFigma();
    await buildSpike(asApi(f), "v2-input");
    const vals = f.values();
    const trig = f.byName(`${V2_PREFIX}Triggers`, "FRAME");
    for (const n of V2_TRIGGER_N) {
      const b = trig.findAll((x) => x.name === `button/3 triggers × ${n}`)[0];
      expect(b.reactions.map((r) => r.trigger?.type)).toEqual(["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"]);
      for (const r of b.reactions) expect(runFigmaActions(r.actions!, vals)).toBe(n + 3);
      for (const k of ["down", "up", "click"]) expect(vals.get(f.varNamed(V2_COLLECTION, `trig${n}/${k}/text`).id)).toBe("1");
    }
    const keys = f.byName(`${V2_PREFIX}Keys`, "FRAME");
    expect(keys.reactions.map((r) => (r.trigger as unknown as { keyCodes: number[] }).keyCodes[0])).toEqual([32, 75, 74]);
    for (const r of keys.reactions) runFigmaActions(r.actions!, vals);
    expect(vals.get(f.varNamed(V2_COLLECTION, "keySpace/text").id)).toBe("1");
    expect(vals.get(f.varNamed(V2_COLLECTION, "keySpace/digitText0").id)).toBe("1");
    expect(keys.findAll((n) => n.name === "key target M")[0].visible).toBe(false);
    const cells = f.byName(`${V2_PREFIX}Hover`, "FRAME").findAll((n) => n.name.startsWith("cell "));
    expect(cells.length).toBe(28);
    for (const c of cells) runFigmaActions(c.reactions[0].actions!, vals);
    expect(vals.get(f.varNamed(V2_COLLECTION, "hover/text").id)).toBe("28");
    expect([3, 2, 1, 0].map((i) => vals.get(f.varNamed(V2_COLLECTION, `hover/digitText${i}`).id)).join("")).toBe("0028");
  });

  it("text and loops: E1/E2/E4 count, loops hop and stop, variants flip", async () => {
    const f = new FakeFigma();
    await buildSpike(asApi(f), "v2-loops");
    const vals = f.values();
    const tf = f.byName(`${V2_PREFIX}Text`, "FRAME");
    for (const label of ['E1 "n=" + number', 'E2 number + ""', "E4 digits"]) {
      const acts = onClick(tf.findAll((n) => n.name === `button/${label}`)[0]);
      for (let i = 0; i < 3; i++) runFigmaActions(acts, vals);
    }
    expect(vals.get(f.varNamed(V2_COLLECTION, "text/s1").id)).toBe("n=3");
    expect(vals.get(f.varNamed(V2_COLLECTION, "text/s2").id)).toBe("3");
    expect(vals.get(f.varNamed(V2_COLLECTION, "text/digits/text").id)).toBe("3");
    // E3 stores a FLOAT into a STRING: our emulator rejects it (Figma's behavior is the question)
    expect(() => runFigmaActions(onClick(tf.findAll((n) => n.name === "button/E3 string := number alias")[0]), vals)).toThrow(/FLOAT into STRING/);
    // a NAVIGATE loop: Start → A → B → … → Stop → back to Loops
    const menu = f.byName(`${V2_PREFIX}Loops`, "FRAME");
    let at = menu.id;
    const hooks = { navigate: (d: string | null) => void (at = d!) };
    runFigmaActions(onClick(menu.findAll((n) => n.name === "button/Start NAVIGATE t=10")[0]), vals, hooks);
    const a = f.byName(`${V2_PREFIX}Loop NAVIGATE t=10 · A`, "FRAME");
    expect(at).toBe(a.id);
    expect(afterTimeout(a).trigger).toEqual({ type: "AFTER_TIMEOUT", timeout: 10 });
    for (let i = 0; i < 5; i++) runFigmaActions(afterTimeout(f.nodes.get(at)!).actions!, vals, hooks);
    expect(vals.get(f.varNamed(V2_COLLECTION, "loop/NAVIGATE t=10/text").id)).toBe("5");
    runFigmaActions(onClick(f.nodes.get(at)!.findAll((n) => n.name === "button/Stop")[0]), vals, hooks);
    runFigmaActions(afterTimeout(f.nodes.get(at)!).actions!, vals, hooks);
    expect(at).toBe(menu.id);
    // the 3-frame loop really has three frames; SWAP uses SWAP
    expect(f.root.findAll((n) => n.name.startsWith(`${V2_PREFIX}Loop NAVIGATE 3 frames`)).length).toBe(3);
    const swap = afterTimeout(f.byName(`${V2_PREFIX}Loop SWAP t=1 · A`, "FRAME")).actions![0];
    expect(swap.type === "CONDITIONAL" && last(swap.conditionalBlocks[0].actions)).toMatchObject({ navigation: "SWAP" });
    // variant loops: two variants that CHANGE_TO each other after the delay
    const set = f.byName(`${V2_PREFIX}variants variants t=1`, "COMPONENT_SET");
    const [va, vb] = set.children;
    expect(last(afterTimeout(va).actions!)).toMatchObject({ navigation: "CHANGE_TO", destinationId: vb.id });
    expect(last(afterTimeout(vb).actions!)).toMatchObject({ navigation: "CHANGE_TO", destinationId: va.id });
  });

  it("chunked counter: one chunk per event, Step ×3 and keys run chunks, Q counts", async () => {
    const f = new FakeFigma();
    expect((await buildSpike(asApi(f), "v2-chunked")).errors).toEqual([]);
    const control = f.byName(`${CHUNKED.name} · Control`, "FRAME");
    const vals = f.values();
    const step = onClick(control.findAll((n) => n.name === "button/Step")[0]);
    const multi = control.findAll((n) => n.name === "button/Step ×3")[0].reactions;
    const key = control.reactions.find((r) => r.trigger?.type === "ON_KEY_DOWN")!.actions!;
    const p = plan(counterNetlist(), compile(counterNetlist()), { initial: powerOn(counterNetlist()), name: CHUNKED.name, maxActionsPerEvent: CHUNKED.maxActionsPerEvent });
    const K = p.chunking!.chunks.length;
    expect(K).toBeGreaterThan(2);
    // mix the triggers: every event advances one chunk
    const events = [step, ...multi.map((r) => r.actions!), key];
    for (let i = 0; i < 5 * K; i++) expect(runFigmaActions(events[i % events.length], vals)).toBeLessThanOrEqual(CHUNKED.maxActionsPerEvent - 2);
    expect(vals.get(f.varNamed(CHUNKED.name, "ctl/tickText").id)).toBe("5");
    const q = counterNetlist().ports.find((x) => x.name === "Q")!.nets;
    expect(q.reduce((acc, n, i) => acc | ((vals.get(f.varNamed(CHUNKED.name, p.variables.find((v) => v.net === n)!.name).id) ? 1 : 0) << i), 0)).toBe(5);
  });
});

// ---------- chunked Reset (our fix) ----------
// A Reset that restores every variable of the whole CPU is ~2,300 actions in one click, past the 2001 at which
// Figma's viewer died in the team's own spike. apply() now runs a big reset as a hop chain (Reset A ⇄ Reset B,
// one dispatched chunk per hop) and returns to Control.

/** Clicks Reset and follows the hop chain until Control is shown again. Returns the executed actions of every event. */
function clickReset(f: FakeFigma, res: Awaited<ReturnType<typeof apply>>, vals: Map<string, any>, maxHops = 200): number[] {
  let at = res.frames.control.id;
  const hooks = { navigate: (d: string | null) => void (at = d!) };
  const events = [runFigmaActions(onClick(res.buttons.reset as unknown as FNode), vals, hooks)];
  for (let hops = 0; at !== res.frames.control.id; hops++) {
    if (hops > maxHops) throw new Error("reset chain does not return to Control");
    events.push(runFigmaActions(afterTimeout(f.nodes.get(at)!).actions!, vals, hooks));
  }
  return events;
}

describe("chunked Reset", () => {
  it("counter, small cap: reset becomes a hop chain, every event within the cap, state back to power-on", async () => {
    const net = counterNetlist();
    const sched = compile(net);
    const cap = 40;
    const p = plan(net, sched, { initial: powerOn(net), maxActionsPerEvent: cap });
    expect(worstActions(p.reset) + 6 + 2).toBeGreaterThan(cap); // it would not fit in one event
    const f = new FakeFigma();
    const res = await apply(asApi(f), p, {});
    expect(res.resetChunks).toBeGreaterThan(1);
    expect(res.frames.resetA && res.frames.resetB).toBeTruthy();
    const vals = f.values();
    const step = onClick(res.buttons.step as unknown as FNode);
    for (let i = 0; i < 7 * res.chunks + 1; i++) runFigmaActions(step, vals); // mid-tick, counters nonzero
    expect(vals.get(res.ticks.id)).toBeGreaterThan(0);
    const events = clickReset(f, res, vals);
    expect(events.length).toBe(1 + res.resetChunks); // the click, then one hop per chunk
    for (const e of events) expect(e).toBeLessThanOrEqual(cap);
    expect([...vals]).toEqual([...f.values()]); // every variable back to its initial value
  });

  it("a Run in progress is stopped by Reset", async () => {
    const net = counterNetlist();
    const p = plan(net, compile(net), { initial: powerOn(net), maxActionsPerEvent: 40 });
    const f = new FakeFigma();
    const res = await apply(asApi(f), p, {});
    const vals = f.values();
    vals.set(res.running.id, true);
    clickReset(f, res, vals);
    expect(vals.get(res.running.id)).toBe(false);
    expect(vals.get(res.ticks.id)).toBe(0);
  });

  it("fits in one event: no extra frames, and the plan's reset is the click itself", async () => {
    const net = counterNetlist();
    const p = plan(net, compile(net), { initial: powerOn(net) });
    const f = new FakeFigma();
    const res = await apply(asApi(f), p, { maxActionsPerEvent: Infinity });
    expect(res.resetChunks).toBe(1);
    expect(res.frames.resetA).toBeUndefined();
    const vals = f.values();
    runFigmaActions(onClick(res.buttons.step as unknown as FNode), vals);
    const events = clickReset(f, res, vals);
    expect(events.length).toBe(1);
    expect([...vals]).toEqual([...f.values()]);
  });

  it("re-applying replaces the reset frames (no duplicates)", async () => {
    const net = counterNetlist();
    const p = plan(net, compile(net), { initial: powerOn(net), maxActionsPerEvent: 40 });
    const f = new FakeFigma();
    await apply(asApi(f), p, {});
    await apply(asApi(f), p, {});
    const names = f.currentPage.children.map((n: any) => n.name);
    expect(names.filter((n: string) => n.endsWith("Reset A")).length).toBe(1);
    expect(names.filter((n: string) => n.endsWith("Reset B")).length).toBe(1);
  });
});

describe("the real CPU (default cap)", () => {
  it("Step, Run hop and Reset all stay within the cap; Reset returns every one of the ~2,300 variables to power-on", async () => {
    const net = cpuNetlist();
    const sched = compile(net, { inputs: [] });
    const bytes = assemble(PROGRAMS.mul).bytes;
    const init = powerOnWith(net, bytes);
    const p = plan(net, sched, { initial: init, name: "CPU", halt: PROBES.HALTED.name } as any);
    const f = new FakeFigma();
    const res = await apply(asApi(f), p, { maxActionsPerEvent: 400 });
    expect(res.actionsPerStep + 2).toBeLessThanOrEqual(400);
    expect(res.chunks).toBeGreaterThan(1);
    expect(res.resetChunks).toBeGreaterThan(1);
    for (const e of res.resetChunking!.perEvent) expect(e).toBeLessThanOrEqual(400);
    const vals = f.values();
    const step = onClick(res.buttons.step as unknown as FNode);
    for (let i = 0; i < 30 * res.chunks; i++) expect(runFigmaActions(step, vals)).toBeLessThanOrEqual(400);
    expect(vals.get(res.ticks.id)).toBe(30);
    const events = clickReset(f, res, vals);
    for (const e of events) expect(e).toBeLessThanOrEqual(400);
    expect(events.length).toBe(1 + res.resetChunks);
    expect([...vals]).toEqual([...f.values()]);
    console.log(`[reset] CPU: ${res.chunks} events per tick (≤ ${Math.max(...res.chunking!.perEvent)} actions), ${res.resetChunks} events per reset (≤ ${Math.max(...res.resetChunking!.perEvent)} actions)`);
  });
});
