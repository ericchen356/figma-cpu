// Writes CPU state onto the canvas. Every write is diffed against a cache, so a
// frame only touches nodes whose text/colour actually changed. Highlights are
// recomputed from scratch each phase, so stale ones clear themselves.
import type { Bound, Paintable } from "./binder";
import { CPU, hex, type Trace } from "./cpu";

const COL = {
  cell: "#262626",
  stroke: "#2E2E2E",
  lampOff: "#333333",
  bit: "#F5C542",
  active: "#2BD67B",
  flag: "#2BD67B",
  bus: "#4A3B1E",
  busOn: "#F59E0B",
  read: "#1E3A5F",
  write: "#1F5A3A",
  pc: "#4A3B1E",
  rowOn: "#1F4D33",
  aluOn: "#1F3D2C",
};

type Phase = "FETCH" | "DECODE" | "EXEC";

interface Highlights {
  phase: Phase | null;
  regs: Set<string>;
  row: number | null;
  alu: boolean;
  addrBus: number | null;
  dataBus: number | null;
  taps: Set<string>;
  read: Set<number>;
  written: Set<number>;
}

const none = (): Highlights => ({
  phase: null,
  regs: new Set(),
  row: null,
  alu: false,
  addrBus: null,
  dataBus: null,
  taps: new Set(),
  read: new Set(),
  written: new Set(),
});

function solid(hexColor: string): SolidPaint {
  const n = parseInt(hexColor.slice(1), 16);
  return {
    type: "SOLID",
    color: {
      r: ((n >> 16) & 255) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255,
    },
  };
}

const REG_ORDER = ["A", "B", "C", "D", "H", "L"];

export class Renderer {
  ramBase = 0;
  pinBase = 0x4000;
  private texts = new Map<TextNode, string>();
  private fills = new Map<SceneNode, string>();
  private strokes = new Map<SceneNode, string>();
  /** Opcode → its row frame on the canvas (rebuilt whenever the table is re-read). */
  rows = new Map<number, Paintable>();

  constructor(private b: Bound) {
    const m = /([0-9a-f]{4})/i.exec(b.pin.base.characters);
    if (m) this.pinBase = parseInt(m[1], 16);
  }

  // ---- diffed primitives ----

  private text(n: TextNode, s: string) {
    if (this.texts.get(n) === s) return;
    if (n.characters !== s) n.characters = s;
    this.texts.set(n, s);
  }

  private fill(n: Paintable, color: string) {
    if (this.fills.get(n) === color) return;
    n.fills = [solid(color)];
    this.fills.set(n, color);
  }

  private stroke(n: Paintable, color: string, weight: number) {
    const key = `${color}/${weight}`;
    if (this.strokes.get(n) === key) return;
    n.strokes = [solid(color)];
    n.strokeWeight = weight;
    this.strokes.set(n, key);
  }

  // ---- phases ----

  /** FETCH: PC drives the address bus, the opcode comes back on the data bus into IR. */
  renderFetch(cpu: CPU, tr: Trace) {
    const h = none();
    h.phase = "FETCH";
    h.regs.add("PC").add("IR");
    h.addrBus = tr.fetchAddr;
    h.dataBus = tr.opcode;
    h.read.add(tr.fetchAddr);
    ["control", "ram/addr", "ram/data", "decoder"].forEach((t) =>
      h.taps.add(t),
    );
    this.wide("PC", tr.fetchAddr, 16);
    this.wide("IR", tr.opcode, 8);
    this.followPc(tr.fetchAddr);
    this.memory(cpu);
    this.apply(h, tr.fetchAddr);
  }

  /** DECODE: the opcode selects a row of the table on the canvas. */
  renderDecode(cpu: CPU, tr: Trace) {
    const h = none();
    h.phase = "DECODE";
    h.regs.add("IR");
    h.row = tr.opcode;
    h.taps.add("decoder");
    this.text(this.b.irMnem, tr.mnem);
    this.apply(h, tr.fetchAddr);
  }

  /** EXEC (or a Turbo frame when tr is null): everything the micro-ops changed. */
  renderExec(cpu: CPU, tr: Trace | null) {
    const h = none();
    if (tr) {
      h.phase = "EXEC";
      h.row = tr.opcode;
      for (const i of tr.regsWritten) h.regs.add(REG_ORDER[i]);
      if (tr.spChanged) h.regs.add("SP");
      if (tr.alu) {
        h.alu = true;
        h.taps.add("alu").add("registers");
      }
      // operand fetches aren't interesting on the bus; data accesses are
      const data = tr.accesses.filter((a) => a.kind !== "f");
      const last = data[data.length - 1];
      if (last) {
        h.addrBus = last.addr;
        h.dataBus = last.value;
        ["registers", "ram/addr", "ram/data"].forEach((t) => h.taps.add(t));
      }
      for (const a of tr.accesses)
        (a.kind === "w" ? h.written : h.read).add(a.addr);
      if (
        cpu.pc !==
        ((tr.fetchAddr + (cpu.table.entries[tr.opcode]?.size ?? 1)) & 0xffff)
      )
        h.regs.add("PC");
    }
    REG_ORDER.forEach((r, i) => this.register(r, cpu.regs[i]));
    this.wide("PC", cpu.pc, 16);
    this.wide("SP", cpu.sp, 16);
    this.wide("IR", cpu.ir, 8);
    this.text(this.b.irMnem, cpu.table.entries[cpu.ir]?.mnem ?? "???");
    this.text(this.b.hl, `H:L = ${hex(cpu.hl(), 4)}`);
    this.text(this.b.cycles, `cycles ${cpu.cycles}`);
    this.fill(this.b.flags.Z, cpu.Z ? COL.flag : COL.lampOff);
    this.fill(this.b.flags.C, cpu.C ? COL.flag : COL.lampOff);
    this.fill(this.b.flags.N, cpu.N ? COL.flag : COL.lampOff);
    this.fill(this.b.clock, cpu.cycles & 1 ? COL.bit : COL.lampOff);
    const alu = cpu.lastAlu;
    this.text(this.b.alu.op, alu ? alu.op : "—");
    this.text(this.b.alu.in1, alu ? hex(alu.a, 2) : "00");
    this.text(this.b.alu.in2, alu && alu.b !== null ? hex(alu.b, 2) : "—");
    this.text(this.b.alu.out, alu ? hex(alu.out, 2) : "00");
    const io = this.b.io;
    this.text(io.get("MOUSE_X")!, hex(cpu.io.mouseX & 0xff, 2));
    this.text(io.get("MOUSE_Y")!, hex(cpu.io.mouseY & 0xff, 2));
    this.text(io.get("MOUSE_BTN")!, hex(cpu.io.mouseBtn & 0xff, 2));
    this.text(io.get("KEY")!, hex(cpu.io.key & 0xff, 2));
    this.text(io.get("TICK")!, hex(cpu.io.tick & 0xff, 2));
    this.text(io.get("RAND")!, hex(cpu.io.lastRand, 2));
    this.followPc(cpu.pc);
    this.memory(cpu);
    this.apply(h, cpu.pc);
  }

  /** Clears every highlight (used when pausing or loading). */
  idle(cpu: CPU) {
    this.renderExec(cpu, null);
  }

  // ---- pieces ----

  private register(name: string, v: number) {
    const r = this.b.regs.get(name)!;
    this.text(r.value, hex(v, 2));
    if (r.dec) this.text(r.dec, String(v));
    r.bits.forEach((bit, i) =>
      this.fill(bit, (v >> i) & 1 ? COL.bit : COL.lampOff),
    );
  }

  private wide(name: string, v: number, bits: number) {
    const r = this.b.regs.get(name)!;
    this.text(r.value, hex(v, bits / 4));
    r.bits.forEach((bit, i) =>
      this.fill(bit, (v >> i) & 1 ? COL.bit : COL.lampOff),
    );
  }

  /** Keeps the RAM window still while PC is anywhere inside it; recentres only when PC leaves. */
  private followPc(pc: number) {
    if (pc >= this.ramBase && pc < this.ramBase + 0x100) return;
    this.ramBase = Math.max(0, Math.min(0xff00, (pc & 0xfff0) - 0x40));
  }

  private memory(cpu: CPU) {
    for (const [w, base] of [
      [this.b.ram, this.ramBase],
      [this.b.pin, this.pinBase],
    ] as const) {
      this.text(w.base, `base ${hex(base, 4)}`);
      w.labels.forEach((l, r) =>
        this.text(l, hex((base + r * 16) & 0xffff, 4)),
      );
      w.cells.forEach((c, i) =>
        this.text(c.v, hex(cpu.mem[(base + i) & 0xffff], 2)),
      );
    }
  }

  private apply(h: Highlights, pc: number) {
    const b = this.b;
    for (const p of ["FETCH", "DECODE", "EXEC"] as const)
      this.fill(b.phases[p], h.phase === p ? COL.active : COL.lampOff);
    for (const [name, r] of b.regs) {
      const on = h.regs.has(name);
      this.stroke(r.box, on ? COL.active : COL.stroke, on ? 3 : 2);
    }
    for (const [op, row] of this.rows)
      this.fill(row, h.row === op ? COL.rowOn : COL.cell);
    this.stroke(b.alu.box, h.alu ? COL.active : COL.stroke, h.alu ? 3 : 2);
    this.fill(b.alu.box, h.alu ? COL.aluOn : COL.cell);
    this.bus(b.buses.addr, h.addrBus, 4);
    this.bus(b.buses.data, h.dataBus, 2);
    for (const [name, tap] of b.taps)
      this.fill(tap, h.taps.has(name) ? COL.busOn : COL.bus);
    for (const [w, base] of [
      [b.ram, this.ramBase],
      [b.pin, this.pinBase],
    ] as const) {
      w.cells.forEach((c, i) => {
        const addr = (base + i) & 0xffff;
        const color = h.written.has(addr)
          ? COL.write
          : h.read.has(addr)
            ? COL.read
            : addr === pc
              ? COL.pc
              : COL.cell;
        this.fill(c.box, color);
      });
    }
  }

  private bus(
    bus: Bound["buses"]["addr"],
    value: number | null,
    digits: number,
  ) {
    if (value !== null) this.text(bus.value, hex(value, digits));
    this.fill(bus.wire, value !== null ? COL.busOn : COL.bus);
  }
}
