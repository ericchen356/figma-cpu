// auditBuild(): the "did the first run build correctly?" checks on a Figma REST dump. Synthetic REST trees shaped
// like what apply() + buildStepFrame() + the front panel produce (chunked Step and Reset), then one mutation per
// failure mode. Plus, if present, the real dump of Eric's legacy (unchunked) file.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cpuNetlist } from "../src/cpu";
import { RAM_BYTES } from "../src/isa";
import { parseRest, type AuditInput, type RestAction, type RestNode } from "../src/audit/audit";
import { auditBuild, destinations, expectedFrom, memLampNames, type BuildAudit } from "../src/audit/build";

// ── REST builders ──
let seq = 0;
const nid = () => `9:${++seq}`;
const V = (k: string) => `VariableID:${k}`;
const alias = (k: string) => ({ type: "VARIABLE_ALIAS", id: V(k) });
const node = (name: string, type: string, o: Partial<RestNode> = {}): RestNode => ({ id: nid(), name, type, ...o });
const lit = (k: string | null, name = "lit") => node(name, "RECTANGLE", k ? { boundVariables: { visible: alias(k) } } : {});
const set = (k: string, value: unknown = { type: "BOOLEAN", resolvedType: "BOOLEAN", value: false }): RestAction => ({ type: "SET_VARIABLE", variableId: V(k), variableValue: value });
const float = (v: number) => ({ type: "FLOAT", resolvedType: "FLOAT", value: v });
const expr = (fn: string, args: unknown[], resolvedType = "BOOLEAN") => ({ type: "EXPRESSION", resolvedType, value: { expressionFunction: fn, expressionArguments: args } });
const arg = (k: string, resolvedType = "FLOAT") => ({ type: "VARIABLE_ALIAS", resolvedType, value: { type: "VARIABLE_ALIAS", id: V(k) } });
const go = (id: string): RestAction => ({ type: "NODE", destinationId: id, navigation: "NAVIGATE" });
const cond = (...blocks: Array<{ condition?: unknown; actions: RestAction[] }>): RestAction => ({ type: "CONDITIONAL", conditionalBlocks: blocks });
const eq = (k: string, v: number) => expr("EQUALS", [arg(k), float(v)]);
const click = (actions: RestAction[]) => ({ trigger: { type: "ON_CLICK" }, actions });
const after = (actions: RestAction[]) => ({ trigger: { type: "AFTER_TIMEOUT", timeout: 1 }, actions });
const last = <T>(xs: readonly T[]): T => xs[xs.length - 1];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const reId = (n: RestNode): RestNode => ({ ...n, id: nid(), ...(n.children ? { children: n.children.map(reId) } : {}) });

function walk(n: RestNode, f: (n: RestNode, parent?: RestNode) => void, parent?: RestNode) {
  f(n, parent);
  for (const c of n.children ?? []) walk(c, f, n);
}
function find(root: RestNode, name: string, within?: string): RestNode {
  const scope = within ? find(root, within) : root;
  let hit: RestNode | undefined;
  walk(scope, (n) => {
    if (!hit && n.name === name) hit = n;
  });
  if (!hit) throw new Error(`no ${name}${within ? ` in ${within}` : ""}`);
  return hit;
}

// Wires: 4 gate outputs (g0..g3), 1 wire lit (w0), 2 panel probes (p0, p1), one RAM bit per MEM lamp (m0…).
const GATE_WIRES = ["g0", "g1", "g2", "g3"];
const WIRES = [...GATE_WIRES, "w0", "p0", "p1", ...memLampNames().map((_, i) => `m${i}`)];
const EXPECTED = { gates: { AND: 2, XOR: 1, NOT: 1 }, wires: WIRES.length };

/** A correctly built, chunked file: Control / Run A,B / Reset A,B / CPU · Step / Reset A,B (Step), 2 flows. */
function builtFile(o: { resetPerHop?: number } = {}) {
  seq = 0;
  const components: Record<string, { name: string }> = {};
  const compId = (name: string) => {
    const id = `c:${name}`;
    components[id] = { name };
    return id;
  };
  const gate = (name: string, type: string, k: string) => node(name, "INSTANCE", { componentId: compId(`gate/${type}`), children: [node("body", "RECTANGLE"), lit(k)] });
  const cpu = node("cell/CPU", "COMPONENT", {
    children: [
      gate("alu/a0", "AND", "g0"),
      node("wires", "FRAME", { children: [gate("alu/a1", "AND", "g1"), lit("w0", "wire/x/lit")] }),
      gate("alu/x0", "XOR", "g2"),
      gate("ctl/n0", "NOT", "g3"),
    ],
  });
  const lamp = (name: string, k: string) => node(name, "FRAME", { children: [node("off", "ELLIPSE"), lit(k)] });
  const panel = node("Silicon · Front panel", "COMPONENT", {
    children: [lamp("seg/SEG_LO[0]", "p0"), lamp("lamp/pc[0]", "p1"), node("mem", "FRAME", { children: memLampNames().map((n, i) => lamp(n, `m${i}`)) })],
  });
  const panelId = compId(panel.name);
  const instance = () => node("Silicon · Front panel", "INSTANCE", { componentId: panelId, children: clone(panel.children!).map(reId) });

  // Variables: controls + the wires.
  const tick = [...WIRES.map((k) => set(k))];
  const half = Math.ceil(tick.length / 2);
  const stepEvent: RestAction[] = [
    set("phaseNow", expr("ADDITION", [arg("phase"), float(0)], "FLOAT")),
    cond({ condition: eq("phaseNow", 0), actions: [...tick.slice(0, half), set("phase", float(1)), set("phaseText", expr("ADDITION", [{ type: "STRING", value: "" }, arg("phase")], "STRING"))] }),
    cond({
      condition: eq("phaseNow", 1),
      actions: [...tick.slice(half), set("phase", float(0)), set("ticks", expr("ADDITION", [arg("ticks"), float(1)], "FLOAT")), set("tickText", expr("ADDITION", [{ type: "STRING", value: "" }, arg("ticks")], "STRING"))],
    }),
  ];
  const resetChunk = (k: number) => [...WIRES.slice(k * half, (k + 1) * half).map((w) => set(w)), ...Array.from({ length: o.resetPerHop ?? 0 }, () => set("w0"))];
  const resetEvent: RestAction[] = [
    set("resetNow", expr("ADDITION", [arg("resetPhase"), float(0)], "FLOAT")),
    cond({ condition: eq("resetNow", 0), actions: [...resetChunk(0), set("resetPhase", float(1))] }),
    cond({ condition: eq("resetNow", 1), actions: [...resetChunk(1), set("resetPhase", float(0)), set("ticks", float(0)), set("running", { type: "BOOLEAN", value: false }), set("resetNow", float(0))] }),
  ];

  const frame = (name: string, children: RestNode[] = []) => node(name, "FRAME", { children });
  const control = frame("CPU · Control", [instance()]);
  const runA = frame("CPU · Run A", [instance()]);
  const runB = frame("CPU · Run B", [instance()]);
  const resetA = frame("CPU · Reset A", [instance()]);
  const resetB = frame("CPU · Reset B", [instance()]);
  const resetAS = frame("CPU · Reset A (Step)", [instance()]);
  const resetBS = frame("CPU · Reset B (Step)", [instance()]);
  const header = frame("header", [instance()]);
  const step = frame("CPU · Step", [header, cpu]);
  const keepGoing = expr("AND", [arg("running", "BOOLEAN"), expr("NOT", [arg("p1", "BOOLEAN")])]);
  const loop = (other: RestNode) => [after([cond({ condition: keepGoing, actions: [...stepEvent, go(other.id)] }, { actions: [set("running", { type: "BOOLEAN", value: false }), go(control.id)] })])];
  runA.interactions = loop(runB);
  runB.interactions = loop(runA);
  const hop = (home: RestNode, other: RestNode) => [after([...resetEvent, cond({ condition: eq("resetPhase", 0), actions: [go(home.id)] }, { actions: [go(other.id)] })])];
  resetA.interactions = hop(control, resetB);
  resetB.interactions = hop(control, resetA);
  resetAS.interactions = hop(step, resetBS);
  resetBS.interactions = hop(step, resetAS);
  const buttons = (into: RestNode, firstReset: RestNode) =>
    into.children!.push(
      node("button/Step", "FRAME", { interactions: [click(stepEvent)] }),
      node("button/Run", "FRAME", { interactions: [click([set("running", { type: "BOOLEAN", resolvedType: "BOOLEAN", value: true }), go(runA.id)])] }),
      node("button/Reset", "FRAME", { interactions: [click([set("running", { type: "BOOLEAN", value: false }), set("resetPhase", float(0)), go(firstReset.id)])] }),
    );
  buttons(control, resetA);
  buttons(header, resetAS);
  for (const f of [runA, runB]) f.children!.push(node("button/Stop", "FRAME", { interactions: [click([set("running", { type: "BOOLEAN", value: false })])] }));

  const canvas = node("Silicon", "CANVAS", {
    flowStartingPoints: [
      { nodeId: control.id, name: "CPU" },
      { nodeId: step.id, name: "CPU · Step" },
    ],
    children: [panel, control, runA, runB, resetA, resetB, step, resetAS, resetBS],
  });
  const json = { nodes: { [canvas.id]: { document: canvas, components } } };
  return { json, canvas, input: parseRest(json) as AuditInput };
}

const run = (input: AuditInput, expected = EXPECTED, cap = 400) => auditBuild(input, expected, { cap });
const check = (a: BuildAudit, id: string) => {
  const c = a.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}: ${a.checks.map((x) => x.id).join(", ")}`);
  return c;
};
const failed = (a: BuildAudit) => a.checks.filter((c) => c.status === "fail").map((c) => c.id);

describe("auditBuild: a correctly built chunked file", () => {
  it("passes every check and says READY", () => {
    const a = run(builtFile().input);
    expect(failed(a)).toEqual([]);
    expect(a.ready).toBe(true);
    expect(a.legacy).toBe(false);
    expect(a.rebuildNeeded).toBe(false);
    expect(last(a.text.split("\n"))).toBe("VERDICT: READY to present");
    expect(a.text).toContain("✓ Reset on CPU · Control: CPU · Reset A ⇄ CPU · Reset B → back to CPU · Control");
    expect(a.text).toContain("✓ Reset on CPU · Step: CPU · Reset A (Step) ⇄ CPU · Reset B (Step) → back to CPU · Step");
  });
  it("reports the graph, bindings and variables it found", () => {
    const a = run(builtFile().input);
    expect(a.reactions.resets.map((r) => [r.home, r.chunked, r.hops, r.exits])).toEqual([
      ["CPU · Control", true, ["CPU · Reset A", "CPU · Reset B"], ["CPU · Reset A", "CPU · Reset B"]],
      ["CPU · Step", true, ["CPU · Reset A (Step)", "CPU · Reset B (Step)"], ["CPU · Reset A (Step)", "CPU · Reset B (Step)"]],
    ]);
    expect(a.reactions.run.edges).toEqual({ "CPU · Run A": ["CPU · Run B", "CPU · Control"], "CPU · Run B": ["CPU · Run A", "CPU · Control"] });
    expect(a.bindings.gates).toEqual({ instances: 4, bound: 4, unbound: [] });
    expect(a.bindings.mem).toEqual({ present: RAM_BYTES * 8, bound: RAM_BYTES * 8, missing: [], unbound: [] });
    expect(a.bindings.panel.lamps).toBe(2 + RAM_BYTES * 8); // the 2 probes + the MEM screen
    expect(a.bindings.panel.instances).toHaveLength(8);
    expect(a.variables.wires).toBe(WIRES.length);
    expect(Object.keys(a.variables.roles).sort()).toEqual(["counter", "phase", "phaseNow", "resetPhase", "resetPhaseNow", "running", "text"]);
    expect(a.variables.roles.text).toHaveLength(2);
    expect(a.variables.control).toBe(8);
  });
  it("finds NODE destinations inside nested conditionals", () => {
    expect(destinations([go("1:1"), cond({ actions: [cond({ actions: [go("1:2")] })] }, { actions: [go("1:3")] })])).toEqual(["1:1", "1:2", "1:3"]);
  });
});

describe("auditBuild: each failure mode fires", () => {
  it("a Reset chain that returns to the wrong frame (Step flow back to Control)", () => {
    const { canvas, input } = builtFile();
    const control = find(canvas, "CPU · Control");
    const hopB = find(canvas, "CPU · Reset B (Step)");
    const blocks = (last(hopB.interactions![0].actions!) as RestAction).conditionalBlocks!;
    blocks[0].actions = [go(control.id)];
    const a = run(input);
    expect(failed(a)).toEqual(["reset:CPU · Step"]);
    expect(check(a, "reset:CPU · Step").message).toContain("CPU · Reset B (Step) returns to CPU · Control, not to CPU · Step");
    expect(a.verdict).toMatch(/^REBUILD needed: Reset on CPU · Step/);
  });
  it("the Step header's Reset starting the Control flow's chain", () => {
    const { canvas, input } = builtFile();
    const reset = find(canvas, "button/Reset", "header");
    (last(reset.interactions![0].actions!) as RestAction).destinationId = find(canvas, "CPU · Reset A").id;
    const c = check(run(input), "reset:CPU · Step");
    expect(c.status).toBe("fail");
    expect([c.message, ...(c.details ?? [])].join("\n")).toContain("uses CPU · Reset A (expected CPU · Reset A (Step) / CPU · Reset B (Step))");
    expect([c.message, ...(c.details ?? [])].join("\n")).toContain("returns to CPU · Control, not to CPU · Step");
  });
  it("a cycle with no exit", () => {
    const { canvas, input } = builtFile();
    for (const [self, other] of [
      ["CPU · Reset A", "CPU · Reset B"],
      ["CPU · Reset B", "CPU · Reset A"],
    ]) {
      const f = find(canvas, self);
      const blocks = (last(f.interactions![0].actions!) as RestAction).conditionalBlocks!;
      blocks[0].actions = [go(find(canvas, other).id)];
    }
    const a = run(input);
    expect(failed(a)).toEqual(["reset:CPU · Control"]);
    expect(check(a, "reset:CPU · Control").message).toBe("no way back to CPU · Control from CPU · Reset A, CPU · Reset B: a cycle with no exit");
  });
  it("a dead end (a hop frame without AFTER_TIMEOUT)", () => {
    const { canvas, input } = builtFile();
    delete find(canvas, "CPU · Reset B").interactions;
    const c = check(run(input), "reset:CPU · Control");
    expect(c.status).toBe("fail");
    expect([c.message, ...(c.details ?? [])].join("\n")).toContain("CPU · Reset B has no AFTER_TIMEOUT hop");
  });
  it("an over-cap event on the Reset chain", () => {
    const a = run(builtFile({ resetPerHop: 450 }).input);
    expect(failed(a)).toEqual(["reset:CPU · Control", "reset:CPU · Step", "events"]);
    expect(check(a, "reset:CPU · Control").message).toMatch(/^CPU · Reset A hop runs [\d,]+ actions in one event \(cap 400\)$/);
    expect(a.legacy).toBe(false);
  });
  it("an unchunked legacy Reset (one big click, no hop frames) says rebuild", () => {
    const { canvas, input } = builtFile();
    canvas.children = canvas.children!.filter((n) => !/Reset [AB]/.test(n.name));
    for (const b of [find(canvas, "button/Reset", "CPU · Control"), find(canvas, "button/Reset", "header")])
      b.interactions = [click(Array.from({ length: 2289 }, () => set("w0")))];
    const a = run(input);
    expect(a.legacy).toBe(true);
    expect(failed(a)).toEqual(["reset:CPU · Control", "reset:CPU · Step", "events"]);
    expect(check(a, "reset:CPU · Control").message).toBe("one click runs 2,289 actions (cap 400; the viewer died at 2,001): unchunked legacy Reset, rebuild with Compile");
    expect(a.verdict).toContain("legacy unchunked build: run Compile with the current plugin");
    expect(check(a, "frames").status).toBe("pass"); // no chunking → no Reset frames expected
  });
  it("a missing MEM lamp binding, by name", () => {
    const { canvas, input } = builtFile();
    const l = find(find(canvas, "Silicon · Front panel"), "lamp/ram/row3/b5/Q");
    delete l.children!.find((c) => c.name === "lit")!.boundVariables;
    const a = run(input);
    expect(failed(a)).toEqual(["bind:panel", "bind:mem"]); // the instances still carry the binding: the variable count is unchanged
    expect(check(a, "bind:mem").message).toBe(`${RAM_BYTES * 8 - 1} of ${RAM_BYTES * 8} MEM lamps bound; unbound: lamp/ram/row3/b5/Q`);
    expect(a.bindings.panel.unbound).toEqual(["lamp/ram/row3/b5/Q"]);
  });
  it("a missing MEM lamp", () => {
    const { canvas, input } = builtFile();
    const mem = find(canvas, "mem", "Silicon · Front panel");
    mem.children = mem.children!.filter((n) => n.name !== "lamp/ram/row15/b0/Q");
    const c = check(run(input), "bind:mem");
    expect(c.status).toBe("fail");
    expect(c.message).toBe(`${RAM_BYTES * 8 - 1} of ${RAM_BYTES * 8} MEM lamps bound; missing: lamp/ram/row15/b0/Q`);
  });
  it("a panel without any MEM matrix (pre-MEM panel kept by Compile)", () => {
    const { canvas, input } = builtFile();
    const p = find(canvas, "Silicon · Front panel");
    p.children = p.children!.filter((n) => n.name !== "mem");
    expect(check(run(input), "bind:mem").message).toContain("no MEM matrix");
  });
  it("a missing flow", () => {
    const { canvas, input } = builtFile();
    canvas.flowStartingPoints = canvas.flowStartingPoints!.filter((f) => f.name !== "CPU · Step");
    const a = run(input);
    expect(failed(a)).toEqual(["flows"]);
    expect(check(a, "flows").message).toBe('no flow starts at CPU · Step (flows: "CPU" → CPU · Control)');
  });
  it("a missing frame", () => {
    const { canvas, input } = builtFile();
    canvas.children = canvas.children!.filter((n) => n.name !== "CPU · Reset B (Step)");
    const a = run(input);
    expect(check(a, "frames").message).toBe("missing CPU · Reset B (Step)");
    expect(failed(a)).toContain("reset:CPU · Step");
  });
  it("a Run loop that never returns to Control", () => {
    const { canvas, input } = builtFile();
    const f = find(canvas, "CPU · Run B");
    (f.interactions![0].actions![0].conditionalBlocks![1].actions as RestAction[]).pop();
    const a = run(input);
    expect(failed(a)).toEqual(["run"]);
    expect(check(a, "run").message).toBe("CPU · Run B never returns to CPU · Control: Run cannot stop");
  });
  it("an unchunked Step (over the cap)", () => {
    const { canvas, input } = builtFile();
    find(canvas, "button/Step", "CPU · Control").interactions = [click(Array.from({ length: 3861 }, () => set("w0")))];
    const a = run(input);
    expect(a.legacy).toBe(true);
    expect(check(a, "step").message).toBe("button/Step in CPU · Control: one ON_CLICK runs 3,861 actions (cap 400): unchunked tick");
  });
  it("an unbound gate lit, and a gate count that differs from the code", () => {
    const { canvas, input } = builtFile();
    const g = find(canvas, "alu/x0");
    delete g.children!.find((c) => c.name === "lit")!.boundVariables;
    const a = run(input);
    expect(check(a, "bind:gates").message).toMatch(/^3 of 4 gate instances have a bound lit \(code: 4 gates\); unbound: alu\/x0 \(9:\d+\)$/);
    expect(check(run(builtFile().input, { ...EXPECTED, gates: { AND: 2, XOR: 2, NOT: 1 } }), "bind:gates").status).toBe("fail");
  });
  it("a wire count that differs from the code", () => {
    const c = check(run(builtFile().input, { ...EXPECTED, wires: WIRES.length + 1 }), "variables");
    expect(c.status).toBe("fail");
    expect(c.message).toContain(`${WIRES.length} distinct wire variables bound to lit layers, the code builds ${WIRES.length + 1}`);
  });
});

describe("expectedFrom", () => {
  it("counts the CPU's gates and wires like plan() does (4,803 gates, 4,805 wires)", () => {
    const e = expectedFrom(cpuNetlist());
    expect(Object.values(e.gates).reduce((a, b) => a + b, 0)).toBe(4803);
    expect(e.wires).toBe(4805);
  });
});

// The real REST dump of Eric's file (built before chunking). Not in the repo: skipped where it is absent.
const DUMP = process.env.SILICON_REST_DUMP ?? "/private/tmp/claude-501/-Users-spadez-aumops2/bcebe374-4a4e-468b-a2ec-5a4e3e45c1dc/scratchpad/n2.json";
describe.skipIf(!existsSync(DUMP))("auditBuild on the real legacy dump", () => {
  it("reports Step 3,861 / Reset 2,289 / Run hops 3,863, no MEM, REBUILD needed, gates identical", () => {
    const t0 = Date.now();
    const a = auditBuild(parseRest(JSON.parse(readFileSync(DUMP, "utf8"))), expectedFrom(cpuNetlist()));
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(30_000);
    expect(a.gates.matches).toBe(true);
    expect(a.gates.drawnTotal).toBe(2296);
    expect(a.ready).toBe(false);
    expect(a.legacy).toBe(true);
    expect(a.verdict).toMatch(/^REBUILD needed: /);
    expect(a.reactions.step.map((s) => s.worst)).toEqual([3861, 3861]);
    expect(a.reactions.resets.map((r) => [r.home, r.click, r.chunked])).toEqual([
      ["CPU · Control", 2289, false],
      ["CPU · Step", 2289, false],
    ]);
    expect(a.reactions.run.hops).toEqual({ "CPU · Run A": 3863, "CPU · Run B": 3863 });
    expect(failed(a)).toEqual(["step", "run", "reset:CPU · Control", "reset:CPU · Step", "events", "bind:mem"]);
    expect(["gates", "frames", "flows", "bind:gates", "bind:panel", "variables"].map((id) => check(a, id).status)).toEqual(Array(6).fill("pass"));
    expect(a.bindings.gates.bound).toBe(2296);
    expect(a.variables.wires).toBe(2298);
    expect(last(a.text.split("\n"))).toMatch(/^VERDICT: REBUILD needed: /);
  });
});
