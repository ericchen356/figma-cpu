// The gate-level editor engine against the executable spec (src/model/reference.ts): random
// editor events, every register compared after every event, with coverage counters so a pass
// cannot be vacuous. The compiled schedule (FastSim) must also equal the golden RefSim.
import { describe, expect, it } from "vitest";
import { nathanLibrary, nathanNetlist } from "../src/hw";
import { applyRef, compare, type Ev, prng, randomEvent } from "../src/model/oracle";
import * as R from "../src/model/reference";
import { compareScreen, rasterOf, readScreen } from "../src/model/screen";
import { FastDriver, RefDriver } from "./driver";

const lib = nathanLibrary();
const net = nathanNetlist(lib);

/** Runs `episodes` fresh machines of `len` random events; returns coverage and the first mismatch. */
function fuzz(seed: number, episodes: number, len: number, mk: () => { send(ev: Ev): void; peek(n: string, w?: number): number }) {
  const rnd = prng(seed);
  const cov: Record<string, number> = {};
  const bump = (k: string) => (cov[k] = (cov[k] ?? 0) + 1);
  for (let ep = 0; ep < episodes; ep++) {
    const m = mk();
    let spec = R.initialState();
    // every other episode starts with a full stack, so "when full" branches are reached
    const warm: Ev[] = [];
    if (ep % 2 === 0)
      for (let k = 0; k < R.MAX_LAYERS; k++) warm.push({ k: "tool", t: 1 + rnd(3) }, { k: "click", x: rnd(R.GRID_W), y: rnd(R.GRID_H) }, { k: "click", x: rnd(R.GRID_W), y: rnd(R.GRID_H) });
    for (let i = 0; i < len + warm.length; i++) {
      const ev = i < warm.length ? warm[i] : randomEvent(rnd, spec);
      const before = spec;
      spec = applyRef(spec, ev);
      m.send(ev);
      // coverage of the interesting branches
      bump(ev.k);
      if (ev.k === "click") bump(before.drag ? `click:finish-${before.drag.mode}` : before.tool === "move" ? "click:start-move-tool" : "click:create");
      if (ev.k === "down" && before.tool !== "move") bump(before.layers.length >= R.MAX_LAYERS ? "create-when-full" : "create");
      if (ev.k === "dup" && before.selected !== null) bump(before.layers.length >= R.MAX_LAYERS ? "dup-when-full" : "dup-ok");
      if (ev.k === "delete" && before.selected !== null) bump("delete-selected");
      if ((ev.k === "fwd" || ev.k === "back") && before.selected !== null && spec.layers.map((l) => l.id).join() !== before.layers.map((l) => l.id).join()) bump("reorder-moved");
      const err = compare(spec, m) ?? compareScreen(spec, m) ?? (rasterOf(readScreen(m)).join() === R.raster(spec).join() ? null : "the picture drawn by the screen wiring differs from the spec's");
      if (err) return { cov, error: `seed ${seed} episode ${ep} event ${i} (${JSON.stringify(ev)}): ${err}` };
    }
  }
  return { cov, error: null as string | null };
}

describe("CPU NATHAN hardware", () => {
  it("is a hierarchy of readable modules, all gates", () => {
    expect(lib.has("ENGINE")).toBe(true);
    const top = lib.get("ENGINE")!;
    // the top level is a block diagram: a dozen instances plus a handful of glue gates
    const blocks = top.instances.filter((i) => !i.cell.startsWith("gate/"));
    expect(blocks.map((b) => b.name)).toEqual(expect.arrayContaining(["evdec", "hit", "free", "conds", "plane", "geom", "layerctl", "newrec", "state", "disp", "l0", "l7"]));
    expect(net.gates.length).toBeGreaterThan(4000);
    expect(net.gates.length).toBeLessThan(7000);
    expect(net.gates.every((g) => ["AND", "OR", "NOT", "BUF", "NOR", "XOR", "XNOR", "NAND"].includes(g.type))).toBe(true);
  });

  it("matches the editor spec on random events (golden simulator)", () => {
    const { cov, error } = fuzz(7, 40, 120, () => new RefDriver(net));
    expect(error).toBeNull();
    // every branch was actually exercised
    for (const k of ["tool", "fill", "down", "move", "up", "select", "handle", "vis", "delete", "dup", "fwd", "back", "nudge", "esc", "click", "click:start-move-tool", "click:create", "click:finish-move", "click:finish-create", "click:finish-resize", "create-when-full", "dup-ok", "dup-when-full", "delete-selected", "reorder-moved"])
      expect(cov[k] ?? 0, `branch ${k} was never exercised`).toBeGreaterThan(0);
  }, 120_000);

  it("the compiled schedule equals the golden simulator on every register and every net", () => {
    const a = new RefDriver(net);
    const b = new FastDriver(net);
    const rnd = prng(11);
    let spec = R.initialState();
    for (let i = 0; i < 1500; i++) {
      const ev = randomEvent(rnd, spec);
      spec = applyRef(spec, ev);
      a.send(ev);
      b.send(ev);
      if (i % 25 === 0 || i > 1490) for (let n = 0; n < net.netNames.length; n++) if (a.sim.v[n] !== b.sim.v[n]) throw new Error(`net ${net.netNames[n]} differs after event ${i} ${JSON.stringify(ev)}`);
      expect(compare(spec, b)).toBeNull();
      expect(compareScreen(spec, b)).toBeNull();
    }
  }, 120_000);
});
