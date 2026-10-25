// The no-plugin build of CPU NATHAN, end to end on silicon's fake Plugin API: run every chunk the
// generator wrote, exactly as use_figma would, check what was built against the editor's spec and
// what Figma desktop takes, then play a random user session through the stored reactions (silicon's
// strict emulator of Figma's prototype engine), dispatched as the viewer dispatches. After every
// action the machine's registers, its screen lines and the screen layers themselves must match the
// editor spec of silicon/nathan (the same checks as its plugin's self-test). Two more builds with a
// smaller part force the overlay chains a reaction longer than one event continues through.
import { beforeAll, describe, expect, it } from "vitest";
import type { FigmaValue } from "../../silicon/src/prototype/emulate";
import { KEYS, SLOT_KEYS } from "../../silicon/nathan/src/ui/spec";
import { figmaShapeErrors, runEvent } from "./figma-shape";
import {
  budgetErrors,
  build,
  chainErrors,
  lampErrors,
  session,
  structureErrors,
  writesEarly,
  type Built,
} from "./nathan-checks";

let base: Built; // the default part, 700: every reaction is one event
let edge: Built; // a part one action short of the longest reaction, which may not stay one event
let chains: Built; // part 400: reactions continue through one overlay, none torn
let torn: Built; // part 250: overlays swap on (the pick-up takes 3 events), and some reactions are torn by design
const builds = () => [base, edge, chains, torn];

beforeAll(async () => {
  base = await build();
  edge = await build({ part: base.gen.stats.longest.actions - 1 });
  chains = await build({ part: 400 });
  torn = await build({ part: 250 });
}, 300000);

/** No problems: the first few a check found, and how many (all of them would bury the message). */
const none = (problems: string[], b: Built) =>
  expect(
    problems.slice(0, 8),
    `part ${b.part}: ${problems.length} problem(s)`,
  ).toEqual([]);

describe("the chunks", () => {
  it("store only reactions Figma keeps as written and accepts", () => {
    for (const b of builds()) none(figmaShapeErrors(b.fake.allNodes()), b);
  });

  it("each fits the MCP's 50,000-character limit, and the screen binds every net it names", () => {
    for (const b of builds()) {
      for (const c of b.gen.chunks)
        expect(c.code.length, c.note).toBeLessThanOrEqual(50000);
      expect(b.gen.stats.missing).toEqual([]);
    }
  });

  it("build one Present frame with the editor and the only flow (Figma makes flows of overlays that swap)", () => {
    for (const b of builds())
      expect(
        b.fake.currentPage.flowStartingPoints.map((f) => f.nodeId),
        `part ${b.part}`,
      ).toEqual([b.present.id]);
  });

  it("store each node's reactions in one call (the read-back of stored reactions never ran in Figma)", () => {
    for (const b of builds())
      expect(b.fake.reactionWrites).toBe(
        b.fake.allNodes().filter((n) => n.reactions.length).length,
      );
  });

  it("build the editor layer by layer as uiSpec() describes it", () => {
    for (const b of builds()) none(structureErrors(b), b);
  });

  it("put every gate on the map, its lamp on the gate's output (a master latch's on its Q)", () => {
    none(lampErrors(base), base);
  });

  it("put shortcuts only on the frame (KEYS) and on the 8 key layers the selection picks (D [ ])", () => {
    for (const b of builds()) {
      const keyed = b.fake.allNodes().flatMap((n) => {
        const codes = n.reactions.flatMap((r) =>
          r.trigger?.type === "ON_KEY_DOWN" ? [r.trigger.keyCodes] : [],
        );
        return codes.length ? [[n.name, codes]] : [];
      });
      expect(keyed).toEqual([
        [b.gen.names.frame, KEYS.map((k) => k.codes)],
        ...Array.from({ length: 8 }, (_, k) => [
          `keys/${k}`,
          SLOT_KEYS.map((s) => [s.code]),
        ]),
      ]);
    }
  });

  it("warm the viewer up once when Present opens, without touching the machine", () => {
    for (const b of builds()) {
      const timers = b.present.reactions.filter(
        (r) => r.trigger?.type === "AFTER_TIMEOUT",
      );
      expect(timers.map((r) => r.trigger)).toEqual([
        { type: "AFTER_TIMEOUT", timeout: 0.001 },
      ]);
      const values = b.fake.variableValues() as Map<string, FigmaValue>;
      const before = new Map(values);
      const warm = () =>
        runEvent(timers[0].actions ?? [], values, (id) => b.fake.nodeById(id));
      // as long an event as the part allows: the guard, its flag and up to 500 throwaway flips, then
      // an empty overlay opened and closed when the build has chains
      expect(warm()).toEqual({
        worst: Math.min(502, b.part),
        events: b.gen.stats.continued ? 2 : 1,
      });
      // it sets only its own wires (the ui unit's: warm, scratch), nothing of the machine
      const changed = [...values.keys()].filter(
        (id) => values.get(id) !== before.get(id),
      );
      expect(changed.map((id) => b.fake.variableById.get(id)!.name)).toEqual(
        changed.map(() => expect.stringMatching(/^w\/ui\//)),
      );
      // a second time the guard is all that runs
      expect(warm()).toEqual({ worst: 1, events: 1 });
    }
  });

  it("keep every stored event within the build's part, every branch counted", () => {
    for (const b of builds()) {
      none(budgetErrors(b), b);
      expect(b.gen.stats.longestPart).toBeLessThanOrEqual(b.part);
    }
  });

  it("need no overlay chain at the default part", () => {
    // today's catalog: every reaction fits one event (revisit when the catalog grows)
    expect(base.gen.stats.continued).toBe(0);
    expect(base.gen.stats.longest.actions).toBeLessThanOrEqual(700);
  });
});

describe("a user session through the stored reactions", () => {
  it("keeps registers, screen lines and screen layers equal to the editor spec", () => {
    const s = session(base);
    // every event stays under what a cold viewer's stack holds
    expect(s.worst).toBeLessThanOrEqual(700);
    expect(base.gen.stats.torn).toBe(0);
    // every control, by its shortcut and by its button; clicks where the pointer already was
    expect(s.used).toEqual([
      "back button",
      "back key",
      "click",
      "delete 46",
      "delete 8",
      "delete button",
      "dup button",
      "dup key",
      "esc",
      "fill",
      "fwd button",
      "fwd key",
      "handle",
      "nudge button",
      "nudge key",
      "select",
      "tool button",
      "tool key",
      "vis",
    ]);
    expect(s.repeats).toBeGreaterThan(0);
  });
});

describe("reactions that continue through overlays (smaller parts)", () => {
  it("run every trigger as a chain the viewer can follow", () => {
    for (const b of builds()) none(chainErrors(b), b);
  });

  it("part 400: one overlay each, no register or screen line written before the last event", () => {
    const { stats } = chains.gen;
    expect(stats.continued).toBeGreaterThan(0);
    expect(stats.torn).toBe(0);
    expect(writesEarly(chains)).toEqual([]);
    // a reaction too long for one event commits its registers directly (Q = D), as at the default
    // part: a smaller part cuts reactions up, it never makes them longer
    expect(stats.staticActions).toBeLessThanOrEqual(
      base.gen.stats.staticActions,
    );
    // a third of the canvas clicks land where the pointer already is, on the hover stored before
    const s = session(chains, { stay: 33 });
    expect(s.repeats).toBeGreaterThan(30);
    expect(s.chained).toBeGreaterThan(0);
    expect(s.longestChain).toBe(2);
    expect(s.worst).toBeLessThanOrEqual(400);
  });

  it("part 250: overlays swap on; the reactions written early are exactly the torn ones", () => {
    const { stats } = torn.gen;
    expect(stats.torn).toBeGreaterThan(0);
    expect(writesEarly(torn)).toHaveLength(stats.torn);
    const s = session(torn);
    expect(s.longestChain).toBeGreaterThan(2);
    expect(s.worst).toBeLessThanOrEqual(250);
  });
});
