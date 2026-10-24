// The gate-level editor engine against the executable spec (src/model/reference.ts): random
// editor events, every register compared after every event, with coverage counters so a pass
// cannot be vacuous. The compiled schedule (FastSim) must also equal the golden RefSim.
import { describe, expect, it } from "vitest";
import { HOT, nathanLibrary, nathanNetlist, SCREEN_NETS, STATE_NETS } from "../src/hw";
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
      if (ev.k === "click") bump(before.drag ? `click:finish-${before.drag.mode}` : before.tool === "move" ? "click:start-move-tool" : before.tool === "pen" ? (before.penDown ? "pen:lift" : "pen:put-down") : "click:create");
      if (ev.k === "tool" && ev.t === 4) bump("tool:pen");
      if (ev.k === "tool" && before.penDown) bump("pen:left-by-tool");
      if (ev.k === "paint") bump(before.tool !== "pen" || !before.penDown || before.drag ? "paint:ignored" : spec.ink.join() === before.ink.join() ? "paint:same" : before.erase ? "paint:erased" : "paint:inked");
      if (ev.k === "clear" && before.ink.includes(1)) bump("clear:inked");
      if (spec.ink.filter((v) => v).length >= 10) bump("ink:10+ pixels");
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
    expect(blocks.map((b) => b.name)).toEqual(expect.arrayContaining(["evdec", "hit", "free", "conds", "plane", "geom", "layerctl", "newrec", "state", "pen", "paint", "disp", "l0", "l7"]));
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
    // and the pen's: strokes that ink and erase, pen clicks both ways, leaving the pen, Clear
    for (const k of ["tool:pen", "pen:put-down", "pen:lift", "pen:left-by-tool", "paint:inked", "paint:erased", "paint:same", "paint:ignored", "erase", "clear", "clear:inked", "ink:10+ pixels"])
      expect(cov[k] ?? 0, `branch ${k} was never exercised`).toBeGreaterThan(0);
  }, 120_000);

  it("draws with the pen: strokes in ink and in erase, the pen left by a tool and by Esc, Clear", () => {
    const m = new RefDriver(net);
    let spec = R.initialState();
    const hot = () => HOT[[0, 1, 2, 3, 4, 5].find((i) => m.peek(`${SCREEN_NETS.hot}[${i}]`))!];
    const pixel = (x: number, y: number) => m.peek(`${STATE_NETS.pix}[${y * R.GRID_W + x}]`);
    const inked = () => Array.from({ length: R.GRID_W * R.GRID_H }, (_, i) => m.peek(`${STATE_NETS.pix}[${i}]`)).filter((v) => v).length;
    const run = (...evs: Ev[]) => {
      for (const ev of evs) {
        spec = applyRef(spec, ev);
        m.send(ev);
        expect(compare(spec, m) ?? compareScreen(spec, m), JSON.stringify(ev)).toBeNull();
      }
    };
    // a rectangle first: the ink is drawn above it and leaves it alone
    run({ k: "tool", t: 2 }, { k: "click", x: 1, y: 1 }, { k: "click", x: 4, y: 3 });
    const rect = [m.peek(STATE_NETS.x0(0), 4), m.peek(STATE_NETS.x1(0), 4), m.peek(STATE_NETS.y0(0), 4), m.peek(STATE_NETS.y1(0), 4)];
    expect(rect).toEqual([1, 5, 1, 4]);
    run({ k: "tool", t: 4 });
    expect(hot()).toBe("pen-up");
    // hovering with the pen up inks nothing; a click puts it down and inks the cell
    run({ k: "paint", x: 0, y: 0 });
    expect(inked()).toBe(0);
    run({ k: "click", x: 2, y: 2 });
    expect([hot(), m.peek(STATE_NETS.pendown), pixel(2, 2)]).toEqual(["pen-down", 1, 1]);
    // the stroke, then a click that lifts the pen (and inks where it lands)
    run({ k: "paint", x: 3, y: 2 }, { k: "paint", x: 4, y: 3 }, { k: "paint", x: 5, y: 3 }, { k: "click", x: 6, y: 4 });
    expect([hot(), inked()]).toEqual(["pen-up", 5]);
    run({ k: "paint", x: 7, y: 4 });
    expect(pixel(7, 4)).toBe(0);
    // Erase: the same strokes ink 0
    run({ k: "erase" }, { k: "click", x: 3, y: 2 }, { k: "paint", x: 4, y: 3 }, { k: "click", x: 13, y: 9 });
    expect([pixel(3, 2), pixel(4, 3), pixel(13, 9), inked(), m.peek(STATE_NETS.erase)]).toEqual([0, 0, 0, 3, 1]);
    run({ k: "erase" }, { k: "click", x: 13, y: 9 }, { k: "paint", x: 12, y: 8 });
    expect([pixel(13, 9), pixel(12, 8), m.peek(STATE_NETS.pendown)]).toEqual([1, 1, 1]);
    // any other tool lifts the pen and leaves it; so does Esc
    run({ k: "tool", t: 0 }, { k: "paint", x: 11, y: 8 });
    expect([hot(), m.peek(STATE_NETS.pendown), pixel(11, 8)]).toEqual(["idle-move", 0, 0]);
    run({ k: "tool", t: 4 }, { k: "click", x: 0, y: 9 }, { k: "esc" }, { k: "paint", x: 1, y: 9 });
    expect([hot(), m.peek(STATE_NETS.tool, 3), pixel(0, 9), pixel(1, 9)]).toEqual(["idle-move", 0, 1, 0]);
    // the layer is where it was; Clear blanks the plane in one event
    expect([m.peek(STATE_NETS.x0(0), 4), m.peek(STATE_NETS.x1(0), 4), m.peek(STATE_NETS.y0(0), 4), m.peek(STATE_NETS.y1(0), 4)]).toEqual(rect);
    expect(inked()).toBe(6);
    run({ k: "clear" });
    expect(inked()).toBe(0);
    expect(rasterOf(readScreen(m)).join()).toBe(R.raster(spec).join());
  });

  it("the compiled schedule equals the golden simulator on every register and every net", () => {
    const a = new RefDriver(net);
    const b = new FastDriver(net);
    const rnd = prng(11);
    let spec = R.initialState();
    let strokes = 0;
    for (let i = 0; i < 1500; i++) {
      const ev = randomEvent(rnd, spec);
      if (ev.k === "paint" && spec.penDown) strokes++;
      spec = applyRef(spec, ev);
      a.send(ev);
      b.send(ev);
      if (i % 25 === 0 || i > 1490) for (let n = 0; n < net.netNames.length; n++) if (a.sim.v[n] !== b.sim.v[n]) throw new Error(`net ${net.netNames[n]} differs after event ${i} ${JSON.stringify(ev)}`);
      expect(compare(spec, b)).toBeNull();
      expect(compareScreen(spec, b)).toBeNull();
    }
    expect(strokes).toBeGreaterThan(20);
  }, 120_000);
});
