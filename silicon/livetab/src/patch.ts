// Leila's CPU in the Figma OS's CPU tab: the silicon 8-bit CPU (LDR/STR pointers included) running
// natively in Present, shown by the Live dashboard (src/live) over the OS's workspace whenever the
// rail's CPU tab is open. It is added to a live frame already in the file ("os-ui · live (gate-level
// CPU)", with the Figma OS extension's CPU tab), without touching the OS chip:
//
//   · the variables: one BOOLEAN per CPU wire plus the clock's, in their own collection "Leila CPU";
//   · the dashboard component (datapath, microcode grid, magnifiers, RAM, 7-segment), next to the
//     live frame, with the three magnified cells drawn beside it (not the whole 72k-layer CPU);
//   · one instance of it inside the live frame, over the canvas and the right panel (the rail and
//     the Layers panel stay usable), shown while `tab/cpu` (the extension's view variable) is true,
//     with a switch back to the OS chip;
//   · the clock, in place: one Step and one Run button per chunk of the tick, stacked, only the
//     current chunk's showing, so no reaction holds more than one chunk (≤ CAP actions: Figma times
//     out storing the whole ~3,900-action tick in one reaction in a file this big). Run and every
//     program load play as full-size, see-through overlays that SWAP from chunk to chunk and CLOSE
//     at the end, so the OS frame stays on screen and the dashboard lights up underneath.
//
// Buttons act on MOUSE_UP and take MOUSE_DOWN too (with the OS's own "press" actions), because the
// canvas cells under the view would otherwise take the press. The clock pad is hidden: each of its
// cells would need the whole tick in one reaction.
//
// Everything made here is remembered by id (shared plugin data on the document), so removeLiveTab
// deletes exactly that. Build time only: in Present, Figma's prototype engine does all the work.
import { compile, type CompiledSchedule } from "../../src/compile";
import { cpuLibrary, cpuNetlist, PROBES } from "../../src/cpu";
import { drawLibrary } from "../../src/figma";
import { PROGRAMS } from "../../src/isa";
import {
  bindDashboard,
  buildDashboard,
  CTL_PAD,
  CTL_RESET,
  CTL_RUN,
  CTL_STEP,
  CTL_STOP,
  DEFAULT_MAGNIFIERS,
  diskName,
  listingText,
} from "../../src/live";
import {
  bindVisible,
  createVariables,
  removeCollections,
  type VariableSpec,
} from "../../src/prototype/draw";
import {
  afterTimeout,
  aliasData,
  boolData,
  concatText,
  conditional,
  exprData,
  figmaActions,
  floatData,
  increment,
  mouseDown,
  mouseUp,
  navigateWith,
  nestedConditional,
  onClick,
  setVariable,
  strData,
  worstCase,
} from "../../src/prototype/figma-actions";
import { cpuPrograms, type LiveProgram } from "../../src/prototype/live";
import { lit, plan as makePlan, splitActions } from "../../src/prototype/plan";
import type { FlatNetlist } from "../../src/netlist/types";
import type { PlanAction } from "../../src/prototype/types";

// The live OS's names (osui/src/live): its frame, and the shared plugin data where each layer notes
// what it does. Copied rather than imported, so the plugin does not bundle the OS's builder.
export const LIVE = "os-ui · live (gate-level CPU)";
const ACTS_NS = "osui";
const ACTS_KEY = "acts";

export const PREFIX = "Leila CPU · ";
export const COLLECTION = "Leila CPU";
/** The Figma OS extension's view variables (osui/extras): `tab/cpu` is true while the CPU tab shows. */
export const VIEW_COLLECTION = "Figma OS · view";
export const TAB_VAR = "tab/cpu";
/** Shared plugin data on the document: the ids of every node this made. */
export const NS = "livetab";
const MADE = "made";
/** Most actions one event may execute. */
export const CAP = 400;
/** Actions an event adds around a chunk: press, condition, phase bookkeeping, tick counter, navigation. */
const AROUND = 10;
export const DEFAULT_PROGRAM = "ptrout";
const CUSTOM = "custom";

export interface LiveTabOptions {
  /** Program in RAM at power-on (default ptrout, Leila's pointer demo). */
  program?: string;
  log?: (m: string) => void;
  breathe?: () => Promise<void>;
}

export interface LiveTabResult {
  frame: FrameNode;
  view: FrameNode;
  dashboard: ComponentNode;
  variables: number;
  /** Events per clock tick (Step clicks or Run hops). */
  chunks: number;
  /** Overlay hops per program load. */
  loadHops: number;
  disks: string[];
  /** Worst case actions of one event, by kind. */
  perEvent: {
    step: number;
    runHop: number;
    diskClick: number;
    loadHop: number;
  };
  /** Actions stored in all the reactions made. */
  stored: number;
  /** Layers made (the dashboard component and its instance included). */
  layers: number;
  bound: number;
  problems: string[];
  /** The CPU and its wires' variables, for checking the result against FastSim. */
  net: FlatNetlist;
  schedule: CompiledSchedule;
  varIds: Map<number, string>;
  /** Variable ids of the clock and view variables by name (ctl/ticks, ctl/running, view/show, …). */
  controls: Map<string, string>;
  /** The overlays: Run (one per chunk) and a program load (one per hop). */
  overlays: { runs: FrameNode[]; loads: FrameNode[] };
}

type Reacting = SceneNode & ReactionMixin;
const CLOSE = { type: "CLOSE" } as unknown as Action;

const child = (n: BaseNode & ChildrenMixin, pred: (n: SceneNode) => boolean) =>
  (n.children as SceneNode[]).find(pred) ?? null;
const need = <T>(x: T | null | undefined, what: string): T => {
  if (x == null) throw new Error(`the live frame has no ${what}`);
  return x;
};
const actsOf = (n: SceneNode) => {
  try {
    return n.getSharedPluginData(ACTS_NS, ACTS_KEY);
  } catch {
    return "";
  }
};

/** The live frame: on the current page, else on any page. */
export async function findLive(
  api: PluginAPI,
): Promise<{ page: PageNode; frame: FrameNode } | null> {
  for (const page of [
    api.currentPage,
    ...api.root.children.filter((p) => p !== api.currentPage),
  ]) {
    await page.loadAsync();
    const frame = page.children.find(
      (c) => c.name === LIVE && c.type === "FRAME",
    ) as FrameNode | undefined;
    if (frame) return { page, frame };
  }
  return null;
}

/** Removes everything addLiveTab made: its nodes and its variable collection. Returns how many nodes. */
export async function removeLiveTab(api: PluginAPI): Promise<number> {
  let n = 0;
  let ids: string[] = [];
  try {
    ids = JSON.parse(api.root.getSharedPluginData(NS, MADE) || "[]");
  } catch {
    ids = [];
  }
  for (const id of ids) {
    const node = await api.getNodeByIdAsync(id);
    if (
      node &&
      !node.removed &&
      node.type !== "PAGE" &&
      node.type !== "DOCUMENT"
    ) {
      node.remove();
      n++;
    }
  }
  api.root.setSharedPluginData(NS, MADE, "");
  await removeCollections(api, COLLECTION);
  return n;
}

/** Adds Leila's CPU to the live frame's CPU tab (removing an earlier one first). */
export async function addLiveTab(
  api: PluginAPI,
  o: LiveTabOptions = {},
): Promise<LiveTabResult> {
  const log = o.log ?? (() => {});
  const breathe = o.breathe ?? (async () => {});
  const problems: string[] = [];
  const where = await findLive(api);
  if (!where)
    throw new Error(`no frame "${LIVE}" in this file: build the live OS first`);
  const { page, frame } = where;
  await removeLiveTab(api);
  const made: SceneNode[] = [];
  const keep = <T extends SceneNode>(n: T): T => (made.push(n), n);
  const remember = () =>
    api.root.setSharedPluginData(
      NS,
      MADE,
      JSON.stringify(made.filter((n) => !n.removed).map((n) => n.id)),
    );

  // ---- the live frame's parts
  const app = need(frame.children[0] as FrameNode | undefined, "app");
  const right = need(
    child(app, (n) => n.name.startsWith("aside.right-panel")),
    "right panel",
  );
  const canvas = need(
    child(app, (n) => n.name.startsWith("main.canvas")),
    "canvas",
  );
  const views = (await api.variables.getLocalVariableCollectionsAsync()).find(
    (c) => c.name === VIEW_COLLECTION,
  );
  const tabVar =
    views &&
    (await api.variables.getLocalVariablesAsync()).find(
      (v) => v.variableCollectionId === views.id && v.name === TAB_VAR,
    );
  if (!tabVar)
    throw new Error(
      `no "${TAB_VAR}" variable in "${VIEW_COLLECTION}": add the Figma OS extension (CPU + Learn) first, then this`,
    );
  // The OS's own press (what its toolbar does on a press that lands between buttons): a layer over
  // the canvas runs it on MOUSE_DOWN, so the canvas cell under it never starts a gesture.
  const blocker = frame.findOne(
    (n) => actsOf(n) === JSON.stringify([{ on: "block" }]),
  ) as Reacting | null;
  const press = ((blocker?.reactions?.[0]?.actions ?? []) as Action[]).slice();
  if (!press.length)
    log(
      "no press actions found on the live frame: clicks on the view only block the canvas",
    );

  // ---- the CPU and its programs
  log("compiling the CPU…");
  const net = cpuNetlist();
  const sched = compile(net, { inputs: [] });
  const programs: LiveProgram[] = cpuPrograms(net, PROGRAMS, listingText);
  const bootName = o.program ?? DEFAULT_PROGRAM;
  const boot = programs.findIndex((d) => d.name === bootName);
  if (boot < 0)
    throw new Error(
      `no program "${bootName}" (programs: ${programs.map((d) => d.name).join(", ")})`,
    );
  const disks = [...programs, { ...programs[boot], name: CUSTOM }];
  const p = makePlan(net, sched, {
    initial: programs[boot].initial as Uint8Array,
    name: COLLECTION,
    halt: PROBES.HALTED.name,
    maxActionsPerEvent: Infinity,
  });
  const chunks = splitActions(p.tick, CAP - AROUND);
  const K = chunks.length;

  // ---- variables: the clock's, then one per wire
  const control: VariableSpec[] = [
    { name: "ctl/ticks", type: "FLOAT", init: 0 },
    { name: "ctl/tickText", type: "STRING", init: "0" },
    { name: "ctl/running", type: "BOOLEAN", init: false },
    { name: "ctl/phase", type: "FLOAT", init: 0 },
    { name: "ctl/phaseText", type: "STRING", init: "0" },
    ...chunks.map((_, k): VariableSpec => ({
      name: `ctl/phaseIs/${k}`,
      type: "BOOLEAN",
      init: k === 0,
    })),
    { name: "ctl/program", type: "STRING", init: bootName },
    { name: "ctl/listing", type: "STRING", init: programs[boot].listing ?? "" },
    { name: "ctl/loading", type: "BOOLEAN", init: false },
    ...disks.map((_, e): VariableSpec => ({
      name: `ctl/diskIs/${e}`,
      type: "BOOLEAN",
      init: e === boot,
    })),
    { name: "view/show", type: "BOOLEAN", init: true },
    { name: "view/hide", type: "BOOLEAN", init: false },
    { name: "view/tap", type: "BOOLEAN", init: false },
  ];
  const netVars = [...p.variables, ...(p.flags ?? [])];
  log(
    `creating ${control.length + netVars.length} variables in "${COLLECTION}"…`,
  );
  const { vars } = await createVariables(
    api,
    COLLECTION,
    [
      ...control,
      ...netVars.map((v): VariableSpec => ({
        name: v.name,
        type: "BOOLEAN",
        init: v.init,
      })),
    ],
    { log },
  );
  const ctl = new Map(control.map((c, i) => [c.name, vars[i]]));
  const cv = (name: string) => need(ctl.get(name), `variable ${name}`);
  const varIds = new Map<number, string>();
  const varByNet = new Map<number, Variable>();
  netVars.forEach((v, i) => {
    varIds.set(v.net, vars[control.length + i].id);
    varByNet.set(v.net, vars[control.length + i]);
  });
  await breathe();

  // ---- events
  const ticks = cv("ctl/ticks");
  const running = cv("ctl/running");
  const phase = cv("ctl/phase");
  const phaseIs = (k: number) => cv(`ctl/phaseIs/${k}`);
  const set = (v: Variable, x: boolean | number | string) =>
    setVariable(
      v.id,
      typeof x === "boolean"
        ? boolData(x)
        : typeof x === "number"
          ? floatData(x)
          : strData(x),
    );
  const tickDone: Action[] = [
    increment(ticks.id),
    concatText(cv("ctl/tickText").id, ticks.id),
  ];
  const chunkEvent = (k: number): Action[] => {
    const next = (k + 1) % K;
    return [
      ...figmaActions(chunks[k], varIds),
      set(phase, next),
      concatText(cv("ctl/phaseText").id, phase.id),
      set(phaseIs(k), false),
      set(phaseIs(next), true),
      ...(k === K - 1 ? tickDone : []),
    ];
  };
  const isRunning = exprData("EQUALS", [aliasData(running.id), boolData(true)]);
  const halted =
    p.halt !== undefined && p.halt > 1 ? varIds.get(p.halt) : undefined;
  const keepGoing = halted
    ? exprData("AND", [
        aliasData(running.id),
        exprData("NOT", [aliasData(halted)]),
      ])
    : isRunning;
  // Program loads: the nets whose power-on value differs between programs go in the click, the
  // rest (the same for every program) in the overlay hops, the clock's reset with the last one.
  const values = disks.map((d) =>
    p.variables.map((v) => (d.initial[v.net] ? 1 : 0)),
  );
  const varying: number[] = [];
  const shared: PlanAction[] = [];
  p.variables.forEach((v, i) => {
    if (values.some((vals) => vals[i] !== values[0][i])) varying.push(i);
    else shared.push({ set: v.net, to: lit(values[0][i] === 1) });
  });
  for (const f of p.flags ?? []) shared.push({ set: f.net, to: lit(false) });
  const tail: Action[] = [
    set(ticks, 0),
    set(cv("ctl/tickText"), "0"),
    set(phase, 0),
    set(cv("ctl/phaseText"), "0"),
    ...chunks.map((_, k) => set(phaseIs(k), k === 0)),
    set(running, false),
    set(cv("ctl/loading"), false),
  ];
  const loads = splitActions(shared, CAP - AROUND - tail.length);
  const startLoad = (e: number): Action[] => [
    set(running, false),
    set(cv("ctl/loading"), true),
    ...disks.map((_, x) => set(cv(`ctl/diskIs/${x}`), x === e)),
    set(cv("ctl/program"), disks[e].name),
    set(cv("ctl/listing"), disks[e].listing ?? ""),
    ...varying.map((i) =>
      setVariable(
        varIds.get(p.variables[i].net)!,
        boolData(values[e][i] === 1),
      ),
    ),
  ];

  // ---- reactions: flat and within the cap, checked before they are set
  let stored = 0;
  const react = async (
    node: SceneNode,
    label: string,
    reactions: Reaction[],
  ) => {
    for (const r of reactions) {
      const acts = (r.actions ?? []) as Action[];
      const bad = nestedConditional(acts);
      if (bad)
        throw new Error(
          `${label}: a CONDITIONAL nested at ${bad} (Figma rejects it)`,
        );
      const w = worstCase(acts);
      if (w > CAP)
        throw new Error(
          `${label} (${r.trigger?.type}) can execute ${w} actions in one event, more than ${CAP}`,
        );
      stored += countAll(acts);
    }
    try {
      await (node as Reacting).setReactionsAsync(reactions);
    } catch (e) {
      problems.push(`${label}: ${e instanceof Error ? e.message : e}`);
    }
  };
  const tapActs = (acts: Action[]): Reaction[] => [
    {
      trigger: mouseDown(),
      actions: press.length ? press : [set(cv("view/tap"), true)],
    },
    { trigger: mouseUp(), actions: [...press, ...acts] },
  ];
  const blockAll = (): Reaction[] => {
    const acts = press.length ? press : [set(cv("view/tap"), true)];
    return [
      { trigger: mouseDown(), actions: acts },
      { trigger: mouseUp(), actions: acts },
      { trigger: onClick(), actions: acts },
    ];
  };

  // ---- the dashboard component, beside the live frame
  await loadFonts(api);
  const at = { x: frame.x, y: frame.y + frame.height + 400 };
  log("drawing the magnified cells…");
  const before = new Set(page.children.map((n) => n.id));
  const mags = DEFAULT_MAGNIFIERS.map((m) => m.cell);
  await drawLibrary(
    cpuLibrary(),
    { gates: page, cells: page, cpu: page },
    { only: mags, gateLabels: false },
  );
  const libNodes = page.children.filter((n) => !before.has(n.id));
  // Line the drawn gates and cells up below the dashboard's spot.
  let lx = at.x;
  const ly = at.y + 1200 + 200;
  for (const n of libNodes) {
    n.x = lx;
    n.y = ly;
    lx += n.width + 80;
    keep(n);
  }
  remember();
  await breathe();
  log("drawing the dashboard…");
  const dash = await buildDashboard(api, page, net, {
    at,
    source: PROGRAMS[bootName],
    programName: bootName,
    programs: PROGRAMS,
    cellPages: [page],
    log,
  });
  const comp = keep(dash.component);
  comp.name = `${PREFIX}Dashboard`;
  keep(dash.nodes.padCell);
  remember();
  const report = bindDashboard(comp, net, varByNet, { ctl });
  log(
    `bound ${report.bound} lights${report.unbound.length ? `, ${report.unbound.length} without a variable` : ""}`,
  );
  if (report.missingVars.length)
    log(`texts without a variable: ${report.missingVars.join(", ")}`);
  // The clock pad would need the whole tick in each cell's reaction: hidden with its header and hint.
  const pad = comp.findOne((n) => n.name === CTL_PAD);
  if (pad) pad.visible = false;
  for (const t of comp.findAll(
    (n) =>
      n.type === "TEXT" &&
      (n.name === "hint/pad" || (n as TextNode).characters === "Clock pad"),
  ))
    t.visible = false;
  await breathe();

  // ---- overlays: Run (one per chunk) and a program load (one per hop), full size and see-through
  const W = frame.width;
  const H = frame.height;
  const overlay = (name: string, label: string, stop: boolean, i: number) => {
    const f = keep(api.createFrame());
    page.appendChild(f);
    f.name = `${PREFIX}${name}`;
    f.resize(W, H);
    f.x = at.x + 2000 + (i % 4) * (W + 80);
    f.y = at.y + Math.floor(i / 4) * (H + 80);
    f.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.01 }];
    f.clipsContent = true;
    const pill = api.createFrame();
    f.appendChild(pill);
    pill.name = "pill";
    pill.resize(stop ? 320 : 260, 44);
    pill.x = Math.round((W - pill.width) / 2);
    pill.y = H - 44 - 28;
    pill.cornerRadius = 10;
    pill.fills = [{ type: "SOLID", color: hex("#2C2C2C") }];
    pill.strokes = [{ type: "SOLID", color: hex("#444444") }];
    pill.effects = [
      {
        type: "DROP_SHADOW",
        color: { r: 0, g: 0, b: 0, a: 0.4 },
        offset: { x: 0, y: 4 },
        radius: 16,
        spread: 0,
        visible: true,
        blendMode: "NORMAL",
      },
    ];
    const t = api.createText();
    pill.appendChild(t);
    t.fontName = { family: "Inter", style: "Medium" };
    t.fontSize = 12;
    t.characters = label;
    t.fills = [{ type: "SOLID", color: hex("#E6E6E6") }];
    t.x = 16;
    t.y = Math.round((44 - t.height) / 2);
    let button: FrameNode | null = null;
    if (stop) {
      button = api.createFrame();
      pill.appendChild(button);
      button.name = "stop";
      button.resize(72, 28);
      button.x = pill.width - 72 - 8;
      button.y = 8;
      button.cornerRadius = 6;
      button.fills = [{ type: "SOLID", color: hex("#E5484D") }];
      const s = api.createText();
      button.appendChild(s);
      s.fontName = { family: "Inter", style: "Medium" };
      s.fontSize = 12;
      s.characters = "Stop";
      s.fills = [{ type: "SOLID", color: hex("#FFFFFF") }];
      s.x = Math.round((72 - s.width) / 2);
      s.y = Math.round((28 - s.height) / 2);
    }
    return { f, button };
  };
  const runs = chunks.map((_, k) =>
    overlay(`Run ${k + 1}`, `Running · chunk ${k + 1} of ${K}`, true, k),
  );
  const loadOv = loads.map((_, j) =>
    overlay(
      `Load ${j + 1}`,
      `Loading the program · ${j + 1} of ${loads.length}`,
      false,
      K + j,
    ),
  );
  remember();
  const delay = 0.001; // AFTER_TIMEOUT counts seconds
  log(`wiring the clock: ${K} chunks per tick, ${loads.length} hops per load…`);
  for (const [k, r] of runs.entries()) {
    const go = [...chunkEvent(k), navigateWith(runs[(k + 1) % K].f.id, "SWAP")];
    // A tick is never cut in half by HALT: it is checked only before chunk 0.
    const stopNow = [set(running, false), CLOSE];
    await react(r.f, `Run ${k + 1}`, [
      {
        trigger: afterTimeout(delay),
        actions: [conditional(k === 0 ? keepGoing : isRunning, go, stopNow)],
      },
      ...blockAll(),
    ]);
    await react(
      r.button!,
      `Run ${k + 1} · Stop`,
      tapActs([set(running, false)]),
    );
    await breathe();
  }
  for (const [j, l] of loadOv.entries()) {
    const last = j === loads.length - 1;
    const acts = [
      ...figmaActions(loads[j], varIds),
      ...(last ? [...tail, CLOSE] : [navigateWith(loadOv[j + 1].f.id, "SWAP")]),
    ];
    await react(l.f, `Load ${j + 1}`, [
      { trigger: afterTimeout(delay), actions: acts },
      ...blockAll(),
    ]);
    await breathe();
  }
  const loadClick = (e: number): Action[] => [
    ...startLoad(e),
    navigateWith(loadOv[0].f.id, "OVERLAY"),
  ];

  // ---- the dashboard's controls: Step and Run stacked per chunk, Reset per program, the disks
  const named = (name: string) =>
    comp.findAll(
      (n) => n.name === name && !insideInstance(n, comp),
    ) as FrameNode[];
  const stackOf = (
    name: string,
    count: number,
    visibleBy: (i: number) => Variable,
  ): FrameNode[] => {
    const base = need(named(name)[0], `dashboard layer ${name}`);
    const out = [base];
    const parent = base.parent as FrameNode;
    for (let i = 1; i < count; i++) {
      // Figma's clone() puts the copy at the top of the current page: back next to the original.
      const c = base.clone();
      parent.appendChild(c);
      c.x = base.x;
      c.y = base.y;
      out.push(c);
    }
    out.forEach((b, i) => bindVisible(b, visibleBy(i)));
    return out;
  };
  const steps = stackOf(CTL_STEP, K, phaseIs);
  for (const [k, b] of steps.entries())
    await react(b, `Step ${k + 1}`, tapActs(chunkEvent(k)));
  const runButtons = stackOf(CTL_RUN, K, phaseIs);
  for (const [k, b] of runButtons.entries())
    await react(
      b,
      `Run ${k + 1}`,
      tapActs([set(running, true), navigateWith(runs[k].f.id, "OVERLAY")]),
    );
  for (const b of named(CTL_STOP))
    await react(b, "Stop", tapActs([set(running, false)]));
  const resets = stackOf(CTL_RESET, disks.length, (e) => cv(`ctl/diskIs/${e}`));
  for (const [e, b] of resets.entries())
    await react(b, `Reset (${disks[e].name})`, tapActs(loadClick(e)));
  for (const [e, d] of disks.entries())
    for (const b of named(diskName(d.name)))
      await react(b, `disk ${d.name}`, tapActs(loadClick(e)));
  await breathe();

  // ---- the view inside the live frame: over the canvas and the right panel while the CPU tab shows
  // Over the canvas and the right panel: the rail and the Layers panel stay as they are.
  const x0 = canvas.x;
  const y0 = canvas.y;
  const vw = right.x + right.width - x0;
  const vh = frame.height - y0;
  const root = keep(api.createFrame());
  app.appendChild(root);
  root.name = `${PREFIX}tab`;
  root.resize(vw, vh);
  root.x = x0;
  root.y = y0;
  root.fills = [];
  root.clipsContent = true;
  bindVisible(root, tabVar);
  const view = api.createFrame();
  root.appendChild(view);
  view.name = `${PREFIX}view`;
  view.resize(vw, vh);
  view.x = 0;
  view.y = 0;
  view.fills = [{ type: "SOLID", color: hex("#1E1E1E") }];
  bindVisible(view, cv("view/show"));
  await react(view, "view", blockAll());
  const inst = comp.createInstance();
  view.appendChild(inst);
  inst.name = `${PREFIX}Live`;
  const s = Math.min((vw - 24) / comp.width, (vh - 56) / comp.height);
  if ("rescale" in inst) inst.rescale(s);
  else (inst as SceneNode as FrameNode).resize(comp.width * s, comp.height * s); // the fake API has no rescale
  inst.x = Math.round((vw - comp.width * s) / 2);
  inst.y = 44;
  const toggle = (
    parent: FrameNode,
    name: string,
    label: string,
    x: number,
    y: number,
  ) => {
    const b = api.createFrame();
    parent.appendChild(b);
    b.name = `${PREFIX}${name}`;
    b.resize(10, 28);
    b.cornerRadius = 6;
    b.fills = [{ type: "SOLID", color: hex("#2C2C2C") }];
    b.strokes = [{ type: "SOLID", color: hex("#444444") }];
    const t = api.createText();
    b.appendChild(t);
    t.fontName = { family: "Inter", style: "Medium" };
    t.fontSize = 12;
    t.characters = label;
    t.fills = [{ type: "SOLID", color: hex("#E6E6E6") }];
    b.resize(Math.ceil(t.width) + 24, 28);
    t.x = 12;
    t.y = Math.round((28 - t.height) / 2);
    b.x = x - b.width;
    b.y = y;
    return b;
  };
  const title = api.createText();
  view.appendChild(title);
  title.fontName = { family: "Inter", style: "Medium" };
  title.fontSize = 13;
  title.characters =
    "Leila's CPU · 2,296 gates running in Figma · LDR/STR pointers";
  title.fills = [{ type: "SOLID", color: hex("#E6E6E6") }];
  title.x = inst.x;
  title.y = 14;
  const toOs = toggle(view, "show OS chip", "OS chip ›", vw - 16, 8);
  await react(
    toOs,
    "OS chip",
    tapActs([set(cv("view/show"), false), set(cv("view/hide"), true)]),
  );
  // Top right of the canvas, beside the OS chip page's column (the viewer may cut the frame's bottom off).
  const back = toggle(
    root,
    "show Leila CPU",
    "‹ Leila's CPU",
    canvas.width - 16,
    8,
  );
  bindVisible(back, cv("view/hide"));
  await react(
    back,
    "Leila's CPU",
    tapActs([set(cv("view/show"), true), set(cv("view/hide"), false)]),
  );
  remember();

  const worst = (acts: Action[]) => worstCase(acts);
  const perEvent = {
    step: Math.max(
      ...chunks.map((_, k) => worst([...press, ...chunkEvent(k)])),
    ),
    runHop: Math.max(
      ...chunks.map((_, k) =>
        worst([
          conditional(
            isRunning,
            [...chunkEvent(k), CLOSE],
            [set(running, false), CLOSE],
          ),
        ]),
      ),
    ),
    diskClick: Math.max(
      ...disks.map((_, e) => worst([...press, ...loadClick(e)])),
    ),
    loadHop: Math.max(
      ...loads.map((l, j) =>
        worst([
          ...figmaActions(l, varIds),
          ...(j === loads.length - 1 ? [...tail, CLOSE] : [CLOSE]),
        ]),
      ),
    ),
  };
  const layers = made.reduce(
    (n, m) =>
      n +
      1 +
      ("findAll" in m ? (m as ChildrenMixin).findAll(() => true).length : 0),
    0,
  );
  log(
    `added: ${K} events per tick (≤ ${perEvent.step} actions), a load = 1 click (${varying.length} wires) + ${loads.length} hops, ${stored} actions stored, ${layers} layers`,
  );
  return {
    frame,
    view,
    dashboard: comp,
    variables: control.length + netVars.length,
    chunks: K,
    loadHops: loads.length,
    disks: disks.map((d) => d.name),
    perEvent,
    stored,
    layers,
    bound: report.bound,
    problems,
    net,
    schedule: sched,
    varIds,
    controls: new Map([...ctl].map(([n, v]) => [n, v.id])),
    overlays: { runs: runs.map((r) => r.f), loads: loadOv.map((l) => l.f) },
  };
}

function insideInstance(n: BaseNode, top: BaseNode): boolean {
  for (let q = n.parent; q && q !== top; q = q.parent)
    if (q.type === "INSTANCE") return true;
  return false;
}

function countAll(actions: readonly Action[]): number {
  let n = 0;
  for (const a of actions)
    n +=
      1 +
      (a.type === "CONDITIONAL"
        ? a.conditionalBlocks.reduce((s, b) => s + countAll(b.actions), 0)
        : 0);
  return n;
}

function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return {
    r: ((v >> 16) & 255) / 255,
    g: ((v >> 8) & 255) / 255,
    b: (v & 255) / 255,
  };
}

async function loadFonts(api: PluginAPI) {
  for (const style of ["Regular", "Medium", "Bold"])
    await api.loadFontAsync({ family: "Inter", style });
}
