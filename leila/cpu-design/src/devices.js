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
