// Dumps a program's chunked tick as compact JSON for the Figma-connector route (docs/CONNECTOR.md).
// One file per chunk, c<k>.json = { names: [variable names], acts: [[target, expr]] }, where expr is
//   true / false (a literal), a number (an index into names: a wire variable), or [FN, ...args].
// Variable ids are resolved by name inside Figma, so the files work on any file compiled from the same
// netlist. Run (see package.json "connector:chunks"):
//   npm run connector:chunks -- <program> [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { compile } from "../../src/compile";
import { cpuNetlist, PROBES } from "../../src/cpu";
import { assemble, PROGRAMS } from "../../src/isa";
import { chunkTick, DEFAULT_MAX_ACTIONS_PER_EVENT, plan } from "../../src/prototype/plan";
import { figmaActions } from "../../src/prototype/figma-actions";
import { powerOnWith } from "../../plugin/src/program";

type Compact = boolean | number | [string, ...Compact[]];
interface VarData { type: string; value: unknown }

const program = process.argv[2] ?? "ptrout";
const out = process.argv[3] ?? "tools/connector/out";
if (!PROGRAMS[program]) throw new Error(`unknown program "${program}" (have: ${Object.keys(PROGRAMS).join(", ")})`);

const net = cpuNetlist();
const asm = assemble(PROGRAMS[program]);
if (asm.errors.length) throw new Error(asm.errors.join("\n"));
const p = plan(net, compile(net, { inputs: [] }), { initial: powerOnWith(net, asm.bytes), name: "CPU", halt: PROBES.HALTED.name });
const vars = [...p.variables, ...(p.flags ?? [])];
const ref = new Map(vars.map((v) => [v.net, "@" + v.name]));
const chunking = p.chunking ?? chunkTick(p.tick, { maxActionsPerEvent: DEFAULT_MAX_ACTIONS_PER_EVENT, tickExtra: 2 });

mkdirSync(out, { recursive: true });
const sizes: Array<{ names: number; acts: number; bytes: number }> = [];
chunking.chunks.forEach((c, k) => {
  const names: string[] = [];
  const ix = new Map<string, number>();
  const id = (s: string) => {
    const n = s.slice(1);
    if (!ix.has(n)) {
      ix.set(n, names.length);
      names.push(n);
    }
    return ix.get(n)!;
  };
  const enc = (d: VarData): Compact => {
    if (d.type === "BOOLEAN") return d.value === true;
    if (d.type === "VARIABLE_ALIAS") return id((d.value as { id: string }).id);
    const e = d.value as { expressionFunction: string; expressionArguments: VarData[] };
    return [e.expressionFunction, ...e.expressionArguments.map(enc)];
  };
  const acts = figmaActions(c, ref).map((a) => {
    if (a.type !== "SET_VARIABLE") throw new Error(`chunk ${k}: a ${a.type} action; the connector route expects flat SET_VARIABLE chunks`);
    return [id(a.variableId!), enc(a.variableValue as VarData)];
  });
  const json = JSON.stringify({ names, acts });
  writeFileSync(`${out}/c${k}.json`, json);
  sizes.push({ names: names.length, acts: acts.length, bytes: json.length });
});
const halt = vars.find((v) => v.net === p.halt)?.name;
writeFileSync(`${out}/meta.json`, JSON.stringify({ program, chunks: chunking.chunks.length, halt, sizes }, null, 2));
console.log(JSON.stringify({ program, chunks: chunking.chunks.length, halt, sizes }));
