// Where CPU NATHAN lives in the document: one page named "CPU NATHAN".
//
// Figma's Starter plan caps a file at 3 pages (createPage throws). The silicon CPU file may already
// use them, so: an existing page named "CPU NATHAN" wins; otherwise try to create it; if Figma
// refuses, rename an EMPTY default page ("Page 1" …) to "CPU NATHAN"; if there is none, build on
// the current page and say so (rename it yourself, nothing depends on the name once built).
import { CELL_PREFIX, type SiliconPages } from "../../../src/figma";
import { GATE_PREFIX } from "../../../src/netlist/types";

export { PAGE_NAME } from "./names";
import { PAGE_NAME } from "./names";
const DOC_PAGE = "nathan.page";

export interface Placed {
  page: PageNode;
  /** How the page came to be. */
  how: "existing" | "created" | "renamed" | "current";
}

/** Finds (or makes) the CPU NATHAN page. Never touches other pages' contents. */
export async function ensurePage(
  api: PluginAPI,
  log: (m: string) => void = () => {},
): Promise<Placed> {
  const byName = api.root.children.find((p) => p.name === PAGE_NAME);
  if (byName) return { page: byName, how: "existing" };
  const stored = api.root.getPluginData(DOC_PAGE);
  if (stored) {
    const n = await api.getNodeByIdAsync(stored);
    if (n && n.type === "PAGE" && !n.removed)
      return { page: n, how: "existing" };
  }
  try {
    const p = api.createPage();
    p.name = PAGE_NAME;
    return { page: p, how: "created" };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    for (const p of api.root.children) {
      if (!/^Page \d+$/.test(p.name)) continue;
      await p.loadAsync();
      if (p.children.length === 0) {
        p.name = PAGE_NAME;
        log(
          `could not create a page (${why}); renamed the empty page to "${PAGE_NAME}"`,
        );
        return { page: p, how: "renamed" };
      }
    }
    log(
      `could not create a page (${why}) and there is no empty one; building on "${api.currentPage.name}"`,
    );
    return { page: api.currentPage, how: "current" };
  }
}

export function remember(api: PluginAPI, page: PageNode): void {
  api.root.setPluginData(DOC_PAGE, page.id);
}

/** The page if it exists already (no creation). */
export async function findPage(api: PluginAPI): Promise<PageNode | null> {
  const byName = api.root.children.find((p) => p.name === PAGE_NAME);
  if (byName) return byName;
  const stored = api.root.getPluginData(DOC_PAGE);
  if (stored) {
    const n = await api.getNodeByIdAsync(stored);
    if (n && n.type === "PAGE" && !n.removed) return n;
  }
  return null;
}

/** All three of the silicon draw code's "pages" are this one page. */
export const onePage = (page: PageNode): SiliconPages => ({
  gates: page,
  cells: page,
  cpu: page,
});

const isGate = (n: SceneNode) =>
  n.type === "COMPONENT" && n.name.startsWith(GATE_PREFIX);
const isCell = (n: SceneNode) =>
  n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX);

/** Top-left corner of CPU NATHAN's area on the page: where the gates already are, or below
 * whatever else the page holds (so nothing overlaps). */
export function origin(page: PageNode): { x: number; y: number } {
  const gates = page.children.filter(isGate);
  if (gates.length)
    return {
      x: Math.min(...gates.map((g) => g.x)),
      y: Math.min(...gates.map((g) => g.y)) - GATES_DY,
    };
  const content = page.children;
  if (!content.length) return { x: 0, y: 0 };
  return {
    x: Math.round(Math.min(...content.map((n) => n.x))),
    y: Math.round(Math.max(...content.map((n) => n.y + n.height)) + 800),
  };
}

export const GATES_DY = 80;
export const CELLS_DY = 360;
/** Space between the cells and the machine: room for the editor frame that sits above it. */
export const MACHINE_GAP = 1500;
const GATE_PITCH = 144;

/** Gate components in a row at the top of the area. */
export function placeGates(
  gates: SceneNode[],
  at: { x: number; y: number },
): void {
  gates.forEach((g, i) => {
    g.x = at.x + i * GATE_PITCH;
    g.y = at.y + GATES_DY;
  });
}

/** Bottom edge of the cell components other than `except`; -Infinity if none. */
export function cellsBottom(page: PageNode, except = ""): number {
  let b = -Infinity;
  for (const n of page.children)
    if (isCell(n) && n.name !== except) b = Math.max(b, n.y + n.height);
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
