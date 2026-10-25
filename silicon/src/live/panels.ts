// The chrome and side panels of the dashboard: program disks, the listing, the clock pad,
// the 7-segment display and the RAM matrix. Disks, controls and pad cells are plain frames
// with stable names (names.ts): lane L2 attaches their reactions; nothing here runs at Present
// time except the variable bindings.
import { ramBit } from "../cpu/probes";
import { assemble, disassemble, RAM_ADDR_BITS, RAM_BYTES } from "../isa";
import { CTL_PAD, CUSTOM_DISK, diskName, LISTING, PROGRAM_NAME, bound, padCellName } from "./names";
import { type Ctx, frame, glow, header, L, put, rect, solid, text } from "./style";
import { bitLabels, gated, lamp } from "./widgets";

type Parent = BaseNode & ChildrenMixin;

// ---------- program listing ----------

const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, "0");
/** Hex digits of an address. */
const ADDR_DIGITS = (RAM_BYTES - 1).toString(16).length;

/** A program as an assembler listing: address, bytes, source (comments dropped), e.g.
 * "8  51     loop: ADD R0, R1". Invalid source comes back as the source itself. */
export function listingText(source: string): string {
  const r = assemble(source);
  if (r.errors.length) return source.trim();
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  lines.forEach((raw, i) => {
    const code = raw.replace(/;.*$/, "").replace(/\s+/g, " ").trim();
    if (!code) return;
    const addr = r.lineAddr[i + 1];
    if (addr === undefined) {
      if (/^[A-Za-z_]\w*:$/.test(code)) out.push(`${" ".repeat(ADDR_DIGITS + 9)}${code}`);
      return;
    }
    const op = code.replace(/^[A-Za-z_]\w*:\s*/, "");
    const size = op.startsWith(".") ? Math.max(1, op.slice(op.indexOf(" ") + 1).split(",").length) : disassemble(r.bytes, addr).size;
    const bytes = r.bytes.slice(addr, Math.min(RAM_BYTES, addr + size)).map((b) => hex(b, 2)).join(" ");
    out.push(`${hex(addr, ADDR_DIGITS)}  ${bytes.padEnd(5)}  ${code}`);
  });
  return out.join("\n");
}

/** One-line description of a program: its first comment, after the "name.asm —" part. */
export function programBlurb(source: string): string {
  const first = source.split(/\r?\n/).find((l) => l.trim().startsWith(";"));
  if (!first) return "";
  let s = first.replace(/^\s*;\s*/, "");
  const dash = s.indexOf("—");
  if (dash >= 0) s = s.slice(dash + 1);
  s = s.split(/[;.](\s|$)/)[0].trim();
  return s.length > 36 ? `${s.slice(0, 35)}…` : s;
}

/** Program name + listing text layers. setListing (dashboard.ts) rewrites them. With `h`, the
 * listing sits in a frame that clips it to that height (a long program shows its first lines). */
export function drawListing(ctx: Ctx, parent: Parent, x: number, y: number, w: number, name: string, source: string, h?: number): { program: TextNode; listing: TextNode } {
  const program = text(ctx, parent, name, x, y, { size: 12, font: "semibold", color: L.text, name: PROGRAM_NAME });
  const at = h ? frame(ctx, parent, "listing", x, y + 22, w, h, { fill: null, clip: true }) : parent;
  const listing = text(ctx, at, listingText(source), h ? 0 : x, h ? 0 : y + 22, { size: 10, font: "mono", color: L.text2, w, lineHeight: 15, name: LISTING });
  return { program, listing };
}

// ---------- disks ----------

/** A disk icon color per program (stable, from the name). */
function diskColor(name: string): string {
  const palette = [L.load, L.alu, L.mem, L.drive, L.ctrl, L.out, L.blue];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

/** The disks: one button per program, then the custom slot. Returns them by program name. */
export function drawDisks(ctx: Ctx, parent: Parent, x: number, y: number, w: number, programs: Record<string, string>, rowH = 36, gap = 2, cols = 1): Map<string, FrameNode> {
  const disks = new Map<string, FrameNode>();
  const names = [...Object.keys(programs), CUSTOM_DISK];
  const dw = cols > 1 ? Math.floor((w - (cols - 1) * 4) / cols) : w;
  names.forEach((name, i) => {
    const custom = name === CUSTOM_DISK && !(name in programs);
    const [dx, dy] = [(i % cols) * (dw + 4), Math.floor(i / cols) * (rowH + gap)];
    const f = frame(ctx, parent, diskName(name), x + dx, y + dy, dw, rowH, custom ? { fill: L.chrome, radius: 6, stroke: L.line2 } : { fill: L.cell, radius: 6 });
    if (custom) f.dashPattern = [4, 3];
    const c = custom ? L.text3 : diskColor(name);
    // A floppy: body, label, shutter.
    rect(ctx, f, "icon", 10, rowH / 2 - 10, 20, 20, { fill: c, radius: 3, ...(custom ? { fill: null, stroke: c } : {}) });
    if (!custom) {
      rect(ctx, f, "icon/label", 14, rowH / 2 - 1, 12, 8, { fill: "#FFFFFF", fillOpacity: 0.9, radius: 1 });
      rect(ctx, f, "icon/shutter", 15, rowH / 2 - 10, 9, 6, { fill: "#000000", fillOpacity: 0.35, radius: 1 });
    }
    text(ctx, f, name, 40, 4, { size: 11.5, font: "semibold", color: custom ? L.text2 : L.text, name: "name" });
    const blurb = custom ? "the program the plugin loaded last" : programBlurb(programs[name]);
    const room = Math.floor((dw - 44) / 5); // characters of 9 px text that fit
    text(ctx, f, blurb.length > room ? `${blurb.slice(0, room - 1)}…` : blurb, 40, 19, { size: 9, color: L.text3, name: "blurb" });
    disks.set(name, f);
  });
  return disks;
}

// ---------- clock pad ----------

/** The clock pad: a grid of cells; lane L2 makes every MOUSE_ENTER on a cell run one chunk. With
 * `cellComponent`, every cell is an instance of it (the reaction can then live on the component once). */
export function drawPad(
  ctx: Ctx,
  parent: Parent,
  x: number,
  y: number,
  cols: number,
  rows: number,
  cell = 30,
  gap = 3,
  cellComponent?: ComponentNode,
): { pad: FrameNode; cells: Array<FrameNode | InstanceNode> } {
  const inset = 6;
  const w = 2 * inset + cols * cell + (cols - 1) * gap;
  const h = 2 * inset + rows * cell + (rows - 1) * gap;
  const pad = frame(ctx, parent, CTL_PAD, x, y, w, h, { fill: "#232323", radius: 10, stroke: L.line });
  const cells: Array<FrameNode | InstanceNode> = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      // A soft diagonal shade so the pad reads as one surface.
      const t = (r + c) / (rows + cols - 2 || 1);
      const shade = Math.round(0x34 + t * 0x10).toString(16).padStart(2, "0");
      const fill = `#${shade}${shade}${shade}`;
      const [cx, cy] = [inset + c * (cell + gap), inset + r * (cell + gap)];
      if (cellComponent) {
        const inst = cellComponent.createInstance();
        inst.name = padCellName(i);
        put(pad, inst, cx, cy);
        inst.fills = solid(fill);
        cells.push(inst);
      } else cells.push(frame(ctx, pad, padCellName(i), cx, cy, cell, cell, { fill, radius: 6 }));
    }
  return { pad, cells };
}

// ---------- 7-segment display ----------

/** Segments a..g = SEG[0..6] of one digit (x, y, w, h), 56 × 100. */
const SEGS: Array<[number, number, number, number]> = [
  [9, 0, 38, 8],
  [48, 8, 8, 38],
  [48, 54, 8, 38],
  [9, 92, 38, 8],
  [0, 54, 8, 38],
  [0, 8, 8, 38],
  [9, 46, 38, 8],
];

/** The two hex digits of OUT, driven by SEG_HI / SEG_LO (the CPU's HEX7SEG outputs). */
export function drawSevenSeg(ctx: Ctx, parent: Parent, x: number, y: number, w: number, h: number): FrameNode {
  const win = frame(ctx, parent, "display", x, y, w, h, { fill: L.display, radius: 10, stroke: L.line });
  const dw = 56;
  const gap = 28;
  const x0 = Math.round((w - 2 * dw - gap) / 2);
  const y0 = Math.round((h - 100) / 2);
  ["SEG_HI", "SEG_LO"].forEach((port, d) =>
    SEGS.forEach(([sx, sy, sw, sh], s) => {
      const seg = lamp(ctx, win, `${port}[${s}]`, x0 + d * (dw + gap) + sx, y0 + sy, Math.min(sw, sh), L.out, { kind: "seg", w: sw, h: sh, radius: 3, off: L.segOff });
      const lit = seg.children.find((c) => c.name === "lit");
      if (lit) glow(lit, L.out, 10, 0.8);
    }),
  );
  return win;
}

// ---------- RAM matrix ----------

/** RAM as columns of bytes × 8 lamps (bit 7 on the left), each lamp a RAM latch output (ramBit).
 * Highlights, every one a binding (nested layers make an AND: no gate, no action):
 *   · the row MAR addresses (the RAM decoder's line ram/sel[k]), and inside it a read flash
 *     (MEM_READ) and a write flash (MEM_WRITE) on the T-state that reads or writes that byte;
 *   · ▸ at the byte PC points to: a tree of layers, one level per PC bit (pc[i] or pc_n[i]), so
 *     exactly one leaf shows. */
export function drawRamMatrix(ctx: Ctx, parent: Parent, x: number, y: number, w: number, lampSize = 10, pitch = 12, cols = 2): FrameNode {
  const perCol = Math.ceil(RAM_BYTES / cols);
  const colW = Math.floor(w / cols);
  const h = 18 + perCol * pitch + 4;
  const f = frame(ctx, parent, "memory", x, y, w, h, { fill: null });
  const lx = 30; // ▸ at 0, the address from 9, the lamps from 30
  const at = (a: number): [number, number] => [Math.floor(a / perCol) * colW, 16 + (a % perCol) * pitch];
  for (let c = 0; c < cols; c++) bitLabels(ctx, f, 8, c * colW + lx, 2, pitch, lampSize);
  const bw = colW - 4;
  for (let a = 0; a < RAM_BYTES; a++) {
    const [cx, ry] = at(a);
    const band = frame(ctx, f, bound("row", `ram/sel[${a}]`), cx, ry - 1, bw, pitch, { fill: null });
    const lit = frame(ctx, band, "lit", 0, 0, bw, pitch, { fill: L.mem, fillOpacity: 0.16, radius: 3 });
    lit.strokes = [{ type: "SOLID", color: solid(L.mem)[0].color, opacity: 0.6 }];
    for (const [net, color] of [["MEM_READ", L.load], ["MEM_WRITE", L.out]] as const) {
      const flash = gated(ctx, lit, "tag", [net], 0, 0, bw, pitch);
      rect(ctx, flash, "flash", 0, 0, bw, pitch, { fill: color, fillOpacity: 0.4, radius: 3 });
    }
    lit.visible = false;
    text(ctx, f, hex(a, ADDR_DIGITS), cx + 9, ry, { size: 8.5, font: "mono", color: L.text3, name: `addr/${a}` });
    for (let i = 0; i < 8; i++) lamp(ctx, f, ramBit(a, 7 - i), cx + lx + i * pitch, ry, lampSize, L.mem, { radius: 2 });
  }
  // PC ▸: the tree's levels test pc[N-1] … pc[0]; the leaf for address a sits on a's row.
  const tree = (into: Parent, depth: number, prefix: number): void => {
    if (depth === RAM_ADDR_BITS) {
      const [cx, ry] = at(prefix);
      text(ctx, into, "▸", cx, ry - 2, { size: 10, font: "monoBold", color: L.alu, name: "pc" });
      return;
    }
    const bit = RAM_ADDR_BITS - 1 - depth;
    for (const v of [0, 1]) tree(gated(ctx, into, "tag", [v ? `pc[${bit}]` : `pc_n[${bit}]`], 0, 0, w, h), depth + 1, (prefix << 1) | v);
  };
  tree(f, 0, 0);
  return f;
}

export { header };
