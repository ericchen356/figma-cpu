// The spike: builds page "Silicon · Spike" with
//   1. a gate-level 4-bit counter, compiled by src/compile + src/prototype (`apply`) exactly as
//      the CPU will be, run by Figma's prototype engine,
//   2. a self-test of every expression shape the compiler emits (nested and flat), plus
//      probes for sequential evaluation, alias copies and nested IF conditions,
//   3. stress tests: N gate actions per click (N = 500/2000/5000, or 10k/20k "heavy").
// Every step is wrapped so a failure is written to the log text on the page and the rest
// still builds. Takes the Plugin API object as a parameter so Node tests can run it.
import { compile, powerOn } from "../../src/compile";
import { apply } from "../../src/prototype/apply";
import {
  bindVisible,
  box,
  button,
  COLORS,
  createVariables,
  FONT,
  lamp,
  loadFonts,
  put,
  removeCollections,
  text,
  type VariableSpec,
} from "../../src/prototype/draw";
import {
  aliasData,
  boolData,
  conditional,
  exprData,
  figmaActions,
  floatData,
  increment,
  navigate,
  setVariable,
} from "../../src/prototype/figma-actions";
import { gateExpr, plan, setActions } from "../../src/prototype/plan";
import type { Expr, PlanAction, PrototypePlan } from "../../src/prototype/types";
import { GATE_TYPES, evalGate, type FlatNetlist, type GateType } from "../../src/netlist/types";
import { counterNetlist } from "./circuits";

export const PAGE = "Silicon · Spike";
export const STRESS_SIZES = [500, 2000, 5000];
export const HEAVY_SIZES = [10000, 20000];
const RUN_DELAY_MS = 1;

export type SpikeCommand = "all" | "basic" | "stress" | "heavy";

export interface SpikeReport {
  ok: boolean;
  errors: string[];
  lines: string[];
  page: PageNode | null;
}

// ---------- logging into a text node on the page ----------

class Log {
  lines: string[] = [];
  errors: string[] = [];
  node: TextNode | null = null;
  private fontOk = false;

  constructor(private api: PluginAPI) {}

  async attach(page: PageNode): Promise<void> {
    try {
      await this.api.loadFontAsync(FONT);
      this.fontOk = true;
      for (const n of [...page.children]) if (n.name === "Spike log") n.remove();
      const t = this.api.createText();
      t.name = "Spike log";
      t.fontName = FONT;
      t.fontSize = 14;
      page.appendChild(t);
      t.x = -1400;
      t.y = 0;
      this.node = t;
      this.flush();
    } catch (e) {
      this.lines.push(`(log text unavailable: ${e})`);
    }
  }

  info(msg: string): void {
    this.lines.push(msg);
    console.log(`[spike] ${msg}`);
    this.flush();
  }

  error(where: string, e: unknown): void {
    const msg = `ERROR in ${where}: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`;
    this.errors.push(msg);
    this.info(msg);
  }

  private flush(): void {
    if (!this.node || !this.fontOk) return;
    try {
      this.node.characters = ["Silicon spike log", ...this.lines.slice(-30)].join("\n");
    } catch {
      /* keep going; console has the log */
    }
  }
}

/** Runs `fn`, logging (not throwing) on failure. Returns undefined on failure. */
async function step<T>(log: Log, what: string, fn: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    log.error(what, e);
    return undefined;
  }
}

// ---------- entry ----------

export async function buildSpike(api: PluginAPI, command: SpikeCommand = "all"): Promise<SpikeReport> {
  const log = new Log(api);
  const t0 = Date.now();
  const page = await step(log, "open page", async () => {
    let p = api.root.children.find((x) => x.name === PAGE);
    if (!p) {
      p = api.createPage();
      p.name = PAGE;
    }
    await api.setCurrentPageAsync(p);
    return p;
  });
  if (!page) return { ok: false, errors: log.errors, lines: log.lines, page: null };
  await log.attach(page);
  log.info(`command: ${command}`);
  await step(log, "load fonts", () => loadFonts(api));

  const flows: Array<{ nodeId: string; name: string }> = [];
  if (command === "all" || command === "basic") {
    const counter = await step(log, "counter", () => buildCounter(api, page, log));
    if (counter) flows.push(counter);
    const test = await step(log, "self-test", () => buildSelfTest(api, page, log));
    if (test) flows.push(test);
  }
  const sizes = command === "heavy" ? HEAVY_SIZES : command === "basic" ? [] : STRESS_SIZES;
  for (const [i, n] of sizes.entries()) {
    const s = await step(log, `stress ${n}`, () => buildStress(api, page, log, n, 1600 + i * 360));
    if (s) flows.push(s);
  }

  await step(log, "flow starting points", () => {
    const top = new Set(page.children.map((c) => c.id));
    const keep = page.flowStartingPoints.filter(
      (f) => top.has(f.nodeId) && !flows.some((g) => g.name === f.name || g.nodeId === f.nodeId),
    );
    page.flowStartingPoints = [...flows, ...keep];
  });
  log.info(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s with ${log.errors.length} error(s). Press ▶ Present and pick a flow.`);
  return { ok: log.errors.length === 0, errors: log.errors, lines: log.lines, page };
}

/** Removes the top-level nodes a previous run created (by exact name). */
function clear(page: PageNode, names: string[]): void {
  for (const n of [...page.children]) if (names.includes(n.name)) n.remove();
}

// ---------- 1. counter ----------

/** The counter compiled with the real timing compiler (lane A), as the CPU will be. */
export function counterPlan(net: FlatNetlist = counterNetlist()): PrototypePlan {
  return plan(net, compile(net), { initial: powerOn(net), name: "Spike" });
}

async function buildCounter(api: PluginAPI, page: PageNode, log: Log): Promise<{ nodeId: string; name: string }> {
  clear(page, ["Counter", "Counter · Run A", "Counter · Run B", "Counter / display"]);
  const net = counterNetlist();
  const p = counterPlan(net);
  log.info(`counter: ${p.stats.gates} gates, ${p.stats.variables} variables, ${p.stats.actionsPerTick} actions/tick`);

  // Display component: 4 big lamps for Q[3..0] and a small lamp per wire, labeled.
  const wireLit = new Map<number, SceneNode[]>();
  const addLit = (n: number, node: SceneNode) => wireLit.set(n, [...(wireLit.get(n) ?? []), node]);
  const cols = 4;
  const rows = Math.ceil(p.variables.length / cols);
  const comp = api.createComponent();
  comp.name = "Counter / display";
  comp.resize(cols * 200 + 16, 150 + rows * 24);
  comp.fills = [];
  const q = net.ports.find((x) => x.name === "Q")!.nets;
  for (let i = 0; i < 4; i++) {
    const bit = 3 - i;
    const l = lamp(api, 64, COLORS.amber, `Q[${bit}]`);
    put(comp, l.node, i * 96, 0);
    put(comp, text(api, `Q${bit}`, { size: 14, bold: true }), i * 96 + 20, 72);
    addLit(q[bit], l.lit);
  }
  put(comp, text(api, "Q = ticks mod 16 (binary, Q3 left)", { size: 12, color: COLORS.dim }), 400, 24);
  p.variables.forEach((v, i) => {
    const x = Math.floor(i / rows) * 200;
    const y = 120 + (i % rows) * 24;
    const l = lamp(api, 16, COLORS.lampOn, `lamp/${v.name}`);
    put(comp, l.node, x, y);
    put(comp, text(api, v.name.replace(/^net\//, ""), { size: 11, color: COLORS.text }), x + 22, y + 1);
    addLit(v.net, l.lit);
  });
  put(page, comp, 2900, 0);

  const res = await apply(api, p, {
    page,
    display: comp,
    bindings: { gateLit: new Map(), wireLit },
    at: { x: 0, y: 0 },
    runDelayMs: RUN_DELAY_MS,
    log: (m) => log.info(`counter: ${m}`),
  });
  // apply() names frames after the plan ("Spike · Control" …); rename for the spike.
  res.frames.control.name = "Counter";
  res.frames.runA.name = "Counter · Run A";
  res.frames.runB.name = "Counter · Run B";
  log.info(`counter: ${res.collections.length} collection(s), ${res.bound} lamps bound, ${res.actionsPerStep} actions per Step`);
  return { nodeId: res.frames.control.id, name: "Counter" };
}

// ---------- 2. self-test of expression shapes ----------

const COMBOS: Array<[0 | 1, 0 | 1]> = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
];

/** Self-test variables are addressed by integer keys, like nets: key = 2 + index into
 * `specs` (0 and 1 would mean the constant nets to `gateExpr`). */
export interface SelfTest {
  specs: VariableSpec[];
  keys: Record<string, number>;
  nested: PlanAction[];
  flat: PlanAction[];
  seq: PlanAction[];
  ifProbe: PlanAction[];
  clear: PlanAction[];
  outs: Array<{ type: GateType; k: number; expect: boolean; nested: number; flat: number }>;
}

export function selfTest(): SelfTest {
  const specs: VariableSpec[] = [];
  const keys: Record<string, number> = {};
  const add = (name: string, init: boolean) => {
    keys[name] = specs.length + 2;
    specs.push({ name, type: "BOOLEAN", init });
    return keys[name];
  };
  const a = COMBOS.map(([x], k) => add(`in/a${k}`, x === 1));
  const b = COMBOS.map(([, y], k) => add(`in/b${k}`, y === 1));
  const outs: SelfTest["outs"] = [];
  for (const type of GATE_TYPES)
    COMBOS.forEach(([x, y], k) => {
      const expect = evalGate(type, x, y) === 1;
      // Start each output at the wrong value so an unrun test shows red.
      outs.push({ type, k, expect, nested: add(`nested/${type}/${k}`, !expect), flat: add(`flat/${type}/${k}`, !expect) });
    });
  const okN = add("ok/nested", false);
  const okF = add("ok/flat", false);
  const tmp = add("ok/tmp", false);
  const s1 = add("seq/s1", false);
  const s0 = add("seq/s0", false);
  const seqOk = add("ok/sequential", false);
  const c1 = add("if/c1", true);
  const c2 = add("if/c2", false);
  const ifOk = add("ok/if", false);
  add("alias/P", true);
  add("alias/Q", false);
  add("ok/alias", false);

  const V = (n: number): Expr => ({ var: n });
  const gate = (type: GateType, k: number) => gateExpr({ type, in: type === "BUF" || type === "NOT" ? [a[k]] : [a[k], b[k]] });
  // Nested: every gate in one action (NAND = NOT(AND(..)) etc.), then ok = ok ∧ (out = expect).
  const nested: PlanAction[] = [
    ...outs.flatMap((o) => setActions(o.nested, gate(o.type, o.k))),
    { set: okN, to: { const: 1 } },
    ...outs.map((o): PlanAction => ({ set: okN, to: { and: [V(okN), { eq: [V(o.nested), { const: o.expect ? 1 : 0 }] }] } })),
  ];
  // Flat: no expression has an expression argument.
  const flat: PlanAction[] = [
    ...outs.flatMap((o) => setActions(o.flat, gate(o.type, o.k), true)),
    { set: okF, to: { const: 1 } },
    ...outs.flatMap((o): PlanAction[] => [
      { set: tmp, to: { eq: [V(o.flat), { const: o.expect ? 1 : 0 }] } },
      { set: okF, to: { and: [V(okF), V(tmp)] } },
    ]),
  ];
  // Sequential probe: s1 flips, then seqOk = (s1 ≠ s0) sees the new s1 only if actions read
  // values written earlier in the same click; then s0 catches up. Stays lit on every click.
  const seq: PlanAction[] = [
    { set: s1, to: { not: V(s1) } },
    { set: seqOk, to: { neq: [V(s1), V(s0)] } },
    { set: s0, to: V(s1) },
  ];
  // Nested IF condition: c1 ∧ ¬c2 (true).
  const ifProbe: PlanAction[] = [{ if: { and: [V(c1), { not: V(c2) }] }, then: [{ set: ifOk, to: { const: 1 } }], else: [{ set: ifOk, to: { const: 0 } }] }];
  const clearActs: PlanAction[] = [
    ...outs.flatMap((o): PlanAction[] => [
      { set: o.nested, to: { const: o.expect ? 0 : 1 } },
      { set: o.flat, to: { const: o.expect ? 0 : 1 } },
    ]),
    ...[okN, okF, seqOk, ifOk, keys["ok/alias"]].map((n): PlanAction => ({ set: n, to: { const: 0 } })),
  ];
  return { specs, keys, nested, flat, seq, ifProbe, clear: clearActs, outs };
}

async function buildSelfTest(api: PluginAPI, page: PageNode, log: Log): Promise<{ nodeId: string; name: string }> {
  clear(page, ["Self-test"]);
  await removeCollections(api, "Spike Test");
  const st = selfTest();
  const { vars } = await createVariables(api, "Spike Test", st.specs);
  const ids = new Map(vars.map((v, i) => [i + 2, v.id]));
  const k = st.keys;

  const W = 1180;
  const f = box(api, "Self-test", W, 640, COLORS.bg);
  put(page, f, 0, 800);
  put(f, text(api, "Expression self-test", { size: 20, bold: true }), 24, 18);
  put(
    f,
    text(api, "Click each button once. Every big lamp should light. Rows: nested | flat outputs for (A,B) = 00 01 10 11.", {
      size: 12,
      color: COLORS.dim,
    }),
    24,
    48,
  );
  const lampFor = (key: number, size: number, color?: string) => {
    const l = lamp(api, size, color);
    bindVisible(l.lit, vars[key - 2]);
    return l.node;
  };
  // Gate table.
  GATE_TYPES.forEach((type, r) => {
    const y = 250 + r * 44;
    put(f, text(api, type, { size: 14, bold: true }), 24, y + 4);
    const row = st.outs.filter((o) => o.type === type);
    row.forEach((o, i) => {
      put(f, lampFor(o.nested, 24), 110 + i * 34, y);
      put(f, lampFor(o.flat, 24, COLORS.amber), 290 + i * 34, y);
    });
    put(f, text(api, `expect ${row.map((o) => (o.expect ? 1 : 0)).join(" ")}`, { size: 12, color: COLORS.dim }), 440, y + 5);
  });
  put(f, text(api, "nested", { size: 11, color: COLORS.dim }), 110, 228);
  put(f, text(api, "flat", { size: 11, color: COLORS.dim }), 290, 228);
  // Big lamps with their buttons.
  const probes: Array<[string, number, string, () => Action[]]> = [
    ["NESTED OK", k["ok/nested"], "Run nested", () => figmaActions(st.nested, ids)],
    ["FLAT OK", k["ok/flat"], "Run flat", () => figmaActions(st.flat, ids)],
    ["SEQUENTIAL", k["ok/sequential"], "Seq probe", () => figmaActions(st.seq, ids)],
    ["NESTED IF", k["ok/if"], "If probe", () => figmaActions(st.ifProbe, ids)],
    [
      "ALIAS COPIES",
      k["ok/alias"],
      "Alias probe",
      // Q := P as a bare VARIABLE_ALIAS, then P flips: if the alias copied P's value, Q ≠ P.
      () => [
        setVariable(ids.get(k["alias/Q"])!, aliasData(ids.get(k["alias/P"])!)),
        setVariable(ids.get(k["alias/P"])!, exprData("NOT", [aliasData(ids.get(k["alias/P"])!)])),
        setVariable(ids.get(k["ok/alias"])!, exprData("NOT_EQUAL", [aliasData(ids.get(k["alias/P"])!), aliasData(ids.get(k["alias/Q"])!)])),
      ],
    ],
  ];
  for (const [i, [label, key, btn, acts]] of probes.entries()) {
    const x = 24 + i * 200;
    put(f, lampFor(key, 48), x + 42, 84);
    put(f, text(api, label, { size: 12, bold: true }), x + 20, 138);
    const bnode = put(f, button(api, btn, COLORS.step, 150, 36), x, 166);
    await step(log, `self-test ${btn}`, async () => bnode.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: acts() }]));
  }
  const clr = put(f, button(api, "Clear", COLORS.reset, 120, 36), W - 144, 166);
  await step(log, "self-test Clear", () => clr.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: figmaActions(st.clear, ids) }]));
  put(f, text(api, "Alias probe P/Q:", { size: 11, color: COLORS.dim }), 700, 250);
  put(f, lampFor(k["alias/P"], 20), 800, 248);
  put(f, lampFor(k["alias/Q"], 20), 830, 248);
  log.info(`self-test: ${st.specs.length} variables, ${st.nested.length} nested / ${st.flat.length} flat actions`);
  return { nodeId: f.id, name: "Self-test" };
}

// ---------- 3. stress ----------

/** N gate actions: s0 = ¬s0, then s[i] = s[i-1] ⊕ s[i] (prefix XOR along the chain). */
export function stressActions(n: number): PlanAction[] {
  const acts: PlanAction[] = [{ set: 0, to: { not: { var: 0 } } }];
  for (let i = 1; i < n; i++) acts.push({ set: i, to: { neq: [{ var: i - 1 }, { var: i }] } });
  return acts;
}

async function buildStress(api: PluginAPI, page: PageNode, log: Log, n: number, y: number): Promise<{ nodeId: string; name: string }> {
  const title = `Stress ${n}`;
  clear(page, [title, `${title} · Run A`, `${title} · Run B`, `Stress / ${n} / display`]);
  const coll = `Spike Stress ${n}`;
  await removeCollections(api, coll);
  log.info(`${title}: creating ${n + 2} variables…`);
  const specs: VariableSpec[] = [
    { name: "ctl/ticks", type: "FLOAT", init: 0 },
    { name: "ctl/running", type: "BOOLEAN", init: false },
    ...Array.from({ length: n }, (_, i) => ({ name: `s/${i}`, type: "BOOLEAN" as const, init: false })),
  ];
  const { vars, collections } = await createVariables(api, coll, specs, { log: (m) => log.info(m) });
  const [ticks, running] = vars;
  const ids = new Map(Array.from({ length: n }, (_, i) => [i, vars[i + 2].id]));

  // Display: tick counter (the LAST action of a click, so it only moves if all N ran) and
  // the first 16 chain bits.
  const comp = api.createComponent();
  comp.name = `Stress / ${n} / display`;
  comp.resize(700, 120);
  comp.fills = [];
  put(comp, text(api, `${n} gate actions per click`, { size: 14, color: COLORS.dim }), 0, 0);
  put(comp, text(api, "ticks", { size: 12, color: COLORS.dim }), 0, 30);
  const tt = put(comp, text(api, "0", { size: 36, bold: true, color: COLORS.amber, name: "ticks" }), 0, 46);
  await step(log, `${title} bind tick text`, () => tt.setBoundVariable("characters", ticks));
  for (let i = 0; i < Math.min(16, n); i++) {
    const l = lamp(api, 22, COLORS.lampOn, `s/${i}`);
    bindVisible(l.lit, vars[i + 2]);
    put(comp, l.node, 160 + i * 30, 56);
  }
  put(page, comp, 2900, y);

  const tick = [...figmaActions(stressActions(n), ids), increment(ticks.id)];
  const f = (name: string, x: number) => {
    const fr = box(api, name, 760, 260, COLORS.bg);
    put(page, fr, x, y);
    put(fr, text(api, name, { size: 20, bold: true }), 24, 18);
    put(fr, comp.createInstance(), 24, 120);
    return fr;
  };
  const main = f(title, 0);
  const runA = f(`${title} · Run A`, 840);
  const runB = f(`${title} · Run B`, 1680);
  const click = put(main, button(api, "Click ×1", COLORS.step), 24, 60);
  const run = put(main, button(api, "Run", COLORS.run), 172, 60);
  const reset = put(main, button(api, "Reset", COLORS.reset), 320, 60);
  const stops = [runA, runB].map((fr) => put(fr, button(api, "Stop", COLORS.stop), 24, 60));
  const isRunning = exprData("EQUALS", [aliasData(running.id), boolData(true)]);
  const loop = (to: FrameNode): Reaction => ({
    trigger: { type: "AFTER_TIMEOUT", timeout: RUN_DELAY_MS },
    actions: [conditional(isRunning, [...tick, navigate(to.id)], [navigate(main.id)])],
  });
  await click.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: tick }]);
  await run.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [setVariable(running.id, boolData(true)), navigate(runA.id)] }]);
  await reset.setReactionsAsync([
    {
      trigger: { type: "ON_CLICK" },
      actions: [
        setVariable(ticks.id, floatData(0)),
        setVariable(running.id, boolData(false)),
        ...Array.from({ length: n }, (_, i) => setVariable(ids.get(i)!, boolData(false))),
      ],
    },
  ]);
  for (const s of stops) await s.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [setVariable(running.id, boolData(false))] }]);
  await runA.setReactionsAsync([loop(runB)]);
  await runB.setReactionsAsync([loop(runA)]);
  log.info(`${title}: ${collections.length} collection(s), ${tick.length} actions per click`);
  return { nodeId: main.id, name: title };
}
