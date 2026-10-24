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
