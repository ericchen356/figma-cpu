// Bundles src/audit/cli.ts with esbuild and runs it: node tools/audit-file.mjs <figma-rest.json> [cap]
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "silicon-audit-")), "cli.mjs");
await build({ entryPoints: ["src/audit/cli.ts"], bundle: true, platform: "node", format: "esm", outfile: out, loader: { ".asm": "text" }, logLevel: "error" });
await import(pathToFileURL(out).href);
