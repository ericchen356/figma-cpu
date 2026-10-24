// `npm run audit -- <rest.json> [cap]`: audits a REST dump of the silicon page against the code.
import { readFileSync } from "node:fs";
import { cpuNetlist } from "../cpu";
import { audit, parseRest } from "./audit";

const [file, capArg] = process.argv.slice(2);
if (!file) {
  console.error("usage: npm run audit -- <figma-rest.json> [maxActionsPerEvent=400]");
  process.exit(2);
}
const expected: Record<string, number> = {};
for (const g of cpuNetlist().gates) expected[g.type] = (expected[g.type] ?? 0) + 1;
const a = audit(parseRest(JSON.parse(readFileSync(file, "utf8"))), expected, capArg ? Number(capArg) : 400);
console.log(a.text);
process.exit(a.rebuildNeeded || !a.gates.matches ? 1 : 0);
