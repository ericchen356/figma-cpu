// Bundles the spike plugin: spike/src/main.ts (+ the silicon sources it imports) → spike/dist/code.js.
// Usage (from silicon/ or silicon/spike/): node spike/build.mjs [--watch]
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const options = {
  absWorkingDir: join(here, ".."),
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(here, "dist/code.js"),
  bundle: true,
  target: "es2017",
  logLevel: "info",
};

if (process.argv.includes("--watch")) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
