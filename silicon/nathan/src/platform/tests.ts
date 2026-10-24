// Platform tests: small prototypes that check, in YOUR Figma, the behaviours CPU NATHAN's design
// relies on and that nobody has measured yet. Each test is its own top-level frame with its own
// flow (▶ Present → pick the flow). Every frame says what to do and what PASS looks like. If a
// test crashes the viewer, close it and pick the next flow: the tests are independent.
//
//   1  size        how many actions one click may execute (the viewer's real limit)
//   2  big         a reaction with a huge list that mostly does not run (is a big file accepted?)
//   3  nesting     if inside if (the editor can't author it; does the viewer run it?) and else-if
//   4  hover       MOUSE_ENTER stores which cell the pointer is on
//   5  bubbling    a click on a child that only has a hover reaction reaches its parent's click
//   6  pass-through a click through an overlay that has no reactions reaches the button below
//   7  switching   of two stacked click layers only the visible one takes the click
//   8  spacers     hidden frames in an auto layout take no room (positions come from this)
//   9  keys        ON_KEY_DOWN for the shortcut keys the editor uses
//  10  triple      one click fires MOUSE_DOWN then MOUSE_UP (and whether ON_CLICK fires as well)
//  11  placement   the editor's own layer structure: a rectangle and its colour from register bits
//  12  key layers  a key on a layer inside the frame: does it fire, and does it when the layer is hidden?
//  13  key pick    eight stacked layers with the same key, one shown by 3 bits: the shown one takes it
import {
  aliasData,
  boolData,
  concatText,
  conditional,
  exprData,
  floatData,
  increment,
  keyDown,
  mouseDown,
  mouseEnter,
  mouseUp,
  onClick,
  setVariable,
  strData,
} from "../../../src/prototype/figma-actions";
import {
  COLORS,
  box,
  button,
  createVariables,
  loadFonts,
  put,
  removeCollections,
  setFlows,
  text,
  type VariableSpec,
} from "../../../src/prototype/draw";
import { render } from "../ui/render";
import { colourPick, PALETTE_HEX, pick, placedBy, type NodeSpec } from "../ui/spec";

export const TEST_COLLECTION = "NATHAN tests";
export const TEST_PREFIX = "NATHAN test ";

export interface TestInfo {
  id: string;
  title: string;
  how: string;
}

const W = 520;
const H = 340;

interface Ctx {
  api: PluginAPI;
  page: PageNode;
  v: Map<string, Variable>;
  frames: FrameNode[];
  info: TestInfo[];
  at: { x: number; y: number };
}

const id = (ctx: Ctx, name: string) => ctx.v.get(name)!.id;

/** The variables every test needs, created in one go. */
function variableSpecs(): VariableSpec[] {
  const specs: VariableSpec[] = [];
  const counter = (n: string) =>
    specs.push(
      { name: `${n}`, type: "FLOAT", init: 0 },
      { name: `${n}/text`, type: "STRING", init: "0" },
    );
  counter("t1/n");
  counter("t2/n");
  counter("t3/n");
  specs.push(
    { name: "t3/a", type: "BOOLEAN", init: true },
    { name: "t3/b", type: "BOOLEAN", init: true },
    { name: "t3/c", type: "BOOLEAN", init: false },
  );
  specs.push(
    { name: "t4/cx", type: "FLOAT", init: -1 },
    { name: "t4/cy", type: "FLOAT", init: -1 },
    { name: "t4/text", type: "STRING", init: "pointer: –" },
  );
  counter("t5/parent");
  counter("t5/control");
  counter("t6/n");
  specs.push(
    { name: "t7/sel", type: "BOOLEAN", init: true },
    { name: "t7/notsel", type: "BOOLEAN", init: false },
  );
  counter("t7/a");
  counter("t7/b");
  for (let i = 0; i < 4; i++)
    specs.push({ name: `t8/b${i}`, type: "BOOLEAN", init: false });
  for (const k of ["a", "delete", "left", "bracket"]) counter(`t9/${k}`);
  specs.push({ name: "t10/seq", type: "STRING", init: "" });
  for (const r of PLACE_REGS)
    for (let i = 0; i < 4; i++)
      specs.push({ name: `t11/${r}/${i}`, type: "BOOLEAN", init: r === "nf" });
  for (const c of PLACE_CASES)
    specs.push({ name: `t11/case/${c.name}`, type: "BOOLEAN", init: false });
  for (const k of KEY_LAYERS) counter(`t12/${k.name}`);
  specs.push({ name: "t12/off", type: "BOOLEAN", init: false });
  for (let i = 0; i < 3; i++)
    specs.push(
      { name: `t13/b${i}`, type: "BOOLEAN", init: false },
      { name: `t13/n${i}`, type: "BOOLEAN", init: true },
    );
  specs.push({ name: "t13/which", type: "STRING", init: "–" });
  return specs;
}

const bindText = (t: TextNode, v: Variable) =>
  t.setBoundVariable("characters", v);
const num = (
  ctx: Ctx,
  f: FrameNode,
  name: string,
  x: number,
  y: number,
  size = 28,
) => {
  const t = put(
    f,
    text(ctx.api, "0", {
      size,
      bold: true,
      color: COLORS.amber,
      name: `value/${name}`,
    }),
    x,
    y,
  );
  bindText(t, ctx.v.get(`${name}/text`)!);
  return t;
};

/** A test frame: title, what to do, what passes. */
function testFrame(
  ctx: Ctx,
  n: number,
  title: string,
  how: string,
  pass: string,
): FrameNode {
  const f = box(ctx.api, `${TEST_PREFIX}${n} · ${title}`, W, H, COLORS.bg, 12);
  f.clipsContent = true;
  const col = (n - 1) % 3;
  const row = Math.floor((n - 1) / 3);
  put(ctx.page, f, ctx.at.x + col * (W + 60), ctx.at.y + row * (H + 60));
  put(f, text(ctx.api, `${n} · ${title}`, { size: 18, bold: true }), 20, 16);
  put(
    f,
    text(ctx.api, how, { size: 12, color: COLORS.dim, name: "how" }),
    20,
    46,
  );
  put(
    f,
    text(ctx.api, `PASS: ${pass}`, {
      size: 12,
      bold: true,
      color: COLORS.lampOn,
      name: "pass",
    }),
    20,
    H - 34,
  );
  ctx.frames.push(f);
  ctx.info.push({
    id: String(n),
    title: `${n} · ${title}`,
    how: `${how} PASS: ${pass}`,
  });
  return f;
}

const react = (
  node: SceneNode & ReactionMixin,
  trigger: Reaction["trigger"],
  actions: Action[],
) => node.setReactionsAsync([{ trigger, actions }]);
const bump = (ctx: Ctx, name: string): Action[] => [
  increment(id(ctx, name)),
  concatText(id(ctx, `${name}/text`), id(ctx, name)),
];

// ---------- the tests ----------

/** 1 · size: N increments in one click. */
async function size(ctx: Ctx) {
  const f = testFrame(
    ctx,
    1,
    "actions per click",
    "Click each button once, smallest first. The number must grow by the button's N. Note the largest N that works and the first that fails (a crash, or nothing).",
    "the number grows by N, with no error",
  );
  num(ctx, f, "t1/n", 400, 16);
  const ladder = [100, 300, 500, 800, 1100, 1500, 2000];
  for (let i = 0; i < ladder.length; i++) {
    const b = put(
      f,
      button(ctx.api, `${ladder[i]}`, COLORS.step, 112, 40),
      20 + (i % 4) * 124,
      100 + Math.floor(i / 4) * 56,
    );
    // N - 1 increments and the text update = N actions executed
    const acts: Action[] = [];
    for (let k = 0; k < ladder[i] - 1; k++)
      acts.push(increment(id(ctx, "t1/n")));
    acts.push(concatText(id(ctx, "t1/n/text"), id(ctx, "t1/n")));
    await react(b, onClick(), acts);
  }
  const reset = put(
    f,
    button(ctx.api, "reset", COLORS.reset, 112, 36),
    20,
    250,
  );
  await react(reset, onClick(), [
    setVariable(id(ctx, "t1/n"), floatData(0)),
    setVariable(id(ctx, "t1/n/text"), strData("0")),
  ]);
}

/** 2 · big: a reaction of N actions of which one runs. */
async function big(ctx: Ctx) {
  const f = testFrame(
    ctx,
    2,
    "a big reaction that mostly does not run",
    "Click each button once. Each reaction is that many actions long, but all except one sit behind an `if` that is false.",
    "the number grows by 1 per click and the file stays responsive",
  );
  num(ctx, f, "t2/n", 400, 16);
  const sizes = [2000, 10000, 30000];
  for (let i = 0; i < sizes.length; i++) {
    const b = put(
      f,
      button(ctx.api, `${sizes[i]}`, COLORS.run, 112, 40),
      20 + i * 124,
      100,
    );
    const skipped: Action[] = [];
    for (let k = 0; k < sizes[i]; k++) skipped.push(increment(id(ctx, "t2/n")));
    await react(b, onClick(), [
      ...bump(ctx, "t2/n"),
      conditional(boolData(false), skipped),
    ]);
  }
}

/** 3 · nesting. */
async function nesting(ctx: Ctx) {
  const f = testFrame(
    ctx,
    3,
    "if inside if, and else-if",
    "Click each button. The number grows by 1 when the reaction ran its innermost action. (The editor cannot author these; the plugin can, but does the viewer run them?)",
    "all four buttons add 1",
  );
  num(ctx, f, "t3/n", 400, 16);
  const yes = (name: string) =>
    exprData("EQUALS", [aliasData(id(ctx, name)), boolData(true)]);
  const cases: Array<[string, Action[]]> = [
    ["if", [conditional(yes("t3/a"), bump(ctx, "t3/n"))]],
    [
      "if in if",
      [conditional(yes("t3/a"), [conditional(yes("t3/b"), bump(ctx, "t3/n"))])],
    ],
    [
      "3 deep",
      [
        conditional(yes("t3/a"), [
          conditional(yes("t3/b"), [
            conditional(yes("t3/a"), bump(ctx, "t3/n")),
          ]),
        ]),
      ],
    ],
    [
      "else-if",
      [
        {
          type: "CONDITIONAL",
          conditionalBlocks: [
            { condition: yes("t3/c"), actions: [] },
            { condition: yes("t3/b"), actions: bump(ctx, "t3/n") },
            { actions: [] },
          ],
        } as Action,
      ],
    ],
  ];
  for (let i = 0; i < cases.length; i++) {
    const b = put(
      f,
      button(ctx.api, cases[i][0], COLORS.step, 112, 40),
      20 + (i % 4) * 124,
      110,
    );
    // the real setReactionsAsync refuses some of these shapes; that refusal IS the result
    try {
      await react(b, onClick(), cases[i][1]);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      put(f, text(ctx.api, `refused by Figma:\n${why.slice(0, 60)}`, { size: 10, color: COLORS.stop, name: "refused" }), 20 + (i % 4) * 124, 156);
    }
  }
}

/** 4 · hover. */
async function hover(ctx: Ctx) {
  const f = testFrame(
    ctx,
    4,
    "hover stores the cell",
    "Move the pointer over the grid.",
    "the text follows the pointer and shows the cell under it",
  );
  const t = put(
    f,
    text(ctx.api, "pointer: –", {
      size: 22,
      bold: true,
      color: COLORS.amber,
      name: "value",
    }),
    300,
    100,
  );
  bindText(t, ctx.v.get("t4/text")!);
  const n = 5;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const cell = put(
        f,
        box(
          ctx.api,
          `cell/${c},${r}`,
          44,
          44,
          (c + r) % 2 ? COLORS.panel : COLORS.lampOff,
          4,
        ),
        20 + c * 48,
        80 + r * 48,
      );
      await react(cell, mouseEnter(0), [
        setVariable(id(ctx, "t4/cx"), floatData(c)),
        setVariable(id(ctx, "t4/cy"), floatData(r)),
        setVariable(id(ctx, "t4/text"), strData(`pointer: ${c}, ${r}`)),
      ]);
    }
}

/** 5 · bubbling. */
async function bubbling(ctx: Ctx) {
  const f = testFrame(
    ctx,
    5,
    "a click on a child reaches the parent",
    "Click the cells of the left grid (their only reaction is a hover). Then click the cells of the right grid (no reaction at all).",
    "BOTH numbers grow with every click (the click reached the parent frame)",
  );
  num(ctx, f, "t5/parent", 340, 16, 24);
  num(ctx, f, "t5/control", 440, 16, 24);
  const makeGrid = async (
    name: string,
    x: number,
    withHover: boolean,
    counter: string,
  ) => {
    const parent = put(
      f,
      box(ctx.api, name, 150, 150, COLORS.panel, 6),
      x,
      100,
    );
    parent.clipsContent = true;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const cell = put(
          parent,
          box(ctx.api, `cell/${c},${r}`, 44, 44, COLORS.lampOff, 4),
          2 + c * 48,
          2 + r * 48,
        );
        if (withHover)
          await react(cell, mouseEnter(0), [
            setVariable(id(ctx, "t4/cx"), floatData(c)),
          ]);
      }
    await react(parent, onClick(), bump(ctx, counter));
  };
  await makeGrid("grid-with-hover-children", 20, true, "t5/parent");
  await makeGrid("grid-plain-children", 200, false, "t5/control");
}

/** 6 · pass-through. */
async function passThrough(ctx: Ctx) {
  const f = testFrame(
    ctx,
    6,
    "click through a layer with no reactions",
    "Click the blue button, and the part of it that a see-through overlay covers.",
    "the number grows for clicks on the covered part too",
  );
  num(ctx, f, "t6/n", 400, 16);
  const b = put(
    f,
    button(ctx.api, "button (click me)", COLORS.step, 240, 120),
    40,
    100,
  );
  await react(b, onClick(), bump(ctx, "t6/n"));
  const overlay = put(
    f,
    box(ctx.api, "overlay (no reactions)", 160, 120, COLORS.panel, 0),
    40,
    100,
  );
  overlay.fills = [];
  overlay.strokes = [{ type: "SOLID", color: { r: 1, g: 0.7, b: 0 } }];
  overlay.strokeWeight = 2;
  put(
    f,
    text(ctx.api, "orange outline = the covering overlay", {
      size: 11,
      color: COLORS.dim,
    }),
    40,
    228,
  );
}

/** 7 · switching. */
async function switching(ctx: Ctx) {
  const f = testFrame(
    ctx,
    7,
    "only the visible click layer takes the click",
    "Click the square again and again, always on the same spot. It changes colour each time.",
    "the two numbers alternate: 1,0 then 1,1 then 2,1 …",
  );
  num(ctx, f, "t7/a", 340, 16, 24);
  num(ctx, f, "t7/b", 440, 16, 24);
  const a = put(
    f,
    box(ctx.api, "A (visible while sel)", 160, 160, "#2f6fed", 8),
    60,
    100,
  );
  const b = put(
    f,
    box(ctx.api, "B (visible while not sel)", 160, 160, "#1f9d55", 8),
    60,
    100,
  );
  a.setBoundVariable("visible", ctx.v.get("t7/sel")!);
  b.setBoundVariable("visible", ctx.v.get("t7/notsel")!);
  await react(a, onClick(), [
    ...bump(ctx, "t7/a"),
    setVariable(id(ctx, "t7/sel"), boolData(false)),
    setVariable(id(ctx, "t7/notsel"), boolData(true)),
  ]);
  await react(b, onClick(), [
    ...bump(ctx, "t7/b"),
    setVariable(id(ctx, "t7/sel"), boolData(true)),
    setVariable(id(ctx, "t7/notsel"), boolData(false)),
  ]);
}

/** 8 · spacers: the mechanism that places every layer on the editor canvas. */
async function spacers(ctx: Ctx) {
  const f = testFrame(
    ctx,
    8,
    "hidden frames take no room",
    "Toggle the four bits. The orange bar must start at 20 px × (value of the bits: b0=1 b1=2 b2=4 b3=8). The dark bar is the scale, 20 px per step.",
    "the bar slides when you toggle, as the bits' value × 20 px",
  );
  const scale = put(
    f,
    box(ctx.api, "scale", 16 * 20, 6, COLORS.lampOff, 0),
    40,
    150,
  );
  scale.name = "scale (0 … 15 steps of 20 px)";
  const row = ctx.api.createFrame();
  row.name = "row";
  row.fills = [];
  row.layoutMode = "HORIZONTAL";
  row.itemSpacing = 0;
  row.paddingLeft = row.paddingRight = row.paddingTop = row.paddingBottom = 0;
  put(f, row, 40, 110);
  row.resize(340, 30);
  row.layoutSizingHorizontal = "FIXED";
  row.layoutSizingVertical = "FIXED";
  for (let i = 0; i < 4; i++) {
    const seg = ctx.api.createFrame();
    seg.name = `seg${i}`;
    seg.fills = [];
    seg.resize(20 << i, 30);
    row.appendChild(seg);
    seg.layoutSizingHorizontal = "FIXED";
    seg.layoutSizingVertical = "FIXED";
    seg.setBoundVariable("visible", ctx.v.get(`t8/b${i}`)!);
  }
  const bar = ctx.api.createRectangle();
  bar.name = "bar";
  bar.fills = [{ type: "SOLID", color: { r: 1, g: 0.65, b: 0 } }];
  bar.resize(60, 30);
  row.appendChild(bar);
  bar.layoutSizingHorizontal = "FIXED";
  bar.layoutSizingVertical = "FIXED";
  for (let i = 0; i < 4; i++) {
    const b = put(
      f,
      button(ctx.api, `b${i} = ${1 << i}`, COLORS.step, 100, 40),
      40 + i * 110,
      200,
    );
    await react(b, onClick(), [
      setVariable(
        id(ctx, `t8/b${i}`),
        exprData("NOT", [aliasData(id(ctx, `t8/b${i}`))]),
      ),
    ]);
  }
}

/** 9 · keys. */
async function keys(ctx: Ctx) {
  const f = testFrame(
    ctx,
    9,
    "keyboard shortcuts",
    "Click once inside the frame so it has focus, then press: A, Delete, ← (left arrow), ] (right bracket).",
    "each key adds 1 to its own number",
  );
  // one key per reaction: a keyCodes list is a chord (all keys held at once)
  const table: Array<[string, number[][], string]> = [
    ["A", [[65]], "t9/a"],
    ["Delete or Backspace", [[46], [8]], "t9/delete"],
    ["←", [[37]], "t9/left"],
    ["]", [[221]], "t9/bracket"],
  ];
  const reactions: Reaction[] = [];
  table.forEach(([label, keys, name], i) => {
    put(
      f,
      text(ctx.api, label, { size: 13, color: COLORS.dim }),
      40,
      100 + i * 44,
    );
    num(ctx, f, name, 240, 92 + i * 44, 24);
    for (const codes of keys)
      reactions.push({ trigger: keyDown(codes), actions: bump(ctx, name) });
  });
  await f.setReactionsAsync(reactions);
}

/** 10 · one click = mouse down + mouse up (a click too long for one event is split across them). On a
 * layer that also has an ON_CLICK, Figma desktop fires only the first two (measured), which button 2
 * shows. */
async function triple(ctx: Ctx) {
  const f = testFrame(
    ctx,
    10,
    "one click is two events",
    "Click each button a few times.",
    "button 1 appends D U for every click (button 2 shows whether C also fires)",
  );
  const t = put(f, text(ctx.api, "", { size: 22, bold: true, color: COLORS.amber, name: "value" }), 20, 160);
  t.setBoundVariable("characters", ctx.v.get("t10/seq")!);
  const add = (letter: string): Action[] => [
    setVariable(
      id(ctx, "t10/seq"),
      exprData("ADDITION", [aliasData(id(ctx, "t10/seq"), "STRING"), strData(letter)], "STRING"),
    ),
  ];
  const one = put(f, button(ctx.api, "1: down + up", COLORS.step, 160, 44), 20, 100);
  await one.setReactionsAsync([
    { trigger: mouseDown(0), actions: add("D") },
    { trigger: mouseUp(0), actions: add("U ") },
  ]);
  const two = put(f, button(ctx.api, "2: down + up + click", COLORS.run, 200, 44), 200, 100);
  await two.setReactionsAsync([
    { trigger: mouseDown(0), actions: add("d") },
    { trigger: mouseUp(0), actions: add("u") },
    { trigger: onClick(), actions: add("c") },
    ]);
}

const PLACE_REGS = ["x0", "x1", "y0", "y1", "f", "nf"] as const;
/** Rectangles to try, with odd and even bits in every coordinate (x1, y1 exclusive), and colours. */
const PLACE_CASES = [
  { name: "A", x0: 1, x1: 5, y0: 1, y1: 4, f: 8, colour: "red" },
  { name: "B", x0: 3, x1: 11, y0: 5, y1: 7, f: 10, colour: "yellow" },
  { name: "C", x0: 0, x1: 14, y0: 0, y1: 10, f: 3, colour: "green" },
];

/** 11 · the editor's screen structure: a rectangle placed by spacer frames bound to four 4-bit
 * registers, its colour picked by a tree on 4 bits and their inverses (the same spec builders). */
async function placement(ctx: Ctx) {
  const f = testFrame(
    ctx,
    11,
    "a rectangle from register bits",
    "Click case A, B and C. Each sets 24 bits; the layout alone draws the rectangle.",
    "the coloured rectangle exactly fills the dashed outline, in the colour named",
  );
  const U = 20;
  const grid = put(f, box(ctx.api, "grid", 14 * U, 10 * U, COLORS.lampOff, 0), 20, 96);
  grid.clipsContent = false;
  const net = (r: string) => (i: number) => `t11/${r}/${i}`;
  await render(
    { api: ctx.api, variable: (n) => ctx.v.get(n), reactionsFor: () => [] },
    grid,
    placedBy("rect", { x0: net("x0"), x1: net("x1"), y0: net("y0"), y1: net("y1") }, U, {
      ...colourPick(net("f"), net("nf")),
      name: "body",
    }),
  );
  for (const c of PLACE_CASES) {
    const show = ctx.v.get(`t11/case/${c.name}`)!;
    const outline = put(grid, box(ctx.api, `expect ${c.name}`, (c.x1 - c.x0) * U, (c.y1 - c.y0) * U, COLORS.bg, 0), c.x0 * U, c.y0 * U);
    outline.fills = [];
    outline.strokes = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    outline.strokeWeight = 2;
    outline.dashPattern = [6, 4];
    outline.setBoundVariable("visible", show);
    const note = put(f, text(ctx.api, `${c.name}: ${c.colour} (${PALETTE_HEX[c.f]})`, { size: 12, bold: true, name: `colour ${c.name}` }), 320, 150);
    note.setBoundVariable("visible", show);
  }
  for (let n = 0; n < PLACE_CASES.length; n++) {
    const c = PLACE_CASES[n];
    const value: Record<string, number> = { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, f: c.f, nf: ~c.f };
    const b = put(f, button(ctx.api, `case ${c.name}`, COLORS.step, 60, 36), 320 + n * 64, 96);
    await react(b, onClick(), [
      ...PLACE_REGS.flatMap((r) =>
        [0, 1, 2, 3].map((i) => setVariable(id(ctx, `t11/${r}/${i}`), boolData(((value[r] >> i) & 1) === 1))),
      ),
      ...PLACE_CASES.map((o) => setVariable(id(ctx, `t11/case/${o.name}`), boolData(o === c))),
    ]);
  }
}

/** Where test 12 puts a K key: on the frame, on layers inside it, shown or hidden. */
const KEY_LAYERS = [
  { name: "frame", label: "the frame itself" },
  { name: "shown", label: "a layer in it" },
  { name: "deep", label: "a layer 3 frames deep" },
  { name: "hidden", label: "a hidden layer (bound to false)" },
  { name: "inside", label: "a shown layer in a hidden frame" },
  { name: "only", label: "J: only on the shown layer" },
] as const;

/** 12 · keys on layers: if a key on a layer fires only while the layer shows, the visible one of
 * several stacked layers (picked by register bits) can take a shortcut, like a click. */
async function keyLayers(ctx: Ctx) {
  const f = testFrame(
    ctx,
    12,
    "keys on layers inside the frame",
    "Click once on the frame's background for focus (not on a box), then press K once, then J once. Each number counts its own reaction.",
    "write down which numbers grew: K on the frame, shown, deep, hidden, inside; J",
  );
  KEY_LAYERS.forEach((k, i) => {
    put(f, text(ctx.api, k.label, { size: 12, color: COLORS.dim }), 40, 96 + i * 30);
    num(ctx, f, `t12/${k.name}`, 300, 90 + i * 30, 20);
  });
  const K = 75;
  const J = 74;
  const at = (parent: FrameNode, name: string, x: number) =>
    put(parent, box(ctx.api, name, 28, 28, COLORS.panel, 4), x, 0);
  const tray = put(f, box(ctx.api, "tray", 200, 28, COLORS.bg, 0), 300, H - 76);
  const shown = at(tray, "shown", 0);
  const deep1 = at(tray, "deep 1", 36);
  const deep2 = put(deep1, box(ctx.api, "deep 2", 28, 28, COLORS.panel, 4), 0, 0);
  const deep = put(deep2, box(ctx.api, "deep", 28, 28, COLORS.lampOff, 4), 0, 0);
  const hidden = at(tray, "hidden", 72);
  hidden.setBoundVariable("visible", ctx.v.get("t12/off")!);
  const hider = at(tray, "hidden frame", 108);
  hider.setBoundVariable("visible", ctx.v.get("t12/off")!);
  const inside = put(hider, box(ctx.api, "inside", 28, 28, COLORS.lampOff, 4), 0, 0);
  await f.setReactionsAsync([{ trigger: keyDown([K]), actions: bump(ctx, "t12/frame") }]);
  await shown.setReactionsAsync([
    { trigger: keyDown([K]), actions: bump(ctx, "t12/shown") },
    { trigger: keyDown([J]), actions: bump(ctx, "t12/only") },
  ]);
  await react(deep, keyDown([K]), bump(ctx, "t12/deep"));
  await react(hidden, keyDown([K]), bump(ctx, "t12/hidden"));
  await react(inside, keyDown([K]), bump(ctx, "t12/inside"));
}

/** 13 · a shortcut picked by register bits: the Arrange shortcuts' design. Eight layers carry the
 * same key, stacked in a pick tree on 3 bits (level i shows child 0 on ¬bit i, child 1 on bit i), so
 * exactly one shows; the key must go to that one, whichever it is. */
async function keyPick(ctx: Ctx) {
  const f = testFrame(
    ctx,
    13,
    "a shortcut picked by 3 bits",
    "Click the frame's background, press P: the big number says which of 8 stacked layers took it. Toggle bits with the buttons (the square shows the layer that is up) and press P again, a few times.",
    "after every P the number equals the number in the square",
  );
  const t = put(f, text(ctx.api, "–", { size: 40, bold: true, color: COLORS.amber, name: "which" }), 400, 90);
  t.setBoundVariable("characters", ctx.v.get("t13/which")!);
  put(f, text(ctx.api, "P went to:", { size: 13, color: COLORS.dim }), 300, 108);
  const level = (name: string, children: NodeSpec[]): NodeSpec => ({
    type: "frame",
    name,
    x: 0,
    y: 0,
    w: 72,
    h: 72,
    children,
  });
  const leaf = (k: number): NodeSpec => ({
    type: "frame",
    name: `leaf/${k}`,
    x: 0,
    y: 0,
    w: 72,
    h: 72,
    fill: "#2f6fed",
    radius: 6,
    reactions: [{ trigger: { on: "key", codes: [80] }, run: `t13/${k}` }],
    children: [{ type: "text", name: "n", x: 26, y: 18, text: { chars: String(k), size: 28, bold: true, color: "#ffffff" } }],
  });
  const holder = put(f, box(ctx.api, "stack", 72, 72, COLORS.bg, 0), 40, 100);
  await render(
    {
      api: ctx.api,
      variable: (n) => ctx.v.get(n),
      reactionsFor: (ref) => [
        {
          trigger: keyDown([80]),
          actions: [setVariable(id(ctx, "t13/which"), strData(ref.run.slice("t13/".length)))],
        },
      ],
    },
    holder,
    pick(3, (i) => `t13/b${i}`, (i) => `t13/n${i}`, level, leaf),
  );
  for (let i = 0; i < 3; i++) {
    const b = put(f, button(ctx.api, `bit ${i} (${1 << i})`, COLORS.step, 100, 36), 40 + i * 110, 200);
    await react(b, onClick(), [
      setVariable(id(ctx, `t13/b${i}`), exprData("NOT", [aliasData(id(ctx, `t13/b${i}`))])),
      setVariable(id(ctx, `t13/n${i}`), exprData("NOT", [aliasData(id(ctx, `t13/n${i}`))])),
    ]);
  }
}

/** Builds the platform test frames on `page`, below everything, each with a flow. */
export async function buildPlatformTests(
  api: PluginAPI,
  page: PageNode,
  log: (m: string) => void = () => {},
): Promise<{ frames: FrameNode[]; tests: TestInfo[] }> {
  await loadFonts(api);
  await page.loadAsync();
  await removeCollections(api, TEST_COLLECTION);
  for (const n of [...page.children])
    if (n.name.startsWith(TEST_PREFIX)) n.remove();
  const specs = variableSpecs();
  const { vars } = await createVariables(api, TEST_COLLECTION, specs, { log });
  const v = new Map(specs.map((s, i) => [s.name, vars[i]] as const));
  let bottom = 0;
  for (const n of page.children) bottom = Math.max(bottom, n.y + n.height);
  const ctx: Ctx = {
    api,
    page,
    v,
    frames: [],
    info: [],
    at: { x: 0, y: bottom + 1200 },
  };
  for (const t of [size, big, nesting, hover, bubbling, passThrough, switching, spacers, keys, triple, placement, keyLayers, keyPick])
    try {
      await t(ctx);
    } catch (e) {
      log(`platform test ${t.name} could not be built: ${e instanceof Error ? e.message : e}`);
    }
  setFlows(
    page,
    ctx.frames.map((fr) => ({ nodeId: fr.id, name: fr.name })),
  );
  log(
    `built ${ctx.frames.length} platform tests below everything on "${page.name}"`,
  );
  return { frames: ctx.frames, tests: ctx.info };
}
