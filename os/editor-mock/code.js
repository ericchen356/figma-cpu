// FigmaOS Editor Mock — draws the Figma Design editor mock AND wires it up so it works in
// Prototype > Present (variables + prototype interactions only; no code runs in the mock).
//
// Layout follows the real Figma editor (icon rail, Pages/Layers, rulers, floating toolbar,
// Properties) on the OS screen grid from OS-DESIGN.md §1 scaled x10:
//   128x96 px  ->  1280x960 frame;  1 CPU pixel = 10 px;  8x8 tile = 80x80;  16x12 tile grid.
// Every panel, row, layer and swatch snaps to that grid.
//
// No boot or login screen: it opens straight into the editor.
// What works in Present: select a layer (Layers row or on canvas), recolor it with the
// 16 PICO-8 swatches, delete it, reset, and switch tools (V F R O T H highlight).
// X/Y/W/H read out in CPU pixels (1 canvas cell = 8 px).
// Re-running replaces the previous mock and its "Editor State" variables.

const FONT = "Inter";
const PX = 10; // screen pixel -> design px
const T = 8 * PX; // tile = 80
const COLS = 16, ROWS = 12;
const W = COLS * T, H = ROWS * T; // 1280 x 960
const LOGO_B64 = "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";

const UI = {
  bar: "#2C2C2C", panel: "#2C2C2C", canvas: "#1E1E1E", line: "#444444", field: "#383838",
  text: "#FFFFFF", dim: "#B3B3B3", faint: "#8C8C8C", blue: "#0D99FF", blueSel: "#0D99FF40",
};
// spec/palette.json (PICO-8)
const PAL = ["#000000", "#1D2B53", "#7E2553", "#008751", "#AB5236", "#5F574F", "#C2C3C7", "#FFF1E8",
  "#FF004D", "#FFA300", "#FFEC27", "#00E436", "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA"];

const hex = (h) => {
  h = h.replace("#", "");
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4) };
};
const alpha = (h) => (h.length > 7 ? parseInt(h.slice(7, 9), 16) / 255 : 1);
const paint = (h) => [{ type: "SOLID", color: hex(h), opacity: alpha(h) }];

// ------------------------------------------------------------ layers of the document
// Positions are in canvas CELLS (canvas = cols 4-11, rows 1-10 => 8x10 cells).
const LAYERS = [
  { id: "r1", name: "Rect 1", kind: "rect", cx: 2, cy: 2, cw: 3, ch: 2, color: 12 },
  { id: "r2", name: "Rect 2", kind: "rect", cx: 4, cy: 4, cw: 2, ch: 3, color: 10 },
  { id: "e1", name: "Ellipse 1", kind: "ellipse", cx: 2, cy: 6, cw: 2, ch: 2, color: 14 },
];
const TOOLS = [["V", "move"], ["F", "frame"], ["R", "rect"], ["O", "ellipse"], ["T", "text"], ["H", "hand"]];

// ------------------------------------------------------------ variables
let coll, modeId;
const V = {};
const mkVar = (name, type, value) => {
  const x = figma.variables.createVariable(name, coll, type);
  x.setValueForMode(modeId, type === "COLOR" ? { ...hex(value), a: 1 } : value);
  V[name] = x;
};
function buildVariables() {
  for (const c of figma.variables.getLocalVariableCollections()) if (c.name === "Editor State") c.remove();
  coll = figma.variables.createVariableCollection("Editor State");
  modeId = coll.modes[0].modeId;
  for (const [k] of TOOLS) mkVar("tool/" + k, "BOOLEAN", k === "V");
  mkVar("sel/none", "BOOLEAN", false);
  for (const l of LAYERS) {
    mkVar("sel/" + l.id, "BOOLEAN", l.id === "r1");
    mkVar("show/" + l.id, "BOOLEAN", true);
    mkVar("color/" + l.id, "COLOR", PAL[l.color]);
  }
  for (const s of ["name", "x", "y", "w", "h"]) mkVar("sel/" + s, "STRING", "");
  setSelStrings(null, true);
}
const info = (l) => ({ name: l.name, x: (l.cx - 1) * 8, y: (l.cy - 1) * 8, w: l.cw * 8, h: l.ch * 8 }); // CPU pixels, relative to Frame 1
function setSelStrings(l, initial) {
  const l0 = l || (initial ? LAYERS[0] : null);
  const i = l0 ? info(l0) : { name: "", x: "", y: "", w: "", h: "" };
  for (const k of ["name", "x", "y", "w", "h"]) V["sel/" + k].setValueForMode(modeId, String(i[k]));
}

// action builders
const setA = (name, value) => {
  const t = V[name].resolvedType;
  return {
    type: "SET_VARIABLE", variableId: V[name].id,
    variableValue: { type: t, resolvedType: t, value: t === "COLOR" ? { ...hex(value), a: 1 } : value },
  };
};
const isTrue = (name) => ({
  type: "EXPRESSION", resolvedType: "BOOLEAN",
  value: {
    expressionFunction: "EQUALS",
    expressionArguments: [
      { type: "VARIABLE_ALIAS", resolvedType: "BOOLEAN", value: { type: "VARIABLE_ALIAS", id: V[name].id } },
      { type: "BOOLEAN", resolvedType: "BOOLEAN", value: true },
    ],
  },
});
const chain = (branches) => ({
  type: "CONDITIONAL",
  conditionalBlocks: branches.map(([name, actions]) => ({ condition: isTrue(name), actions })),
});
const pending = [];
const on = (node, actions) => pending.push(node.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions }]));

const selectActions = (l) => {
  const i = info(l);
  return [
    setA("sel/none", false),
    ...LAYERS.map((o) => setA("sel/" + o.id, o.id === l.id)),
    ...["name", "x", "y", "w", "h"].map((k) => setA("sel/" + k, String(i[k]))),
  ];
};
const deselectActions = () => [
  setA("sel/none", true),
  ...LAYERS.map((o) => setA("sel/" + o.id, false)),
  ...["name", "x", "y", "w", "h"].map((k) => setA("sel/" + k, "")),
];
const toolActions = (key) => TOOLS.map(([k]) => setA("tool/" + k, k === key));

// ------------------------------------------------------------ drawing primitives
const vis = (n, name) => n.setBoundVariable("visible", V[name]);
const bindFill = (n, name) => {
  n.fills = [figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0, g: 0, b: 0 } }, "color", V[name])];
};
function frame(parent, name, x, y, w, h, fill, opts = {}) {
  const f = figma.createFrame();
  f.name = name;
  parent.appendChild(f);
  f.x = x; f.y = y;
  f.resize(w, h);
  f.fills = fill ? paint(fill) : [];
  f.clipsContent = !!opts.clip;
  if (opts.radius != null) f.cornerRadius = opts.radius;
  if (opts.stroke) { f.strokes = paint(opts.stroke); f.strokeWeight = opts.sw || 2; f.strokeAlign = "INSIDE"; }
  return f;
}
function rect(parent, name, x, y, w, h, fill, radius) {
  const r = figma.createRectangle();
  r.name = name;
  parent.appendChild(r);
  r.x = x; r.y = y;
  r.resize(w, h);
  r.fills = fill ? paint(fill) : [];
  if (radius) r.cornerRadius = radius;
  return r;
}
function ellipse(parent, name, x, y, w, h, fill) {
  const e = figma.createEllipse();
  e.name = name;
  parent.appendChild(e);
  e.x = x; e.y = y;
  e.resize(w, h);
  e.fills = fill ? paint(fill) : [];
  return e;
}
// text centred vertically in a box of height h (default one tile)
function text(parent, s, x, y, size, color, style = "Regular", name, h = T) {
  const t = figma.createText();
  parent.appendChild(t);
  t.fontName = { family: FONT, style };
  t.fontSize = size;
  t.characters = s || " ";
  t.fills = paint(color);
  t.name = name || s;
  t.textAutoResize = "WIDTH_AND_HEIGHT";
  t.x = x;
  t.y = y + (h - t.height) / 2;
  return t;
}
const centerX = (t, x, w) => { t.x = x + (w - t.width) / 2; return t; };
// icons are drawn on a 16x16 grid then scaled
function icon(parent, kind, x, y, color, scale) {
  const g = frame(parent, "icon/" + kind, x, y, 16, 16, null);
  const outline = (n, w = 1.5) => { n.fills = []; n.strokes = paint(color); n.strokeWeight = w; return n; };
  const vec = (data, stroke) => {
    const v = figma.createVector();
    g.appendChild(v);
    v.vectorPaths = [{ windingRule: "NONZERO", data }];
    if (stroke) { v.fills = []; v.strokes = paint(color); v.strokeWeight = 1.5; v.strokeCap = "ROUND"; v.strokeJoin = "ROUND"; }
    else v.fills = paint(color);
    return v;
  };
  switch (kind) {
    case "move": vec("M 3 2 L 3 13 L 6 10 L 8 14 L 10 13 L 8 9 L 12 9 Z"); break;
    case "frame":
      for (const [px, py, w, h] of [[1, 4, 14, 1.5], [1, 10.5, 14, 1.5], [4, 1, 1.5, 14], [10.5, 1, 1.5, 14]]) rect(g, "bar", px, py, w, h, color);
      break;
    case "rect": outline(rect(g, "rect", 2, 3, 12, 10, color, 1)); break;
    case "ellipse": outline(ellipse(g, "ellipse", 2, 2, 12, 12, color)); break;
    case "text": rect(g, "bar", 2, 2, 12, 2, color); rect(g, "stem", 7, 2, 2, 12, color); break;
    case "hand":
      rect(g, "palm", 3, 7, 10, 7, color, 3);
      for (let i = 0; i < 4; i++) rect(g, "finger", 3 + i * 2.7, 2 + (i % 2), 1.8, 8, color, 1);
      break;
    case "chev-down": vec("M 4 6 L 8 10 L 12 6", true); break;
    case "chev-right": vec("M 6 4 L 10 8 L 6 12", true); break;
    case "plus": vec("M 8 3 L 8 13 M 3 8 L 13 8", true); break;
    case "search": outline(ellipse(g, "lens", 2, 2, 9, 9, color)); vec("M 10 10 L 14 14", true); break;
    case "sidebar": outline(rect(g, "box", 2, 3, 12, 10, color, 2)); rect(g, "bar", 6, 3, 1.5, 10, color); break;
    case "play": vec("M 4 2.5 L 13 8 L 4 13.5 Z"); break;
    case "file": outline(rect(g, "page", 3, 1.5, 10, 13, color, 2)); break;
    case "star": vec("M 8 1 L 9.6 6.4 L 15 8 L 9.6 9.6 L 8 15 L 6.4 9.6 L 1 8 L 6.4 6.4 Z", true); break;
    case "assets": outline(ellipse(g, "ring", 2, 2, 12, 12, color)); vec("M 8 5 L 8 11 M 5 8 L 11 8", true); break;
    case "tools": outline(rect(g, "case", 2, 5, 12, 8, color, 2)); vec("M 6 5 L 6 3 L 10 3 L 10 5", true); break;
    case "variables": outline(ellipse(g, "ring", 2, 2, 12, 12, color)); ellipse(g, "dot", 6, 6, 4, 4, color); break;
  }
  g.rescale(scale);
  return g;
}
const tx = (col) => col * T;

// ------------------------------------------------------------ sections
// Column 0: icon rail (Figma menu, File, Agents, Assets, Tools, Variables)
function rail(root, logo) {
  const p = frame(root, "Icon rail (col 0)", 0, 0, T, H, UI.bar);
  rect(p, "divider", T - 2, 0, 2, H, UI.line);
  const lg = rect(p, "Figma logo", 16, 16, 48, 48, null);
  lg.fills = [{ type: "IMAGE", imageHash: logo.hash, scaleMode: "FIT" }];
  rect(p, "divider", 20, T, T - 40, 2, UI.line);
  const items = [["File", "file", 1, true], ["Agents", "star", 2], ["Assets", "assets", 3], ["Tools", "tools", 4], ["Variables", "variables", 5.6]];
  for (const [label, kind, row, active] of items) {
    const y = row * T;
    if (active) rect(p, "active", 14, y + 4, 52, 44, UI.blueSel, 10);
    icon(p, kind, 24, y + 12, active ? UI.blue : UI.dim, 2);
    centerX(text(p, label, 0, y + 48, 17, active ? UI.text : UI.dim, "Medium", "label", 22), 0, T - 2);
  }
}

// Cols 1-3: file name, Pages, Layers
function leftPanel(root) {
  const p = frame(root, "Left panel (cols 1-3)", T, 0, 3 * T, H, UI.panel);
  const pw = 3 * T;
  rect(p, "divider", pw - 2, 0, 2, H, UI.line);
  text(p, "Figma-OS", 20, 6, 26, UI.text, "Medium", "File name", 44);
  icon(p, "chev-down", 20 + 136, 22, UI.dim, 1.5);
  text(p, "Drafts", 20, 40, 20, UI.faint, "Regular", "Location", 34);
  icon(p, "sidebar", pw - 52, 28, UI.dim, 1.5);
  rect(p, "divider", 0, T - 2, pw, 2, UI.line);

  text(p, "Pages", 20, T, 24, UI.text, "Medium", "Section / Pages");
  icon(p, "search", pw - 92, T + 28, UI.dim, 1.5);
  icon(p, "plus", pw - 52, T + 28, UI.dim, 1.5);
  rect(p, "Page selected", 10, 2 * T + 8, pw - 22, T - 16, UI.field, 8);
  text(p, "FigmaOS", 20, 2 * T, 24, UI.text, "Regular", "Page / FigmaOS");
  rect(p, "divider", 0, 3 * T - 2, pw, 2, UI.line);

  text(p, "Layers", 20, 3 * T, 24, UI.text, "Medium", "Section / Layers");
  // Frame 1 (static parent row)
  const fr = frame(p, "Layer / Frame 1", 0, 4 * T, pw - 2, T, null);
  icon(fr, "chev-down", 14, 26, UI.faint, 1.75);
  icon(fr, "frame", 48, 24, UI.dim, 2);
  text(fr, "Frame 1", 90, 0, 24, UI.text, "Regular", "name");

  LAYERS.forEach((l, i) => {
    const row = frame(p, "Layer row / " + l.name, 0, (5 + i) * T, pw - 2, T, null);
    const hl = rect(row, "selected", 10, 6, pw - 24, T - 12, UI.blueSel, 8);
    vis(hl, "sel/" + l.id);
    icon(row, l.kind, 72, 24, UI.dim, 2);
    text(row, l.name, 114, 0, 24, UI.text, "Regular", "name");
    vis(row, "show/" + l.id);
    on(row, selectActions(l));
  });
}

// Cols 4-11: rulers + canvas + floating toolbar
function canvas(root) {
  const cw = 8 * T;
  const cv = frame(root, "Canvas (cols 4-11)", tx(4), 0, cw, H, UI.canvas, { clip: true });
  const grid = frame(cv, "Tile grid", 0, 0, cw, H, null);
  for (let c = 1; c < 8; c++) rect(grid, "v", c * T - 1, 0, 2, H, "#FFFFFF10");
  for (let r = 1; r < 12; r++) rect(grid, "h", 0, r * T - 1, cw, 2, "#FFFFFF10");

  const art = frame(cv, "Frame 1", T, T, 6 * T, 9 * T, "#FFFFFF");
  text(cv, "Frame 1", T, T - 44, 20, UI.faint, "Regular", "Frame label", 36);
  on(art, deselectActions()); // clicking empty frame space deselects

  for (const l of LAYERS) {
    const x = l.cx * T, y = l.cy * T, w = l.cw * T, h = l.ch * T;
    const s = l.kind === "ellipse" ? ellipse(cv, l.name, x, y, w, h, null) : rect(cv, l.name, x, y, w, h, null, 0);
    bindFill(s, "color/" + l.id);
    vis(s, "show/" + l.id);
    on(s, selectActions(l));
  }
  for (const l of LAYERS) {
    const x = l.cx * T, y = l.cy * T, w = l.cw * T, h = l.ch * T;
    const sel = frame(cv, "Selection / " + l.name, x, y, w, h, null);
    sel.strokes = paint(UI.blue); sel.strokeWeight = 4; sel.strokeAlign = "OUTSIDE";
    for (const [hx, hy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const hd = rect(sel, "Handle", hx - 10, hy - 10, 20, 20, "#FFFFFF", 4);
      hd.strokes = paint(UI.blue); hd.strokeWeight = 3;
    }
    sel.locked = true; // clicks fall through to the shape
    vis(sel, "sel/" + l.id);
  }

  // rulers in CPU pixels, 0 at Frame 1's origin (1 cell = 8 px)
  const R = 28;
  rect(cv, "Ruler top", 0, 0, cw, R, UI.bar);
  rect(cv, "Ruler left", 0, 0, R, H, UI.bar);
  rect(cv, "Ruler top edge", 0, R - 2, cw, 2, UI.line);
  rect(cv, "Ruler left edge", R - 2, 0, 2, H, UI.line);
  for (let c = 1; c < 8; c += 1) {
    rect(cv, "tick", c * T, R - 10, 2, 10, UI.faint);
    if (c % 2 === 1) text(cv, String((c - 1) * 8), c * T + 6, 0, 14, UI.faint, "Regular", "ruler", R - 8);
  }
  for (let r = 1; r < 12; r++) {
    rect(cv, "tick", R - 10, r * T, 10, 2, UI.faint);
    if (r % 2 === 1) {
      const t = text(cv, String((r - 1) * 8), 0, r * T + 4, 14, UI.faint, "Regular", "ruler", 20);
      t.rotation = 0; t.x = 2;
    }
  }

  // floating toolbar (row 11): 6 tools, active tool highlighted blue
  const tw = 6 * T + 24;
  const tb = frame(cv, "Toolbar", (cw - tw) / 2, 10 * T + 4, tw, T - 8, "#2C2C2C", { radius: 18, stroke: UI.line });
  TOOLS.forEach(([key, kind], i) => {
    const tool = frame(tb, `Tool / ${kind} (${key})`, 12 + i * T, 0, T, T - 8, null);
    const act = rect(tool, "active", 10, 6, T - 20, T - 20, UI.blue, 12);
    vis(act, "tool/" + key);
    icon(tool, kind, 20, 16, "#FFFFFF", 2.5);
    on(tool, toolActions(key));
  });

  // demo controls pill (bottom-left of canvas)
  const dc = frame(cv, "Demo controls", 40, 10 * T + 16, 176, T - 32, "#2C2C2C", { radius: 14, stroke: UI.line });
  const btn = (label, x, actions) => {
    const b = frame(dc, "Button / " + label, x, 0, 88, T - 32, null);
    centerX(text(b, label, 0, 0, 20, UI.text, "Medium", "label", T - 32), 0, 88);
    on(b, actions);
  };
  btn("Delete", 0, [chain(LAYERS.map((l) => ["sel/" + l.id, [setA("show/" + l.id, false), ...deselectActions()]]))]);
  btn("Reset", 88, [
    ...LAYERS.map((l) => setA("show/" + l.id, true)),
    ...LAYERS.map((l) => setA("color/" + l.id, PAL[l.color])),
    ...selectActions(LAYERS[0]),
    ...toolActions("V"),
  ]);
}

// Cols 12-15: avatar / play / Share, Design tab, properties
function rightPanel(root) {
  const pw = 4 * T;
  const p = frame(root, "Properties (cols 12-15)", tx(12), 0, pw, H, UI.panel);
  rect(p, "divider", 0, 0, 2, H, UI.line);

  // row 0: avatar, play, Share
  ellipse(p, "Avatar", 20, 18, 44, 44, "#14AE5C");
  centerX(text(p, "N", 0, 18, 22, "#FFFFFF", "Medium", "initial", 44), 20, 44);
  icon(p, "chev-down", 72, 30, UI.dim, 1.25);
  icon(p, "play", 150, 24, UI.text, 2);
  icon(p, "chev-down", 186, 30, UI.dim, 1.25);
  const share = frame(p, "Share button", pw - 108, 18, 92, 44, UI.blue, { radius: 10 });
  centerX(text(share, "Share", 0, 0, 22, "#FFFFFF", "Medium", "label", 44), 0, 92);
  rect(p, "divider", 0, T - 2, pw, 2, UI.line);

  // row 1: Design | Prototype ... zoom
  rect(p, "Tab active", 14, T + 16, 112, 48, UI.field, 10);
  text(p, "Design", 30, T, 24, UI.text, "Medium", "Tab / Design");
  text(p, "Prototype", 140, T, 24, UI.faint, "Regular", "Tab / Prototype");
  text(p, "63%", pw - 116, T, 24, UI.text, "Regular", "Zoom");
  icon(p, "chev-down", pw - 44, T + 28, UI.dim, 1.5);
  rect(p, "divider", 0, 2 * T - 2, pw, 2, UI.line);

  // row 2: selection name
  const nm = text(p, "", 24, 2 * T, 26, UI.text, "Medium", "Selection name");
  nm.setBoundVariable("characters", V["sel/name"]);
  rect(p, "divider", 0, 3 * T - 2, pw, 2, UI.line);

  const field = (label, varName, col, row) => {
    const f = frame(p, "Field / " + label, col * 2 * T + 14, row * T + 14, 2 * T - 28, T - 28, UI.field, { radius: 8 });
    text(f, label, 14, 0, 20, UI.faint, "Regular", "label", T - 28);
    const v = text(f, "", 52, 0, 24, UI.text, "Regular", "value", T - 28);
    v.setBoundVariable("characters", V[varName]);
  };
  field("X", "sel/x", 0, 3); field("Y", "sel/y", 1, 3);
  field("W", "sel/w", 0, 4); field("H", "sel/h", 1, 4);
  rect(p, "divider", 0, 5 * T - 2, pw, 2, UI.line);

  // row 5: Fill + current swatch (one per layer, shown while that layer is selected)
  text(p, "Fill", 24, 5 * T, 24, UI.text, "Medium", "Section / Fill");
  for (const l of LAYERS) {
    const sw = rect(p, "Fill swatch / " + l.name, pw - 96, 5 * T + 16, 48, 48, null, 8);
    sw.strokes = paint(UI.line); sw.strokeWeight = 2;
    bindFill(sw, "color/" + l.id);
    vis(sw, "sel/" + l.id);
  }
  // rows 6-9: 16 PICO-8 swatches = 4x4 tiles. Click -> recolor the selected layer.
  PAL.forEach((c, i) => {
    const col = i % 4, row = 6 + Math.floor(i / 4);
    const s = rect(p, "Swatch " + i, col * T + 8, row * T + 6, T - 16, T - 16, c, 12);
    s.strokes = paint(UI.line); s.strokeWeight = 2;
    on(s, [chain(LAYERS.map((l) => ["sel/" + l.id, [setA("color/" + l.id, c)]]))]);
  });
  rect(p, "divider", 0, 10 * T - 2, pw, 2, UI.line);
  text(p, "Stroke", 24, 10 * T, 24, UI.text, "Medium", "Section / Stroke");
  icon(p, "plus", pw - 52, 10 * T + 28, UI.dim, 1.5);
  rect(p, "divider", 0, 11 * T - 2, pw, 2, UI.line);
  text(p, "Effects", 24, 11 * T, 24, UI.text, "Medium", "Section / Effects");
  icon(p, "plus", pw - 52, 11 * T + 28, UI.dim, 1.5);
}

// ------------------------------------------------------------ main
async function main() {
  await figma.loadAllPagesAsync();
  for (const s of ["Regular", "Medium"]) await figma.loadFontAsync({ family: FONT, style: s });
  const logo = figma.createImage(figma.base64Decode(LOGO_B64));

  let page = figma.root.children.find((p) => p.name === "FigmaOS");
  if (!page) { page = figma.createPage(); page.name = "FigmaOS"; }
  await figma.setCurrentPageAsync(page);
  for (const n of page.children.filter((n) => n.name === "FigmaOS Editor Mock")) n.remove();

  buildVariables();

  const root = frame(page, "FigmaOS Editor Mock", 0, 0, W, H, UI.canvas, { clip: true });
  const others = page.children.filter((n) => n !== root);
  root.x = others.length ? Math.max(...others.map((n) => n.x + n.width)) + 200 : 0;
  root.y = 0;

  canvas(root);
  rail(root, logo);
  leftPanel(root);
  rightPanel(root);

  await Promise.all(pending);
  page.flowStartingPoints = [{ nodeId: root.id, name: "Editor" }];
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  figma.closePlugin("Editor mock drawn and wired. Select it and press Present (Option+Cmd+Enter).");
}

main().catch((e) => figma.closePlugin("Editor mock failed: " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" ") : e)));
