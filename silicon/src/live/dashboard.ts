// The Live dashboard (LIVE.md §2, lane L1): one component, `Live · Dashboard` (1920 × 1200),
// that shows every layer of the machine at once and is lit entirely by variable bindings:
//
//   ┌ top bar: FigmaCPU · Live — Step Run Stop Reset — tick, phase, running ───────────────┐
//   │ disks      │ datapath: PC MAR RAM MDR IR CONTROL ‖ bus ‖ R0–R3 A ALU Y FLAGS OUT  │ clock pad │
//   │ (programs) │                                                                     │ 7-segment │
//   │ listing    │ microcode grid: 16 opcodes × T0–T7 (row = opcode in IR, col = T)    │ RAM 64×8  │
//   │ about      │ magnifiers: real cell instances bound to one copy inside the CPU   │ legend    │
//   └────────────┴─────────────────────────────────────────────────────────────────────┴───────────┘
//
// buildDashboard draws it (no bindings); bindDashboard binds every lit layer by name
// (names.ts) to an existing variable. Lane L2 (src/prototype/live.ts) instances the component
// into its Present-mode frames and attaches reactions to ctl/step … ctl/pad/<i>, disk/<name>.
import { PROGRAMS, RAM_BYTES } from "../isa";
import type { FlatNetlist } from "../netlist/types";
import { bindVisible } from "../prototype/draw";
import { DATAPATH_H, DATAPATH_W, drawDatapath } from "./datapath";
import { drawMicrocode } from "./grid";
import { collectPrefixed, DEFAULT_MAGNIFIERS, drawMagnifier, type MagnifierResult, type MagnifierSpec } from "./magnifier";
import {
  CTL_RESET,
  CTL_RUN,
  CTL_STEP,
  CTL_STOP,
  DASHBOARD_NAME,
  isLiveNode,
  LISTING,
  NET_KINDS,
  type NetKind,
  PAD_CELL_NAME,
  parseBound,
  parseMag,
  parseVar,
  PROGRAM_NAME,
  varBound,
} from "./names";
import { drawDisks, drawListing, drawPad, drawRamMatrix, drawSevenSeg, listingText } from "./panels";
import { type Ctx, frame, header, L, loadLiveFonts, rect, text, vector } from "./style";
import { button, lamp, lampRow, bitsMsbFirst } from "./widgets";

export const DASHBOARD_W = 1920;
export const DASHBOARD_H = 1200;
const TOPBAR = 48;
const SIDE_L = 256;
const SIDE_R = 296;

export interface DashboardOptions {
  /** Top-left corner on the page. Default: where the previous dashboard was, else right of everything on the page. */
  at?: { x: number; y: number };
  /** Programs that get a disk (default PROGRAMS); a `custom` slot is always added. */
  programs?: Record<string, string>;
  /** Program shown in the listing (default: programs.mul, else the first). */
  source?: string;
  programName?: string;
  magnifiers?: MagnifierSpec[];
  /** Pages searched for the `cell/<NAME>` components the magnifiers instance (default: [page]). Must be loaded. */
  cellPages?: PageNode[];
  /** Clock pad grid (default 6 × 3 = 18 cells: each cell's reaction holds the whole chunk dispatcher). */
  padCols?: number;
  padRows?: number;
  log?: (msg: string) => void;
}

export interface DashboardNodes {
  step: FrameNode;
  run: FrameNode;
  stop: FrameNode;
  reset: FrameNode;
  pad: FrameNode;
  /** Instances of `padCell`, named ctl/pad/<i>. */
  padCells: Array<FrameNode | InstanceNode>;
  /** `Live · Pad cell`: the component every pad cell is an instance of (pass it to wireLive as `padCell`). */
  padCell: ComponentNode;
  /** By program name (+ "custom"); each frame is named disk/<name>. */
  disks: Map<string, FrameNode>;
  listing: TextNode;
  program: TextNode;
  tickText: TextNode;
  phaseText: TextNode;
  running: FrameNode;
  loading: FrameNode;
  magnifiers: MagnifierResult[];
}

export interface DashboardStats {
  w: number;
  h: number;
  /** Layers inside the component (instances' sublayers included). */
  layers: number;
  /** Net-bound containers by kind (lamp, seg, arrow, row, col, tag). */
  containers: Record<NetKind, number>;
  padCells: number;
  disks: number;
  magnifiers: Array<{ cell: string; prefix: string; found: boolean; scale: number; layers: number }>;
  /** Magnifier cells with no component on the searched pages. */
  missingCells: string[];
}

export interface Dashboard {
  component: ComponentNode;
  nodes: DashboardNodes;
  stats: DashboardStats;
}

/** The dashboard component on `page` (top level), if any. */
export function findDashboard(page: PageNode): ComponentNode | null {
  return (page.children.find((n) => n.type === "COMPONENT" && n.name === DASHBOARD_NAME) as ComponentNode | undefined) ?? null;
}

const PAD_CELL = 38;

/** The pad cell component (one reaction for every cell of the pad). */
function drawPadCell(ctx: Ctx, page: PageNode, x: number, y: number): ComponentNode {
  const c = ctx.api.createComponent();
  page.appendChild(c);
  c.name = PAD_CELL_NAME;
  c.resize(PAD_CELL, PAD_CELL);
  c.x = x;
  c.y = y;
  c.cornerRadius = 8;
  c.fills = [{ type: "SOLID", color: { r: 0x3a / 255, g: 0x3a / 255, b: 0x3a / 255 } }];
  c.description = "One cell of the Live clock pad: entering it with the mouse runs one chunk of the CPU's tick (lane L2 stores that reaction here once).";
  rect(ctx, c, "dot", PAD_CELL / 2 - 2, PAD_CELL / 2 - 2, 4, 4, { fill: "#FFFFFF", fillOpacity: 0.12, radius: 2 });
  return c;
}

/** Right of everything on the page that is not part of the Live view, top-aligned. */
export function freeSpot(page: PageNode, gap = 800): { x: number; y: number } {
  const others = page.children.filter((n) => !isLiveNode(n));
  if (!others.length) return { x: 0, y: 0 };
  return {
    x: Math.round(Math.max(...others.map((n) => n.x + n.width)) + gap),
    y: Math.round(Math.min(...others.map((n) => n.y))),
  };
}

/** A `cell/<name>` main component on one of `pages` (top level first, then nested). */
export function findCellComponent(pages: PageNode[], name: string): ComponentNode | null {
  const full = `cell/${name}`;
  for (const p of pages) {
    const top = p.children.find((n): n is ComponentNode => n.type === "COMPONENT" && n.name === full);
    if (top) return top;
  }
  for (const p of pages) {
    const deep = p.findAllWithCriteria({ types: ["COMPONENT"] }).find((n) => n.name === full);
    if (deep) return deep as ComponentNode;
  }
  return null;
}

/** Draws the dashboard component on `page`, replacing an existing `Live · Dashboard` there
 * (nothing else on the page is touched). Bindings: see bindDashboard. */
export async function buildDashboard(api: PluginAPI, page: PageNode, net: FlatNetlist, opts: DashboardOptions = {}): Promise<Dashboard> {
  const log = opts.log ?? (() => {});
  await page.loadAsync();
  await api.setCurrentPageAsync(page);
  const fonts = await loadLiveFonts(api);
  const ctx: Ctx = { api, fonts };
  const programs = opts.programs ?? PROGRAMS;
  const source = opts.source ?? programs.mul ?? Object.values(programs)[0] ?? "";
  const programName = opts.programName ?? (Object.keys(programs).find((k) => programs[k] === source) ?? "custom");

  const old = findDashboard(page);
  const at = opts.at ?? (old ? { x: old.x, y: old.y } : freeSpot(page));
  if (old) {
    old.remove();
    log(`replaced the old ${DASHBOARD_NAME}`);
  }
  for (const n of [...page.children]) if (n.type === "COMPONENT" && n.name === PAD_CELL_NAME) n.remove();
  // The pad cell component sits just above the dashboard's top-left corner.
  const padCell = drawPadCell(ctx, page, at.x, at.y - PAD_CELL - 40);

  const comp = api.createComponent();
  page.appendChild(comp);
  comp.name = DASHBOARD_NAME;
  comp.resize(DASHBOARD_W, DASHBOARD_H);
  comp.x = at.x;
  comp.y = at.y;
  comp.fills = [{ type: "SOLID", color: { r: 0x1e / 255, g: 0x1e / 255, b: 0x1e / 255 } }];
  comp.clipsContent = true;
  comp.description =
    "FigmaCPU Live: the gate-level CPU at every layer — program, microcode, datapath, gates — lit by variable bindings only. " +
    "Built by the plugin (Live view); lane L2 wires ctl/step, ctl/run, ctl/stop, ctl/reset, ctl/pad/<i> and disk/<program>.";

  // ---- chrome: top bar and the two side panels
  rect(ctx, comp, "chrome/top", 0, 0, DASHBOARD_W, TOPBAR, { fill: L.chrome });
  rect(ctx, comp, "chrome/top/edge", 0, TOPBAR - 1, DASHBOARD_W, 1, { fill: L.line });
  rect(ctx, comp, "chrome/left", 0, TOPBAR, SIDE_L, DASHBOARD_H - TOPBAR, { fill: L.chrome });
  rect(ctx, comp, "chrome/left/edge", SIDE_L - 1, TOPBAR, 1, DASHBOARD_H - TOPBAR, { fill: L.line });
  const rx = DASHBOARD_W - SIDE_R;
  rect(ctx, comp, "chrome/right", rx, TOPBAR, SIDE_R, DASHBOARD_H - TOPBAR, { fill: L.chrome });
  rect(ctx, comp, "chrome/right/edge", rx, TOPBAR, 1, DASHBOARD_H - TOPBAR, { fill: L.line });

  // Title.
  const chip = frame(ctx, comp, "logo", 16, 12, 24, 24, { fill: null, radius: 6, stroke: L.text2, strokeWeight: 1.5 });
  rect(ctx, chip, "core", 7, 7, 10, 10, { fill: L.blue, radius: 2 });
  text(ctx, comp, "FigmaCPU", 50, 15, { size: 14, font: "bold", name: "title" });
  text(ctx, comp, "Live", 128, 15, { size: 14, color: L.text2, name: "title/live" });
  const pill = frame(ctx, comp, "chip/stats", 172, 13, 392, 22, { fill: L.cell, radius: 11 });
  text(ctx, pill, `${thousands(net.gates.length)} gates · ${thousands(net.netNames.length - 2)} wires · computed by Figma's prototype engine`, 0, 0, {
    size: 9.5,
    font: "mono",
    color: L.text2,
    w: 392,
    h: 22,
    align: "CENTER",
    valign: "CENTER",
    name: "label",
  });

  // Controls (lane L2 attaches the reactions).
  const bw = 92;
  const bx = Math.round(DASHBOARD_W / 2 - (4 * bw + 3 * 8) / 2);
  const step = button(ctx, comp, CTL_STEP, "Step", bx, 8, bw, 32, L.blue);
  const run = button(ctx, comp, CTL_RUN, "Run", bx + (bw + 8), 8, bw, 32, "#14AE5C");
  const stop = button(ctx, comp, CTL_STOP, "Stop", bx + 2 * (bw + 8), 8, bw, 32, "#F24822");
  const reset = button(ctx, comp, CTL_RESET, "Reset", bx + 3 * (bw + 8), 8, bw, 32, L.cell, { outline: true });
  // Icons on the buttons (cosmetic vectors).
  vector(ctx, step, "icon", [[[22, 10], [22, 22]]], [[[12, 10], [20, 16], [12, 22]]], "#FFFFFF", 2);
  vector(ctx, run, "icon", [], [[[14, 10], [23, 16], [14, 22]]], "#FFFFFF", 1);
  rect(ctx, stop, "icon", 13, 11, 10, 10, { fill: "#FFFFFF", radius: 2 });
  for (const b of [step, run, stop]) {
    const label = b.children.find((c) => c.name === "label") as TextNode | undefined;
    if (label) {
      label.x = 16;
      label.resize(bw - 20, 32);
    }
  }

  // Readouts: tick and phase as STRING variables (ctl/tickText, ctl/phaseText), running as a BOOLEAN.
  const ro = DASHBOARD_W - 380;
  text(ctx, comp, "TICK", ro, 8, { size: 8.5, font: "semibold", color: L.text3, tracking: 8, name: "label/tick" });
  const tickText = text(ctx, comp, "0", ro, 20, { size: 17, font: "monoBold", color: L.drive, name: varBound("ctl/tickText") });
  text(ctx, comp, "PHASE", ro + 100, 8, { size: 8.5, font: "semibold", color: L.text3, tracking: 8, name: "label/phase" });
  const phaseText = text(ctx, comp, "0", ro + 100, 20, { size: 17, font: "monoBold", color: L.text, name: varBound("ctl/phaseText") });
  const running = frame(ctx, comp, varBound("ctl/running"), DASHBOARD_W - 156, 12, 140, 24, { fill: null, radius: 12, stroke: L.line2 });
  text(ctx, running, "●  stopped", 0, 0, { size: 10, font: "semibold", color: L.text3, w: 140, h: 24, align: "CENTER", valign: "CENTER", name: "label" });
  const runLit = frame(ctx, running, "lit", 0, 0, 140, 24, { fill: "#14AE5C", fillOpacity: 0.22, radius: 12, stroke: "#14AE5C" });
  text(ctx, runLit, "●  RUNNING", 0, 0, { size: 10, font: "bold", color: "#3DDC84", w: 140, h: 24, align: "CENTER", valign: "CENTER", name: "label" });
  runLit.visible = false;
  // While a disk loads (lane L2's ctl/loading), a banner over the disks.

  // ---- left panel: disks, listing, about
  const lx = 16;
  const lw = SIDE_L - 32;
  header(ctx, comp, "Disks", lx, 64);
  text(ctx, comp, "click one to load it, in Present mode", lx + 52, 64, { size: 9, color: L.text3, name: "hint/disks" });
  const disks = drawDisks(ctx, comp, lx, 84, lw, programs, 32, 4, 2);
  const loading = frame(ctx, comp, varBound("ctl/loading"), lx, 58, lw, 22, { fill: null });
  const loadLit = frame(ctx, loading, "lit", 0, 0, lw, 22, { fill: L.mem, radius: 11 });
  text(ctx, loadLit, "loading disk…  (one chunk per hop)", 0, 0, { size: 10, font: "semibold", color: "#FFFFFF", w: lw, h: 22, align: "CENTER", valign: "CENTER", name: "label" });
  loadLit.visible = false;
  const listY = 84 + Math.ceil(disks.size / 2) * 36 + 18;
  header(ctx, comp, "Listing", lx, listY);
  const { listing, program } = drawListing(ctx, comp, lx, listY + 20, lw, programName, source, DASHBOARD_H - 204 - (listY + 42));
  header(ctx, comp, "How it works", lx, DASHBOARD_H - 196);
  text(
    ctx,
    comp,
    `Every wire of the CPU is a BOOLEAN variable (${thousands(net.netNames.length - 2)} of them) and every one of its ${thousands(net.gates.length)} gates is a SET_VARIABLE action, run by Figma's prototype engine on each Step. ` +
      "Everything on this page is a visibility binding to those variables: it adds no gate and no action.",
    lx,
    DASHBOARD_H - 176,
    { size: 10, color: L.text3, w: lw, lineHeight: 15, name: "about" },
  );

  // ---- right panel: clock pad, output, memory, legend
  const px = rx + 16;
  const pw = SIDE_R - 32;
  header(ctx, comp, "Clock pad", px, 64);
  text(ctx, comp, "sweep the mouse across the pad: every cell you enter runs one chunk of the tick", px, 80, { size: 9.5, color: L.text3, w: pw, lineHeight: 13, name: "hint/pad" });
  const cols = opts.padCols ?? 6;
  const rows = opts.padRows ?? 3;
  const gapP = Math.max(2, Math.floor((pw - 12 - cols * PAD_CELL) / Math.max(1, cols - 1)));
  const { pad, cells: padCells } = drawPad(ctx, comp, px, 112, cols, rows, PAD_CELL, gapP, padCell);
  const outY = 112 + pad.height + 20;
  header(ctx, comp, "Output", px, outY);
  drawSevenSeg(ctx, comp, px, outY + 20, pw, 128);
  text(ctx, comp, "OUT", px, outY + 160, { size: 9, font: "monoBold", color: L.text2, name: "label/out" });
  lampRow(ctx, comp, bitsMsbFirst("OUT", 8), px + 32, outY + 158, 13, 17, L.out);
  text(ctx, comp, "HALT", px + 32 + 8 * 17 + 14, outY + 160, { size: 9, font: "monoBold", color: L.text2, name: "label/halt" });
  lamp(ctx, comp, "halted", px + 32 + 8 * 17 + 48, outY + 158, 13, L.out);
  const memY = outY + 196;
  header(ctx, comp, "Memory", px, memY);
  text(ctx, comp, `${RAM_BYTES} bytes · code and data share it`, px + 70, memY, { size: 9, color: L.text3, name: "hint/memory" });
  const mem = drawRamMatrix(ctx, comp, px, memY + 20, pw, 10, 12, 2);
  const legY = memY + 20 + mem.height + 16;
  header(ctx, comp, "Highlights", px, legY);
  const legend: Array<[string, string]> = [
    [L.blue, "microcode: row = opcode in IR, column = T-state; the cell where they cross is executing"],
    [L.mem, "memory: the row MAR addresses; it flashes on a read (blue) or a write (red)"],
    [L.alu, "▸ the byte PC points to"],
    [L.ptr, "datapath: pointer → MAR, PTR on the register used as the address"],
  ];
  let ly = legY + 20;
  for (const [c, s] of legend) {
    rect(ctx, comp, "legend/swatch", px, ly + 2, 10, 10, { fill: c, fillOpacity: 0.5, radius: 2, stroke: c });
    const t = text(ctx, comp, s, px + 18, ly, { size: 9.5, color: L.text3, w: pw - 18, lineHeight: 13, name: "legend/text" });
    ly += Math.max(18, t.height + 6);
  }
  header(ctx, comp, "Controls", px, DASHBOARD_H - 150);
  text(
    ctx,
    comp,
    "Step runs one chunk of a tick (a tick is several chunks: the viewer allows ~400 actions per event). Run loops by itself. " +
      "The pad clocks at mouse speed. Reset reloads the current disk; a disk loads its program in a few hops.",
    px,
    DASHBOARD_H - 130,
    { size: 9.5, color: L.text3, w: pw, lineHeight: 14, name: "hint/controls" },
  );

  // ---- center: datapath, microcode, magnifiers
  const cx = SIDE_L + 16;
  const cw = DASHBOARD_W - SIDE_L - SIDE_R - 32;
  drawDatapath(ctx, comp, cx, TOPBAR + 16, Math.max(cw, DATAPATH_W), DATAPATH_H);
  const mc = drawMicrocode(ctx, comp, cx, TOPBAR + 16 + DATAPATH_H + 16, cw, 18);
  const magY = mc.y + mc.height + 16;
  const magH = DASHBOARD_H - 16 - magY;
  const specs = opts.magnifiers ?? DEFAULT_MAGNIFIERS;
  const cellPages = opts.cellPages ?? [page];
  const mains = specs.map((s) => findCellComponent(cellPages, s.cell));
  const magCard = frame(ctx, comp, "magnifiers", cx, magY, cw, magH, { fill: L.card, radius: 12, stroke: L.line });
  text(ctx, magCard, "Magnifiers", 16, 12, { size: 13, font: "bold", name: "title" });
  text(ctx, magCard, "instances of the real cell components from the canvas, each bound to one copy inside the CPU: its gates glow with the CPU's own wires", 112, 15, {
    size: 10,
    color: L.text3,
    name: "subtitle",
  });
  const gapM = 16;
  const avail = cw - 32 - gapM * (specs.length - 1);
  const weights = mains.map((m) => Math.pow(m ? m.width : 500, 0.7));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  let mx = 16;
  const magnifiers: MagnifierResult[] = [];
  specs.forEach((s, i) => {
    const w = Math.floor((avail * weights[i]) / wsum);
    magnifiers.push(drawMagnifier(ctx, magCard, s, mains[i], net, mx, 38, w, magH - 38 - 14));
    mx += w + gapM;
  });
  const missingCells = specs.filter((_, i) => !mains[i]).map((s) => `cell/${s.cell}`);
  if (missingCells.length) log(`magnifiers: ${missingCells.join(", ")} not found (Build hardware first)`);

  // ---- stats
  const containers = Object.fromEntries(NET_KINDS.map((k) => [k, 0])) as Record<NetKind, number>;
  const all = comp.findAll();
  for (const n of all) {
    const b = parseBound(n.name);
    if (b && "children" in n && n.children.some((c) => c.name === "lit")) containers[b.kind]++;
  }
  const stats: DashboardStats = {
    w: DASHBOARD_W,
    h: DASHBOARD_H,
    layers: all.length,
    containers,
    padCells: padCells.length,
    disks: disks.size,
    magnifiers: magnifiers.map((m, i) => ({
      cell: specs[i].cell,
      prefix: specs[i].prefix,
      found: !!m.instance,
      scale: Math.round(m.scale * 1000) / 1000,
      layers: m.instance ? m.instance.findAll().length + 1 : 0,
    })),
    missingCells,
  };
  log(`${DASHBOARD_NAME}: ${stats.layers} layers, ${Object.values(containers).reduce((a, b) => a + b, 0)} lit containers, ${magnifiers.filter((m) => m.instance).length} magnifier(s)`);
  return {
    component: comp,
    nodes: { step, run, stop, reset, pad, padCells, padCell, disks, listing, program, tickText, phaseText, running, loading, magnifiers },
    stats,
  };
}

/** 2285 → "2,285" (no Intl in Figma's plugin sandbox). */
function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ---------- bindings ----------

export interface BindReport {
  /** Layers bound to a net variable. */
  bound: number;
  /** Layers fixed because their net is a constant (0 / 1). */
  constant: number;
  /** Net names (canonical) with no variable in `varByNet`. Empty when compiled. */
  unbound: string[];
  /** Layer names whose net is not in the netlist (a typo or a different CPU). */
  unknown: string[];
  byKind: Record<NetKind | "gate" | "wire" | "var", number>;
  /** Text layers bound to STRING control variables. */
  texts: number;
  /** Control variables named by `var/…` layers that were not given (or have the wrong type). */
  missingVars: string[];
  magnifiers: Array<{ prefix: string; gates: number; wires: number; missing: string[]; stray: string[] }>;
}

export interface BindOptions {
  /** Control variables by name (ctl/tickText, ctl/phaseText, ctl/running, …) for `var/…` layers. */
  ctl?: Map<string, Variable>;
  /** Only the `var/…` layers (e.g. again after wireLive created ctl/program, ctl/listing, ctl/loading). */
  varsOnly?: boolean;
}

/** Binds every lit layer of the dashboard (`root`: the component, or a copy of it) to the
 * variable of its net: `<kind>/<net>` containers, the gates and wires of each `mag/<prefix>`
 * instance, and `var/<name>` layers to control variables (STRING → text, BOOLEAN → visibility).
 * Only visibility and text bindings to existing variables; nothing is created. */
export function bindDashboard(root: BaseNode & ChildrenMixin, net: FlatNetlist, varByNet: Map<number, Variable>, opts: BindOptions = {}): BindReport {
  const report: BindReport = {
    bound: 0,
    constant: 0,
    unbound: [],
    unknown: [],
    byKind: { lamp: 0, seg: 0, arrow: 0, row: 0, col: 0, tag: 0, gate: 0, wire: 0, var: 0 },
    texts: 0,
    missingVars: [],
    magnifiers: [],
  };
  const unbound = new Set<string>();
  const bindNet = (node: SceneNode, id: number, kind: keyof BindReport["byKind"]): void => {
    if (id <= 1) {
      bindVisible(node, id === 1);
      report.constant++;
      return;
    }
    const v = varByNet.get(id);
    if (!v) {
      unbound.add(net.netNames[id]);
      return;
    }
    bindVisible(node, v);
    report.bound++;
    report.byKind[kind]++;
  };
  const bindInstance = (inst: InstanceNode, prefix: string) => {
    const b = collectPrefixed(inst, net, prefix);
    for (const [gi, node] of b.gateLit) bindNet(node, net.gates[gi].out, "gate");
    let wires = 0;
    for (const [id, nodes] of b.wireLit)
      for (const node of nodes) {
        bindNet(node, id, "wire");
        wires++;
      }
    report.magnifiers.push({ prefix, gates: b.gateLit.size, wires, missing: b.missing, stray: b.stray });
  };
  const walk = (node: BaseNode & ChildrenMixin, mag: string | null) => {
    for (const c of node.children) {
      if (c.type === "INSTANCE") {
        if (mag && !opts.varsOnly) bindInstance(c, mag);
        continue;
      }
      const b = parseBound(c.name);
      if (b && "children" in c) {
        if (opts.varsOnly) continue;
        const lit = c.children.find((x) => x.name === "lit");
        if (!lit) continue;
        const id = net.aliases.get(b.net);
        if (id === undefined) report.unknown.push(c.name);
        else bindNet(lit, id, b.kind);
        walk(c, mag); // containers nested inside (an AND of nets, widgets.gated)
        continue;
      }
      const vn = parseVar(c.name);
      if (vn !== null) {
        const v = opts.ctl?.get(vn);
        if (c.type === "TEXT") {
          if (v && v.resolvedType === "STRING") {
            c.setBoundVariable("characters", v);
            report.texts++;
            report.byKind.var++;
          } else report.missingVars.push(vn);
        } else if ("children" in c) {
          const lit = c.children.find((x) => x.name === "lit");
          if (lit && v && v.resolvedType === "BOOLEAN") {
            bindVisible(lit, v);
            report.bound++;
            report.byKind.var++;
          } else if (lit) report.missingVars.push(vn);
        }
        continue;
      }
      const m = parseMag(c.name);
      if ("children" in c) walk(c, m ?? mag);
    }
  };
  walk(root, null);
  report.unbound = [...unbound];
  return report;
}

/** Rewrites the program name and listing (after a program is loaded by the plugin). */
export async function setListing(api: PluginAPI, root: BaseNode & ChildrenMixin, source: string, name?: string): Promise<void> {
  const fonts = await loadLiveFonts(api);
  void fonts;
  const find = (n: string) => (root as ChildrenMixin).findOne((x) => x.name === n && x.type === "TEXT") as TextNode | null;
  const listing = find(LISTING);
  const program = find(PROGRAM_NAME);
  if (listing) listing.characters = listingText(source);
  if (program && name) program.characters = name;
}
