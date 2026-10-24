// Bundles the CPU NATHAN plugin:
//   nathan/plugin/src/main.ts (+ the silicon and nathan sources it imports) → nathan/plugin/dist/code.js
//   nathan/plugin/ui/ui.ts inlined into nathan/plugin/ui/ui.html             → nathan/plugin/dist/ui.html
// Usage (from silicon/): node nathan/plugin/build.mjs [--watch]
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });

const common = {
  absWorkingDir: join(here, "..", ".."),
  bundle: true,
  target: "es2017",
  loader: { ".asm": "text" },
  logLevel: "info",
};

const inlineUi = {
  name: "inline-ui",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      const js = result.outputFiles[0].text;
      const html = readFileSync(join(here, "ui/ui.html"), "utf8").replace("<!-- SCRIPT -->", () => `<script>${js.replace(/<\/script>/g, "<\\/script>")}</script>`);
      writeFileSync(join(dist, "ui.html"), html);
    });
  },
};

const main = await esbuild.context({ ...common, entryPoints: [join(here, "src/main.ts")], outfile: join(dist, "code.js") });
const ui = await esbuild.context({ ...common, entryPoints: [join(here, "ui/ui.ts")], write: false, outfile: join(dist, "ui.js"), plugins: [inlineUi] });

if (process.argv.includes("--watch")) {
  await Promise.all([main.watch(), ui.watch()]);
} else {
  await Promise.all([main.rebuild(), ui.rebuild()]);
  await Promise.all([main.dispose(), ui.dispose()]);
}
