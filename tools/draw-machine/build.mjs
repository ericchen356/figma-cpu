// Builds the draw-machine script from spec/*.json in two flavors:
//   code.js       — dev plugin (import tools/draw-machine/manifest.json in Figma desktop)
//   use-figma.js  — body for the Figma MCP `use_figma` tool (tools/run-in-figma.sh)
// Usage: node tools/draw-machine/build.mjs [--force]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const opcodes = read("spec/opcodes.json");
const spec = {
  registers: opcodes.registers,
  opcodes: opcodes.opcodes,
  palette: read("spec/palette.json"),
  memory: read("spec/memory-map.json"),
};
const force = process.argv.includes("--force");
const draw = readFileSync(join(here, "draw.js"), "utf8");
const head = `const SPEC = ${JSON.stringify(spec)};\nconst __FORCE_REDRAW__ = ${force};\n`;

writeFileSync(
  join(here, "code.js"),
  `${head}${draw}\ndrawMachine().then((s) => figma.closePlugin(s), (e) => figma.closePlugin("draw-machine failed: " + e.message));\n`,
);
const body = `${head}${draw}\nreturn await drawMachine();\n`;
writeFileSync(join(here, "use-figma.js"), body);
console.log(`built code.js + use-figma.js (${body.length} chars, limit 50000, force=${force})`);
