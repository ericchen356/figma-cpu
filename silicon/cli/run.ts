// Local runner: assembles a program and runs the gate-level CPU on FastSim, no Figma involved.
// Usage: npm run cpu -- <program|file.asm> [--ticks] [--max N]
import { readFileSync } from "node:fs";
import { FastSim } from "../src/compile";
import { cpuNetlist } from "../src/cpu/cpu";
import { PROBES, readProbes, readRam } from "../src/cpu/probes";
import { assemble, OPCODES, PROGRAMS, RAM_BYTES } from "../src/isa";
import { powerOnWith } from "../plugin/src/program";

const args = process.argv.slice(2);
const every = args.includes("--ticks");
const mi = args.indexOf("--max");
const max = mi >= 0 ? Number(args[mi + 1]) : 5000;
const name = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--max");
if (!name) {
  console.log(`usage: npm run cpu -- <program|file.asm> [--ticks] [--max N]\nprograms: ${Object.keys(PROGRAMS).join(", ")}`);
  process.exit(1);
}
const source = PROGRAMS[name] ?? readFileSync(name, "utf8");
const asm = assemble(source);
if (asm.errors.length) {
  for (const e of asm.errors) console.error(`line ${e.line}: ${e.msg}`);
  process.exit(1);
}

const hex = (v: number, w = 2) => v.toString(16).toUpperCase().padStart(w, "0");
const net = cpuNetlist();
const sim = new FastSim(net, undefined, powerOnWith(net, asm.bytes));
console.log(`${name}: ${asm.bytes.length} bytes → ${net.gates.length} gates`);
console.log("RAM  ", asm.bytes.map((b) => hex(b)).join(" "));

const line = (tick: number) => {
  const p = readProbes(sim);
  const op = OPCODES[p.IR >> 4]?.mnem ?? "?";
  const flags = `${p.Z ? "Z" : "-"}${p.C ? "C" : "-"}${p.N ? "N" : "-"}`;
  console.log(
    `t${String(tick).padStart(4)} T${p.T} PC=${hex(p.PC, 1)} IR=${hex(p.IR)}(${op.padEnd(4)}) R0-3=${[p.R0, p.R1, p.R2, p.R3].map((r) => hex(r)).join(" ")} ${flags} OUT=${hex(p.OUT)}${p.HALTED ? " HALTED" : ""}`,
  );
};

let tick = 0;
while (tick < max && !readProbes(sim).HALTED) {
  sim.pass(0);
  sim.pass(1);
  tick++;
  if (every || readProbes(sim).T === 0) line(tick);
}
const p = readProbes(sim);
console.log(p.HALTED ? `halted after ${tick} ticks` : `stopped at ${tick} ticks (not halted)`);
console.log(`OUT = ${p.OUT} (0x${hex(p.OUT)})`);
console.log("RAM  ", Array.from({ length: RAM_BYTES }, (_, a) => hex(readRam(sim, a))).join(" "));
void PROBES;
