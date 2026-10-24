// Bundles cli/run.ts with esbuild (.asm as text) and runs it. Usage: node cli/run.mjs <args>
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist/run.mjs");
await esbuild.build({
  entryPoints: [join(here, "run.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  loader: { ".asm": "text" },
  logLevel: "warning",
});
process.exit(spawnSync("node", [out, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);
