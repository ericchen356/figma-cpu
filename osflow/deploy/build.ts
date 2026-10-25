// Writes the CPU NATHAN replay chunks to deploy/out/ (one .js file per use_figma call, in order)
// and a manifest with their notes and sizes. Usage: npm run -s nathan
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "./nathan";

const out = join(process.cwd(), "deploy", "out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// NATHAN_AT="x,y" places the Present frame (default: the page's origin)
const at = process.env.NATHAN_AT?.split(",").map(Number);
const g = generate(at ? { at: { x: at[0], y: at[1] } } : {});
const manifest = g.chunks.map((c, i) => {
  const file = `${String(i + 1).padStart(2, "0")}-${c.step}.js`;
  writeFileSync(join(out, file), c.code);
  return { file, step: c.step, chars: c.code.length, note: c.note };
});
writeFileSync(join(out, "manifest.json"), JSON.stringify({ stats: g.stats, names: g.names, chunks: manifest }, null, 2));
console.log(JSON.stringify(g.stats));
for (const m of manifest) console.log(`${m.file.padEnd(16)} ${String(m.chars).padStart(6)}  ${m.note}`);
