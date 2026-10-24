// Builds the Leila CPU plugin with no dependencies:
//   dist/code.js  = SPEC + src/core/*.js + src/figma/*.js + src/main.js
//   dist/ui.html  = ui/ui.html with UI_DATA + ui/ui.js inlined
// Usage: node build.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const json = (p) => JSON.parse(read(p));

const opcodes = json("../spec/opcodes.json");
const spec = {
  registers: opcodes.registers,
  formats: opcodes.formats,
  opcodes: opcodes.opcodes,
  palette: json("../spec/palette.json"),
  memory: json("../spec/memory-map.json"),
  signals: json("../spec/signals.json"),
};
const programs = {};
for (const f of readdirSync(join(here, "programs")).sort()) if (f.endsWith(".asm")) programs[f.slice(0, -4)] = read(`programs/${f}`);
const order = ["count", "fib", "rect", "bounce", "paint"];
const orderedPrograms = {};
for (const k of order.concat(Object.keys(programs))) if (programs[k] !== undefined) orderedPrograms[k] = programs[k];

const rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const uiData = {
  PROGRAMS: orderedPrograms,
  PALETTE: spec.palette.colors.map(rgb),
  WIDTH: spec.memory.vram.width,
  HEIGHT: spec.memory.vram.height,
  REGISTERS: spec.registers,
};

mkdirSync(join(here, "dist"), { recursive: true });
const SOURCES = ["src/core/spec.js", "src/core/micro.js", "src/core/cpu.js", "src/core/rtl.js", "src/core/asm.js", "src/core/index.js", "src/figma/bind.js", "src/figma/render.js", "src/main.js"];
const code = [`const SPEC = ${JSON.stringify(spec)};`, ...SOURCES.map(read)].join("\n");
writeFileSync(join(here, "dist/code.js"), code);
const script = `const UI_DATA = ${JSON.stringify(uiData)};\n${read("ui/ui.js")}`;
const html = read("ui/ui.html").replace("<!-- SCRIPT -->", () => `<script>${script.replace(/<\/script>/g, "<\\/script>")}</script>`);
writeFileSync(join(here, "dist/ui.html"), html);
console.log(`built dist/code.js (${code.length} chars) and dist/ui.html (${html.length} chars), ${Object.keys(orderedPrograms).length} programs`);
