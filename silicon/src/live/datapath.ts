// The datapath diagram: PC, MAR, RAM, MDR, IR, CONTROL, R0–R3, A, ALU, Y, FLAGS, OUT around the
// one 8-bit bus, as in src/cpu/cpu.ts. Every lamp is a probe bit (src/cpu/probes.ts) or another
// existing net; every transfer arrow has a lit copy bound to the control signal that makes the
// transfer happen (PC_OUT lights "PC → bus", MAR_LOAD lights "bus → MAR", …). The bus itself is
// drawn as its 8 wires, each lit while that bit is 1. No gate is added for any of it.
import { BUS_DRIVERS, OPCODES, type Signal, SIGNALS } from "../isa/spec";
import { opLineNet, tLineNet } from "./grid";
import { bound } from "./names";
import { type Ctx, frame, L, type Pt, rect, text } from "./style";
import { arrow, bitLabels, bitsMsbFirst, block, lamp, lampRow, tag } from "./widgets";

type Parent = BaseNode & ChildrenMixin;

export const DATAPATH_W = 1336;
export const DATAPATH_H = 480;

/** Arrow color of a control signal: drives the bus, loads from it, memory, ALU, control. */
export function signalColor(s: Signal): string {
  if ((BUS_DRIVERS as string[]).includes(s)) return L.drive;
  if (s === "MEM_READ" || s === "MEM_WRITE") return L.mem;
  if (s === "Y_LOAD" || s === "FLAGS_LOAD" || s === "PC_INC") return L.alu;
  if (s.endsWith("_LOAD")) return L.load;
  return L.ctrl;
}

/** One transfer: the net that lights it, its path (card coordinates) and its label. */
export interface Transfer {
  net: string;
  pts: Pt[];
  color: string;
  label: string;
  labelAt?: Pt;
}

// Column geometry (card coordinates).
const RAM_X = 16;
const RAM_W = 196;
const LEFT_X = 280;
const LEFT_W = 236;
const BUS_X = 584;
const BUS_W = 60;
const RIGHT_X = 712;
const RIGHT_W = 248;
const FAR_X = 1028;
const FAR_W = 292;
const TOP = 48;
const BOTTOM = 464;
const LAMP = 14;
const PITCH = 18;

const L_END = LEFT_X + LEFT_W; // 516
const BUS_R = BUS_X + BUS_W; // 644
const R_MID = RIGHT_X + RIGHT_W / 2;

/** Rows of the left column: PC, MAR, MDR, IR (y, h). */
const ROW = { PC: [48, 60], MAR: [122, 60], MDR: [196, 60], IR: [270, 60], CTRL: [352, 112] } as const;
const RROW = { REGS: [48, 122], A: [184, 48], ALU: [256, 76], Y: [358, 48] } as const;

/** Every transfer arrow of the diagram, by the net that lights it. */
export function transfers(): Transfer[] {
  const s = (net: Signal, pts: Pt[], label: string = net, labelAt?: Pt): Transfer => ({ net, pts, color: signalColor(net), label, ...(labelAt ? { labelAt } : {}) });
  const right = (y: number): Pt[] => [
    [L_END, y],
    [BUS_X, y],
  ];
  const left = (y: number): Pt[] => [
    [BUS_X, y],
    [L_END, y],
  ];
  const rRight = (y: number): Pt[] => [
    [BUS_R, y],
    [RIGHT_X, y],
  ];
  const rLeft = (y: number): Pt[] => [
    [RIGHT_X, y],
    [BUS_R, y],
  ];
  const ramR = RAM_X + RAM_W;
  return [
    s("PC_OUT", right(72)),
    s("PC_LOAD", left(94)),
    s("MAR_LOAD", left(152)),
    s("MEM_READ", [
      [ramR, 212],
      [LEFT_X, 212],
    ]),
    s("MEM_WRITE", [
      [LEFT_X, 234],
      [ramR, 234],
    ]),
    s("MDR_OUT", right(214)),
    s("MDR_LOAD", left(238)),
    // OUT ← MDR on a store to address 15 (out_load = MEM_WRITE · (MAR = 15), src/cpu/cpu.ts).
    { net: "out_load", pts: [[LEFT_X, 250], [ramR + 30, 250], [ramR + 30, 300], [ramR, 300]], color: L.out, label: "→OUT", labelAt: [-34, 4] },
    s("IR_LOAD", left(300)),
    s("REG_OUT_D", rLeft(80)),
    s("REG_OUT_S", rLeft(104)),
    s("REG_LOAD_D", rRight(140)),
    s("A_LOAD", rRight(208)),
    // The ALU's B input is the bus; it matters when Y_LOAD captures the result.
    s("Y_LOAD", rRight(294), "bus→B"),
    s("Y_LOAD", [
      [R_MID, RROW.ALU[0] + RROW.ALU[1]],
      [R_MID, RROW.Y[0]],
    ], "Y_LOAD", [6, 4]),
    s("Y_OUT", rLeft(382)),
    s("FLAGS_LOAD", [
      [RIGHT_X + RIGHT_W, 294],
      [FAR_X, 294],
    ]),
  ];
}

/** Every net the datapath binds, for tests and diagnostics. */
export function datapathNets(): string[] {
  const nets = new Set<string>(transfers().map((t) => t.net));
  const add = (name: string, width: number) => bitsMsbFirst(name, width).forEach((n) => nets.add(n));
  for (const [n, w] of [["pc", 4], ["mar", 4], ["mdr", 8], ["ir", 8], ["a", 8], ["y", 8], ["alu_y", 8], ["ram_out", 8], ["OUT", 8], ["t", 3], ["bus", 8], ["r0", 8], ["r1", 8], ["r2", 8], ["r3", 8]] as const) add(n, w);
  for (let k = 0; k < 4; k++) nets.add(`regs/load[${k}]`);
  for (let k = 0; k < 16; k++) nets.add(`ram/sel[${k}]`);
  for (const n of ["flag_z", "flag_c", "flag_n", "halted", "CLK", "PC_INC", "alu_sub", "alu/sel[0]", "alu/sel[1]", "alu/sel[2]", "alu/sel[3]", "alu/sel[4]"]) nets.add(n);
  for (const s of SIGNALS) nets.add(s);
  for (let t = 0; t < 8; t++) nets.add(tLineNet(t));
  for (const o of OPCODES) nets.add(opLineNet(o.mnem));
  return [...nets];
}

/** Draws the datapath card at (x, y). */
export function drawDatapath(ctx: Ctx, parent: Parent, x: number, y: number, w = DATAPATH_W, h = DATAPATH_H): FrameNode {
  const card = frame(ctx, parent, "datapath", x, y, w, h, { fill: L.card, radius: 12, stroke: L.line });
  text(ctx, card, "Datapath", 16, 14, { size: 13, font: "bold", name: "title" });
  text(ctx, card, "one 8-bit bus; an arrow lights while its control signal is 1, a lamp while its wire is 1 (all variable bindings: no extra gates)", 96, 17, {
    size: 10,
    color: L.text3,
    name: "subtitle",
  });

  // The bus: 8 wires, bit 7 on the left, each lit while the bit is 1.
  const bus = frame(ctx, card, "block/BUS", BUS_X, TOP, BUS_W, BOTTOM - TOP, { fill: "#262626", radius: 8, stroke: L.line });
  text(ctx, bus, "BUS", 0, 8, { size: 10, font: "bold", color: L.text, w: BUS_W, align: "CENTER", name: "title" });
  text(ctx, bus, "7 · · · · · · 0", 0, 22, { size: 7, font: "mono", color: L.text3, w: BUS_W, align: "CENTER", name: "bits" });
  bitsMsbFirst("bus", 8).forEach((n, i) => lamp(ctx, bus, n, 8 + i * 6.25, 36, 3, L.drive, { w: 3, h: BOTTOM - TOP - 48, radius: 1.5 }));

  // Left column: PC, MAR, MDR, IR.
  const reg = (name: string, title: string, sub: string, [by, bh]: readonly [number, number], probe: string, width: number, accent: string) => {
    const b = block(ctx, card, name, title, LEFT_X, by, LEFT_W, bh, sub, accent);
    lampRow(ctx, b, bitsMsbFirst(probe, width), 12, 34, LAMP, PITCH, L.bit);
    return b;
  };
  const pc = reg("PC", "PC", "program counter · 4 bits", ROW.PC, "pc", 4, L.load);
  tag(ctx, pc, "PC_INC", "+1", LEFT_W - 46, 30, L.alu, { w: 34, h: 18, size: 9 });
  reg("MAR", "MAR", "memory address · 4 bits", ROW.MAR, "mar", 4, L.load);
  reg("MDR", "MDR", "memory data · 8 bits", ROW.MDR, "mdr", 8, L.mem);
  const ir = reg("IR", "IR", "instruction · op | Rd | Rs", ROW.IR, "ir", 8, L.ctrl);
  text(ctx, ir, "opcode", 12, 50, { size: 7, font: "mono", color: L.text3, name: "field/op" });
  text(ctx, ir, "Rd", 12 + 4 * PITCH, 50, { size: 7, font: "mono", color: L.text3, name: "field/rd" });
  text(ctx, ir, "Rs", 12 + 6 * PITCH, 50, { size: 7, font: "mono", color: L.text3, name: "field/rs" });

  // RAM column: T-state / clock, RAM (address lines + the addressed byte), OUT.
  const st = block(ctx, card, "STATE", "T-STATE", RAM_X, ROW.PC[0], RAM_W, ROW.PC[1], "t[2:0] · clock · halted", L.ctrl);
  lampRow(ctx, st, bitsMsbFirst("t", 3), 12, 34, LAMP, PITCH, L.ctrl);
  text(ctx, st, "CLK", 84, 36, { size: 8, font: "mono", color: L.text3, name: "label/CLK" });
  lamp(ctx, st, "CLK", 106, 34, LAMP, L.drive);
  text(ctx, st, "HLT", 132, 36, { size: 8, font: "mono", color: L.text3, name: "label/HLT" });
  lamp(ctx, st, "halted", 156, 34, LAMP, L.out);
  const ram = block(ctx, card, "RAM", "RAM", RAM_X, ROW.MAR[0], RAM_W, ROW.MDR[0] + ROW.MDR[1] - ROW.MAR[0], "16 × 8 · D latches", L.mem);
  text(ctx, ram, "address (decoded MAR)", 12, 40, { size: 8, color: L.text3, name: "label/addr" });
  for (let k = 0; k < 16; k++) lamp(ctx, ram, `ram/sel[${k}]`, 12 + k * 10.5, 54, 8, L.mem, { radius: 2 });
  text(ctx, ram, "0", 12, 64, { size: 7, font: "mono", color: L.text3, name: "addr/0" });
  text(ctx, ram, "F", 12 + 15 * 10.5 + 2, 64, { size: 7, font: "mono", color: L.text3, name: "addr/F" });
  text(ctx, ram, "RAM[MAR]", 12, 80, { size: 8, color: L.text3, name: "label/data" });
  lampRow(ctx, ram, bitsMsbFirst("ram_out", 8), 12, 94, LAMP, PITCH, L.mem);
  bitLabels(ctx, ram, 8, 12, 111, PITCH, LAMP);
  const out = block(ctx, card, "OUT", "OUT", RAM_X, ROW.IR[0], RAM_W, ROW.IR[1], "port 15 · shown on the 7-segment", L.out);
  lampRow(ctx, out, bitsMsbFirst("OUT", 8), 12, 34, LAMP, PITCH, L.out);

  // Static links: MAR addresses the RAM, IR's opcode feeds the control unit, A feeds the ALU.
  arrow(ctx, card, null, [
    [LEFT_X, 152],
    [RAM_X + RAM_W, 152],
  ], L.text3, { label: "addr", labelAt: [-34, 4], name: "link/MAR→RAM" });
  arrow(ctx, card, null, [
    [LEFT_X + 60, ROW.IR[0] + ROW.IR[1]],
    [LEFT_X + 60, ROW.CTRL[0]],
  ], L.text3, { label: "opcode", labelAt: [6, 4], name: "link/IR→CONTROL" });
  arrow(ctx, card, null, [
    [R_MID, RROW.A[0] + RROW.A[1]],
    [R_MID, RROW.ALU[0]],
  ], L.text3, { label: "A", labelAt: [6, 4], name: "link/A→ALU" });

  // CONTROL: the T-state lines and the opcode lines (one-hot decoder outputs).
  const ctrl = block(ctx, card, "CONTROL", "CONTROL", RAM_X, ROW.CTRL[0], L_END - RAM_X, ROW.CTRL[1], "PLA from the microcode: T-state decoder · opcode decoder", L.ctrl);
  for (let t = 0; t < 8; t++) tag(ctx, ctrl, tLineNet(t), `T${t}`, 12 + t * 61, 38, L.blue, { w: 56, h: 18, size: 9, litText: "#FFFFFF" });
  [...OPCODES].sort((a, b) => a.code - b.code).forEach((o, i) => tag(ctx, ctrl, opLineNet(o.mnem), o.mnem, 12 + (i % 8) * 61, 62 + Math.floor(i / 8) * 22, L.blue, { w: 56, h: 18, size: 9, litText: "#FFFFFF" }));

  // Right column: registers, A latch, ALU, Y latch.
  const regs = block(ctx, card, "REGS", "REGISTERS", RIGHT_X, RROW.REGS[0], RIGHT_W, RROW.REGS[1], "R0–R3 · W = being written", L.bit);
  for (let k = 0; k < 4; k++) {
    const ry = 34 + k * 21;
    text(ctx, regs, `R${k}`, 12, ry + 2, { size: 9, font: "monoBold", color: L.text2, name: `label/R${k}` });
    lampRow(ctx, regs, bitsMsbFirst(`r${k}`, 8), 36, ry, LAMP, PITCH, L.bit);
    tag(ctx, regs, `regs/load[${k}]`, "W", 36 + 8 * PITCH + 6, ry - 1, L.load, { w: 28, h: 16, size: 8 });
  }
  const a = block(ctx, card, "A", "A", RIGHT_X, RROW.A[0], RIGHT_W, RROW.A[1], "ALU input latch", L.alu);
  lampRow(ctx, a, bitsMsbFirst("a", 8), 96, 17, LAMP, PITCH, L.bit);
  const alu = block(ctx, card, "ALU", "ALU", RIGHT_X, RROW.ALU[0], RIGHT_W, RROW.ALU[1], "A op bus", L.alu);
  const fns: Array<[string, string]> = [
    ["alu/sel[0]", "ADD"],
    ["alu_sub", "SUB"],
    ["alu/sel[1]", "AND"],
    ["alu/sel[2]", "OR"],
    ["alu/sel[3]", "XOR"],
    ["alu/sel[4]", "NOT"],
  ];
  fns.forEach(([net, label], i) => tag(ctx, alu, net, label, 70 + i * 29, 8, L.alu, { w: 27, h: 16, size: 7.5 }));
  lampRow(ctx, alu, bitsMsbFirst("alu_y", 8), 96, 38, LAMP, PITCH, L.alu);
  text(ctx, alu, "result", 12, 41, { size: 8, color: L.text3, name: "label/result" });
  const yb = block(ctx, card, "Y", "Y", RIGHT_X, RROW.Y[0], RIGHT_W, RROW.Y[1], "ALU result latch", L.alu);
  lampRow(ctx, yb, bitsMsbFirst("y", 8), 96, 17, LAMP, PITCH, L.bit);

  // Far column: control signals, flags, legend.
  const sig = block(ctx, card, "SIGNALS", "CONTROL SIGNALS", FAR_X, TOP, FAR_W, 210, "the PLA's outputs this T-state", L.ctrl);
  SIGNALS.forEach((s, i) => tag(ctx, sig, s, s, 12 + (i % 2) * 138, 38 + Math.floor(i / 2) * 19, signalColor(s), { w: 132, h: 16, size: 8.5 }));
  const fl = block(ctx, card, "FLAGS", "FLAGS", FAR_X, 270, FAR_W, 60, "Z C N ← ALU on FLAGS_LOAD; read by the jumps", L.alu);
  (["flag_z", "flag_c", "flag_n"] as const).forEach((n, i) => {
    text(ctx, fl, "ZCN"[i], 12 + i * 48, 36, { size: 9, font: "monoBold", color: L.text2, name: `label/${n}` });
    lamp(ctx, fl, n, 24 + i * 48, 34, LAMP, L.drive);
  });
  const lg = block(ctx, card, "LEGEND", "ARROWS", FAR_X, 344, FAR_W, BOTTOM - 344, undefined, undefined);
  const legend: Array<[string, string]> = [
    [L.drive, "drives the bus (…_OUT)"],
    [L.load, "loads from the bus (…_LOAD)"],
    [L.mem, "memory read / write"],
    [L.alu, "ALU, flags, PC + 1"],
    [L.out, "output port (store to 15)"],
  ];
  legend.forEach(([c, label], i) => {
    rect(ctx, lg, `swatch/${i}`, 12, 32 + i * 16, 18, 3, { fill: c, radius: 1.5 });
    text(ctx, lg, label, 38, 26 + i * 16, { size: 9, color: L.text2, name: `legend/${i}` });
  });

  // The transfers, last so they sit on top of the blocks' edges.
  for (const t of transfers()) arrow(ctx, card, t.net, t.pts, t.color, { label: t.label, ...(t.labelAt ? { labelAt: t.labelAt } : {}) });
  return card;
}

export { bound };
