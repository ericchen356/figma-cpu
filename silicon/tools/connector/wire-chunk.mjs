// Prints a use_figma script (Figma MCP) that wires chunk k of the tick onto the per-chunk layout that
// applyPerChunk() built (docs/CONNECTOR.md):
//   · "<CPU> · Control" → the k-th stacked "button/Step": ON_CLICK runs chunk k, then moves the phase on;
//   · "<CPU> · Run k+1" → AFTER_TIMEOUT: if running (∧ ¬halted at k = 0) chunk k and NAVIGATE to the next
//     Run frame, else running := false and NAVIGATE to Control.
// Usage: node tools/connector/wire-chunk.mjs <k> [outDir]  → paste the output as the use_figma code.
// The script checks its own name/action counts, so a truncated paste fails before it changes anything.
import { readFileSync } from "node:fs";

const k = Number(process.argv[2]);
const dir = process.argv[3] ?? "tools/connector/out";
const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8"));
if (!(k >= 0 && k < meta.chunks)) throw new Error(`k must be 0…${meta.chunks - 1}`);
const data = readFileSync(`${dir}/c${k}.json`, "utf8");
const { names, acts } = JSON.parse(data);

console.log(`const P = ${data};
if (P.names.length !== ${names.length} || P.acts.length !== ${acts.length}) throw new Error("paste check failed: " + P.names.length + " names, " + P.acts.length + " acts");
const NAME = "CPU", K = ${meta.chunks}, k = ${k}, HALT = ${JSON.stringify(meta.halt.startsWith("net/") ? meta.halt : "net/" + meta.halt)};
const page = figma.root.children.find((p) => p.children.some((n) => n.name === NAME + " · Control"));
if (!page) throw new Error("no page with '" + NAME + " · Control': run applyPerChunk (Compile) first");
await figma.setCurrentPageAsync(page);
const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === NAME);
const byName = new Map((await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id).map((v) => [v.name, v.id]));
const id = (n) => { const v = byName.get(n); if (!v) throw new Error("no variable " + n); return v; };
const B = (value) => ({ type: "BOOLEAN", resolvedType: "BOOLEAN", value });
const F = (value) => ({ type: "FLOAT", resolvedType: "FLOAT", value });
const S = (value) => ({ type: "STRING", resolvedType: "STRING", value });
const A = (vid, resolvedType = "BOOLEAN") => ({ type: "VARIABLE_ALIAS", resolvedType, value: { type: "VARIABLE_ALIAS", id: vid } });
const X = (fn, args, resolvedType = "BOOLEAN") => ({ type: "EXPRESSION", resolvedType, value: { expressionFunction: fn, expressionArguments: args } });
const dec = (e) => typeof e === "boolean" ? B(e) : typeof e === "number" ? A(id(P.names[e])) : X(e[0], e.slice(1).map(dec));
const set = (vid, value) => ({ type: "SET_VARIABLE", variableId: vid, variableValue: value });
const nav = (dest) => ({ type: "NODE", destinationId: dest, navigation: "NAVIGATE", transition: null });
const acts = P.acts.map(([t, e]) => set(id(P.names[t]), dec(e)));
const next = (k + 1) % K, ph = id("ctl/phase"), ticks = id("ctl/ticks");
acts.push(set(ph, F(next)), set(id("ctl/phaseText"), X("ADDITION", [S(""), A(ph, "FLOAT")], "STRING")), set(id("ctl/phaseIs/" + k), B(false)), set(id("ctl/phaseIs/" + next), B(true)));
if (k === K - 1) acts.push(set(ticks, X("ADDITION", [A(ticks, "FLOAT"), F(1)], "FLOAT")), set(id("ctl/tickText"), X("ADDITION", [S(""), A(ticks, "FLOAT")], "STRING")));
const control = page.children.find((n) => n.name === NAME + " · Control");
const runs = Array.from({ length: K }, (_, i) => page.children.find((n) => n.name === NAME + " · Run " + (i + 1)));
if (runs.some((r) => !r)) throw new Error("missing Run frames: expected " + NAME + " · Run 1…" + K);
const running = id("ctl/running");
const cond = k === 0 ? X("AND", [A(running), X("NOT", [A(id(HALT))])]) : X("EQUALS", [A(running), B(true)]);
const step = control.findAll((n) => n.name === "button/Step")[k];
const t0 = Date.now();
await step.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: acts }]);
await runs[k].setReactionsAsync([{ trigger: { type: "AFTER_TIMEOUT", timeout: 1 }, actions: [{ type: "CONDITIONAL", conditionalBlocks: [
  { condition: cond, actions: [...acts, nav(runs[(k + 1) % K].id)] },
  { actions: [set(running, B(false)), nav(control.id)] },
] }] }]);
const n = (rs) => { let c = 0; const w = (l) => { for (const a of l || []) { c++; if (a.type === "CONDITIONAL") for (const b of a.conditionalBlocks) w(b.actions); } }; for (const r of rs) w(r.actions); return c; };
return { k, ms: Date.now() - t0, step: [step.id, n(step.reactions)], run: [runs[k].id, n(runs[k].reactions)] };`);
