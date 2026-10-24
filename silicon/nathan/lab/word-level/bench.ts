import { assemble, dataMachine, blockMachine, execute } from "./cpu";
import { HIT, MOVE } from "./os";
import { costA, costB } from "./fig";
import { initialState, hitTest, reduce, State, Layer, PALETTE } from "../../../../os-ui/src/model";

const mb = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = mb(20241024); const rnd = (n: number) => Math.floor(R() * n);

function randomState(nLayers: number): State {
  const layers: Layer[] = [];
  for (let i = 0; i < nLayers; i++) {
    const w = 1 + rnd(8), h = 1 + rnd(6);
    layers.push({ id: i + 1, kind: "rect", name: "L" + i, x: rnd(15 - w), y: rnd(11 - h), w, h, fill: PALETTE[rnd(16)], visible: rnd(4) !== 0, opacity: 10, radius: 0 });
  }
  return { ...initialState(), layers, nextId: nLayers + 1 };
}
function memOf(s: State, px: number, py: number, extra: Record<number, number> = {}): number[] {
  const m = new Array(256).fill(0);
  m[0] = px; m[1] = py; m[2] = -1;
  s.layers.forEach((l, i) => { const b = 16 + 8 * i; m[b] = l.visible ? 1 : 0; m[b + 1] = l.x; m[b + 2] = l.y; m[b + 3] = l.w; m[b + 4] = l.h; m[b + 5] = PALETTE.indexOf(l.fill); m[b + 6] = i; m[b + 7] = 1; });
  for (let i = s.layers.length; i < 8; i++) m[16 + 8 * i + 6] = i;
  for (const [k, v] of Object.entries(extra)) m[+k] = v;
  return m;
}

function bench(name: string, src: string, cases: () => { mem: number[]; check: (st: Record<string, number>) => boolean; nontrivial?: boolean }) {
  const prog = assemble(src);
  const dm = dataMachine(prog), bm = blockMachine(prog);
  const rows = { data: { a: [] as number[], b: [] as number[] }, block: { a: [] as number[], b: [] as number[] } }; const bticks: number[] = [];
  let instr: number[] = [], bad = 0, N = 1500; let nontrivial = 0;
  for (let n = 0; n < N; n++) {
    const c = cases();
    const d = execute(dm.tick, c.mem), b = execute(bm.tick, c.mem);
    if (!c.check(d.st) || !c.check(b.st)) bad++; if (c.nontrivial) nontrivial++;
    instr.push(d.ticks); bticks.push(b.ticks);
    rows.data.a.push(costA(d.cost)); rows.data.b.push(costB(d.cost));
    rows.block.a.push(costA(b.cost)); rows.block.b.push(costB(b.cost));
  }
  const mean = (x: number[]) => Math.round(x.reduce((p, q) => p + q, 0) / x.length);
  const max = (x: number[]) => Math.max(...x);
  console.log(`\n== ${name}: ${prog.length} instructions, ${N} random cases, MISMATCHES vs model.ts: ${bad}  (cases with a real hit / real clamp: ${nontrivial})`);
  console.log(`   instructions executed: mean ${mean(instr)}, max ${max(instr)}`);
  console.log(`   DATA  mode (program in variables, ${dm.size} static actions): actions/event mean ${mean(rows.data.a)} max ${max(rows.data.a)}   (conservative count: mean ${mean(rows.data.b)} max ${max(rows.data.b)})   per instr ${(mean(rows.data.a) / mean(instr)).toFixed(1)}`);
  console.log(`   dispatches per event (K to unroll): mean ${mean(bticks)}, max ${max(bticks)}  => static size if unrolled K times: block ${max(bticks)*bm.size}, data ${max(instr)*dm.size}`);
  console.log(`   BLOCK mode (${bm.nBlocks} blocks, ${bm.size} static actions): actions/event mean ${mean(rows.block.a)} max ${max(rows.block.a)}   (conservative: mean ${mean(rows.block.b)} max ${max(rows.block.b)})`);
}

for (const nl of [3, 8]) {
  bench(`HIT TEST, ${nl} layers`, HIT, () => {
    const s = randomState(nl), px = rnd(14), py = rnd(10);
    const want = hitTest(s, px, py);
    const wantSlot = want ? s.layers.indexOf(want) : -1;
    return { mem: memOf(s, px, py), nontrivial: wantSlot >= 0, check: (st) => st["M2"] === wantSlot };
  });
}
bench(`DRAG MOVE`, MOVE, () => {
  let s = randomState(1 + rnd(8));
  s = { ...s, layers: s.layers.map((l) => ({ ...l, visible: true })) };
  const slot = rnd(s.layers.length), l = s.layers[slot];
  const ox = rnd(l.w), oy = rnd(l.h), px = rnd(14), py = rnd(10);
  const after = reduce({ ...s, selected: l.id, drag: { mode: "move", ox, oy } }, { t: "move", x: px, y: py });
  const nl = after.layers[slot];
  return { mem: memOf(s, px, py, { 2: slot, 5: ox, 6: oy }), nontrivial: nl.x !== Math.max(0, Math.min(14 - l.w, px - ox)) || px - ox < 0 || px - ox > 14 - l.w || py - oy < 0 || py - oy > 10 - l.h, check: (st) => st[`M${16 + 8 * slot + 1}`] === nl.x && st[`M${16 + 8 * slot + 2}`] === nl.y };
});
