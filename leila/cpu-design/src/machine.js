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
