#!/usr/bin/env node
// Bundles one TypeScript file in this folder with silicon's esbuild and runs it.
//   node engine/run.mjs fuzz.ts [seed] [episodes] [events]     engine vs os-ui/src/model.ts
//   node engine/run.mjs measure.ts                              Figma actions executed per event
//   node engine/run.mjs sizes.ts                                static size of every reaction
//   NM=128 node engine/run.mjs word-level/bench.ts              the word-level CPU experiment
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [file, ...args] = process.argv.slice(2);
if (!file) { console.error("usage: node engine/run.mjs <file.ts> [args]"); process.exit(1); }
const esbuild = resolve(here, "../silicon/node_modules/.bin/esbuild");
const out = join(mkdtempSync(join(tmpdir(), "engine-")), "run.mjs");
execFileSync(esbuild, [resolve(here, file), "--bundle", "--platform=node", "--format=esm", "--loader:.asm=text", `--outfile=${out}`, "--log-level=error", `--define:process.env.NM=${JSON.stringify(String(process.env.NM ?? 256))}`], { stdio: "inherit" });
// the bundled file reads process.argv[1] to pick what to run, so keep the source name there
execFileSync(process.execPath, ["--max-old-space-size=8192", "--input-type=module", "-e", `process.argv[1]=${JSON.stringify(file)};process.argv.splice(2,0,...${JSON.stringify(args)});await import(${JSON.stringify("file://" + out)})`], { stdio: "inherit" });
