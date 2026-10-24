// Renderer: writes CPU state onto the bound nodes, touching only nodes whose value changed. On the
// Leila page every connector has its own name, so it lights exactly the connectors that carry a value
// this T-state; on other drawings it lights every connector while a bus is driven.

// Same palette as the Leila drawing (and the Eric page).
const PAL = {
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

const paintCache = new Map();
function solidPaint(hexColor) {
  let p = paintCache.get(hexColor);
  if (!p) {
    const n = parseInt(hexColor.slice(1), 16);
    p = [{ type: "SOLID", color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 } }];
    paintCache.set(hexColor, p);
  }
  return p;
}

// Which Leila connectors carry each signal.
const TAPS_BY_SIGNAL = {
  PC_OUT: ["pc/addr"], PC_LOAD: ["pc/addr"], SP_OUT: ["sp/addr"], HL_OUT: ["hl/addr"], HL_LOAD: ["hl/addr"],
  W_OUT: ["w/addr"], MAR_LOAD: ["mar/addr"], MEM_READ: ["mar-mem", "mem-mdr"], MEM_WRITE: ["mar-mem", "mem-mdr"],
  MDR_OUT: ["mdr/data"], MDR_LOAD: ["mdr/data"], IR_LOAD: ["ir/data"], OPR_LOAD: ["opr/data"],
  T_OUT: ["t/data"], T_LOAD: ["t/data"], W_LO_LOAD: ["w/data"], W_HI_LOAD: ["w/data"], A_LOAD: ["alu-a/data"],
  Y_OUT: ["alu-y/data"], PCH_OUT: ["pc/data"], PCL_OUT: ["pc/data"], PCH_LOAD: ["pc/data"], PCL_LOAD: ["pc/data"],
};

class Renderer {
  constructor(b) {
    this.b = b;
    this.texts = new Map();
    this.fills = new Map();
    this.strokes = new Map();
    this.ranges = new Map();
    this.lastRegs = [];
    this.highlightedRow = null;
    const get = (n) => b.byName.get(n);
    const regView = (n, bits) => ({
      root: n,
      value: childText(n, "value"),
      dec: childText(n, "dec"),
      bits: Array.from({ length: bits }, (_, i) => child(n, `bit/${i}`)),
    });
    this.regs = CORE.REGISTERS.map((r) => regView(get(`cpu/reg/${r}`), 8));
    this.wide = { PC: regView(get("cpu/reg/PC"), 16), SP: regView(get("cpu/reg/SP"), 16), IR: regView(get("cpu/reg/IR"), 8) };
    this.irMnem = childText(get("cpu/reg/IR"), "mnem");
    this.lamps = new Map();
    const lampNames = ["cpu/flag/Z", "cpu/flag/C", "cpu/flag/N", "cpu/phase/FETCH", "cpu/phase/DECODE", "cpu/phase/EXEC", "cpu/clock"]
      .concat(Array.from({ length: CORE.MAX_TSTATES }, (_, t) => `cpu/tstate/T${t}`))
      .concat(CORE.SIGNALS.map((s) => `cpu/sig/${s.name}`));
    for (const n of lampNames) {
      const root = get(n);
      this.lamps.set(n, { root, lamp: child(root, "lamp"), label: childText(root, "label") });
    }
    this.ramFrames = [];
    this.ramCells = [];
    for (let i = 0; i < 256; i++) {
      const cell = get(`mem/ram/cell/${CORE.hex(i, 2)}`);
      this.ramFrames.push(cell);
      this.ramCells.push(childText(cell, "v"));
    }
    this.ramRows = Array.from({ length: 16 }, (_, r) => get(`mem/ram/addr/${CORE.hex(r, 1)}`));
    this.pinCells = Array.from({ length: 64 }, (_, i) => childText(get(`mem/pin/cell/${CORE.hex(i, 2)}`), "v"));
    this.pinRows = Array.from({ length: 4 }, (_, r) => get(`mem/pin/addr/${CORE.hex(r, 1)}`));
    this.taps = new Map();
    for (const [name, node] of b.byName) if (name.indexOf("cpu/bus/tap/") === 0) this.taps.set(name.slice(12), node);
    this.perSignalTaps = Object.keys(TAPS_BY_SIGNAL).some((s) => TAPS_BY_SIGNAL[s].some((t) => this.taps.has(t)));
  }

  text(node, s) {
    if (!node || this.texts.get(node.id) === s) return;
    if (node.characters !== s) node.characters = s;
    this.texts.set(node.id, s);
  }

  fill(node, color) {
    if (!node || this.fills.get(node.id) === color || !("fills" in node)) return;
    node.fills = solidPaint(color);
    this.fills.set(node.id, color);
  }

  stroke(node, color, weight) {
    weight = weight || 2;
    const key = `${color}/${weight}`;
    if (!node || this.strokes.get(node.id) === key || !("strokes" in node)) return;
    node.strokes = solidPaint(color);
    node.strokeWeight = weight;
    this.strokes.set(node.id, key);
  }

  lamp(name, on, color) {
    const l = this.lamps.get(name);
    this.fill(l && l.lamp, on ? color || PAL.lampOn : PAL.lampOff);
  }

  bits(view, value) {
    view.bits.forEach((b, i) => this.fill(b, (value >> i) & 1 ? PAL.lampOn : PAL.lampOff));
  }

  render(v) {
    const cpu = v.cpu;
    const tres = v.tres;
    const watch = v.mode === "watch" && tres !== null;
    const sigs = new Set(watch ? tres.sigs.map((s) => s.s) : []);
    const loadedRegs = new Set();
    const outRegs = new Set();
    if (watch) for (const s of tres.sigs) {
      if (s.s === "REG_LOAD") loadedRegs.add(s.r);
      if (s.s === "REG_OUT") outRegs.add(s.r);
    }
    const get = (n) => this.b.byName.get(n);

    // Registers A–L
    this.regs.forEach((view, i) => {
      const val = cpu.r[i];
      this.text(view.value, CORE.hex(val, 2));
      this.text(view.dec, String(val));
      this.bits(view, val);
      const changed = this.lastRegs[i] !== undefined && this.lastRegs[i] !== val;
      const hot = watch ? loadedRegs.has(i) || outRegs.has(i) : changed;
      this.stroke(view.root, hot ? PAL.active : PAL.stroke, hot ? 3 : 2);
    });
    this.lastRegs = Array.from(cpu.r);
    this.text(get("cpu/reg/HL"), `H:L = ${CORE.hex(cpu.hl, 4)}`);

    // Control registers
    const w = this.wide;
    this.text(w.PC.value, CORE.hex(cpu.pc, 4));
    this.bits(w.PC, cpu.pc);
    this.stroke(w.PC.root, watch && (sigs.has("PC_INC") || sigs.has("PC_LOAD") || sigs.has("PCH_LOAD") || sigs.has("PCL_LOAD")) ? PAL.active : PAL.stroke);
    this.text(w.SP.value, CORE.hex(cpu.sp, 4));
    this.bits(w.SP, cpu.sp);
    this.stroke(w.SP.root, watch && (sigs.has("SP_INC") || sigs.has("SP_DEC")) ? PAL.active : PAL.stroke);
    this.text(w.IR.value, CORE.hex(cpu.ir, 2));
    this.bits(w.IR, cpu.ir);
    this.stroke(w.IR.root, watch && sigs.has("IR_LOAD") ? PAL.active : PAL.stroke);
    const row = v.table.byOp[cpu.ir];
    this.text(this.irMnem, watch && tres.phase === "FETCH" && !tres.decoded ? "…" : row ? row.mnem : "???");
    this.lamp("cpu/phase/FETCH", watch && tres.phase === "FETCH");
    this.lamp("cpu/phase/DECODE", watch && tres.decoded);
    this.lamp("cpu/phase/EXEC", watch && tres.phase === "EXEC");
    this.lamp("cpu/clock", cpu.tstates % 2 === 1);
    this.text(get("cpu/cycles"), `instr ${cpu.instructions} · T-states ${cpu.tstates}`);

    // ALU + flags
    const a = watch ? tres.alu : cpu.lastAlu;
    this.text(get("cpu/alu/op"), a ? a.op : "—");
    this.text(get("cpu/alu/in1"), CORE.hex(cpu.a, 2));
    this.text(get("cpu/alu/in2"), a ? CORE.hex(a.b, 2) : "00");
    this.text(get("cpu/alu/out"), CORE.hex(cpu.y, 2));
    this.stroke(get("cpu/alu/body"), watch && sigs.has("ALU_OP") ? PAL.active : PAL.stroke);
    this.lamp("cpu/flag/Z", cpu.z);
    this.lamp("cpu/flag/C", cpu.c);
    this.lamp("cpu/flag/N", cpu.n);

    // Buses: in Watch the value driven this T-state; otherwise the last memory access.
    const addr = watch ? tres.addrBus : cpu.mar;
    const data = watch ? tres.dataBus : cpu.mdr;
    for (const [name, value, width] of [["cpu/bus/addr", addr, 4], ["cpu/bus/data", data, 2]]) {
      const bus = get(name);
      this.text(childText(bus, "value"), value === null ? "-".repeat(width) : CORE.hex(value, width));
      this.fill(child(bus, "wire"), watch && value !== null ? PAL.busOn : PAL.bus);
    }
    this.renderTaps(watch, tres, sigs);

    // Datapath latches
    this.text(childText(get("cpu/reg/MAR"), "value"), CORE.hex(cpu.mar, 4));
    this.text(childText(get("cpu/reg/MDR"), "value"), CORE.hex(cpu.mdr, 2));
    this.text(childText(get("cpu/latch/OPR"), "value"), CORE.hex(cpu.opr, 2));
    this.text(childText(get("cpu/latch/T"), "value"), CORE.hex(cpu.t, 2));
    this.text(childText(get("cpu/latch/W"), "value"), CORE.hex(cpu.w, 4));
    const loads = [
      ["cpu/reg/MAR", ["MAR_LOAD"]], ["cpu/reg/MDR", ["MDR_LOAD", "MEM_READ"]], ["cpu/latch/OPR", ["OPR_LOAD"]],
      ["cpu/latch/T", ["T_LOAD"]], ["cpu/latch/W", ["W_LO_LOAD", "W_HI_LOAD"]],
    ];
    for (const [name, on] of loads) this.stroke(get(name), on.some((s) => sigs.has(s)) ? PAL.active : PAL.stroke);
    this.text(childText(get("cpu/tstate"), "value"), watch ? `T${tres.t}` : "—");
    for (let t = 0; t < CORE.MAX_TSTATES; t++) this.lamp(`cpu/tstate/T${t}`, watch && tres.t === t, PAL.active);
    for (const s of CORE.SIGNALS) {
      const name = `cpu/sig/${s.name}`;
      this.lamp(name, sigs.has(s.name), s.drives ? PAL.busOn : PAL.lampOn);
      if (s.name === "REG_OUT" || s.name === "REG_LOAD") {
        const hit = watch ? tres.sigs.find((x) => x.s === s.name) : undefined;
        const l = this.lamps.get(name);
        this.text(l && l.label, hit ? `${s.name}(${CORE.REGISTERS[hit.r]})` : s.name);
      }
    }

    // Decoder row being executed, and in Watch the micro-op step inside it.
    const current = watch ? tres.row : cpu.instructions > 0 || cpu.halted ? row || null : null;
    if (this.highlightedRow && this.highlightedRow !== current) this.rowHighlight(this.highlightedRow, false, -1);
    if (current) this.rowHighlight(current, true, watch ? tres.step : -1);
    this.highlightedRow = current;

    // RAM window follows PC's 256-byte page; the pinned window shows pinBase.
    const base = cpu.pc & 0xff00;
    this.text(get("mem/ram/base"), `base ${CORE.hex(base, 4)}`);
    for (let r = 0; r < 16; r++) this.text(this.ramRows[r], CORE.hex(base + r * 16, 4));
    for (let i = 0; i < 256; i++) {
      const ad = base + i;
      this.text(this.ramCells[i], CORE.hex(cpu.mem[ad], 2));
      const isMar = watch && ad === cpu.mar && (sigs.has("MEM_READ") || sigs.has("MEM_WRITE"));
      this.fill(this.ramFrames[i], isMar ? PAL.marCell : ad === cpu.pc ? PAL.pcCell : PAL.cell);
    }
    const pin = v.pinBase & 0xffc0;
    this.text(get("mem/pin/base"), `base ${CORE.hex(pin, 4)}`);
    for (let r = 0; r < 4; r++) this.text(this.pinRows[r], CORE.hex(pin + r * 16, 4));
    for (let i = 0; i < 64; i++) this.text(this.pinCells[i], CORE.hex(cpu.mem[(pin + i) & 0xffff], 2));

    for (const k of Object.keys(CORE.IO)) this.text(childText(get(`mem/io/${k}`), "value"), CORE.hex(cpu.mem[CORE.IO[k]], 2));
  }

  renderTaps(watch, tres, sigs) {
    if (!this.perSignalTaps) {
      const any = watch && (tres.addrBus !== null || tres.dataBus !== null);
      for (const node of this.taps.values()) this.fill(node, any ? PAL.busOn : PAL.bus);
      return;
    }
    const lit = new Set();
    if (watch) {
      for (const s of tres.sigs) {
        for (const t of TAPS_BY_SIGNAL[s.s] || []) lit.add(t);
        if ((s.s === "REG_OUT" || s.s === "REG_LOAD") && s.r !== undefined) lit.add(`reg-${CORE.REGISTERS[s.r]}/data`);
      }
      if (sigs.has("ALU_OP") && tres.dataBus !== null) lit.add("alu-b/data");
    }
    for (const [name, node] of this.taps) this.fill(node, lit.has(name) ? PAL.busOn : PAL.bus);
  }

  rowHighlight(row, on, step) {
    const nodes = this.b.rows.find((r) => r.op.characters.trim().toUpperCase() === CORE.hex(row.op, 2));
    if (!nodes) return;
    this.fill(nodes.frame, on ? PAL.rowOn : PAL.cell);
    const micro = nodes.micro;
    const key = `${micro.characters}|${on ? step : -1}`;
    if (this.ranges.get(micro.id) === key) return;
    const len = micro.characters.length;
    if (len > 0) micro.setRangeFills(0, len, solidPaint(PAL.text));
    if (on && step >= 0) {
      let idx = 0;
      let start = 0;
      for (const seg of micro.characters.split(";")) {
        const end = start + seg.length;
        if (seg.trim().length > 0) {
          if (idx === step) {
            const lead = seg.length - seg.replace(/^\s+/, "").length;
            micro.setRangeFills(start + lead, start + lead + seg.trim().length, solidPaint(PAL.active));
            break;
          }
          idx++;
        }
        start = end + 1;
      }
    }
    this.ranges.set(micro.id, key);
  }

  setScreen(imageHash) {
    const screen = this.b.byName.get("dev/screen");
    if (screen) screen.fills = [{ type: "IMAGE", imageHash, scaleMode: "FILL" }];
  }
}
