// Where the silicon lives in the document, and how it is laid out there.
//
// Figma's Starter plan caps a file at 3 pages (createPage throws), so by default everything
// goes on ONE page — an existing page named "Silicon", else the current page — in separate
// regions, top to bottom: the gates, the cells, then the CPU (wrapped later by the CPU · Step
// frame, with the front panel to its left and the Control / Run frames below it). Separate
// pages (Silicon · Gates / Cells / CPU) are used only when asked for and when Figma allows it.
// The choice is remembered in the document (root plugin data), so later sessions find it.
import { CELL_PREFIX, PAGE_CELLS, PAGE_CPU, PAGE_GATES, type SiliconPages } from "../../src/figma";
import { GATE_PREFIX } from "../../src/netlist/types";
import { COLORS, loadFonts, text } from "../../src/prototype/draw";

export const SINGLE_PAGE = "Silicon";
const DOC_PAGES = "silicon.pages";
const DOC_ORIGIN = "silicon.origin";
const LABEL = "silicon/label/";

export interface Where {
  pages: SiliconPages;
  /** Gates, cells and CPU share one page. */
  single: boolean;
}

export const uniquePages = (w: Where): PageNode[] => [...new Set([w.pages.gates, w.pages.cells, w.pages.cpu])];
const single = (page: PageNode): Where => ({ pages: { gates: page, cells: page, cpu: page }, single: true });

export interface LocateOptions {
  /** Building: fall back to the current page (or new pages) instead of returning null. */
  build?: boolean;
  /** Prefer separate pages (needs a plan that allows more pages). */
  separate?: boolean;
  log?: (msg: string) => void;
}

/** Finds the silicon: where the last build put it, a page named "Silicon", the three pages of
 * a separate-pages build, or (not building) the current page if it holds cell/CPU. Building
 * with nothing found: new pages if `separate` and Figma allows it, else the current page. */
export async function locate(api: PluginAPI, o: LocateOptions = {}): Promise<Where | null> {
  const stored = api.root.getPluginData(DOC_PAGES);
  if (stored) {
    try {
      const ids = JSON.parse(stored) as { gates: string; cells: string; cpu: string };
      const [gates, cells, cpu] = await Promise.all([ids.gates, ids.cells, ids.cpu].map((id) => api.getNodeByIdAsync(id)));
      const ok = (n: BaseNode | null): n is PageNode => !!n && n.type === "PAGE" && !n.removed;
      if (ok(gates) && ok(cells) && ok(cpu)) return { pages: { gates, cells, cpu }, single: gates === cells && cells === cpu };
    } catch {
      /* stale or foreign data: look again */
    }
  }
  const byName = (n: string) => api.root.children.find((p) => p.name === n);
  const sil = byName(SINGLE_PAGE);
  if (sil) return single(sil);
  const [gates, cells, cpu] = [PAGE_GATES, PAGE_CELLS, PAGE_CPU].map(byName);
  if (gates && cells && cpu) return { pages: { gates, cells, cpu }, single: false };
  const current = api.currentPage;
  if (!o.build) {
    await current.loadAsync();
    const hasCpu = current.children.some((n) => n.type === "COMPONENT" && n.name === `${CELL_PREFIX}CPU`) ||
      current.findAllWithCriteria({ types: ["COMPONENT"] }).some((n) => n.name === `${CELL_PREFIX}CPU`);
    return hasCpu ? single(current) : null;
  }
  if (o.separate) {
    const made = tryCreatePages(api, o.log);
    if (made) return made;
  }
  return single(current);
}

/** The three silicon pages, creating the missing ones; null (and nothing left behind) if
 * Figma refuses a new page (Starter plan: 3 pages per file). */
function tryCreatePages(api: PluginAPI, log?: (msg: string) => void): Where | null {
  const created: PageNode[] = [];
  const get = (name: string) => {
    const found = api.root.children.find((p) => p.name === name);
    if (found) return found;
    const p = api.createPage();
    created.push(p);
    p.name = name;
    return p;
  };
  try {
    return { pages: { gates: get(PAGE_GATES), cells: get(PAGE_CELLS), cpu: get(PAGE_CPU) }, single: false };
  } catch (e) {
    for (const p of created)
      try {
        p.remove();
      } catch {
        /* leave it */
      }
    log?.(`separate pages are not available (${e instanceof Error ? e.message : e}); using one page, "${api.currentPage.name}"`);
    return null;
  }
}

/** Remembers where the silicon is, for later sessions. */
export function remember(api: PluginAPI, w: Where, origin?: { x: number; y: number }): void {
  api.root.setPluginData(DOC_PAGES, JSON.stringify({ gates: w.pages.gates.id, cells: w.pages.cells.id, cpu: w.pages.cpu.id }));
  if (origin) api.root.setPluginData(DOC_ORIGIN, JSON.stringify({ page: w.pages.cpu.id, ...origin }));
}

const isGate = (n: SceneNode) => n.type === "COMPONENT" && n.name.startsWith(GATE_PREFIX);
const isCell = (n: SceneNode) => n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX);

/** Top-left corner of the silicon area on a single page: remembered, or derived from the
 * gates already there, or below everything else on the page (so nothing overlaps). */
export function siliconOrigin(api: PluginAPI, page: PageNode): { x: number; y: number } {
  try {
    const o = JSON.parse(api.root.getPluginData(DOC_ORIGIN) || "null") as { page: string; x: number; y: number } | null;
    if (o && o.page === page.id && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  } catch {
    /* recompute */
  }
  const gates = page.children.filter(isGate);
  if (gates.length) return { x: Math.min(...gates.map((g) => g.x)), y: Math.min(...gates.map((g) => g.y)) - GATES_DY };
  const content = page.children;
  if (!content.length) return { x: 0, y: 0 };
  return { x: Math.round(Math.min(...content.map((n) => n.x))), y: Math.round(Math.max(...content.map((n) => n.y + n.height)) + 800) };
}

/** Offsets of the regions from the origin. */
export const GATES_DY = 80;
export const CELLS_DY = 360;
/** Gap between the bottom of the cells and the CPU (room for the Step frame's header). */
export const CPU_GAP = 800;
const GATE_PITCH = 144;

/** Moves gate components into the gates row (single page). */
export function placeGates(gates: SceneNode[], origin: { x: number; y: number }): void {
  gates.forEach((g, i) => {
    g.x = origin.x + i * GATE_PITCH;
    g.y = origin.y + GATES_DY;
  });
}

/** Bottom edge of the cell components (not CPU) on a page; -Infinity if none. */
export function cellsBottom(page: PageNode, cpuName = `${CELL_PREFIX}CPU`): number {
  let b = -Infinity;
  for (const n of page.children) if (isCell(n) && n.name !== cpuName) b = Math.max(b, n.y + n.height);
  return b;
}

/** Shelf placement of newly drawn modules: rows up to 6000 px, children before parents. */
export class Shelf {
  private x: number;
  private rowH = 0;
  constructor(
    private readonly x0: number,
    private y: number,
  ) {
    this.x = x0;
  }
  place(n: SceneNode): void {
    if (this.x > this.x0 && this.x - this.x0 + n.width > 6000) {
      this.x = this.x0;
      this.y += this.rowH + 96;
      this.rowH = 0;
    }
    n.x = this.x;
    n.y = this.y;
    this.x += n.width + 96;
    this.rowH = Math.max(this.rowH, n.height);
  }
}

/** Bottom of everything on a page except `skip` (for placing below it). */
export function pageBottom(page: PageNode, skip?: SceneNode): number {
  let b = -Infinity;
  for (const n of page.children) if (n !== skip) b = Math.max(b, n.y + n.height);
  return b;
}

/** Big captions over the regions of a single-page layout (replaced on every build). */
export async function labelRegions(api: PluginAPI, page: PageNode, stepFrameName: string): Promise<void> {
  for (const n of [...page.children]) if (n.type === "TEXT" && n.name.startsWith(LABEL)) n.remove();
  await loadFonts(api);
  const add = (name: string, chars: string, x: number, y: number) => {
    const t = text(api, chars, { size: 32, bold: true, color: COLORS.dim, name: `${LABEL}${name}` });
    page.appendChild(t);
    t.x = Math.round(x);
    t.y = Math.round(y);
  };
  const gates = page.children.filter(isGate);
  const cells = page.children.filter((n) => isCell(n) && n.name !== `${CELL_PREFIX}CPU`);
  const step = page.children.find((n) => n.name === stepFrameName);
  const cpu = step ?? page.children.find((n) => isCell(n) && n.name === `${CELL_PREFIX}CPU`);
  const top = (ns: SceneNode[]) => Math.min(...ns.map((n) => n.y));
  const left = (ns: SceneNode[]) => Math.min(...ns.map((n) => n.x));
  if (gates.length) add("Gates", "Silicon · Gates — the 8 primitive gates (main components)", left(gates), top(gates) - 80);
  if (cells.length) add("Cells", "Silicon · Cells — every circuit is a component built from gates and cells", left(cells), top(cells) - 80);
  if (cpu) add("CPU", "Silicon · CPU — cell/CPU, the whole machine (Compile wraps it in the CPU · Step frame)", cpu.x, (step ? cpu.y : cpu.y - 264) - 120);
}
