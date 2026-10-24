// Builds dist/verify-use-figma.js: the verify run as a `use_figma` code body.
// rect.asm is assembled here (Node, spec table) and embedded as bytes, and the snapshot
// point is picked so the screen is caught half-way through drawing the red rectangle.
// Usage (from plugin/): node verify/build.mjs && ../tools/run-in-figma.sh dist/verify-use-figma.js "Verify FigmaCPU runner"
import * as esbuild from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";

const prep = await esbuild.build({
  stdin: {
    contents: `
      import { readFileSync } from "node:fs";
      import spec from "../spec/opcodes.json";
      import { assemble } from "./src/assembler";
      import { CPU, VRAM_START } from "./src/cpu";
      import { parseTable } from "./src/table";
      const read = (n) => readFileSync("programs/" + n, "utf8");
      const table = parseTable(spec.opcodes).table;
      const res = assemble(read("rect.asm"), table, { includes: { "hw.asm": read("hw.asm"), "gfx.asm": read("gfx.asm") } });
      if (!res.ok) throw new Error(JSON.stringify(res.errors));
      const cpu = new CPU(table);
      cpu.load(res.segments);
      let red = 0;
      while (!cpu.halted && red < 700) {
        cpu.step();
        red = cpu.mem.subarray(VRAM_START, VRAM_START + 128 * 96).filter((p) => p === 8).length;
      }
      export const result = { segments: res.segments, stopAt: cpu.cycles };
    `,
    resolveDir: ".",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const tmp = "dist/.verify-prep.mjs";
mkdirSync("dist", { recursive: true });
writeFileSync(tmp, prep.outputFiles[0].text);
const { result } = await import(`../${tmp}?${Date.now()}`);

const out = await esbuild.build({
  entryPoints: ["verify/verify.ts"],
  bundle: true,
  format: "iife",
  globalName: "FigmaCPUVerify",
  target: "es2017",
  minifyWhitespace: true,
  minifySyntax: true,
  define: { __SEGMENTS__: JSON.stringify(result.segments), __STOP_AT__: String(result.stopAt) },
  write: false,
});
const body = `${out.outputFiles[0].text}\nreturn await FigmaCPUVerify.run();\n`;
writeFileSync("dist/verify-use-figma.js", body);
console.log(`dist/verify-use-figma.js: ${body.length} chars (use_figma limit 50000), snapshot at cycle ${result.stopAt}`);
