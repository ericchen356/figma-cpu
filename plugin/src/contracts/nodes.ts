// Node-name contract. SOURCE OF TRUTH: tools/draw-machine/draw.js (what is actually drawn),
// which follows PRD §4.2. The canvas team owns names; if they change, update ONLY this file.
// Engine / screen / UI code must never build a node name by hand.

export const REGS = ["A", "B", "C", "D", "H", "L"] as const;
export type Reg = (typeof REGS)[number];
export type Flag = "Z" | "C" | "N";
export const FLAGS: Flag[] = ["Z", "C", "N"];
export type Phase = "FETCH" | "DECODE" | "EXEC";

export const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, "0");

export const N = {
  page: "Machine v2",
  // Plugin-team sandbox: made by tools/clone-test-page. The plugin prefers it, so tests never touch the canvas team's page.
  testPage: "Machine v2 (plugin test)",
  // 6 general registers are instances of the `Register` component set (children: name, value, dec, bit/0..7)
  reg: (r: Reg) => `cpu/reg/${r}`,
  // 16-bit PC/SP and the IR are frames (children: label, value, bit/0..15)
  pc: "cpu/reg/PC",
  sp: "cpu/reg/SP",
  ir: "cpu/reg/IR",
  hl: "cpu/reg/HL", // text node "H:L = 0000"
  flag: (f: Flag) => `cpu/flag/${f}`, // frame, child "lamp"
  phase: (p: Phase) => `cpu/phase/${p}`, // frame, child "lamp"
  clock: "cpu/clock",
  cycles: "cpu/cycles", // text "cycles 0"
  alu: { op: "cpu/alu/op", in1: "cpu/alu/in1", in2: "cpu/alu/in2", out: "cpu/alu/out" },
  busAddr: "cpu/bus/addr", // frame, child "value"
  busData: "cpu/bus/data",
  decoderTable: "cpu/decoder/table", // children: row/<hex op>, each with op|mnem|fmt|micro text nodes
  row: (op: string) => `row/${op}`,
  ramCell: (addr: number) => `mem/ram/cell/${hex(addr, 2)}`, // 256-byte window, addr = offset 0..255
  ramBase: "mem/ram/base", // text "base 0000"
  pinCell: (off: number) => `mem/pin/cell/${hex(off, 2)}`, // 64-byte pinned window
  pinBase: "mem/pin/base",
  io: (name: IoName) => `mem/io/${name}`, // frame, child "value"
  screen: "dev/screen", // THE image-fill rectangle
  palette: (i: number) => `dev/palette/${i}`,
} as const;

export type IoName = "MOUSE_X" | "MOUSE_Y" | "MOUSE_BTN" | "KEY" | "TICK" | "RAND";

// Every node the binder must resolve. Used by bind() to fail loudly with the missing names.
export function requiredNames(): string[] {
  const out: string[] = [N.pc, N.sp, N.ir, N.hl, N.clock, N.cycles, N.busAddr, N.busData, N.decoderTable, N.screen, N.ramBase, N.pinBase];
  REGS.forEach((r) => out.push(N.reg(r)));
  FLAGS.forEach((f) => out.push(N.flag(f)));
  (["FETCH", "DECODE", "EXEC"] as Phase[]).forEach((p) => out.push(N.phase(p)));
  Object.values(N.alu).forEach((n) => out.push(n));
  for (let i = 0; i < 256; i++) out.push(N.ramCell(i));
  for (let i = 0; i < 64; i++) out.push(N.pinCell(i));
  (["MOUSE_X", "MOUSE_Y", "MOUSE_BTN", "KEY", "TICK", "RAND"] as IoName[]).forEach((n) => out.push(N.io(n)));
  return out;
}
