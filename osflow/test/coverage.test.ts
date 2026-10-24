// The random sessions and directed scripts of test/support.ts are the evidence that the flow, and
// through it the gates, compute what the reducer does: lockstep.test.ts, hardware.test.ts and
// gates-editor.test.ts replay them. A branch they never reach is compared with nothing, so this
// holds them to reaching the ones that are easy to miss: every tool button and shortcut, align's
// placement inside a parent in any slot (U_parent and U_align are the costliest part of the
// chart), and every clamp an arrow key or a stepper can hit at a canvas edge (each is its own
// comparator in the gates).
import { describe, expect, it } from "vitest";
import { eventsFor, Unsupported } from "../src/codec";
import { buildEditor } from "../src/editor";
import { TOOL_KEYS, WORLD } from "../src/spec";
import {
  getSelected,
  initialState,
  reduce,
  type Action,
  type State,
} from "../../os-ui/src/model";
import { actions, drive, rng, Runner, SCRIPTS, Session } from "./support";

const TARGETS = ["hardware", "word"] as const;
const optsOf = (target: (typeof TARGETS)[number]) =>
  target === "hardware" ? ({ target } as const) : {};

describe("the random sessions fire every tool control", () => {
  // Pen, Paint, Erase, Text and Comment have no canvas gestures yet (a press under them is
  // skipped as unsupported), but their buttons and keys work: the first three drop the selection.
  for (const target of TARGETS)
    it(`fires every tool button and every tool shortcut (${target})`, () => {
      const opts = optsOf(target);
      const ed = buildEditor(opts);
      const fired = new Set<string>();
      for (let seed = 1; seed <= 40; seed++)
        drive(seed, ed.K, 120, (id) => fired.add(id), opts);
      const controls = ed.events
        .map((e) => e.id)
        .filter(
          (id) =>
            id.startsWith("tool/") ||
            (id.startsWith("key/") && id.slice(4, -4) in TOOL_KEYS),
        );
      expect(controls.filter((id) => !fired.has(id))).toEqual([]);
    });
});

/** The parent slot each align event of seeds 1 … 40 found (t/par), for the aligns that had a
 * selection; -1 when the selection sits on the bare canvas. */
function parentsFound(target: (typeof TARGETS)[number]): number[] {
  const opts = optsOf(target);
  const ed = buildEditor(opts);
  const found: number[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const flow = new Runner(ed);
    drive(
      seed,
      ed.K,
      120,
      (id, inputs) => {
        const origin = /^@origin (\S+) (\S+)$/.exec(id);
        if (origin) {
          flow.vars.set("v/x", Number(origin[1]));
          flow.vars.set("v/y", Number(origin[2]));
          return;
        }
        flow.fire(id, inputs);
        if (id.startsWith("align/") && (flow.vars.get("g/sel") as number) >= 0)
          found.push(flow.vars.get("t/par") as number);
      },
      opts,
    );
  }
  return found;
}

describe("the random sessions reach align's placement", () => {
  for (const target of TARGETS)
    it(`aligns a selection inside its parent, with parents above slot 1 too (${target})`, () => {
      const found = parentsFound(target);
      const placed = found.filter((p) => p >= 0);
      const summary = `${placed.length} of ${found.length} aligns with a selection found a parent, in slots ${[...new Set(placed)].sort().join(", ") || "none"}`;
      expect(placed.length, summary).toBeGreaterThanOrEqual(20);
      expect(
        placed.some((p) => p >= 2),
        summary,
      ).toBe(true);
    });
});

type Edge = [name: string, reached: (s: State, a: Action) => boolean];

const arrow = (a: Action, ...keys: string[]) =>
  a.t === "key" && !a.meta && keys.includes(a.key);
const stepper = (
  s: State,
  a: Action,
  prop: "x" | "y" | "w" | "h",
  dir: 1 | -1,
  at: (v: number) => boolean,
) => {
  const l = getSelected(s);
  return (
    !!l &&
    a.t === "prop" &&
    a.prop === prop &&
    Number(a.value) === l[prop] + dir &&
    at(l[prop])
  );
};
const sel = (s: State) => getSelected(s);

/** Every edge a control can cross, from a state the reducer can reach. */
const EDGES: Edge[] = [
  [
    "ArrowLeft at x = -512",
    (s, a) => arrow(a, "ArrowLeft") && sel(s)?.x === -WORLD,
  ],
  [
    "ArrowUp at y = -512",
    (s, a) => arrow(a, "ArrowUp") && sel(s)?.y === -WORLD,
  ],
  [
    "ArrowRight at x >= 512",
    (s, a) => arrow(a, "ArrowRight") && (sel(s)?.x ?? 0) >= WORLD,
  ],
  [
    "ArrowDown at y >= 512",
    (s, a) => arrow(a, "ArrowDown") && (sel(s)?.y ?? 0) >= WORLD,
  ],
  [
    "ArrowLeft at x > 513",
    (s, a) => arrow(a, "ArrowLeft") && (sel(s)?.x ?? 0) > WORLD + 1,
  ],
  [
    "ArrowUp at y > 513",
    (s, a) => arrow(a, "ArrowUp") && (sel(s)?.y ?? 0) > WORLD + 1,
  ],
  [
    "ArrowLeft or ArrowRight at y > 512",
    (s, a) => arrow(a, "ArrowLeft", "ArrowRight") && (sel(s)?.y ?? 0) > WORLD,
  ],
  [
    "ArrowUp or ArrowDown at x > 512",
    (s, a) => arrow(a, "ArrowUp", "ArrowDown") && (sel(s)?.x ?? 0) > WORLD,
  ],
  ...(["x", "y"] as const).flatMap((p): Edge[] => [
    [
      `${p} stepper down at ${p} = -512`,
      (s, a) => stepper(s, a, p, -1, (v) => v === -WORLD),
    ],
    [
      `${p} stepper up at ${p} >= 512`,
      (s, a) => stepper(s, a, p, 1, (v) => v >= WORLD),
    ],
    [
      `${p} stepper down at ${p} > 513`,
      (s, a) => stepper(s, a, p, -1, (v) => v > WORLD + 1),
    ],
  ]),
  ...(["w", "h"] as const).flatMap((p): Edge[] => [
    [
      `${p} stepper up at ${p} >= 512`,
      (s, a) => stepper(s, a, p, 1, (v) => v >= WORLD),
    ],
    [
      `${p} stepper down at ${p} > 513`,
      (s, a) => stepper(s, a, p, -1, (v) => v > WORLD + 1),
    ],
    [
      `${p} stepper down at ${p} = 1`,
      (s, a) => stepper(s, a, p, -1, (v) => v === 1),
    ],
  ]),
];

/** A Session that notes the edges its actions cross, before it applies them. */
class Watched extends Session {
  constructor(private readonly note: (s: State, a: Action) => void) {
    super({ target: "hardware" });
  }

  override step(a: Action): void {
    this.note(this.s, a);
    super.step(a);
  }
}

describe("the tests hold every canvas-edge clamp to the reducer", () => {
  it("reaches every edge each arrow key and x/y/w/h stepper can cross (hardware sessions and scripts)", () => {
    const reached = new Set<string>();
    const note = (s: State, a: Action) => {
      for (const [name, test] of EDGES) if (test(s, a)) reached.add(name);
    };
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      let s = initialState();
      for (let step = 0; step < 120; step++)
        for (const a of actions(r, s, { x: 0, y: 0 })) {
          try {
            eventsFor(s, a);
          } catch (e) {
            if (e instanceof Unsupported) continue;
            throw e;
          }
          note(s, a);
          s = reduce(s, a);
        }
    }
    for (const script of Object.values(SCRIPTS)) script(new Watched(note));
    expect(
      EDGES.map(([name]) => name).filter((name) => !reached.has(name)),
    ).toEqual([]);
  });
});
