// Binder: finds the drawn machine and maps contract names (PRD §4.2) to node handles once,
// so the renderer never searches the tree while the CPU is running.
import type { RowSource } from "../core/micro";
import { IO, MAX_TSTATES, REGISTERS, SIGNALS } from "../core/spec";

export const MACHINE_FRAME = "Machine v2";

export interface RowNodes {
  frame: FrameNode;
  op: TextNode;
  mnem: TextNode;
  fmt: TextNode;
  micro: TextNode;
}

export interface Bound {
  root: FrameNode;
  byName: Map<string, SceneNode>;
  rows: RowNodes[];
  /** Contract names the drawing doesn't have. Rendering skips them. */
  missing: string[];
}

const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, "0");

export function requiredNames(): string[] {
  const names = [
    ...REGISTERS.map((r) => `cpu/reg/${r}`),
    "cpu/reg/PC",
    "cpu/reg/SP",
    "cpu/reg/IR",
    "cpu/reg/HL",
    "cpu/reg/MAR",
    "cpu/reg/MDR",
    "cpu/latch/OPR",
    "cpu/latch/T",
    "cpu/latch/W",
    "cpu/flag/Z",
    "cpu/flag/C",
    "cpu/flag/N",
    "cpu/alu/op",
    "cpu/alu/in1",
    "cpu/alu/in2",
    "cpu/alu/out",
    "cpu/bus/addr",
    "cpu/bus/data",
    "cpu/phase/FETCH",
    "cpu/phase/DECODE",
    "cpu/phase/EXEC",
    "cpu/clock",
    "cpu/cycles",
    "cpu/decoder/table",
    "cpu/tstate",
    "mem/ram/base",
    "mem/pin/base",
    "dev/screen",
  ];
  for (let i = 0; i < 256; i++) names.push(`mem/ram/cell/${hex(i, 2)}`);
  for (let i = 0; i < 64; i++) names.push(`mem/pin/cell/${hex(i, 2)}`);
  for (const k of Object.keys(IO)) names.push(`mem/io/${k}`);
  for (let t = 0; t < MAX_TSTATES; t++) names.push(`cpu/tstate/T${t}`);
  for (const s of SIGNALS) names.push(`cpu/sig/${s.name}`);
  return names;
}

/** The machine frame on the given page (default: the current page). */
export function findMachine(page: PageNode = figma.currentPage): FrameNode | null {
  const f = page.children.find((n) => n.type === "FRAME" && n.name === MACHINE_FRAME);
  return (f as FrameNode) || null;
}

export function childText(node: BaseNode | undefined, name: string): TextNode | undefined {
  if (!node || !("findOne" in node)) return undefined;
  const t = (node as FrameNode).findOne((n) => n.name === name && n.type === "TEXT");
  return (t as TextNode) || undefined;
}

export function child(node: BaseNode | undefined, name: string): SceneNode | undefined {
  if (!node || !("findOne" in node)) return undefined;
  return (node as FrameNode).findOne((n) => n.name === name) || undefined;
}

function bindRows(table: SceneNode | undefined): RowNodes[] {
  if (!table || !("children" in table)) return [];
  const rows: RowNodes[] = [];
  for (const n of (table as FrameNode).children) {
    if (!n.name.startsWith("row/") || n.type !== "FRAME") continue;
    const op = childText(n, "op");
    const mnem = childText(n, "mnem");
    const fmt = childText(n, "fmt");
    const micro = childText(n, "micro");
    if (op && mnem && fmt && micro) rows.push({ frame: n, op, mnem, fmt, micro });
  }
  return rows;
}

/** Loads every font used by text inside the machine, so any text can be rewritten. */
async function loadFonts(root: FrameNode): Promise<void> {
  const seen = new Map<string, FontName>();
  for (const t of root.findAllWithCriteria({ types: ["TEXT"] })) {
    const fonts =
      t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName as FontName];
    for (const f of fonts) seen.set(`${f.family}/${f.style}`, f);
  }
  await Promise.all([...seen.values()].map((f) => figma.loadFontAsync(f)));
}

export async function bindMachine(root: FrameNode): Promise<Bound> {
  const byName = new Map<string, SceneNode>();
  for (const n of root.findAll((x) => /^(cpu|mem|dev)\//.test(x.name))) if (!byName.has(n.name)) byName.set(n.name, n);
  await loadFonts(root);
  const missing = requiredNames().filter((n) => !byName.has(n));
  return { root, byName, rows: bindRows(byName.get("cpu/decoder/table")), missing };
}

/** Re-binds just the table rows (after rows were added or removed on the canvas). */
export function rebindRows(b: Bound): void {
  b.rows = bindRows(b.byName.get("cpu/decoder/table"));
}

/** Reads the opcode table straight off the canvas. */
export function readRows(b: Bound): RowSource[] {
  const table = b.byName.get("cpu/decoder/table") as FrameNode | undefined;
  if (table && table.children.filter((n) => n.name.startsWith("row/")).length !== b.rows.length) rebindRows(b);
  return b.rows
    .filter((r) => !r.frame.removed)
    .map((r) => ({ op: r.op.characters, mnem: r.mnem.characters, fmt: r.fmt.characters, micro: r.micro.characters }));
}
