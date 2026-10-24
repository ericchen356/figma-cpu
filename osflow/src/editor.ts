// The Figma OS editor as a flow: os-ui/src/model.ts `reduce`, rewritten as variables and steps
// (ir.ts). Each handler below mirrors one branch of the reducer; test/lockstep.test.ts and
// test/hardware.test.ts run both on random event sequences and compare them.
//
// One flow, two targets (docs/GATES.md):
//   · "word", the default, is what Figma's prototype engine runs: geometry in px (cells × K), one
//     hotspot per canvas cell with its cell folded in as a literal, and floor-halving peeled bit
//     by bit, because a prototype has no floor.
//   · "hardware" is what src/gates/ turns into 2-input gates: geometry in cells, three pointer
//     events that read the window cell from the inputs in/px, in/py, a bit width on every number,
//     a `half` step (a shift), and feature groups that can be left out to trim the chart.
//
// How an array-and-objects reducer becomes variables:
//   · `layers` is MAX_LAYERS fixed slots, `L0 … L7`, each a record of plain variables. Slot order
//     is z-order, as array order is in the reducer, and `g/n` is how many slots are in use.
//   · There is no `array[i]`, so "the selected layer" is a balanced decision tree over `g/sel`
//     (switchOn). A handler loads what it needs from the selected (or hit, or parent) slot into a
//     scratch record, computes on the scratch, and writes the result back. Only the load and the
//     write-back are per slot, so the gates hold one copy of the arithmetic instead of eight.
//   · The canvas is unbounded and the screen shows a 14 x 10 cell window of it. The window's
//     corner is `v/x`, `v/y` (the reducer keeps no pan: it is view state there too), so the
//     pointer at window cell (cx, cy) is world cell (cx, cy) + corner. On the hardware it is 0, 0.
//   · Everything the screen shows is also a variable (role "view"), kept up to date where it
//     changes, so drawing costs no actions: slot `sel` and `used` flags, `fill` as 16 `f/k` flags
//     (a node per palette color shows when its flag is on), and `rr`, the rendered corner radius.
//   · Helpers wrap their steps in named units: the blocks of the gate-level chart, free in Figma.
//
// Not implemented yet (the tools exist, but a pointer on the canvas does nothing for them): the
// Pen, Paint, Erase, Text and Comment tools, rotation, handle drags under the Scale tool, load,
// image import, and renaming. eventsFor() in codec.ts refuses them so tests never claim otherwise.
import {
  add,
  and,
  bool,
  div,
  eq,
  ge,
  gt,
  half,
  le,
  lt,
  mul,
  ne,
  not,
  num,
  or,
  ref,
  seq,
  set,
  sub,
  switchOn,
  unit,
  when,
  type Expr,
  type FlowEvent,
  type Part,
  type Program,
  type Role,
  type Step,
  type Trigger,
  type VarDecl,
} from "./ir";
import {
  ALIGNS,
  BOOL_FIELDS,
  CORNERS,
  CREATE_TOOLS,
  DEFAULT_K,
  ELLIPSE_RR,
  FEATURES,
  FIELDS,
  FIELD_INIT,
  GRID_H,
  GRID_W,
  MAX_LAYERS,
  PALETTE,
  SELECT_TOOLS,
  STYLE_FIELDS,
  TOOLS,
  TOOL_KEYS,
  WORLD,
  toolCode,
  type Corner,
  type Feature,
  type Tool,
} from "./spec";

/** What the flow is built for: "word" is Figma's variables and conditionals, "hardware" is the
 * input of the gate synthesizer (docs/GATES.md §1). */
export type Target = "word" | "hardware";

export interface EditorOptions {
  /** Default "word". */
  target?: Target;
  /** Pixels per cell: every geometry variable is in px. The hardware target is in cells (K = 1). */
  K?: number;
  /** Feature groups to leave out: their events do not exist and their fields are not declared. */
  omit?: readonly Feature[];
}

export interface Editor extends Program {
  target: Target;
  K: number;
  /** The feature groups left out, in FEATURES order. */
  omit: readonly Feature[];
  /** The screen's window onto the canvas, in cells. */
  grid: { w: number; h: number };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const SLOTS = range(MAX_LAYERS);
const isBoolField = (field: string) =>
  (BOOL_FIELDS as readonly string[]).includes(field);

// ---------- bit widths ----------

/** The whole numbers a variable can hold, lowest and highest. */
type Range = readonly [number, number];

/** The narrowest width that holds every number of a range: two's complement when it goes below 0. */
function widthOf([lo, hi]: Range): { bits: number; signed: boolean } {
  const signed = lo < 0;
  let bits = 1;
  while (
    signed
      ? -(2 ** (bits - 1)) > lo || 2 ** (bits - 1) - 1 < hi
      : 2 ** bits - 1 < hi
  )
    bits++;
  return { bits, signed };
}

/** Layer ids. The reducer's ids grow without bound; 8 bits wrap after 255, so tests keep nextId below 256. */
const ID: Range = [0, 255];

/** How far from the origin a box may reach, in cells: x, y and the drag anchors are signed 12 bits
 * on the hardware. The reducer keeps x and y within ±WORLD except for align, which places a layer
 * anywhere inside its parent, and a frame can stick out past the canvas edge, because the far edge
 * of a box is never clipped. Aligning inside one such frame reaches x = 1037, past signed 11; a
 * chain of them, or pasting copies of the result, goes on without limit, so no width holds every
 * session. The hardware wraps there, as it does for ids. */
const REACH = 4 * WORLD;

/** Width of the hardware's pointer inputs in/px, in/py: the window cell. */
const POINTER_BITS = 4;

// ---------- variable names ----------

/** A record is a function from a field name to a variable name: a slot, the clipboard or a scratch. */
type Rec = (field: string) => string;
const slot =
  (i: number): Rec =>
  (f) =>
    `L${i}/${f}`;
const CLIP: Rec = (f) => `clip/${f}`;
/** The scratch record: the selected (or hit) layer while a handler computes on it. */
const TMP: Rec = (f) => `tmp/${f}`;
/** The scratch for the parent that align places the selection in. */
const PAR: Rec = (f) => `par/${f}`;

const g = {
  tool: ref("g/tool"),
  tCreate: ref("g/tCreate"),
  tSelect: ref("g/tSelect"),
  fill: ref("g/fill"),
  nextId: ref("g/nextId"),
  n: ref("g/n"),
  sel: ref("g/sel"),
  mode: ref("d/mode"),
  a: ref("d/a"),
  b: ref("d/b"),
  clipHas: ref("clip/has"),
  vx: ref("v/x"),
  vy: ref("v/y"),
};
const t = (name: string) => ref(`t/${name}`);
const f = (i: number, field: string) => ref(slot(i)(field));
const tmp = (field: string) => ref(TMP(field));
const par = (field: string) => ref(PAR(field));

const copy = (dst: Rec, src: Rec, which: readonly string[]): Step[] =>
  which.flatMap((field) => set(dst(field), ref(src(field))));

/** All of `xs` as a balanced tree of `and`s, so a long test stays a shallow expression. */
const all = (...xs: Expr[]): Expr =>
  xs.length === 1
    ? xs[0]
    : and(
        all(...xs.slice(0, xs.length >> 1)),
        all(...xs.slice(xs.length >> 1)),
      );

// ---------- the editor ----------

export function buildEditor(opts: EditorOptions = {}): Editor {
  const target = opts.target ?? "word";
  const hw = target === "hardware";
  const K = hw ? 1 : (opts.K ?? DEFAULT_K);
  const omit = FEATURES.filter((feature) => opts.omit?.includes(feature));
  const has = (feature: Feature) => !omit.includes(feature);
  // Rotation is not supported, so `rot` is always 0: the hardware does not keep it.
  const fields = FIELDS.filter(
    (field) =>
      !(hw && field === "rot") &&
      (has("style") || !STYLE_FIELDS.includes(field)),
  );
  const C = (cells: number) => num(cells * K);
  const one = C(1);
  const W = C(WORLD);
  const negW = C(-WORLD);
  const kindIs = (kind: Expr, tool: Tool) => eq(kind, num(toolCode(tool)));
  const isContainer = (kind: Expr) =>
    or(kindIs(kind, "frame"), kindIs(kind, "section"));

  // ---------- variables ----------

  // The pointer's cells: the hardware's window stays at the origin and reads 4-bit inputs; the
  // word-level window can lie anywhere on the canvas.
  const PTR: Range = hw ? [0, 2 ** POINTER_BITS - 1] : [-WORLD, WORLD];
  // A drag spans from the pointer to at most the canvas edge; the w and h steppers stop at WORLD.
  const SIZE: Range = [
    1,
    Math.max(WORLD, PTR[1] + WORLD + 1, WORLD - PTR[0] + 1),
  ];
  const COORD: Range = [-REACH, REACH - 1];
  const px = ([lo, hi]: Range): Range => [lo * K, hi * K];
  const FIELD_RANGE: Record<string, Range> = {
    id: ID,
    kind: [0, TOOLS.length - 1],
    x: px(COORD),
    y: px(COORD),
    w: px(SIZE),
    h: px(SIZE),
    fill: [0, PALETTE.length - 1],
    opacity: [0, 10],
    radius: [0, 4],
    stroke: [-1, PALETTE.length - 1],
    rot: [0, 270],
  };

  const vars: VarDecl[] = [];
  const declare = (
    name: string,
    init: number | boolean,
    role: Role,
    values?: Range,
  ) =>
    vars.push(
      typeof init === "boolean"
        ? { name, ty: "bool", init, role }
        : { name, ty: "num", init, role, ...(values ? widthOf(values) : {}) },
    );
  /** A record of every field. A scratch record is a temp, so it starts at 0 like the others. */
  const record = (rec: Rec, role: Role) => {
    for (const field of fields) {
      const zero = isBoolField(field) ? false : 0;
      declare(
        rec(field),
        role === "temp" ? zero : (FIELD_INIT[field] ?? zero),
        role,
        FIELD_RANGE[field],
      );
    }
  };
  declare("g/tool", toolCode("move"), "state", FIELD_RANGE.kind);
  declare("g/tCreate", false, "state");
  declare("g/tSelect", true, "state");
  declare("g/fill", 12, "state", FIELD_RANGE.fill);
  declare("g/nextId", 1, "state", ID);
  declare("g/n", 0, "state", [0, MAX_LAYERS]);
  declare("g/sel", -1, "state", [-1, MAX_LAYERS - 1]);
  declare("d/mode", 0, "state", [0, 3]);
  declare("d/a", 0, "state", px(COORD));
  declare("d/b", 0, "state", px(COORD));
  if (hw) {
    declare("v/x", 0, "const", [0, 0]);
    declare("v/y", 0, "const", [0, 0]);
    declare("in/px", 0, "input", PTR);
    declare("in/py", 0, "input", PTR);
  } else {
    // Set from outside, as a pan will (no event moves the window yet); it stays on the canvas.
    declare("v/x", 0, "input", px([-WORLD, WORLD - GRID_W + 1]));
    declare("v/y", 0, "input", px([-WORLD, WORLD - GRID_H + 1]));
  }
  if (has("clipboard")) {
    declare("clip/has", false, "state");
    record(CLIP, "state");
  }
  record(TMP, "temp");
  for (const i of SLOTS) {
    record(slot(i), "state");
    for (let k = 0; k < PALETTE.length; k++)
      declare(`L${i}/f/${k}`, false, "view");
    declare(`L${i}/sel`, false, "view");
    declare(`L${i}/used`, false, "view");
    declare(`L${i}/rr`, 0, "view");
  }
  declare("t/hit", 0, "temp", [-1, MAX_LAYERS - 1]);
  declare("t/fill", 0, "temp", FIELD_RANGE.fill);
  declare("t/px", 0, "temp", px(PTR));
  declare("t/py", 0, "temp", px(PTR));
  declare("t/x1", 0, "temp", px(COORD));
  declare("t/y1", 0, "temp", px(COORD));
  // The largest difference of two sizes, in cells: where the word level's floor-halving starts peeling.
  const TOP_BIT = 2 ** Math.floor(Math.log2(SIZE[1] - 1));
  if (has("align")) {
    declare("par/x", 0, "temp", px(COORD));
    declare("par/y", 0, "temp", px(COORD));
    declare("par/w", 0, "temp", px(SIZE));
    declare("par/h", 0, "temp", px(SIZE));
    declare("t/par", 0, "temp", [-1, MAX_LAYERS - 1]);
    declare("t/area", 0, "temp", [0, SIZE[1] * K * SIZE[1] * K]);
    declare("t/v", 0, "temp", px([0, Math.floor((SIZE[1] - 1) / 2)]));
    if (!hw) {
      declare("t/rem", 0, "temp", [0, SIZE[1] - 1]);
      declare("t/q", 0, "temp", [0, Math.floor((SIZE[1] - 1) / 2)]);
    }
  }

  // ---------- building blocks ----------

  /** Slot i's 16 fill flags from its fill: the screen shows the node of the flag that is on. */
  const flags = (i: number): Step[] =>
    range(PALETTE.length).flatMap((k) =>
      set(`L${i}/f/${k}`, eq(f(i, "fill"), num(k))),
    );
  /** Slot i's rendered corner radius: an ellipse is always fully round; any other kind gets a
   * quarter cell per radius step. */
  const roundness = (i: number): Step[] =>
    when(
      kindIs(f(i, "kind"), "ellipse"),
      [set(`L${i}/rr`, num(ELLIPSE_RR))],
      [
        set(
          `L${i}/rr`,
          has("style") ? mul(f(i, "radius"), num(K / 4)) : num(0),
        ),
      ],
    );
  const copyToSlot = (i: number, src: Rec): Step[] =>
    seq(copy(slot(i), src, fields), flags(i), roundness(i));

  /** Sets the selection and the per-row highlight flags. */
  const setSel = (to: Expr): Step[] =>
    unit(
      "select",
      set("g/sel", to),
      SLOTS.flatMap((i) =>
        set(`L${i}/sel`, eq(to.k === "num" ? to : g.sel, num(i))),
      ),
    );

  /** Row `used` flags follow the layer count. */
  const refreshUsed = (): Step[] =>
    SLOTS.flatMap((i) => set(`L${i}/used`, lt(num(i), g.n)));

  const isSelected = ge(g.sel, num(0));
  /** Runs `body(i)` for the selected slot, for writes of fixed values. Does nothing when nothing is selected. */
  const onSelected = (body: (i: number) => Part[]): Step[] =>
    when(isSelected, [switchOn(g.sel, 0, MAX_LAYERS - 1, body)]);
  /** Copies the `which` fields of the slot that `index` holds (the selection) into a scratch record. */
  const load = (
    which: readonly string[],
    index: Expr = g.sel,
    into: Rec = TMP,
  ): Step[] =>
    switchOn(index, 0, MAX_LAYERS - 1, (i) => copy(into, slot(i), which));
  /** Writes the scratch's `which` fields back into the selected slot; `then(i)` updates what the
   * screen derives from them. */
  const store = (
    which: readonly string[],
    then?: (i: number) => Step[],
  ): Step[] =>
    switchOn(g.sel, 0, MAX_LAYERS - 1, (i) =>
      seq(copy(slot(i), TMP, which), then?.(i) ?? []),
    );

  /** dst = min(max(v, lo), hi), as the reducer's `clamp` (lo ≤ hi). v is compared before dst is
   * written, so v may read dst, and on the hardware it keeps its full width until it is stored. */
  const clampInto = (dst: string, v: Expr, lo: Expr, hi: Expr): Step[] =>
    when(
      lt(v, lo),
      [set(dst, lo)],
      [
        when(
          gt(v, hi),
          [set(dst, hi)],
          v.k === "var" && v.name === dst ? [] : [set(dst, v)],
        ),
      ],
    );
  /** The reducer's `world()`: keeps a coordinate on the canvas. */
  const world = (dst: string, v: Expr): Step[] => clampInto(dst, v, negW, W);

  function setTool(tool: Tool): Step[] {
    return unit(
      "tool",
      set("g/tool", num(toolCode(tool))),
      set("g/tCreate", bool(CREATE_TOOLS.includes(tool))),
      set("g/tSelect", bool(SELECT_TOOLS.includes(tool))),
      // The Pen, Paint and Erase tools drop the selection.
      tool === "pen" || tool === "paint" || tool === "erase"
        ? setSel(num(-1))
        : [],
    );
  }

  /** The pointer's world cell into t/px, t/py, from its window cell (cx, cy): a literal on each
   * word-level hotspot, the inputs in/px, in/py on the hardware. */
  const pointer = (cx: Expr, cy: Expr): Step[] =>
    seq(set("t/px", add(cx, g.vx)), set("t/py", add(cy, g.vy)));
  const PX = t("px");
  const PY = t("py");

  /** Topmost visible slot whose box covers the pointer, into t/hit; -1 for none. */
  function hitTest(): Step[] {
    const covers = (i: number) =>
      and(
        f(i, "vis"),
        le(f(i, "x"), PX),
        lt(PX, add(f(i, "x"), f(i, "w"))),
        le(f(i, "y"), PY),
        lt(PY, add(f(i, "y"), f(i, "h"))),
      );
    const chain = (i: number): Step[] =>
      when(covers(i), [set("t/hit", num(i))], i > 0 ? [chain(i - 1)] : []);
    return unit("hit", set("t/hit", num(-1)), chain(MAX_LAYERS - 1));
  }

  /** A new layer of the current tool's kind, one cell big at the pointer, on top and selected;
   * the drag that follows sizes it. */
  function create(): Step[] {
    const rect = (i: number): Step[] =>
      seq(
        set(`L${i}/id`, g.nextId),
        set(`L${i}/kind`, g.tool),
        set(`L${i}/x`, PX),
        set(`L${i}/y`, PY),
        set(`L${i}/w`, one),
        set(`L${i}/h`, one),
        set(`L${i}/fill`, t("fill")),
        set(`L${i}/vis`, bool(true)),
        has("style")
          ? seq(
              set(`L${i}/opacity`, num(10)),
              set(`L${i}/radius`, num(0)),
              set(`L${i}/stroke`, num(-1)),
              set(`L${i}/shadow`, bool(false)),
            )
          : [],
        fields.includes("rot") ? set(`L${i}/rot`, num(0)) : [],
        set(`L${i}/flip`, bool(false)),
        flags(i),
        roundness(i),
      );
    return unit(
      "create",
      // A frame starts white and a section grey, as in the reducer's `blank`; the rest take the current fill.
      when(
        kindIs(g.tool, "frame"),
        [set("t/fill", num(7))],
        [
          when(
            kindIs(g.tool, "section"),
            [set("t/fill", num(6))],
            [set("t/fill", g.fill)],
          ),
        ],
      ),
      switchOn(g.n, 0, MAX_LAYERS - 1, rect),
      setSel(g.n),
      set("g/n", add(g.n, num(1))),
      set("g/nextId", add(g.nextId, num(1))),
      refreshUsed(),
      set("d/mode", num(1)),
      set("d/a", PX),
      set("d/b", PY),
    );
  }

  /** Pointer pressed on the canvas at window cell (cx, cy). */
  function down(cx: Expr, cy: Expr): Step[] {
    return when(
      g.tCreate,
      [
        when(
          ge(g.n, num(MAX_LAYERS)),
          [setTool("move")],
          [pointer(cx, cy), create()],
        ),
      ],
      [
        when(g.tSelect, [
          pointer(cx, cy),
          hitTest(),
          when(
            lt(t("hit"), num(0)),
            [setSel(num(-1))],
            [
              setSel(t("hit")),
              // A move keeps the pointer's offset from the corner of the layer it pressed.
              unit(
                "drag",
                set("d/mode", num(2)),
                load(["x", "y"], t("hit")),
                set("d/a", sub(PX, tmp("x"))),
                set("d/b", sub(PY, tmp("y"))),
              ),
            ],
          ),
        ]),
      ],
    );
  }

  /** One axis of the reducer's `span`: the cells from the anchor `a` to the pointer `p`, inclusive,
   * into the scratch's `pos` and `size`. The reducer clips both ends to the canvas, but only the far
   * one can need it: the pointer is on the canvas, and no anchor is below -WORLD, because no box's
   * x or y ever is (align can put them past the far edge, never the near one). */
  const spanAxis = (
    pos: string,
    size: string,
    a: Expr,
    p: Expr,
    far: string,
  ): Step[] =>
    seq(
      set(TMP(pos), a),
      when(gt(tmp(pos), p), [set(TMP(pos), p)]),
      set(far, a),
      when(lt(ref(far), p), [set(far, p)]),
      when(gt(ref(far), W), [set(far, W)]),
      set(TMP(size), add(sub(ref(far), tmp(pos)), one)),
    );

  /** Pointer moved over window cell (cx, cy) with the button down. */
  function move(cx: Expr, cy: Expr): Step[] {
    return when(and(ne(g.mode, num(0)), isSelected), [
      pointer(cx, cy),
      when(
        eq(g.mode, num(2)),
        [
          unit(
            "drag",
            world("tmp/x", sub(PX, g.a)),
            world("tmp/y", sub(PY, g.b)),
            store(["x", "y"]),
          ),
        ],
        // Creating (mode 1) or resizing (mode 3): the box between the anchor and the pointer.
        [
          unit(
            "span",
            load(["kind", "flip"]),
            spanAxis("x", "w", g.a, PX, "t/x1"),
            spanAxis("y", "h", g.b, PY, "t/y1"),
            // A line or arrow dragged against the diagonal runs bottom-left to top-right.
            when(
              and(
                eq(g.mode, num(1)),
                or(kindIs(tmp("kind"), "line"), kindIs(tmp("kind"), "arrow")),
              ),
              [set("tmp/flip", ne(lt(PX, g.a), lt(PY, g.b)))],
            ),
            store(["x", "y", "w", "h", "flip"]),
          ),
        ],
      ),
    ]);
  }

  /** Pointer released: ends the drag; a drag that created a layer also returns to the Move tool. */
  const up = (): Step[] =>
    when(
      eq(g.mode, num(1)),
      [set("d/mode", num(0)), setTool("move")],
      [set("d/mode", num(0))],
    );

  /** Pointer pressed on a resize handle of the selection: the opposite corner stays fixed. */
  function handleDown(corner: Corner): Step[] {
    const west = corner.includes("w");
    const north = corner.includes("n");
    return unit(
      "handle",
      when(isSelected, [
        load(["x", "y", ...(west ? ["w"] : []), ...(north ? ["h"] : [])]),
        set("d/mode", num(3)),
        set("d/a", west ? sub(add(tmp("x"), tmp("w")), one) : tmp("x")),
        set("d/b", north ? sub(add(tmp("y"), tmp("h")), one) : tmp("y")),
      ]),
    );
  }

  /** Removes the selected layer: every slot above it moves down one. */
  function remove(): Step[] {
    return unit(
      "remove",
      when(isSelected, [
        range(MAX_LAYERS - 1).flatMap((j) =>
          when(le(g.sel, num(j)), [copyToSlot(j, slot(j + 1))]),
        ),
        // With all 8 slots used, slot 7 would keep a stale visible copy.
        set(`L${MAX_LAYERS - 1}/vis`, bool(false)),
        set("g/n", sub(g.n, num(1))),
        setSel(num(-1)),
        refreshUsed(),
      ]),
    );
  }

  /** Swaps the selected layer with its neighbour in z-order; the selection follows it. */
  function reorder(dir: 1 | -1): Step[] {
    const swap = (a: number, b: number): Step[] =>
      seq(
        copy(TMP, slot(a), fields),
        copyToSlot(a, slot(b)),
        copyToSlot(b, TMP),
      );
    return unit(
      "reorder",
      dir === 1
        ? when(and(isSelected, lt(add(g.sel, num(1)), g.n)), [
            switchOn(g.sel, 0, MAX_LAYERS - 2, (i) => swap(i, i + 1)),
            setSel(add(g.sel, num(1))),
          ])
        : when(gt(g.sel, num(0)), [
            switchOn(g.sel, 1, MAX_LAYERS - 1, (i) => swap(i - 1, i)),
            setSel(sub(g.sel, num(1))),
          ]),
    );
  }

  const copySel = (): Step[] =>
    unit(
      "copy",
      when(isSelected, [
        load(fields, g.sel, CLIP),
        set("clip/has", bool(true)),
      ]),
    );

  /** Adds the layer in `src` (a record) on top with a fresh id; selected. */
  const addFrom = (src: Rec): Step[] =>
    seq(
      switchOn(g.n, 0, MAX_LAYERS - 1, (i) =>
        seq(copyToSlot(i, src), set(`L${i}/id`, g.nextId)),
      ),
      setSel(g.n),
      set("g/n", add(g.n, num(1))),
      set("g/nextId", add(g.nextId, num(1))),
      refreshUsed(),
    );

  /** A copy one cell down and to the right of the selection. */
  const duplicate = (): Step[] =>
    unit(
      "duplicate",
      when(and(isSelected, lt(g.n, num(MAX_LAYERS))), [
        load(fields),
        world("tmp/x", add(tmp("x"), one)),
        world("tmp/y", add(tmp("y"), one)),
        addFrom(TMP),
      ]),
    );

  const paste = (): Step[] =>
    unit(
      "paste",
      when(and(g.clipHas, lt(g.n, num(MAX_LAYERS))), [addFrom(CLIP)]),
    );

  /** Moves the selection by (dx, dy) cells. The reducer keeps both coordinates on the canvas, so
   * an arrow key also brings back the other one of a layer that align placed off the canvas. */
  function nudge(dx: number, dy: number): Step[] {
    return unit(
      "nudge",
      when(isSelected, [
        load(["x", "y"]),
        world("tmp/x", add(tmp("x"), C(dx))),
        world("tmp/y", add(tmp("y"), C(dy))),
        store(["x", "y"]),
      ]),
    );
  }

  /** The Properties panel's stepper for one field. */
  function stepProp(
    prop: "x" | "y" | "w" | "h" | "opacity" | "radius",
    dir: 1 | -1,
  ): Step[] {
    const dst = TMP(prop);
    const next = add(
      tmp(prop),
      prop === "opacity" || prop === "radius" ? num(dir) : C(dir),
    );
    const step =
      prop === "x" || prop === "y"
        ? world(dst, next)
        : prop === "w" || prop === "h"
          ? clampInto(dst, next, one, W)
          : clampInto(dst, next, num(0), num(prop === "opacity" ? 10 : 4));
    return unit(
      "prop",
      when(isSelected, [
        load([prop]),
        step,
        store([prop], prop === "radius" ? roundness : undefined),
      ]),
    );
  }

  /** dst = floor(v / 2) cells, for a px value v ≥ 0 that is a whole number of cells (Math.floor in
   * the reducer). The hardware shifts; Figma has no floor, so the word level peels the bits of the
   * cell count from the top. */
  function halve(dst: string, v: Expr): Step[] {
    if (hw) return half(dst, v);
    const peel: Step[] = [];
    for (let b = TOP_BIT; b >= 2; b >>= 1)
      peel.push(
        ...when(ge(t("rem"), num(b)), [
          set("t/rem", sub(t("rem"), num(b))),
          set("t/q", add(t("q"), num(b / 2))),
        ]),
      );
    return seq(
      set("t/rem", div(v, num(K))),
      set("t/q", num(0)),
      peel,
      set(dst, mul(t("q"), num(K))),
    );
  }

  /** Into t/par: the smallest frame or section that fully contains the selected layer (loaded into
   * the scratch), else -1: the reducer's `parentOf`. Ties go to the lowest slot, as `for … of` does
   * there. A container that holds the layer is at least as wide and as tall, so its area is the
   * larger one unless the two boxes are the same; then the lower id is the parent. */
  function findParent(): Step[] {
    const area = (j: number) => mul(f(j, "w"), f(j, "h"));
    const isParent = (j: number) =>
      all(
        lt(num(j), g.n),
        ne(g.sel, num(j)),
        isContainer(f(j, "kind")),
        le(f(j, "x"), tmp("x")),
        le(f(j, "y"), tmp("y")),
        le(add(tmp("x"), tmp("w")), add(f(j, "x"), f(j, "w"))),
        le(add(tmp("y"), tmp("h")), add(f(j, "y"), f(j, "h"))),
        or(
          ne(f(j, "w"), tmp("w")),
          ne(f(j, "h"), tmp("h")),
          lt(f(j, "id"), tmp("id")),
        ),
        or(lt(t("par"), num(0)), lt(area(j), t("area"))),
      );
    return unit(
      "parent",
      set("t/par", num(-1)),
      set("t/area", num(0)),
      SLOTS.flatMap((j) =>
        when(isParent(j), [set("t/par", num(j)), set("t/area", area(j))]),
      ),
    );
  }

  /** Aligns the selection to the frame or section it sits in; a layer on the bare canvas has nothing to align to. */
  function align(to: (typeof ALIGNS)[number]): Step[] {
    const [pos, size] =
      to === "left" || to === "hcenter" || to === "right"
        ? ["x", "w"]
        : ["y", "h"];
    const place =
      to === "left" || to === "top"
        ? set(TMP(pos), par(pos))
        : to === "right" || to === "bottom"
          ? set(TMP(pos), sub(add(par(pos), par(size)), tmp(size)))
          : seq(
              halve("t/v", sub(par(size), tmp(size))),
              set(TMP(pos), add(par(pos), t("v"))),
            );
    return unit(
      "align",
      when(isSelected, [
        load(["x", "y", "w", "h", "id"]),
        findParent(),
        when(ge(t("par"), num(0)), [
          load([pos, size], t("par"), PAR),
          place,
          store([pos]),
        ]),
      ]),
    );
  }

  function newDoc(): Step[] {
    return unit(
      "new",
      set("g/n", num(0)),
      set("g/nextId", num(1)),
      set("g/fill", num(12)),
      set("d/mode", num(0)),
      has("clipboard") ? set("clip/has", bool(false)) : [],
      SLOTS.flatMap((i) => set(`L${i}/vis`, bool(false))),
      setTool("move"),
      setSel(num(-1)),
      refreshUsed(),
    );
  }

  function recolor(index: number): Step[] {
    return unit(
      "recolor",
      set("g/fill", num(index)),
      onSelected((i) => seq(set(`L${i}/fill`, num(index)), flags(i))),
    );
  }

  /** A stroke or shadow button: sets one field of the selection. */
  const style = (field: string, to: Expr): Step[] =>
    unit(
      "style",
      onSelected((i) => set(`L${i}/${field}`, to)),
    );

  // ---------- keys ----------

  const KEY_CODES: Record<string, number> = {
    Delete: 46,
    Backspace: 8,
    Escape: 27,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    "[": 219,
    "]": 221,
  };
  const SHIFT = 16;
  const META = 91;
  const keyCode = (key: string) =>
    KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0);

  // ---------- events ----------

  const events: FlowEvent[] = [];
  const on = (node: string, trigger: Trigger, steps: Step[]) =>
    events.push({ id: `${node}#${trigger.type}`, node, trigger, steps });

  if (hw) {
    // One event of each kind for the whole canvas: the hotspot under the pointer sets in/px, in/py first.
    const cx = ref("in/px");
    const cy = ref("in/py");
    on("pointer", { type: "down" }, down(cx, cy));
    on("pointer", { type: "enter" }, move(cx, cy));
    on("pointer", { type: "up" }, up());
  } else
    for (let cy = 0; cy < GRID_H; cy++)
      for (let cx = 0; cx < GRID_W; cx++) {
        const node = `cell/${cx},${cy}`;
        on(node, { type: "down" }, down(C(cx), C(cy)));
        on(node, { type: "enter" }, move(C(cx), C(cy)));
        on(node, { type: "up" }, up());
      }
  for (const c of CORNERS) on(`handle/${c}`, { type: "down" }, handleDown(c));
  for (const tool of TOOLS)
    on(`tool/${tool}`, { type: "click" }, setTool(tool));
  PALETTE.forEach((_, k) => on(`swatch/${k}`, { type: "click" }, recolor(k)));
  for (const i of SLOTS) {
    on(
      `layer/${i}`,
      { type: "click" },
      when(lt(num(i), g.n), [setSel(num(i))]),
    );
    on(
      `eye/${i}`,
      { type: "click" },
      unit("eye", when(lt(num(i), g.n), [set(`L${i}/vis`, not(f(i, "vis")))])),
    );
  }
  on("select/none", { type: "click" }, setSel(num(-1)));
  if (has("style")) {
    on("stroke/none", { type: "click" }, style("stroke", num(-1)));
    PALETTE.forEach((_, k) =>
      on(`stroke/${k}`, { type: "click" }, style("stroke", num(k))),
    );
    on("shadow/on", { type: "click" }, style("shadow", bool(true)));
    on("shadow/off", { type: "click" }, style("shadow", bool(false)));
  }
  for (const prop of ["x", "y", "w", "h", "opacity", "radius"] as const) {
    if (!has("style") && (prop === "opacity" || prop === "radius")) continue;
    for (const [name, dir] of [
      ["inc", 1],
      ["dec", -1],
    ] as const)
      on(`prop/${prop}/${name}`, { type: "click" }, stepProp(prop, dir));
  }
  if (has("align"))
    for (const to of ALIGNS) on(`align/${to}`, { type: "click" }, align(to));
  on("new", { type: "click" }, newDoc());

  // Keys, on the OS frame. A letter with a leading "shift+" is the shifted key, as in TOOL_KEYS.
  for (const [shortcut, tool] of Object.entries(TOOL_KEYS)) {
    const shift = shortcut.startsWith("shift+");
    const key = shift ? shortcut.slice(6) : shortcut;
    on(
      `key/${shortcut}`,
      { type: "key", keyCodes: shift ? [SHIFT, keyCode(key)] : [keyCode(key)] },
      setTool(tool),
    );
  }
  const keyEvent = (key: string, steps: Step[]) =>
    on(`key/${key}`, { type: "key", keyCodes: [keyCode(key)] }, steps);
  keyEvent("Delete", remove());
  keyEvent("Backspace", remove());
  keyEvent("]", reorder(1));
  keyEvent("[", reorder(-1));
  keyEvent("ArrowLeft", nudge(-1, 0));
  keyEvent("ArrowRight", nudge(1, 0));
  keyEvent("ArrowUp", nudge(0, -1));
  keyEvent("ArrowDown", nudge(0, 1));
  keyEvent(
    "Escape",
    seq(setSel(num(-1)), setTool("move"), set("d/mode", num(0))),
  );
  const metaEvent = (key: string, steps: Step[]) =>
    on(
      `key/meta+${key}`,
      { type: "key", keyCodes: [META, keyCode(key)] },
      steps,
    );
  metaEvent("d", duplicate());
  if (has("clipboard")) {
    metaEvent("c", copySel());
    metaEvent("x", seq(copySel(), remove()));
    metaEvent("v", paste());
  }

  return { vars, events, target, K, omit, grid: { w: GRID_W, h: GRID_H } };
}
