// Bundles tools/cost-model.ts with esbuild and runs its CLI: node tools/cost-model.mjs [--sweep 4..9] [--v2] [--json] …
// (same approach as tools/audit-file.mjs; `--help` lists the options)
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "silicon-cost-")), "cost-model.mjs");
await build({ entryPoints: [join(root, "tools/cost-model.ts")], bundle: true, platform: "node", format: "esm", outfile: out, loader: { ".asm": "text" }, logLevel: "error" });
const { main } = await import(pathToFileURL(out).href);
process.exitCode = main(process.argv.slice(2));
