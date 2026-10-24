// Writes the silicon CPU's replay chunks to deploy/out-cpu/ (one .js file per chunk, in order) and
// a manifest with their notes and sizes. Usage: npm run -s cpu
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateCpu } from "./cpu";

const out = join(process.cwd(), "deploy", "out-cpu");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const g = generateCpu();
const manifest = g.chunks.map((c, i) => {
  const file = `${String(i + 1).padStart(2, "0")}-${c.step}.js`;
  writeFileSync(join(out, file), c.code);
  return { file, step: c.step, chars: c.code.length, note: c.note };
});
writeFileSync(join(out, "manifest.json"), JSON.stringify({ stats: g.stats, names: g.names, chunks: manifest }, null, 2));
console.log(JSON.stringify(g.stats));
for (const m of manifest) console.log(`${m.file.padEnd(16)} ${String(m.chars).padStart(7)}  ${m.note}`);
