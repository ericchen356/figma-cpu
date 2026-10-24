const SPEC = {"registers":["A","B","C","D","H","L"],"opcodes":[{"op":"00","mnem":"NOP","fmt":"-","micro":""},{"op":"01","mnem":"HLT","fmt":"-","micro":"HALT"},{"op":"10","mnem":"LDI","fmt":"r,i8","micro":"REG; IMM8; SET rd T"},{"op":"11","mnem":"MOV","fmt":"r,r","micro":"REG; COPY rd rs"},{"op":"12","mnem":"LD","fmt":"r","micro":"REG; LOAD rd HL"},{"op":"13","mnem":"ST","fmt":"r","micro":"REG; STORE rd HL"},{"op":"14","mnem":"LDA","fmt":"r,a16","micro":"REG; IMM16; LOAD rd W"},{"op":"15","mnem":"STA","fmt":"r,a16","micro":"REG; IMM16; STORE rd W"},{"op":"16","mnem":"LHL","fmt":"i16","micro":"IMM16; SETHL W"},{"op":"20","mnem":"ADD","fmt":"r,r","micro":"REG; ALU ADD rd rs"},{"op":"21","mnem":"SUB","fmt":"r,r","micro":"REG; ALU SUB rd rs"},{"op":"22","mnem":"AND","fmt":"r,r","micro":"REG; ALU AND rd rs"},{"op":"23","mnem":"OR","fmt":"r,r","micro":"REG; ALU OR rd rs"},{"op":"24","mnem":"XOR","fmt":"r,r","micro":"REG; ALU XOR rd rs"},{"op":"25","mnem":"CMP","fmt":"r,r","micro":"REG; ALU CMP rd rs"},{"op":"26","mnem":"INC","fmt":"r","micro":"REG; ALU INC rd"},{"op":"27","mnem":"DEC","fmt":"r","micro":"REG; ALU DEC rd"},{"op":"28","mnem":"SHL","fmt":"r","micro":"REG; ALU SHL rd"},{"op":"29","mnem":"SHR","fmt":"r","micro":"REG; ALU SHR rd"},{"op":"2A","mnem":"INHL","fmt":"-","micro":"INCHL"},{"op":"30","mnem":"JMP","fmt":"a16","micro":"IMM16; JUMP W"},{"op":"31","mnem":"JZ","fmt":"a16","micro":"IMM16; JUMP W Z"},{"op":"32","mnem":"JNZ","fmt":"a16","micro":"IMM16; JUMP W NZ"},{"op":"33","mnem":"JC","fmt":"a16","micro":"IMM16; JUMP W C"},{"op":"34","mnem":"JNC","fmt":"a16","micro":"IMM16; JUMP W NC"},{"op":"35","mnem":"CALL","fmt":"a16","micro":"IMM16; PUSHPC; JUMP W"},{"op":"36","mnem":"RET","fmt":"-","micro":"POPPC"},{"op":"40","mnem":"PUSH","fmt":"r","micro":"REG; PUSH rd"},{"op":"41","mnem":"POP","fmt":"r","micro":"REG; POP rd"}],"palette":{"name":"PICO-8","colors":["#000000","#1D2B53","#7E2553","#008751","#AB5236","#5F574F","#C2C3C7","#FFF1E8","#FF004D","#FFA300","#FFEC27","#00E436","#29ADFF","#83769C","#FF77A8","#FFCCAA"]},"memory":{"program":{"start":"0x0000","end":"0x3FFF"},"ram":{"start":"0x4000","end":"0x7EFF"},"stackTop":"0x7F00","vram":{"start":"0x8000","end":"0xAFFF","width":128,"height":96},"io":{"MOUSE_X":"0xF000","MOUSE_Y":"0xF001","MOUSE_BTN":"0xF002","KEY":"0xF003","TICK":"0xF004","RAND":"0xF005"}},"signals":{"maxTStates":18,"signals":[{"name":"PC_OUT","drives":"addr","desc":"PC → address bus"},{"name":"HL_OUT","drives":"addr","desc":"H:L → address bus"},{"name":"W_OUT","drives":"addr","desc":"W latch → address bus"},{"name":"SP_OUT","drives":"addr","desc":"SP → address bus"},{"name":"MAR_LOAD","desc":"MAR ← address bus"},{"name":"MEM_READ","desc":"MDR ← mem[MAR]"},{"name":"MEM_WRITE","desc":"mem[MAR] ← MDR"},{"name":"MDR_LOAD","desc":"MDR ← data bus"},{"name":"MDR_OUT","drives":"data","desc":"MDR → data bus"},{"name":"REG_OUT","drives":"data","desc":"register → data bus"},{"name":"T_OUT","drives":"data","desc":"T latch → data bus"},{"name":"Y_OUT","drives":"data","desc":"Y latch (ALU result) → data bus"},{"name":"PCH_OUT","drives":"data","desc":"PC high byte → data bus"},{"name":"PCL_OUT","drives":"data","desc":"PC low byte → data bus"},{"name":"IR_LOAD","desc":"IR ← data bus"},{"name":"OPR_LOAD","desc":"OPR (register byte) ← data bus"},{"name":"T_LOAD","desc":"T latch ← data bus"},{"name":"W_LO_LOAD","desc":"W low byte ← data bus"},{"name":"W_HI_LOAD","desc":"W high byte ← data bus"},{"name":"A_LOAD","desc":"A latch (ALU input 1) ← data bus"},{"name":"REG_LOAD","desc":"register ← data bus"},{"name":"PC_LOAD","desc":"PC ← address bus"},{"name":"PCH_LOAD","desc":"PC high byte ← data bus"},{"name":"PCL_LOAD","desc":"PC low byte ← data bus"},{"name":"HL_LOAD","desc":"H:L ← address bus"},{"name":"ALU_OP","desc":"ALU computes A latch ⊕ data bus"},{"name":"Y_LOAD","desc":"Y latch ← ALU result"},{"name":"FLAGS_LOAD","desc":"Z C N ← ALU flags"},{"name":"PC_INC","desc":"PC ← PC + 1"},{"name":"SP_INC","desc":"SP ← SP + 1"},{"name":"SP_DEC","desc":"SP ← SP − 1"},{"name":"HL_INC","desc":"H:L ← H:L + 1"},{"name":"T_RESET","desc":"end of instruction, T-state counter → T0"},{"name":"HALT","desc":"stop the clock"}]}};
const __FORCE_REDRAW__ = true;
const __TARGET_PAGE__ = "Leila";
// Stage 1 — settings, palette, fonts, drawing primitives and the layout grid.
// SPEC (opcodes, palette, memory map, control signals) is injected by build.mjs. Only the Leila page
// is touched; the machine frame is named "Machine v2" so the FigmaCPU and Leila CPU plugins bind to it.

const FORCE_REDRAW = typeof __FORCE_REDRAW__ !== "undefined" ? __FORCE_REDRAW__ : false;
const TARGET_PAGE = typeof __TARGET_PAGE__ !== "undefined" ? __TARGET_PAGE__ : "Leila";

// Same palette as the plugin renderer, which repaints cells, lamps, buses and rows with these.
const C = {
  bg: "#141414",
  card: "#1B1B1B",
  cell: "#262626",
  stroke: "#2E2E2E",
  rule: "#242424",
  text: "#E8E8E8",
  dim: "#8C8C8C",
  lampOff: "#333333",
  lampOn: "#F5C542",
  active: "#2BD67B",
  bus: "#4A3B1E",
  busOn: "#F59E0B",
};

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function solid(hex, opacity = 1) {
  return [{ type: "SOLID", color: rgb(hex), opacity }];
}

let SANS, SANS_B, MONO, MONO_B;
async function loadFonts() {
  SANS = { family: "Inter", style: "Regular" };
  SANS_B = { family: "Inter", style: "Semi Bold" };
  await figma.loadFontAsync(SANS);
  await figma.loadFontAsync(SANS_B);
  for (const fam of ["JetBrains Mono", "Roboto Mono"]) {
    try {
      MONO = { family: fam, style: "Regular" };
      MONO_B = { family: fam, style: "Bold" };
      await figma.loadFontAsync(MONO);
      await figma.loadFontAsync(MONO_B);
      return;
    } catch (e) {}
  }
  MONO = SANS;
  MONO_B = SANS_B;
}

function frame(parent, name, x, y, w, h, o = {}) {
  const f = figma.createFrame();
  f.name = name;
  f.x = x;
  f.y = y;
  f.resize(w, h);
  f.fills = o.fill === null ? [] : solid(o.fill || C.card);
  if (o.stroke !== null) {
    f.strokes = solid(o.stroke || C.stroke);
    f.strokeWeight = o.strokeWeight || 1;
  }
  f.cornerRadius = o.radius !== undefined ? o.radius : 8;
  f.clipsContent = false;
  parent.appendChild(f);
  return f;
}

function rect(parent, name, x, y, w, h, fill, radius = 0) {
  const r = figma.createRectangle();
  r.name = name;
  r.x = x;
  r.y = y;
  r.resize(w, h);
  r.fills = solid(fill);
  r.cornerRadius = radius;
  parent.appendChild(r);
  return r;
}

function text(parent, name, chars, x, y, o = {}) {
  const t = figma.createText();
  t.name = name;
  t.fontName = o.mono ? (o.bold ? MONO_B : MONO) : o.bold ? SANS_B : SANS;
  t.fontSize = o.size || 13;
  t.characters = chars;
  t.fills = solid(o.color || C.text);
  if (o.track) t.letterSpacing = { unit: "PERCENT", value: o.track };
  t.x = x;
  t.y = y;
  if (o.width) {
    t.textAutoResize = "HEIGHT";
    t.resize(o.width, t.height);
  }
  if (o.align) t.textAlignHorizontal = o.align;
  parent.appendChild(t);
  return t;
}

// Section and block captions: small, tracked, dim.
const caption = (parent, chars, x = 16, y = 14, name = "label") =>
  text(parent, name, chars, x, y, { size: 11, bold: true, color: C.dim, track: 6 });

// ---------- layout ----------
// Row A (y 140–340): address sources.  Address bus y 372.  Row B (y 452–652): memory
// interface, instruction latches and ALU.  Data bus y 684.  Row C (y 764): register file.
// Row D (y 1020): control unit.  Row E (y 1420): decoder table + RAM.  Right column: screen, IO.
const ROW_A = 140, ROW_B = 452, ADDR_Y = 372, DATA_Y = 684, BUS_H = 56, ROW_C = 764, ROW_D = 1020, ROW_E = 1420;

// Stage 2 — reusable parts: the Lamp and Register components, labelled lamps, value blocks,
// wide registers, and bus connectors (taps).

// ---------- components ----------

function makeLamp(parent) {
  const lamp = figma.createComponent();
  lamp.name = "Lamp";
  lamp.resize(12, 12);
  lamp.cornerRadius = 6;
  lamp.fills = solid(C.lampOff);
  parent.appendChild(lamp);
  return lamp;
}

function lampInstance(Lamp, parent, name, x, y) {
  const i = Lamp.createInstance();
  i.name = name;
  i.x = x;
  i.y = y;
  parent.appendChild(i);
  return i;
}

// Register A–L: the renderer writes "value", "dec", fills "bit/0..7" and strokes the instance.
function makeRegisterSet(parent, Lamp) {
  const variants = ["idle", "active"].map((state, k) => {
    const c = figma.createComponent();
    c.name = `State=${state}`;
    c.resize(320, 200);
    c.cornerRadius = 8;
    c.fills = solid(C.cell);
    c.strokes = solid(state === "active" ? C.active : C.stroke);
    c.strokeWeight = state === "active" ? 3 : 2;
    c.x = k * 340;
    text(c, "name", "R", 16, 14, { size: 13, bold: true, color: C.dim });
    text(c, "dec", "0", 240, 14, { size: 12, mono: true, color: C.dim, width: 64, align: "RIGHT" });
    text(c, "value", "00", 16, 44, { size: 44, mono: true, bold: true });
    for (let b = 7; b >= 0; b--) lampInstance(Lamp, c, `bit/${b}`, 16 + (7 - b) * 24, 168);
    text(c, "bits-caption", "bit 7 … 0", 216, 166, { size: 10, mono: true, color: C.dim });
    return c;
  });
  const set = figma.combineAsVariants(variants, parent);
  set.name = "Register";
  set.x = 40;
  set.y = 0;
  return set;
}

// ---------- shared block shapes ----------

function lampLabel(Lamp, parent, name, label, x, y, w, labelColor) {
  const f = frame(parent, name, x, y, w, 28, { fill: C.cell, radius: 6 });
  lampInstance(Lamp, f, "lamp", 10, 8);
  text(f, "label", label, 30, 6, { size: 12, mono: true, color: labelColor || C.dim });
  return f;
}

function valueBlock(parent, name, label, sub, x, y, w, h, value) {
  const f = frame(parent, name, x, y, w, h, { fill: C.cell, strokeWeight: 2 });
  caption(f, label);
  text(f, "sub", sub, 16, 32, { size: 11, color: C.dim });
  text(f, "value", value, 16, 60, { size: 36, mono: true, bold: true });
  return f;
}

function wideRegister(Lamp, parent, name, label, sub, x, y, w, bits) {
  const f = valueBlock(parent, name, label, sub, x, y, w, 200, bits === 16 ? "0000" : "00");
  for (let b = bits - 1; b >= 0; b--) lampInstance(Lamp, f, `bit/${b}`, 16 + (bits - 1 - b) * 24, 168);
  return f;
}

// Bus taps: vertical connectors. The renderer lights every cpu/bus/tap/* when a bus is driven.
function tap(M, name, x, y0, y1) {
  return rect(M, `cpu/bus/tap/${name}`, x - 3, y0, 6, y1 - y0, C.bus, 2);
}
function tapLabel(M, chars, x, y, align) {
  const t = text(M, "tap-label", chars, x, y, { size: 10, mono: true, color: C.dim });
  if (align === "RIGHT") t.x = x - t.width;
  return t;
}

// Stage 3 — the two-bus datapath: connectors, the address and data buses, the address sources
// (PC, SP, H:L, W, MAR, memory), the memory interface and ALU, and the register file.

function drawTaps(M) {
  const aTop = ADDR_Y, aBot = ADDR_Y + BUS_H, dTop = DATA_Y, dBot = DATA_Y + BUS_H;
  // row A → address bus
  tap(M, "pc/addr", 260, 340, aTop); tapLabel(M, "PC_OUT · PC_LOAD", 268, 348);
  tap(M, "sp/addr", 724, 340, aTop); tapLabel(M, "SP_OUT", 732, 348);
  tap(M, "hl/addr", 1108, 340, aTop); tapLabel(M, "HL_OUT · HL_LOAD", 1116, 348);
  tap(M, "w/addr", 1400, 340, aTop); tapLabel(M, "W_OUT", 1408, 348);
  tap(M, "mar/addr", 1736, 340, aTop); tapLabel(M, "MAR_LOAD", 1744, 348);
  // row A → data bus (pass behind the address bus)
  tap(M, "pc/data", 464, 340, dTop); tapLabel(M, "PCH/PCL ↕ data", 472, 348);
  tap(M, "w/data", 1580, 340, dTop); tapLabel(M, "W_LO/HI_LOAD", 1572, 348, "RIGHT");
  // MAR → memory, memory ↔ MDR
  rect(M, "cpu/bus/tap/mar-mem", 1856, 237, 24, 6, C.bus, 2);
  rect(M, "cpu/bus/tap/mem-mdr", 1856, 549, 24, 6, C.bus, 2);
  // row B → data bus
  tap(M, "ir/data", 240, 652, dTop); tapLabel(M, "IR_LOAD", 248, 660);
  tap(M, "opr/data", 588, 652, dTop); tapLabel(M, "OPR_LOAD", 596, 660);
  tap(M, "t/data", 812, 652, dTop); tapLabel(M, "T_OUT · T_LOAD", 820, 660);
  tap(M, "alu-a/data", 1000, 652, dTop); tapLabel(M, "A_LOAD", 1008, 660);
  tap(M, "alu-b/data", 1248, 652, dTop); tapLabel(M, "bus → ALU", 1256, 660);
  tap(M, "alu-y/data", 1500, 652, dTop); tapLabel(M, "Y_OUT", 1508, 660);
  tap(M, "mdr/data", 1736, 652, dTop); tapLabel(M, "MDR_OUT · MDR_LOAD", 1744, 660);
  // register file → data bus
  SPEC.registers.forEach((r, i) => tap(M, `reg-${r}/data`, 40 + i * 344 + 160, dBot, ROW_C));
  tapLabel(M, "REG_OUT · REG_LOAD  (register chosen by OPR)", 212, dBot + 6);
}

function drawBuses(M) {
  const buses = [
    ["cpu/bus/addr", "ADDRESS BUS · 16-bit", "0000", ADDR_Y, 1816],
    ["cpu/bus/data", "DATA BUS · 8-bit", "00", DATA_Y, 2040],
  ];
  for (const [name, label, val, y, w] of buses) {
    const f = frame(M, name, 40, y, w, BUS_H, { fill: C.card, radius: 8 });
    caption(f, label, 16, 8);
    text(f, "value", val, 16, 24, { size: 20, mono: true, bold: true });
    rect(f, "wire", 200, 24, w - 220, 10, C.bus, 5);
  }
}

function drawAddressSources(M, Lamp) {
  wideRegister(Lamp, M, "cpu/reg/PC", "PC", "program counter · 16-bit", 40, ROW_A, 440, 16);
  wideRegister(Lamp, M, "cpu/reg/SP", "SP", "stack pointer · grows down from 7F00", 504, ROW_A, 440, 16);
  const hl = frame(M, "hl-pointer", 968, ROW_A, 280, 200, { fill: C.cell });
  caption(hl, "H:L");
  text(hl, "sub", "pointer formed by registers H and L", 16, 32, { size: 11, color: C.dim, width: 248 });
  text(hl, "cpu/reg/HL", "H:L = 0000", 16, 64, { size: 22, mono: true, bold: true });
  text(hl, "note", "HL_INC steps it after a load or store", 16, 168, { size: 11, color: C.dim, width: 248 });
  valueBlock(M, "cpu/latch/W", "W", "16-bit operand latch (addresses)", 1272, ROW_A, 320, 200, "0000");
  valueBlock(M, "cpu/reg/MAR", "MAR", "memory address register", 1616, ROW_A, 240, 200, "0000");
  const mem = frame(M, "memory-block", 1880, ROW_A, 200, 512, { fill: C.cell });
  caption(mem, "MEMORY");
  text(mem, "size", "64 KB", 16, 36, { size: 28, mono: true, bold: true });
  text(mem, "note",
    "Address only from MAR.\nData only through MDR.\n\nMEM_READ\nMDR ← mem[MAR]\n\nMEM_WRITE\nmem[MAR] ← MDR\n\nThe RAM window below follows PC.",
    16, 88, { size: 11, mono: true, color: C.dim, width: 168 });
}

function drawMemoryInterface(M, Lamp) {
  const ir = frame(M, "cpu/reg/IR", 40, ROW_B, 400, 200, { fill: C.cell, strokeWeight: 2 });
  caption(ir, "IR");
  text(ir, "sub", "instruction register · decodes against the table", 16, 32, { size: 11, color: C.dim, width: 368 });
  text(ir, "value", "00", 16, 60, { size: 36, mono: true, bold: true });
  text(ir, "mnem", "NOP", 96, 66, { size: 26, mono: true, bold: true, color: C.active });
  for (let k = 7; k >= 0; k--) lampInstance(Lamp, ir, `bit/${k}`, 16 + (7 - k) * 24, 168);
  valueBlock(M, "cpu/latch/OPR", "OPR", "register byte rd:rs", 488, ROW_B, 200, 200, "00");
  valueBlock(M, "cpu/latch/T", "T", "8-bit immediate", 712, ROW_B, 200, 200, "00");
  // ALU
  const alu = frame(M, "cpu/alu", 936, ROW_B, 624, 200, { fill: C.card });
  caption(alu, "ALU · A latch op bus → Y latch, flags");
  const body = frame(alu, "cpu/alu/body", 16, 36, 592, 148, { fill: C.cell, strokeWeight: 2 });
  text(body, "op-label", "OP", 16, 14, { size: 11, bold: true, color: C.dim, track: 6 });
  text(body, "cpu/alu/op", "—", 16, 36, { size: 30, mono: true, bold: true, color: C.active });
  const cols = [["A LATCH", "cpu/alu/in1", 128], ["BUS IN", "cpu/alu/in2", 240], ["Y LATCH", "cpu/alu/out", 352]];
  for (const [l, n, x] of cols) {
    text(body, `${n}-label`, l, x, 14, { size: 11, bold: true, color: C.dim, track: 6 });
    text(body, n, "00", x, 36, { size: 30, mono: true, bold: true });
  }
  text(body, "flags-label", "FLAGS", 476, 14, { size: 11, bold: true, color: C.dim, track: 6 });
  lampLabel(Lamp, body, "cpu/flag/Z", "Z", 476, 36, 100);
  lampLabel(Lamp, body, "cpu/flag/C", "C", 476, 70, 100);
  lampLabel(Lamp, body, "cpu/flag/N", "N", 476, 104, 100);
  text(body, "alu-note", "Y_LOAD keeps the result · FLAGS_LOAD keeps Z C N", 16, 120, { size: 10, mono: true, color: C.dim });
  valueBlock(M, "cpu/reg/MDR", "MDR", "memory data register", 1616, ROW_B, 240, 200, "00");
}

function drawRegisterFile(M, RegisterSet) {
  const idle = RegisterSet.children.find((c) => c.name === "State=idle");
  SPEC.registers.forEach((r, i) => {
    const inst = idle.createInstance();
    inst.name = `cpu/reg/${r}`;
    inst.x = 40 + i * 344;
    inst.y = ROW_C;
    M.appendChild(inst);
    inst.findOne((n) => n.name === "name").characters = r;
  });
  text(M, "regfile-label", "REGISTER FILE · A B C D H L · 8-bit each", 40, ROW_C + 212, { size: 11, bold: true, color: C.dim, track: 6 });
}

// Stage 4 — the control unit: phase lamps, the T-state counter, and every control signal grouped by role.

function signalGroups() {
  const sigs = SPEC.signals.signals;
  const memory = ["MAR_LOAD", "MEM_READ", "MEM_WRITE", "MDR_LOAD"];
  const aluSigs = ["ALU_OP", "Y_LOAD", "FLAGS_LOAD"];
  const pick = (f) => sigs.filter(f);
  const loads = pick((s) => /_LOAD$/.test(s.name) && !memory.includes(s.name) && !aluSigs.includes(s.name));
  const groups = [
    ["ADDRESS BUS DRIVERS", pick((s) => s.drives === "addr")],
    ["DATA BUS DRIVERS", pick((s) => s.drives === "data")],
    ["MEMORY", pick((s) => memory.includes(s.name))],
    ["LATCH LOADS", loads.slice(0, 6)],
    ["LATCH LOADS (cont.)", loads.slice(6)],
    ["ALU", pick((s) => aluSigs.includes(s.name))],
    ["COUNTERS · SEQUENCE", pick((s) => /_(INC|DEC)$/.test(s.name) || s.name === "T_RESET" || s.name === "HALT")],
  ];
  const placed = new Set(groups.flatMap((g) => g[1].map((s) => s.name)));
  const rest = sigs.filter((s) => !placed.has(s.name));
  if (rest.length) groups.push(["OTHER", rest]);
  return groups;
}

function drawControl(M, Lamp) {
  const b = frame(M, "cpu/control", 40, ROW_D, 2040, 360, { fill: C.card });
  caption(b, "CONTROL UNIT · each T-state turns on a set of signals; Watch mode lights them");
  lampLabel(Lamp, b, "cpu/phase/FETCH", "FETCH", 16, 44, 104);
  lampLabel(Lamp, b, "cpu/phase/DECODE", "DECODE", 128, 44, 104);
  lampLabel(Lamp, b, "cpu/phase/EXEC", "EXEC", 240, 44, 96);
  lampLabel(Lamp, b, "cpu/clock", "CLK", 344, 44, 80);
  text(b, "cpu/cycles", "instr 0 · T-states 0", 16, 84, { size: 12, mono: true, color: C.dim });
  const ts = frame(b, "cpu/tstate", 16, 112, 440, 232, { fill: C.cell });
  caption(ts, "T-STATE");
  text(ts, "value", "—", 16, 34, { size: 36, mono: true, bold: true });
  for (let t = 0; t < SPEC.signals.maxTStates; t++)
    lampLabel(Lamp, ts, `cpu/tstate/T${t}`, `T${t}`, 16 + (t % 6) * 70, 96 + Math.floor(t / 6) * 40, 64);
  const groups = signalGroups();
  const gx0 = 488, gw = (2040 - gx0 - 16 - (groups.length - 1) * 8) / groups.length;
  groups.forEach(([label, list], gi) => {
    const x = gx0 + gi * (gw + 8);
    text(b, "group-label", label, x, 44, { size: 10, bold: true, color: C.dim, track: 6 });
    list.forEach((s, i) =>
      lampLabel(Lamp, b, `cpu/sig/${s.name}`, s.name, x, 68 + i * 36, gw, s.drives ? C.busOn : C.dim));
  });
}

// Stage 5 — the decoder (the opcode table that is the CPU's logic) and the RAM and pinned windows.

function hex(n, w) {
  return n.toString(16).toUpperCase().padStart(w, "0");
}

function drawDecoder(M) {
  const rowH = 34;
  const b = frame(M, "cpu/decoder", 40, ROW_E, 1240, 96 + SPEC.opcodes.length * rowH);
  caption(b, "DECODER · OPCODE TABLE — this table is the CPU's logic. Edit a micro-op and the next instruction uses it.");
  const t = frame(b, "cpu/decoder/table", 16, 44, 1208, 40 + SPEC.opcodes.length * rowH, { fill: C.cell });
  for (const [h, x] of [["OP", 12], ["MNEM", 72], ["FMT", 168], ["MICRO-OPS", 272]])
    text(t, "header", h, x, 12, { size: 11, bold: true, color: C.dim, track: 6 });
  SPEC.opcodes.forEach((o, i) => {
    const row = frame(t, `row/${o.op}`, 0, 40 + i * rowH, 1208, rowH - 2, { fill: C.cell, stroke: null, radius: 4 });
    text(row, "op", o.op, 12, 7, { size: 14, mono: true, bold: true, color: C.lampOn });
    text(row, "mnem", o.mnem, 72, 7, { size: 14, mono: true, bold: true });
    text(row, "fmt", o.fmt, 168, 7, { size: 14, mono: true, color: C.dim });
    text(row, "micro", o.micro || "—", 272, 7, { size: 14, mono: true });
  });
  return b;
}

function cellGrid(parent, prefix, rows, y0) {
  for (let c = 0; c < 16; c++)
    text(parent, "colhead", hex(c, 1), 100 + c * 40, y0 - 20, { size: 11, mono: true, color: C.dim });
  for (let r = 0; r < rows; r++) {
    text(parent, `${prefix}/addr/${hex(r, 1)}`, hex(r * 16, 4), 16, y0 + r * 36 + 7, { size: 12, mono: true, color: C.dim });
    for (let c = 0; c < 16; c++) {
      const cell = frame(parent, `${prefix}/cell/${hex(r * 16 + c, 2)}`, 88 + c * 40, y0 + r * 36, 36, 30,
        { fill: C.cell, stroke: null, radius: 4 });
      text(cell, "v", "00", 6, 7, { size: 13, mono: true });
    }
  }
}

function drawRam(M, h) {
  const b = frame(M, "mem/ram", 1320, ROW_E, 760, h);
  caption(b, "RAM · 256-byte window that follows PC");
  text(b, "mem/ram/base", "base 0000", 560, 12, { size: 13, mono: true, bold: true, color: C.dim });
  cellGrid(b, "mem/ram", 16, 68);
  const py = 68 + 16 * 36 + 36;
  caption(b, "PINNED WINDOW · any address (set in the plugin panel)", 16, py, "pin-label");
  text(b, "mem/pin/base", "base 4000", 560, py - 2, { size: 13, mono: true, bold: true, color: C.dim });
  cellGrid(b, "mem/pin", 4, py + 44);
  const ky = py + 44 + 4 * 36 + 24;
  text(b, "cell-key", "green cell = PC   ·   amber cell = MAR during MEM_READ / MEM_WRITE", 16, ky, { size: 11, mono: true, color: C.dim });
}

// Stage 6 — the 128×96 screen with its palette, memory-mapped IO, and the reading legend.

function drawScreen(M) {
  const v = SPEC.memory.vram;
  const b = frame(M, "dev/screen/frame", 2120, ROW_A, 808, 704);
  caption(b, `SCREEN · ${v.width} × ${v.height} · ${SPEC.palette.name} · VRAM ${v.start}–${v.end}`);
  rect(b, "dev/screen", 20, 40, 768, 576, "#000000", 4);
  SPEC.palette.colors.forEach((col, i) => {
    rect(b, `dev/palette/${i}`, 20 + i * 48, 632, 44, 28, col, 4);
    text(b, "palette-index", hex(i, 1), 20 + i * 48 + 18, 666, { size: 10, mono: true, color: C.dim });
  });
}

function drawIo(M) {
  const b = frame(M, "mem/io", 2120, 884, 808, 304);
  caption(b, "IO · memory-mapped at F000–F005");
  Object.entries(SPEC.memory.io).forEach(([name, addr], i) => {
    const f = frame(b, `mem/io/${name}`, 16 + (i % 3) * 264, 44 + Math.floor(i / 3) * 124, 248, 112, { fill: C.cell });
    text(f, "label", name, 14, 12, { size: 12, bold: true, color: C.dim });
    text(f, "addr", addr.replace("0x", ""), 196, 12, { size: 11, mono: true, color: C.dim });
    text(f, "value", "00", 14, 44, { size: 36, mono: true, bold: true });
  });
}

function drawLegend(M) {
  const b = frame(M, "legend", 2120, 1228, 808, 152);
  caption(b, "READING THE MACHINE");
  const lines = [
    [C.lampOn, "yellow lamp: bit set, flag set, or signal on"],
    [C.active, "green: latched or active in this T-state, current decoder row"],
    [C.busOn, "amber: a bus is being driven; driver signals are amber"],
  ];
  lines.forEach(([col, s], i) => {
    rect(b, "swatch", 16, 44 + i * 28, 12, 12, col, 6);
    text(b, "line", s, 40, 41 + i * 28, { size: 12, color: C.text });
  });
  text(b, "run", "Run: Plugins → Development → FigmaCPU on this page", 16, 128, { size: 11, mono: true, color: C.dim });
}

// Stage 7 — assembles the machine on the Leila page from the stages above.

async function drawMachine() {
  await loadFonts();
  const page = figma.root.children.find((p) => p.name === TARGET_PAGE);
  if (!page) throw new Error(`page "${TARGET_PAGE}" not found`);
  await figma.setCurrentPageAsync(page);
  await page.loadAsync();

  const existing = page.children.filter((n) => n.name === "Machine v2" || n.name === "Components v2");
  if (existing.length) {
    if (!FORCE_REDRAW) return `Machine v2 already drawn on "${TARGET_PAGE}" — nothing changed (build with --force to replace)`;
    existing.forEach((n) => n.remove());
  }
  // Earlier Leila drafts stay in the file, moved aside.
  for (const n of page.children) {
    if (n.name.startsWith("FigmaCPU v1") || n.name.startsWith("Components · FigmaCPU")) {
      n.x = 3400 + (n.name.startsWith("Components") ? 2700 : 0);
      if (!n.name.startsWith("Superseded")) n.name = `Superseded · ${n.name}`;
    }
  }

  const decoderH = 96 + SPEC.opcodes.length * 34;
  const H = ROW_E + Math.max(decoderH, 1100) + 40;
  const comps = frame(page, "Components v2", 0, H + 80, 780, 260, { fill: C.bg, stroke: null });
  caption(comps, "COMPONENTS");
  const area = frame(comps, "items", 16, 44, 748, 210, { fill: null, stroke: null });
  const Lamp = makeLamp(area);
  const RegisterSet = makeRegisterSet(area, Lamp);

  const M = frame(page, "Machine v2", 0, 0, 2968, H, { fill: C.bg, stroke: null, radius: 0 });
  text(M, "title", "FIGMA CPU — 8-bit data · 16-bit address · two buses · the opcode table on this canvas is the logic", 40, 40, { size: 28, bold: true });
  text(M, "legend-line", "Address sources sit above the address bus, the memory interface and ALU between the buses, the register file below the data bus.", 40, 84, { size: 14, color: C.dim });

  drawTaps(M);
  drawBuses(M);
  drawAddressSources(M, Lamp);
  drawMemoryInterface(M, Lamp);
  drawRegisterFile(M, RegisterSet);
  drawControl(M, Lamp);
  drawDecoder(M);
  drawRam(M, Math.max(decoderH, 1100));
  drawScreen(M);
  drawIo(M);
  drawLegend(M);

  figma.viewport.scrollAndZoomIntoView([M]);
  const named = M.findAll((n) => /^(cpu|mem|dev)\//.test(n.name)).length;
  return `Drew Machine v2 on "${page.name}" (${M.id}) with ${named} contract-named nodes`;
}

return await drawMachine();
