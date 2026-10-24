// Writes a PrototypePlan into the Figma document: the variable collection(s), `lit`
// bindings on the drawn circuit, and the controls that run it in Present mode:
//   · Control frame: Step (one tick), Run (→ Run A), Reset, a tick counter.
//   · Run A / Run B: each has an AFTER_TIMEOUT reaction "if running ∧ ¬halt: tick, go to the
//     other frame; else go back to Control" — the ping-pong is what makes the loop repeat.
// Plugin code only builds this; at run time Figma's prototype engine does all the work.
import { COLORS, bindVisible, box, button, createVariables, loadFonts, put, removeCollections, text, type VariableSpec } from "./draw";
import {
  aliasData,
  boolData,
  conditional,
  exprData,
  type FigmaActionOptions,
  figmaActions,
  floatData,
  increment,
  navigate,
  setVariable,
  toFigmaActions,
} from "./figma-actions";
import type { LitBindings, PrototypePlan } from "./types";

export interface ApplyOptions {
  /** Canvas nodes to bind (lane E's `collectBindings`). */
  bindings?: LitBindings;
  /** Page for the control frames (default: the current page). */
  page?: PageNode;
  /** Component instanced into the Control and Run frames (e.g. the drawn circuit). */
  display?: ComponentNode;
  /** Top-left corner of the control frames on the page. */
  at?: { x: number; y: number };
  /** Variables per collection before spilling into `<name> · 2` (default 4000). */
  maxPerCollection?: number;
  /** Delay of the Run loop's AFTER_TIMEOUT trigger, in milliseconds (default 1). */
  runDelayMs?: number;
  /** Encoding choices for the gate actions. */
  actions?: FigmaActionOptions;
  /** Remove the collection(s) and frames of a previous apply with the same name (default true). */
  replace?: boolean;
  log?: (msg: string) => void;
}

export interface ApplyResult {
  collections: VariableCollection[];
  /** Net id → variable. */
  variables: Map<number, Variable>;
  /** Net id → variable id (what `toFigmaActions` takes). */
  varIds: Map<number, string>;
  ticks: Variable;
  running: Variable;
  frames: { control: FrameNode; runA: FrameNode; runB: FrameNode };
  buttons: { step: FrameNode; run: FrameNode; reset: FrameNode; stopA: FrameNode; stopB: FrameNode };
  /** Lit nodes bound to variables, and those skipped because their net has no variable. */
  bound: number;
  unbound: number;
  /** Actions in one Step reaction (tick + counter). */
  actionsPerStep: number;
}

export async function apply(api: PluginAPI, plan: PrototypePlan, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const log = opts.log ?? (() => {});
  const page = opts.page ?? api.currentPage;
  const name = plan.name;
  const frameNames = [`${name} · Control`, `${name} · Run A`, `${name} · Run B`];

  if (opts.replace !== false) {
    const removed = await removeCollections(api, name);
    if (removed) log(`removed ${removed} old collection(s) "${name}"`);
    for (const n of [...page.children]) if (frameNames.includes(n.name)) n.remove();
  }

  // 1. Variables: controls first, then one per net.
  log(`creating ${plan.variables.length + 2} variables in "${name}"…`);
  const specs: VariableSpec[] = [
    { name: "ctl/ticks", type: "FLOAT", init: 0 },
    { name: "ctl/running", type: "BOOLEAN", init: false },
    ...plan.variables.map((v) => ({ name: v.name, type: "BOOLEAN" as const, init: v.init })),
  ];
  const { collections, vars } = await createVariables(api, name, specs, { max: opts.maxPerCollection, log });
  const [ticks, running] = vars;
  const variables = new Map<number, Variable>();
  const varIds = new Map<number, string>();
  plan.variables.forEach((v, i) => {
    variables.set(v.net, vars[i + 2]);
    varIds.set(v.net, vars[i + 2].id);
  });

  // 2. Lit bindings. Constant nets (0/1) have no variable: their highlight is fixed.
  let bound = 0;
  let unbound = 0;
  const bindNet = (node: SceneNode, net: number) => {
    const v = net <= 1 ? net === 1 : variables.get(net);
    if (v === undefined) {
      unbound++;
      return;
    }
    bindVisible(node, v);
    bound++;
  };
  for (const [gi, node] of opts.bindings?.gateLit ?? []) bindNet(node, plan.gateOut[gi]);
  for (const [net, nodes] of opts.bindings?.wireLit ?? []) for (const node of nodes) bindNet(node, net);
  if (opts.bindings) log(`bound ${bound} lit layers${unbound ? `, ${unbound} without a variable` : ""}`);

  // 3. Control frames.
  await loadFonts(api);
  const at = opts.at ?? { x: 0, y: 0 };
  const dw = opts.display?.width ?? 0;
  const dh = opts.display?.height ?? 0;
  const W = Math.max(dw + 48, 520);
  const H = dh + 172;
  const frame = (title: string, i: number) => {
    const f = box(api, frameNames[i], W, H, COLORS.bg);
    put(page, f, at.x + i * (W + 80), at.y);
    put(f, text(api, title, { size: 20, bold: true }), 24, 18);
    put(f, text(api, `${plan.stats.gates} gates · ${plan.stats.variables} wires · ${plan.stats.actionsPerTick} actions/tick`, { size: 12, color: COLORS.dim }), 24, 48);
    put(f, text(api, "ticks", { size: 12, color: COLORS.dim }), W - 160, 24);
    const t = put(f, text(api, "0", { size: 28, bold: true, color: COLORS.amber, name: "ticks" }), W - 160, 42);
    try {
      t.setBoundVariable("characters", ticks);
    } catch (e) {
      log(`could not bind tick counter text: ${e}`);
    }
    if (opts.display) put(f, opts.display.createInstance(), 24, 148);
    return f;
  };
  const control = frame(`${name}`, 0);
  const runA = frame(`${name} · running (A)`, 1);
  const runB = frame(`${name} · running (B)`, 2);
  const step = put(control, button(api, "Step", COLORS.step), 24, 84);
  const run = put(control, button(api, "Run", COLORS.run), 172, 84);
  const reset = put(control, button(api, "Reset", COLORS.reset), 320, 84);
  const stopA = put(runA, button(api, "Stop", COLORS.stop), 24, 84);
  const stopB = put(runB, button(api, "Stop", COLORS.stop), 24, 84);

  // 4. Reactions.
  const tick = [...toFigmaActions(plan, varIds, opts.actions), increment(ticks.id)];
  const resetActs = [
    ...figmaActions(plan.reset, varIds, opts.actions),
    setVariable(ticks.id, floatData(0)),
    setVariable(running.id, boolData(false)),
  ];
  const isRunning = exprData("EQUALS", [aliasData(running.id), boolData(true)]);
  const keepGoing =
    plan.halt === undefined || plan.halt <= 1
      ? isRunning
      : exprData("AND", [aliasData(running.id), exprData("NOT", [aliasData(varIds.get(plan.halt)!)])]);
  const delay = opts.runDelayMs ?? 1;
  const loop = (to: FrameNode): Reaction => ({
    trigger: { type: "AFTER_TIMEOUT", timeout: delay },
    actions: [conditional(keepGoing, [...tick, navigate(to.id)], [setVariable(running.id, boolData(false)), navigate(control.id)])],
  });
  log(`wiring reactions (${tick.length} actions per Step)…`);
  await step.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: tick }]);
  await reset.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: resetActs }]);
  await run.setReactionsAsync([
    { trigger: { type: "ON_CLICK" }, actions: [setVariable(running.id, boolData(true)), navigate(runA.id)] },
  ]);
  for (const stop of [stopA, stopB])
    await stop.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [setVariable(running.id, boolData(false))] }]);
  await runA.setReactionsAsync([loop(runB)]);
  await runB.setReactionsAsync([loop(runA)]);

  // 5. A flow starting point so ▶ Present opens the Control frame.
  try {
    const top = new Set(page.children.map((c) => c.id));
    const flows = page.flowStartingPoints.filter((f) => f.name !== name && top.has(f.nodeId));
    page.flowStartingPoints = [...flows, { nodeId: control.id, name }];
  } catch (e) {
    log(`could not add a flow starting point: ${e}`);
  }

  return {
    collections,
    variables,
    varIds,
    ticks,
    running,
    frames: { control, runA, runB },
    buttons: { step, run, reset, stopA, stopB },
    bound,
    unbound,
    actionsPerStep: tick.length,
  };
}
