// Power-on wire values of every program in silicon's ISA, by Figma variable name, for the Make
// listener: loading a program there sets these, exactly as the CPU tab's program buttons do.
import { writeFileSync } from "node:fs";
import { compile } from "../../silicon/src/compile";
import { cpuNetlist, PROBES } from "../../silicon/src/cpu";
import { PROGRAMS } from "../../silicon/src/isa";
import { cpuPrograms } from "../../silicon/src/prototype/live";
import { plan } from "../../silicon/src/prototype/plan";

const net = cpuNetlist();
const sched = compile(net, { inputs: [] });
const programs = cpuPrograms(net, PROGRAMS);
const p = plan(net, sched, { initial: programs[0].initial as Uint8Array, name: "x", halt: PROBES.HALTED.name, maxActionsPerEvent: Infinity });
const names = p.variables.map((v) => v.name);
const out = {
  names,
  programs: Object.fromEntries(programs.map((d) => {
    let hex = "";
    for (let i = 0; i < names.length; i += 4) {
      let n = 0;
      for (let b = 0; b < 4; b++) if (d.initial[p.variables[i + b]?.net ?? -1] === 1) n |= 1 << b;
      hex += n.toString(16);
    }
    return [d.name, hex];
  })),
};
writeFileSync(process.argv[2], `export default ${JSON.stringify(out)};\n`);
console.log(`${names.length} wires, programs: ${Object.keys(out.programs).join(" ")}`);
