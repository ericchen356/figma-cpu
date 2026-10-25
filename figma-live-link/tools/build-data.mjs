// Finishes the export for the emulator: adds the resize handles' live placement and writes the
// Make app's data chunks.
//   node tools/build-data.mjs data/os-export-meta.json data/handles.json data/layout.json
// → data/os-full.json (with meta, for tests) and make/public/data/os-<k>.txt (no meta, ≤ 800 kB each).
//
// The handles are the only clickable layers that move: os-ui's slot boxes are spacer frames 1, 2,
// 4 … cells long, each shown while one register bit is 1 (silicon/osui/src/live/screen.ts: placed,
// sized, slotHandles). So a handle's centre is its slot's "vin" origin plus the shown x/y spacers,
// plus the shown w/h spacers on its right/bottom corners. dyn rows:
//   [node, right, bottom, w, h, vinX, vinY, ys, xs, ws, hs]
//   spacer = [variable index, size] (−1: always shown)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [exportPath, handlesPath, layoutPath] = process.argv.slice(2);
const data = JSON.parse(readFileSync(exportPath, "utf8"));
const handles = JSON.parse(readFileSync(handlesPath, "utf8"));
const layout = JSON.parse(readFileSync(layoutPath, "utf8"));

const key = (name, coll) => `${coll}\u0000${name}`;
const varIdx = new Map(data.vars.map((v, i) => [key(v[0], data.colls[v[1]]), i]));
const initOf = new Map([...handles.vars, ...layout.vars].map(([n, c, init]) => [key(n, c), init]));
const vref = ([name, coll]) => {
  const k = key(name, coll);
  if (!varIdx.has(k)) {
    // a line no reaction writes: it keeps its power-on value
    let c = data.colls.indexOf(coll);
    if (c < 0) { c = data.colls.length; data.colls.push(coll); }
    varIdx.set(k, data.vars.length);
    data.vars.push([name, c, "B", initOf.get(k) ?? false]);
  }
  return varIdx.get(k);
};
const spacers = (list) => list.map(([v, size]) => [Array.isArray(v) ? vref(v) : v ? -1 : -2, size]).filter(([v]) => v !== -2);

const byId = new Map(data.meta.map((m, i) => [m[0], i]));
data.dyn = handles.res.map(([id, corner, w, h, vinX, vinY, ys, xs, ws, hs]) => {
  const node = byId.get(id);
  if (node === undefined) throw new Error(`handle ${id} is not in the export`);
  return [node, corner.endsWith("e") ? 1 : 0, corner.startsWith("s") ? 1 : 0, w, h, vinX, vinY,
    spacers(ys), spacers(xs), spacers(ws), spacers(hs)];
});

// The auto-layout trees that hold clickable layers (right panel, Layers panel, canvas), so the
// emulator reflows them from the live visibility: in Figma a hidden layer takes no room, and the
// editor stores every box as laid out at power-on. layout rows:
//   [node or −1, vis (variable index, −1 shown), mode, w, h, ox, oy, sizingH, sizingV, pad, gap,
//    primaryAlign, counterAlign, stretch, grow, absolute, children]
const tree = (row) => {
  const [id, vis, ...rest] = row;
  const kids = rest.pop();
  return [id === null ? -1 : byId.get(id) ?? -1, vis === 1 ? -1 : vref(vis), ...rest, kids.map(tree)];
};
data.layout = layout.trees.map(tree);

// What each clickable layer does, in a few words, for the Make app's "last action" line.
const label = (raw) => {
  if (!raw) return null;
  const a = JSON.parse(raw)[0];
  switch (a.on) {
    case "click": return a.run.replace(/@.*$/, "");
    case "press": case "release": return `canvas cell ${a.cell[0]},${a.cell[1]}`;
    case "open": return `open ${a.menu}`;
    case "item": return a.run.replace(/@.*$/, "");
    case "sub": return `menu ${a.menu}`;
    case "dismiss": return "close menu";
    case "handle": case "handleUp": return `resize handle ${["nw", "ne", "sw", "se"][a.corner] ?? a.corner}`;
    default: return null;
  }
};
data.labels = data.meta.map((m) => label(m[1]));

writeFileSync("data/os-full.json", JSON.stringify(data));
const { meta, ...lean } = data;
const text = JSON.stringify(lean);
mkdirSync("make/public/data", { recursive: true });
const size = 800000, count = Math.ceil(text.length / size);
for (let k = 0; k < count; k++) writeFileSync(`make/public/data/os-${k}.txt`, text.slice(k * size, (k + 1) * size));
writeFileSync("make/public/data/os-index.json", JSON.stringify({ parts: count }));
console.log(`${data.dyn.length} handles placed live; ${data.layout.length} layout trees; ${data.vars.length} variables; Make data: ${count} files, ${(text.length / 1e6).toFixed(2)} MB`);
