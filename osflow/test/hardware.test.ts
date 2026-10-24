// The hardware target of the flow (docs/GATES.md §1), the program that src/gates/ turns into
// 2-input gates: the editor in cells, three pointer events that read the window cell from inputs,
// a bit width on every number, and feature groups that can be left out. It must behave exactly
// like the reducer, as the word level does, and every value it writes must fit its declared
// width: the gate-level machine truncates each write to that width, so then it computes the same.
import { describe, expect, it } from "vitest";
import { decode, viewOf } from "../src/codec";
import { buildEditor, type Editor } from "../src/editor";
import type { Expr, Role, Step } from "../src/ir";
import { FEATURES, type Feature } from "../src/spec";
import { initialState } from "../../os-ui/src/model";
import { fits, replay, Runner, SCRIPTS, Session } from "./support";

/** Every feature, each group left out alone, and all of them left out. */
const CONFIGS: Feature[][] = [[], ...FEATURES.map((f) => [f]), [...FEATURES]];
const label = (omit: readonly Feature[]) =>
  omit.length ? `without ${omit.join(", ")}` : "every feature";
const hardware = (omit: readonly Feature[] = []) =>
  buildEditor({ target: "hardware", omit });
const EVERY_EDITOR: Editor[] = [
  buildEditor(),
  buildEditor({ K: 3 }),
  ...CONFIGS.map(hardware),
];

// ---------- walking a program ----------

const readsOf = (e: Expr, into = new Set<string>()): Set<string> => {
  if (e.k === "var") into.add(e.name);
  else if (e.k === "op") {
    readsOf(e.a, into);
    if (e.b) readsOf(e.b, into);
  }
  return into;
};

/** Calls `write` for every set (and half) and `test` for every condition, on every path. */
function walk(
  steps: readonly Step[],
  write: (name: string, value: Expr) => void,
  test: (cond: Expr) => void,
): void {
  for (const s of steps) {
    if (s.k === "set") write(s.name, s.to);
    else if (s.k === "half") write(s.dst, s.src);
    else if (s.k === "unit") walk(s.steps, write, test);
    else {
      test(s.cond);
      walk(s.then, write, test);
      walk(s.else ?? [], write, test);
    }
  }
}

/** The temps a handler reads, on some path, before it has written them. */
function readBeforeWrite(
  steps: readonly Step[],
  isTemp: (name: string) => boolean,
): string[] {
  const bad = new Set<string>();
  const check = (e: Expr, done: ReadonlySet<string>) => {
    for (const name of readsOf(e))
      if (isTemp(name) && !done.has(name)) bad.add(name);
  };
  const go = (list: readonly Step[], done: Set<string>): Set<string> => {
    for (const s of list) {
      if (s.k === "set") {
        check(s.to, done);
        done.add(s.name);
      } else if (s.k === "half") {
        check(s.src, done);
        done.add(s.dst);
      } else if (s.k === "unit") done = go(s.steps, done);
      else {
        check(s.cond, done);
        const a = go(s.then, new Set(done));
        const b = go(s.else ?? [], new Set(done));
        done = new Set([...a].filter((name) => b.has(name)));
      }
    }
    return done;
  };
  go(steps, new Set());
  return [...bad];
}

const rolesOf = (ed: Editor) => {
  const roles = new Map(ed.vars.map((d) => [d.name, d.role]));
  return (name: string): Role | undefined => roles.get(name);
};

const unitsOf = (ed: Editor): string[] => {
  const names = new Set<string>();
  const go = (steps: readonly Step[]) => {
    for (const s of steps)
      if (s.k === "unit") {
        names.add(s.name);
        go(s.steps);
      } else if (s.k === "if") {
        go(s.then);
        go(s.else ?? []);
      }
  };
  for (const e of ed.events) go(e.steps);
  return [...names].sort();
};

// ---------- the program ----------

describe("the hardware target's program", () => {
  it("gives every variable a role, and every number that becomes gates a width that holds its initial value (both targets)", () => {
    for (const ed of EVERY_EDITOR)
      for (const d of ed.vars) {
        const where = `${ed.target} ${d.name}`;
        expect(d.role, where).toBeDefined();
        if (d.ty === "num" && d.role !== "view") {
          expect(d.bits, where).toBeGreaterThan(0);
          expect(typeof d.signed, where).toBe("boolean");
          expect(fits(d.init as number, d.bits!, d.signed!), where).toBe(true);
        }
        if (d.role === "temp")
          expect(d.init, `${where}: a temp starts each event at 0`).toBe(
            d.ty === "bool" ? false : 0,
          );
      }
  });

  it("has no text or color variables, and no rotation", () => {
    for (const omit of CONFIGS) {
      const ed = hardware(omit);
      expect(ed.K).toBe(1);
      expect(ed.vars.filter((d) => d.ty !== "num" && d.ty !== "bool")).toEqual(
        [],
      );
      expect(ed.vars.filter((d) => d.name.endsWith("/rot"))).toEqual([]);
    }
    expect(buildEditor().vars.some((d) => d.name === "L0/rot")).toBe(true);
  });

  it("holds every number in the width table", () => {
    const ed = hardware();
    const entry = (name: string) => {
      const d = ed.vars.find((v) => v.name === name);
      if (!d) return "absent";
      const width =
        d.ty === "bool"
          ? "bool"
          : d.bits === undefined
            ? "any"
            : `${d.signed ? "s" : "u"}${d.bits}`;
      return `${d.role} ${width}`;
    };
    const table = {
      "L0/id": "state u8",
      "L0/kind": "state u5",
      "L0/x": "state s12",
      "L0/y": "state s12",
      "L0/w": "state u10",
      "L0/h": "state u10",
      "L0/fill": "state u4",
      "L0/opacity": "state u4",
      "L0/radius": "state u3",
      "L0/stroke": "state s5",
      "L0/vis": "state bool",
      "L0/shadow": "state bool",
      "L0/flip": "state bool",
      "L0/f/0": "view bool",
      "L0/sel": "view bool",
      "L0/used": "view bool",
      "L0/rr": "view any",
      "clip/has": "state bool",
      "clip/x": "state s12",
      "clip/w": "state u10",
      "tmp/x": "temp s12",
      "tmp/w": "temp u10",
      "tmp/flip": "temp bool",
      "par/x": "temp s12",
      "par/w": "temp u10",
      "g/tool": "state u5",
      "g/tCreate": "state bool",
      "g/tSelect": "state bool",
      "g/fill": "state u4",
      "g/nextId": "state u8",
      "g/n": "state u4",
      "g/sel": "state s4",
      "d/mode": "state u2",
      "d/a": "state s12",
      "d/b": "state s12",
      "v/x": "const u1",
      "v/y": "const u1",
      "in/px": "input u4",
      "in/py": "input u4",
      "t/px": "temp u4",
      "t/py": "temp u4",
      "t/hit": "temp s4",
      "t/fill": "temp u4",
      "t/x1": "temp s12",
      "t/y1": "temp s12",
      "t/par": "temp s4",
      "t/area": "temp u19",
      "t/v": "temp u9",
      "t/rem": "absent",
      "t/q": "absent",
    };
    expect(
      Object.fromEntries(Object.keys(table).map((name) => [name, entry(name)])),
    ).toEqual(table);
  });

  it("never reads a temp before writing it, on any path (both targets)", () => {
    for (const ed of EVERY_EDITOR) {
      const role = rolesOf(ed);
      for (const e of ed.events)
        expect(
          readBeforeWrite(e.steps, (name) => role(name) === "temp"),
          `${ed.target} ${e.id}`,
        ).toEqual([]);
    }
  });

  it("computes no state from the view, and writes no input or const", () => {
    for (const ed of EVERY_EDITOR) {
      const role = rolesOf(ed);
      for (const e of ed.events) {
        const bad: string[] = [];
        walk(
          e.steps,
          (name, value) => {
            if (role(name) === "input" || role(name) === "const")
              bad.push(`writes ${name}`);
            if (role(name) !== "view")
              for (const r of readsOf(value))
                if (role(r) === "view") bad.push(`${name} reads ${r}`);
          },
          (cond) => {
            for (const r of readsOf(cond))
              if (role(r) === "view") bad.push(`a condition reads ${r}`);
          },
        );
        expect(bad, `${ed.target} ${e.id}`).toEqual([]);
      }
    }
  });

  it("does whole-number arithmetic outside the view: no division, no fractions", () => {
    for (const omit of CONFIGS) {
      const ed = hardware(omit);
      const role = rolesOf(ed);
      const bad: string[] = [];
      const check = (where: string) => (e: Expr) => {
        const go = (x: Expr): void => {
          if (x.k === "num" && !Number.isInteger(x.v))
            bad.push(`${where}: ${x.v}`);
          if (x.k === "op") {
            if (x.fn === "div") bad.push(`${where}: div`);
            go(x.a);
            if (x.b) go(x.b);
          }
        };
        go(e);
      };
      for (const e of ed.events)
        walk(
          e.steps,
          (name, value) => {
            if (role(name) !== "view") check(`${e.id} ${name}`)(value);
          },
          check(`${e.id} condition`),
        );
      expect(bad).toEqual([]);
    }
  });

  it("has the word level's events, with the canvas hotspots folded into three pointer events", () => {
    const word = buildEditor().events.map((e) => e.id);
    expect(hardware().events.map((e) => e.id)).toEqual([
      "pointer#down",
      "pointer#enter",
      "pointer#up",
      ...word.filter((id) => !id.startsWith("cell/")),
    ]);
  });

  it("leaves out exactly the events and variables of each omitted group", () => {
    const EVENTS: Record<Feature, RegExp> = {
      clipboard: /^key\/meta\+[cxv]#/,
      align: /^align\//,
      style: /^(stroke\/|shadow\/|prop\/(opacity|radius)\/)/,
    };
    const VARS: Record<Feature, RegExp> = {
      clipboard: /^clip\//,
      align: /^(par\/|t\/(par|area|v)$)/,
      style: /\/(opacity|radius|stroke|shadow)$/,
    };
    const full = hardware();
    for (const omit of CONFIGS) {
      const ed = hardware(omit);
      const left = (all: string[], groups: Record<Feature, RegExp>) =>
        all.filter((name) => !omit.some((f) => groups[f].test(name)));
      expect(ed.omit).toEqual(omit);
      expect(
        ed.events.map((e) => e.id),
        label(omit),
      ).toEqual(
        left(
          full.events.map((e) => e.id),
          EVENTS,
        ),
      );
      expect(
        ed.vars.map((d) => d.name),
        label(omit),
      ).toEqual(
        left(
          full.vars.map((d) => d.name),
          VARS,
        ),
      );
    }
  });

  it("names the blocks of the chart: every helper is a unit, on both targets", () => {
    const blocks = [
      "align",
      "copy",
      "create",
      "drag",
      "duplicate",
      "eye",
      "handle",
      "hit",
      "new",
      "nudge",
      "parent",
      "paste",
      "prop",
      "recolor",
      "remove",
      "reorder",
      "select",
      "span",
      "style",
      "tool",
    ];
    expect(unitsOf(buildEditor())).toEqual(blocks);
    expect(unitsOf(hardware())).toEqual(blocks);
  });

  it("halves with a shift on the hardware, and only there", () => {
    const halving = (ed: Editor) =>
      ed.events
        .filter((e) => {
          let found = false;
          const go = (steps: readonly Step[]) => {
            for (const s of steps)
              if (s.k === "half") found = true;
              else if (s.k === "unit") go(s.steps);
              else if (s.k === "if") {
                go(s.then);
                go(s.else ?? []);
              }
          };
          go(e.steps);
          return found;
        })
        .map((e) => e.id);
    expect(halving(hardware())).toEqual([
      "align/hcenter#click",
      "align/vcenter#click",
    ]);
    expect(halving(buildEditor())).toEqual([]);
  });
});

// ---------- against the reducer ----------

describe("the hardware target in lockstep with the os-ui reducer", () => {
  for (const omit of CONFIGS) {
    const opts = { target: "hardware", omit } as const;
    const seeds = omit.length ? 16 : 40;
    describe(label(omit), () => {
      it("starts in the reducer's initial state", () => {
        const flow = new Runner(buildEditor(opts));
        expect(decode(flow.vars, 1)).toEqual(viewOf(initialState(), omit));
      });

      it(`matches after every action of ${seeds} random sessions, and every write fits its width`, () => {
        let events = 0;
        for (let seed = 1; seed <= seeds; seed++)
          events += replay(seed, 120, opts).events;
        expect(events).toBeGreaterThan(seeds * 150);
      });

      for (const [name, script] of Object.entries(SCRIPTS))
        it(name, () => script(new Session(opts)));
    });
  }

  it("refuses a session that takes nextId to 256: the 8-bit ids would wrap there", () => {
    const t = new Session({ target: "hardware" });
    const makeAndDelete = () => {
      t.step({ t: "key", key: "r" });
      t.step({ t: "down", x: 0, y: 0 });
      t.step({ t: "up" });
      t.step({ t: "key", key: "Delete" });
    };
    while (t.s.nextId < 255) makeAndDelete();
    expect(() => makeAndDelete()).toThrow(
      /g\/nextId = 256 does not fit unsigned 8 bits/,
    );
  });
});
