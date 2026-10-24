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
