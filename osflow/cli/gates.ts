// Prints the gate-level editor for each feature configuration: gates, register bits, gates per
// module, event codes, what a whole clock tick costs, and what one Figma reaction per event would
// execute (src/gates/reaction.ts), costliest first. Usage: npm run gates [-- --all]
import { compile } from "../../silicon/src/compile";
import { flatten } from "../../silicon/src/netlist/flatten";
import { buildEditor } from "../src/editor";
import { reactions, synthesize } from "../src/gates";
import type { Feature } from "../src/spec";

const CONFIGS: Feature[][] = [
  [],
  ["style"],
  ["style", "clipboard"],
  ["style", "clipboard", "align"],
];
/** silicon's measurement: the viewer survives 501 actions per event (and dies at 2,001). */
const SAFE = 500;
const all = process.argv.includes("--all");

const pad = (x: string | number, n: number) => String(x).padStart(n);
const tally = (names: string[]) => {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

for (const omit of CONFIGS) {
  const ed = buildEditor({ target: "hardware", omit });
  const t0 = performance.now();
  const syn = synthesize(ed);
  const ms = performance.now() - t0;
  const net = flatten(syn.lib, syn.top);
  const tick = compile(net);
  const cellOf = new Map(
    syn.lib.get(syn.top)!.instances.map((i) => [i.name, i.cell]),
  );
  const moduleOf = (gate: number) =>
    cellOf.get(net.gates[gate].path.split("/")[0])!;
  const list = reactions(syn, net);
  const costs = list.map((r) => r.cost).sort((a, b) => a - b);
  const latches = Object.entries(syn.stats.byModule)
    .filter(([k]) => k.startsWith("REG_W"))
    .reduce((a, [, v]) => a + v, 0);

  console.log(
    `\n${omit.length ? `without ${omit.join(", ")}` : "every feature"}`,
  );
  console.log(
    `  ${syn.stats.gates} gates: ${syn.stats.registers} register bits (${latches} gates of latches) and ${syn.stats.gates - latches} of logic; ${list.length} event codes for ${ed.events.length} events (EVT ${syn.evtBits} bits); synthesized in ${ms.toFixed(0)} ms`,
  );
  console.log(
    `  gates per module: ${Object.entries(syn.stats.byModule)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  console.log(
    `  a whole clock tick: ${tick.stats.actionsPerTick} actions (CLK low ${tick.passes[0].order.length}, high ${tick.passes[1].order.length})`,
  );
  console.log(
    `  one reaction per event: ${costs[0]} to ${costs[costs.length - 1]} actions, median ${costs[costs.length >> 1]}; ${costs.filter((c) => c <= SAFE).length} of ${costs.length} codes within ${SAFE}`,
  );
  console.log(
    `\n  ${"event".padEnd(26)}${pad("actions", 9)}${pad("gates", 8)}${pad("commits", 9)}   most of the gates in`,
  );
  const shown = [...list].sort((a, b) => b.cost - a.cost || a.code - b.code);
  for (const r of all ? shown : shown.slice(0, 10)) {
    const name = r.ids[0] + (r.ids.length > 1 ? ` +${r.ids.length - 1}` : "");
    const blocks = tally(r.gates.map(moduleOf))
      .slice(0, 3)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    console.log(
      `  ${name.padEnd(26)}${pad(r.cost, 9)}${pad(r.gates.length, 8)}${pad(r.commits.length, 9)}   ${blocks}`,
    );
  }
}
