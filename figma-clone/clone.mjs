#!/usr/bin/env node
// Clone a Figma file's layout through the REST API: the raw node tree as JSON plus a
// static HTML render (one section per page). Generic over node types; anything it
// can't draw (images, gradients, effects, clipping) is skipped and listed on stderr.
//
//   FIGMA_TOKEN=figd_... node figma-clone/clone.mjs <fileKey> [outDir]

import { mkdir, writeFile } from "node:fs/promises";

const fileKey = process.argv[2];
const outDir = process.argv[3] ?? `figma-clone/out/${fileKey}`;
const token = process.env.FIGMA_TOKEN;
if (!fileKey || !token) {
  console.error("usage: FIGMA_TOKEN=... node figma-clone/clone.mjs <fileKey> [outDir]");
  process.exit(1);
}

const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
  headers: { "X-Figma-Token": token },
});
if (!res.ok) {
  console.error(`Figma API ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const file = await res.json();

const skipped = new Set();
const rgba = ({ r, g, b, a = 1 }, opacity = 1) =>
  `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${+(a * opacity).toFixed(3)})`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function collectBoxes(node, out = []) {
  if (node.absoluteBoundingBox) out.push(node.absoluteBoundingBox);
  node.children?.forEach((c) => collectBoxes(c, out));
  return out;
}

// Every node is positioned from its absolute bounding box relative to the page origin,
// so nodes are emitted flat (tree order = z-order) instead of nested.
function render(node, ox, oy) {
  if (node.visible === false) return "";
  const b = node.absoluteBoundingBox;
  const css = [];
  if (b) css.push(`left:${b.x - ox}px`, `top:${b.y - oy}px`, `width:${b.width}px`, `height:${b.height}px`);

  const isText = node.type === "TEXT";
  const fill = node.fills?.find((f) => f.visible !== false);
  if (fill?.type === "SOLID") {
    const color = rgba(fill.color, (fill.opacity ?? 1) * (node.opacity ?? 1));
    css.push(`${isText ? "color" : "background"}:${color}`);
  } else if (fill) {
    skipped.add(`${fill.type} fill on "${node.name}"`);
  }

  const stroke = node.strokes?.find((s) => s.type === "SOLID" && s.visible !== false);
  if (stroke) css.push(`box-shadow:inset 0 0 0 ${node.strokeWeight ?? 1}px ${rgba(stroke.color, stroke.opacity)}`);

  if (node.type === "ELLIPSE") css.push("border-radius:50%");
  else if (node.rectangleCornerRadii) css.push(`border-radius:${node.rectangleCornerRadii.map((r) => `${r}px`).join(" ")}`);
  else if (node.cornerRadius) css.push(`border-radius:${node.cornerRadius}px`);

  if (isText) {
    const s = node.style ?? {};
    const line = s.lineHeightPx ? `/${s.lineHeightPx}px` : "";
    css.push(
      `font:${s.fontWeight ?? 400} ${s.fontSize ?? 12}px${line} '${s.fontFamily ?? "Inter"}',sans-serif`,
      `text-align:${(s.textAlignHorizontal ?? "LEFT").toLowerCase()}`,
      "white-space:pre-wrap",
    );
  }

  const self = b
    ? `<div class="n" data-type="${node.type}" data-name="${esc(node.name)}" style="${css.join(";")}">${isText ? esc(node.characters ?? "") : ""}</div>\n`
    : "";
  return self + (node.children ?? []).map((c) => render(c, ox, oy)).join("");
}

const sections = file.document.children.map((page) => {
  const boxes = collectBoxes(page);
  const ox = Math.min(...boxes.map((b) => b.x), 0);
  const oy = Math.min(...boxes.map((b) => b.y), 0);
  const w = Math.max(...boxes.map((b) => b.x + b.width - ox), 0);
  const h = Math.max(...boxes.map((b) => b.y + b.height - oy), 0);
  const bg = page.backgroundColor ? rgba(page.backgroundColor) : "#fff";
  const body = (page.children ?? []).map((c) => render(c, ox, oy)).join("");
  return `<section style="background:${bg}"><h2>${esc(page.name)}</h2><div class="stage" style="width:${w}px;height:${h}px">\n${body}</div></section>`;
});

const html = `<!doctype html>
<meta charset="utf-8">
<title>${esc(file.name)} (clone of ${fileKey})</title>
<style>
  body { margin: 0; font-family: Inter, sans-serif; }
  section { padding: 40px; }
  h2 { margin: 0 0 16px; font: 12px/1 monospace; color: #888; }
  .stage { position: relative; }
  .n { position: absolute; box-sizing: border-box; }
</style>
${sections.join("\n")}
`;

await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/file.json`, JSON.stringify(file, null, 2));
await writeFile(`${outDir}/index.html`, html);
console.log(`cloned "${file.name}" -> ${outDir}/{file.json,index.html}`);
if (skipped.size) console.error(`skipped:\n  ${[...skipped].join("\n  ")}`);
