// Bundles the plugin: src/main.ts → dist/code.js, ui/ui.ts inlined into dist/ui.html,
// and src/smoke.ts → dist/use-figma-smoke.js (a `use_figma` body for the MCP smoke test).
// Usage: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

const common = { bundle: true, target: "es2017", loader: { ".asm": "text" }, logLevel: "info" };

const inlineUi = {
  name: "inline-ui",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      const js = result.outputFiles[0].text;
      const html = readFileSync("ui/ui.html", "utf8").replace(
        "<!-- SCRIPT -->",
        () => `<script>${js.replace(/<\/script>/g, "<\\/script>")}</script>`,
      );
      writeFileSync("dist/ui.html", html);
    });
  },
};

const main = await esbuild.context({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/code.js" });
const ui = await esbuild.context({
  ...common,
  entryPoints: ["ui/ui.ts"],
  write: false,
  outfile: "dist/ui.js",
  plugins: [inlineUi],
});

// The MCP smoke body: SMOKE options on the first line (edit them), then the bundle, then `return`.
const smokeBody = {
  name: "smoke-body",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      const options = `const SMOKE = { page: "Eric", program: "rect", mode: "run" };\n`;
      const body = `${options}${result.outputFiles[0].text}\nreturn await FigmaCpuSmoke.smoke(SMOKE);\n`;
      writeFileSync("dist/use-figma-smoke.js", body);
      if (body.length > 50000) console.warn(`use-figma-smoke.js is ${body.length} chars (use_figma limit is 50000)`);
    });
  },
};
const smoke = await esbuild.context({
  ...common,
  entryPoints: ["src/smoke-entry.ts"],
  format: "iife",
  globalName: "FigmaCpuSmoke",
  minify: true,
  write: false,
  outfile: "dist/smoke.js",
  plugins: [smokeBody],
});

const all = [main, ui, smoke];
if (watch) {
  await Promise.all(all.map((c) => c.watch()));
} else {
  await Promise.all(all.map((c) => c.rebuild()));
  await Promise.all(all.map((c) => c.dispose()));
}
