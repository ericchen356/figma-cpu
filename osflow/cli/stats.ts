// Prints how big the compiled editor is: variables, events, stored actions, and the costliest
// events (the viewer's limit is executed actions per event). Usage: npm run stats
import { statsOf } from "../src/compile";
import { buildEditor } from "../src/editor";

const stats = statsOf(buildEditor());
const kind = (id: string) => id.replace(/\/[^#]*#/, "#").replace(/\d+/g, "N");
const groups = new Map<string, { n: number; worst: number; stored: number; depth: number }>();
for (const e of stats.byEvent) {
  const k = e.id.startsWith("cell/") ? "cell#" + e.id.split("#")[1] : e.id.startsWith("key/") ? e.id : kind(e.id);
  const g = groups.get(k) ?? { n: 0, worst: 0, stored: 0, depth: 0 };
  g.n++;
  g.worst = Math.max(g.worst, e.worst);
  g.stored += e.stored;
  g.depth = Math.max(g.depth, e.depth);
  groups.set(k, g);
}
console.log(`variables ${stats.variables}   events ${stats.events}   stored actions ${stats.stored}   max actions in one event ${stats.maxWorst}   max expression depth ${stats.maxDepth}`);
console.log("\nevent group".padEnd(26) + "events  worst-case  stored(total)  depth");
for (const [k, g] of [...groups].sort((a, b) => b[1].worst - a[1].worst))
  console.log(k.padEnd(26) + String(g.n).padStart(6) + String(g.worst).padStart(12) + String(g.stored).padStart(14) + String(g.depth).padStart(7));
