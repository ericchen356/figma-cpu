// Every reaction the Figma OS needs, as data: one spec per thing the user can click or press.
// A spec says which lines are tied (the event code, a button's argument, and for canvas clicks the
// tool / drag mode that makes the clicked layer the right one) and in which editor state the UI
// offers it. The UI builder asks for a reaction by name and attaches it to a layer; the tests run
// the same specs against sampled states, so the dispatch rules are checked, not assumed.
import { EV, HOT, LAYERS, PALETTE_SIZE } from "../hw/layout";
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
/** With the pen and nothing pending: the lines that make a canvas event the pen's. */
const PEN_TIES: Tie = {
  ...dg(1, 0, 0, 0),
  dragging: 0,
  is_move_tool: 0,
  creating: 0,
  is_pen: 1,
};

/** The six hotspot sets: which clicks they take, and the line (`hot` bit) that shows them. A set
 * is one click layer per canvas row, each with its own reaction: PY is that row, a constant, which
 * folds half the hit test away (the pointer's column comes from the hover). The pen's two sets
 * (pen up, pen down) run the same clicks: a pen click inks the cell and flips the pen. */
const HOTSPOT_SETS: Array<Omit<ReactionSpec, "event">> = [
  {
    name: "click/idle-move",
    ties: {
      EVT: EV.CLICK,
      ...dg(1, 0, 0, 0),
      dragging: 0,
      is_move_tool: 1,
      creating: 0,
      is_pen: 0,
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
      is_pen: 0,
    },
    valid: (s) => !s.drag && s.tool !== "move" && s.tool !== "pen",
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
  ...[0, 1].map(() => ({
    name: "click/pen",
    ties: { EVT: EV.CLICK, ...PEN_TIES },
    valid: (s: R.State) => !s.drag && s.tool === "pen",
  })),
];

/** Hotspot set names in `hot` bit order. */
export const HOTSPOT_REACTIONS = HOTSPOT_SETS.map((h) => h.name);
/** The hotspot set on which hovering a cell paints it (`hot` bit). */
export const PAINT_SET = HOT.indexOf("pen-down");

/** How finely each hotspot set's reactions are made, in `hot` bit order:
 * - "row": one reaction per canvas row (PY folded; the column comes from the hover);
 * - "cell": one per cell (PX folded too, so the pick-up's 8-layer hit test compares against
 *   constants): worst 754 → 588 actions, mean 579 → 420;
 * - "row@sel": one per row and value of the selection register (the drop's move unit writes only
 *   the selected record): 518 → 333.
 * The pick-up and the pen are per cell (with PX and PY built in, every pixel but one folds away).
 * The drop and the opposite corner are per cell too: they are a release, and no hover fires while
 * the button is held, so the column cannot come from one (a drop 625 actions, a corner 260). The
 * first corner stays per row: it is a press, and the pointer was hovered there first. */
export const HOTSPOT_GRAIN: ReadonlyArray<"row" | "cell" | "row@sel"> = ["cell", "row", "cell", "cell", "cell", "cell"];

/** Which half of a mouse click each hotspot set takes, in `hot` bit order: the press starts a
 * gesture (pick up, first corner, the pen down or up), the release ends one (drop, opposite corner),
 * so a drag is one move or one shape, and a click (press and release on one cell) still works. */
export const HOTSPOT_GESTURE: ReadonlyArray<"down" | "up"> = ["down", "down", "up", "up", "down", "down"];

/** The reaction a click on canvas row `row` (column `col` for a per-cell set, selected slot `sel`
 * for a per-slot one) of hotspot set `set` runs. */
export const clickRun = (set: number, row: number, col = 0, sel = 0) =>
  `${HOTSPOT_REACTIONS[set]}/${row}` +
  (HOTSPOT_GRAIN[set] === "cell" ? `/${col}` : "") +
  (HOTSPOT_GRAIN[set] === "row@sel" ? `@${sel}` : "");

/** What hovering cell (`col`, `row`) of hotspot set `set` runs besides storing the pointer's
 * column (every cell does that): on the pen-down set it paints the cell (releasing the button over
 * it does too), else nothing more ("pointer/<col>", the store alone). */
export const hoverRun = (set: number, row: number, col: number): string =>
  set === PAINT_SET ? `paint/${row}/${col}` : `pointer/${col}`;

export const CLICK_SPECS: ReactionSpec[] = HOTSPOT_SETS.flatMap((h, set) =>
  Array.from({ length: R.GRID_H }, (_, y): ReactionSpec[] => {
    const grain = HOTSPOT_GRAIN[set];
    if (grain === "cell")
      return Array.from({ length: R.GRID_W }, (_, x) => ({
        ...h,
        name: clickRun(set, y, x),
        ties: { ...h.ties, PY: y, PX: x },
        event: (): Ev => ({ k: "click", x, y }),
      }));
    if (grain === "row@sel")
      return Array.from({ length: LAYERS }, (_, sel) => ({
        ...h,
        name: clickRun(set, y, 0, sel),
        ties: { ...h.ties, PY: y },
        given: { sel },
        event: (rnd: (n: number) => number): Ev => ({ k: "click", x: rnd(R.GRID_W), y }),
      }));
    return [
      {
        ...h,
        name: clickRun(set, y),
        ties: { ...h.ties, PY: y },
        event: (rnd: (n: number) => number): Ev => ({ k: "click", x: rnd(R.GRID_W), y }),
      },
    ];
  }).flat(),
  // two sets that run the same reactions (the pen's) make them once
).filter((spec, i, all) => all.findIndex((o) => o.name === spec.name) === i);

/** The pen's strokes: entering cell (x, y) of the pen-down set inks it. PX, PY and the pen's
 * state are known, so the reaction is that one pixel's write. */
export const PAINT_SPECS: ReactionSpec[] = Array.from({ length: R.GRID_H }, (_, y) =>
  Array.from({ length: R.GRID_W }, (_, x): ReactionSpec => ({
    name: `paint/${y}/${x}`,
    ties: { EVT: EV.PAINT, PX: x, PY: y, ...PEN_TIES },
    given: { pendown: 1 },
    valid: (s) => !s.drag && s.tool === "pen" && s.penDown,
    event: () => ({ k: "paint", x, y }),
  })),
).flat();

export function reactionSpecs(): ReactionSpec[] {
  const out: ReactionSpec[] = [...CLICK_SPECS, ...PAINT_SPECS];
  for (let t = 0; t < R.TOOLS.length; t++)
    out.push({
      name: `tool/${t}`,
      ties: { EVT: EV.TOOL, ARG: t },
      valid: always,
      event: () => ({ k: "tool", t }),
    });
  // Fill, the resize handles and nudge act on the selected layer: one reaction per value of the
  // selection register (the swatch, handle, arrow button and arrow key showing are the ones made for
  // it). With the slot known, reading and writing the selected record's 8-way muxes fold away:
  // nudge 349 → 154 actions, a handle 240 → 105, a swatch 128 → 70.
  for (let c = 0; c < PALETTE_SIZE; c++)
    for (let sel = 0; sel < LAYERS; sel++)
      out.push({
        name: `fill/${c}@${sel}`,
        ties: { EVT: EV.FILL, ARG: c },
        given: { sel },
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
    for (let sel = 0; sel < LAYERS; sel++)
      out.push({
        name: `handle/${c}@${sel}`,
        ties: { EVT: EV.HANDLE, ARG: c },
        given: { sel },
        valid: (s) => s.selected !== null,
        event: () => ({ k: "handle", corner: c }),
      });
  for (let d = 0; d < 4; d++)
    for (let sel = 0; sel < LAYERS; sel++)
      out.push({
        name: `nudge/${d}@${sel}`,
        ties: { EVT: EV.NUDGE, ARG: d },
        given: { sel },
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
  // the pen's options: the Erase toggle, and Clear (every pixel's word written 0, in one event)
  out.push({
    name: "erase",
    ties: { EVT: EV.ERASE },
    valid: always,
    event: () => ({ k: "erase" }),
  });
  out.push({
    name: "clear",
    ties: { EVT: EV.CLEAR },
    valid: always,
    event: () => ({ k: "clear" }),
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
