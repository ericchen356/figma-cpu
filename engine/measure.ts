import { buildCells } from "../silicon/src/cells";
import { compile, FastSim, powerOn } from "../silicon/src/compile";
import { flatten } from "../silicon/src/netlist/flatten";
import { runPlanActions } from "../silicon/src/prototype";
import type { Library } from "../silicon/src/netlist/types";
import { defineUnits, defineNudge } from "./defs";
import { defineEngine, EV } from "./engine";
import { reaction, specialize } from "./react";

const mb = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = mb(2024); const rnd = (n: number) => Math.floor(R() * n);
const lib: Library = new Map(); buildCells(lib); defineUnits(lib); defineNudge(lib); defineEngine(lib);
const net = flatten(lib, "ENGINE");
const sch = compile(net, { inputs: ["PX", "PY", "EVT", "ARG"] });
console.log(`ENGINE v3: ${net.gates.length} gates`);

export const sample = (episodes = 60): Uint8Array[] => {
  const states: Uint8Array[] = [];
  let sim = new FastSim(net, sch, powerOn(net));
  const send = (evt: number, arg: number, px: number, py: number) => { sim.set("PX", px); sim.set("PY", py); sim.set("EVT", evt); sim.set("ARG", arg); sim.tick(); };
  for (let ep = 0; ep < episodes; ep++) {
    sim = new FastSim(net, sch, powerOn(net));
    send(EV.FILL, 12, 0, 0);
    for (let i = 0; i < 120; i++) {
      const r = rnd(100), px = rnd(14), py = rnd(10);
      if (r < 6) send(EV.TOOL, rnd(4), 0, 0); else if (r < 11) send(EV.FILL, rnd(16), 0, 0);
      else if (r < 32) send(EV.DOWN, 0, px, py); else if (r < 52) send(EV.MOVE, 0, px, py);
      else if (r < 60) send(EV.UP, 0, 0, 0); else if (r < 66) send(EV.SELECT, rnd(8), 0, 0); else if (r < 70) send(EV.VIS, rnd(8), 0, 0);
      else if (r < 74) send(EV.DELETE, 0, 0, 0); else if (r < 80) send(EV.DUP, 0, 0, 0); else if (r < 85) send(EV.FWD, 0, 0, 0);
      else if (r < 90) send(EV.BACK, 0, 0, 0); else if (r < 95) send(EV.NUDGE, rnd(4), 0, 0); else send(EV.HANDLE, rnd(4), px, py);
      if (i % 4 === 3) states.push(sim.v.slice());
    }
  }
  return states;
};
const states = sample(80);
const stateNets: number[] = [];
const addBus = (name: string, w: number) => { for (let i = 0; i < w; i++) stateNets.push(net.aliases.get(w === 1 ? name : `${name}[${i}]`)!); };
for (let k = 0; k < 8; k++) { addBus(`used${k}`, 1); addBus(`vis${k}`, 1); addBus(`kind${k}`, 2); for (const f of ["x0_", "y0_", "x1_", "y1_"]) addBus(`${f}${k}`, 4); addBus(`fill${k}`, 4); }
addBus("sel", 3); addBus("hassel", 1); addBus("tool", 2); addBus("cur", 4); addBus("drag", 2); addBus("r1", 4); addBus("r2", 4);
const port = (n: string) => net.ports.find((p) => p.name === n)!.nets;

export function measure(label: string, tie: Record<string, number>, code: number, argOf: () => number, filter: (S: Uint8Array) => boolean = () => true) {
  const sp = specialize(net, tie);
  const acts = reaction(sp.net);
  const execs: number[] = []; let bad = 0, n = 0;
  for (const S of states) {
    if (!filter(S)) continue;
    const arg = argOf(), px = rnd(14), py = rnd(10);
    const g = new FastSim(net, sch, S.slice());
    g.set("PX", px); g.set("PY", py); g.set("EVT", code); g.set("ARG", arg); g.tick();
    const st = new Map<number, boolean>(); for (let i = 0; i < S.length; i++) st.set(i, S[i] === 1);
    const setPort = (nm: string, val: number) => port(nm).forEach((id, i) => st.set(id, ((val >> i) & 1) === 1));
    setPort("PX", px); setPort("PY", py); setPort("ARG", arg);
    execs.push(runPlanActions(acts, st)); n++;
    for (const id of stateNets) if (st.get(id) !== (g.v[id] === 1)) { bad++; break; }
  }
  const mean = Math.round(execs.reduce((a, b) => a + b, 0) / Math.max(1, execs.length));
  console.log(`${label.padEnd(26)} gates kept ${String(sp.kept).padStart(5)}   groups live ${String(sp.groupsLive).padStart(3)}/${sp.groupsLive + sp.groupsInert}   static ${String(acts.length).padStart(5)}   EXECUTED mean ${String(mean).padStart(5)} max ${String(Math.max(...execs)).padStart(5)}   next-state vs generic: ${bad === 0 ? "identical" : bad + "/" + n + " differ"}`);
}

const bit = (S: Uint8Array, name: string) => S[net.aliases.get(name)!] === 1;

if (process.argv[1].includes("measure")) {
  console.log("--- NO dispatch (no conditional inside a conditional) ---");
  measure("DOWN (any tool)", { EVT: EV.DOWN }, EV.DOWN, () => 0);
  measure("MOVE (any drag mode)", { EVT: EV.MOVE }, EV.MOVE, () => 0);
}
if (process.argv[1].includes("measure")) {
  console.log("--- executed Figma actions per event (one reaction each; next-state checked against the full gate-level engine) ---");
  measure("TOOL", { EVT: EV.TOOL }, EV.TOOL, () => rnd(4));
  measure("FILL", { EVT: EV.FILL }, EV.FILL, () => rnd(16));
  measure("UP", { EVT: EV.UP }, EV.UP, () => 0);
  measure("SELECT", { EVT: EV.SELECT }, EV.SELECT, () => rnd(8));
  measure("HANDLE", { EVT: EV.HANDLE }, EV.HANDLE, () => rnd(4));
  measure("VIS toggle", { EVT: EV.VIS }, EV.VIS, () => rnd(8));
  measure("ESC", { EVT: EV.ESC }, EV.ESC, () => 0);
  measure("NUDGE", { EVT: EV.NUDGE }, EV.NUDGE, () => rnd(4));
  measure("DELETE", { EVT: EV.DELETE }, EV.DELETE, () => 0);
  measure("DUP", { EVT: EV.DUP }, EV.DUP, () => 0);
  measure("FWD ]", { EVT: EV.FWD }, EV.FWD, () => 0);
  measure("BACK [", { EVT: EV.BACK }, EV.BACK, () => 0);
  console.log("--- dispatch on tool / drag mode (1 extra `if`) ---");
  measure("DOWN, move tool", { EVT: EV.DOWN, is_move_tool: 1, creating: 0 }, EV.DOWN, () => 0, (S) => !bit(S, "tool[0]") && !bit(S, "tool[1]"));
  measure("DOWN, creation tool", { EVT: EV.DOWN, is_move_tool: 0, creating: 1 }, EV.DOWN, () => 0, (S) => bit(S, "tool[0]") || bit(S, "tool[1]"));
  const dg = (S: Uint8Array) => (bit(S, "drag[0]") ? 1 : 0) | (bit(S, "drag[1]") ? 2 : 0);
  measure("MOVE, drag = move", { EVT: EV.MOVE, "dragdec_Y[0]": 0, "dragdec_Y[1]": 1, "dragdec_Y[2]": 0, "dragdec_Y[3]": 0 }, EV.MOVE, () => 0, (S) => dg(S) === 1);
  measure("MOVE, drag = create/resize", { EVT: EV.MOVE, "dragdec_Y[0]": 0, "dragdec_Y[1]": 0 }, EV.MOVE, () => 0, (S) => dg(S) >= 2);
}
