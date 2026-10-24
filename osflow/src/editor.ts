// The Figma OS editor as a flow: os-ui/src/model.ts `reduce`, rewritten as variables and steps
// (ir.ts) that Figma's prototype engine can run. Each handler below mirrors one branch of the
// reducer; test/lockstep.test.ts runs both on random event sequences and compares them.
//
// How an array-and-objects reducer becomes variables:
//   · `layers` is MAX_LAYERS fixed slots, `L0 … L7`, each a record of plain variables. Slot order
//     is z-order, as array order is in the reducer, and `g/n` is how many slots are in use.
//   · There is no `array[i]` in a prototype, so "the selected layer" is a balanced decision tree
//     over `g/sel` (switchOn, 3 conditionals for 8 slots) with one copy of the code per slot.
//   · There are no functions either. A pointer cell is a hotspot frame, so each hotspot carries its
//     own copy of the handler with the cell's x and y folded in as literals.
//   · Everything the screen shows is also a variable, kept up to date at the place it changes, so
//     drawing costs no actions: slot `vis`, `used` and `sel` flags, `fill` as 16 `f/k` flags (a
//     node per palette color shows when its flag is on), and `rr` as the rendered corner radius.
import {
  add,
  and,
  bool,
  eq,
  ge,
  gt,
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
  when,
  type Expr,
  type FlowEvent,
  type Part,
  type Program,
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
  FIELDS,
  FIELD_INIT,
  GRID_H,
  GRID_W,
  MAX_LAYERS,
  NUM_FIELDS,
  PALETTE,
  SELECT_TOOLS,
  TOOLS,
  TOOL_KEYS,
  UNSUPPORTED_TOOLS,
  toolCode,
  type Tool,
} from "./spec";

export interface EditorOptions {
  /** Pixels per cell: every geometry variable is in px. */
  K?: number;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const SLOTS = range(MAX_LAYERS);

// ---------- variable names ----------

/** A record is a function from a field name to a variable name: a slot, the clipboard or the scratch. */
type Rec = (field: string) => string;
const slot =
  (i: number): Rec =>
  (f) =>
    `L${i}/${f}`;
const CLIP: Rec = (f) => `clip/${f}`;
const TMP: Rec = (f) => `tmp/${f}`;

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
};
const t = (name: string) => ref(`t/${name}`);
const f = (i: number, field: string) => ref(slot(i)(field));

const TEMPS = ["hit", "fill", "x0", "x1", "y0", "y1", "v", "rr"];

function declare(): VarDecl[] {
  const d: VarDecl[] = [];
  const v = (name: string, ty: VarDecl["ty"], init: VarDecl["init"]) =>
    d.push({ name, ty, init });
  v("g/tool", "num", toolCode("move"));
  v("g/tCreate", "bool", false);
  v("g/tSelect", "bool", true);
  v("g/fill", "num", 12);
  v("g/nextId", "num", 1);
  v("g/n", "num", 0);
  v("g/sel", "num", -1);
  v("d/mode", "num", 0);
  v("d/a", "num", 0);
  v("d/b", "num", 0);
  v("clip/has", "bool", false);
  for (const rec of [CLIP, TMP])
    for (const field of FIELDS)
      v(
        rec(field),
        (BOOL_FIELDS as readonly string[]).includes(field) ? "bool" : "num",
        FIELD_INIT[field] ??
          ((BOOL_FIELDS as readonly string[]).includes(field) ? false : 0),
      );
  for (const i of SLOTS) {
    for (const field of FIELDS)
      v(
        slot(i)(field),
        (BOOL_FIELDS as readonly string[]).includes(field) ? "bool" : "num",
        FIELD_INIT[field] ??
          ((BOOL_FIELDS as readonly string[]).includes(field) ? false : 0),
      );
    for (let k = 0; k < PALETTE.length; k++) v(`L${i}/f/${k}`, "bool", false);
    v(`L${i}/sel`, "bool", false);
    v(`L${i}/used`, "bool", false);
  }
  for (const name of TEMPS) v(`t/${name}`, "num", 0);
  return d;
}

// ---------- building blocks ----------

const copyRec = (dst: Rec, src: Rec): Step[] =>
  FIELDS.flatMap((field) => set(dst(field), ref(src(field))));

/** Slot i's 16 fill flags from its fill index: the screen shows the node of the flag that is on. */
const deriveFlags = (i: number): Step[] =>
  range(PALETTE.length).flatMap((k) =>
    set(`L${i}/f/${k}`, eq(f(i, "fill"), num(k))),
  );

const copyToSlot = (i: number, src: Rec): Step[] =>
  seq(copyRec(slot(i), src), deriveFlags(i));

/** Sets the selection and the per-row highlight flags. */
function setSel(to: Expr): Step[] {
  return seq(
    set("g/sel", to),
    SLOTS.flatMap((i) =>
      set(`L${i}/sel`, eq(to.k === "num" ? to : g.sel, num(i))),
    ),
  );
}

/** Row `used` flags follow the layer count. */
const refreshUsed = (): Step[] =>
  SLOTS.flatMap((i) => set(`L${i}/used`, lt(num(i), g.n)));

/** Runs `body(i)` for the selected slot. Does nothing when nothing is selected. */
const onSelected = (body: (i: number) => Part[]): Step[] =>
  when(ge(g.sel, num(0)), [switchOn(g.sel, 0, MAX_LAYERS - 1, body)]);

/** dst = min(max(v, lo), hi), as the reducer's `clamp`. lo ≤ hi always holds where it is used. */
const clampInto = (dst: string, v: Expr, lo: Expr, hi: Expr): Step[] =>
  seq(
    set(dst, v),
    when(lt(ref(dst), lo), [set(dst, lo)]),
    when(gt(ref(dst), hi), [set(dst, hi)]),
  );

// ---------- the editor ----------

export interface Editor extends Program {
  K: number;
  /** Cell grid size, for the layout. */
  grid: { w: number; h: number };
}

export function buildEditor(opts: EditorOptions = {}): Editor {
  const K = opts.K ?? DEFAULT_K;
  const C = (cells: number) => num(cells * K);
  const GW = C(GRID_W);
  const GH = C(GRID_H);
  const one = C(1);
  const kindIs = (i: number, tool: Tool) =>
    eq(f(i, "kind"), num(toolCode(tool)));

  function setTool(tool: Tool): Step[] {
    return seq(
      set("g/tool", num(toolCode(tool))),
      set("g/tCreate", bool(CREATE_TOOLS.includes(tool))),
      set("g/tSelect", bool(SELECT_TOOLS.includes(tool))),
      UNSUPPORTED_TOOLS.includes(tool) && tool !== "text" && tool !== "comment"
        ? setSel(num(-1))
        : [],
    );
  }

  /** Topmost visible slot whose box covers the cell (X, Y), into t/hit; -1 for none. */
  function hitTest(X: Expr, Y: Expr): Step[] {
    const covers = (i: number) =>
      and(
        f(i, "vis"),
        le(f(i, "x"), X),
        lt(X, add(f(i, "x"), f(i, "w"))),
        le(f(i, "y"), Y),
        lt(Y, add(f(i, "y"), f(i, "h"))),
      );
    const chain = (i: number): Step[] =>
      when(covers(i), [set("t/hit", num(i))], i > 0 ? [chain(i - 1)] : []);
    return seq(set("t/hit", num(-1)), chain(MAX_LAYERS - 1));
  }

  /** A new layer of the current tool's kind, one cell big at (X, Y), on top; selected. */
  function create(X: Expr, Y: Expr): Step[] {
    const rect = (i: number): Step[] =>
      seq(
        set(`L${i}/id`, g.nextId),
        set(`L${i}/kind`, g.tool),
        set(`L${i}/x`, X),
        set(`L${i}/y`, Y),
        set(`L${i}/w`, one),
        set(`L${i}/h`, one),
        set(`L${i}/fill`, t("fill")),
        set(`L${i}/vis`, bool(true)),
        set(`L${i}/opacity`, num(10)),
        set(`L${i}/radius`, num(0)),
        set(`L${i}/stroke`, num(-1)),
        set(`L${i}/shadow`, bool(false)),
        set(`L${i}/rot`, num(0)),
        set(`L${i}/flip`, bool(false)),
        set(`L${i}/rr`, t("rr")),
        deriveFlags(i),
      );
    return seq(
      // A frame starts white and a section grey, as in the reducer's `blank`; the rest take the current fill.
      when(
        eq(g.tool, num(toolCode("frame"))),
        [set("t/fill", num(7))],
        [
          when(
            eq(g.tool, num(toolCode("section"))),
            [set("t/fill", num(6))],
            [set("t/fill", g.fill)],
          ),
        ],
      ),
      when(
        eq(g.tool, num(toolCode("ellipse"))),
        [set("t/rr", num(ELLIPSE_RR))],
        [set("t/rr", num(0))],
      ),
      switchOn(g.n, 0, MAX_LAYERS - 1, rect),
      setSel(g.n),
      set("g/n", add(g.n, num(1))),
      set("g/nextId", add(g.nextId, num(1))),
      refreshUsed(),
    );
  }

  /** Pointer pressed on the cell (X, Y). */
  function down(X: Expr, Y: Expr): Step[] {
    return when(
      g.tCreate,
      [
        when(
          ge(g.n, num(MAX_LAYERS)),
          [setTool("move")],
          [create(X, Y), set("d/mode", num(1)), set("d/a", X), set("d/b", Y)],
        ),
      ],
      [
        when(g.tSelect, [
          hitTest(X, Y),
          when(
            lt(t("hit"), num(0)),
            [setSel(num(-1))],
            [
              setSel(t("hit")),
              set("d/mode", num(2)),
              switchOn(t("hit"), 0, MAX_LAYERS - 1, (i) =>
                seq(
                  set("d/a", sub(X, f(i, "x"))),
                  set("d/b", sub(Y, f(i, "y"))),
                ),
              ),
            ],
          ),
        ]),
      ],
    );
  }

  /** The box from (ax, ay) to (bx, by), inclusive, into t/x0..t/y1 (the reducer's `span`). */
  const spanTemps = (ax: Expr, ay: Expr, bx: Expr, by: Expr): Step[] =>
    seq(
      set("t/x0", ax),
      when(gt(t("x0"), bx), [set("t/x0", bx)]),
      set("t/x1", ax),
      when(lt(t("x1"), bx), [set("t/x1", bx)]),
      set("t/y0", ay),
      when(gt(t("y0"), by), [set("t/y0", by)]),
      set("t/y1", ay),
      when(lt(t("y1"), by), [set("t/y1", by)]),
    );
  const putSpan = (i: number): Step[] =>
    seq(
      set(`L${i}/x`, t("x0")),
      set(`L${i}/y`, t("y0")),
      set(`L${i}/w`, add(sub(t("x1"), t("x0")), one)),
      set(`L${i}/h`, add(sub(t("y1"), t("y0")), one)),
    );

  /** Pointer moved over the cell (X, Y) with the button down. */
  function move(X: Expr, Y: Expr): Step[] {
    return when(and(ne(g.mode, num(0)), ge(g.sel, num(0))), [
      when(
        eq(g.mode, num(2)),
        [
          onSelected((i) =>
            seq(
              clampInto(`L${i}/x`, sub(X, g.a), num(0), sub(GW, f(i, "w"))),
              clampInto(`L${i}/y`, sub(Y, g.b), num(0), sub(GH, f(i, "h"))),
            ),
          ),
        ],
        [
          when(
            eq(g.mode, num(1)),
            [
              spanTemps(g.a, g.b, X, Y),
              onSelected((i) =>
                seq(
                  putSpan(i),
                  // A line or arrow dragged against the diagonal runs bottom-left to top-right.
                  when(or(kindIs(i, "line"), kindIs(i, "arrow")), [
                    set(`L${i}/flip`, ne(lt(X, g.a), lt(Y, g.b))),
                  ]),
                ),
              ),
            ],
            [
              when(eq(g.mode, num(3)), [
                spanTemps(g.a, g.b, X, Y),
                onSelected(putSpan),
              ]),
            ],
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
  function handleDown(corner: (typeof CORNERS)[number]): Step[] {
    return onSelected((i) =>
      seq(
        set("d/mode", num(3)),
        set(
          "d/a",
          corner.includes("w")
            ? sub(add(f(i, "x"), f(i, "w")), one)
            : f(i, "x"),
        ),
        set(
          "d/b",
          corner.includes("n")
            ? sub(add(f(i, "y"), f(i, "h")), one)
            : f(i, "y"),
        ),
      ),
    );
  }

  /** Removes the selected layer: every slot above it moves down one. */
  function remove(): Step[] {
    return when(ge(g.sel, num(0)), [
      range(MAX_LAYERS - 1).flatMap((j) =>
        when(le(g.sel, num(j)), [copyToSlot(j, slot(j + 1))]),
      ),
      // With all 8 slots used, slot 7 would keep a stale visible copy.
      set(`L${MAX_LAYERS - 1}/vis`, bool(false)),
      set("g/n", sub(g.n, num(1))),
      setSel(num(-1)),
      refreshUsed(),
    ]);
  }

  /** Swaps the selected layer with its neighbour in z-order; the selection follows it. */
  function reorder(dir: 1 | -1): Step[] {
    const swap = (a: number, b: number): Step[] =>
      seq(copyRec(TMP, slot(a)), copyToSlot(a, slot(b)), copyToSlot(b, TMP));
    return dir === 1
      ? when(and(ge(g.sel, num(0)), lt(add(g.sel, num(1)), g.n)), [
          switchOn(g.sel, 0, MAX_LAYERS - 2, (i) => swap(i, i + 1)),
          setSel(add(g.sel, num(1))),
        ])
      : when(gt(g.sel, num(0)), [
          switchOn(g.sel, 1, MAX_LAYERS - 1, (i) => swap(i - 1, i)),
          setSel(sub(g.sel, num(1))),
        ]);
  }

  const copySel = (): Step[] =>
    when(ge(g.sel, num(0)), [
      switchOn(g.sel, 0, MAX_LAYERS - 1, (i) => copyRec(CLIP, slot(i))),
      set("clip/has", bool(true)),
    ]);

  /** Adds the layer in `src` (a record) on top with a fresh id; selected. */
  const addFrom = (src: Rec, place?: (i: number) => Step[]): Step[] => [
    switchOn(g.n, 0, MAX_LAYERS - 1, (i) =>
      seq(copyToSlot(i, src), set(`L${i}/id`, g.nextId), place?.(i) ?? []),
    ),
    setSel(g.n),
    set("g/n", add(g.n, num(1))),
    set("g/nextId", add(g.nextId, num(1))),
    refreshUsed(),
  ];

  const duplicate = (): Step[] =>
    when(and(ge(g.sel, num(0)), lt(g.n, num(MAX_LAYERS))), [
      switchOn(g.sel, 0, MAX_LAYERS - 1, (i) => copyRec(TMP, slot(i))),
      addFrom(TMP, (i) =>
        seq(
          clampInto(
            `L${i}/x`,
            add(ref("tmp/x"), one),
            num(0),
            sub(GW, ref("tmp/w")),
          ),
          clampInto(
            `L${i}/y`,
            add(ref("tmp/y"), one),
            num(0),
            sub(GH, ref("tmp/h")),
          ),
        ),
      ),
    ]);

  const paste = (): Step[] =>
    when(and(g.clipHas, lt(g.n, num(MAX_LAYERS))), addFrom(CLIP));

  /** Moves the selection by (dx, dy) cells, staying on the canvas. */
  const nudge = (dx: number, dy: number): Step[] =>
    onSelected((i) =>
      seq(
        dx
          ? clampInto(
              `L${i}/x`,
              add(f(i, "x"), C(dx)),
              num(0),
              sub(GW, f(i, "w")),
            )
          : [],
        dy
          ? clampInto(
              `L${i}/y`,
              add(f(i, "y"), C(dy)),
              num(0),
              sub(GH, f(i, "h")),
            )
          : [],
      ),
    );

  /** The Properties panel's stepper for one field. */
  function stepProp(
    prop: "x" | "y" | "w" | "h" | "opacity" | "radius",
    dir: 1 | -1,
  ): Step[] {
    return onSelected((i) => {
      const dst = `L${i}/${prop}`;
      switch (prop) {
        case "x":
          return clampInto(
            dst,
            add(f(i, "x"), C(dir)),
            num(0),
            sub(GW, f(i, "w")),
          );
        case "y":
          return clampInto(
            dst,
            add(f(i, "y"), C(dir)),
            num(0),
            sub(GH, f(i, "h")),
          );
        case "w":
          return clampInto(
            dst,
            add(f(i, "w"), C(dir)),
            one,
            sub(GW, f(i, "x")),
          );
        case "h":
          return clampInto(
            dst,
            add(f(i, "h"), C(dir)),
            one,
            sub(GH, f(i, "y")),
          );
        case "opacity":
          return clampInto(
            dst,
            add(f(i, "opacity"), num(dir)),
            num(0),
            num(10),
          );
        case "radius":
          return seq(
            clampInto(dst, add(f(i, "radius"), num(dir)), num(0), num(4)),
            // An ellipse is always fully round; any other kind gets a quarter cell per step.
            when(ne(f(i, "kind"), num(toolCode("ellipse"))), [
              set(`L${i}/rr`, mul(f(i, "radius"), num(K / 4))),
            ]),
          );
      }
    });
  }

  /** floor(v / 2) for a px value that is a whole number of cells (the reducer's Math.floor). */
  const halfInto = (dst: string, v: Expr, cells: number): Step[] =>
    switchOn(div0(v), 0, cells, (c) => set(dst, num(Math.floor(c / 2) * K)));
  const div0 = (v: Expr): Expr => ({ k: "op", fn: "div", a: v, b: num(K) });

  function align(to: (typeof ALIGNS)[number]): Step[] {
    return onSelected((i) => {
      switch (to) {
        case "left":
          return set(`L${i}/x`, num(0));
        case "right":
          return set(`L${i}/x`, sub(GW, f(i, "w")));
        case "top":
          return set(`L${i}/y`, num(0));
        case "bottom":
          return set(`L${i}/y`, sub(GH, f(i, "h")));
        case "hcenter":
          return seq(
            halfInto("t/v", sub(GW, f(i, "w")), GRID_W),
            set(`L${i}/x`, t("v")),
          );
        case "vcenter":
          return seq(
            halfInto("t/v", sub(GH, f(i, "h")), GRID_H),
            set(`L${i}/y`, t("v")),
          );
      }
    });
  }

  function newDoc(): Step[] {
    return seq(
      set("g/n", num(0)),
      set("g/nextId", num(1)),
      set("g/fill", num(12)),
      set("d/mode", num(0)),
      set("clip/has", bool(false)),
      SLOTS.flatMap((i) => set(`L${i}/vis`, bool(false))),
      setTool("move"),
      setSel(num(-1)),
      refreshUsed(),
    );
  }

  function recolor(index: number): Step[] {
    return seq(
      set("g/fill", num(index)),
      onSelected((i) => seq(set(`L${i}/fill`, num(index)), deriveFlags(i))),
    );
  }

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

  for (let cy = 0; cy < GRID_H; cy++)
    for (let cx = 0; cx < GRID_W; cx++) {
      const X = C(cx);
      const Y = C(cy);
      const node = `cell/${cx},${cy}`;
      on(node, { type: "down" }, down(X, Y));
      on(node, { type: "enter" }, move(X, Y));
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
      when(lt(num(i), g.n), [set(`L${i}/vis`, not(f(i, "vis")))]),
    );
  }
  on("select/none", { type: "click" }, setSel(num(-1)));
  on(
    "stroke/none",
    { type: "click" },
    onSelected((i) => set(`L${i}/stroke`, num(-1))),
  );
  PALETTE.forEach((_, k) =>
    on(
      `stroke/${k}`,
      { type: "click" },
      onSelected((i) => set(`L${i}/stroke`, num(k))),
    ),
  );
  on(
    "shadow/on",
    { type: "click" },
    onSelected((i) => set(`L${i}/shadow`, bool(true))),
  );
  on(
    "shadow/off",
    { type: "click" },
    onSelected((i) => set(`L${i}/shadow`, bool(false))),
  );
  for (const prop of ["x", "y", "w", "h", "opacity", "radius"] as const)
    for (const [name, dir] of [
      ["inc", 1],
      ["dec", -1],
    ] as const)
      on(`prop/${prop}/${name}`, { type: "click" }, stepProp(prop, dir));
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
  metaEvent("c", copySel());
  metaEvent("x", seq(copySel(), remove()));
  metaEvent("v", paste());

  return { vars: declare(), events, K, grid: { w: GRID_W, h: GRID_H } };
}
