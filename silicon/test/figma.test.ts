// Lane E: draw the library as Figma components on a fake Figma, read it back off the canvas
// and check it is the same circuit; then map flat gates/nets to their `lit` layers.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectBindings,
  type DrawResult,
  drawGates,
  drawLibrary,
  ensurePages,
  extract,
  ExtractError,
  formatNets,
  gateGeom,
  layoutModule,
  type ModuleLayout,
  PAGE_CELLS,
  PAGE_CPU,
  PAGE_GATES,
  parseNets,
  parsePortMarker,
  propName,
  siliconPages,
} from "../src/figma";
import { GRID, moduleGeom } from "../src/figma/layout";
import { resetFonts } from "../src/figma/style";
import { define } from "../src/hdl/builder";
import { flatten } from "../src/netlist/flatten";
import { type FlatNetlist, GATE_ARITY, GATE_TYPES, isGateCell, type Library } from "../src/netlist/types";
import { RefSim } from "../src/sim/reference";
import { FakeFigma, type FakeNode } from "./fake-figma";

/** The foundation mini library (test/foundation.test.ts): latch, flip-flop, 2-bit counter. */
function miniLib(): Library {
  const lib: Library = new Map();
  define(lib, "DLATCH", { in: { D: 1, EN: 1 }, out: { Q: 1 } }, (b) => {
    const nen = b.NOT(b.in1("EN"));
    const take = b.AND(b.in1("D"), b.in1("EN"));
    const hold = b.AND(b.out1("Q"), nen);
    b.OR(take, hold, b.out1("Q"));
  });
  define(lib, "DFF", { in: { D: 1, CLK: 1 }, out: { Q: 1 } }, (b) => {
    const nclk = b.NOT(b.in1("CLK"));
    const m = b.use("DLATCH", { D: b.in1("D"), EN: nclk }, "master").Q[0];
    b.use("DLATCH", { D: m, EN: b.in1("CLK"), Q: b.out1("Q") }, "slave");
  });
  define(lib, "COUNTER2", { in: { CLK: 1 }, out: { Q: 2 } }, (b) => {
    const [q0, q1] = b.out("Q");
    b.use("DFF", { D: b.NOT(q0), CLK: b.in1("CLK"), Q: q0 }, "b0");
    b.use("DFF", { D: b.XOR(q0, q1), CLK: b.in1("CLK"), Q: q1 }, "b1");
  });
  return lib;
}

/** Adds bus ports, constants, every gate type and a documented module. */
function busLib(): Library {
  const lib = miniLib();
  define(
    lib,
    "GATES4",
    { in: { A: 4, B: 4, S: 1 }, out: { Y: 4, ALL: 1 } },
    (b) => {
      const [a, bb, s] = [b.in("A"), b.in("B"), b.in1("S")];
      const y = b.out("Y");
      b.XOR(b.NAND(a[0], bb[0]), b.NOR(a[1], "0"), y[0]);
      b.XNOR(a[2], b.BUF(bb[2]), y[1]);
      b.OR(a[3], s, y[2]);
      b.AND(b.NOT(bb[3]), "1", y[3]);
      b.reduce("AND", y, b.out1("ALL"));
    },
    "Every gate type, a bus and constants.",
  );
  define(lib, "TOP4", { in: { X: 4, CLK: 1 }, out: { Z: 4, F: 1 } }, (b) => {
    const r = b.use("GATES4", { A: b.in("X"), B: [...b.in("X")].reverse(), S: "1", Y: b.out("Z") }, "g");
    b.use("DFF", { D: r.ALL[0], CLK: b.in1("CLK"), Q: b.out1("F") }, "ff");
  });
  return lib;
}

let fig: FakeFigma;
beforeEach(() => {
  fig = new FakeFigma(["Page 1"]);
  (globalThis as unknown as { figma: FakeFigma }).figma = fig;
  resetFonts();
});

const asFake = (n: unknown) => n as FakeNode;

async function drawAll(lib: Library, opts = {}): Promise<DrawResult> {
  return drawLibrary(lib, ensurePages(), opts);
}

/** Same gates, in the same order, on the same nets — the circuits are identical. */
function sameNetlist(a: FlatNetlist, b: FlatNetlist) {
  expect(b.gates).toEqual(a.gates);
  expect(b.netNames).toEqual(a.netNames);
  expect(b.ports).toEqual(a.ports);
  expect([...b.aliases]).toEqual([...a.aliases]);
}

describe("net lists in TEXT properties", () => {
  it("formats LSB-first lists with range shorthand and parses them back", () => {
    const cases: [string[], string][] = [
      [["CLK"], "CLK"],
      [["D[0]", "D[1]", "D[2]", "D[3]"], "D[0:3]"],
      [["Q[3]", "Q[2]", "Q[1]"], "Q[3:1]"],
      [["a", "b_Q", "0", "1"], "a, b_Q, 0, 1"],
      [["x[0]", "x[1]", "y[5]", "x[2]", "x[4]"], "x[0:1], y[5], x[2], x[4]"],
      [["s[2]"], "s[2]"],
      [["m[1]", "m[2]", "n[3]", "n[4]"], "m[1:2], n[3:4]"],
    ];
    for (const [nets, text] of cases) {
      expect(formatNets(nets)).toBe(text);
      expect(parseNets(text)).toEqual(nets);
    }
    expect(parseNets("a,b ,  c,")).toEqual(["a", "b", "c"]);
    expect(parseNets("")).toEqual([]);
    expect(propName("D#12:3")).toBe("D");
    expect(parsePortMarker("port/in/D/8")).toEqual({ name: "D", dir: "in", width: 8 });
    expect(parsePortMarker("port/sideways/D/8")).toBeNull();
  });
});

describe("gate components", () => {
  it("draws the 8 gates with symbol, pins, TEXT properties and a hidden lit layer", async () => {
    const pages = ensurePages();
    expect(fig.root.children.map((p) => p.name)).toEqual(["Page 1", PAGE_GATES, PAGE_CELLS, PAGE_CPU]);
    const gates = await drawGates(pages.gates);
    expect([...gates.keys()]).toEqual([...GATE_TYPES]);
    for (const [t, comp] of gates) {
      const c = asFake(comp);
      expect(c.type).toBe("COMPONENT");
      expect(c.name).toBe(`gate/${t}`);
      expect(c.parent?.name).toBe(PAGE_GATES);
      const ports = GATE_ARITY[t] === 1 ? ["A", "Y"] : ["A", "B", "Y"];
      expect(Object.keys(comp.componentPropertyDefinitions).map(propName)).toEqual(ports);
      for (const [key, d] of Object.entries(comp.componentPropertyDefinitions)) {
        expect(d.type).toBe("TEXT");
        const label = c.findOne((n) => n.componentPropertyReferences?.characters === key);
        expect(label?.characters).toBe(propName(key));
      }
      const names = c.children.map((n) => n.name);
      for (const p of ports) expect(names).toContain(`pin/${p}`);
      expect(names.slice(0, 3)).toEqual(["body", "leads", "lit"]);
      const lit = c.children.find((n) => n.name === "lit")!;
      expect(lit.visible).toBe(false);
      expect(lit.type).toBe("VECTOR");
      // pins match the layout geometry
      const g = gateGeom(t);
      for (const p of ports) {
        const r = c.children.find((n) => n.name === `pin/${p}`)!;
        expect([r.x + 2, r.y + 2]).toEqual([g.pins.get(p)!.x, g.pins.get(p)!.y]);
      }
    }
    // idempotent
    const again = await drawGates(pages.gates);
    expect([...again.values()]).toEqual([...gates.values()]);
    expect(asFake(pages.gates).children).toHaveLength(8);
  });

  it("follows Figma's rules: fonts loaded, colors 0–1, no notify", async () => {
    // the fake throws on all of these; drawing everything must not trip them
    await drawAll(busLib());
    expect(fig.writes).toBeGreaterThan(0);
  });
});

describe("draw → extract round trip", () => {
  it("rebuilds the foundation library exactly", async () => {
    const lib = miniLib();
    const res = await drawAll(lib);
    expect([...res.cells.keys()]).toEqual(["DLATCH", "DFF", "COUNTER2"]);
    expect(res.reused).toEqual([]);
    const back = await extract(siliconPages());
    expect(back).toEqual(lib);
    expect([...back.keys()]).toEqual([...lib.keys()]);
    for (const [name, def] of lib) {
      expect(back.get(name)!.ports).toEqual(def.ports);
      expect(back.get(name)!.instances.map((i) => i.name)).toEqual(def.instances.map((i) => i.name));
    }
  });

  it("the extracted circuit simulates identically", async () => {
    const lib = miniLib();
    await drawAll(lib);
    const back = await extract(siliconPages());
    for (const top of lib.keys()) sameNetlist(flatten(lib, top), flatten(back, top));
    const sim = new RefSim(flatten(back, "COUNTER2"));
    const seen = [];
    for (let i = 0; i < 6; i++) {
      sim.tick();
      seen.push(sim.get("Q"));
    }
    expect(seen).toEqual([1, 2, 3, 0, 1, 2]);
  });

  it("round-trips buses, constants, docs and every gate type; uses range shorthand", async () => {
    const lib = busLib();
    const res = await drawAll(lib);
    expect(await extract(siliconPages())).toEqual(lib);
    // the instance g in TOP4 shows bus connections compactly
    const top = asFake(res.cells.get("TOP4"));
    const g = top.children.find((n) => n.name === "g")!;
    const props = Object.fromEntries(Object.entries(g.componentProperties).map(([k, v]) => [propName(k), v.value]));
    expect(props).toEqual({ A: "X[0:3]", B: "X[3:0]", S: "1", Y: "Z[0:3]", ALL: "g_ALL" });
    // the main component's own properties name its port bits
    const defs = Object.entries(res.cells.get("GATES4")!.componentPropertyDefinitions).map(([k, d]) => [propName(k), d.defaultValue]);
    expect(defs).toEqual([
      ["A", "A[0:3]"],
      ["B", "B[0:3]"],
      ["S", "S"],
      ["Y", "Y[0:3]"],
      ["ALL", "ALL"],
    ]);
    expect(res.cells.get("GATES4")!.description).toBe("Every gate type, a bus and constants.");
    // bound net labels on the instance's port markers show its connections
    const aNet = g.findOne((n) => n.pathNames.slice(-2).join("|") === "port/in/A/4|net")!;
    expect(aNet.characters).toBe("X[0:3]");
  });

  it("ignores geometry: moving every layer changes nothing", async () => {
    const lib = busLib();
    await drawAll(lib);
    let k = 0;
    for (const p of siliconPages()) for (const n of asFake(p).findAll((x) => !x.inInstance)) n.x = (k = (k * 7919 + 13) % 5000);
    expect(await extract(siliconPages())).toEqual(lib);
  });

  it("reads edits made on the canvas: properties are the wiring", async () => {
    const lib = miniLib();
    const res = await drawAll(lib);
    const counter = asFake(res.cells.get("COUNTER2"));
    const xor = counter.children.find((n) => n.name === "xor1")!;
    const keyB = Object.keys(xor.componentProperties).find((k) => propName(k) === "B")!;
    xor.setProperties({ [keyB]: "1" }); // D1 = q0 XOR 1 = ¬q0
    const back = await extract(siliconPages());
    expect(back.get("COUNTER2")!.instances.find((i) => i.name === "xor1")!.conn.B).toEqual(["1"]);
    const sim = new RefSim(flatten(back, "COUNTER2"));
    const seen = [];
    for (let i = 0; i < 4; i++) {
      sim.tick();
      seen.push(sim.get("Q"));
    }
    expect(seen).toEqual([3, 0, 3, 0]);
    // renaming an instance renames it in the netlist
    xor.name = "x9";
    const renamed = await extract(siliconPages());
    expect(flatten(renamed, "COUNTER2").gates.some((g) => g.path === "x9")).toBe(true);
  });

  it("reports wiring mistakes clearly", async () => {
    const lib = miniLib();
    const res = await drawAll(lib);
    const dff = asFake(res.cells.get("DFF"));
    const master = dff.children.find((n) => n.name === "master")!;
    const keyD = Object.keys(master.componentProperties).find((k) => propName(k) === "D")!;
    master.setProperties({ [keyD]: "a, b" });
    await expect(extract(siliconPages())).rejects.toThrow(ExtractError);
    await expect(extract(siliconPages())).rejects.toThrow(/cell\/DFF › master: D needs 1 net, got 2/);
  });

  it("reuses existing components on a second draw and replaces them with redraw", async () => {
    const lib = busLib();
    await drawAll(lib);
    await fig.loadAllPagesAsync();
    const before = fig.allNodes().length;
    const again = await drawAll(lib);
    expect(again.reused).toEqual([...lib.keys()]);
    expect(fig.allNodes().length).toBe(before);
    const redrawn = await drawAll(lib, { redraw: true });
    expect(redrawn.reused).toEqual([]);
    expect(fig.allNodes().length).toBe(before);
    expect(await extract(siliconPages())).toEqual(lib);
  });

  it("puts the CPU module on the CPU page", async () => {
    const lib = miniLib();
    const res = await drawAll(lib, { cpuModule: "COUNTER2" });
    expect(asFake(res.cells.get("COUNTER2")).parent?.name).toBe(PAGE_CPU);
    expect(asFake(res.cells.get("DFF")).parent?.name).toBe(PAGE_CELLS);
    expect(await extract(siliconPages())).toEqual(lib);
  });

  it("big modules fall back to net labels and still round-trip", async () => {
    const lib = miniLib();
    define(lib, "WIDE", { in: { A: 32, B: 32 }, out: { Y: 1 } }, (b) => {
      const x = b.in("A").map((a, i) => b.XOR(a, b.in("B")[i]));
      b.reduce("OR", x, b.out1("Y"));
    });
    const res = await drawAll(lib);
    const L = res.layouts.get("WIDE")!;
    expect(L.mode).toBe("labels");
    expect(L.wires).toEqual([]);
    expect(asFake(res.cells.get("WIDE")).findOne((n) => n.name.startsWith("wire/"))).toBeNull();
    expect(await extract(siliconPages())).toEqual(lib);
  });
});

describe("bindings for the prototype compiler", () => {
  it("finds a lit layer for every gate of the flat netlist", async () => {
    const lib = busLib();
    const res = await drawAll(lib);
    for (const top of ["DLATCH", "DFF", "COUNTER2", "TOP4"]) {
      const net = flatten(lib, top);
      const b = collectBindings(res.cells.get(top)!, net);
      expect(b.missing).toEqual([]);
      expect(b.gateLit.size).toBe(net.gates.length);
      const nodes = new Set([...b.gateLit.values()]);
      expect(nodes.size).toBe(net.gates.length);
      for (const [i, lit] of b.gateLit) {
        const n = asFake(lit);
        expect(n.name).toBe("lit");
        expect(n.visible).toBe(false);
        // the layer chain under the top component spells the gate's flat path
        expect(n.pathNames.slice(1, -1).join("/")).toBe(net.gates[i].path);
      }
    }
  });

  it("maps wire highlights to flat nets, scope by scope", async () => {
    const lib = miniLib();
    const res = await drawAll(lib);
    const net = flatten(lib, "COUNTER2");
    const b = collectBindings(res.cells.get("COUNTER2")!, net);
    // every wire drawn in every module scope shows up under the right flat net
    const expected = new Map<number, string[]>();
    const scopes = (module: string, prefix: string) => {
      for (const w of res.layouts.get(module)!.wires) {
        const id = net.aliases.get(prefix + w.net)!;
        expected.set(id, [...(expected.get(id) ?? []), prefix + w.net]);
      }
      for (const i of lib.get(module)!.instances) if (!isGateCell(i.cell)) scopes(i.cell, `${prefix}${i.name}/`);
    };
    scopes("COUNTER2", "");
    expect(expected.size).toBeGreaterThan(5);
    expect(new Set(b.wireLit.keys())).toEqual(new Set(expected.keys()));
    for (const [id, layers] of b.wireLit) {
      expect(layers.length).toBe(expected.get(id)!.length);
      for (const l of layers) {
        expect(l.visible).toBe(false);
        expect(l.name).toMatch(/^wire\/.+\/lit$/);
      }
    }
    // e.g. the latch's hold wire inside b1 › master
    const hold = net.aliases.get("b1/master/hold");
    if (expected.has(hold!)) expect(b.wireLit.get(hold!)!.map((l) => asFake(l).pathNames.join("/"))).toEqual(["cell/COUNTER2/b1/master/wires/wire/hold/lit"]);
  });
});

/** Geometry checks that keep the drawings readable: no overlaps, orthogonal wires that end on
 * pins and never cross a part. */
function checkLayout(L: ModuleLayout) {
  const rects = L.instances.map((i) => ({ x0: i.x, y0: i.y, x1: i.x + i.geom.w, y1: i.y + i.geom.h, name: i.def.name }));
  for (let a = 0; a < rects.length; a++)
    for (let b = a + 1; b < rects.length; b++) {
      const [p, q] = [rects[a], rects[b]];
      const overlap = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
      expect(overlap, `${L.name}: ${p.name} overlaps ${q.name}`).toBe(false);
    }
  for (const r of rects) expect(r.x0 >= 0 && r.y0 >= 0 && r.x1 <= L.w && r.y1 <= L.h, `${L.name}: ${r.name} outside`).toBe(true);
  const pins = new Set<string>();
  for (const i of L.instances) for (const [, p] of i.geom.pins) pins.add(`${i.x + p.x},${i.y + p.y}`);
  for (const p of L.geom.pins.values()) pins.add(`${p.dir === "in" ? 16 : L.w - 16},${p.y}`);
  for (const w of L.wires) {
    expect(w.paths.length).toBeGreaterThan(0);
    for (const path of w.paths) {
      expect(pins.has(`${path[0].x},${path[0].y}`), `${L.name}: wire ${w.net} starts off a pin`).toBe(true);
      for (let k = 1; k < path.length; k++) {
        const [a, b] = [path[k - 1], path[k]];
        expect(a.x === b.x || a.y === b.y, `${L.name}: wire ${w.net} has a diagonal`).toBe(true);
        expect(a.x % GRID === 0 && a.y % GRID === 0).toBe(true);
        // a segment may touch a part's edge only at a pin, never run through its inside
        for (const r of rects) {
          const sx0 = Math.min(a.x, b.x);
          const sx1 = Math.max(a.x, b.x);
          const sy0 = Math.min(a.y, b.y);
          const sy1 = Math.max(a.y, b.y);
          const inside = sx0 < r.x1 && sx1 > r.x0 && sy0 < r.y1 && sy1 > r.y0;
          expect(inside, `${L.name}: wire ${w.net} crosses ${r.name}`).toBe(false);
        }
      }
    }
  }
}

describe("layout", () => {
  it("wires the small cells completely, cleanly", async () => {
    const lib = busLib();
    const res = await drawAll(lib);
    for (const [name, L] of res.layouts) {
      checkLayout(L);
      expect(L.mode).toBe("wires");
      expect(L.labeled, `${name} has unrouted nets`).toEqual([]);
    }
    // the latch: NOT and the D·EN AND first, the hold AND next, the OR last
    const latch = res.layouts.get("DLATCH")!;
    const col = Object.fromEntries(latch.instances.map((i) => [i.def.name, i.col]));
    expect(col).toEqual({ not1: 0, and1: 0, and2: 1, or1: 2 });
  });

  it("module geometry matches the drawn port markers", async () => {
    const lib = busLib();
    const res = await drawAll(lib);
    for (const [name, L] of res.layouts) {
      const comp = asFake(res.cells.get(name));
      expect([comp.width, comp.height]).toEqual([L.w, L.h]);
      const ys = L.ports.map((p) => comp.children.find((c) => c.name === `port/${p.def.dir}/${p.def.name}/${p.def.width}`)!.y);
      expect(moduleGeom(lib.get(name)!.ports, L.w, L.h, ys).pins).toEqual(L.geom.pins);
    }
  });

  it("lays out a module without instances", () => {
    const L = layoutModule({ name: "EMPTY", ports: [{ name: "A", dir: "in", width: 2 }], instances: [] }, () => {
      throw new Error("no cells");
    });
    expect(L.w).toBeGreaterThan(0);
    expect(L.geom.pins.get("A[1]")).toEqual({ x: 0, y: L.ports[0].y + 40, dir: "in" });
  });
});

// The real cell library (lane B), once it exists.
const cellsIndex = join(__dirname, "..", "src", "cells", "index.ts");
describe.skipIf(!existsSync(cellsIndex))("full cell library", () => {
  it("draws, extracts and simulates the whole cell library identically", async () => {
    const mod = (await import(/* @vite-ignore */ cellsIndex)) as { buildCells: (lib: Library) => void };
    const lib: Library = new Map();
    mod.buildCells(lib);
    const res = await drawAll(lib);
    for (const L of res.layouts.values()) checkLayout(L);
    const back = await extract(siliconPages());
    expect(back).toEqual(lib);
    for (const top of lib.keys()) {
      const a = flatten(lib, top);
      sameNetlist(a, flatten(back, top));
      const b = collectBindings(res.cells.get(top)!, a);
      expect(b.missing, top).toEqual([]);
    }
  });
});

// The whole CPU (lanes D1/D2), once it exists: the canvas the prototype compiler binds to.
const cpuFile = join(__dirname, "..", "src", "cpu", "cpu.ts");
describe.skipIf(!existsSync(cpuFile))("whole CPU", () => {
  it("draws the CPU on its page, extracts it exactly and binds every gate", async () => {
    const mod = (await import(/* @vite-ignore */ cpuFile)) as { cpuLibrary: () => Library };
    const lib = mod.cpuLibrary();
    const res = await drawAll(lib);
    expect(asFake(res.cells.get("CPU")).parent?.name).toBe(PAGE_CPU);
    for (const L of res.layouts.values()) {
      checkLayout(L);
      if (L.mode === "wires") expect(L.labeled, `${L.name} has unrouted nets`).toEqual([]);
    }
    const back = await extract(siliconPages());
    expect(back).toEqual(lib);
    const net = flatten(lib, "CPU");
    sameNetlist(net, flatten(back, "CPU"));
    const b = collectBindings(res.cells.get("CPU")!, net);
    expect(b.missing).toEqual([]);
    expect(b.gateLit.size).toBe(net.gates.length);
    expect(b.wireLit.size).toBeGreaterThan(net.netNames.length / 2);
  });
});
