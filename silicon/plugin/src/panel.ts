// The front panel: a small component on the CPU page that shows the machine at a glance —
// two 7-segment digits driven by the CPU's SEG_HI / SEG_LO outputs and one lamp per bit of
// the architectural probes (PROBES, src/cpu/probes.ts). It is the `display` that apply()
// instances into the Control / Run frames (cheap: ~200 layers instead of the CPU's ~37k).
//
// Canvas contract (so editing the panel on the canvas rewires it, like the circuit):
//   a frame named `lamp/<net>` or `seg/<net>` with a child `lit` → `lit`.visible is bound to
//   the net's variable on every compile. <net> is a flat net name of the CPU ("pc[2]",
//   "flag_z", "SEG_LO[0]"). Rename a lamp to point it at another net.
import { PROBES, ramBit } from "../../src/cpu/probes";
import { RAM_BYTES } from "../../src/isa/spec";
import { COLORS, box, lamp, loadFonts, put, solid, text } from "../../src/prototype/draw";
import type { FlatNetlist } from "../../src/netlist/types";

export const PANEL_NAME = "Silicon · Front panel";
const BOUND_RE = /^(?:lamp|seg)\/(.+)$/;

const SEG_ON = "#ff5a36";
const SEG_OFF = "#2a2d33";
const LAMP = 14;
const PITCH = 18;
const ROW = 24;
const LABEL_W = 40;

/** One lamp row: label, probe, lamp color. Bits are drawn MSB on the left. */
interface Row {
  label: string;
  nets: string[];
  color: string;
}

const bits = (name: string, width: number) =>
  width === 1 ? [name] : Array.from({ length: width }, (_, i) => `${name}[${width - 1 - i}]`); // MSB first
const probe = (key: string, color: string = COLORS.lampOn): Row => ({ label: key, nets: bits(PROBES[key].name, PROBES[key].width), color });

/** The lamp rows, in two columns. */
export function panelRows(): Row[][] {
  return [
    [probe("OUT", COLORS.amber), probe("BUS", "#f59e0b"), probe("IR"), probe("PC"), probe("T", "#5aa9ff")],
    [probe("R0"), probe("R1"), probe("R2"), probe("R3")],
  ];
}

// MEM screen: the 16 bytes of RAM as a 16 × 8 lamp matrix (address down, bit 7 on the left), each lamp
// bound to its RAM latch output. It needs no hardware: the bits already are variables, so it works in
// Present mode and with the plugin clock, and a program "draws" by storing bytes (code shows up too:
// the RAM is shared).
const MEM_LAMP = 8;
const MEM_PITCH = 11;
const MEM_LABEL_W = 14;
export const MEM_LAMPS = RAM_BYTES * 8;

/** The RAM matrix rows: `nets[addr][i]` is the latch output of bit (7 - i) of RAM[addr]. */
export function memRows(): string[][] {
  return Array.from({ length: RAM_BYTES }, (_, a) => Array.from({ length: 8 }, (_, i) => ramBit(a, 7 - i)));
}

/** Segment rectangles of one digit (a..g = SEG[0..6]), relative to the digit's corner. */
const SEGMENTS: Array<[number, number, number, number]> = [
  [8, 0, 40, 8], // a
  [48, 8, 8, 36], // b
  [48, 52, 8, 36], // c
  [8, 88, 40, 8], // d
  [0, 52, 8, 36], // e
  [0, 8, 8, 36], // f
  [8, 44, 40, 8], // g
];

/** Draws the front panel component (fonts are loaded here). Not yet bound to variables. */
export async function drawFrontPanel(api: PluginAPI): Promise<ComponentNode> {
  await loadFonts(api);
  const comp = api.createComponent();
  comp.name = PANEL_NAME;
  comp.description = "FigmaCPU front panel: OUT on two hex digits and one lamp per probe bit. Lamps named lamp/<net> are bound to that net on every compile.";
  comp.fills = solid(COLORS.panel);
  comp.cornerRadius = 12;
  comp.clipsContent = false;

  // Two hex digits (HI left, LO right) on a dark display window.
  const disp = box(api, "display", 152, 120, "#0d0e11", 8);
  put(comp, disp, 16, 16);
  ["SEG_HI", "SEG_LO"].forEach((port, d) => {
    SEGMENTS.forEach(([x, y, w, h], s) => {
      const seg = box(api, `seg/${port}[${s}]`, w, h, SEG_OFF, 2);
      const lit = api.createRectangle();
      lit.name = "lit";
      lit.resize(w, h);
      lit.cornerRadius = 2;
      lit.fills = solid(SEG_ON);
      lit.visible = false;
      put(seg, lit, 0, 0);
      put(disp, seg, 12 + d * 72 + x, 12 + y);
    });
  });
  put(comp, text(api, "OUT · hex", { size: 11, color: COLORS.dim }), 16, 142);

  // Lamp rows.
  let x = 196;
  let bottom = 0;
  for (const column of panelRows()) {
    column.forEach((row, r) => {
      const y = 16 + r * ROW;
      put(comp, text(api, row.label, { size: 11, bold: true, color: COLORS.dim }), x, y);
      row.nets.forEach((net, i) => {
        const l = lamp(api, LAMP, row.color, `lamp/${net}`);
        l.lit.visible = false;
        put(comp, l.node, x + LABEL_W + i * PITCH, y);
      });
      bottom = Math.max(bottom, y + ROW);
    });
    x += LABEL_W + 8 * PITCH + 24;
  }
  // Flags and HALTED under the registers.
  const fy = 16 + 4 * ROW;
  const fx = 196 + LABEL_W + 8 * PITCH + 24;
  put(comp, text(api, "ZCN", { size: 11, bold: true, color: COLORS.dim }), fx, fy);
  ["Z", "C", "N"].forEach((k, i) => {
    const l = lamp(api, LAMP, "#5aa9ff", `lamp/${PROBES[k].name}`);
    l.lit.visible = false;
    put(comp, l.node, fx + LABEL_W + i * PITCH, fy);
  });
  put(comp, text(api, "HALT", { size: 11, bold: true, color: COLORS.dim }), fx + LABEL_W + 3 * PITCH + 14, fy);
  const h = lamp(api, LAMP, COLORS.stop, `lamp/${PROBES.HALTED.name}`);
  h.lit.visible = false;
  put(comp, h.node, fx + LABEL_W + 3 * PITCH + 14 + 40, fy);
  bottom = Math.max(bottom, fy + ROW);


  // MEM screen to the right of the lamp columns.
  const memX = x;
  put(comp, text(api, "MEM", { size: 11, bold: true, color: COLORS.dim }), memX, 16);
  memRows().forEach((nets, a) => {
    const y = 34 + a * MEM_PITCH;
    put(comp, text(api, a.toString(16).toUpperCase(), { size: 8, color: COLORS.dim }), memX, y - 1);
    nets.forEach((net, i) => {
      const l = lamp(api, MEM_LAMP, COLORS.lampOn, `lamp/${net}`);
      l.lit.visible = false;
      put(comp, l.node, memX + MEM_LABEL_W + i * MEM_PITCH, y);
    });
  });
  const memBottom = 34 + RAM_BYTES * MEM_PITCH;
  x = memX + MEM_LABEL_W + 8 * MEM_PITCH + 24;
  bottom = Math.max(bottom, memBottom);

  comp.resize(x - 24 + 16, Math.max(bottom + 12, 168));
  return comp;
}

/** Finds the front panel on `page`, or draws it there: at `at(w, h)` if given (e.g. left of
 * the CPU), else left of everything on the page. */
export async function ensureFrontPanel(
  api: PluginAPI,
  page: PageNode,
  at?: (w: number, h: number) => { x: number; y: number },
): Promise<{ comp: ComponentNode; created: boolean }> {
  await page.loadAsync();
  const found = findFrontPanel(page);
  if (found) return { comp: found, created: false };
  const comp = await drawFrontPanel(api);
  let minX = Infinity;
  let minY = Infinity;
  for (const n of page.children)
    if (n !== comp) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
    }
  page.appendChild(comp);
  const p = at ? at(comp.width, comp.height) : { x: minX === Infinity ? 0 : minX - comp.width - 400, y: minY === Infinity ? 0 : minY };
  comp.x = Math.round(p.x);
  comp.y = Math.round(p.y);
  return { comp, created: true };
}

export function findFrontPanel(page: PageNode): ComponentNode | null {
  const top = page.children.find((n): n is ComponentNode => n.type === "COMPONENT" && n.name === PANEL_NAME);
  if (top) return top;
  const deep = page.findAllWithCriteria({ types: ["COMPONENT"] }).filter((n) => n.name === PANEL_NAME);
  return deep[0] ?? null;
}

/** The panel's `lit` layers by net id, for apply()'s bindings; `missing` lists lamp names
 * whose net does not exist in `net` (e.g. after renaming a lamp to a typo). */
export function panelLits(comp: ComponentNode, net: FlatNetlist): { wireLit: Map<number, SceneNode[]>; lamps: number; missing: string[] } {
  const wireLit = new Map<number, SceneNode[]>();
  const missing: string[] = [];
  let lamps = 0;
  const walk = (node: BaseNode & ChildrenMixin) => {
    for (const c of node.children) {
      const m = BOUND_RE.exec(c.name);
      if (m && "children" in c) {
        const lit = c.children.find((x) => x.name === "lit");
        const id = net.aliases.get(m[1]);
        if (!lit) continue;
        if (id === undefined) {
          missing.push(c.name);
          continue;
        }
        lamps++;
        const list = wireLit.get(id);
        if (list) list.push(lit);
        else wireLit.set(id, [lit]);
        continue;
      }
      if ("children" in c && c.type !== "INSTANCE") walk(c);
    }
  };
  walk(comp);
  return { wireLit, lamps, missing };
}
