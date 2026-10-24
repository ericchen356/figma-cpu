import { buildCells } from "../silicon/src/cells";
import { flatten } from "../silicon/src/netlist/flatten";
import type { Library } from "../silicon/src/netlist/types";
import type { PlanAction } from "../silicon/src/prototype/types";
import { defineUnits, defineNudge } from "./defs";
import { defineEngine, EV } from "./engine";
import { reaction, specialize } from "./react";
const lib: Library = new Map(); buildCells(lib); defineUnits(lib); defineNudge(lib); defineEngine(lib);
const net = flatten(lib, "ENGINE");
const count = (a: PlanAction[]): number => a.reduce((n, x) => n + ("set" in x ? 1 : 1 + count(x.then) + count(x.else ?? [])), 0);
const depth = (a: PlanAction[]): number => a.reduce((d, x) => Math.max(d, "set" in x ? 0 : 1 + depth(x.then)), 0);
let total = 0;
for (const [nm, code] of Object.entries(EV).filter(([, v]) => v > 0)) {
  const acts = reaction(specialize(net, { EVT: code }).net);
  total += count(acts);
  console.log(nm.padEnd(8), "static actions", String(count(acts)).padStart(5), " conditional nesting depth", depth(acts));
}
console.log("all 14 reactions together:", total, "static actions");
const all = flatten(lib, "ENGINE");
console.log("variables (nets):", all.netNames.length, " gates:", all.gates.length);
