// Leila's CPU in the Figma OS's CPU tab: the silicon 8-bit CPU (LDR/STR pointers included) running
// natively in Present, shown the way Leila's Live view shows it (tools/connector/live-view.js): the
// CPU's own blocks drawn as gates, every gate lit while its output is 1, under a slim bar with the
// clock's buttons and the programs; no lamps or diagrams. It is added to a live frame already in the file ("os-ui ·
// live (gate-level CPU)", with the Figma OS extension's CPU tab), without touching the OS chip:
//
//   · the variables: one BOOLEAN per CPU wire plus the clock's, in their own collection "Leila CPU";
//   · the register file, control unit, bus mux, IR, ALU, MAR, MDR, PC and T-state drawn as cell
//     components beside the live frame (not RAM and the wiring between blocks, ~31k layers in all:
//     every layer of the presented frame costs time per event);
//   · the view inside the live frame, over the canvas and the right panel (the rail and the Layers
//     panel stay usable), shown while `tab/cpu` (the extension's view variable) is true, with a
//     switch back to the OS chip: windows holding instances of those blocks, each gate's light bound
//     to the CPU wire it drives;
//   · the clock, in place: one Step and one Run button per chunk of the tick, stacked, only the
//     current chunk's showing, so no reaction holds more than one chunk (≤ CAP actions: Figma times
//     out storing the whole ~3,900-action tick in one reaction in a file this big). Run and every
//     program load play as full-size, see-through overlays that SWAP from chunk to chunk and CLOSE
//     at the end, so the OS frame stays on screen and lights up underneath.
//
// Buttons act on MOUSE_UP and take MOUSE_DOWN too (with the OS's own "press" actions), because the
// canvas cells under the view would otherwise take the press.
//
// Everything made here is remembered by id (shared plugin data on the document), so removeLiveTab
// deletes exactly that. Build time only: in Present, Figma's prototype engine does all the work.
import { compile, type CompiledSchedule } from "../../src/compile";
import { cpuLibrary, cpuNetlist, PROBES } from "../../src/cpu";
import { drawLibrary } from "../../src/figma";
import { PROGRAMS } from "../../src/isa";
import { bindDashboard, CTL_RESET, CTL_RUN, CTL_STEP, CTL_STOP, diskName, listingText, loadLiveFonts, magName } from "../../src/live";
import { frame as box, L, rect, text } from "../../src/live/style";
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

interface Block {
  cell: string;
  prefix: string;
}
/** The CPU's blocks the view draws as gates, as Leila's Live view zooms on them (src/cpu/cpu.ts). */
const BLOCKS: Block[] = [
  { cell: "REGFILE", prefix: "regs" },
  { cell: "CONTROL", prefix: "ctrl" },
  { cell: "BUSMUX", prefix: "busmux" },
  { cell: "REG_W8", prefix: "ir" },
  { cell: "ALU", prefix: "alu" },
  { cell: "REG_W4", prefix: "mar" },
  { cell: "REG_W8", prefix: "mdr" },
  { cell: "PC4", prefix: "pc" },
  { cell: "TSTATE", prefix: "tstate" },
];

export interface LiveTabOptions {
  /** Program in RAM at power-on (default ptrout, Leila's pointer demo). */
  program?: string;
  log?: (m: string) => void;
  breathe?: () => Promise<void>;
}

export interface LiveTabResult {
  frame: FrameNode;
  view: FrameNode;
  /** The `mag/<prefix>` frames holding the CPU's blocks as gates. */
  windows: FrameNode[];
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

  // ---- the CPU's blocks drawn as gates, beside the live frame (the view's windows instance them)
  const fonts = await loadLiveFonts(api);
  await loadFonts(api);
  const ctx = { api, fonts };
  const at = { x: frame.x, y: frame.y + frame.height + 400 };
  log("drawing the register file, ALU, bus mux, IR and control unit as gates…");
  const before = new Set(page.children.map((n) => n.id));
  const drawn = await drawLibrary(
    cpuLibrary(),
    { gates: page, cells: page, cpu: page },
    { only: [...new Set(BLOCKS.map((b) => b.cell))], gateLabels: false },
  );
  const libNodes = page.children.filter((n) => !before.has(n.id));
  let lx = at.x;
  let ly = at.y;
  let rowH = 0;
  for (const n of libNodes) {
    if (lx > at.x + 12000) {
      lx = at.x;
      ly += rowH + 200;
      rowH = 0;
    }
    n.x = lx;
    n.y = ly;
    lx += n.width + 120;
    rowH = Math.max(rowH, n.height);
    keep(n);
  }
  remember();
  // Leila's brighter highlights: at a window's scale, a lit gate's 22 % amber is too faint to see.
  for (const g of drawn.gates.values()) {
    if (before.has(g.id)) continue;
    const l = g.children.find((c) => c.name === "lit") as (SceneNode & MinimalFillsMixin & MinimalStrokesMixin) | null;
    if (!l) continue;
    try {
      l.fills = [{ type: "SOLID", color: { r: 1, g: 0.86, b: 0.2 }, opacity: 0.85 }];
      l.strokes = [{ type: "SOLID", color: { r: 1, g: 0.92, b: 0.35 } }];
      l.strokeWeight = 4;
    } catch {
      /* cosmetic */
    }
  }
  const cellOf = (name: string) =>
    drawn.cells.get(name) ??
    (page.children.find((n) => n.type === "COMPONENT" && n.name === `cell/${name}`) as ComponentNode | undefined) ??
    null;
  await breathe();

  // ---- overlays: Run (one per chunk) and a program load (one per hop), full size and see-through
  const W = frame.width;
  const H = frame.height;
  const overlay = (name: string, label: string, stop: boolean, i: number) => {
    const f = keep(api.createFrame());
    page.appendChild(f);
    f.name = `${PREFIX}${name}`;
    f.resize(W, H);
    f.x = at.x + (i % 4) * (W + 80);
    f.y = ly + rowH + 400 + Math.floor(i / 4) * (H + 80);
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

  // ---- the view inside the live frame, laid out like Leila's Live view: the controls, the programs
  // and the CPU's own blocks drawn as gates, every gate lit while its output is 1. Over the canvas and
  // the right panel while the CPU tab shows; the rail and the Layers panel stay as they are.
  const x0 = canvas.x;
  const y0 = canvas.y;
  const vw = right.x + right.width - x0;
  const vh = frame.height - y0;
  const root = keep(box(ctx, app, `${PREFIX}tab`, x0, y0, vw, vh, { clip: true }));
  bindVisible(root, tabVar);
  const view = box(ctx, root, `${PREFIX}view`, 0, 0, vw, vh, { fill: L.bg, clip: true });
  bindVisible(view, cv("view/show"));
  await react(view, "view", blockAll());
  const M = 10;
  // A slim bar: the clock's buttons and counters and the programs. Everything below it is gates.
  text(ctx, view, "Leila's CPU · every gate lights while its output is 1", M + 4, 12, { size: 13, font: "semibold", name: "title" });
  const button = (parent: FrameNode, name: string, label: string, x: number, y: number, w: number, fill: string) => {
    const b = box(ctx, parent, name, x, y, w, 26, { fill, radius: 6 });
    text(ctx, b, label, 0, 0, { size: 11, font: "semibold", w, h: 26, align: "CENTER", valign: "CENTER", name: "label" });
    return b;
  };
  const BY = 40;
  const bx = M + 4;
  const steps = chunks.map(() => button(view, CTL_STEP, "Step", bx, BY, 60, "#2F6FED"));
  const runButtons = chunks.map(() => button(view, CTL_RUN, "Run", bx + 66, BY, 60, "#14AE5C"));
  const stop = button(view, CTL_STOP, "Stop", bx + 132, BY, 60, "#E5484D");
  const resets = disks.map(() => button(view, CTL_RESET, "Reset", bx + 198, BY, 60, "#4A4A4A"));
  steps.forEach((b, k) => bindVisible(b, phaseIs(k)));
  runButtons.forEach((b, k) => bindVisible(b, phaseIs(k)));
  resets.forEach((b, e) => bindVisible(b, cv(`ctl/diskIs/${e}`)));
  for (const [k, b] of steps.entries()) await react(b, `Step ${k + 1}`, tapActs(chunkEvent(k)));
  for (const [k, b] of runButtons.entries())
    await react(b, `Run ${k + 1}`, tapActs([set(running, true), navigateWith(runs[k].f.id, "OVERLAY")]));
  await react(stop, "Stop", tapActs([set(running, false)]));
  for (const [e, b] of resets.entries()) await react(b, `Reset (${disks[e].name})`, tapActs(loadClick(e)));
  text(ctx, view, `phase (of ${K})`, bx + 270, BY - 4, { size: 9, color: L.text3 });
  text(ctx, view, "0", bx + 270, BY + 8, { size: 16, font: "bold", name: "var/ctl/phaseText" });
  text(ctx, view, "ticks", bx + 340, BY - 4, { size: 9, color: L.text3 });
  text(ctx, view, "0", bx + 340, BY + 8, { size: 16, font: "bold", color: L.drive, name: "var/ctl/tickText" });
  // the programs: one chip each (a load in Present), the loaded one marked
  const px0 = bx + 410;
  const chipW = 58;
  const perRow = Math.max(1, Math.floor((vw - M - px0 + 4) / (chipW + 4)));
  for (const [e, d] of disks.entries()) {
    const chip = box(ctx, view, diskName(d.name), px0 + (e % perRow) * (chipW + 4), 36 + Math.floor(e / perRow) * 22, chipW, 19, { fill: L.block, radius: 5 });
    const on = rect(ctx, chip, "on", 0, 0, chipW, 19, { fill: L.blue, fillOpacity: 0.5, radius: 5 });
    bindVisible(on, cv(`ctl/diskIs/${e}`));
    text(ctx, chip, d.name, 0, 0, { size: 9.5, font: "medium", w: chipW, h: 19, align: "CENTER", valign: "CENTER" });
    await react(chip, `program ${d.name}`, tapActs(loadClick(e)));
  }
  const TOP = Math.max(BY + 34, 36 + Math.ceil(disks.length / perRow) * 22 + 6);
  await breathe();

  // the CPU's blocks as gates, in clipped windows like Leila's zoom views
  const windows: FrameNode[] = [];
  const windowOf = (name: string, title: string, x: number, y: number, w: number, h: number, blocks: Block[]) => {
    const f = box(ctx, view, `window/${name}`, x, y, w, h, { fill: "#1E1E1E", radius: 10, stroke: "#40424D", clip: true });
    text(ctx, f, title, 10, 7, { size: 12, font: "bold", color: "#BFC4D1" });
    const slot = Math.floor((w - 8) / blocks.length);
    blocks.forEach((b, i) => {
      const main = cellOf(b.cell);
      const mag = box(ctx, f, magName(b.prefix), 4 + i * slot, 28, slot, h - 32, { clip: true });
      windows.push(mag);
      if (!main) {
        text(ctx, mag, `cell/${b.cell} is missing`, 8, 8, { size: 10, color: L.text3 });
        return;
      }
      const inst = main.createInstance();
      mag.appendChild(inst);
      const sc = Math.min((slot - 8) / main.width, (h - 40) / main.height);
      if ("rescale" in inst) inst.rescale(sc);
      else (inst as SceneNode as FrameNode).resize(main.width * sc, main.height * sc); // the fake API has no rescale
      inst.x = Math.round((slot - main.width * sc) / 2);
      inst.y = Math.round((h - 32 - main.height * sc) / 2);
    });
    return f;
  };
  const block = (prefix: string) => need(BLOCKS.find((b) => b.prefix === prefix), `block ${prefix}`);
  const gw = vw - 2 * M;
  const gh = vh - TOP - M;
  const rowA = Math.round((gh - M) * 0.56);
  const rowB = gh - M - rowA;
  const cols = (fr: number[]) => {
    const w = gw - (fr.length - 1) * M;
    const out: number[] = [];
    let x = M;
    for (const f of fr) {
      out.push(x);
      x += Math.round(w * f) + M;
    }
    return { xs: out, ws: fr.map((f, i) => (i === fr.length - 1 ? M + gw - out[i] : Math.round(w * f))) };
  };
  const a = cols([0.36, 0.26, 0.38]);
  windowOf("registers", "Register file R0–R3 + read mux", a.xs[0], TOP, a.ws[0], rowA, [block("regs")]);
  windowOf("control", "Control unit (opcode decoder)", a.xs[1], TOP, a.ws[1], rowA, [block("ctrl")]);
  windowOf("bus", "Bus mux + IR", a.xs[2], TOP, a.ws[2], rowA, [block("busmux"), block("ir")]);
  const b2 = cols([0.44, 0.3, 0.26]);
  windowOf("alu", "ALU · adder/subtract, AND/OR/XOR, result mux", b2.xs[0], TOP + rowA + M, b2.ws[0], rowB, [block("alu")]);
  windowOf("memory", "MAR + MDR · the pointer's way to memory", b2.xs[1], TOP + rowA + M, b2.ws[1], rowB, [block("mar"), block("mdr")]);
  windowOf("sequencer", "PC + T-state", b2.xs[2], TOP + rowA + M, b2.ws[2], rowB, [block("pc"), block("tstate")]);
  const report = bindDashboard(view, net, varByNet, { ctl });
  log(`bound ${report.bound} lights${report.unbound.length ? `, ${report.unbound.length} without a variable` : ""}`);
  if (report.missingVars.length) log(`texts without a variable: ${report.missingVars.join(", ")}`);
  await breathe();

  const toggle = (parent: FrameNode, name: string, label: string, x: number, y: number) => {
    const b = box(ctx, parent, `${PREFIX}${name}`, 0, y, 10, 28, { fill: L.chrome, radius: 6, stroke: L.line2 });
    const t = text(ctx, b, label, 12, 0, { size: 12, font: "medium", h: 28, valign: "CENTER" });
    b.resize(Math.ceil(t.width) + 24, 28);
    b.x = x - b.width;
    return b;
  };
  const toOs = toggle(view, "show OS chip", "OS chip ›", vw - 16, 8);
  await react(toOs, "OS chip", tapActs([set(cv("view/show"), false), set(cv("view/hide"), true)]));
  // Top right of the canvas, beside the OS chip page's column (the viewer may cut the frame's bottom off).
  const back = toggle(root, "show Leila CPU", "‹ Leila's CPU", canvas.width - 16, 8);
  bindVisible(back, cv("view/hide"));
  await react(back, "Leila's CPU", tapActs([set(cv("view/show"), true), set(cv("view/hide"), false)]));
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
    windows,
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
