// Writes the use_figma calls that read the build PNG (the image fill of node HOLDER, put there by the
// Figma MCP's upload_assets) and run its steps [from, to): about 4 KB each, the decoder minified.
// The last call removes the holder. usage: node calls.mjs <holder id> <dest dir> [page] [steps]
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";
const [holder, dest, pageName = "CPU", steps = "204"] = process.argv.slice(2);
const dec = transformSync(fs.readFileSync(new URL("./decode.js", import.meta.url), "utf8"), {
  minify: true,
  loader: "js",
}).code.trim();
// variables and frame; the screen 10 steps a call; reactions 30 a call (about 2 minutes each)
const n = Number(steps);
const ranges = [[0, 2], [2, 12], [12, 22]];
for (let i = 22; i < n; i += 30) ranges.push([i, Math.min(n, i + 30)]);
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(dest)) fs.rmSync(path.join(dest, f));
ranges.forEach(([from, to], k) => {
  const last = k === ranges.length - 1;
  const code = `${dec}
const holder = await figma.getNodeByIdAsync(${JSON.stringify(holder)});
const paint = holder.fills.find((p) => p.type === "IMAGE");
const bytes = await figma.getImageByHash(paint.imageHash).getBytesAsync();
const { runtime, items } = JSON.parse(PNGTEXT(bytes));
const page = figma.root.children.find((p) => p.name === ${JSON.stringify(pageName)});
await figma.setCurrentPageAsync(page);
const AF = Object.getPrototypeOf(async () => {}).constructor;
const RT = await new AF("figma", runtime + "\\nreturn RT;")(figma);
const out = [];
for (const [f, step, json, hash] of items.slice(${from}, ${to})) {
  const r = await RT.run(step, JSON.parse(json), hash);
  out.push(f + " " + JSON.stringify(r).slice(0, 60));
}
${last ? "holder.remove();\n" : ""}return { from: ${from}, to: ${to}, of: items.length, out };`;
  fs.writeFileSync(path.join(dest, `${String(k + 1).padStart(2, "0")}.js`), code);
  console.log(k + 1, from, to, code.length);
});
