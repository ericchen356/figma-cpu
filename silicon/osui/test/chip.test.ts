// The os-ui chip as the Figma OS runs it (src/cpu): the same machine as osflow's synthesized
// editor after the register swap, a screen decode that shows what the registers hold, and NATHAN's
// per-event reactions computing exactly what one clock tick computes.
import { describe, expect, it } from "vitest";
import { decodeRegister, GateMachine } from "../../../osflow/src/gates/machine";
import { synthesize as osflowSynth } from "../../../osflow/src/gates/synthesize";
import { buildEditor } from "../../../osflow/src/editor";
import { compile, FastSim } from "../../src/compile";
import { netId } from "../../src/netlist/flatten";
import type { FlatNetlist } from "../../src/netlist/types";
import { runPlanActions } from "../../src/prototype/interpret";
import { synthesize } from "../../nathan/src/react/synth";
import {
  osuiChip,
  osuiNetlist,
  osuiPowerOn,
  type OsuiChip,
} from "../src/cpu/chip";
import { KINDS, OFFSET, SLOTS, type Line, type Num } from "../src/cpu/disp";
import { PICK_GROUPS, PICK_NAMES, type PickGroup } from "../src/cpu/pick";

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
  };
}

const chip: OsuiChip = osuiChip();
const net: FlatNetlist = osuiNetlist(chip);
const init = osuiPowerOn(net, chip);
const schedule = compile(net);
const ids = [...chip.syn.codes.keys()];
const regIds = new Map(
  [...chip.syn.regs].map(([name, r]) => [
    name,
    r.nets.map((n) => netId(net, n)),
  ]),
);
const read = (v: ArrayLike<number>, name: string) =>
  decodeRegister(chip.syn.regs.get(name)!, regIds.get(name)!, v);
/** The toolbar memory's registers, which osflow's editor does not have. */
const pickIds = PICK_NAMES.map(
  (g) =>
    [`pick/${g}`, chip.picks[g].nets.map((n) => netId(net, n))] as [
      string,
      number[],
    ],
);

/** A random event as osflow's GateMachine takes it. */
function randomEvent(r: ReturnType<typeof rng>) {
  // canvas events often, so layers get made and moved
  const id =
    r.int(3) === 0
      ? r.pick(["pointer#down", "pointer#enter", "pointer#up"])
      : r.pick(ids);
  const inputs: Record<string, number> = id.startsWith("pointer#")
    ? { "in/px": r.int(16), "in/py": r.int(16) }
    : {};
  return { id, inputs };
}

function fire(sim: FastSim, id: string, inputs: Record<string, number>) {
  for (const [k, v] of Object.entries(inputs))
    sim.set(chip.syn.inputs.get(k)!.port, v);
  sim.set("EVT", chip.syn.codes.get(id)!);
  sim.tick();
}

const lineValue = (v: ArrayLike<number>, l: Line) =>
  "k" in l ? l.k : v[netId(net, l.net)];
const numberShown = (v: ArrayLike<number>, n: Num) => {
  let s = "";
  for (let d = n.digits.length - 1; d >= 0; d--) {
    const dig = n.digits[d];
    if (!lineValue(v, dig.show)) continue;
    const bits = dig.bits.map((b) => lineValue(v, b));
    s += String(bits.reduce((a, b, i) => a + (b << i), 0));
  }
  return (n.neg && lineValue(v, n.neg) ? "-" : "") + s;
};

/** os-ui's toolbar memory (main.ts syncGroupPick): the last tool picked from each group. */
type Picked = Partial<Record<PickGroup, number>>;
function syncPicked(picked: Picked, before: number, after: number) {
  if (after === before) return;
  for (const g of PICK_NAMES)
    if ((PICK_GROUPS[g] as readonly number[]).includes(after))
      picked[g] = after;
}

/** Every screen line against what the registers say it should be; `picked` is os-ui's toolbar
 * memory over the same events. */
function checkDisplay(v: ArrayLike<number>, picked: Picked) {
  const d = chip.display;
  const n = read(v, "g/n") as number;
  const sel = read(v, "g/sel") as number;
  d.n.forEach((l, k) =>
    expect(lineValue(v, l), `n=${k}`).toBe(n === k ? 1 : 0),
  );
  expect(lineValue(v, d.anySel)).toBe(sel >= 0 ? 1 : 0);
  expect(lineValue(v, d.noSel)).toBe(sel < 0 ? 1 : 0);
  const tool = read(v, "g/tool") as number;
  d.tool.forEach((l, k) =>
    expect(lineValue(v, l), `tool ${k}`).toBe(tool === k ? 1 : 0),
  );
  // what each toolbar group's button shows: the active tool when it is the group's, else the
  // remembered one (one line of the group's one-hot set is on)
  for (const g of PICK_NAMES) {
    const tools = PICK_GROUPS[g] as readonly number[];
    const on = d.pick[g].flatMap((l, k) => (lineValue(v, l) ? [k] : []));
    expect(on.length, `${g}: one remembered tool`).toBe(1);
    const shown = tools.includes(tool) ? tool : tools[on[0]];
    expect(shown, `${g} shows`).toBe(
      tools.includes(tool) ? tool : (picked[g] ?? tools[0]),
    );
  }
  const fill = read(v, "g/fill") as number;
  d.fill.forEach((l, k) => expect(lineValue(v, l)).toBe(fill === k ? 1 : 0));
  for (let i = 0; i < SLOTS; i++) {
    const s = d.slots[i];
    const f = (k: string) => read(v, `L${i}/${k}`) as number;
    const x = f("x");
    const y = f("y");
    const used = i < n;
    const vis = read(v, `L${i}/vis`) === true;
    const inside = (c: number) => c >= -OFFSET && c < OFFSET;
    expect(lineValue(v, s.used)).toBe(used ? 1 : 0);
    expect(lineValue(v, s.vin), `slot ${i} vin`).toBe(
      vis && inside(x) && inside(y) ? 1 : 0,
    );
    expect(lineValue(v, s.sel)).toBe(sel === i ? 1 : 0);
    expect(lineValue(v, d.selN[i])).toBe(sel === i ? 0 : 1);
    s.opacity.forEach((l, k) =>
      expect(lineValue(v, l)).toBe(f("opacity") === k ? 1 : 0),
    );
    s.radius.forEach((l, k) =>
      expect(lineValue(v, l)).toBe(f("radius") === k ? 1 : 0),
    );
    expect(lineValue(v, s.strokeNone)).toBe(f("stroke") === -1 ? 1 : 0);
    s.stroke.forEach((l, k) =>
      expect(lineValue(v, l)).toBe(f("stroke") === k ? 1 : 0),
    );
    expect(lineValue(v, s.visN)).toBe(vis ? 0 : 1);
    const bitsOf = (ls: Line[]) =>
      ls.reduce((a, l, k) => a + (lineValue(v, l) << k), 0);
    if (inside(x)) expect(bitsOf(s.px)).toBe(x + OFFSET);
    if (inside(y)) expect(bitsOf(s.py)).toBe(y + OFFSET);
    expect(bitsOf(s.pw)).toBe(Math.min(f("w"), 63));
    expect(bitsOf(s.ph)).toBe(Math.min(f("h"), 63));
    const kind = f("kind");
    for (const k of KINDS)
      expect(lineValue(v, s.kind[k])).toBe(kind === k ? 1 : 0);
    s.fill.forEach((l, k) =>
      expect(lineValue(v, l)).toBe(f("fill") === k ? 1 : 0),
    );
    expect(numberShown(v, s.x), `slot ${i} x`).toBe(String(x));
    expect(numberShown(v, s.y), `slot ${i} y`).toBe(String(y));
    expect(numberShown(v, s.w)).toBe(String(f("w")));
    expect(numberShown(v, s.h)).toBe(String(f("h")));
    expect(numberShown(v, s.id)).toBe(String(f("id")));
  }
}

describe("the os-ui chip (osflow's editor on NATHAN registers, with its screen decode)", () => {
  it("is osflow's machine: the same registers after every event", () => {
    const gm = new GateMachine(
      osflowSynth(buildEditor({ target: "hardware" })),
    );
    for (let seed = 1; seed <= 4; seed++) {
      const r = rng(seed);
      gm.reset();
      const sim = new FastSim(net, schedule, init);
      for (let step = 0; step < 150; step++) {
        const { id, inputs } = randomEvent(r);
        gm.fire(id, inputs);
        fire(sim, id, inputs);
        for (const name of chip.syn.regs.keys())
          expect(
            read(sim.v, name),
            `seed ${seed} step ${step} ${id}: ${name}`,
          ).toEqual(gm.read(name));
      }
    }
  }, 60_000);

  it("shows what the registers hold: placement, kinds, colours, decimal digits, the toolbar", () => {
    // steps where a group whose tool is not active shows one that is not its first
    let remembered = 0;
    for (let seed = 11; seed <= 13; seed++) {
      const r = rng(seed);
      const sim = new FastSim(net, schedule, init);
      const picked: Picked = {};
      checkDisplay(sim.v, picked);
      for (let step = 0; step < 120; step++) {
        const { id, inputs } = randomEvent(r);
        const before = read(sim.v, "g/tool") as number;
        fire(sim, id, inputs);
        const tool = read(sim.v, "g/tool") as number;
        syncPicked(picked, before, tool);
        checkDisplay(sim.v, picked);
        if (
          PICK_NAMES.some(
            (g) =>
              !(PICK_GROUPS[g] as readonly number[]).includes(tool) &&
              (picked[g] ?? PICK_GROUPS[g][0]) !== PICK_GROUPS[g][0],
          )
        )
          remembered++;
      }
    }
    expect(remembered).toBeGreaterThan(20);
  }, 60_000);

  it("runs each event as NATHAN's reaction: the registers and every screen line as one tick", () => {
    const reactions = new Map<number, ReturnType<typeof synthesize>>();
    const reactionOf = (code: number) => {
      if (!reactions.has(code))
        reactions.set(
          code,
          synthesize(net, { EVT: code }, { latch: "direct", alias: true }),
        );
      return reactions.get(code)!;
    };
    const evt = net.ports.find((p) => p.name === "EVT")!.nets;
    const port = (name: string) => net.ports.find((p) => p.name === name)!.nets;
    // every net the screen reads
    const screen = new Set<number>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        if ("net" in x) screen.add(netId(net, (x as { net: string }).net));
        else Object.values(x).forEach(walk);
      }
    };
    walk(chip.display);
    for (let seed = 21; seed <= 22; seed++) {
      const r = rng(seed);
      const sim = new FastSim(net, schedule, init);
      const st = new Map<number, boolean>();
      init.forEach((b, i) => st.set(i, b === 1));
      for (let step = 0; step < 120; step++) {
        const { id, inputs } = randomEvent(r);
        fire(sim, id, inputs);
        const code = chip.syn.codes.get(id)!;
        for (const [k, val] of Object.entries(inputs))
          port(chip.syn.inputs.get(k)!.port).forEach((n, b) =>
            st.set(n, ((val >> b) & 1) === 1),
          );
        evt.forEach((n, b) => st.set(n, ((code >> b) & 1) === 1));
        runPlanActions(reactionOf(code).actions, st);
        for (const [name, nets] of [...regIds, ...pickIds])
          for (const n of nets)
            expect(
              st.get(n) ? 1 : 0,
              `seed ${seed} step ${step} ${id}: ${name}`,
            ).toBe(sim.v[n]);
        for (const n of screen)
          expect(
            st.get(n) ? 1 : 0,
            `seed ${seed} step ${step} ${id}: ${net.netNames[n]}`,
          ).toBe(sim.v[n]);
      }
    }
  }, 120_000);
});
