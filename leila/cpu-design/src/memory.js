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
