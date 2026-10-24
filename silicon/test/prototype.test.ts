import { describe, expect, it } from "vitest";
import { buildSpike, counterPlan, selfTest, STRESS_SIZES, stressActions } from "../spike/src/spike";
import { counterLib, counterNetlist } from "../spike/src/circuits";
import type { Schedule } from "../src/compile/types";
import { define } from "../src/hdl/builder";
import { flatten, netId } from "../src/netlist/flatten";
import { type FlatNetlist, GATE_TYPES, evalGate, type Library } from "../src/netlist/types";
import { apply } from "../src/prototype/apply";
import { runFigmaActions, type FigmaValue } from "../src/prototype/emulate";
import { aliasData, boolData, conditional, exprData, figmaActions, increment, navigate, toFigmaActions } from "../src/prototype/figma-actions";
import { initialState, interpret, runPlanActions } from "../src/prototype/interpret";
import { gateExpr, plan, varName } from "../src/prototype/plan";
import { powerOnState, simpleSchedule } from "../src/prototype/schedule";
import type { Expr, PlanAction, PrototypePlan } from "../src/prototype/types";
import { RefSim } from "../src/sim/reference";

// ---------- lane A (src/compile), used when it exists ----------

interface LaneA {
  compile?: (net: FlatNetlist) => Schedule;
  powerOn?: (net: FlatNetlist) => Uint8Array;
  FastSim?: new (net: FlatNetlist, s: Schedule, init: Uint8Array) => { v: Uint8Array; set(p: string, n: number): void; tick(): void };
}
async function loadLaneA(): Promise<LaneA> {
  const out: LaneA = {};
  for (const p of ["../src/compile/index", "../src/compile/compile", "../src/compile/schedule", "../src/compile/fastsim", "../src/compile/fast"]) {
    try {
      const m = await import(/* @vite-ignore */ p);
      out.compile ??= m.compile;
      out.powerOn ??= m.powerOn;
      out.FastSim ??= m.FastSim;
    } catch {
      /* not there (yet) */
    }
  }
  return out;
}
const laneA = await loadLaneA();

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

  it.skipIf(!laneA.compile)("with lane A's compile() + powerOn(): interpret ≡ RefSim ≡ FastSim, nested and flat", () => {
    for (const { top, inputs } of CIRCUITS)
      for (const flat of [false, true]) {
        const net = flatten(testLib(), top);
        const sched = laneA.compile!(net);
        const init = (laneA.powerOn ?? powerOnState)(net);
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
  flowStartingPoints: Array<{ nodeId: string; name: string }> = [];
  constructor(
    readonly type: string,
    readonly api: FakeFigma,
  ) {
    api.nodes.set(this.id, this);
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
    if (field === "characters" && (this.type !== "TEXT" || v.resolvedType === "BOOLEAN")) throw new Error("characters needs a text node and FLOAT/STRING");
    this.boundVariables[field] = { type: "VARIABLE_ALIAS", id: v.id };
  }
  async setReactionsAsync(r: Reaction[]) {
    for (const re of r) {
      if (re.trigger?.type === "AFTER_TIMEOUT" && this.parent?.type !== "PAGE") throw new Error("AFTER_TIMEOUT only on top-level frames");
      const check = (acts: readonly Action[]) => {
        for (const a of acts) {
          if (a.type === "SET_VARIABLE" && !this.api.vars.has(a.variableId!)) throw new Error(`unknown variable ${a.variableId}`);
          if (a.type === "NODE" && this.api.nodes.get(a.destinationId!)?.parent?.type !== "PAGE") throw new Error("navigate to non-top-level");
          if (a.type === "CONDITIONAL") a.conditionalBlocks.forEach((b) => check(b.actions));
        }
      };
      check(re.actions ?? []);
    }
    this.reactions = JSON.parse(JSON.stringify(r));
  }
  createInstance() {
    const i = new FNode("INSTANCE", this.api);
    i.name = this.name;
    i.resize(this.width, this.height);
    return i;
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
    if ((this.resolvedType === "BOOLEAN") !== (typeof v === "boolean")) throw new Error(`${this.name}: wrong value type`);
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

// ---------- the spike, built against the fake API ----------

describe("spike plugin (fake Figma API)", () => {
  it("builds every part without errors, chunking big collections", async () => {
    const f = new FakeFigma();
    const r = await buildSpike(asApi(f), "all");
    expect(r.errors).toEqual([]);
    expect(f.currentPage.name).toBe("Silicon · Spike");
    const colls = f.colls.map((c) => `${c.name}:${c.vars.length}`);
    expect(colls).toEqual(["Spike:45", "Spike Test:84", "Spike Stress 500:502", "Spike Stress 2000:2002", "Spike Stress 5000:4000", "Spike Stress 5000 · 2:1002"]);
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
    expect(stepActs.length).toBe(p.stats.actionsPerTick + 1);
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
      expect(acts.length).toBe(n + 1);
      expect(acts[acts.length - 1]).toEqual(increment(f.varNamed(`Spike Stress ${n}`, "ctl/ticks").id));
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
