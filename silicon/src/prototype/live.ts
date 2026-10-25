// FigmaCPU Live, lane L2 (docs/LIVE.md §3): the native Present-mode runtime on the Live dashboard.
// Everything runs in Figma's prototype player, on the variables and the chunked tick apply() built.
// This file only adds frames and reactions.
//
//   Live · Main      an instance of the dashboard; the flow's starting point
//   Live · Run A/B   the Run loop: apply's flattened AFTER_TIMEOUT hop, ping-ponging, home = Main
//   Live · Load A/B  a disk load or Reset: one chunk of literal power-on writes per hop, then Main
//
// The controls' reactions sit on the dashboard COMPONENT's layers (ctl/step, ctl/run, ctl/stop,
// ctl/reset, ctl/pad/<i>, disk/<program>), so every instance has them (all five frames). They do not
// depend on which frame shows them, because variables guard them:
//   · ctl/busy (FLOAT: 0, or LOCK while loading) is added to the phase snapshot, so Step and the pad
//     match no chunk (do nothing) during a load;
//   · Run needs ¬busy ∧ ¬running and Stop needs ¬busy ∧ running. Running ⇔ the Run loop is showing,
//     so neither navigates to the frame you are on.
// A disk click only sets ctl/disk (and the program's name and listing) and starts the load. The
// load hops write every net's power-on value, a chunk per hop: first the nets whose value differs
// between the disks (the RAM bits and the nets they settle), then the shared rest. One number,
// ctl/loadPhase, says which: j·D + e is varying chunk j of disk e (D disks), V·D + k shared chunk
// k, -1 done; every case is an exclusive `if loadNow == p`. Reset reloads the current disk the same
// way. So no event writes more than a chunk, however many bits the disks differ in.
// Every reaction is flat (no CONDITIONAL inside a conditional's block) and its worst case, as
// `npm run audit` counts it (eventWorst), is within the cap.
import { eventWorst, type RestAction } from "../audit/audit";
import { powerOn } from "../compile/fastsim";
import { ramBit } from "../cpu/probes";
import { assemble } from "../isa/asm";
import { RAM_BYTES } from "../isa/spec";
import type { FlatNetlist } from "../netlist/types";
import type { ApplyResult } from "./apply";
import { box, COLORS, put, setFlows } from "./draw";
import {
  afterTimeout,
  aliasData,
  boolData,
  compareData,
  conditional,
  exprData,
  figmaActions,
  floatData,
  guardReactions,
  keyDown,
  mouseDown,
  mouseEnter,
  mouseUp,
  navigate,
  nestedConditional,
  onClick,
  setVariable,
  strData,
} from "./figma-actions";
import { DEFAULT_MAX_ACTIONS_PER_EVENT, lit, splitActions } from "./plan";
import type { Chunking, PlanAction, PrototypePlan } from "./types";

/** A program disk: the power-on state the CPU has with this program in RAM. */
export interface LiveProgram {
  name: string;
  /** Power-on value (0/1) per net id, e.g. powerOn(net, RAM pokes): see `cpuPrograms`. */
  initial: ArrayLike<number>;
  /** Text for `ctl/listing` while this program is loaded (optional). */
  listing?: string;
}

export type LiveTrigger = "ON_CLICK" | "MOUSE_DOWN" | "MOUSE_UP" | "MOUSE_ENTER";

export interface LiveOptions {
  /** Frame name prefix (default "Live": frames "Live · Main", …). */
  name?: string;
  /** Name of the prototype flow that starts at Main (default "FigmaCPU Live"). */
  flowName?: string;
  /** Page for the frames (default: the dashboard component's page). */
  page?: PageNode;
  /** Top-left of the row of frames (default: below everything on the page). */
  at?: { x: number; y: number };
  /** Gap between the frames (default 200). */
  gap?: number;
  /** Most actions one event may execute (default: the plan's cap, else 400). */
  maxActionsPerEvent?: number;
  /** AFTER_TIMEOUT delay of the Run and Load hops, in milliseconds (default 1; written to Figma in seconds). */
  runDelayMs?: number;
  /** Triggers on ctl/step, one chunk each (default ["ON_CLICK"]). ["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"] runs
   * three chunks per physical click if the viewer fires them as separate events (unverified in the real app). */
  stepTriggers?: LiveTrigger[];
  /** Triggers on each ctl/pad/<i>, one chunk each (default ["MOUSE_ENTER"]; add "MOUSE_DOWN" to clock by clicking too). */
  padTriggers?: LiveTrigger[];
  /** The component every pad cell is an instance of: its reaction is stored once instead of once per cell.
   * Pad cells that are not instances of it are wired one by one. The cells must not carry reactions of their own. */
  padCell?: ComponentNode;
  /** Key codes whose ON_KEY_DOWN on Main and Run A/B runs one chunk (no auto-repeat in the viewer). */
  keys?: number[];
  /** The disk the variables' initial values are (Reset reloads it until another disk is loaded). Default: the
   * first disk whose state equals the plan's power-on values (the `bootName` disk if none does). */
  boot?: string;
  /** Name of the extra disk that holds the plan's own power-on values, i.e. the program Compile / Load program
   * put in (default "custom", lane L1's `disk/custom`). Added when the dashboard has a disk/<bootName> button or
   * no disk equals those values, unless `programs` already has a disk of that name. */
  bootName?: string;
  /** Listing text of that disk (for `ctl/listing`). */
  bootListing?: string;
  /** Remove the frames of a previous wireLive with the same name (default true). */
  replace?: boolean;
  log?: (msg: string) => void;
}

export interface LiveFrames {
  main: FrameNode;
  runA: FrameNode;
  runB: FrameNode;
  loadA: FrameNode;
  loadB: FrameNode;
}

export interface LiveResult {
  frames: LiveFrames;
  /** The dashboard component's layers that carry the reactions (every instance inherits them). */
  controls: { step: SceneNode[]; run: SceneNode[]; stop: SceneNode[]; reset: SceneNode[]; padCells: SceneNode[]; disks: Map<string, SceneNode[]> };
  /** Live's own control variables (in the plan's collection). `program`/`listing` are STRINGs to bind texts to,
   * `loading` a BOOLEAN to bind a "loading" lamp to. */
  variables: { disk: Variable; loadPhase: Variable; loadNow: Variable; busy: Variable; loading: Variable; program: Variable; listing?: Variable };
  /** Disk names by `ctl/disk` value (the programs, then the `bootName` disk if added); `boot` is the one the
   * variables start in. */
  disks: string[];
  boot: number;
  /** Nets a disk click writes (their power-on value differs between disks) and nets the load hops write (+ flags). */
  diskNets: number;
  sharedNets: number;
  /** The load hops' chunks (shared nets, literal power-on values). */
  loadChunking: Chunking;
  /** Events per tick (Step clicks, pad events or Run hops), and per disk load / Reset (the click + its hops). */
  eventsPerTick: number;
  eventsPerLoad: number;
  /** Worst case of one event of each kind, as `npm run audit` counts it (all ≤ cap). */
  perEvent: { step: number; pad: number; runHop: number; run: number; stop: number; diskClick: number; resetClick: number; loadHop: number };
  cap: number;
  /** Actions stored in all reactions wireLive set (every branch counted): the file weight it adds. */
  stored: number;
}

/** ctl/busy while a load runs: added to the phase snapshot, it is beyond every chunk number. */
export const LIVE_LOCK = 1000;

/** The frames wireLive makes, by role. */
export const liveFrameNames = (prefix = "Live") => ({
  main: `${prefix} · Main`,
  runA: `${prefix} · Run A`,
  runB: `${prefix} · Run B`,
  loadA: `${prefix} · Load A`,
  loadB: `${prefix} · Load B`,
});

const CONTROL_NAMES = { step: "ctl/step", run: "ctl/run", stop: "ctl/stop", reset: "ctl/reset" } as const;
const PAD_CELL = /^ctl\/pad\/(\d+)$/;
const DISK = /^disk\/(.+)$/;

type Reacting = SceneNode & { setReactionsAsync(r: Reaction[]): Promise<void> };

/**
 * Wires the Live dashboard for Present mode.
 * `plan` and `compiled` are what Compile used and what apply() returned (variables, chunked tick, runtime).
 * `dashboard` is the component (or `{ component }` as buildDashboard returns it) with layers named
 * ctl/step, ctl/run, ctl/stop, ctl/reset, ctl/pad/<i> and disk/<program>. `programs` are the disks.
 */
export async function wireLive(
  api: PluginAPI,
  plan: PrototypePlan,
  compiled: ApplyResult,
  dashboard: ComponentNode | { component: ComponentNode },
  programs: LiveProgram[],
  opts: LiveOptions = {},
): Promise<LiveResult> {
  const log = opts.log ?? (() => {});
  const comp = (dashboard as { component?: ComponentNode }).component ?? (dashboard as ComponentNode);
  if (!comp || comp.type !== "COMPONENT") throw new Error("wireLive: the dashboard must be a component (its instances fill the Live frames)");
  const rt = compiled.runtime;
  if (!rt) throw new Error("wireLive: `compiled` has no runtime: pass what apply() returned");
  const cap = opts.maxActionsPerEvent ?? plan.maxActionsPerEvent ?? DEFAULT_MAX_ACTIONS_PER_EVENT;
  const page = opts.page ?? pageOf(comp);
  if (!page) throw new Error("wireLive: the dashboard component is not on a page");
  await (page as PageNode & { loadAsync?: () => Promise<void> }).loadAsync?.();
  const varId = (net: number) => {
    const id = compiled.varIds.get(net);
    if (!id) throw new Error(`wireLive: no variable for net ${net}: Compile again`);
    return id;
  };

  // 1. Disks: every net's power-on value per disk. Nets that agree on all disks are "shared" (load hops),
  //    the others (RAM bits and what they settle) are written by the disk click itself.
  const vars = plan.variables;
  const disks = programs.map((p) => ({ name: p.name, values: valuesOf(p, vars), listing: p.listing }));
  const names = new Set<string>();
  for (const d of disks) {
    if (names.has(d.name)) throw new Error(`wireLive: two disks named "${d.name}"`);
    names.add(d.name);
  }
  // The plan's own power-on values (the program Compile / Load program put in) as a disk too, if asked for or needed.
  const layers = namedLayers(comp);
  const initVals = vars.map((v) => v.init);
  const bootName = opts.bootName ?? "custom";
  if (!names.has(bootName) && (layers.has(`disk/${bootName}`) || !disks.some((d) => same(d.values, initVals))))
    disks.push({ name: bootName, values: initVals, listing: opts.bootListing });
  const boot = opts.boot !== undefined ? disks.findIndex((d) => d.name === opts.boot) : disks.findIndex((d) => same(d.values, initVals));
  if (boot < 0) throw new Error(`wireLive: boot disk "${opts.boot}" is not one of the disks`);
  if (!same(disks[boot].values, initVals)) log(`boot disk "${disks[boot].name}" differs from the variables' initial values: the first Reset loads it`);
  const varying: number[] = [];
  const shared: PlanAction[] = [];
  vars.forEach((v, i) => {
    if (disks.some((d) => d.values[i] !== disks[0].values[i])) varying.push(i);
    else shared.push({ set: v.net, to: lit(disks[0].values[i]) });
  });
  for (const f of plan.flags ?? []) shared.push({ set: f.net, to: lit(false) });

  // 2. The dashboard's controls (layers of the component itself, not of instances nested in it).
  const control = (role: keyof typeof CONTROL_NAMES): Reacting[] => {
    const ns = layers.get(CONTROL_NAMES[role]) ?? [];
    if (!ns.length) throw new Error(`wireLive: the dashboard "${comp.name}" has no layer named ${CONTROL_NAMES[role]}`);
    return ns;
  };
  const step = control("step");
  const run = control("run");
  const stop = control("stop");
  const reset = control("reset");
  const padCells = [...layers]
    .filter(([n]) => PAD_CELL.test(n))
    .sort(([a], [b]) => Number(PAD_CELL.exec(a)![1]) - Number(PAD_CELL.exec(b)![1]))
    .flatMap(([, ns]) => ns);
  const diskNodes = new Map<string, Reacting[]>();
  for (const [n, ns] of layers) {
    const m = DISK.exec(n);
    if (m) diskNodes.set(m[1], ns);
  }
  if (!padCells.length) log(`the dashboard has no ctl/pad/<i> layers: no clock pad`);

  // 3. Live's control variables, next to apply's (reused by name when wiring again).
  const anyListing = disks.some((d) => d.listing !== undefined);
  const lv = await liveVariables(api, compiled, [
    { name: "ctl/disk", type: "FLOAT", init: boot },
    { name: "ctl/loadPhase", type: "FLOAT", init: 0 },
    { name: "ctl/loadNow", type: "FLOAT", init: 0 },
    { name: "ctl/busy", type: "FLOAT", init: 0 },
    { name: "ctl/loading", type: "BOOLEAN", init: false },
    { name: "ctl/program", type: "STRING", init: disks[boot].name },
    ...(anyListing ? [{ name: "ctl/listing", type: "STRING" as const, init: disks[boot].listing ?? "" }] : []),
  ]);
  const disk = lv.get("ctl/disk")!;
  const loadPhase = lv.get("ctl/loadPhase")!;
  const loadNow = lv.get("ctl/loadNow")!;
  const busy = lv.get("ctl/busy")!;
  const loading = lv.get("ctl/loading")!;
  const program = lv.get("ctl/program")!;
  const listing = lv.get("ctl/listing");

  // 4. Frames: instances of the dashboard in a row, in a free region of the page.
  const frameNames = liveFrameNames(opts.name);
  if (opts.replace !== false) for (const n of [...page.children]) if (Object.values(frameNames).includes(n.name)) n.remove();
  const gap = opts.gap ?? 200;
  const at = opts.at ?? freeSpot(page);
  const W = comp.width;
  const H = comp.height;
  const roles = ["main", "runA", "runB", "loadA", "loadB"] as const;
  const made = roles.map((role, i) => {
    const f = box(api, frameNames[role], W, H, COLORS.bg);
    put(page, f, at.x + i * (W + gap), at.y);
    const inst = comp.createInstance();
    inst.name = comp.name;
    put(f, inst, 0, 0);
    return f;
  });
  const frames: LiveFrames = { main: made[0], runA: made[1], runB: made[2], loadA: made[3], loadB: made[4] };

  // 5. Events.
  const running = compiled.running;
  const idle = compareData("EQUALS", busy.id, 0);
  const isRunning = exprData("EQUALS", [aliasData(running.id), boolData(true)]);
  const notRunning = exprData("NOT", [aliasData(running.id)]);
  // Step / pad / keys: one chunk through apply's dispatcher; the snapshot adds ctl/busy, so nothing matches while loading.
  const phaseNow = rt.controls.get("ctl/phaseNow");
  const stepEvent: Action[] =
    rt.dispatch && compiled.phase && phaseNow
      ? [setVariable(phaseNow.id, exprData("ADDITION", [aliasData(compiled.phase.id, "FLOAT"), aliasData(busy.id, "FLOAT")], "FLOAT")), ...rt.dispatch()]
      : [conditional(idle, rt.step)];
  const runHop = (next: FrameNode) => rt.hop(next.id, frames.main.id);
  const runClick: Action[] = [conditional(exprData("AND", [idle, notRunning]), [setVariable(running.id, boolData(true)), navigate(frames.runA.id)])];
  const stopClick: Action[] = [conditional(exprData("AND", [idle, isRunning]), [setVariable(running.id, boolData(false)), navigate(frames.main.id)])];
  // A load: lock, point ctl/disk at the disk and loadPhase at its first chunk, then hop Load A ⇄ B.
  const startLoad: Action[] = [setVariable(running.id, boolData(false)), setVariable(busy.id, floatData(LIVE_LOCK)), setVariable(loading.id, boolData(true))];
  const goVar = rt.controls.get("ctl/go");
  const tail: Action[] = [
    ...rt.resetTail,
    ...(goVar ? [setVariable(goVar.id, boolData(false))] : []),
    setVariable(busy.id, floatData(0)),
    setVariable(loading.id, boolData(false)),
  ];
  // Load hops: one case per phase (V·D disk chunks, S shared chunks). Every hop evaluates all the
  // case conditions, so the chunk sizes are what the cap leaves after them (found by iterating).
  const D = disks.length;
  let V = varying.length ? 1 : 0;
  let S = 1;
  let vGroups: number[][] = [];
  let sChunks: PlanAction[][] = [[]];
  for (let round = 0; ; round++) {
    // Executed by every hop besides its chunk: the snapshot, the V·D + S case conditions, loadPhase, the navigation (2).
    const fixed = 1 + V * D + S + 1 + 2;
    const vSize = cap - fixed;
    const sBudget = cap - fixed - tail.length;
    if (vSize < 1 || sBudget < 1) throw new Error(`wireLive: maxActionsPerEvent ${cap} is too small to load ${D} disks`);
    vGroups = [];
    for (let i = 0; i < varying.length; i += vSize) vGroups.push(varying.slice(i, i + vSize));
    const split = splitActions(shared, sBudget);
    sChunks = split.length ? split : [[]];
    if (vGroups.length === V && sChunks.length === S) break;
    if (round > 32) throw new Error("wireLive: the load chunks do not settle");
    [V, S] = [vGroups.length, sChunks.length];
  }
  const K = V + S;
  const DONE = -1;
  const shared0 = V * D;
  const toLoad: Action[] = [navigate(frames.loadA.id)];
  const diskClick = (e: number): Action[] => [
    ...startLoad,
    setVariable(disk.id, floatData(e)),
    setVariable(loadPhase.id, floatData(V ? e : shared0)),
    setVariable(program.id, strData(disks[e].name)),
    ...(listing ? [setVariable(listing.id, strData(disks[e].listing ?? ""))] : []),
    ...toLoad,
  ];
  const resetClick: Action[] = [
    ...startLoad,
    setVariable(loadPhase.id, V ? exprData("ADDITION", [aliasData(disk.id, "FLOAT"), floatData(0)], "FLOAT") : floatData(shared0)),
    ...toLoad,
  ];
  const loadHop = (other: FrameNode): Action[] => [
    setVariable(loadNow.id, exprData("ADDITION", [aliasData(loadPhase.id, "FLOAT"), floatData(0)], "FLOAT")),
    ...vGroups.flatMap((g, j) =>
      disks.map((d, e) =>
        conditional(compareData("EQUALS", loadNow.id, j * D + e), [
          ...g.map((i) => setVariable(varId(vars[i].net), boolData(d.values[i]))),
          setVariable(loadPhase.id, floatData(j + 1 < V ? (j + 1) * D + e : shared0)),
        ]),
      ),
    ),
    ...sChunks.map((c, k) =>
      conditional(compareData("EQUALS", loadNow.id, shared0 + k), [...figmaActions(c, compiled.varIds), setVariable(loadPhase.id, floatData(k + 1 < S ? shared0 + k + 1 : DONE)), ...(k === S - 1 ? tail : [])]),
    ),
    conditional(compareData("EQUALS", loadPhase.id, DONE), [navigate(frames.main.id)], [navigate(other.id)]),
  ];
  const fixedPerHop = 1 + V * D + S + 1 + 2;
  const loadChunking: Chunking = {
    maxActionsPerEvent: cap,
    tickExtra: tail.length,
    chunks: [...vGroups.map(() => [] as PlanAction[]), ...sChunks],
    perEvent: [...vGroups.map((g) => fixedPerHop + g.length), ...sChunks.map((c, k) => fixedPerHop + c.length + (k === S - 1 ? tail.length : 0))],
  };

  // 6. Reactions: checked flat and within the cap (as the audit counts), then set.
  const trigger = (t: LiveTrigger): Trigger => (t === "ON_CLICK" ? onClick() : t === "MOUSE_DOWN" ? mouseDown() : t === "MOUSE_UP" ? mouseUp() : mouseEnter());
  let stored = 0;
  const setR = async (node: Reacting, label: string, reactions: Reaction[]) => {
    for (const r of reactions) {
      const acts = (r.actions ?? []) as Action[];
      const bad = nestedConditional(acts);
      if (bad) throw new Error(`wireLive: reactions on "${label}": a CONDITIONAL nested inside a conditional block at ${bad} (Figma rejects this)`);
      const w = worst(acts);
      if (w > cap) throw new Error(`wireLive: "${label}" (${r.trigger?.type}) can execute ${w} actions in one event, more than the cap ${cap}`);
      stored += countAll(acts);
    }
    guardReactions(node, label, log);
    await node.setReactionsAsync(reactions);
  };
  const keys = (opts.keys ?? []).length ? [{ trigger: keyDown(opts.keys!), actions: stepEvent }] : [];
  const stepTriggers = opts.stepTriggers ?? ["ON_CLICK"];
  const padTriggers = opts.padTriggers ?? ["MOUSE_ENTER"];
  if (!stepTriggers.length) throw new Error("wireLive: stepTriggers is empty");
  for (const n of step) await setR(n, "ctl/step", stepTriggers.map((t) => ({ trigger: trigger(t), actions: stepEvent })));
  for (const n of run) await setR(n, "ctl/run", [{ trigger: onClick(), actions: runClick }]);
  for (const n of stop) await setR(n, "ctl/stop", [{ trigger: onClick(), actions: stopClick }]);
  for (const n of reset) await setR(n, "ctl/reset", [{ trigger: onClick(), actions: resetClick }]);
  const padReactions = padTriggers.map((t) => ({ trigger: trigger(t), actions: stepEvent }));
  let padOnMain = false;
  for (const n of padCells) {
    const main = opts.padCell && n.type === "INSTANCE" ? await (n as InstanceNode).getMainComponentAsync() : null;
    if (opts.padCell && main?.id === opts.padCell.id) {
      padOnMain = true;
      continue;
    }
    await setR(n, n.name, padReactions);
  }
  if (padOnMain) await setR(opts.padCell as unknown as Reacting, opts.padCell!.name, padReactions);
  const diskIndex = new Map(disks.map((d, e) => [d.name, e]));
  for (const [name, ns] of diskNodes) {
    const e = diskIndex.get(name);
    if (e === undefined) log(`disk/${name}: no program of that name, left unwired`);
    for (const n of ns) await setR(n, `disk/${name}`, e === undefined ? [] : [{ trigger: onClick(), actions: diskClick(e) }]);
  }
  for (const d of disks) if (!diskNodes.has(d.name) && d.name !== disks[boot].name) log(`program ${d.name} has no disk/${d.name} button on the dashboard`);
  const delay = (opts.runDelayMs ?? 1) / 1000; // afterTimeout counts seconds
  await setR(frames.main as Reacting, frameNames.main, keys);
  await setR(frames.runA as Reacting, frameNames.runA, [{ trigger: afterTimeout(delay), actions: runHop(frames.runB) }, ...keys]);
  await setR(frames.runB as Reacting, frameNames.runB, [{ trigger: afterTimeout(delay), actions: runHop(frames.runA) }, ...keys]);
  await setR(frames.loadA as Reacting, frameNames.loadA, [{ trigger: afterTimeout(delay), actions: loadHop(frames.loadB) }]);
  await setR(frames.loadB as Reacting, frameNames.loadB, [{ trigger: afterTimeout(delay), actions: loadHop(frames.loadA) }]);

  // 7. ▶ Present opens Main.
  try {
    setFlows(page, [{ nodeId: frames.main.id, name: opts.flowName ?? "FigmaCPU Live" }]);
  } catch (e) {
    log(`could not add the Live flow: ${e}`);
  }

  const perEvent = {
    step: worst(stepEvent),
    pad: padCells.length ? worst(stepEvent) : 0,
    runHop: worst(runHop(frames.runB)),
    run: worst(runClick),
    stop: worst(stopClick),
    diskClick: Math.max(0, ...disks.map((_, e) => worst(diskClick(e)))),
    resetClick: worst(resetClick),
    loadHop: worst(loadHop(frames.loadB)),
  };
  log(
    `Live wired: ${disks.length} disks, ${compiled.chunks} events per tick (≤ ${perEvent.step} actions), a load = 1 click + ${K} hops (${varying.length} disk nets in ${V}, ≤ ${perEvent.loadHop} actions), ${padCells.length} pad cells, ${stored} actions stored`,
  );
  return {
    frames,
    controls: { step, run, stop, reset, padCells, disks: diskNodes },
    variables: { disk, loadPhase, loadNow, busy, loading, program, ...(listing ? { listing } : {}) },
    disks: disks.map((d) => d.name),
    boot,
    diskNets: varying.length,
    sharedNets: shared.length,
    loadChunking,
    eventsPerTick: compiled.chunks,
    eventsPerLoad: 1 + K,
    perEvent,
    cap,
    stored,
  };
}

// ---------- CPU disks ----------

/** The CPU's disks: each program assembled and its RAM image poked into the power-on state, exactly what
 * Compile / Load program start the variables at (powerOn with the RAM latch outputs set). `listing` formats
 * the text for `ctl/listing` (default `asmListing`; lane L1's `listingText` adds addresses and bytes). */
export function cpuPrograms(net: FlatNetlist, sources: Record<string, string>, listing: (source: string) => string = asmListing): LiveProgram[] {
  return Object.entries(sources).map(([name, src]) => {
    const r = assemble(src);
    if (r.errors.length) throw new Error(`disk ${name}: ${r.errors.map((e) => `line ${e.line}: ${e.msg}`).join("; ")}`);
    const pokes: Record<string, number> = {};
    for (let a = 0; a < RAM_BYTES; a++) {
      const v = (r.bytes[a] ?? 0) & 0xff;
      for (let b = 0; b < 8; b++) pokes[ramBit(a, b)] = (v >> b) & 1;
    }
    return { name, initial: powerOn(net, pokes), listing: listing(src) };
  });
}

/** Assembly source without comments and blank lines, one instruction per line ("loop: ADD R0, R1"). */
export function asmListing(source: string): string {
  return source
    .split("\n")
    .map((l) => l.replace(/;.*$/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---------- helpers ----------

function valuesOf(p: LiveProgram, vars: PrototypePlan["variables"]): boolean[] {
  return vars.map((v) => {
    const x = p.initial[v.net];
    if (x !== 0 && x !== 1) throw new Error(`disk ${p.name}: no 0/1 power-on value for ${v.name} (net ${v.net})`);
    return x === 1;
  });
}

const same = (a: boolean[], b: boolean[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Worst case of one event, exactly as `npm run audit` counts it (exclusive dispatch cases count once). */
const worst = (actions: readonly Action[]) => eventWorst(actions as unknown as RestAction[]);

function countAll(actions: readonly Action[]): number {
  let n = 0;
  for (const a of actions) n += 1 + (a.type === "CONDITIONAL" ? a.conditionalBlocks.reduce((s, b) => s + countAll(b.actions), 0) : 0);
  return n;
}

function pageOf(n: BaseNode): PageNode | null {
  let p: BaseNode | null = n;
  while (p && p.type !== "PAGE") p = p.parent;
  return p as PageNode | null;
}

/** Layers of the component by name, not descending into nested instances (whose layers cannot carry
 * reactions of their own here; the nested instance itself is included). */
function namedLayers(comp: ComponentNode): Map<string, Reacting[]> {
  const out = new Map<string, Reacting[]>();
  const walk = (n: BaseNode & ChildrenMixin) => {
    for (const c of n.children) {
      if ("setReactionsAsync" in c) out.set(c.name, [...(out.get(c.name) ?? []), c as Reacting]);
      if (c.type !== "INSTANCE" && "children" in c) walk(c as BaseNode & ChildrenMixin);
    }
  };
  walk(comp);
  return out;
}

/** Below everything on the page, left-aligned with it. */
function freeSpot(page: PageNode): { x: number; y: number } {
  const kids = page.children;
  if (!kids.length) return { x: 0, y: 0 };
  const x = Math.min(...kids.map((k) => k.x));
  const y = Math.max(...kids.map((k) => k.y + k.height));
  return { x: Math.round(x), y: Math.round(y + 400) };
}

type Spec = { name: string; type: "BOOLEAN" | "FLOAT" | "STRING"; init: boolean | number | string };

/** Live's variables in apply's collection (the last one with room), reused by name when wiring again. */
async function liveVariables(api: PluginAPI, compiled: ApplyResult, specs: Spec[]): Promise<Map<string, Variable>> {
  const colls = compiled.collections;
  if (!colls.length) throw new Error("wireLive: apply() made no variable collection");
  const byId = new Map(colls.map((c) => [c.id, c]));
  const existing = new Map<string, Variable>();
  for (const v of await api.variables.getLocalVariablesAsync()) if (byId.has(v.variableCollectionId)) existing.set(v.name, v);
  const room = colls.find((c) => c.variableIds.length + specs.length <= 4900) ?? colls[colls.length - 1];
  const out = new Map<string, Variable>();
  for (const s of specs) {
    let v = existing.get(s.name);
    if (v && v.resolvedType !== s.type) {
      v.remove();
      v = undefined;
    }
    if (!v) v = api.variables.createVariable(s.name, room, s.type);
    v.setValueForMode(byId.get(v.variableCollectionId)!.defaultModeId, s.init);
    out.set(s.name, v);
  }
  return out;
}
