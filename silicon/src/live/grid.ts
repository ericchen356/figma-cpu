// The microcode grid ("instruction-cycle flowchart"): rows = the 16 opcodes, columns = T0–T7,
// each cell = the register transfers of that micro-step. Generated from OPCODES / microcode()
// in src/isa/spec.ts, the same table the control PLA is synthesized from, so the picture
// cannot drift from the hardware. Columns where every opcode does the same thing (FETCH,
// T0–T2) are drawn once, as one tall cell.
//
// Live: the row highlight of opcode X is bound to ctrl/op_X (the opcode decoder line, i.e. the
// opcode in IR), the column highlight of Tk to ctrl/Tk (the T-state decoder line). The cell
// being executed is where the lit row crosses the lit column. A conditional jump's cell has a
// tag bound to the flag-qualified line ctrl/op_<J>if<F> (= op line · flag): lit when taken.
import { FETCH, type Flag, microcode, type MicroStep, OPCODES, type Signal, SIGNALS } from "../isa/spec";
import { bound } from "./names";
import { type Ctx, frame, L, rect, text } from "./style";
import { tag } from "./widgets";

type Parent = BaseNode & ChildrenMixin;

/** Register-transfer shorthand for each control signal (fallback: the signal's name). */
export const SHORT: Partial<Record<Signal, string>> = {
  PC_OUT: "PC→bus",
  MDR_OUT: "MDR→bus",
  REG_OUT_D: "Rd→bus",
  REG_OUT_S: "Rs→bus",
  Y_OUT: "Y→bus",
  MAR_LOAD: "bus→MAR",
  IR_LOAD: "bus→IR",
  MDR_LOAD: "bus→MDR",
  REG_LOAD_D: "bus→Rd",
  A_LOAD: "bus→A",
  PC_LOAD: "bus→PC",
  PC_INC: "PC+1",
  MEM_READ: "RAM→MDR",
  MEM_WRITE: "MDR→RAM",
  Y_LOAD: "ALU→Y",
  FLAGS_LOAD: "→ZCN",
  HALT: "HALT",
};
/** Signals drawn as a marker, not as text. */
const MARKERS: Signal[] = ["T_RESET"];

export const short = (s: Signal) => SHORT[s] ?? s;

/** Net names of the control unit's decoder lines (src/cpu/control.ts). */
export const tLineNet = (t: number) => `ctrl/T${t}`;
export const opLineNet = (mnem: string) => `ctrl/op_${mnem}`;
export const flagLineNet = (mnem: string, flag: Flag) => `ctrl/op_${mnem}if${flag}`;

export interface GridCell {
  t: number;
  /** The cell text: unconditional transfers, then "F? …" (only when flag F is 1). */
  text: string;
  signals: Signal[];
  /** Conditional part (jumps): the flag, its transfers and the flag-qualified decoder line. */
  when?: { flag: Flag; signals: Signal[]; net: string };
  /** The step ends the instruction (T_RESET). */
  end: boolean;
  halt: boolean;
}

export interface GridRow {
  code: number;
  mnem: string;
  operands: string;
  doc: string;
  opNet: string;
  /** By T-state; null where the instruction has no step (or the column is shared). */
  cells: (GridCell | null)[];
}

export interface MicrocodeTable {
  tStates: number;
  /** T-states every opcode executes identically (FETCH): drawn once, spanning all rows. */
  shared: Map<number, GridCell>;
  rows: GridRow[];
}

const cellOf = (mnem: string, s: MicroStep): GridCell => {
  const main = s.signals.filter((x) => !MARKERS.includes(x)).map(short);
  const when = s.when ? { flag: s.when.flag, signals: s.when.signals, net: flagLineNet(mnem, s.when.flag) } : undefined;
  const parts = [...main];
  if (when) parts.push(`${when.flag}? ${when.signals.map(short).join(" ")}`);
  return { t: s.t, text: parts.join("  ") || "–", signals: s.signals, ...(when ? { when } : {}), end: s.signals.includes("T_RESET"), halt: s.signals.includes("HALT") };
};

const sameStep = (a: MicroStep | undefined, b: MicroStep | undefined) =>
  !!a && !!b && !a.when && !b.when && a.signals.length === b.signals.length && a.signals.every((s, i) => s === b.signals[i]);

/** The grid's content, straight from the spec. */
export function microcodeTable(tStates = 8): MicrocodeTable {
  const ops = [...OPCODES].sort((a, b) => a.code - b.code);
  const stepAt = ops.map((op) => new Map(microcode(op).map((s) => [s.t, s])));
  const shared = new Map<number, GridCell>();
  for (let t = 0; t < tStates; t++) {
    const first = stepAt[0].get(t);
    if (first && stepAt.every((m) => sameStep(m.get(t), first))) shared.set(t, cellOf("", first));
  }
  const rows = ops.map((op, i): GridRow => ({
    code: op.code,
    mnem: op.mnem,
    operands: op.operands.join(", "),
    doc: op.doc,
    opNet: opLineNet(op.mnem),
    cells: Array.from({ length: tStates }, (_, t) => {
      const s = stepAt[i].get(t);
      return s && !shared.has(t) ? cellOf(op.mnem, s) : null;
    }),
  }));
  return { tStates, shared, rows };
}

/** Every net the grid binds (for tests and diagnostics). */
export function gridNets(table = microcodeTable()): string[] {
  const nets = new Set<string>();
  for (let t = 0; t < table.tStates; t++) nets.add(tLineNet(t));
  for (const r of table.rows) {
    nets.add(r.opNet);
    for (const c of r.cells) if (c?.when) nets.add(c.when.net);
  }
  return [...nets];
}

export interface GridLayout {
  w: number;
  h: number;
}

/** Draws the microcode card at (x, y) with width w; returns it (height from the row height). */
export function drawMicrocode(ctx: Ctx, parent: Parent, x: number, y: number, w: number, rowH = 21): FrameNode {
  const table = microcodeTable();
  const pad = 16;
  const top = 44;
  const headH = 22;
  const labelW = 156;
  const sharedW = 108;
  const nShared = table.shared.size;
  const nOther = table.tStates - nShared;
  const otherW = Math.floor((w - 2 * pad - labelW - nShared * sharedW) / Math.max(1, nOther));
  const colX: number[] = [];
  const colW: number[] = [];
  let cx = pad + labelW;
  for (let t = 0; t < table.tStates; t++) {
    colX.push(cx);
    colW.push(table.shared.has(t) ? sharedW : otherW);
    cx += colW[t];
  }
  const gridW = cx - pad;
  const rowsY = top + headH + 4;
  const h = rowsY + table.rows.length * rowH + pad;
  const card = frame(ctx, parent, "microcode", x, y, w, h, { fill: L.card, radius: 12, stroke: L.line });

  text(ctx, card, "Microcode", pad, 14, { size: 13, font: "bold", name: "title" });
  text(ctx, card, "the instruction cycle, generated from OPCODES in src/isa/spec.ts  ·  lit row = the opcode in IR  ·  lit column = the T-state", pad + 84, 17, {
    size: 10,
    color: L.text3,
    name: "subtitle",
  });
  // Legend (right).
  const lx = w - pad - 290;
  rect(ctx, card, "legend/end", lx, 18, 3, 11, { fill: L.ctrl, radius: 1.5 });
  text(ctx, card, "last step (T_RESET → T0)", lx + 8, 17, { size: 9.5, color: L.text3, name: "legend/end" });
  text(ctx, card, "F? …  only if flag F", lx + 148, 17, { size: 9.5, font: "mono", color: L.drive, name: "legend/cond" });

  // 1. Backgrounds: row stripes, step cells, the shared FETCH cells.
  table.rows.forEach((_, r) => {
    if (r % 2 === 0) rect(ctx, card, "stripe", pad, rowsY + r * rowH, gridW, rowH, { fill: "#292929", radius: 3 });
  });
  table.rows.forEach((row, r) =>
    row.cells.forEach((c, t) => {
      if (c) rect(ctx, card, `cell/${row.mnem}/T${t}`, colX[t] + 2, rowsY + r * rowH + 2, colW[t] - 4, rowH - 4, { fill: L.block, radius: 4 });
    }),
  );
  for (const [t] of table.shared)
    rect(ctx, card, `cell/FETCH/T${t}`, colX[t] + 2, rowsY + 2, colW[t] - 4, table.rows.length * rowH - 4, { fill: "#28303A", radius: 6 });

  // 2. Live highlights: one band per opcode row and per T column.
  table.rows.forEach((row, r) => {
    const f = frame(ctx, card, bound("row", row.opNet), pad, rowsY + r * rowH, gridW, rowH, { fill: null });
    const lit = rect(ctx, f, "lit", 0, 0, gridW, rowH, { fill: L.blue, fillOpacity: 0.16, radius: 4, stroke: L.blue });
    lit.strokes = [{ type: "SOLID", color: { r: 13 / 255, g: 153 / 255, b: 1 }, opacity: 0.55 }];
    lit.visible = false;
  });
  for (let t = 0; t < table.tStates; t++) {
    const colH = rowsY - top + table.rows.length * rowH;
    const f = frame(ctx, card, bound("col", tLineNet(t)), colX[t], top, colW[t], colH, { fill: null });
    const lit = frame(ctx, f, "lit", 0, 0, colW[t], colH, { fill: null });
    const band = rect(ctx, lit, "band", 0, 0, colW[t], colH, { fill: L.blue, fillOpacity: 0.12, radius: 5 });
    band.strokes = [{ type: "SOLID", color: { r: 13 / 255, g: 153 / 255, b: 1 }, opacity: 0.5 }];
    rect(ctx, lit, "head", 2, 2, colW[t] - 4, headH - 2, { fill: L.blue, radius: 4 });
    lit.visible = false;
  }

  // 3. Text on top: the T header, row labels, cell transfers, end markers, condition tags.
  for (let t = 0; t < table.tStates; t++)
    text(ctx, card, `T${t}`, colX[t], top + 1, { size: 10.5, font: "monoBold", color: L.text, w: colW[t], h: headH, align: "CENTER", valign: "CENTER", name: `head/T${t}` });
  text(ctx, card, "opcode", pad + 8, top + 5, { size: 9.5, color: L.text3, name: "head/opcode" });
  table.rows.forEach((row, r) => {
    const ry = rowsY + r * rowH;
    const mid = ry + rowH / 2;
    text(ctx, card, row.code.toString(16).toUpperCase(), pad + 8, mid - 6, { size: 9.5, font: "mono", color: L.text3, name: `code/${row.mnem}` });
    text(ctx, card, row.mnem, pad + 24, mid - 7, { size: 11, font: "semibold", color: L.text, name: `mnem/${row.mnem}` });
    if (row.operands) text(ctx, card, row.operands, pad + 66, mid - 6, { size: 9.5, font: "mono", color: L.text3, name: `operands/${row.mnem}` });
    row.cells.forEach((c, t) => {
      if (!c) return;
      const cw = colW[t];
      const cx0 = colX[t];
      text(ctx, card, c.text, cx0 + 8, mid - 6, { size: 9.5, font: "mono", color: c.halt ? L.out : c.when ? L.drive : c.signals.length === 1 && c.end ? L.text3 : L.text2, name: `step/${row.mnem}/T${t}` });
      if (c.end) rect(ctx, card, `end/${row.mnem}`, cx0 + cw - 7, ry + 5, 3, rowH - 10, { fill: L.ctrl, radius: 1.5 });
      if (c.when) tag(ctx, card, c.when.net, "taken", cx0 + cw - 50, ry + 3, L.drive, { w: 38, h: rowH - 6, size: 7.5 });
    });
  });
  for (const [t, c] of table.shared) {
    const cx0 = colX[t];
    const midY = rowsY + (table.rows.length * rowH) / 2;
    text(ctx, card, "FETCH", cx0, midY - 34, { size: 9, font: "semibold", color: L.text3, w: colW[t], align: "CENTER", tracking: 8, name: `fetch/T${t}` });
    text(ctx, card, c.text.split("  ").join("\n"), cx0, midY - 14, { size: 10, font: "mono", color: L.text2, w: colW[t], align: "CENTER", lineHeight: 15, name: `step/FETCH/T${t}` });
  }
  return card;
}
