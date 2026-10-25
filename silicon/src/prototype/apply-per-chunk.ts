// applyPerChunk: an alternative to apply() (apply.ts) for big chunked ticks. Same variables, same
// gate actions; different reaction layout: ONE REACTION PER CHUNK instead of one Step reaction that
// dispatches all chunks.
//   · Control frame: one Step and one Run button per phase, stacked; each is visible only while
//     `ctl/phaseIs/k` is true, so a click reaches exactly the reaction for that chunk.
//   · Run: a ring of frames `<name> · Run 1…K`; frame i runs chunk i mod K and navigates to the next.
// Why: Figma desktop timed out ("Unable to establish connection to Figma after 10 seconds") validating
// a Step reaction that held the whole chunked tick (~4,300 actions for the CPU), while the same
// actions in ≤ 400-action reactions go through. When even those time out in a plugin, the frames and
// variables this builds are what tools/connector wires through the Figma MCP (see docs/CONNECTOR.md).
// setReactions() logs the smallest action Figma rejects, when it rejects a list.
// Plugin code only builds this; at run time Figma's prototype engine does all the work.
import {
  COLORS,
  bindVisible,
  box,
  button,
  createVariables,
  loadFonts,
  put,
  removeCollections,
  setFlows,
  text,
  type VariableSpec,
} from "./draw";
import {
  aliasData,
  boolData,
  concatText,
  conditional,
  digitsIncrement,
  exprData,
  type FigmaActionOptions,
  figmaActions,
  floatData,
  increment,
  keyDown,
  navigate,
  onClick,
  afterTimeout,
  setVariable,
  strData,
  worstCase,
} from "./figma-actions";
import { chunkTick, DEFAULT_MAX_ACTIONS_PER_EVENT, needsChunks, worstActions } from "./plan";
import type { Chunking, LitBindings, PrototypePlan } from "./types";

export interface PerChunkOptions {
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
  /** Delay of the Run loop's AFTER_TIMEOUT trigger, in milliseconds (default 1; written to Figma in seconds). */
  runDelayMs?: number;
  /** Encoding choices for the gate actions. */
  actions?: FigmaActionOptions;
  /** Remove the collection(s) and frames of a previous apply with the same name (default true). */
  replace?: boolean;
  /** Chunk the tick so no event executes more than this many actions. Default: the plan's
   * cap, else DEFAULT_MAX_ACTIONS_PER_EVENT (400). A tick that fits is one event; Infinity:
   * always one event per tick. */
  maxActionsPerEvent?: number;
  /** Unchunked only. Key codes (JS keyCode; Space 32, A–Z 65–90) whose ON_KEY_DOWN on the Control and Run
   * frames runs one tick. Holding a key repeats it if
   * the viewer auto-repeats (spike v2 test D). Default none. */
  keys?: number[];
  /** How the tick counter is shown: "concat" (default) STRING `ctl/tickText` = "" + ticks;
   * "digits" four STRING digits set by nested conditionals (if concat fails); "none". */
  tickDisplay?: "concat" | "digits" | "none";
  log?: (msg: string) => void;
}

export interface PerChunkResult {
  collections: VariableCollection[];
  /** Net id → variable (flags included). */
  variables: Map<number, Variable>;
  /** Net id → variable id (what `toFigmaActions` takes). */
  varIds: Map<number, string>;
  ticks: Variable;
  /** STRING copy of the tick counter bound to the texts (absent with tickDisplay "none"). */
  tickText?: Variable;
  running: Variable;
  /** Chunked only: the phase (next chunk, FLOAT 0…chunks−1) and its text. */
  phase?: Variable;
  /** `runs` is the Run ring (frame i runs chunk i mod chunks); runA/runB are its first two. */
  frames: { control: FrameNode; runA: FrameNode; runB: FrameNode; runs: FrameNode[] };
  /** One Step and Run button per phase (stacked; only the current phase's is visible). `step`
   * and `run` are phase 0's; `stopA`/`stopB` are the first two Run frames'. */
  buttons: { step: FrameNode; steps: FrameNode[]; run: FrameNode; runs: FrameNode[]; reset: FrameNode; stopA: FrameNode; stopB: FrameNode; stops: FrameNode[] };
  /** Lit nodes bound to variables, and those skipped because their net has no variable. */
  bound: number;
  unbound: number;
  /** Most actions one Step click executes (a whole tick, or one chunk incl. dispatch). */
  actionsPerStep: number;
  /** Events per tick (1 unchunked) and the chunking used, if any. */
  chunks: number;
  chunking?: Chunking;
}

const DIGITS = 4;

export async function applyPerChunk(api: PluginAPI, plan: PrototypePlan, opts: PerChunkOptions = {}): Promise<PerChunkResult> {
  const log = opts.log ?? (() => {});
  const page = opts.page ?? api.currentPage;
  const name = plan.name;
  const controlName = `${name} · Control`;
  const runPrefix = `${name} · Run `;
  const display = opts.tickDisplay ?? "concat";
  const tickExtra = display === "digits" ? worstCase(digitsIncrement(range(DIGITS, "d"), range(DIGITS, "s"))) + 1 : display === "concat" ? 2 : 1;
  const cap = opts.maxActionsPerEvent ?? plan.maxActionsPerEvent ?? DEFAULT_MAX_ACTIONS_PER_EVENT;
  const chunking: Chunking | undefined = needsChunks(worstActions(plan.tick), cap, tickExtra)
    ? plan.chunking && plan.chunking.maxActionsPerEvent === cap && plan.chunking.tickExtra >= tickExtra
      ? plan.chunking
      : chunkTick(plan.tick, { maxActionsPerEvent: cap, tickExtra })
    : undefined;

  if (opts.replace !== false) {
    const removed = await removeCollections(api, name);
    if (removed) log(`removed ${removed} old collection(s) "${name}"`);
    for (const n of [...page.children]) if (n.name === controlName || n.name.startsWith(runPrefix)) n.remove();
  }

  // 1. Variables: controls first, then one per net, then the plan's flags.
  const control: VariableSpec[] = [
    { name: "ctl/ticks", type: "FLOAT", init: 0 },
    { name: "ctl/running", type: "BOOLEAN", init: false },
    ...(display === "concat" ? [{ name: "ctl/tickText", type: "STRING" as const, init: "0" }] : []),
    ...(display === "digits"
      ? Array.from({ length: DIGITS }, (_, i): VariableSpec[] => [
          { name: `ctl/digit/${i}`, type: "FLOAT", init: 0 },
          { name: `ctl/digitText/${i}`, type: "STRING", init: "0" },
        ]).flat()
      : []),
    ...(chunking
      ? [
          { name: "ctl/phase", type: "FLOAT" as const, init: 0 },
          { name: "ctl/phaseText", type: "STRING" as const, init: "0" },
          ...chunking.chunks.map((_, k) => ({ name: `ctl/phaseIs/${k}`, type: "BOOLEAN" as const, init: k === 0 })),
        ]
      : []),
  ];
  const netVars = [...plan.variables, ...(plan.flags ?? [])];
  log(`creating ${control.length + netVars.length} variables in "${name}"…`);
  const specs: VariableSpec[] = [...control, ...netVars.map((v) => ({ name: v.name, type: "BOOLEAN" as const, init: v.init }))];
  const { collections, vars } = await createVariables(api, name, specs, { max: opts.maxPerCollection, log });
  const ctl = new Map(control.map((c, i) => [c.name, vars[i]]));
  const ticks = ctl.get("ctl/ticks")!;
  const running = ctl.get("ctl/running")!;
  const tickText = ctl.get("ctl/tickText");
  const phase = ctl.get("ctl/phase");
  const variables = new Map<number, Variable>();
  const varIds = new Map<number, string>();
  netVars.forEach((v, i) => {
    variables.set(v.net, vars[control.length + i]);
    varIds.set(v.net, vars[control.length + i].id);
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

  // 3. Actions.
  const tickDone: Action[] = [increment(ticks.id)];
  if (tickText) tickDone.push(concatText(tickText.id, ticks.id));
  if (display === "digits")
    tickDone.push(
      ...digitsIncrement(
        range(DIGITS, "ctl/digit/").map((n) => ctl.get(n)!.id),
        range(DIGITS, "ctl/digitText/").map((n) => ctl.get(n)!.id),
      ),
    );
  // One event per chunk (the whole tick unchunked), each its own reaction: Figma times out
  // validating one reaction that holds the whole chunked tick (~4300 actions for the CPU).
  const K = chunking ? chunking.chunks.length : 1;
  const phaseIs = (k: number) => ctl.get(`ctl/phaseIs/${k}`)!;
  const chunkEvent = (k: number): Action[] => {
    if (!chunking) return [...figmaActions(plan.tick, varIds, opts.actions), ...tickDone];
    const next = (k + 1) % K;
    return [
      ...figmaActions(chunking.chunks[k], varIds, opts.actions),
      setVariable(phase!.id, floatData(next)),
      concatText(ctl.get("ctl/phaseText")!.id, phase!.id),
      setVariable(phaseIs(k).id, boolData(false)),
      setVariable(phaseIs(next).id, boolData(true)),
      ...(k === K - 1 ? tickDone : []),
    ];
  };
  const events = Array.from({ length: K }, (_, k) => chunkEvent(k));
  const resetActs: Action[] = [
    ...figmaActions(plan.reset, varIds, opts.actions),
    setVariable(ticks.id, floatData(0)),
    setVariable(running.id, boolData(false)),
    ...(tickText ? [setVariable(tickText.id, strData("0"))] : []),
    ...[...ctl.entries()]
      .filter(([n]) => n.startsWith("ctl/digit") || n.startsWith("ctl/phase"))
      .map(([n, v]) => setVariable(v.id, n.startsWith("ctl/phaseIs/") ? boolData(n === "ctl/phaseIs/0") : n.includes("Text") ? strData("0") : floatData(0))),
  ];
  const isRunning = exprData("EQUALS", [aliasData(running.id), boolData(true)]);
  // Stop on HALTED only at a tick boundary (before chunk 0): a chunked tick must finish all its
  // chunks, otherwise the machine is left half-way through a clock cycle.
  const notHalted = plan.halt === undefined || plan.halt <= 1 ? undefined : exprData("NOT", [aliasData(varIds.get(plan.halt)!)]);
  const keepGoing = notHalted ? exprData("AND", [aliasData(running.id), notHalted]) : isRunning;
  // Worst case of one event: one chunk (or the whole tick). A Run hop adds 2.
  const perEvent = Math.max(...events.map((e) => worstCase(e)));
  if (perEvent + 2 > cap) throw new Error(`one event can execute ${perEvent + 2} actions, more than maxActionsPerEvent ${cap}`);

  // 4. Frames.
  await loadFonts(api);
  const at = opts.at ?? { x: 0, y: 0 };
  const dw = opts.display?.width ?? 0;
  const dh = opts.display?.height ?? 0;
  const W = Math.max(dw + 48, 620);
  const H = dh + 172;
  const sub = chunking
    ? `${plan.stats.gates} gates · ${plan.stats.variables} wires · ${plan.stats.worstCase} actions/tick in ${chunking.chunks.length} events of ≤ ${cap}`
    : `${plan.stats.gates} gates · ${plan.stats.variables} wires · ${plan.stats.worstCase} actions/tick`;
  const bindText = (t: TextNode, v: Variable | undefined, what: string) => {
    if (!v) return;
    try {
      t.setBoundVariable("characters", v);
    } catch (e) {
      log(`could not bind ${what} text: ${e}`);
    }
  };
  const frame = (title: string, frameName: string, i: number) => {
    const f = box(api, frameName, W, H, COLORS.bg);
    put(page, f, at.x + i * (W + 80), at.y);
    put(f, text(api, title, { size: 20, bold: true }), 24, 18);
    put(f, text(api, sub, { size: 12, color: COLORS.dim }), 24, 48);
    put(f, text(api, "ticks", { size: 12, color: COLORS.dim }), W - 160, 24);
    if (display === "digits")
      range(DIGITS, "ctl/digitText/")
        .reverse()
        .forEach((n, k) => bindText(put(f, text(api, "0", { size: 28, bold: true, color: COLORS.amber, name: `ticks/${n}` }), W - 160 + k * 20, 42), ctl.get(n), "tick digit"));
    else if (tickText) bindText(put(f, text(api, "0", { size: 28, bold: true, color: COLORS.amber, name: "ticks" }), W - 160, 42), tickText, "tick counter");
    if (chunking) {
      put(f, text(api, `phase (of ${chunking.chunks.length})`, { size: 12, color: COLORS.dim }), W - 300, 24);
      bindText(put(f, text(api, "0", { size: 28, bold: true, color: COLORS.text, name: "phase" }), W - 300, 42), ctl.get("ctl/phaseText"), "phase");
    }
    if (opts.display) put(f, opts.display.createInstance(), 24, 148);
    return f;
  };
  // Run frames form a ring; frame i runs chunk i mod K (two frames at least: a frame cannot
  // navigate to itself). Unchunked, that is the Run A / Run B ping-pong.
  const R = Math.max(K, 2);
  const controlFrame = frame(`${name}`, controlName, 0);
  const runs = Array.from({ length: R }, (_, i) => frame(`${name} · running (${i + 1}/${R})`, `${runPrefix}${i + 1}`, i + 1));
  // One Step and one Run button per phase, stacked; only the current phase's is visible, so a
  // click reaches exactly the reaction for that chunk.
  const stack = (label: string, color: (typeof COLORS)[keyof typeof COLORS], x: number) =>
    events.map((_, k) => {
      const b = put(controlFrame, button(api, label, color), x, 84);
      if (chunking) bindVisible(b, phaseIs(k));
      return b;
    });
  const steps = stack("Step", COLORS.step, 24);
  const runButtons = stack("Run", COLORS.run, 172);
  const reset = put(controlFrame, button(api, "Reset", COLORS.reset), 320, 84);
  const stops = runs.map((r) => put(r, button(api, "Stop", COLORS.stop), 24, 84));

  // 5. Reactions.
  const delay = (opts.runDelayMs ?? 1) / 1000; // afterTimeout counts seconds
  if (chunking && opts.keys?.length) log("keys are not wired for a chunked tick (one reaction per chunk)");
  const keys = !chunking && (opts.keys ?? []).length ? [{ trigger: keyDown(opts.keys!), actions: events[0] }] : [];
  const loop = (i: number): Reaction[] => {
    const k = i % K;
    const go = [...events[k], navigate(runs[(i + 1) % R].id)];
    const stop = [setVariable(running.id, boolData(false)), navigate(controlFrame.id)];
    return [{ trigger: afterTimeout(delay), actions: [conditional(k === 0 ? keepGoing : isRunning, go, stop)] }, ...keys];
  };
  log(`wiring reactions (${perEvent} actions per event${chunking ? `, ${K} events per tick` : ""})…`);
  const react = (node: SceneNode, what: string, reactions: Reaction[]) => setReactions(node, what, reactions, log);
  for (const [k, b] of steps.entries()) await react(b, `Step ${k}`, [{ trigger: onClick(), actions: events[k] }]);
  for (const [k, b] of runButtons.entries())
    await react(b, `Run ${k}`, [{ trigger: onClick(), actions: [setVariable(running.id, boolData(true)), navigate(runs[k].id)] }]);
  await react(reset, "Reset", [{ trigger: onClick(), actions: resetActs }]);
  for (const stop of stops) await react(stop, "Stop", [{ trigger: onClick(), actions: [setVariable(running.id, boolData(false))] }]);
  if (keys.length) await react(controlFrame, "keys", keys);
  for (const [i, r] of runs.entries()) await react(r, `Run frame ${i + 1}`, loop(i));

  // 6. A flow starting point so ▶ Present opens the Control frame.
  try {
    setFlows(page, [{ nodeId: controlFrame.id, name }]);
  } catch (e) {
    log(`could not add a flow starting point: ${e}`);
  }

  return {
    collections,
    variables,
    varIds,
    ticks,
    ...(tickText ? { tickText } : {}),
    running,
    ...(phase ? { phase } : {}),
    frames: { control: controlFrame, runA: runs[0], runB: runs[1], runs },
    buttons: { step: steps[0], steps, run: runButtons[0], runs: runButtons, reset, stopA: stops[0], stopB: stops[1], stops },
    bound,
    unbound,
    actionsPerStep: perEvent,
    chunks: K,
    ...(chunking ? { chunking } : {}),
  };
}

function range(n: number, prefix: string): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

/** `node.setReactionsAsync`, but when Figma rejects the list (its message only says that no
 * Action shape matched), it is retried piece by piece to log the smallest rejected action. */
async function setReactions(node: SceneNode, what: string, reactions: Reaction[], log: (m: string) => void): Promise<void> {
  try {
    await (node as SceneNode & ReactionMixin).setReactionsAsync(reactions);
  } catch (e) {
    const ok = async (actions: Action[]) => {
      try {
        await (node as SceneNode & ReactionMixin).setReactionsAsync([{ trigger: reactions[0].trigger, actions }]);
        return true;
      } catch {
        return false;
      }
    };
    const smallest = async (actions: Action[], path: string): Promise<string | undefined> => {
      for (const [i, a] of actions.entries()) {
        if (await ok([a])) continue;
        if (a.type === "CONDITIONAL")
          for (const [b, block] of a.conditionalBlocks.entries()) {
            const inner = await smallest(block.actions, `${path}[${i}].conditionalBlocks[${b}].actions`);
            if (inner) return inner;
            if (!(await ok([{ type: "CONDITIONAL", conditionalBlocks: [{ ...block, actions: [] }] }])))
              return `${path}[${i}].conditionalBlocks[${b}] (condition) = ${JSON.stringify(block.condition)}`;
          }
        return `${path}[${i}] = ${JSON.stringify(a).slice(0, 600)}`;
      }
      return undefined;
    };
    let found: string | undefined;
    for (const [r, reaction] of reactions.entries()) if ((found = await smallest(reaction.actions ?? [], `reaction[${r}].actions`))) break;
    log(`${what}: Figma rejected the reactions${found ? `; smallest rejected piece: ${found}` : " (every action is accepted on its own)"}`);
    throw e;
  }
}
