// `npm run audit -- <rest.json> [cap] [--json]`: audits a REST dump of the silicon page against the code: gates,
// every event ≤ cap, the reaction graph (Step / Run loop / both Reset chains), frames + flows, lit bindings
// (gates, front panel, MEM matrix) and variables. Exit 1 unless the verdict is "READY to present".
import { readFileSync } from "node:fs";
import { cpuNetlist } from "../cpu";
import { parseRest } from "./audit";
import { auditBuild, expectedFrom } from "./build";

const args = process.argv.slice(2);
const json = args.includes("--json");
const [file, capArg] = args.filter((a) => a !== "--json");
if (!file) {
  console.error("usage: npm run audit -- <figma-rest.json> [maxActionsPerEvent=400] [--json]");
  process.exit(2);
}
const a = auditBuild(parseRest(JSON.parse(readFileSync(file, "utf8"))), expectedFrom(cpuNetlist()), { cap: capArg ? Number(capArg) : 400 });
if (json) {
  const { text: _text, events, ...rest } = a;
  console.log(JSON.stringify({ ...rest, events: events.length }, null, 2));
} else console.log(a.text);
process.exit(a.ready && a.gates.matches ? 0 : 1);
