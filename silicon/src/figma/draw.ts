// Draws a module library as Figma main components: one `cell/<NAME>` per ModuleDef, children
// before parents. Each component carries its ports as TEXT properties (value = the nets of
// the parent scope, LSB first) and port markers on its edges; children are instances named
// after InstanceDef.name with their connections in those properties. Wires are decoration
// for people (`wire/<net>` + hidden `wire/<net>/lit`); extraction never looks at them.
import { type GateType, gateTypeOf, isGateCell, type Library, type ModuleDef, type PortDef, portBits } from "../netlist/types";
import { bitOffset, type CellGeom, layoutModule, type ModuleLayout, moduleGeom, NAME_SIZE, NET_SIZE, type PlacedPort, type Point, STUB, type Wire } from "./layout";
import {
  CELL_PREFIX,
  cellComponentName,
  formatNets,
  PAGE_CELLS,
  PAGE_CPU,
  PAGE_GATES,
  portMarkerName,
  propName,
  wireLitName,
  wireName,
} from "./names";
import { addText, C, loadFonts, solid, textWidth } from "./style";
import { drawGates, gateGeom } from "./symbols";

export interface SiliconPages {
  gates: PageNode;
  cells: PageNode;
  cpu: PageNode;
}

/** Finds the three silicon pages, creating any that are missing. */
export function ensurePages(): SiliconPages {
  const get = (name: string) => {
    const found = figma.root.children.find((p) => p.name === name);
    if (found) return found;
    const p = figma.createPage();
    p.name = name;
    return p;
  };
  return { gates: get(PAGE_GATES), cells: get(PAGE_CELLS), cpu: get(PAGE_CPU) };
}

/** The silicon pages that exist (for extract), in Gates, Cells, CPU order. */
export function siliconPages(): PageNode[] {
  return [PAGE_GATES, PAGE_CELLS, PAGE_CPU]
    .map((n) => figma.root.children.find((p) => p.name === n))
    .filter((p): p is PageNode => !!p);
}

/** Module names in dependency order (children first), starting from `roots` (default: all,
 * in library order). Throws on unknown cells and recursive modules. */
export function dependencyOrder(lib: Library, roots: Iterable<string> = lib.keys()): string[] {
  const out: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (name: string, from: string) => {
    if (isGateCell(name)) return;
    const s = state.get(name);
    if (s === 2) return;
    if (s === 1) throw new Error(`module ${name} contains itself (via ${from})`);
    const def = lib.get(name);
    if (!def) throw new Error(`${from}: unknown cell ${name}`);
    state.set(name, 1);
    for (const i of def.instances) visit(i.cell, name);
    state.set(name, 2);
    out.push(name);
  };
  for (const r of roots) visit(r, "(root)");
  return out;
}

export interface DrawOptions {
  /** Draw only these modules and what they use. Default: the whole library. */
  only?: string[];
  /** The module that goes on the CPU page instead of the Cells page. Default "CPU". */
  cpuModule?: string;
  /** Replace existing `cell/*` components of the drawn modules (default: keep and reuse them). */
  redraw?: boolean;
  /** "auto" (default) wires small modules and labels big ones; true/false forces it. */
  wires?: "auto" | boolean;
  maxWiredInstances?: number;
  maxWiredSinks?: number;
  /** Net-name labels on gate leads (only used when the gates are first drawn). Default true. */
  gateLabels?: boolean;
  /** Called before each module is drawn. */
  onModule?: (name: string, index: number, total: number) => void;
}

export interface DrawResult {
  gates: Map<GateType, ComponentNode>;
  cells: Map<string, ComponentNode>;
  /** Layouts of the modules drawn by this call. */
  layouts: Map<string, ModuleLayout>;
  /** Modules whose existing component was kept. */
  reused: string[];
}

const ROW_LIMIT = 6000;
const GAP = 96;

/** Draws `lib` onto the silicon pages (gates first if needed). */
export async function drawLibrary(lib: Library, pages: SiliconPages, opts: DrawOptions = {}): Promise<DrawResult> {
  const gates = await drawGates(pages.gates, { labels: opts.gateLabels });
  await loadFonts();
  const order = dependencyOrder(lib, opts.only);
  const cpuName = opts.cpuModule ?? "CPU";

  const existing = new Map<string, ComponentNode>();
  for (const page of new Set([pages.cells, pages.cpu])) {
    await page.loadAsync();
    for (const n of page.children)
      if (n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX)) existing.set(n.name.slice(CELL_PREFIX.length), n);
  }
  if (opts.redraw)
    for (const name of order) {
      existing.get(name)?.remove();
      existing.delete(name);
    }

  const cells = new Map<string, ComponentNode>();
  const geoms = new Map<string, CellGeom>();
  const layouts = new Map<string, ModuleLayout>();
  const reused: string[] = [];
  const geomOf = (cell: string): CellGeom => {
    if (isGateCell(cell)) return gateGeom(gateTypeOf(cell));
    const g = geoms.get(cell);
    if (!g) throw new Error(`no geometry for ${cell}`);
    return g;
  };
  const mainOf = (cell: string): ComponentNode => {
    const m = isGateCell(cell) ? gates.get(gateTypeOf(cell)) : cells.get(cell);
    if (!m) throw new Error(`no component for ${cell}`);
    return m;
  };
  const shelves = new Map<PageNode, Shelf>();
  let current: PageNode | null = null;

  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const def = lib.get(name)!;
    const old = existing.get(name);
    if (old) {
      cells.set(name, old);
      geoms.set(name, geomFromComponent(old, def.ports));
      reused.push(name);
      continue;
    }
    opts.onModule?.(name, i, order.length);
    const page = name === cpuName ? pages.cpu : pages.cells;
    if (current !== page) {
      await figma.setCurrentPageAsync(page);
      current = page;
    }
    const layout = layoutModule(def, geomOf, {
      wires: opts.wires,
      maxWiredInstances: opts.maxWiredInstances,
      maxWiredSinks: opts.maxWiredSinks,
      titleWidth: textWidth(def.name, 12) + 40,
    });
    const comp = drawModule(def, layout, mainOf);
    page.appendChild(comp);
    let shelf = shelves.get(page);
    if (!shelf) shelves.set(page, (shelf = newShelf(page, comp)));
    place(shelf, comp);
    cells.set(name, comp);
    geoms.set(name, layout.geom);
    layouts.set(name, layout);
  }
  return { gates, cells, layouts, reused };
}

/** Convenience: find/create the pages, then draw the gates and the whole library. */
export async function draw(lib: Library, opts: DrawOptions = {}): Promise<DrawResult & { pages: SiliconPages }> {
  const pages = ensurePages();
  return { ...(await drawLibrary(lib, pages, opts)), pages };
}

// ---------- page placement: simple shelves, children before parents ----------

interface Shelf {
  x: number;
  y: number;
  rowH: number;
}

function newShelf(page: PageNode, skip: SceneNode): Shelf {
  let bottom = -Infinity;
  for (const n of page.children) if (n !== skip) bottom = Math.max(bottom, n.y + n.height);
  return { x: 0, y: bottom === -Infinity ? 0 : bottom + 2 * GAP, rowH: 0 };
}

function place(s: Shelf, n: SceneNode) {
  if (s.x > 0 && s.x + n.width > ROW_LIMIT) {
    s.x = 0;
    s.y += s.rowH + GAP;
    s.rowH = 0;
  }
  n.x = s.x;
  n.y = s.y;
  s.x += n.width + GAP;
  s.rowH = Math.max(s.rowH, n.height);
}

// ---------- one module ----------

/** TEXT property keys of a main component by port name ("D" → "D#12:3"). */
const keyCache = new WeakMap<ComponentNode, Map<string, string>>();
export function propertyKeys(main: ComponentNode): Map<string, string> {
  let m = keyCache.get(main);
  if (!m) {
    m = new Map();
    for (const [key, d] of Object.entries(main.componentPropertyDefinitions)) if (d.type === "TEXT") m.set(propName(key), key);
    keyCache.set(main, m);
  }
  return m;
}

function drawModule(def: ModuleDef, L: ModuleLayout, mainOf: (cell: string) => ComponentNode): ComponentNode {
  const comp = figma.createComponent();
  comp.name = cellComponentName(def.name);
  comp.resize(L.w, L.h);
  comp.fills = solid(C.card);
  comp.strokes = solid(C.stroke);
  comp.strokeWeight = 1;
  comp.cornerRadius = 10;
  comp.clipsContent = false;
  comp.description = def.doc ?? "";
  addText(comp, "title", def.name, 12, 10, { size: 12, font: "bold" });
  const sub = subtitle(def, L);
  if (sub) addText(comp, "subtitle", sub, 12, 28, { size: 9, color: C.dim });

  // One TEXT property per port; on the main component it holds the port's own bit names.
  const keys = new Map<string, string>();
  for (const p of def.ports) keys.set(p.name, comp.addComponentProperty(p.name, "TEXT", formatNets(portBits(p))));

  if (L.wires.length) {
    const wf = figma.createFrame();
    comp.appendChild(wf);
    wf.name = "wires";
    wf.resize(L.w, L.h);
    wf.x = 0;
    wf.y = 0;
    wf.fills = [];
    wf.clipsContent = false;
    for (const w of L.wires) drawWire(wf, w);
  }

  for (const pi of L.instances) {
    const main = mainOf(pi.def.cell);
    const inst = main.createInstance();
    comp.appendChild(inst);
    inst.name = pi.def.name;
    inst.x = pi.x;
    inst.y = pi.y;
    const props: Record<string, string> = {};
    for (const [port, key] of propertyKeys(main)) props[key] = formatNets(pi.def.conn[port] ?? []);
    inst.setProperties(props);
  }

  for (const pl of L.ports) drawPortMarker(comp, pl, keys.get(pl.def.name)!);
  return comp;
}

function subtitle(def: ModuleDef, L: ModuleLayout): string {
  const parts = [def.doc ?? "", `${def.instances.length} parts`];
  if (L.mode === "labels" && L.labeled.length) parts.push("nets by name");
  const s = parts.filter(Boolean).join(" · ");
  const max = Math.max(8, Math.floor((L.w - 24) / (9 * 0.58)));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const num = (v: number) => String(Math.round(v * 100) / 100);
const square = (p: Point, r: number) =>
  `M ${num(p.x - r)} ${num(p.y - r)} L ${num(p.x + r)} ${num(p.y - r)} L ${num(p.x + r)} ${num(p.y + r)} L ${num(p.x - r)} ${num(p.y + r)} Z`;

/** A vector made of open polylines plus small filled squares (pins, junctions), placed so
 * its path data starts at (0, 0). */
function polyVector(parent: ChildrenMixin, name: string, lines: Point[][], dots: Point[], color: string, weight: number): VectorNode {
  const all = [...lines.flat(), ...dots.flatMap((d) => [{ x: d.x - 2, y: d.y - 2 }, { x: d.x + 2, y: d.y + 2 }])];
  const x0 = Math.min(...all.map((p) => p.x));
  const y0 = Math.min(...all.map((p) => p.y));
  const rel = (p: Point) => ({ x: p.x - x0, y: p.y - y0 });
  const data = lines.map((pts) => pts.map((p, i) => `${i ? "L" : "M"} ${num(p.x - x0)} ${num(p.y - y0)}`).join(" ")).join(" ");
  const paths: VectorPath[] = [{ windingRule: "NONE", data }];
  if (dots.length) paths.push({ windingRule: "NONZERO", data: dots.map((d) => square(rel(d), 2)).join(" ") });
  const v = figma.createVector();
  parent.appendChild(v);
  v.name = name;
  v.vectorPaths = paths;
  v.x = x0;
  v.y = y0;
  v.strokes = solid(color);
  v.strokeWeight = weight;
  v.strokeJoin = "MITER";
  v.fills = solid(color);
  return v;
}

function drawWire(parent: FrameNode, w: Wire) {
  polyVector(parent, wireName(w.net), w.paths, w.junctions, C.wire, 1.5);
  const lit = polyVector(parent, wireLitName(w.net), w.paths, w.junctions, C.lit, 2);
  lit.visible = false;
}

function drawPortMarker(comp: ComponentNode, pl: PlacedPort, key: string) {
  const p = pl.def;
  const isIn = p.dir === "in";
  const f = figma.createFrame();
  comp.appendChild(f);
  f.name = portMarkerName(p);
  f.resize(pl.w, pl.h);
  f.x = pl.x;
  f.y = pl.y;
  f.fills = [];
  f.clipsContent = false;
  const x0 = isIn ? 0 : pl.w - STUB;
  const bits = portBits(p).map((_, k) => bitOffset(k));
  polyVector(
    f,
    "stub",
    bits.map((y) => [
      { x: x0, y },
      { x: x0 + STUB, y },
    ]),
    bits.map((y) => ({ x: isIn ? 0 : pl.w, y })),
    C.lead,
    1.5,
  );
  const name = addText(f, "name", p.name, 2, 3, { size: NAME_SIZE, font: "bold", color: C.dim });
  const net = addText(f, "net", formatNets(portBits(p)), 0, 4, { size: NET_SIZE, font: "mono", color: C.net });
  if (isIn) net.x = 2 + name.width + 4;
  else {
    name.x = pl.w - STUB - 4 - name.width;
    net.x = pl.w - STUB + 2;
  }
  net.componentPropertyReferences = { characters: key };
}

/** Pin geometry of an existing module component, read from its port markers (used only to
 * place instances of components drawn earlier; extraction never reads geometry). */
export function geomFromComponent(comp: ComponentNode, ports: PortDef[]): CellGeom {
  const ys = ports.map((p) => {
    const m = comp.children.find((c) => c.name === portMarkerName(p));
    if (!m) throw new Error(`${comp.name}: no port marker ${portMarkerName(p)} (redraw it)`);
    return m.y;
  });
  return moduleGeom(ports, comp.width, comp.height, ys);
}
