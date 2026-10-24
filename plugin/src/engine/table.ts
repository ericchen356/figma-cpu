// LANE: engine. Reads the opcode table FROM THE CANVAS (never spec/). The canvas text may drift, so rows are
// re-read live each time and every micro string is validated; a bad row is reported, never silently skipped.
import { N } from "../contracts/nodes";
import type { OpcodeRow } from "../contracts/spec";
import { parseMicro, type MicroOp } from "./microops";

/** Minimal tree shape so the reader runs against live Figma nodes AND JSON fixtures. */
export interface TreeNode {
  name: string;
  type?: string;
  characters?: string;
  children?: TreeNode[];
}

export interface TableRow extends OpcodeRow {
  ops: MicroOp[];
}
export interface TableReadResult {
  rows: TableRow[]; // valid rows only, in canvas order
  byOp: Map<number, TableRow>;
  problems: string[]; // human-readable, includes the row op / mnemonic
}

/** Map a live Figma node (or any node-like) into a TreeNode. Only the fields we need. */
export function toTree(n: any): TreeNode {
  const t: TreeNode = { name: n.name, type: n.type };
  if (n.type === "TEXT") t.characters = n.characters;
  if (Array.isArray(n.children)) t.children = n.children.map(toTree);
  return t;
}

export function findByName(root: TreeNode, name: string): TreeNode | undefined {
  if (root.name === name) return root;
  for (const c of root.children || []) {
    const r = findByName(c, name);
    if (r) return r;
  }
  return undefined;
}

const text = (row: TreeNode, field: string): string | undefined =>
  (row.children || []).find((c) => c.name === field && c.type !== "FRAME")?.characters;

/** `root` = the page/frame containing cpu/decoder/table, or the table node itself. */
export function readTable(root: TreeNode): TableReadResult {
  const problems: string[] = [];
  const out: TableRow[] = [];
  const table = findByName(root, N.decoderTable);
  if (!table) return { rows: out, byOp: new Map(), problems: [`node "${N.decoderTable}" not found`] };

  const seen = new Set<number>();
  for (const r of table.children || []) {
    if (!r.name.startsWith("row/")) continue; // header cells etc.
    const idText = r.name.slice(4).trim();
    const labelled = (text(r, "op") ?? idText).trim();
    if (labelled.toUpperCase() !== idText.toUpperCase())
      problems.push(`${r.name}: op text "${labelled}" disagrees with layer name; using the text`);
    const op = parseInt(labelled, 16);
    if (!/^[0-9a-fA-F]{1,2}$/.test(labelled) || Number.isNaN(op)) {
      problems.push(`${r.name}: op "${labelled}" is not a hex byte`);
      continue;
    }
    if (seen.has(op)) { problems.push(`${r.name}: duplicate opcode ${labelled.toUpperCase()}`); continue; }
    const mnem = (text(r, "mnem") ?? "").trim().toUpperCase();
    const fmt = (text(r, "fmt") ?? "-").trim() || "-";
    const micro = (text(r, "micro") ?? "").trim();
    if (!mnem) { problems.push(`${r.name}: empty mnemonic`); continue; }
    const parsed = parseMicro(micro);
    if (parsed.errors.length) {
      problems.push(`${r.name} ${mnem}: ${parsed.errors.join("; ")}`);
      continue;
    }
    seen.add(op);
    out.push({ op: labelled.toUpperCase().padStart(2, "0"), mnem, fmt, micro, ops: parsed.ops });
  }
  const byOp = new Map(out.map((r) => [parseInt(r.op, 16), r] as const));
  return { rows: out, byOp, problems };
}
