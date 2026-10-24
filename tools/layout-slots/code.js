// Draws dashed placeholder frames on the current page showing where each
// CPU part goes. Re-running is safe: existing slot/* frames are left alone.

const SLOTS = [
  {
    name: "slot/cpu/control",
    title: "CONTROL — PC · SP · IR · clock",
    stage: "Stage 1",
    x: 0,
    y: 200,
    w: 600,
    h: 450,
    color: [0.36, 0.55, 1.0],
  },
  {
    name: "slot/cpu/registers",
    title: "REGISTERS — A B C D H L",
    stage: "Stage 1",
    x: 650,
    y: 200,
    w: 700,
    h: 450,
    color: [0.36, 0.55, 1.0],
  },
  {
    name: "slot/cpu/alu",
    title: "ALU + FLAGS (Z C N)",
    stage: "Stage 1",
    x: 1400,
    y: 200,
    w: 600,
    h: 450,
    color: [0.36, 0.55, 1.0],
  },
  {
    name: "slot/cpu/bus/addr",
    title: "ADDRESS BUS (16-bit)",
    stage: "Stage 1",
    x: 0,
    y: 700,
    w: 2000,
    h: 100,
    color: [0.95, 0.6, 0.2],
  },
  {
    name: "slot/cpu/bus/data",
    title: "DATA BUS (8-bit)",
    stage: "Stage 1",
    x: 0,
    y: 820,
    w: 2000,
    h: 100,
    color: [0.95, 0.6, 0.2],
  },
  {
    name: "slot/cpu/decoder",
    title: "DECODER / OPCODE TABLE — op | mnem | args | micro-ops",
    stage: "Stage 2",
    x: 0,
    y: 980,
    w: 1250,
    h: 900,
    color: [0.6, 0.4, 1.0],
  },
  {
    name: "slot/mem/ram",
    title: "RAM WINDOW — PC-follow + pinned",
    stage: "Stage 2",
    x: 1300,
    y: 980,
    w: 700,
    h: 900,
    color: [0.2, 0.75, 0.5],
  },
  {
    name: "slot/dev/screen",
    title: "SCREEN 128×96 — single image-fill rect (6× = 768×576)",
    stage: "Stage 6",
    x: 2100,
    y: 200,
    w: 808,
    h: 656,
    color: [0.9, 0.3, 0.45],
  },
  {
    name: "slot/dev/io",
    title: "IO — mouse · keys · TICK · RAND",
    stage: "Stage 7",
    x: 2100,
    y: 980,
    w: 808,
    h: 400,
    color: [0.9, 0.3, 0.45],
  },
  {
    name: "slot/future/figma-app",
    title: "PHASE 2 — mini Figma app (future)",
    stage: "Phase 2",
    x: 2100,
    y: 1430,
    w: 808,
    h: 450,
    color: [0.55, 0.55, 0.55],
  },
];

async function main() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  const page = figma.currentPage;
  const existing = new Set(page.children.map((n) => n.name));
  const created = [];

  if (!existing.has("slot/title")) {
    const title = figma.createText();
    title.name = "slot/title";
    title.fontName = { family: "Inter", style: "Bold" };
    title.fontSize = 64;
    title.characters = "FigmaCPU — layout (dashed = not built yet)";
    title.x = 0;
    title.y = 40;
    page.appendChild(title);
    created.push(title);
  }

  for (const s of SLOTS) {
    if (existing.has(s.name)) continue;
    const [r, g, b] = s.color;

    const frame = figma.createFrame();
    frame.name = s.name;
    frame.x = s.x;
    frame.y = s.y;
    frame.resize(s.w, s.h);
    frame.cornerRadius = 12;
    frame.fills = [{ type: "SOLID", color: { r, g, b }, opacity: 0.08 }];
    frame.strokes = [{ type: "SOLID", color: { r, g, b } }];
    frame.strokeWeight = 3;
    frame.dashPattern = [16, 10];
    frame.clipsContent = false;

    const label = figma.createText();
    label.name = "label";
    label.fontName = { family: "Inter", style: "Bold" };
    label.fontSize = 22;
    label.characters = s.title;
    label.fills = [
      { type: "SOLID", color: { r: r * 0.6, g: g * 0.6, b: b * 0.6 } },
    ];
    label.x = 16;
    label.y = 12;
    frame.appendChild(label);

    const tag = figma.createText();
    tag.name = "stage";
    tag.fontName = { family: "Inter", style: "Regular" };
    tag.fontSize = 16;
    tag.characters = `TODO · ${s.stage} · ${s.name}`;
    tag.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    tag.x = 16;
    tag.y = 44;
    frame.appendChild(tag);

    page.appendChild(frame);
    created.push(frame);
  }

  if (created.length) figma.viewport.scrollAndZoomIntoView(created);
  figma.closePlugin(`Created ${created.length} slot(s)`);
}

main().catch((err) => figma.closePlugin(`layout-slots failed: ${err.message}`));
