// Renderer: writes CPU state onto the bound canvas nodes. Only nodes whose value changed
// are touched (Figma node writes are the bottleneck, not the CPU).
import { Cpu, hex } from "../core/cpu";
import type { OpRow, OpTable } from "../core/micro";
import type { TResult } from "../core/rtl";
import { IO, MAX_TSTATES, REGISTERS, SIGNALS } from "../core/spec";
import { type Bound, child, childText } from "./bind";

// Same palette as tools/draw-machine/draw.js.
const C = {
  cell: "#262626",
  stroke: "#2E2E2E",
  text: "#E8E8E8",
  lampOff: "#333333",
  lampOn: "#F5C542",
  active: "#2BD67B",
  bus: "#4A3B1E",
  busOn: "#F59E0B",
  rowOn: "#1F3A2B",
  pcCell: "#1F3A2B",
  marCell: "#4A3B1E",
};

const paints = new Map<string, Paint[]>();
function solid(hexColor: string): Paint[] {
  let p = paints.get(hexColor);
  if (!p) {
    const n = parseInt(hexColor.slice(1), 16);
    p = [{ type: "SOLID", color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 } }];
    paints.set(hexColor, p);
  }
  return p;
}

export type ViewMode = "watch" | "instr";

export interface View {
  cpu: Cpu;
  table: OpTable;
  mode: ViewMode;
  /** The T-state just executed (Watch mode). */
  tres: TResult | null;
  pinBase: number;
}

interface RegView {
  root?: SceneNode;
  value?: TextNode;
  dec?: TextNode;
  bits: (SceneNode | undefined)[];
}

interface LampView {
  root?: SceneNode;
  lamp?: SceneNode;
  label?: TextNode;
}

export class Renderer {
  private texts = new Map<string, string>();
  private fills = new Map<string, string>();
  private strokes = new Map<string, string>();
  private ranges = new Map<string, string>();

  private regs: RegView[];
  private wide: Record<"PC" | "SP" | "IR", RegView>;
  private irMnem?: TextNode;
  private lamps = new Map<string, LampView>();
  private ramCells: (TextNode | undefined)[] = [];
  private ramFrames: (SceneNode | undefined)[] = [];
  private ramRows: (TextNode | undefined)[] = [];
  private pinCells: (TextNode | undefined)[] = [];
  private pinRows: (TextNode | undefined)[] = [];
  private lastRegs: number[] = [];
  private highlightedRow: OpRow | null = null;

  constructor(private b: Bound) {
    const get = (n: string) => b.byName.get(n);
    const regView = (n: SceneNode | undefined, bits: number): RegView => ({
      root: n,
      value: childText(n, "value"),
      dec: childText(n, "dec"),
      bits: Array.from({ length: bits }, (_, i) => child(n, `bit/${i}`)),
    });
    this.regs = REGISTERS.map((r) => regView(get(`cpu/reg/${r}`), 8));
    this.wide = { PC: regView(get("cpu/reg/PC"), 16), SP: regView(get("cpu/reg/SP"), 16), IR: regView(get("cpu/reg/IR"), 8) };
    this.irMnem = childText(get("cpu/reg/IR"), "mnem");
    const lampNames = [
      "cpu/flag/Z",
      "cpu/flag/C",
      "cpu/flag/N",
      "cpu/phase/FETCH",
      "cpu/phase/DECODE",
      "cpu/phase/EXEC",
      "cpu/clock",
      ...Array.from({ length: MAX_TSTATES }, (_, t) => `cpu/tstate/T${t}`),
      ...SIGNALS.map((s) => `cpu/sig/${s.name}`),
    ];
    for (const n of lampNames) {
      const root = get(n);
      this.lamps.set(n, { root, lamp: child(root, "lamp"), label: childText(root, "label") });
    }
    for (let i = 0; i < 256; i++) {
      const cell = get(`mem/ram/cell/${hex(i, 2)}`);
      this.ramFrames.push(cell);
      this.ramCells.push(childText(cell, "v"));
    }
    for (let r = 0; r < 16; r++) this.ramRows.push(get(`mem/ram/addr/${hex(r, 1)}`) as TextNode | undefined);
    for (let i = 0; i < 64; i++) this.pinCells.push(childText(get(`mem/pin/cell/${hex(i, 2)}`), "v"));
    for (let r = 0; r < 4; r++) this.pinRows.push(get(`mem/pin/addr/${hex(r, 1)}`) as TextNode | undefined);
  }

  // ---------- diffed writes ----------

  private text(node: TextNode | undefined, s: string): void {
    if (!node || this.texts.get(node.id) === s) return;
    if (node.characters !== s) node.characters = s;
    this.texts.set(node.id, s);
  }

  private fill(node: SceneNode | undefined, color: string): void {
    if (!node || this.fills.get(node.id) === color || !("fills" in node)) return;
    (node as GeometryMixin).fills = solid(color);
    this.fills.set(node.id, color);
  }

  private stroke(node: SceneNode | undefined, color: string, weight = 2): void {
    const key = `${color}/${weight}`;
    if (!node || this.strokes.get(node.id) === key || !("strokes" in node)) return;
    (node as GeometryMixin).strokes = solid(color);
    (node as GeometryMixin & { strokeWeight: number }).strokeWeight = weight;
    this.strokes.set(node.id, key);
  }

  private lamp(name: string, on: boolean, color = C.lampOn): void {
    const l = this.lamps.get(name);
    this.fill(l?.lamp, on ? color : C.lampOff);
  }

  private bits(view: RegView, value: number): void {
    view.bits.forEach((b, i) => this.fill(b, (value >> i) & 1 ? C.lampOn : C.lampOff));
  }

  // ---------- frame ----------

  render(v: View): void {
    const { cpu, mode, tres } = v;
    const watch = mode === "watch" && tres !== null;
    const sigs = new Set(watch ? tres!.sigs.map((s) => s.s) : []);
    const loadedRegs = new Set<number>();
    if (watch) for (const s of tres!.sigs) if (s.s === "REG_LOAD") loadedRegs.add(s.r!);

    // Registers A–L
    this.regs.forEach((view, i) => {
      const val = cpu.r[i];
      this.text(view.value, hex(val, 2));
      this.text(view.dec, String(val));
      this.bits(view, val);
      const changed = this.lastRegs[i] !== undefined && this.lastRegs[i] !== val;
      const hot = watch ? loadedRegs.has(i) : changed;
      this.stroke(view.root, hot ? C.active : C.stroke, hot ? 3 : 2);
    });
    this.lastRegs = Array.from(cpu.r);
    this.text(this.b.byName.get("cpu/reg/HL") as TextNode, `H:L = ${hex(cpu.hl, 4)}`);

    // Control
    const { PC, SP, IR } = this.wide;
    this.text(PC.value, hex(cpu.pc, 4));
    this.bits(PC, cpu.pc);
    this.stroke(PC.root, watch && (sigs.has("PC_INC") || sigs.has("PC_LOAD") || sigs.has("PCH_LOAD") || sigs.has("PCL_LOAD")) ? C.active : C.stroke);
    this.text(SP.value, hex(cpu.sp, 4));
    this.bits(SP, cpu.sp);
    this.stroke(SP.root, watch && (sigs.has("SP_INC") || sigs.has("SP_DEC")) ? C.active : C.stroke);
    this.text(IR.value, hex(cpu.ir, 2));
    this.bits(IR, cpu.ir);
    this.stroke(IR.root, watch && sigs.has("IR_LOAD") ? C.active : C.stroke);
    const row = v.table.byOp[cpu.ir];
    this.text(this.irMnem, watch && tres!.phase === "FETCH" && !tres!.decoded ? "…" : (row?.mnem ?? "???"));

    this.lamp("cpu/phase/FETCH", watch && tres!.phase === "FETCH");
    this.lamp("cpu/phase/DECODE", watch && tres!.decoded);
    this.lamp("cpu/phase/EXEC", watch && tres!.phase === "EXEC");
    this.lamp("cpu/clock", cpu.tstates % 2 === 1);
    this.text(this.b.byName.get("cpu/cycles") as TextNode, `instr ${cpu.instructions} · T-states ${cpu.tstates}`);

    // ALU + flags
    const alu = watch ? tres!.alu : cpu.lastAlu;
    const get = (n: string) => this.b.byName.get(n);
    this.text(get("cpu/alu/op") as TextNode, alu ? alu.op : "—");
    this.text(get("cpu/alu/in1") as TextNode, hex(cpu.a, 2));
    this.text(get("cpu/alu/in2") as TextNode, alu ? hex(alu.b, 2) : "00");
    this.text(get("cpu/alu/out") as TextNode, hex(cpu.y, 2));
    this.stroke(get("cpu/alu/body"), watch && sigs.has("ALU_OP") ? C.active : C.stroke);
    this.lamp("cpu/flag/Z", cpu.z);
    this.lamp("cpu/flag/C", cpu.c);
    this.lamp("cpu/flag/N", cpu.n);

    // Buses: in Watch the value actually driven this T-state; otherwise the last memory access.
    const addr = watch ? tres!.addrBus : cpu.mar;
    const data = watch ? tres!.dataBus : cpu.mdr;
    for (const [name, value, width] of [
      ["cpu/bus/addr", addr, 4],
      ["cpu/bus/data", data, 2],
    ] as const) {
      const bus = get(name);
      const driven = watch && value !== null;
      this.text(childText(bus, "value"), value === null ? "-".repeat(width) : hex(value, width));
      this.fill(child(bus, "wire"), driven ? C.busOn : C.bus);
    }
    const anyBus = watch && (tres!.addrBus !== null || tres!.dataBus !== null);
    for (const [name, node] of this.b.byName) if (name.startsWith("cpu/bus/tap/")) this.fill(node, anyBus ? C.busOn : C.bus);

    // Datapath internals
    this.text(childText(get("cpu/reg/MAR"), "value"), hex(cpu.mar, 4));
    this.text(childText(get("cpu/reg/MDR"), "value"), hex(cpu.mdr, 2));
    this.text(childText(get("cpu/latch/OPR"), "value"), hex(cpu.opr, 2));
    this.text(childText(get("cpu/latch/T"), "value"), hex(cpu.t, 2));
    this.text(childText(get("cpu/latch/W"), "value"), hex(cpu.w, 4));
    const loads: [string, string[]][] = [
      ["cpu/reg/MAR", ["MAR_LOAD"]],
      ["cpu/reg/MDR", ["MDR_LOAD", "MEM_READ"]],
      ["cpu/latch/OPR", ["OPR_LOAD"]],
      ["cpu/latch/T", ["T_LOAD"]],
      ["cpu/latch/W", ["W_LO_LOAD", "W_HI_LOAD"]],
    ];
    for (const [name, on] of loads) this.stroke(get(name), on.some((s) => sigs.has(s)) ? C.active : C.stroke);
    this.text(childText(get("cpu/tstate"), "value"), watch ? `T${tres!.t}` : "—");
    for (let t = 0; t < MAX_TSTATES; t++) this.lamp(`cpu/tstate/T${t}`, watch && tres!.t === t, C.active);
    for (const s of SIGNALS) {
      const on = sigs.has(s.name);
      const name = `cpu/sig/${s.name}`;
      this.lamp(name, on, s.drives ? C.busOn : C.lampOn); // bus drivers glow orange like the bus
      if (s.name === "REG_OUT" || s.name === "REG_LOAD") {
        const sig = watch ? tres!.sigs.find((x) => x.s === s.name) : undefined;
        this.text(this.lamps.get(name)?.label, sig ? `${s.name}(${REGISTERS[sig.r!]})` : s.name);
      }
    }

    // Decoder: highlight the row being executed, and in Watch the current micro-op step.
    const current = watch ? tres!.row : cpu.instructions > 0 || cpu.halted ? row ?? null : null;
    if (this.highlightedRow && this.highlightedRow !== current) this.rowHighlight(this.highlightedRow, false, -1);
    if (current) this.rowHighlight(current, true, watch ? tres!.step : -1);
    this.highlightedRow = current;

    // RAM window follows PC (its 256-byte page); pinned window shows pinBase.
    const base = cpu.pc & 0xff00;
    this.text(get("mem/ram/base") as TextNode, `base ${hex(base, 4)}`);
    for (let r = 0; r < 16; r++) this.text(this.ramRows[r], hex(base + r * 16, 4));
    for (let i = 0; i < 256; i++) {
      const a = base + i;
      this.text(this.ramCells[i], hex(cpu.mem[a], 2));
      const isPc = a === cpu.pc;
      const isMar = watch && a === cpu.mar && (sigs.has("MEM_READ") || sigs.has("MEM_WRITE"));
      this.fill(this.ramFrames[i], isMar ? C.marCell : isPc ? C.pcCell : C.cell);
    }
    const pin = v.pinBase & 0xffc0;
    this.text(get("mem/pin/base") as TextNode, `base ${hex(pin, 4)}`);
    for (let r = 0; r < 4; r++) this.text(this.pinRows[r], hex(pin + r * 16, 4));
    for (let i = 0; i < 64; i++) this.text(this.pinCells[i], hex(cpu.mem[(pin + i) & 0xffff], 2));

    // IO
    for (const [k, a] of Object.entries(IO)) this.text(childText(get(`mem/io/${k}`), "value"), hex(cpu.mem[a], 2));
  }

  private rowHighlight(row: OpRow, on: boolean, step: number): void {
    const nodes = this.b.rows.find((r) => r.op.characters.trim().toUpperCase() === hex(row.op, 2));
    if (!nodes) return;
    this.fill(nodes.frame, on ? C.rowOn : C.cell);
    // Color just the active micro-op step inside the micro column.
    const micro = nodes.micro;
    const key = `${micro.characters}|${on ? step : -1}`;
    if (this.ranges.get(micro.id) === key) return;
    const len = micro.characters.length;
    if (len > 0) micro.setRangeFills(0, len, solid(C.text));
    if (on && step >= 0) {
      let idx = 0;
      let start = 0;
      for (const seg of micro.characters.split(";")) {
        const end = start + seg.length;
        if (seg.trim().length > 0) {
          if (idx === step) {
            const lead = seg.length - seg.trimStart().length;
            micro.setRangeFills(start + lead, start + lead + seg.trim().length, solid(C.active));
            break;
          }
          idx++;
        }
        start = end + 1;
      }
    }
    this.ranges.set(micro.id, key);
  }

  setScreen(imageHash: string): void {
    const screen = this.b.byName.get("dev/screen") as RectangleNode | undefined;
    if (screen) screen.fills = [{ type: "IMAGE", imageHash, scaleMode: "FILL" }];
  }
}
