const SPEC = {"registers":["A","B","C","D","H","L"],"opcodes":[{"op":"00","mnem":"NOP","fmt":"-","micro":""},{"op":"01","mnem":"HLT","fmt":"-","micro":"HALT"},{"op":"10","mnem":"LDI","fmt":"r,i8","micro":"REG; IMM8; SET rd T"},{"op":"11","mnem":"MOV","fmt":"r,r","micro":"REG; COPY rd rs"},{"op":"12","mnem":"LD","fmt":"r","micro":"REG; LOAD rd HL"},{"op":"13","mnem":"ST","fmt":"r","micro":"REG; STORE rd HL"},{"op":"14","mnem":"LDA","fmt":"r,a16","micro":"REG; IMM16; LOAD rd W"},{"op":"15","mnem":"STA","fmt":"r,a16","micro":"REG; IMM16; STORE rd W"},{"op":"16","mnem":"LHL","fmt":"i16","micro":"IMM16; SETHL W"},{"op":"20","mnem":"ADD","fmt":"r,r","micro":"REG; ALU ADD rd rs"},{"op":"21","mnem":"SUB","fmt":"r,r","micro":"REG; ALU SUB rd rs"},{"op":"22","mnem":"AND","fmt":"r,r","micro":"REG; ALU AND rd rs"},{"op":"23","mnem":"OR","fmt":"r,r","micro":"REG; ALU OR rd rs"},{"op":"24","mnem":"XOR","fmt":"r,r","micro":"REG; ALU XOR rd rs"},{"op":"25","mnem":"CMP","fmt":"r,r","micro":"REG; ALU CMP rd rs"},{"op":"26","mnem":"INC","fmt":"r","micro":"REG; ALU INC rd"},{"op":"27","mnem":"DEC","fmt":"r","micro":"REG; ALU DEC rd"},{"op":"28","mnem":"SHL","fmt":"r","micro":"REG; ALU SHL rd"},{"op":"29","mnem":"SHR","fmt":"r","micro":"REG; ALU SHR rd"},{"op":"2A","mnem":"INHL","fmt":"-","micro":"INCHL"},{"op":"30","mnem":"JMP","fmt":"a16","micro":"IMM16; JUMP W"},{"op":"31","mnem":"JZ","fmt":"a16","micro":"IMM16; JUMP W Z"},{"op":"32","mnem":"JNZ","fmt":"a16","micro":"IMM16; JUMP W NZ"},{"op":"33","mnem":"JC","fmt":"a16","micro":"IMM16; JUMP W C"},{"op":"34","mnem":"JNC","fmt":"a16","micro":"IMM16; JUMP W NC"},{"op":"35","mnem":"CALL","fmt":"a16","micro":"IMM16; PUSHPC; JUMP W"},{"op":"36","mnem":"RET","fmt":"-","micro":"POPPC"},{"op":"40","mnem":"PUSH","fmt":"r","micro":"REG; PUSH rd"},{"op":"41","mnem":"POP","fmt":"r","micro":"REG; POP rd"}],"palette":{"name":"PICO-8","colors":["#000000","#1D2B53","#7E2553","#008751","#AB5236","#5F574F","#C2C3C7","#FFF1E8","#FF004D","#FFA300","#FFEC27","#00E436","#29ADFF","#83769C","#FF77A8","#FFCCAA"]},"memory":{"program":{"start":"0x0000","end":"0x3FFF"},"ram":{"start":"0x4000","end":"0x7EFF"},"stackTop":"0x7F00","vram":{"start":"0x8000","end":"0xAFFF","width":128,"height":96},"io":{"MOUSE_X":"0xF000","MOUSE_Y":"0xF001","MOUSE_BTN":"0xF002","KEY":"0xF003","TICK":"0xF004","RAND":"0xF005"}},"signals":{"maxTStates":18,"signals":[{"name":"PC_OUT","drives":"addr","desc":"PC → address bus"},{"name":"HL_OUT","drives":"addr","desc":"H:L → address bus"},{"name":"W_OUT","drives":"addr","desc":"W latch → address bus"},{"name":"SP_OUT","drives":"addr","desc":"SP → address bus"},{"name":"MAR_LOAD","desc":"MAR ← address bus"},{"name":"MEM_READ","desc":"MDR ← mem[MAR]"},{"name":"MEM_WRITE","desc":"mem[MAR] ← MDR"},{"name":"MDR_LOAD","desc":"MDR ← data bus"},{"name":"MDR_OUT","drives":"data","desc":"MDR → data bus"},{"name":"REG_OUT","drives":"data","desc":"register → data bus"},{"name":"T_OUT","drives":"data","desc":"T latch → data bus"},{"name":"Y_OUT","drives":"data","desc":"Y latch (ALU result) → data bus"},{"name":"PCH_OUT","drives":"data","desc":"PC high byte → data bus"},{"name":"PCL_OUT","drives":"data","desc":"PC low byte → data bus"},{"name":"IR_LOAD","desc":"IR ← data bus"},{"name":"OPR_LOAD","desc":"OPR (register byte) ← data bus"},{"name":"T_LOAD","desc":"T latch ← data bus"},{"name":"W_LO_LOAD","desc":"W low byte ← data bus"},{"name":"W_HI_LOAD","desc":"W high byte ← data bus"},{"name":"A_LOAD","desc":"A latch (ALU input 1) ← data bus"},{"name":"REG_LOAD","desc":"register ← data bus"},{"name":"PC_LOAD","desc":"PC ← address bus"},{"name":"PCH_LOAD","desc":"PC high byte ← data bus"},{"name":"PCL_LOAD","desc":"PC low byte ← data bus"},{"name":"HL_LOAD","desc":"H:L ← address bus"},{"name":"ALU_OP","desc":"ALU computes A latch ⊕ data bus"},{"name":"Y_LOAD","desc":"Y latch ← ALU result"},{"name":"FLAGS_LOAD","desc":"Z C N ← ALU flags"},{"name":"PC_INC","desc":"PC ← PC + 1"},{"name":"SP_INC","desc":"SP ← SP + 1"},{"name":"SP_DEC","desc":"SP ← SP − 1"},{"name":"HL_INC","desc":"H:L ← H:L + 1"},{"name":"T_RESET","desc":"end of instruction, T-state counter → T0"},{"name":"HALT","desc":"stop the clock"}]}};
const __FORCE_REDRAW__ = false;
const __TARGET_PAGE__ = "Eric";
// Draws the FigmaCPU v2 machine onto a page (default "Machine v2"; build.mjs --page <name>).
// SPEC (opcodes + palette + memory map + control signals) is injected by build.mjs.
// Every node the plugin binds to follows the naming contract in PRD §4.2.
// Re-running is safe: if the machine already exists nothing is touched,
// unless FORCE_REDRAW is true (then only the frames this script owns are replaced).

const FORCE_REDRAW =
  typeof __FORCE_REDRAW__ !== "undefined" ? __FORCE_REDRAW__ : false;
const TARGET_PAGE =
  typeof __TARGET_PAGE__ !== "undefined" ? __TARGET_PAGE__ : "Machine v2";

// The datapath internals block sits between the top blocks and the buses;
// everything below it moves down by SHIFT.
const SHIFT = 360;

const C = {
  bg: "#141414",
  card: "#1E1E1E",
  cell: "#262626",
  stroke: "#2E2E2E",
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
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}
function solid(hex, opacity = 1) {
  return [{ type: "SOLID", color: rgb(hex), opacity }];
}

let SANS, SANS_B, MONO, MONO_B;
async function loadFonts() {
  SANS = { family: "Inter", style: "Regular" };
  SANS_B = { family: "Inter", style: "Bold" };
  await figma.loadFontAsync(SANS);
  await figma.loadFontAsync(SANS_B);
  try {
    MONO = { family: "Roboto Mono", style: "Regular" };
    MONO_B = { family: "Roboto Mono", style: "Bold" };
    await figma.loadFontAsync(MONO);
    await figma.loadFontAsync(MONO_B);
  } catch (e) {
    MONO = SANS;
    MONO_B = SANS_B;
  }
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
    f.strokeWeight = o.strokeWeight || 2;
  }
  f.cornerRadius = o.radius !== undefined ? o.radius : 14;
  f.clipsContent = false;
  if (o.dash) f.dashPattern = o.dash;
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
  t.fontSize = o.size || 14;
  t.characters = chars;
  t.fills = solid(o.color || C.text);
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

function blockLabel(parent, label) {
  return text(parent, "label", label, 16, 12, {
    size: 15,
    bold: true,
    color: C.dim,
  });
}

// ---------- components ----------

function makeLamp(parent) {
  const lamp = figma.createComponent();
  lamp.name = "Lamp";
  lamp.resize(14, 14);
  lamp.cornerRadius = 7;
  lamp.fills = solid(C.lampOff);
  lamp.x = 0;
  lamp.y = 0;
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

function makeRegisterSet(parent, Lamp) {
  const variants = ["idle", "active"].map((state, k) => {
    const c = figma.createComponent();
    c.name = `State=${state}`;
    c.resize(230, 200);
    c.cornerRadius = 12;
    c.fills = solid(C.cell);
    c.strokes = solid(state === "active" ? C.active : C.stroke);
    c.strokeWeight = state === "active" ? 3 : 2;
    c.x = k * 250;
    c.y = 0;
    text(c, "name", "R", 16, 12, { size: 18, bold: true, color: C.dim });
    text(c, "value", "00", 16, 38, { size: 56, mono: true, bold: true });
    text(c, "dec", "0", 160, 16, {
      size: 14,
      mono: true,
      color: C.dim,
      width: 54,
      align: "RIGHT",
    });
    for (let b = 7; b >= 0; b--)
      lampInstance(Lamp, c, `bit/${b}`, 16 + (7 - b) * 26, 166);
    return c;
  });
  const set = figma.combineAsVariants(variants, parent);
  set.name = "Register";
  set.x = 60;
  set.y = 0;
  return set;
}

// ---------- blocks ----------

function wideRegister(Lamp, parent, name, label, x, y, bits) {
  const f = frame(parent, name, x, y, 568, 110, { fill: C.cell, radius: 10 });
  text(f, "label", label, 12, 8, { size: 14, bold: true, color: C.dim });
  text(f, "value", bits === 16 ? "0000" : "00", 12, 30, {
    size: 40,
    mono: true,
    bold: true,
  });
  for (let b = bits - 1; b >= 0; b--)
    lampInstance(Lamp, f, `bit/${b}`, 12 + (bits - 1 - b) * 22, 86);
  return f;
}

function lampLabel(Lamp, parent, name, label, x, y, w = 150) {
  const f = frame(parent, name, x, y, w, 32, { fill: C.cell, radius: 8 });
  lampInstance(Lamp, f, "lamp", 10, 9);
  text(f, "label", label, 32, 7, { size: 14, bold: true, color: C.dim });
  return f;
}

function drawControl(M, Lamp) {
  const b = frame(M, "cpu/control", 40, 140, 600, 470);
  blockLabel(b, "CONTROL");
  wideRegister(Lamp, b, "cpu/reg/PC", "PC · program counter", 16, 44, 16);
  wideRegister(Lamp, b, "cpu/reg/SP", "SP · stack pointer", 16, 164, 16);
  const ir = frame(b, "cpu/reg/IR", 16, 284, 568, 96, {
    fill: C.cell,
    radius: 10,
  });
  text(ir, "label", "IR · instruction", 12, 8, {
    size: 14,
    bold: true,
    color: C.dim,
  });
  text(ir, "value", "00", 12, 30, { size: 40, mono: true, bold: true });
  text(ir, "mnem", "NOP", 100, 36, {
    size: 28,
    mono: true,
    bold: true,
    color: C.active,
  });
  for (let k = 7; k >= 0; k--)
    lampInstance(Lamp, ir, `bit/${k}`, 380 + (7 - k) * 22, 46);
  lampLabel(Lamp, b, "cpu/phase/FETCH", "FETCH", 16, 394);
  lampLabel(Lamp, b, "cpu/phase/DECODE", "DECODE", 176, 394);
  lampLabel(Lamp, b, "cpu/phase/EXEC", "EXEC", 336, 394);
  lampLabel(Lamp, b, "cpu/clock", "CLK", 496, 394, 88);
  text(b, "cpu/cycles", "cycles 0", 16, 436, {
    size: 13,
    mono: true,
    color: C.dim,
  });
}

function drawRegisters(M, RegisterSet) {
  const b = frame(M, "cpu/registers", 680, 140, 760, 470);
  blockLabel(b, "REGISTERS");
  text(b, "cpu/reg/HL", "H:L = 0000", 560, 12, {
    size: 15,
    mono: true,
    bold: true,
    color: C.dim,
  });
  const idle = RegisterSet.children.find((c) => c.name === "State=idle");
  SPEC.registers.forEach((r, i) => {
    const inst = idle.createInstance();
    inst.name = `cpu/reg/${r}`;
    inst.x = 16 + (i % 3) * 248;
    inst.y = 50 + Math.floor(i / 3) * 210;
    b.appendChild(inst);
    inst.findOne((n) => n.name === "name").characters = r;
  });
}

function drawAlu(M, Lamp) {
  const b = frame(M, "cpu/alu", 1480, 140, 600, 470);
  blockLabel(b, "ALU");
  const alu = frame(b, "cpu/alu/body", 16, 44, 568, 280, {
    fill: C.cell,
    radius: 10,
  });
  text(alu, "cpu/alu/op", "—", 16, 12, {
    size: 48,
    mono: true,
    bold: true,
    color: C.active,
  });
  text(alu, "l1", "A LATCH", 16, 100, { size: 14, bold: true, color: C.dim });
  text(alu, "cpu/alu/in1", "00", 120, 90, { size: 32, mono: true });
  text(alu, "l2", "BUS IN", 16, 154, { size: 14, bold: true, color: C.dim });
  text(alu, "cpu/alu/in2", "00", 120, 144, { size: 32, mono: true });
  text(alu, "l3", "Y LATCH", 16, 214, { size: 14, bold: true, color: C.dim });
  text(alu, "cpu/alu/out", "00", 120, 200, {
    size: 40,
    mono: true,
    bold: true,
  });
  text(b, "flags-label", "FLAGS", 16, 344, {
    size: 14,
    bold: true,
    color: C.dim,
  });
  lampLabel(Lamp, b, "cpu/flag/Z", "Z zero", 16, 372);
  lampLabel(Lamp, b, "cpu/flag/C", "C carry", 176, 372);
  lampLabel(Lamp, b, "cpu/flag/N", "N negative", 336, 372, 170);
}

function drawBuses(M) {
  // taps first so the buses render on top of them
  const taps = [
    ["control", 340, 610, 40 + SHIFT],
    ["registers", 1060, 610, 140 + SHIFT],
    ["alu", 1780, 610, 140 + SHIFT],
    ["decoder", 640, 830 + SHIFT, 40],
    ["ram/addr", 1400, 730 + SHIFT, 140],
    ["ram/data", 1700, 830 + SHIFT, 40],
  ];
  for (const [n, x, y, h] of taps)
    rect(M, `cpu/bus/tap/${n}`, x, y, 10, h, C.bus, 2);
  const buses = [
    ["cpu/bus/addr", "ADDRESS BUS · 16-bit", "0000", 650 + SHIFT],
    ["cpu/bus/data", "DATA BUS · 8-bit", "00", 750 + SHIFT],
  ];
  for (const [name, label, val, y] of buses) {
    const f = frame(M, name, 40, y, 2040, 80, { radius: 12 });
    text(f, "label", label, 16, 8, { size: 13, bold: true, color: C.dim });
    text(f, "value", val, 16, 30, { size: 30, mono: true, bold: true });
    rect(f, "wire", 200, 34, 1820, 14, C.bus, 7);
  }
}

function drawDecoder(M) {
  const b = frame(M, "cpu/decoder", 40, 870 + SHIFT, 1240, 1100);
  blockLabel(
    b,
    "DECODER · OPCODE TABLE — the CPU's logic. Edit the micro-ops to rewire it.",
  );
  const rowH = 34;
  const t = frame(
    b,
    "cpu/decoder/table",
    16,
    50,
    1208,
    40 + SPEC.opcodes.length * rowH,
    {
      fill: C.cell,
      radius: 10,
    },
  );
  const cols = [
    ["OP", 12],
    ["MNEM", 80],
    ["FMT", 180],
    ["MICRO-OPS", 300],
  ];
  for (const [h, x] of cols)
    text(t, "header", h, x, 12, { size: 12, bold: true, color: C.dim });
  SPEC.opcodes.forEach((o, i) => {
    const row = frame(t, `row/${o.op}`, 0, 40 + i * rowH, 1208, rowH - 2, {
      fill: C.cell,
      stroke: null,
      radius: 6,
    });
    text(row, "op", o.op, 12, 6, {
      size: 16,
      mono: true,
      bold: true,
      color: C.lampOn,
    });
    text(row, "mnem", o.mnem, 80, 6, { size: 16, mono: true, bold: true });
    text(row, "fmt", o.fmt, 180, 6, { size: 16, mono: true, color: C.dim });
    text(row, "micro", o.micro || "—", 300, 6, { size: 16, mono: true });
  });
}

function hex(n, w) {
  return n.toString(16).toUpperCase().padStart(w, "0");
}

function cellGrid(parent, prefix, rows, y0) {
  for (let c = 0; c < 16; c++)
    text(parent, "colhead", hex(c, 1), 104 + c * 40, y0 - 22, {
      size: 12,
      mono: true,
      color: C.dim,
    });
  for (let r = 0; r < rows; r++) {
    text(
      parent,
      `${prefix}/addr/${hex(r, 1)}`,
      hex(r * 16, 4),
      16,
      y0 + r * 38 + 6,
      {
        size: 14,
        mono: true,
        color: C.dim,
      },
    );
    for (let c = 0; c < 16; c++) {
      const cell = frame(
        parent,
        `${prefix}/cell/${hex(r * 16 + c, 2)}`,
        90 + c * 40,
        y0 + r * 38,
        36,
        30,
        {
          fill: C.cell,
          stroke: null,
          radius: 5,
        },
      );
      text(cell, "v", "00", 6, 6, { size: 14, mono: true });
    }
  }
}

function drawRam(M) {
  const b = frame(M, "mem/ram", 1320, 870 + SHIFT, 760, 1100);
  blockLabel(b, "RAM · window follows PC");
  text(b, "mem/ram/base", "base 0000", 560, 12, {
    size: 15,
    mono: true,
    bold: true,
    color: C.dim,
  });
  cellGrid(b, "mem/ram", 16, 72);
  text(b, "pin-label", "PINNED · any address", 16, 712, {
    size: 15,
    bold: true,
    color: C.dim,
  });
  text(b, "mem/pin/base", "base 4000", 560, 712, {
    size: 15,
    mono: true,
    bold: true,
    color: C.dim,
  });
  cellGrid(b, "mem/pin", 4, 772);
}

function drawScreen(M) {
  const b = frame(M, "dev/screen/frame", 2120, 140, 808, 700);
  blockLabel(
    b,
    `SCREEN · ${SPEC.memory.vram.width}×${SPEC.memory.vram.height} · ${SPEC.palette.name}`,
  );
  rect(b, "dev/screen", 20, 50, 768, 576, "#000000", 4);
  SPEC.palette.colors.forEach((col, i) =>
    rect(b, `dev/palette/${i}`, 20 + i * 48, 640, 44, 40, col, 4),
  );
}

function drawIo(M) {
  const b = frame(M, "mem/io", 2120, 870, 808, 380);
  blockLabel(b, "IO · memory-mapped");
  Object.entries(SPEC.memory.io).forEach(([name, addr], i) => {
    const f = frame(
      b,
      `mem/io/${name}`,
      16 + (i % 3) * 262,
      50 + Math.floor(i / 3) * 150,
      248,
      130,
      {
        fill: C.cell,
        radius: 10,
      },
    );
    text(f, "label", name, 12, 10, { size: 14, bold: true, color: C.dim });
    text(f, "addr", addr.replace("0x", ""), 190, 10, {
      size: 12,
      mono: true,
      color: C.dim,
    });
    text(f, "value", "00", 12, 50, { size: 44, mono: true, bold: true });
  });
}

function smallReg(parent, name, label, x, w, value) {
  const f = frame(parent, name, x, 44, w, 96, { fill: C.cell, radius: 10 });
  text(f, "label", label, 12, 8, { size: 13, bold: true, color: C.dim });
  text(f, "value", value, 12, 34, { size: 36, mono: true, bold: true });
  return f;
}

// Stage 2b (PRD §6.3–6.4): MAR/MDR, operand latches, T-state counter, control-signal lamps.
function drawInternals(M, Lamp) {
  const b = frame(M, "cpu/internal", 40, 650, 2040, 330);
  blockLabel(
    b,
    "DATAPATH · latches · T-state counter · control signals (Watch mode lights the signals of each T-state)",
  );
  smallReg(b, "cpu/reg/MAR", "MAR · mem address", 16, 250, "0000");
  smallReg(b, "cpu/reg/MDR", "MDR · mem data", 282, 170, "00");
  smallReg(b, "cpu/latch/OPR", "OPR · reg byte", 468, 170, "00");
  smallReg(b, "cpu/latch/T", "T · imm8", 654, 170, "00");
  smallReg(b, "cpu/latch/W", "W · imm16", 840, 250, "0000");

  const ts = frame(b, "cpu/tstate", 1110, 44, 914, 96, { fill: C.cell, radius: 10 });
  text(ts, "label", "T-STATE", 12, 8, { size: 13, bold: true, color: C.dim });
  text(ts, "value", "—", 12, 34, { size: 36, mono: true, bold: true });
  for (let t = 0; t < SPEC.signals.maxTStates; t++)
    lampLabel(Lamp, ts, `cpu/tstate/T${t}`, `T${t}`, 120 + (t % 9) * 88, t < 9 ? 10 : 52, 84);

  SPEC.signals.signals.forEach((s, i) => {
    const f = lampLabel(Lamp, b, `cpu/sig/${s.name}`, s.name, 16 + (i % 9) * 224, 156 + Math.floor(i / 9) * 40, 216);
    if (s.drives) f.findOne((n) => n.name === "label").fills = solid(C.busOn, 0.75);
  });
}

function drawFutureSlot(M) {
  const b = frame(M, "slot/future/figma-app", 2120, 1290, 808, 680 + SHIFT, {
    fill: "#1A1A1A",
    stroke: "#555555",
    dash: [16, 10],
  });
  text(b, "label", "PHASE 2 — mini Figma app running on this CPU", 16, 16, {
    size: 18,
    bold: true,
    color: C.dim,
  });
  text(
    b,
    "note",
    "Reserved. Shape table in RAM · rect tool · layers panel read from memory.",
    16,
    48,
    {
      size: 14,
      color: C.dim,
      width: 760,
    },
  );
}

async function drawMachine() {
  await loadFonts();

  let page = figma.root.children.find((p) => p.name === TARGET_PAGE);
  if (!page) {
    page = figma.createPage();
    page.name = TARGET_PAGE;
  }
  await figma.setCurrentPageAsync(page);
  await page.loadAsync();

  const existing = page.children.filter(
    (n) => n.name === "Machine v2" || n.name === "Components v2",
  );
  if (existing.length) {
    if (!FORCE_REDRAW)
      return "Machine v2 already drawn — nothing changed (set FORCE_REDRAW to replace)";
    existing.forEach((n) => n.remove());
  }

  const comps = frame(page, "Components v2", 0, 2120 + SHIFT, 600, 260, {
    fill: C.bg,
    stroke: null,
  });
  text(comps, "label", "Components", 16, 12, {
    size: 15,
    bold: true,
    color: C.dim,
  });
  const compArea = frame(comps, "items", 16, 44, 560, 210, {
    fill: null,
    stroke: null,
  });
  const Lamp = makeLamp(compArea);
  const RegisterSet = makeRegisterSet(compArea, Lamp);
  comps.resize(Math.max(600, RegisterSet.x + RegisterSet.width + 60), 260);
  compArea.resize(comps.width - 32, 210);

  const M = frame(page, "Machine v2", 0, 0, 2968, 2010 + SHIFT, {
    fill: C.bg,
    stroke: null,
    radius: 0,
  });
  text(
    M,
    "title",
    "FIGMA CPU v2 — 8-bit · 16-bit address · driven by the micro-op table on this canvas",
    40,
    36,
    {
      size: 36,
      bold: true,
    },
  );
  text(
    M,
    "legend",
    "Yellow lamp = bit set   ·   Green = loaded / active this T-state   ·   Orange = bus driven   ·   Run it with the FigmaCPU plugin (plugin/manifest.json)",
    40,
    92,
    { size: 15, color: C.dim },
  );

  drawBuses(M);
  drawControl(M, Lamp);
  drawRegisters(M, RegisterSet);
  drawAlu(M, Lamp);
  drawInternals(M, Lamp);
  drawDecoder(M);
  drawRam(M);
  drawScreen(M);
  drawIo(M);
  drawFutureSlot(M);

  figma.viewport.scrollAndZoomIntoView([M]);
  const named = M.findAll((n) => /^(cpu|mem|dev)\//.test(n.name)).length;
  return `Drew Machine v2 (${M.id}) with ${named} contract-named nodes on page "${page.name}" (${page.id})`;
}

return await drawMachine();
