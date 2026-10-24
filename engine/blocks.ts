import { buildCells } from "../silicon/src/cells";
import { flatten } from "../silicon/src/netlist/flatten";
import type { Library } from "../silicon/src/netlist/types";
import { defineNudge, defineUnits } from "./defs";
import { defineEngine } from "./engine";
const lib: Library = new Map(); buildCells(lib); defineUnits(lib); defineNudge(lib); defineEngine(lib);
const net = flatten(lib, "ENGINE");
const by: Record<string, number> = {};
for (const g of net.gates) { const k = g.path.split("/")[0].replace(/^l\d+_/, "layer_"); by[k] = (by[k] ?? 0) + 1; }
const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
const big = rows.filter(([, v]) => v >= 40);
console.log("total", net.gates.length);
for (const [k, v] of big) console.log(k.padEnd(14), v);
console.log("other (", rows.length - big.length, "small blocks )", rows.filter(([, v]) => v < 40).reduce((a, [, v]) => a + v, 0));
