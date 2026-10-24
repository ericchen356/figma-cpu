// Builds the Leila CPU design from ../spec/*.json and src/ (stages 1–7) in two flavors, like tools/draw-machine/build.mjs:
//   code.js       — dev plugin (Figma desktop → Import plugin from manifest → manifest.json)
//   use-figma.js  — body for the Figma MCP `use_figma` tool
// Usage: node build.mjs [--force] [--page <name>]   (default page "Leila")
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, "..", p), "utf8"));
const opcodes = read("spec/opcodes.json");
const spec = {
  registers: opcodes.registers,
  opcodes: opcodes.opcodes,
  palette: read("spec/palette.json"),
  memory: read("spec/memory-map.json"),
  signals: read("spec/signals.json"),
};
const force = process.argv.includes("--force");
const pageArg = process.argv.indexOf("--page");
const page = pageArg > 0 ? process.argv[pageArg + 1] : "Leila";
const STAGES = ["base", "components", "datapath", "control", "memory", "devices", "machine"];
const draw = STAGES.map((s) => readFileSync(join(here, "src", `${s}.js`), "utf8")).join("\n");
const head = `const SPEC = ${JSON.stringify(spec)};\nconst __FORCE_REDRAW__ = ${force};\nconst __TARGET_PAGE__ = ${JSON.stringify(page)};\n`;

writeFileSync(
  join(here, "code.js"),
  `${head}${draw}\ndrawMachine().then((s) => figma.closePlugin(s), (e) => figma.closePlugin("draw-leila failed: " + e.message));\n`,
);
const body = `${head}${draw}\nreturn await drawMachine();\n`;
writeFileSync(join(here, "use-figma.js"), body);
console.log(`built code.js + use-figma.js (${body.length} chars, limit 50000, force=${force}, page=${page})`);
