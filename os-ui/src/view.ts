// Draws a State into the page. All markup is plain divs, text and inline SVG, so the result
// can later be imported into Figma as editable layers. Geometry comes from the model in cells;
// CELL_PX is only the on-screen size of one cell. The editor chrome (rail, toolbar, menus) is
// described as data in chrome.ts; this file only turns it into markup.
import {
  I,
  LeftTab,
  MODES,
  Mode,
  RAIL,
  SHORTCUTS,
  TOOLBAR,
  shownItem,
} from "./chrome";
import { layerCss, PX_PER_CELL } from "./code";
import {
  GRID_H,
  GRID_W,
  LABEL,
  Layer,
  MAX_LAYERS,
  PALETTE,
  State,
  TEXT_MAX,
  contentBounds,
  descendants,
  exportRegion,
  getSelected,
  paintCells,
  parentOf,
  presentFrames,
} from "./model";

/** On-screen size of one cell at zoom 1, in monitor pixels. */
export const BASE_CELL = 48;

/** On-screen size of one cell at the current zoom. */
export function cellPx(): number {
  return Math.max(6, Math.round(BASE_CELL * zoom));
}
/** View zoom (1 = BASE_CELL). Not part of the document. */
export let zoom = 1;
export const ZOOM_MIN = 6 / BASE_CELL;
export const ZOOM_MAX = 4;
export function setZoom(z: number): void {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}
/** Zoom as Figma states it: monitor pixels per screen pixel of the OS, and a cell is 8 of those. */
export const zoomPercent = () => Math.round((cellPx() / PX_PER_CELL) * 100);

// ---- View state (never part of the document): which panels and overlays are showing.
export let leftTab: LeftTab = "file";
export function setLeftTab(t: LeftTab): void {
  leftTab = t;
}
export let uiMin = false;
export function toggleUiMin(): void {
  uiMin = !uiMin;
}
/** Design edits the file, Dev Mode inspects it read-only, Draw is the pencil. */
export let mode: Mode = "design";
export function setMode(m: Mode): void {
  mode = m;
}
export const viewToggles = { rulers: true, grid: true };
/** The tool each toolbar group's button currently shows (group id -> item id). */
export const groupPick: Record<string, string> = {};

let CELL_PX = cellPx();

const ICON = I;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Layers in panel order: front to back, each container followed by the layers inside it. */
function layerRows(s: State): { l: Layer; depth: number }[] {
  const kids = new Map<number | null, Layer[]>();
  for (const l of [...s.layers].reverse()) {
    const p = parentOf(s, l)?.id ?? null;
    kids.set(p, [...(kids.get(p) ?? []), l]);
  }
  const out: { l: Layer; depth: number }[] = [];
  const walk = (p: number | null, depth: number) => {
    for (const l of kids.get(p) ?? []) {
      out.push({ l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// ---- Left panel: one body per nav-rail tab
function layersPanel(s: State): string {
  const rows = layerRows(s)
    .map(
      ({ l, depth }) => `
    <div class="row${l.id === s.selected ? " selected" : ""}${l.visible ? "" : " hidden"}" style="padding-left:${23 + depth * 16}px" data-layer="${l.id}" data-rename="layer" data-id="${l.id}">
      ${ICON[l.kind]}<span class="grow name">${esc(l.name)}</span>
      <span class="vis" data-visible="${l.id}" title="${l.visible ? "Hide" : "Show"}">${l.visible ? ICON.eye : ICON.eyeOff}</span>
    </div>`,
    )
    .join("");
  return `
    <div class="section-title layers"><span>Layers</span><span class="count">${s.layers.length}/${MAX_LAYERS}</span></div>
    ${rows || '<div class="empty">Nothing here yet. Press F and drag on the canvas to add a frame.</div>'}`;
}

/** Assets: every shape the OS can draw, as click-to-pick rows. */
const SHAPE_TOOLS = [
  "frame",
  "section",
  "slice",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
];
function assetsPanel(): string {
  const shapes = TOOLBAR.flatMap((g) => g.items).filter(
    (i) => i.tool && SHAPE_TOOLS.includes(i.tool),
  );
  return `
    <div class="section-title"><span>Assets</span></div>
    <div class="section-sub">Shapes</div>
    ${shapes.map((i) => `<div class="row asset" data-cmd="tool:${i.tool}">${i.icon}<span class="grow">${i.label}</span><span class="kbd">${i.key ?? ""}</span></div>`).join("")}`;
}

/** Tools: the keyboard reference. */
function toolsPanel(): string {
  return `
    <div class="section-title"><span>Tools</span></div>
    ${SHORTCUTS.map(([k, label]) => `<div class="row"><span class="grow">${label}</span><span class="kbd">${k}</span></div>`).join("")}`;
}

function leftPanel(s: State): string {
  if (leftTab === "assets") return assetsPanel();
  if (leftTab === "tools") return toolsPanel();
  return layersPanel(s);
}

function railHtml(): string {
  const items = RAIL.map(
    (r) =>
      `<div class="rail-item${leftTab === r.id ? " on" : ""}" data-rail="${r.id}" title="${r.label}"><span class="rail-ico">${r.icon}</span><span class="rail-label">${r.label}</span></div>`,
  ).join("");
  return `<div class="rail-main" data-menu="main" title="Main menu"><img src="logo.png" alt="Figma"></div>${items}`;
}

function field(label: string, prop: string, value: number): string {
  return `<label class="field"><i>${label}</i><input data-prop="${prop}" value="${value}" inputmode="numeric"></label>`;
}

export let rightTab: "design" | "prototype" = "design";
export function setRightTab(t: "design" | "prototype"): void {
  rightTab = t;
}

/** Help cards the user has closed (view state, not part of the document). */
const closedHelp = new Set<string>();
export function closeHelp(id: string): void {
  closedHelp.add(id);
}

const HELP = [
  {
    id: "connect",
    title: "Creating a connection",
    icon: I.workflow,
    body: "Select a frame or object in a frame and use the circular node to drag a connection to another frame.",
  },
  {
    id: "run",
    title: "Running your prototype",
    icon: I.play,
    body: "Use the play button in the toolbar to play your prototype. Each frame is a slide: use the arrow keys to move between them.",
  },
];

function prototypePanel(s: State): string {
  const help = HELP.filter((h) => !closedHelp.has(h.id))
    .map(
      (h) => `
    <div class="props-block help">
      <h4>${h.title}<span class="close" data-close-help="${h.id}" title="Close">${I.clear}</span></h4>
      <div class="help-body"><span class="help-icon">${h.icon}</span><p>${h.body}</p></div>
    </div>`,
    )
    .join("");
  const flows = presentFrames(s)
    .map((f) => `<div class="flow">${esc(f.name)}</div>`)
    .join("");
  return `
    <div class="props-block"><h4>Prototype settings</h4>
      <div class="select">No device<span class="chev">${I.chevDown}</span></div>
      <div class="fill-row bg-row"><div class="swatch" style="background:#000000"></div><span class="hex-static">000000</span></div>
    </div>
    <div class="props-block"><h4>Flows</h4>${flows || '<div class="flow">Add a frame to start a flow.</div>'}</div>
    ${help}`;
}

// ---- Drawing a layer. One OS pixel is 1/8 of a cell: that is the width of strokes and lines.
const hair = () => Math.max(1, CELL_PX / 8);

const STAR = [
  [50, 0],
  [61, 35],
  [98, 35],
  [68, 57],
  [79, 91],
  [50, 70],
  [21, 91],
  [32, 57],
  [2, 35],
  [39, 35],
];
const TRIANGLE = [
  [50, 0],
  [100, 100],
  [0, 100],
];
const scaled = (pts: number[][], w: number, h: number) =>
  pts.map(([x, y]) => `${(x * w) / 100},${(y * h) / 100}`).join(" ");

/** The arrow's shaft and head in a w x h box, from the corner the layer runs out of to the one it points at. */
function arrowPoints(l: Layer, w: number, h: number) {
  const pad = hair() / 2;
  const [x1, y1, x2, y2] = l.flip
    ? [pad, h - pad, w - pad, pad]
    : [pad, pad, w - pad, h - pad];
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.min(CELL_PX * 0.9, Math.hypot(x2 - x1, y2 - y1) * 0.45);
  const wing = (turn: number) =>
    `${x2 - size * Math.cos(angle + turn)},${y2 - size * Math.sin(angle + turn)}`;
  return { x1, y1, x2, y2, head: `${wing(0.5)} ${x2},${y2} ${wing(-0.5)}` };
}

/** The inside of a layer's box, drawn at w x h (swapped for quarter turns, so it can be rotated afterwards). */
function glyph(l: Layer, w: number, h: number): string {
  const edge = l.stroke
    ? `box-shadow:inset 0 0 0 ${hair()}px ${l.stroke};`
    : "";
  const round = l.radius ? `border-radius:${(l.radius * CELL_PX) / 4}px;` : "";
  switch (l.kind) {
    case "frame":
    case "rect":
      return `<div class="shape" style="background:${l.fill};${round}${edge}"></div>`;
    case "section":
      return `<div class="shape" style="background:${l.fill}40;${round}${edge}"></div>`;
    case "slice":
      return `<div class="shape"></div>`;
    case "ellipse":
      return `<div class="shape" style="background:${l.fill};border-radius:50%;${edge}"></div>`;
    case "polygon":
    case "star": {
      const pts = scaled(l.kind === "star" ? STAR : TRIANGLE, w, h);
      return `<svg viewBox="0 0 ${w} ${h}"><polygon points="${pts}" fill="${l.fill}" stroke="${l.stroke || "none"}" stroke-width="${hair()}" stroke-linejoin="round"/></svg>`;
    }
    case "line":
    case "arrow": {
      const a = arrowPoints(l, w, h);
      const color = l.stroke || l.fill;
      const head =
        l.kind === "arrow"
          ? `<polyline points="${a.head}" fill="none" stroke="${color}" stroke-width="${hair()}" stroke-linecap="round" stroke-linejoin="round"/>`
          : "";
      return `<svg viewBox="0 0 ${w} ${h}"><line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${color}" stroke-width="${hair()}" stroke-linecap="round"/>${head}</svg>`;
    }
    case "text":
      // One character per cell, so a line of text always lines up with the grid.
      return `<div class="text" style="color:${l.fill};font-size:${CELL_PX * 0.8}px;line-height:${CELL_PX}px">${[...l.text].map((c) => `<span style="width:${CELL_PX}px">${esc(c)}</span>`).join("")}</div>`;
    case "comment":
      return `<div class="pin" title="${esc(l.text)}">${I.comment}</div>`;
  }
}

/** A layer as markup. `editor` adds the things only the editor shows (slice outlines, comment pins). */
function layerEl(l: Layer, editor = true): string {
  if (!editor && (l.kind === "slice" || l.kind === "comment")) return "";
  const W = l.w * CELL_PX;
  const H = l.h * CELL_PX;
  // A quarter turn swaps the box; the shape inside is drawn in the unturned size and rotated back.
  const turned = l.rotation === 90 || l.rotation === 270;
  const iw = turned ? H : W;
  const ih = turned ? W : H;
  const outer = [
    `left:${l.x * CELL_PX}px`,
    `top:${l.y * CELL_PX}px`,
    `width:${W}px`,
    `height:${H}px`,
  ];
  if (l.opacity < 10) outer.push(`opacity:${l.opacity / 10}`);
  if (l.shadow)
    outer.push(`filter:drop-shadow(${CELL_PX / 4}px ${CELL_PX / 4}px 0 #0009)`);
  const turn = l.rotation ? `transform:rotate(${l.rotation}deg);` : "";
  return `<div class="layer ${l.kind}" data-lid="${l.id}" style="${outer.join(";")}"><div class="rot" style="width:${iw}px;height:${ih}px;left:${(W - iw) / 2}px;top:${(H - ih) / 2}px;${turn}">${glyph(l, iw, ih)}</div></div>`;
}

/** Painted cells inside `region` (the whole canvas by default), one div each, drawn over the layers. */
function paintHtml(s: State, region?: Layer): string {
  const ox = region?.x ?? 0;
  const oy = region?.y ?? 0;
  let out = "";
  for (const { x, y, color } of paintCells(s.paint)) {
    if (
      region &&
      (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h)
    )
      continue;
    out += `<div class="cell" style="left:${(x - ox) * CELL_PX}px;top:${(y - oy) * CELL_PX}px;width:${CELL_PX}px;height:${CELL_PX}px;background:${PALETTE[color]}"></div>`;
  }
  return out;
}

/** Frame and section names above their top-left corner, as in Figma; double-click one to rename it. */
function frameLabels(s: State): string {
  return s.layers
    .filter((l) => (l.kind === "frame" || l.kind === "section") && l.visible)
    .map(
      (l) =>
        `<div class="frame-name${l.id === s.selected ? " sel" : ""}" data-layer="${l.id}" data-rename="layer" data-id="${l.id}" style="left:${l.x * CELL_PX}px;top:${l.y * CELL_PX - 20}px;max-width:${l.w * CELL_PX}px"><span class="name">${esc(l.name)}</span></div>`,
    )
    .join("");
}

function selection(s: State): string {
  const l = getSelected(s);
  if (!l || !l.visible) return "";
  const handles =
    mode === "dev"
      ? ""
      : (["nw", "ne", "sw", "se"] as const)
          .map((c) => `<div class="handle ${c}" data-handle="${c}"></div>`)
          .join("");
  return `<div class="sel" style="left:${l.x * CELL_PX}px;top:${l.y * CELL_PX}px;width:${l.w * CELL_PX}px;height:${l.h * CELL_PX}px">
    ${handles}<div class="size-tag">${l.w} × ${l.h}</div></div>`;
}

/** The field that types into a text layer or a comment. */
function editorHtml(s: State): string {
  const l = s.layers.find((q) => q.id === s.editing);
  if (!l) return "";
  const text = l.kind === "text";
  return `<input class="text-edit" data-edit="${l.id}" data-orig="${esc(l.text)}" maxlength="${text ? TEXT_MAX : 40}" value="${esc(l.text)}" placeholder="${text ? "Type…" : "Add a comment"}" spellcheck="false" style="left:${l.x * CELL_PX}px;top:${l.y * CELL_PX}px;width:${Math.max(l.w, 7) * CELL_PX}px;height:${CELL_PX}px;font-size:${CELL_PX * 0.55}px">`;
}

function penMarker(s: State): string {
  const p = s.penFrom;
  return p
    ? `<div class="pen-dot" style="left:${(p.x + 0.5) * CELL_PX}px;top:${(p.y + 0.5) * CELL_PX}px"></div>`
    : "";
}

/**
 * One frame, read-only and scaled to fit the window, for Present: each top-level frame is a slide.
 * `index` picks the slide; arrows or the buttons in the bar step through them.
 */
export function presentHtml(
  s: State,
  viewOnly = false,
  index = 0,
  pad = 48,
): string {
  const frames = presentFrames(s);
  const tail = viewOnly
    ? `<span class="pb edit" data-cmd="edit-copy">Edit a copy</span>`
    : `<span class="dim">Esc to exit</span>`;
  if (!frames.length)
    return `<div class="present-empty">No frames yet.<br>Press F and drag on the canvas to add one.</div>
      <div class="present-bar"><span>${esc(s.title)}</span>${tail}</div>`;
  const i = Math.min(Math.max(index, 0), frames.length - 1);
  const f = frames[i];
  const saved = CELL_PX;
  CELL_PX = Math.max(
    4,
    Math.floor(
      Math.min(
        (window.innerWidth - pad * 2) / f.w,
        (window.innerHeight - pad * 2 - 24) / f.h,
      ),
    ),
  );
  const inside = descendants(s, f)
    .filter((l) => l.visible)
    .map((l) => layerEl({ ...l, x: l.x - f.x, y: l.y - f.y }, false))
    .join("");
  const round = f.radius ? `border-radius:${(f.radius * CELL_PX) / 4}px;` : "";
  const html = `<div class="present-art" style="width:${f.w * CELL_PX}px;height:${f.h * CELL_PX}px;background:${f.fill};${round}overflow:hidden">${inside}${paintHtml(s, f)}</div>
    <div class="present-bar">
      ${frames.length > 1 ? `<span class="pb" data-present="prev" title="Previous frame">${I.chevLeft}</span>` : ""}
      <span>${esc(f.name)} · ${i + 1} / ${frames.length}</span>
      ${frames.length > 1 ? `<span class="pb" data-present="next" title="Next frame">${I.chevRight}</span>` : ""}
      ${tail}
    </div>`;
  CELL_PX = saved;
  return html;
}

/** Page background and export settings: view state, not part of the document. */
export const pageUi = {
  color: "1E1E1E",
  opacity: 100,
  scale: 1,
  fmt: "png" as "png" | "jpg",
  preview: false,
  showInExports: false,
  /** Shows the file-name suffix field under the export settings. */
  advanced: false,
  suffix: "",
};

/** Traces a layer's outline in a w x h box whose corner is the canvas origin. */
function outline(
  g: CanvasRenderingContext2D,
  l: Layer,
  w: number,
  h: number,
  px: number,
): void {
  g.beginPath();
  if (l.kind === "ellipse")
    g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (l.kind === "polygon" || l.kind === "star") {
    const pts = l.kind === "star" ? STAR : TRIANGLE;
    pts.forEach(([x, y], i) =>
      i
        ? g.lineTo((x * w) / 100, (y * h) / 100)
        : g.moveTo((x * w) / 100, (y * h) / 100),
    );
    g.closePath();
  } else g.roundRect(0, 0, w, h, (l.radius * px) / 4);
}

/** Draws one layer onto the export canvas (cell size `px`, canvas origin at cell ox, oy). */
function drawLayer(
  g: CanvasRenderingContext2D,
  l: Layer,
  px: number,
  ox: number,
  oy: number,
): void {
  const W = l.w * px;
  const H = l.h * px;
  const turned = l.rotation === 90 || l.rotation === 270;
  const w = turned ? H : W;
  const h = turned ? W : H;
  const line = Math.max(1, px / 8);
  g.save();
  g.globalAlpha = l.opacity / 10;
  if (l.shadow) {
    g.shadowColor = "#0009";
    g.shadowOffsetX = px / 4;
    g.shadowOffsetY = px / 4;
  }
  g.translate((l.x - ox) * px + W / 2, (l.y - oy) * px + H / 2);
  g.rotate((l.rotation * Math.PI) / 180);
  g.translate(-w / 2, -h / 2);
  g.lineWidth = line;
  g.lineCap = "round";
  g.lineJoin = "round";
  if (l.kind === "line" || l.kind === "arrow") {
    g.strokeStyle = l.stroke || l.fill;
    const [x1, y1, x2, y2] = l.flip
      ? [line / 2, h - line / 2, w - line / 2, line / 2]
      : [line / 2, line / 2, w - line / 2, h - line / 2];
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    if (l.kind === "arrow") {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const size = Math.min(px * 0.9, Math.hypot(x2 - x1, y2 - y1) * 0.45);
      g.moveTo(x2 - size * Math.cos(a + 0.5), y2 - size * Math.sin(a + 0.5));
      g.lineTo(x2, y2);
      g.lineTo(x2 - size * Math.cos(a - 0.5), y2 - size * Math.sin(a - 0.5));
    }
    g.stroke();
  } else if (l.kind === "text") {
    g.fillStyle = l.fill;
    g.font = `700 ${px * 0.8}px monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    [...l.text].forEach((c, i) => g.fillText(c, (i + 0.5) * px, h / 2));
  } else {
    outline(g, l, w, h, px);
    if (l.kind === "section") g.globalAlpha *= 0.25;
    g.fillStyle = l.fill;
    g.fill();
    if (l.stroke) {
      g.globalAlpha = l.opacity / 10;
      g.shadowColor = "transparent";
      g.strokeStyle = l.stroke;
      g.stroke();
    }
  }
  g.restore();
}

/** Draws the canvas, or just `region` (a frame, section or slice), at 8 px per cell x scale: the real screen. */
export function exportCanvas(
  s: State,
  scale: number,
  region?: Layer,
): HTMLCanvasElement {
  const px = 8 * scale;
  // With nothing selected the whole canvas is exported: a box around everything on it.
  const r = region ?? contentBounds(s) ?? { x: 0, y: 0, w: GRID_W, h: GRID_H };
  const c = document.createElement("canvas");
  c.width = r.w * px;
  c.height = r.h * px;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  if (region?.kind === "frame") g.fillStyle = region.fill;
  else if (pageUi.showInExports) {
    g.globalAlpha = pageUi.opacity / 100;
    g.fillStyle = `#${pageUi.color}`;
  } else g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.globalAlpha = 1;
  for (const l of s.layers) {
    if (
      !l.visible ||
      l === region ||
      l.kind === "slice" ||
      l.kind === "comment"
    )
      continue;
    drawLayer(g, l, px, r.x, r.y);
  }
  for (const { x, y, color } of paintCells(s.paint)) {
    if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
    g.fillStyle = PALETTE[color];
    g.fillRect((x - r.x) * px, (y - r.y) * px, px, px);
  }
  return c;
}

const opt = (v: string, cur: string) =>
  `<option value="${v}"${v === cur ? " selected" : ""}>${v === "png" ? "PNG" : v === "jpg" ? "JPG" : v + "x"}</option>`;

/** One Design-panel section: a 40px header (title + optional action) over its body. */
function section(title: string, body = "", action = ""): string {
  return `<div class="props-block"><h4 class="split"><span>${title}</span>${action}</h4>${body}</div>`;
}

function exportBlock(s: State): string {
  const p = pageUi;
  const region = exportRegion(s);
  const preview = p.preview
    ? `<img class="preview-img" alt="Export preview" src="${exportCanvas(s, 1, region).toDataURL()}">`
    : "";
  return section(
    "Export",
    `<div class="export-row">
        <select class="field-box" data-export-scale>${["1", "2", "3", "4"].map((x) => opt(x, String(p.scale))).join("")}</select>
        <select class="field-box" data-export-fmt>${["png", "jpg"].map((x) => opt(x, p.fmt)).join("")}</select>
        <span class="ibtn${p.advanced ? " on" : ""}" data-export-advanced title="Advanced export settings">${I.sliders}</span>
        <span class="ibtn" data-export-reset title="Reset export settings">${I.minus}</span>
      </div>
      ${p.advanced ? `<div class="export-row"><div class="field-box grow"><input data-export-suffix value="${esc(p.suffix)}" placeholder="File name suffix" spellcheck="false"></div></div>` : ""}
      <button class="export-btn" data-export>Export ${esc(region?.name ?? s.title)}</button>
      <div class="preview" data-preview><span class="pv">${p.preview ? I.chevDown : I.chevRight}</span>Preview</div>${preview}`,
  );
}

/** The 16 palette colors as swatches; `attr` says what a click does, `current` is the one in use. */
const swatches = (attr: string, current: string) =>
  `<div class="palette">${PALETTE.map((c) => `<div class="sw${c === current ? " on" : ""}" ${attr}="${c}" style="background:${c}"></div>`).join("")}</div>`;

/** Design tab with nothing selected: canvas color, the palette as styles, and export. */
function canvasBlock(s: State): string {
  const p = pageUi;
  return (
    section(
      "Canvas",
      `<div class="page-row">
        <div class="field-box joined"><span class="swatch" style="background:#${p.color}"></span><input class="hexin" data-page-color value="${p.color}" maxlength="6" spellcheck="false"><input class="pctin" data-page-opacity value="${p.opacity}" inputmode="numeric"><span class="dim">%</span></div>
      </div>
      <label class="check"><input type="checkbox" data-page-exports${p.showInExports ? " checked" : ""}>Show in exports</label>`,
    ) +
    section(
      "Styles",
      `${swatches("data-fill", s.fill)}<div class="hint-line">Click a color to use it for the next shape.</div>`,
    ) +
    exportBlock(s)
  );
}

const hasRadius = (l: Layer) =>
  ["frame", "rect", "section", "slice"].includes(l.kind);

function designBody(s: State, l: Layer): string {
  const al = (to: string, title: string, glyph: string) =>
    `<div class="alignbtn" data-align="${to}" title="${title}">${glyph}</div>`;
  const alignRow = `
    <div class="align-row">
      ${al("left", "Align left", I.alignLeft)}
      ${al("hcenter", "Align horizontal centers", I.alignHCenter)}
      ${al("right", "Align right", I.alignRight)}
      <span class="sep"></span>
      ${al("top", "Align top", I.alignTop)}
      ${al("vcenter", "Align vertical centers", I.alignVCenter)}
      ${al("bottom", "Align bottom", I.alignBottom)}
    </div>`;
  const noTurn = l.kind === "text" || l.kind === "comment";
  const rotation = `<label class="field${noTurn ? " dis" : ""}" title="Rotation, in quarter turns"><i>${I.rotate}</i><input data-prop="rotation" value="${l.rotation}°" inputmode="numeric"${noTurn ? " disabled" : ""}></label>`;
  const hide = `<span class="ibtn" data-visible="${l.id}" title="${l.visible ? "Hide" : "Show"}">${l.visible ? ICON.eye : ICON.eyeOff}</span>`;
  const isText = l.kind === "text";
  const words =
    isText || l.kind === "comment"
      ? section(
          isText ? "Text" : "Comment",
          `<label class="field wide"><input class="textin" data-text-of="${l.id}" maxlength="${isText ? TEXT_MAX : 40}" value="${esc(l.text)}" placeholder="${isText ? "Type…" : "Add a comment"}" spellcheck="false"></label>`,
        )
      : "";
  const hex = (c: string) => c.slice(1).toUpperCase();
  const stroke = section(
    "Stroke",
    l.stroke
      ? `<div class="fill-row"><div class="swatch" style="background:${l.stroke}"></div><input class="hex" data-stroke-hex value="${hex(l.stroke)}" maxlength="7" spellcheck="false"><span class="ibtn" data-stroke="remove" title="Remove stroke">${I.minus}</span></div>${swatches("data-stroke-color", l.stroke)}`
      : "",
    l.stroke
      ? ""
      : `<span class="ibtn" data-stroke="add" title="Add stroke">${I.plus}</span>`,
  );
  const effects = section(
    "Effects",
    l.shadow
      ? `<div class="effect-row"><span class="grow">Drop shadow</span><span class="ibtn" data-shadow="remove" title="Remove drop shadow">${I.minus}</span></div>`
      : "",
    l.shadow
      ? ""
      : `<span class="ibtn" data-shadow="add" title="Add drop shadow">${I.plus}</span>`,
  );
  const fill =
    l.kind === "comment" || l.kind === "slice"
      ? ""
      : section(
          "Fill",
          `<div class="fill-row"><div class="swatch" style="background:${l.fill}"></div>
            <input class="hex" data-hex value="${hex(l.fill)}" maxlength="7" spellcheck="false"></div>${swatches("data-fill", l.fill)}`,
        );
  return (
    section(
      "Position",
      alignRow +
        `<div class="grid2">${field("X", "x", l.x)}${field("Y", "y", l.y)}</div><div class="grid2">${rotation}</div>`,
    ) +
    section(
      "Layout",
      `<div class="grid2">${field("W", "w", l.w)}${field("H", "h", l.h)}</div>`,
    ) +
    section(
      "Appearance",
      `<div class="grid2">
        <label class="field"><i>Opacity</i><input data-prop="opacity" value="${l.opacity * 10}%" inputmode="numeric"></label>
        ${hasRadius(l) ? field("Radius", "radius", l.radius) : ""}
      </div>`,
      hide,
    ) +
    words +
    fill +
    stroke +
    effects +
    exportBlock(s)
  );
}

/** Dev Mode: the selected layer's measurements and CSS, read-only. */
function devBody(l: Layer | undefined): string {
  if (!l)
    return section(
      "Inspect",
      `<div class="flow">Select a layer to see its measurements and CSS.</div>`,
    );
  const kv = (k: string, v: string | number) =>
    `<div class="kv"><span>${k}</span><b>${esc(String(v))}</b></div>`;
  const px = (cells: number) => `${cells * PX_PER_CELL}px`;
  return (
    section("Layer", kv("Name", l.name) + kv("Type", LABEL[l.kind])) +
    section(
      "Measurements",
      kv("X", px(l.x)) +
        kv("Y", px(l.y)) +
        kv("Width", px(l.w)) +
        kv("Height", px(l.h)),
    ) +
    section(
      "Code",
      `<pre class="code">${esc(layerCss(l).join("\n"))}</pre>`,
      `<span class="ibtn" data-copy-code title="Copy CSS">${I.copy}</span>`,
    )
  );
}

function propertiesPanel(s: State): string {
  const l = getSelected(s);
  const zoomBtn = `<div class="zoom" data-menu="zoom" title="Zoom">${zoomPercent()}%${I.chevDown}</div>`;
  if (mode === "dev")
    return `<div class="ptabs"><span class="on">Inspect</span>${zoomBtn}</div>${devBody(l)}`;
  const body = l ? designBody(s, l) : canvasBlock(s);
  return `
    <div class="ptabs"><span class="${rightTab === "design" ? "on" : "off"}" data-tab="design">Design</span><span class="${rightTab === "prototype" ? "on" : "off"}" data-tab="prototype">Prototype</span>${zoomBtn}</div>
    ${rightTab === "prototype" ? prototypePanel(s) : body}`;
}

/** The toolbar pill, as in Figma: one button + caret per tool group, Actions (⌘K), then the mode switcher. */
function toolbar(s: State): string {
  const groups = TOOLBAR.map((g) => {
    const it = shownItem(g, groupPick);
    const active = !!it.tool && it.tool === s.tool;
    const btn = it.tool
      ? `<div class="tool${active ? " active" : ""}" data-tool="${it.tool}" title="${it.label}${it.key ? ` (${it.key})` : ""}">${it.icon}</div>`
      : `<div class="tool" title="${it.label}">${it.icon}</div>`;
    return `<div class="tgroup">${btn}<div class="tool-caret" data-menu="fly:${g.id}" title="${g.title}">${I.chevDown}</div></div>`;
  }).join("");
  const modes = MODES.map(
    (m) =>
      `<div class="mode${m.id === mode ? " on" : ""}${m.live ? "" : " disabled"}"${m.live ? ` data-set-mode="${m.id}"` : ""} title="${m.label}${m.live ? "" : ": not in Figma OS yet"}">${m.icon}</div>`,
  ).join("");
  return `${groups}<div class="tool" data-cmd="palette" title="Actions (⌘K)">${I.actions}</div><div class="tool-divider"></div><div class="modes">${modes}</div>`;
}

export const getCellPx = () => CELL_PX;

/** Design units per cell: one cell is an 8x8 tile of the 128x96 screen, so rulers read in screen pixels. */
export const UNITS_PER_CELL = 8;
/** Canvas pan, mirrored here so the rulers can follow it (the document never sees it). */
let panX = 0;
let panY = 0;

/** Smallest 1/2/5 x 10^n step whose ticks are at least `minPx` apart. */
function niceStep(unitPx: number, minPx = 50): number {
  const raw = minPx / unitPx;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((st) => st >= raw) ?? 10 * pow;
}

/** Ruler ticks and numbers across the whole strip, 0 at the artboard's corner, plus a band over the selection. */
function rulerHtml(s: State, axis: "x" | "y", length: number): string {
  const unitPx = CELL_PX / UNITS_PER_CELL;
  const origin = axis === "x" ? 100 + panX : 56 + panY; // artboard corner in this ruler's own coordinates
  const at = axis === "x" ? "left" : "top";
  const step = niceStep(unitPx);
  const lo = Math.ceil((0 - origin) / unitPx / step);
  const hi = Math.floor((length - origin) / unitPx / step);
  let out = "";
  for (let k = lo; k <= hi; k++) {
    out += `<span class="tick" style="${at}:${origin + k * step * unitPx}px"><i>${k * step}</i></span>`;
  }
  const l = getSelected(s);
  if (l && l.visible) {
    const [a, len] = axis === "x" ? [l.x, l.w] : [l.y, l.h];
    out += `<span class="band" style="${at}:${origin + a * CELL_PX}px;${axis === "x" ? "width" : "height"}:${len * CELL_PX}px"></span>`;
  }
  return out;
}

/** Redraws both rulers; call after a render or a pan. */
export function renderRulers(
  s: State,
  root: HTMLElement,
  pan?: { x: number; y: number },
): void {
  if (pan) ((panX = pan.x), (panY = pan.y));
  const canvas = root.querySelector<HTMLElement>(".canvas");
  if (!canvas) return;
  const rx = root.querySelector<HTMLElement>(".ruler-x");
  const ry = root.querySelector<HTMLElement>(".ruler-y");
  if (rx) rx.innerHTML = rulerHtml(s, "x", canvas.clientWidth);
  if (ry) ry.innerHTML = rulerHtml(s, "y", canvas.clientHeight - 20);
}

export function render(s: State, root: HTMLElement): void {
  CELL_PX = cellPx();
  const q = (sel: string) => root.querySelector(sel) as HTMLElement;
  q("#rail").innerHTML = railHtml();
  q("#left").innerHTML = leftPanel(s);
  q("#title").textContent = s.title;
  q("#right").innerHTML = propertiesPanel(s);
  q("#toolbar").innerHTML = toolbar(s);
  q("#layers").innerHTML =
    s.layers
      .filter((l) => l.visible)
      .map((l) => layerEl(l))
      .join("") +
    paintHtml(s) +
    frameLabels(s) +
    selection(s) +
    penMarker(s) +
    editorHtml(s);
  root.dataset.tool = s.tool;
  root.dataset.mode = mode;
  root.classList.toggle("min", uiMin);
  root.classList.toggle("no-rulers", !viewToggles.rulers);
  root.classList.toggle("no-grid", !viewToggles.grid);
  CELL_PX = cellPx();
  root.style.setProperty("--cell", `${CELL_PX}px`);
  // The artboard is only the canvas origin now: layers sit around it in every direction.
  root.classList.toggle("thin", CELL_PX < 12);
  const alpha = Math.round((pageUi.opacity / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  root.style.setProperty("--page-bg", `#${pageUi.color}${alpha}`);
  renderRulers(s, root);
  // A new text layer opens straight into its field.
  const typing = root.querySelector<HTMLInputElement>(".text-edit");
  if (typing && document.activeElement !== typing) {
    typing.focus();
    typing.select();
  }
}
