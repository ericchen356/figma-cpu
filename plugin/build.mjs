// Bundles the plugin: src/main.ts → dist/code.js, ui/ui.ts inlined into dist/ui.html.
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

if (watch) {
  await Promise.all([main.watch(), ui.watch()]);
} else {
  await Promise.all([main.rebuild(), ui.rebuild()]);
  await Promise.all([main.dispose(), ui.dispose()]);
}
