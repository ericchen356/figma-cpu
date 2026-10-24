// Writes a PrototypePlan into the Figma document: the variable collection(s), `lit`
// bindings on the drawn circuit, and the controls that run it in Present mode:
//   · Control frame: Step, Run (→ Run A), Reset, a tick counter (STRING text, see below).
//   · Run A / Run B: each has an AFTER_TIMEOUT reaction "if running ∧ ¬halt: step, go to the
//     other frame; else go back to Control" — the ping-pong is what makes the loop repeat.
// Unchunked, a Step runs the whole tick. Chunked (`maxActionsPerEvent`, because the viewer's
// stack overflows somewhere between 501 and 2001 actions per event), every event runs one
// chunk through the dispatcher described at `Chunking` (types.ts): Step = one chunk, and
// optionally "Step ×3" (MOUSE_DOWN + MOUSE_UP + ON_CLICK on one button) and ON_KEY_DOWN keys
// on the frames. A tick completes when the phase wraps to 0.
// Reset is chunked the same way: a Reset that restores every variable is one event of ~2,300 actions
// for the whole CPU, past the 2001 at which the viewer died, so a big reset runs as a hop chain
// through two extra frames (Reset A ⇄ Reset B, one dispatched chunk per hop) and returns to Control.
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
  compareData,
  concatText,
  conditional,
  digitsIncrement,
  exprData,
  type FigmaActionOptions,
  figmaActions,
  floatData,
  guardReactions,
  nestedConditional,
  increment,
  keyDown,
  mouseDown,
  mouseUp,
  navigate,
  onClick,
  afterTimeout,
  setVariable,
  strData,
  worstCase,
} from "./figma-actions";
import { chunkTick, DEFAULT_MAX_ACTIONS_PER_EVENT, needsChunks, worstActions } from "./plan";
import type { Chunking, LitBindings, PrototypePlan } from "./types";

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
  /** Chunk the tick so no event executes more than this many actions. Default: the plan's
   * cap, else DEFAULT_MAX_ACTIONS_PER_EVENT (400). A tick that fits is one event; Infinity:
   * always one event per tick. */
  maxActionsPerEvent?: number;
  /** Chunked only: add a "Step ×3" button with MOUSE_DOWN, MOUSE_UP and ON_CLICK reactions,
   * one chunk each (only if the viewer runs them as separate events; spike v2 test C). */
  multiTrigger?: boolean;
  /** Key codes (JS keyCode; Space 32, A–Z 65–90) whose ON_KEY_DOWN on the Control and Run
   * frames runs one event (a chunk, or the whole tick unchunked). Holding a key repeats it if
   * the viewer auto-repeats (spike v2 test D). Default none. */
  keys?: number[];
  /** How the tick counter is shown: "concat" (default) STRING `ctl/tickText` = "" + ticks;
   * "digits" four STRING digits set by nested conditionals (if concat fails); "none". */
  tickDisplay?: "concat" | "digits" | "none";
  log?: (msg: string) => void;
}

export interface ApplyResult {
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
  /** Chunked Reset only: its phase (next reset chunk, FLOAT 0…resetChunks−1). */
  resetPhase?: Variable;
  frames: { control: FrameNode; runA: FrameNode; runB: FrameNode; resetA?: FrameNode; resetB?: FrameNode };
  buttons: { step: FrameNode; run: FrameNode; reset: FrameNode; stopA: FrameNode; stopB: FrameNode; stepMulti?: FrameNode };
  /** Lit nodes bound to variables, and those skipped because their net has no variable. */
  bound: number;
  unbound: number;
  /** Most actions one Step click executes (a whole tick, or one chunk incl. dispatch). */
  actionsPerStep: number;
  /** Events per tick (1 unchunked) and the chunking used, if any. */
  chunks: number;
  chunking?: Chunking;
  /** Events per Reset (1: one click, no extra frames). */
  resetChunks: number;
  resetChunking?: Chunking;
}

const DIGITS = 4;

export async function apply(api: PluginAPI, plan: PrototypePlan, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const log = opts.log ?? (() => {});
  const page = opts.page ?? api.currentPage;
  const name = plan.name;
  const frameNames = [`${name} · Control`, `${name} · Run A`, `${name} · Run B`, `${name} · Reset A`, `${name} · Reset B`];
  const display = opts.tickDisplay ?? "concat";
  // + 2: the flattened Run hop (see `loop`) spends one more action (the "go" snapshot) and a three-action tail conditional.
  const tickExtra = (display === "digits" ? worstCase(digitsIncrement(range(DIGITS, "d"), range(DIGITS, "s"))) + 1 : display === "concat" ? 2 : 1) + 2;
  const cap = opts.maxActionsPerEvent ?? plan.maxActionsPerEvent ?? DEFAULT_MAX_ACTIONS_PER_EVENT;
  const chunking: Chunking | undefined = needsChunks(worstActions(plan.tick), cap, tickExtra)
    ? plan.chunking && plan.chunking.maxActionsPerEvent === cap && plan.chunking.tickExtra >= tickExtra
      ? plan.chunking
      : chunkTick(plan.tick, { maxActionsPerEvent: cap, tickExtra })
    : undefined;

  // Reset restores every variable (plan.reset) plus the control variables (the "tail"). Too big for one
  // event under the cap → run it as chunks over a hop chain, like the Run loop.
  const resetTailMax = 2 + (display === "concat" ? 1 : 0) + (display === "digits" ? 2 * DIGITS : 0) + (chunking ? 3 : 0) + 1; // + the reset dispatcher's own scratch variable
  const resetChunking: Chunking | undefined = needsChunks(worstActions(plan.reset), cap, resetTailMax)
    ? chunkTick(plan.reset, { maxActionsPerEvent: cap, tickExtra: resetTailMax })
    : undefined;

  if (opts.replace !== false) {
    const removed = await removeCollections(api, name);
    if (removed) log(`removed ${removed} old collection(s) "${name}"`);
    for (const n of [...page.children]) if (frameNames.includes(n.name)) n.remove();
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
    ...(resetChunking
      ? [
          { name: "ctl/resetPhase", type: "FLOAT" as const, init: 0 },
          { name: "ctl/resetNow", type: "FLOAT" as const, init: 0 },
        ]
      : []),
    ...(chunking
      ? [
          { name: "ctl/phase", type: "FLOAT" as const, init: 0 },
          { name: "ctl/phaseNow", type: "FLOAT" as const, init: 0 },
          { name: "ctl/phaseText", type: "STRING" as const, init: "0" },
          // The Run hop's keep-going decision, snapshotted once so the flattened dispatcher cannot change its mind mid-event.
          { name: "ctl/go", type: "BOOLEAN" as const, init: false },
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
  const resetPhase = ctl.get("ctl/resetPhase");
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
  let event: Action[];
  // One dispatch block per chunk. All of them sit at the TOP level of the event: Figma rejects a CONDITIONAL nested in
  // another conditional's block ("Unrecognized key conditionalBlocks"), which the emulator never noticed.
  let dispatch: (gate?: ReturnType<typeof exprData>) => Action[] = () => [];
  if (chunking) {
    const ph = phase!.id;
    const now = ctl.get("ctl/phaseNow")!.id;
    const phText = ctl.get("ctl/phaseText")!.id;
    const K = chunking.chunks.length;
    dispatch = (gate) =>
      chunking.chunks.map((c, k) =>
        conditional(gate ? exprData("AND", [gate, compareData("EQUALS", now, k)]) : compareData("EQUALS", now, k), [
          ...figmaActions(c, varIds, opts.actions),
          setVariable(ph, floatData((k + 1) % K)),
          concatText(phText, ph),
          ...(k === K - 1 ? tickDone : []),
        ]),
      );
    event = [setVariable(now, exprData("ADDITION", [aliasData(ph, "FLOAT"), floatData(0)], "FLOAT")), ...dispatch()];
  } else event = [...figmaActions(plan.tick, varIds, opts.actions), ...tickDone];
  // What Reset does besides restoring the circuit: counters, phase and the running flag back to 0.
  const resetTail: Action[] = [
    setVariable(ticks.id, floatData(0)),
    setVariable(running.id, boolData(false)),
    ...(tickText ? [setVariable(tickText.id, strData("0"))] : []),
    ...[...ctl.entries()].filter(([n]) => n.startsWith("ctl/digit") || n.startsWith("ctl/phase")).map(([n, v]) => setVariable(v.id, n.includes("Text") ? strData("0") : floatData(0))),
  ];
  if (resetTail.length > resetTailMax) throw new Error(`reset tail is ${resetTail.length} actions, more than the ${resetTailMax} budgeted`);
  // Unchunked: the whole reset in one click. Chunked: the click only starts the hop chain; each hop (an
  // AFTER_TIMEOUT on Reset A / B) runs one chunk, the last one the tail, then returns to Control.
  const resetActs: Action[] = resetChunking ? [] : [...figmaActions(plan.reset, varIds, opts.actions), ...resetTail];
  const resetEvent: Action[] = (() => {
    if (!resetChunking) return [];
    const rp = resetPhase!.id;
    const now = ctl.get("ctl/resetNow")!.id;
    const K = resetChunking.chunks.length;
    return [
      setVariable(now, exprData("ADDITION", [aliasData(rp, "FLOAT"), floatData(0)], "FLOAT")),
      ...resetChunking.chunks.map((c, k) =>
        conditional(compareData("EQUALS", now, k), [
          ...figmaActions(c, varIds, opts.actions),
          setVariable(rp, floatData((k + 1) % K)),
          ...(k === K - 1 ? [...resetTail, setVariable(now, floatData(0))] : []),
        ]),
      ),
    ];
  })();
  const isRunning = exprData("EQUALS", [aliasData(running.id), boolData(true)]);
  // Stop on HALTED only at a tick boundary: a chunked tick must finish all its chunks,
  // otherwise the machine is left half-way through a clock cycle.
  const notHalted = plan.halt === undefined || plan.halt <= 1 ? undefined : exprData("NOT", [aliasData(varIds.get(plan.halt)!)]);
  const keepGoing = !notHalted
    ? isRunning
    : exprData("AND", [
        aliasData(running.id),
        chunking ? exprData("OR", [notHalted, exprData("NOT", [compareData("EQUALS", phase!.id, 0)])]) : notHalted,
      ]);
  // Worst case of one event: unchunked, the whole tick; chunked, exactly one dispatch block is
  // taken (phaseNow matches one k), so 1 + K + the costliest block. A Run hop adds 2.
  const perEvent = chunking
    ? 1 + event.length - 1 + Math.max(...event.slice(1).map((c) => worstCase([c]) - 1))
    : worstCase(event);
  const hopExtra = chunking ? 4 : 2;
  if (perEvent + hopExtra > cap) throw new Error(`one event can execute ${perEvent + hopExtra} actions, more than maxActionsPerEvent ${cap}`);

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
  const frame = (title: string, i: number) => {
    const f = box(api, frameNames[i], W, H, COLORS.bg);
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
  const controlFrame = frame(`${name}`, 0);
  const runA = frame(`${name} · running (A)`, 1);
  const runB = frame(`${name} · running (B)`, 2);
  const step = put(controlFrame, button(api, "Step", COLORS.step), 24, 84);
  const run = put(controlFrame, button(api, "Run", COLORS.run), 172, 84);
  const reset = put(controlFrame, button(api, "Reset", COLORS.reset), 320, 84);
  const stepMulti = chunking && opts.multiTrigger ? put(controlFrame, button(api, "Step ×3", COLORS.step), 468, 84) : undefined;
  const resetA = resetChunking ? frame(`${name} · resetting (A)`, 3) : undefined;
  const resetB = resetChunking ? frame(`${name} · resetting (B)`, 4) : undefined;
  const stopA = put(runA, button(api, "Stop", COLORS.stop), 24, 84);
  const stopB = put(runB, button(api, "Stop", COLORS.stop), 24, 84);
  for (const [g, label] of [[controlFrame, "Control"], [runA, "Run A frame"], [runB, "Run B frame"], [run, "Run button"], [reset, "Reset button"], [stopA, "Stop A"], [stopB, "Stop B"], [stepMulti, "Step x3"], [resetA, "Reset A frame"], [resetB, "Reset B frame"]] as const) guardReactions(g, label, log);

  // 5. Reactions.
  const delay = opts.runDelayMs ?? 1;
  const keys = (opts.keys ?? []).length ? [{ trigger: keyDown(opts.keys!), actions: event }] : [];
  // Unchunked: the whole tick sits in the keep-going conditional's block. Chunked: that would nest one dispatch conditional inside
  // another (rejected by Figma), so the hop is flat: snapshot the keep-going decision into ctl/go, run the one matching chunk
  // gated by it, then a final conditional on the snapshot navigates on (or stops and returns to Control).
  const goVar = ctl.get("ctl/go");
  const goNow = goVar ? exprData("EQUALS", [aliasData(goVar.id), boolData(true)]) : undefined;
  const loop = (to: FrameNode): Reaction[] => [
    {
      trigger: afterTimeout(delay),
      actions: chunking
        ? [
            event[0],
            setVariable(goVar!.id, keepGoing),
            ...dispatch(goNow),
            conditional(goNow!, [navigate(to.id)], [setVariable(running.id, boolData(false)), navigate(controlFrame.id)]),
          ]
        : [conditional(keepGoing, [...event, navigate(to.id)], [setVariable(running.id, boolData(false)), navigate(controlFrame.id)])],
    },
    ...keys,
  ];
  log(`wiring reactions (${perEvent} actions per event${chunking ? `, ${chunking.chunks.length} events per tick` : ""}${resetChunking ? `, ${resetChunking.chunks.length} events per reset` : ""})…`);
  const setR = async (n: { setReactionsAsync(r: Reaction[]): Promise<void> }, label: string, r: Reaction[]) => {
    for (const reaction of r) {
      const bad = nestedConditional((reaction.actions ?? []) as Action[]);
      if (bad) throw new Error(`reactions on "${label}": a CONDITIONAL nested inside a conditional block at ${bad} (Figma rejects this)`);
    }
    try {
      await n.setReactionsAsync(r);
    } catch (e) {
      const first = r[0]?.actions?.[0] as unknown as Record<string, unknown> | undefined;
      log(`FAILED setReactions on "${label}": ${String((e as Error)?.message ?? e).slice(0, 400)} | trigger=${JSON.stringify(r[0]?.trigger)}, actions[0] type=${String(first?.type)}, keys=${first ? Object.keys(first).join(",") : "none"}`);
      throw e;
    }
  };
  await setR(step, "Step", [{ trigger: onClick(), actions: event }]);
  if (stepMulti)
    await setR(stepMulti, "Step x3", [
      { trigger: mouseDown(), actions: event },
      { trigger: mouseUp(), actions: event },
      { trigger: onClick(), actions: event },
    ]);
  if (resetChunking) {
    const hop = (self: FrameNode, other: FrameNode) =>
      setR(self, self.name, [
        {
          trigger: afterTimeout(delay),
          // phase wrapped to 0 = the last chunk ran: back to Control; else hop to the other frame
          actions: [...resetEvent, conditional(compareData("EQUALS", resetPhase!.id, 0), [navigate(controlFrame.id)], [navigate(other.id)])],
        },
      ]);
    await setR(reset, "Reset button", [
      { trigger: onClick(), actions: [setVariable(running.id, boolData(false)), setVariable(resetPhase!.id, floatData(0)), navigate(resetA!.id)] },
    ]);
    await hop(resetA!, resetB!);
    await hop(resetB!, resetA!);
  } else await setR(reset, "Reset button", [{ trigger: onClick(), actions: resetActs }]);
  await setR(run, "Run button", [{ trigger: onClick(), actions: [setVariable(running.id, boolData(true)), navigate(runA.id)] }]);
  for (const stop of [stopA, stopB]) await setR(stop, "Stop button", [{ trigger: onClick(), actions: [setVariable(running.id, boolData(false))] }]);
  if (keys.length) await setR(controlFrame, "Control keys", keys);
  await setR(runA, "Run A", loop(runB));
  await setR(runB, "Run B", loop(runA));

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
    ...(resetPhase ? { resetPhase } : {}),
    frames: { control: controlFrame, runA, runB, ...(resetA ? { resetA, resetB } : {}) },
    buttons: { step, run, reset, stopA, stopB, ...(stepMulti ? { stepMulti } : {}) },
    bound,
    unbound,
    actionsPerStep: perEvent,
    chunks: chunking?.chunks.length ?? 1,
    ...(chunking ? { chunking } : {}),
    resetChunks: resetChunking?.chunks.length ?? 1,
    ...(resetChunking ? { resetChunking } : {}),
  };
}

function range(n: number, prefix: string): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}
