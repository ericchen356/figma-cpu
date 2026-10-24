// Captures os-ui as Figma layers, screen by screen: loads the page in headless Chrome at 1440x900,
// drives it into a state with real input (keys, clicks, drags, the ⌘K palette, menus…), and records
// every painted box, text line, SVG and image as layer JSON (extract.mjs, tofigma.mjs). All screens
// go into silicon/osui/data/screens.json, with each SVG and image stored once. The Figma build reads
// only that data, so every screen in Figma is os-ui's own, not a copy typed by hand.
//
//   node silicon/osui/capture/capture.mjs [screen ...]     (default: every screen)
//
// It builds os-ui first and serves it itself (no other server needed).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, open } from "./cdp.mjs";
import { extract, resolveFonts } from "./extract.mjs";
import { toFigma } from "./tofigma.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OSUI = resolve(HERE, "../../../os-ui");
const OUT = resolve(HERE, "../data");

// ---- input, as a user gives it --------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (c, type, x, y, extra = {}) => c.send("Input.dispatchMouseEvent", { type, x, y, ...extra });
const move = (c, x, y) => send(c, "mouseMoved", x, y, { button: "none", buttons: 0 });
async function click(c, x, y, clickCount = 1) {
  await move(c, x, y);
  await send(c, "mousePressed", x, y, { button: "left", buttons: 1, clickCount });
  await send(c, "mouseReleased", x, y, { button: "left", buttons: 0, clickCount });
  await sleep(80);
}
async function rclick(c, x, y) {
  await move(c, x, y);
  await send(c, "mousePressed", x, y, { button: "right", buttons: 2, clickCount: 1 });
  await send(c, "mouseReleased", x, y, { button: "right", buttons: 0, clickCount: 1 });
  await sleep(80);
}
async function drag(c, [x0, y0], [x1, y1], steps = 8) {
  await move(c, x0, y0);
  await send(c, "mousePressed", x0, y0, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++)
    await send(c, "mouseMoved", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { button: "left", buttons: 1 });
  await send(c, "mouseReleased", x1, y1, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(100);
}
const CODES = { "-": ["Minus", 189], "0": ["Digit0", 48], "\\": ["Backslash", 220], Enter: ["Enter", 13], Escape: ["Escape", 27] };
const SHIFT = 8;
const META = 4;
/** One key press. A letter types its character unless a modifier is held (as a shortcut does). */
async function key(c, k, modifiers = 0) {
  const [code, keyCode] = CODES[k] ?? [/^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : k, k.toUpperCase().charCodeAt(0)];
  const text = k === "Enter" ? "\r" : k.length === 1 && !(modifiers & META) ? (modifiers & SHIFT ? k.toUpperCase() : k) : undefined;
  const base = { key: k, code, windowsVirtualKeyCode: keyCode, modifiers };
  await c.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, text });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(80);
}
const type = async (c, text) => (await c.send("Input.insertText", { text }), sleep(80));
const center = (c, sel) =>
  c.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no element ${sel.replace(/'/g, "\\'")}'); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const tap = async (c, sel) => click(c, ...(await center(c, sel)));
/** The centre of world cell (cx, cy) on screen. */
async function cell(c, cx, cy) {
  const [x, y] = await c.evaluate(`(() => { const r = document.getElementById('artboard').getBoundingClientRect(); return [r.left, r.top]; })()`);
  const px = await c.evaluate(`parseFloat(getComputedStyle(document.getElementById('app')).getPropertyValue('--cell')) || 48`);
  return [x + cx * px + px / 2, y + cy * px + px / 2];
}
const box = async (c, a, b) => drag(c, await cell(c, ...a), await cell(c, ...b));
/** Picks a tool from a toolbar flyout. */
async function pick(c, group, cmd) {
  await tap(c, `[data-menu="fly:${group}"]`);
  await tap(c, `#menu [data-cmd="${cmd}"]`);
}
/** Types into a panel field and commits it, as Enter or blur would. */
const field = (c, prop, value) =>
  c.evaluate(`(() => { const i = document.querySelector('[data-prop="${prop}"]'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('change', { bubbles: true })); })()`).then(() => sleep(80));
/** Selects a layer by its row in the Layers panel (then waits out the double-click timer). */
async function row(c, id) {
  const [x, y] = await c.evaluate(`(() => { const r = document.querySelector('#left .row[data-layer="${id}"]').getBoundingClientRect(); return [r.left + 70, r.top + r.height / 2]; })()`);
  await click(c, x, y);
  await sleep(600);
}
/** A text layer: the Text tool and a click place it; a synthetic pointerdown keeps its field
 * focused (a real press in headless Chrome blurs it at once, and an empty text is dropped). */
async function placeText(c, cx, cy, text) {
  const [x, y] = await cell(c, cx, cy);
  await c.evaluate(`(() => { const t = document.elementFromPoint(${x}, ${y}); t.dispatchEvent(new PointerEvent('pointerdown', { clientX: ${x}, clientY: ${y}, bubbles: true, button: 0, pointerId: 1, isPrimary: true })); window.dispatchEvent(new PointerEvent('pointerup', { clientX: ${x}, clientY: ${y}, bubbles: true })); })()`);
  await sleep(60);
  if (text != null) {
    await type(c, text);
    await key(c, "Enter");
  }
}

// ---- documents --------------------------------------------------------------------------------
const L = (o) => ({ visible: true, opacity: 10, radius: 0, stroke: "", shadow: false, rotation: 0, flip: false, text: "", ...o });
const DEMO = {
  title: "Demo file",
  nextId: 9,
  layers: [
    L({ id: 1, kind: "frame", name: "Frame 1", x: 0, y: 0, w: 12, h: 7, fill: "#fff1e8", radius: 2 }),
    L({ id: 2, kind: "star", name: "Star 2", x: 1, y: 1, w: 3, h: 3, fill: "#29adff", stroke: "#000000", shadow: true, opacity: 5 }),
    L({ id: 3, kind: "text", name: "HELLO OS", x: 5, y: 1, w: 8, h: 1, fill: "#000000", text: "HELLO OS" }),
    L({ id: 4, kind: "comment", name: "Comment 4", x: 9, y: 4, w: 1, h: 1, fill: "#29adff", text: "Check this" }),
    L({ id: 5, kind: "rect", name: "Rectangle 5", x: 5, y: 3, w: 2, h: 3, fill: "#ff004d", rotation: 90 }),
    L({ id: 6, kind: "ellipse", name: "Ellipse 6", x: 14, y: 0, w: 3, h: 2, fill: "#00e436", visible: false }),
  ],
  paint: { "14,5": 8, "15,5": 9, "16,5": 10 },
};
const shareHash = (doc) =>
  Buffer.from(encodeURIComponent(JSON.stringify(doc)).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "binary").toString("base64");

// ---- screens ------------------------------------------------------------------------------------
const frameRect = async (c) => {
  await key(c, "f");
  await box(c, [1, 1], [9, 7]);
  await key(c, "r");
  await box(c, [3, 3], [6, 5]);
};
const allShapes = async (c) => {
  await pick(c, "region", "tool:section");
  await box(c, [-1, -1], [15, 9]);
  await key(c, "f");
  await box(c, [0, 0], [6, 4]);
  await pick(c, "region", "tool:slice");
  await box(c, [8, 0], [12, 3]);
  await key(c, "r");
  await box(c, [1, 1], [2, 2]);
  await key(c, "o");
  await box(c, [4, 1], [5, 2]);
  await key(c, "l");
  await box(c, [0, 6], [3, 8]);
  await key(c, "l", SHIFT);
  await box(c, [4, 8], [7, 6]);
  await pick(c, "shape", "tool:polygon");
  await box(c, [9, 5], [11, 7]);
};
const starText = async (c) => {
  await key(c, "f");
  await box(c, [0, 0], [10, 6]);
  await pick(c, "shape", "tool:star");
  await box(c, [1, 1], [3, 3]);
  await key(c, "t");
  await placeText(c, 4, 1, "HELLO OS");
};
const twoFrames = async (c) => {
  await frameRect(c);
  await key(c, "f");
  await box(c, [11, 1], [15, 4]);
};
const loadDemo = async (c) => {
  await tap(c, '[data-cmd="edit-copy"]');
  await sleep(200);
};

/** os-ui screens: id → [title, how to get there from a fresh page]. */
export const SCREENS = {
  default: ["Default", async () => {}],
  "tool-frame": ["Frame tool", async (c) => key(c, "f")],
  "frame-drawn": ["Frame drawn", async (c) => (await key(c, "f"), box(c, [1, 1], [9, 7]))],
  "frame-rect": ["Rectangle in a frame", frameRect],
  "frame-selected": ["Frame selected", async (c) => (await frameRect(c), row(c, 1))],
  ...Object.fromEntries(
    ["move", "region", "shape", "creation", "text", "comment"].map((g) => [`fly-${g}`, [`Toolbar · ${g} tools`, async (c) => tap(c, `[data-menu="fly:${g}"]`)]]),
  ),
  "menu-main": ["Main menu", async (c) => (await frameRect(c), tap(c, ".rail-main"))],
  ...Object.fromEntries(
    ["file", "edit", "view", "object", "text", "arrange", "vector", "help"].map((s) => [
      `menu-main-${s}`,
      [`Main menu › ${s[0].toUpperCase()}${s.slice(1)}`, async (c) => {
        await frameRect(c);
        await tap(c, ".rail-main");
        await move(c, ...(await center(c, `#menu [data-sub="${s}"]`)));
        await sleep(80);
      }],
    ]),
  ),
  "menu-file": ["File menu", async (c) => tap(c, '.file-line [data-menu="file"]')],
  "menu-zoom": ["Zoom menu", async (c) => tap(c, ".zoom")],
  "menu-user": ["Account menu", async (c) => tap(c, ".user-btn")],
  "menu-context": ["Context menu", async (c) => (await frameRect(c), rclick(c, ...(await cell(c, 4, 4))))],
  palette: ["Actions (⌘K)", async (c) => (await key(c, "k", META), sleep(150))],
  "palette-zoom": ["Actions · “zoom”", async (c) => (await key(c, "k", META), await sleep(150), type(c, "zoom"))],
  "palette-none": ["Actions · no match", async (c) => (await key(c, "k", META), await sleep(150), type(c, "qqq"))],
  "prototype-empty": ["Prototype tab", async (c) => tap(c, '[data-tab="prototype"]')],
  "prototype-frames": ["Prototype tab · flows", async (c) => (await twoFrames(c), tap(c, '[data-tab="prototype"]'))],
  "prototype-help-closed": ["Prototype tab · help closed", async (c) => {
    await tap(c, '[data-tab="prototype"]');
    await tap(c, '[data-close-help="connect"]');
  }],
  "present-empty": ["Present · no frames", async (c) => tap(c, ".btn-present")],
  present: ["Present", async (c) => (await twoFrames(c), tap(c, ".btn-present"))],
  "present-next": ["Present · next frame", async (c) => {
    await twoFrames(c);
    await tap(c, ".btn-present");
    await tap(c, '[data-present="next"]');
  }],
  "dev-none": ["Dev Mode", async (c) => tap(c, '[data-set-mode="dev"]')],
  "dev-selected": ["Dev Mode · layer selected", async (c) => {
    await frameRect(c);
    await tap(c, '[data-set-mode="dev"]');
    await click(c, ...(await cell(c, 4, 4)));
  }],
  draw: ["Draw mode", async (c) => (await frameRect(c), tap(c, '[data-set-mode="draw"]'))],
  "draw-painted": ["Draw mode · painted", async (c) => {
    await frameRect(c);
    await tap(c, '[data-set-mode="draw"]');
    await box(c, [12, 6], [15, 8]);
  }],
  share: ["Share", async (c) => (await frameRect(c), await tap(c, ".btn-share"), sleep(800))],
  shapes: ["Every shape", allShapes],
  "row-hidden": ["Hidden layer", async (c) => {
    await allShapes(c);
    const [x, y] = await c.evaluate(`(() => { const r = document.querySelector('#left .row[data-layer="5"] .vis').getBoundingClientRect(); return [r.left + 8, r.top + 8]; })()`);
    await move(c, x, y);
    await click(c, x, y);
  }],
  "section-selected": ["Section selected", async (c) => (await allShapes(c), row(c, 1))],
  "slice-selected": ["Slice selected", async (c) => (await allShapes(c), row(c, 3))],
  "line-selected": ["Line selected", async (c) => (await allShapes(c), row(c, 6))],
  "zoom-out": ["Zoomed out", async (c) => (await frameRect(c), await key(c, "-"), key(c, "-"))],
  "zoom-100": ["Zoom 100%", async (c) => (await frameRect(c), await tap(c, ".zoom"), tap(c, '#menu [data-cmd="zoom-to:100"]'))],
  "zoom-fit": ["Zoom to fit", async (c) => (await frameRect(c), key(c, "0"))],
  "text-editing": ["Text · typing", async (c) => (await key(c, "t"), placeText(c, 4, 1, null), type(c, "HELLO"))],
  "text-selected": ["Text selected", starText],
  "comment-editing": ["Comment · typing", async (c) => (await starText(c), await key(c, "c"), placeText(c, 8, 4, null), type(c, "Check"))],
  "comment-selected": ["Comment selected", async (c) => (await starText(c), await key(c, "c"), placeText(c, 8, 4, "Check this"))],
  "star-styled": ["Stroke, shadow, opacity, rotation", async (c) => {
    await starText(c);
    await click(c, ...(await cell(c, 2, 2)));
    await tap(c, '[data-stroke="add"]');
    await tap(c, '[data-shadow="add"]');
    await field(c, "opacity", "50%");
    await field(c, "rotation", "90");
  }],
  "frame-export": ["Export · advanced and preview", async (c) => {
    await starText(c);
    await row(c, 1);
    await field(c, "radius", "2");
    await tap(c, "[data-export-advanced]");
    await tap(c, "[data-preview]");
    await sleep(200);
  }],
  "pen-dot": ["Pen · first point", async (c) => (await key(c, "p"), click(c, ...(await cell(c, 12, 7))))],
  "rename-title": ["Renaming the file", async (c) => (await tap(c, "#title"), sleep(100))],
  assets: ["Assets", async (c) => tap(c, '[data-rail="assets"]')],
  tools: ["Tools", async (c) => tap(c, '[data-rail="tools"]')],
  "no-rulers-grid": ["Rulers and grid off", async (c) => {
    await frameRect(c);
    await tap(c, ".zoom");
    await tap(c, '#menu [data-cmd="toggle-rulers"]');
    await tap(c, ".zoom");
    await tap(c, '#menu [data-cmd="toggle-grid"]');
  }],
  "page-colour": ["Canvas colour", async (c) => {
    await c.evaluate(`(() => { const i = document.querySelector('[data-page-color]'); i.value = '3A1F5C'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await key(c, "Escape");
  }],
  "min-ui": ["Minimised UI", async (c) => (await frameRect(c), key(c, "\\", META))],
  "viewonly-present": ["Shared link · view only", async () => {}, { hash: shareHash(DEMO) }],
  "doc-loaded": ["Shared file, opened to edit", loadDemo, { hash: shareHash(DEMO) }],
};

// ---- capture ------------------------------------------------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".map": "application/json" };
function serve(root) {
  const server = createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(root) || !existsSync(path)) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(path));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** An image layer's pixels as a PNG data URL, with CSS invert baked in (no network in the plugin). */
const imagePng = (c, src, invert) =>
  c.evaluate(`new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      if (${!!invert}) {
        const d = g.getImageData(0, 0, cv.width, cv.height);
        for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = 255 - d.data[i + k];
        g.putImageData(d, 0, 0);
      }
      ok(cv.toDataURL('image/png'));
    };
    img.onerror = () => no(new Error('image ' + ${JSON.stringify(src)}));
    img.src = ${JSON.stringify(src)};
  })`);

/** What the screen builder needs to recognise a node: its id, classes and data attributes. */
function domOf(n) {
  if (!n) return undefined;
  const o = {};
  if (n.el) o.id = n.el.slice(1);
  if (n.cls) o.cls = n.cls;
  if (n.data) o.data = n.data;
  return Object.keys(o).length ? o : undefined;
}

const wanted = process.argv.slice(2);
execFileSync("npm", ["run", "-s", "build"], { cwd: OSUI, stdio: "inherit" });
mkdirSync(OUT, { recursive: true });
const server = await serve(OSUI);
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const c = await launch({ port: 9300 + Math.floor(Math.random() * 400) });
const svgs = [];
const svgIndex = new Map();
const images = {};
const imageIndex = new Map();
const screens = [];
const keepSvg = (markup) => {
  if (!svgIndex.has(markup)) (svgIndex.set(markup, svgs.length), svgs.push(markup));
  return svgIndex.get(markup);
};
try {
  for (const [id, [title, go, opt]] of Object.entries(SCREENS)) {
    if (wanted.length && !wanted.includes(id)) continue;
    await open(c, opt?.hash ? `${base}#share=${opt.hash}` : base);
    try {
      await go(c);
    } catch (e) {
      throw new Error(`screen ${id}: ${e.message}`);
    }
    // park the pointer where no :hover rule applies, unless the screen is about a hover
    if (!id.startsWith("menu-main-")) await move(c, 1300, 895);
    await sleep(150);
    const doc = await extract(c);
    const used = await resolveFonts(c, doc);
    const fig = toFigma(doc, { fontFor: (n) => used.get(n.id) });
    const layers = [];
    for (const { src, ...l } of fig.layers) {
      const out = { ...l, dom: src != null ? domOf(doc.nodes[src]) : undefined };
      if (out.svg) out.svg = keepSvg(out.svg);
      if (out.svgUrl) out.svgUrl = keepSvg(out.svgUrl);
      if (out.image) {
        const png = await imagePng(c, l.image.src, l.image.invert);
        if (!imageIndex.has(png)) imageIndex.set(png, `img${imageIndex.size}`), (images[`img${imageIndex.size - 1}`] = png);
        out.image = { ref: imageIndex.get(png), fit: l.image.fit, natural: l.image.natural };
      }
      layers.push(out);
    }
    screens.push({ id, title, layers });
    console.log(`${id}: ${layers.length} layers`);
  }
} finally {
  await c.close();
  server.close();
}
const [w, h] = [1440, 900];
writeFileSync(join(OUT, "screens.json"), JSON.stringify({ viewport: [w, h], svgs, images, screens }));
console.log(`${screens.length} screens, ${svgs.length} distinct SVGs, ${Object.keys(images).length} images`);
