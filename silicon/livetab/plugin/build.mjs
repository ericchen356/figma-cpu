// Bundles the "Leila's CPU" extension:
//   livetab/plugin/src/main.ts (+ the patch and the silicon CPU it compiles) → livetab/plugin/dist/code.js
//   livetab/plugin/ui/ui.html                                                 → livetab/plugin/dist/ui.html
//   livetab/src/page.ts, for a figma.com tab                                  → livetab/plugin/dist/page.js
// Usage (from silicon/): node livetab/plugin/build.mjs
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });
const common = { absWorkingDir: join(here, "..", ".."), bundle: true, target: "es2017", loader: { ".asm": "text" }, logLevel: "info" };
await esbuild.build({ ...common, entryPoints: [join(here, "src/main.ts")], outfile: join(dist, "code.js") });
await esbuild.build({ ...common, entryPoints: [join(here, "..", "src/page.ts")], outfile: join(dist, "page.js"), format: "iife" });
copyFileSync(join(here, "ui/ui.html"), join(dist, "ui.html"));
