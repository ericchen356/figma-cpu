// Finds the drawn machine by the naming contract (PRD §4.2) and caches node handles.
// Also reads the opcode table straight off the canvas — that table is the CPU's logic.
import type { TableRow } from "./table";
import { REG_NAMES } from "./table";

export const MACHINE = "Machine v2";

export type Paintable = SceneNode & MinimalFillsMixin & MinimalStrokesMixin;

export interface RegNodes {
  box: Paintable;
  value: TextNode;
  dec: TextNode | null;
  bits: Paintable[];
}

export interface MemWindow {
  base: TextNode;
  labels: TextNode[];
  cells: { box: Paintable; v: TextNode }[];
}

export interface Bus {
  box: Paintable;
  value: TextNode;
  wire: Paintable;
}

export interface Bound {
  page: PageNode;
  root: FrameNode;
  regs: Map<string, RegNodes>;
  irMnem: TextNode;
  hl: TextNode;
  cycles: TextNode;
  phases: Record<"FETCH" | "DECODE" | "EXEC", Paintable>;
  clock: Paintable;
  flags: Record<"Z" | "C" | "N", Paintable>;
  alu: {
    box: Paintable;
    op: TextNode;
    in1: TextNode;
    in2: TextNode;
    out: TextNode;
  };
  buses: Record<"addr" | "data", Bus>;
  taps: Map<string, Paintable>;
  table: FrameNode;
  ram: MemWindow;
  pin: MemWindow;
  screen: RectangleNode;
  io: Map<string, TextNode>;
}

const IO_NAMES = ["MOUSE_X", "MOUSE_Y", "MOUSE_BTN", "KEY", "TICK", "RAND"];

function hex(n: number, w: number) {
  return n.toString(16).toUpperCase().padStart(w, "0");
}

export async function findMachine(): Promise<{
  page: PageNode;
  root: FrameNode;
} | null> {
  const page = figma.root.children.find((p) => p.name === MACHINE);
  if (!page) return null;
  await page.loadAsync();
  const root = page.children.find(
    (n) => n.name === MACHINE && n.type === "FRAME",
  ) as FrameNode | undefined;
  return root ? { page, root } : null;
}

export async function bind(): Promise<{ bound?: Bound; missing: string[] }> {
  const found = await findMachine();
  if (!found)
    return { missing: [`page + frame "${MACHINE}" (run tools/draw-machine)`] };
  const { page, root } = found;

  const byName = new Map<string, SceneNode>();
  for (const n of root.findAll((n) => /^(cpu|mem|dev)\//.test(n.name)))
    if (!byName.has(n.name)) byName.set(n.name, n);

  const missing: string[] = [];
  const need = <T extends SceneNode>(name: string): T => {
    const n = byName.get(name);
    if (!n) missing.push(name);
    return n as T;
  };
  const child = <T extends SceneNode>(
    parent: SceneNode | undefined,
    name: string,
    owner: string,
  ): T => {
    const n =
      parent && "findOne" in parent
        ? parent.findOne((c) => c.name === name)
        : null;
    if (!n && parent) missing.push(`${owner} › ${name}`);
    return n as T;
  };

  const regs = new Map<string, RegNodes>();
  const reg = (name: string, bits: number) => {
    const box = need<Paintable & FrameNode>(`cpu/reg/${name}`);
    regs.set(name, {
      box,
      value: child<TextNode>(box, "value", `cpu/reg/${name}`),
      dec:
        box && "findOne" in box
          ? (box.findOne((c) => c.name === "dec") as TextNode | null)
          : null,
      bits: Array.from({ length: bits }, (_, i) =>
        child<Paintable>(box, `bit/${i}`, `cpu/reg/${name}`),
      ),
    });
  };
  REG_NAMES.forEach((r) => reg(r, 8));
  reg("PC", 16);
  reg("SP", 16);
  reg("IR", 8);

  const lamp = (name: string) => child<Paintable>(need(name), "lamp", name);

  const memWindow = (prefix: string, rows: number): MemWindow => ({
    base: need<TextNode>(`${prefix}/base`),
    labels: Array.from({ length: rows }, (_, r) =>
      need<TextNode>(`${prefix}/addr/${hex(r, 1)}`),
    ),
    cells: Array.from({ length: rows * 16 }, (_, i) => {
      const box = need<Paintable>(`${prefix}/cell/${hex(i, 2)}`);
      return {
        box,
        v: child<TextNode>(box, "v", `${prefix}/cell/${hex(i, 2)}`),
      };
    }),
  });

  const bus = (name: "addr" | "data"): Bus => {
    const box = need<Paintable>(`cpu/bus/${name}`);
    return {
      box,
      value: child<TextNode>(box, "value", box?.name),
      wire: child<Paintable>(box, "wire", box?.name),
    };
  };

  const taps = new Map<string, Paintable>();
  for (const [name, n] of byName)
    if (name.startsWith("cpu/bus/tap/"))
      taps.set(name.slice(12), n as Paintable);

  const io = new Map<string, TextNode>();
  for (const name of IO_NAMES)
    io.set(
      name,
      child<TextNode>(need(`mem/io/${name}`), "value", `mem/io/${name}`),
    );

  const bound: Bound = {
    page,
    root,
    regs,
    irMnem: child<TextNode>(byName.get("cpu/reg/IR"), "mnem", "cpu/reg/IR"),
    hl: need<TextNode>("cpu/reg/HL"),
    cycles: need<TextNode>("cpu/cycles"),
    phases: {
      FETCH: lamp("cpu/phase/FETCH"),
      DECODE: lamp("cpu/phase/DECODE"),
      EXEC: lamp("cpu/phase/EXEC"),
    },
    clock: lamp("cpu/clock"),
    flags: {
      Z: lamp("cpu/flag/Z"),
      C: lamp("cpu/flag/C"),
      N: lamp("cpu/flag/N"),
    },
    alu: {
      box: need<Paintable>("cpu/alu/body"),
      op: need<TextNode>("cpu/alu/op"),
      in1: need<TextNode>("cpu/alu/in1"),
      in2: need<TextNode>("cpu/alu/in2"),
      out: need<TextNode>("cpu/alu/out"),
    },
    buses: { addr: bus("addr"), data: bus("data") },
    taps,
    table: need<FrameNode>("cpu/decoder/table"),
    ram: memWindow("mem/ram", 16),
    pin: memWindow("mem/pin", 4),
    screen: need<RectangleNode>("dev/screen"),
    io,
  };
  if (missing.length) return { missing };
  await loadFonts(textNodes(bound));
  return { bound, missing };
}

/** Every text node the renderer writes, so their fonts can be loaded up front. */
export function textNodes(b: Bound): TextNode[] {
  const out: TextNode[] = [
    b.irMnem,
    b.hl,
    b.cycles,
    b.alu.op,
    b.alu.in1,
    b.alu.in2,
    b.alu.out,
  ];
  for (const r of b.regs.values()) {
    out.push(r.value);
    if (r.dec) out.push(r.dec);
  }
  for (const w of [b.ram, b.pin])
    out.push(w.base, ...w.labels, ...w.cells.map((c) => c.v));
  out.push(b.buses.addr.value, b.buses.data.value, ...b.io.values());
  return out;
}

async function loadFonts(nodes: TextNode[]) {
  const fonts = new Map<string, FontName>();
  for (const n of nodes) {
    const names =
      n.fontName === figma.mixed
        ? n.getRangeAllFontNames(0, n.characters.length)
        : [n.fontName];
    for (const f of names) fonts.set(`${f.family}/${f.style}`, f);
  }
  await Promise.all([...fonts.values()].map((f) => figma.loadFontAsync(f)));
}

export interface CanvasRow extends TableRow {
  frame: FrameNode;
  texts: TextNode[];
}

/** Reads the DECODER / OPCODE TABLE frame. Rows are any child frames named row/…, in canvas order. */
export function readTableRows(b: Bound): {
  rows: CanvasRow[];
  errors: string[];
} {
  const rows: CanvasRow[] = [];
  const errors: string[] = [];
  for (const node of b.table.children) {
    if (node.type !== "FRAME" || !node.name.startsWith("row/")) continue;
    const get = (name: string) =>
      node.findOne(
        (n) => n.name === name && n.type === "TEXT",
      ) as TextNode | null;
    const [op, mnem, fmt, micro] = ["op", "mnem", "fmt", "micro"].map(get);
    if (!op || !mnem || !fmt || !micro) {
      errors.push(
        `${node.name}: needs text layers named op, mnem, fmt and micro`,
      );
      continue;
    }
    rows.push({
      op: op.characters,
      mnem: mnem.characters,
      fmt: fmt.characters,
      micro: micro.characters,
      where: node.id,
      frame: node,
      texts: [op, mnem, fmt, micro],
    });
  }
  return { rows, errors };
}
