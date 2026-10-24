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
  /** Catalogue name, e.g. "tool/2", "click/idle-move/3" (a click on canvas row 3), "dup@5" (Duplicate
   * while the selection register holds 5). */
  name: string;
  ties: Tie;
  /** Registers the control that runs it shows for (`sel` for the per-slot Arrange buttons). */
  given?: Tie;
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
/** The four hotspot sets: which clicks they take, and the line (`hot` bit) that shows them. A set
 * is one click layer per canvas row, each with its own reaction: PY is that row, a constant, which
 * folds half the hit test away (the pointer's column comes from the hover). */
const HOTSPOT_SETS: Array<Omit<ReactionSpec, "event">> = [
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
  },
  {
    name: "click/drag-move",
    ties: { EVT: EV.CLICK, ...dg(0, 1, 0, 0), dragging: 1 },
    valid: (s) => s.drag?.mode === "move",
  },
  {
    name: "click/drag-span",
    ties: { EVT: EV.CLICK, ...dg(0, 0), dragging: 1 },
    valid: (s) => s.drag?.mode === "create" || s.drag?.mode === "resize",
  },
];

/** Hotspot set names in `hot` bit order. */
export const HOTSPOT_REACTIONS = HOTSPOT_SETS.map((h) => h.name);
/** The reaction a click on canvas row `row` of hotspot set `set` runs. */
export const clickRun = (set: number, row: number) =>
  `${HOTSPOT_REACTIONS[set]}/${row}`;

export const CLICK_SPECS: ReactionSpec[] = HOTSPOT_SETS.flatMap((h) =>
  Array.from({ length: R.GRID_H }, (_, y) => ({
    ...h,
    name: `${h.name}/${y}`,
    ties: { ...h.ties, PY: y },
    event: (rnd: (n: number) => number): Ev => ({ k: "click", x: rnd(R.GRID_W), y }),
  })),
);

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
  // Duplicate and the reorders: one per value of the selection register (the button and the
  // shortcut for the register's value are the ones showing). With the slot known, reading the
  // selected record and the reorder's muxes fold away.
  for (const [name, evt, k] of [
    ["dup", EV.DUP, "dup"],
    ["fwd", EV.FWD, "fwd"],
    ["back", EV.BACK, "back"],
  ] as const) {
    for (let sel = 0; sel < LAYERS; sel++)
      out.push({
        name: `${name}@${sel}`,
        ties: { EVT: evt },
        given: { sel },
        valid: always,
        event: () => ({ k }),
      });
  }
  out.push({
    name: "esc",
    ties: { EVT: EV.ESC },
    valid: always,
    event: () => ({ k: "esc" }),
  });
  return out;
}

export type Catalog = Map<string, { spec: ReactionSpec; reaction: Reaction }>;

/** Do the machine's values `v` (one per net) hold the registers a spec is given? */
export function givenHolds(
  net: { aliases: Map<string, number> },
  spec: ReactionSpec,
  v: ArrayLike<number>,
): boolean {
  return Object.entries(spec.given ?? {}).every(([name, value]) => {
    const one = net.aliases.get(name);
    if (one !== undefined) return v[one] === (value & 1);
    for (let i = 0; ; i++) {
      const id = net.aliases.get(`${name}[${i}]`);
      if (id === undefined) return i > 0;
      if (v[id] !== ((value >> i) & 1)) return false;
    }
  });
}

/** Synthesises every reaction of the OS (a few seconds for ~50 specs on the full machine). */
export function buildCatalog(
  net: Parameters<typeof synthesize>[0],
  specs: ReactionSpec[] = reactionSpecs(),
  opts: SynthOptions = {},
): Catalog {
  const out: Catalog = new Map();
  for (const spec of specs) out.set(spec.name, entryOf(net, spec, opts));
  return out;
}

/** The same, a few reactions at a time with `rest()` in between (a plugin must not hold Figma's
 * main thread for long, or Figma loses its connection to the server). */
export async function buildCatalogGently(
  net: Parameters<typeof synthesize>[0],
  specs: ReactionSpec[],
  opts: SynthOptions,
  rest: () => Promise<void>,
): Promise<Catalog> {
  const out: Catalog = new Map();
  for (const [i, spec] of specs.entries()) {
    out.set(spec.name, entryOf(net, spec, opts));
    if (i % 4 === 3) await rest();
  }
  return out;
}

const entryOf = (
  net: Parameters<typeof synthesize>[0],
  spec: ReactionSpec,
  opts: SynthOptions,
) => ({
  spec,
  reaction: synthesize(net, spec.ties, { ...opts, given: spec.given }),
});
