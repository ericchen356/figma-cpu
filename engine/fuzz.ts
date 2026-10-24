import { buildCells } from "../silicon/src/cells";
import { flatten } from "../silicon/src/netlist/flatten";
import { RefSim } from "../silicon/src/sim/reference";
import type { Library } from "../silicon/src/netlist/types";
import { defineUnits, defineNudge } from "./defs";
import { defineEngine, EV } from "./engine";
import { initialState, reduce, PALETTE, State, Action, Tool, MAX_LAYERS } from "../os-ui/src/model";

const mb = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = mb(Number(process.argv[2] ?? 99)); const rnd = (n: number) => Math.floor(R() * n);

const lib: Library = new Map();
buildCells(lib); defineUnits(lib); defineNudge(lib); defineEngine(lib);
const net = flatten(lib, "ENGINE");
console.log(`ENGINE: ${net.gates.length} gates`);
let sim = new RefSim(net);
const boot = () => { sim = new RefSim(net); sim.set("CLK", 1); sim.set("PX", 0); sim.set("PY", 0); sim.set("EVT", 0); sim.set("ARG", 0); sim.settle(); };
boot();
const send = (evt: number, arg = 0, px = 0, py = 0) => { sim.set("PX", px); sim.set("PY", py); sim.set("EVT", evt); sim.set("ARG", arg); sim.settle(); sim.tick(); };

const TOOLS: Tool[] = ["move", "frame", "rect", "ellipse"];
const DRAGS = [null, "move", "create", "resize"];
function compare(m: State): string | null {
  const used = Array.from({ length: 8 }, (_, k) => sim.peek(`used${k}`));
  const n = m.layers.length;
  for (let k = 0; k < 8; k++) if (used[k] !== (k < n ? 1 : 0)) return `used pattern ${used.join("")} vs ${n} layers`;
  for (let k = 0; k < n; k++) {
    const l = m.layers[k];
    const got = [sim.peek(`x0_${k}`, 4), sim.peek(`x1_${k}`, 4), sim.peek(`y0_${k}`, 4), sim.peek(`y1_${k}`, 4), sim.peek(`fill${k}`, 4), sim.peek(`kind${k}`, 2), sim.peek(`vis${k}`)];
    const want = [l.x, l.x + l.w, l.y, l.y + l.h, PALETTE.indexOf(l.fill), ["frame", "rect", "ellipse"].indexOf(l.kind) + 1, l.visible ? 1 : 0];
    if (got.join() !== want.join()) return `layer ${k}: got ${got} want ${want}`;
  }
  const selWant = m.selected === null ? -1 : m.layers.findIndex((l) => l.id === m.selected);
  const selGot = sim.peek("hassel") ? sim.peek("sel", 3) : -1;
  if (selGot !== selWant) return `selected got ${selGot} want ${selWant}`;
  if (sim.peek("tool", 2) !== TOOLS.indexOf(m.tool)) return `tool got ${sim.peek("tool", 2)} want ${m.tool}`;
  if (sim.peek("cur", 4) !== PALETTE.indexOf(m.fill)) return `fill got ${sim.peek("cur", 4)} want ${PALETTE.indexOf(m.fill)}`;
  const dm = m.drag?.mode ?? null;
  if (DRAGS[sim.peek("drag", 2)] !== dm) return `drag got ${DRAGS[sim.peek("drag", 2)]} want ${dm}`;
  return null;
}


const cov: Record<string, number> = {};
const hit = (k: string) => (cov[k] = (cov[k] ?? 0) + 1);
let fail = 0, total = 0;
const EPISODES = Number(process.argv[3] ?? 40), LEN = Number(process.argv[4] ?? 150);
for (let ep = 0; ep < EPISODES && fail < 3; ep++) {
  boot();
  let m: State = initialState();
  send(EV.FILL, 12); m = reduce(m, { t: "fill", color: PALETTE[12] });
  for (let i = 0; i < LEN && fail < 3; i++) {
    const r = rnd(100);
    let name = "", a: Action | null = null;
    const px = rnd(14), py = rnd(10);
    const nL = m.layers.length;
    if (r < 6) { const t = rnd(4); name = "tool"; send(EV.TOOL, t); a = { t: "tool", tool: TOOLS[t] }; }
    else if (r < 11) { const c = rnd(16); name = "fill"; send(EV.FILL, c); a = { t: "fill", color: PALETTE[c] }; if (m.selected !== null) hit("fill-with-selection"); }
    else if (r < 32) {
      name = "down"; send(EV.DOWN, 0, px, py); a = { t: "down", x: px, y: py };
      if (m.tool !== "move") hit(m.layers.length >= MAX_LAYERS ? "create-when-full" : `create-${m.tool}`); else hit("down-move-tool");
    }
    else if (r < 56) { name = "move"; send(EV.MOVE, 0, px, py); a = { t: "move", x: px, y: py }; if (m.drag && m.selected !== null) hit(`drag-${m.drag.mode}`); }
    else if (r < 66) { name = "up"; send(EV.UP); a = { t: "up" }; if (m.drag?.mode === "create") hit("up-after-create"); }
    else if (r < 70 && nL) { const k = rnd(nL); name = "select"; send(EV.SELECT, k); a = { t: "select", id: m.layers[k].id }; }
    else if (r < 74 && nL) { const k = rnd(nL); name = "vis"; send(EV.VIS, k); a = { t: "visible", id: m.layers[k].id }; hit("visible-toggle"); }
    else if (r < 78) { name = "delete"; send(EV.DELETE); a = { t: "key", key: "Delete" }; if (m.selected !== null) hit("delete-selected"); }
    else if (r < 82) { name = "dup"; send(EV.DUP); a = { t: "key", key: "d", meta: true }; if (m.selected !== null) hit(nL >= MAX_LAYERS ? "dup-when-full" : "dup"); }
    else if (r < 86) { name = "fwd"; send(EV.FWD); a = { t: "key", key: "]" }; if (m.selected !== null) hit("reorder-fwd"); }
    else if (r < 90) { name = "back"; send(EV.BACK); a = { t: "key", key: "[" }; if (m.selected !== null) hit("reorder-back"); }
    else if (r < 94) { const d = rnd(4); name = "nudge"; send(EV.NUDGE, d); a = { t: "key", key: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"][d] }; if (m.selected !== null) hit("nudge"); }
    else if (r < 96) { name = "esc"; send(EV.ESC); a = { t: "key", key: "Escape" }; }
    else if (m.selected !== null) { const c = rnd(4); name = "handle"; send(EV.HANDLE, c, px, py); a = { t: "down", x: px, y: py, handle: (["se", "sw", "ne", "nw"] as const)[c] }; hit("handle"); }
    else continue;
    const before = m;
    m = reduce(m, a!);
    if (name === "down" && before.tool === "move" && m.selected !== null && m.selected !== before.selected) hit("grab-new-selection");
    if (name === "down" && before.tool === "move" && m.selected === null) hit("down-miss");
    total++;
    const err = compare(m);
    if (err) { fail++; console.log(`MISMATCH ep ${ep} event #${i} (${name}): ${err}`); }
  }
}
console.log(`fuzz: ${total} events in ${EPISODES} episodes vs model.ts, MISMATCHES: ${fail}`);
console.log("coverage:", cov);
