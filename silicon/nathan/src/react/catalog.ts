// Every reaction the Figma OS needs, as data: one spec per thing the user can click or press.
// A spec says which lines are tied (the event code, a button's argument, and for canvas clicks the
// tool / drag mode that makes the clicked layer the right one) and in which editor state the UI
// offers it. The UI builder asks for a reaction by name and attaches it to a layer; the tests run
// the same specs against sampled states, so the dispatch rules are checked, not assumed.
import { EV, LAYERS, PALETTE_SIZE } from "../hw/layout";
import type { Ev } from "../model/oracle";
import * as R from "../model/reference";
import {
  type Reaction,
  type SynthOptions,
  synthesize,
  type Tie,
} from "./synth";

export interface ReactionSpec {
  /** Catalogue name, e.g. "tool/2", "click/idle-move". */
  name: string;
  ties: Tie;
  /** Is this reaction reachable in editor state `s`? (The UI only shows the control then.) */
  valid(s: R.State): boolean;
  /** A concrete editor event for this reaction; `rnd(n)` picks where the reaction leaves a choice. */
  event(rnd: (n: number) => number, s: R.State): Ev;
}

const always = () => true;
const dg = (v0: number, v1: number, v2?: number, v3?: number): Tie => ({
  "dg[0]": v0,
  "dg[1]": v1,
  ...(v2 === undefined ? {} : { "dg[2]": v2 }),
  ...(v3 === undefined ? {} : { "dg[3]": v3 }),
});
const cell = (rnd: (n: number) => number) => ({
  x: rnd(R.GRID_W),
  y: rnd(R.GRID_H),
});

/** The four hotspot sets: which clicks they take, and the line (`hot` bit) that shows them. */
export const CLICK_SPECS: ReactionSpec[] = [
  {
    name: "click/idle-move",
    ties: {
      EVT: EV.CLICK,
      ...dg(1, 0, 0, 0),
      dragging: 0,
      is_move_tool: 1,
      creating: 0,
    },
    valid: (s) => !s.drag && s.tool === "move",
    event: (rnd) => ({ k: "click", ...cell(rnd) }),
  },
  {
    name: "click/idle-create",
    ties: {
      EVT: EV.CLICK,
      ...dg(1, 0, 0, 0),
      dragging: 0,
      is_move_tool: 0,
      creating: 1,
    },
    valid: (s) => !s.drag && s.tool !== "move",
    event: (rnd) => ({ k: "click", ...cell(rnd) }),
  },
  {
    name: "click/drag-move",
    ties: { EVT: EV.CLICK, ...dg(0, 1, 0, 0), dragging: 1 },
    valid: (s) => s.drag?.mode === "move",
    event: (rnd) => ({ k: "click", ...cell(rnd) }),
  },
  {
    name: "click/drag-span",
    ties: { EVT: EV.CLICK, ...dg(0, 0), dragging: 1 },
    valid: (s) => s.drag?.mode === "create" || s.drag?.mode === "resize",
    event: (rnd) => ({ k: "click", ...cell(rnd) }),
  },
];

/** Hotspot set names in `hot` bit order, with the reaction each one's clicks run. */
export const HOTSPOT_REACTIONS = [
  "click/idle-move",
  "click/idle-create",
  "click/drag-move",
  "click/drag-span",
] as const;

export function reactionSpecs(): ReactionSpec[] {
  const out: ReactionSpec[] = [...CLICK_SPECS];
  for (let t = 0; t < 4; t++)
    out.push({
      name: `tool/${t}`,
      ties: { EVT: EV.TOOL, ARG: t },
      valid: always,
      event: () => ({ k: "tool", t }),
    });
  for (let c = 0; c < PALETTE_SIZE; c++)
    out.push({
      name: `fill/${c}`,
      ties: { EVT: EV.FILL, ARG: c },
      valid: always,
      event: () => ({ k: "fill", c }),
    });
  for (let k = 0; k < LAYERS; k++) {
    out.push({
      name: `select/${k}`,
      ties: { EVT: EV.SELECT, ARG: k },
      valid: (s) => s.layers.length > k,
      event: () => ({ k: "select", slot: k }),
    });
    out.push({
      name: `vis/${k}`,
      ties: { EVT: EV.VIS, ARG: k },
      valid: (s) => s.layers.length > k,
      event: () => ({ k: "vis", slot: k }),
    });
  }
  for (let c = 0; c < 4; c++)
    out.push({
      name: `handle/${c}`,
      ties: { EVT: EV.HANDLE, ARG: c },
      valid: (s) => s.selected !== null,
      event: () => ({ k: "handle", corner: c }),
    });
  for (let d = 0; d < 4; d++)
    out.push({
      name: `nudge/${d}`,
      ties: { EVT: EV.NUDGE, ARG: d },
      valid: always,
      event: () => ({ k: "nudge", dir: d }),
    });
  out.push({
    name: "delete",
    ties: { EVT: EV.DELETE },
    valid: always,
    event: () => ({ k: "delete" }),
  });
  out.push({
    name: "dup",
    ties: { EVT: EV.DUP },
    valid: always,
    event: () => ({ k: "dup" }),
  });
  out.push({
    name: "fwd",
    ties: { EVT: EV.FWD },
    valid: always,
    event: () => ({ k: "fwd" }),
  });
  out.push({
    name: "back",
    ties: { EVT: EV.BACK },
    valid: always,
    event: () => ({ k: "back" }),
  });
  out.push({
    name: "esc",
    ties: { EVT: EV.ESC },
    valid: always,
    event: () => ({ k: "esc" }),
  });
  return out;
}

export type Catalog = Map<string, { spec: ReactionSpec; reaction: Reaction }>;

/** Synthesises every reaction of the OS (a few seconds for ~50 specs on the full machine). */
export function buildCatalog(
  net: Parameters<typeof synthesize>[0],
  specs: ReactionSpec[] = reactionSpecs(),
  opts: SynthOptions = {},
): Catalog {
  const out: Catalog = new Map();
  for (const spec of specs)
    out.set(spec.name, { spec, reaction: synthesize(net, spec.ties, opts) });
  return out;
}
