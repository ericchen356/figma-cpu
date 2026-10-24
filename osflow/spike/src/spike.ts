// OS spike: can Figma's prototype engine draw and drive a Figma-like editor with no plugin code
// at run time? Silicon's spikes settled booleans, text and the per-event action limit. The OS
// needs four more things, each its own flow here (a crash kills the viewer: reopen Present and
// pick the next flow):
//   R1 · Size      do NUMBER variables bound to width, height, corner radius and opacity update live?
//   R2 · Position  x and y cannot be bound, so can auto-layout padding / item spacing place a node,
//                  and does a negative spacing move it left of its parent's edge?
//   R3 · Fill      16 stacked shapes whose `visible` is bound to 16 flags: a palette by flags.
//   I1 · Pointer   a 14 x 10 grid of hotspots: does a held-button drag fire MOUSE_ENTER across them,
//                  and does MOUSE_UP fire on the cell where the button is released?
//   I2 · Keys      which key chords fire ON_KEY_DOWN (Shift+S, Cmd+C, Delete, [ …).
// and one build, not a test:
//   Editor         the real compiled editor (src/editor.ts): its variables, a hotspot per canvas cell
//                  with real reactions, tool/swatch/layer buttons, and 8 slots drawn by bound geometry.
// Plugin code only builds this; at run time Figma's prototype engine does all the work.
import { compileSteps, statsOf, typesOf, type VarIds } from "../../src/compile";
import { buildEditor } from "../../src/editor";
import { PALETTE } from "../../src/spec";
import type { FlowEvent } from "../../src/ir";
import {
  bindVisible,
  box,
  button,
  COLORS,
  createVariables,
  FONT,
  lamp,
  loadFonts,
  put,
  removeCollections,
  setFlows,
  solid,
  text,
  type VariableSpec,
} from "../../../silicon/src/prototype/draw";
import {
  aliasData,
  boolData,
  compareData,
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
} from "../../../silicon/src/prototype/figma-actions";

export const SPIKE_COMMANDS = ["all", "render", "input", "editor"] as const;
export type SpikeCommand = (typeof SPIKE_COMMANDS)[number];

const PAGE = "OS Spike";
const COLLECTION = "OS Spike";
const EDITOR_COLLECTION = "OS";
const K = 40;

// ---------- logging into a text node on the page ----------

class Log {
  lines: string[] = [];
  errors: string[] = [];
  private node: TextNode | null = null;

  constructor(private api: PluginAPI) {}

  async attach(page: PageNode): Promise<void> {
    try {
      await this.api.loadFontAsync(FONT);
      for (const n of [...page.children])
        if (n.name === "OS spike log") n.remove();
      const t = this.api.createText();
      t.name = "OS spike log";
      t.fontName = FONT;
      t.fontSize = 14;
      page.appendChild(t);
      t.x = -1400;
      t.y = 0;
      this.node = t;
      this.flush();
    } catch (e) {
      this.lines.push(`(log text unavailable: ${e})`);
    }
  }

  info(msg: string): void {
    this.lines.push(msg);
    console.log(`[os-spike] ${msg}`);
    this.flush();
  }

  error(where: string, e: unknown): void {
    const msg = `ERROR in ${where}: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`;
    this.errors.push(msg);
    this.info(msg);
  }

  private flush(): void {
    if (!this.node) return;
    try {
      this.node.characters = ["OS spike log", ...this.lines.slice(-40)].join(
        "\n",
      );
    } catch {
      /* the console has the log */
    }
  }
}

async function step<T>(
  log: Log,
  what: string,
  fn: () => Promise<T> | T,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    log.error(what, e);
    return undefined;
  }
}

// ---------- variables one by one ----------

class Vars {
  readonly coll: VariableCollection;
  constructor(
    private api: PluginAPI,
    name: string,
  ) {
    this.coll = api.variables.createVariableCollection(name);
  }
  private make(
    name: string,
    type: VariableResolvedDataType,
    init: boolean | number | string,
  ) {
    const v = this.api.variables.createVariable(name, this.coll, type);
    v.setValueForMode(this.coll.defaultModeId, init);
    return v;
  }
  bool = (name: string, init = false) => this.make(name, "BOOLEAN", init);
  float = (name: string, init = 0) => this.make(name, "FLOAT", init);
  str = (name: string, init = "") => this.make(name, "STRING", init);
}

type Flow = { nodeId: string; name: string };

/** Everything a test needs while it builds. */
interface Ctx {
  api: PluginAPI;
  page: PageNode;
  log: Log;
  vars: Vars;
  flows: Flow[];
}

const bind = (
  node: SceneNode,
  field: VariableBindableNodeField,
  v: Variable,
  log: Log,
  what: string,
): boolean => {
  try {
    (
      node as unknown as {
        setBoundVariable(f: VariableBindableNodeField, v: Variable): void;
      }
    ).setBoundVariable(field, v);
    return true;
  } catch (e) {
    log.error(`bind ${what} ${field}`, e);
    return false;
  }
};

async function react(
  log: Log,
  node: SceneNode,
  reactions: Reaction[],
  what: string,
): Promise<void> {
  try {
    await (node as SceneNode & ReactionMixin).setReactionsAsync(reactions);
  } catch (e) {
    log.error(what, e);
  }
}

function testFrame(
  c: Ctx,
  name: string,
  w: number,
  h: number,
  x: number,
  y: number,
  note: string,
): FrameNode {
  const f = box(c.api, `OS · ${name}`, w, h, COLORS.bg);
  put(c.page, f, x, y);
  put(f, text(c.api, name, { size: 18, bold: true, name: "title" }), 20, 14);
  put(
    f,
    text(c.api, note, { size: 11, color: COLORS.dim, name: "note" }),
    20,
    42,
  );
  c.flows.push({ nodeId: f.id, name: `OS · ${name}` });
  return f;
}

/** A readout: "label = <number variable>", kept current by a concat action. */
function readout(
  c: Ctx,
  parent: FrameNode,
  label: string,
  v: Variable,
  at: { x: number; y: number },
): { node: TextNode; update: Action } {
  const s = c.vars.str(`${v.name}/text`, `${label} …`);
  const t = put(
    parent,
    text(c.api, `${label} …`, {
      size: 14,
      bold: true,
      color: COLORS.amber,
      name: `readout/${label}`,
    }),
    at.x,
    at.y,
  );
  bind(t, "characters", s, c.log, `readout ${label}`);
  return { node: t, update: concatText(s.id, v.id, `${label} `) };
}

/** An auto-layout frame with a fixed size, no fill, used to position a child through its padding. */
function wrapper(
  api: PluginAPI,
  name: string,
  w: number,
  h: number,
  dir: "VERTICAL" | "HORIZONTAL",
  fill?: string,
): FrameNode {
  const f = api.createFrame();
  f.name = name;
  f.layoutMode = dir;
  f.primaryAxisSizingMode = "FIXED";
  f.counterAxisSizingMode = "FIXED";
  f.resize(w, h);
  f.paddingLeft = 0;
  f.paddingTop = 0;
  f.paddingRight = 0;
  f.paddingBottom = 0;
  f.itemSpacing = 0;
  f.fills = fill ? solid(fill) : [];
  f.clipsContent = true;
  return f;
}

// ---------- R1 · Size ----------

async function sizeTest(c: Ctx): Promise<void> {
  const f = testFrame(
    c,
    "R1 · Size",
    700,
    420,
    0,
    0,
    "Click the buttons. Does the box resize, round and fade LIVE?\nOpacity starts at 50: 0-100 scale = half faded, 0-1 scale = fully solid.",
  );
  const w = c.vars.float("r1/w", 80);
  const h = c.vars.float("r1/h", 80);
  const rad = c.vars.float("r1/rad", 0);
  const op = c.vars.float("r1/op", 50);
  const rows = [
    readout(c, f, "w =", w, { x: 420, y: 90 }),
    readout(c, f, "h =", h, { x: 420, y: 112 }),
    readout(c, f, "radius =", rad, { x: 420, y: 134 }),
    readout(c, f, "opacity =", op, { x: 420, y: 156 }),
  ];
  const r = c.api.createRectangle();
  r.name = "bound box";
  r.resize(80, 80);
  r.fills = solid(COLORS.step);
  put(f, r, 40, 100);
  bind(r, "width", w, c.log, "R1 box");
  bind(r, "height", h, c.log, "R1 box");
  if (!bind(r, "cornerRadius", rad, c.log, "R1 box"))
    for (const corner of [
      "topLeftRadius",
      "topRightRadius",
      "bottomLeftRadius",
      "bottomRightRadius",
    ] as const)
      bind(r, corner, rad, c.log, "R1 box");
  bind(r, "opacity", op, c.log, "R1 box");
  const upd = rows.map((x) => x.update);
  const btn = async (label: string, x: number, y: number, acts: Action[]) => {
    const b = put(f, button(c.api, label, COLORS.step, 120, 36), x, y);
    await react(
      c.log,
      b,
      [{ trigger: onClick(), actions: [...acts, ...upd] }],
      `R1 ${label}`,
    );
  };
  await btn("w +40", 20, 250, [increment(w.id, 40)]);
  await btn("w −40", 150, 250, [increment(w.id, -40)]);
  await btn("h +40", 280, 250, [increment(h.id, 40)]);
  await btn("h −40", 410, 250, [increment(h.id, -40)]);
  await btn("radius +20", 20, 296, [increment(rad.id, 20)]);
  await btn("radius 9999", 150, 296, [setVariable(rad.id, floatData(9999))]);
  await btn("opacity −10", 280, 296, [increment(op.id, -10)]);
  await btn("opacity +10", 410, 296, [increment(op.id, 10)]);
  await btn("reset", 20, 342, [
    setVariable(w.id, floatData(80)),
    setVariable(h.id, floatData(80)),
    setVariable(rad.id, floatData(0)),
    setVariable(op.id, floatData(50)),
  ]);
}

// ---------- R2 · Position ----------

async function positionTest(c: Ctx): Promise<void> {
  const f = testFrame(
    c,
    "R2 · Position",
    760,
    560,
    0,
    480,
    "x and y cannot be bound; padding and item spacing can.\nA: padding places the box. B: a spacing below zero should push it past the left edge.",
  );
  const px = c.vars.float("r2/px", 40);
  const py = c.vars.float("r2/py", 40);
  const ox = c.vars.float("r2/ox", 40);
  const rows = [
    readout(c, f, "padding left =", px, { x: 600, y: 84 }),
    readout(c, f, "padding top =", py, { x: 600, y: 106 }),
    readout(c, f, "spacing =", ox, { x: 600, y: 300 }),
  ];
  const a = wrapper(c.api, "A · padding", 560, 200, "VERTICAL", "#222831");
  put(f, a, 20, 80);
  const ra = c.api.createRectangle();
  ra.name = "box";
  ra.resize(60, 60);
  ra.fills = solid(COLORS.lampOn);
  a.appendChild(ra);
  bind(a, "paddingLeft", px, c.log, "R2 A");
  bind(a, "paddingTop", py, c.log, "R2 A");
  const b = wrapper(c.api, "B · spacing", 560, 120, "HORIZONTAL", "#222831");
  put(f, b, 20, 290);
  const spacer = c.api.createRectangle();
  spacer.name = "anchor";
  spacer.resize(1, 60);
  spacer.fills = solid(COLORS.dim);
  b.appendChild(spacer);
  const rb = c.api.createRectangle();
  rb.name = "box";
  rb.resize(60, 60);
  rb.fills = solid(COLORS.amber);
  b.appendChild(rb);
  bind(b, "itemSpacing", ox, c.log, "R2 B");
  const upd = rows.map((x) => x.update);
  const btn = async (label: string, x: number, y: number, acts: Action[]) => {
    const n = put(f, button(c.api, label, COLORS.step, 100, 32), x, y);
    await react(
      c.log,
      n,
      [{ trigger: onClick(), actions: [...acts, ...upd] }],
      `R2 ${label}`,
    );
  };
  await btn("left +40", 20, 490, [increment(px.id, 40)]);
  await btn("left −40", 130, 490, [increment(px.id, -40)]);
  await btn("top +40", 240, 490, [increment(py.id, 40)]);
  await btn("top −40", 350, 490, [increment(py.id, -40)]);
  await btn("space +40", 460, 490, [increment(ox.id, 40)]);
  await btn("space −40", 570, 490, [increment(ox.id, -40)]);
}

// ---------- R3 · Fill by flags ----------

async function fillTest(c: Ctx): Promise<void> {
  const f = testFrame(
    c,
    "R3 · Fill",
    560,
    300,
    800,
    480,
    "16 stacked squares, each shown by its own flag. Next color should walk the palette.",
  );
  const k = c.vars.float("r3/k", 0);
  const flags = PALETTE.map((_, i) => c.vars.bool(`r3/f/${i}`, i === 0));
  PALETTE.forEach((hex, i) => {
    const r = c.api.createRectangle();
    r.name = `fill ${i}`;
    r.resize(100, 100);
    r.fills = solid(hex);
    put(f, r, 40, 90);
    bind(r, "visible", flags[i], c.log, "R3");
  });
  const kText = readout(c, f, "color =", k, { x: 180, y: 100 });
  const acts: Action[] = [
    increment(k.id, 1),
    conditional(compareData("GREATER_THAN", k.id, 15.5), [
      setVariable(k.id, floatData(0)),
    ]),
    ...flags.map((v, i) =>
      setVariable(
        v.id,
        exprData("EQUALS", [aliasData(k.id, "FLOAT"), floatData(i)]),
      ),
    ),
    kText.update,
  ];
  const b = put(f, button(c.api, "next color", COLORS.step, 140, 36), 180, 150);
  await react(c.log, b, [{ trigger: onClick(), actions: acts }], "R3 next");
}

// ---------- I1 · Pointer ----------

async function pointerTest(c: Ctx): Promise<void> {
  const f = testFrame(
    c,
    "I1 · Pointer",
    1000,
    520,
    0,
    1100,
    "Press on a cell, drag across several, release. The orange box should follow while the button is held.\nReport the counters: do enters fire during a drag? Where does the release register?",
  );
  const held = c.vars.bool("i1/held");
  const n = {
    downs: c.vars.float("i1/downs"),
    enters: c.vars.float("i1/enters"),
    dragEnters: c.vars.float("i1/dragEnters"),
    ups: c.vars.float("i1/ups"),
    clicks: c.vars.float("i1/clicks"),
    dx: c.vars.float("i1/downX", -1),
    dy: c.vars.float("i1/downY", -1),
    ux: c.vars.float("i1/upX", -1),
    uy: c.vars.float("i1/upY", -1),
  };
  const lx = c.vars.float("i1/cursorX");
  const ly = c.vars.float("i1/cursorY");
  const labels: Record<keyof typeof n, string> = {
    downs: "downs",
    enters: "enters",
    dragEnters: "enters while held",
    ups: "ups",
    clicks: "clicks",
    dx: "down x",
    dy: "down y",
    ux: "up x",
    uy: "up y",
  };
  const read = Object.fromEntries(
    (Object.keys(n) as (keyof typeof n)[]).map((key, i) => [
      key,
      readout(c, f, labels[key], n[key], { x: 640, y: 90 + i * 24 }),
    ]),
  ) as Record<keyof typeof n, ReturnType<typeof readout>>;
  // The cursor: a box positioned by padding, under the hotspots.
  const grid = wrapper(
    c.api,
    "cursor layer",
    14 * K,
    10 * K,
    "VERTICAL",
    "#222831",
  );
  put(f, grid, 40, 100);
  const cur = c.api.createRectangle();
  cur.name = "cursor";
  cur.resize(K, K);
  cur.fills = solid("#ff7a00");
  grid.appendChild(cur);
  bind(grid, "paddingLeft", lx, c.log, "I1 cursor");
  bind(grid, "paddingTop", ly, c.log, "I1 cursor");
  for (let cy = 0; cy < 10; cy++)
    for (let cx = 0; cx < 14; cx++) {
      const h = c.api.createFrame();
      h.name = `cell/${cx},${cy}`;
      h.resize(K, K);
      h.fills = [];
      h.strokes = solid("#3a3f47");
      h.strokeWeight = 1;
      h.clipsContent = false;
      put(f, h, 40 + cx * K, 100 + cy * K);
      const at = [
        setVariable(lx.id, floatData(cx * K)),
        setVariable(ly.id, floatData(cy * K)),
      ];
      await react(
        c.log,
        h,
        [
          {
            trigger: mouseDown(),
            actions: [
              setVariable(held.id, boolData(true)),
              increment(n.downs.id),
              setVariable(n.dx.id, floatData(cx)),
              setVariable(n.dy.id, floatData(cy)),
              ...at,
              read.downs.update,
              read.dx.update,
              read.dy.update,
            ],
          },
          {
            trigger: mouseEnter(),
            actions: [
              increment(n.enters.id),
              conditional(
                exprData("EQUALS", [aliasData(held.id), boolData(true)]),
                [increment(n.dragEnters.id), ...at, read.dragEnters.update],
              ),
              read.enters.update,
            ],
          },
          {
            trigger: mouseUp(),
            actions: [
              setVariable(held.id, boolData(false)),
              increment(n.ups.id),
              setVariable(n.ux.id, floatData(cx)),
              setVariable(n.uy.id, floatData(cy)),
              read.ups.update,
              read.ux.update,
              read.uy.update,
            ],
          },
          {
            trigger: onClick(),
            actions: [increment(n.clicks.id), read.clicks.update],
          },
        ],
        `I1 cell ${cx},${cy}`,
      );
    }
  const reset = put(
    f,
    button(c.api, "reset counters", COLORS.reset, 160, 36),
    640,
    330,
  );
  const zero = (Object.values(n) as Variable[]).map((v) =>
    setVariable(
      v.id,
      floatData(v === n.dx || v === n.dy || v === n.ux || v === n.uy ? -1 : 0),
    ),
  );
  await react(
    c.log,
    reset,
    [
      {
        trigger: onClick(),
        actions: [
          setVariable(held.id, boolData(false)),
          ...zero,
          ...Object.values(read).map((r) => r.update),
        ],
      },
    ],
    "I1 reset",
  );
}

// ---------- I2 · Keys ----------

const CHORDS: Array<[string, number[]]> = [
  ["V", [86]],
  ["Delete", [46]],
  ["Backspace", [8]],
  ["[", [219]],
  ["]", [221]],
  ["←", [37]],
  ["Esc", [27]],
  ["Shift+S", [16, 83]],
  ["Shift+L", [16, 76]],
  ["Cmd+C", [91, 67]],
  ["Cmd+D", [91, 68]],
  ["Ctrl+C", [17, 67]],
];

async function keyTest(c: Ctx): Promise<void> {
  const f = testFrame(
    c,
    "I2 · Keys",
    640,
    330,
    1100,
    1100,
    "Click the frame once so it has focus, then press each key or chord.\nA lamp lights when its trigger ran. Report which lamps stay dark.",
  );
  const reactions: Reaction[] = [];
  const lamps: Variable[] = [];
  CHORDS.forEach(([label, codes], i) => {
    const v = c.vars.bool(`i2/${label}`);
    lamps.push(v);
    const l = lamp(c.api, 22, COLORS.lampOn, `lamp ${label}`);
    bindVisible(l.lit, v);
    put(f, l.node, 24 + (i % 6) * 100, 110 + Math.floor(i / 6) * 80);
    put(
      f,
      text(c.api, label, { size: 13, bold: true }),
      24 + (i % 6) * 100,
      140 + Math.floor(i / 6) * 80,
    );
    reactions.push({
      trigger: keyDown(codes),
      actions: [setVariable(v.id, boolData(true))],
    });
  });
  await react(c.log, f, reactions, "I2 keys");
  const clear = put(
    f,
    button(c.api, "clear lamps", COLORS.reset, 140, 34),
    24,
    270,
  );
  await react(
    c.log,
    clear,
    [
      {
        trigger: onClick(),
        actions: lamps.map((v) => setVariable(v.id, boolData(false))),
      },
    ],
    "I2 clear",
  );
}

// ---------- the real editor ----------

const TRIGGER: Record<string, (e: FlowEvent) => Trigger> = {
  click: () => onClick(),
  down: () => mouseDown(),
  up: () => mouseUp(),
  enter: () => mouseEnter(),
  key: (e) => keyDown((e.trigger as { keyCodes: number[] }).keyCodes),
};

async function editorBuild(
  api: PluginAPI,
  page: PageNode,
  log: Log,
  flows: Flow[],
): Promise<void> {
  const t0 = Date.now();
  const ed = buildEditor({ K });
  const stats = statsOf(ed);
  log.info(
    `editor: ${stats.variables} variables, ${stats.events} events, ${stats.stored} stored actions, at most ${stats.maxWorst} executed per event`,
  );
  await removeCollections(api, EDITOR_COLLECTION);
  const specs: VariableSpec[] = ed.vars.map((v) => ({
    name: v.name,
    type: v.ty === "num" ? "FLOAT" : v.ty === "bool" ? "BOOLEAN" : "STRING",
    init: v.init as boolean | number | string,
  }));
  const made = await createVariables(api, EDITOR_COLLECTION, specs, {
    log: (m) => log.info(m),
  });
  const byName = new Map(ed.vars.map((v, i) => [v.name, made.vars[i]]));
  const ids: VarIds = new Map([...byName].map(([n, v]) => [n, v.id]));
  const types = typesOf(ed.vars);
  const varOf = (name: string) => {
    const v = byName.get(name);
    if (!v) throw new Error(`no variable ${name}`);
    return v;
  };

  for (const n of [...page.children]) if (n.name === "OS · Editor") n.remove();
  const root = box(api, "OS · Editor", 1040, 640, "#16181d");
  put(page, root, 0, 2000);
  put(
    root,
    text(api, "Figma OS · running on Figma's own prototype engine", {
      size: 16,
      bold: true,
    }),
    20,
    12,
  );
  const CX = 240;
  const CY = 60;
  const canvas = box(api, "canvas", 14 * K, 10 * K, "#1e1e1e");
  put(root, canvas, CX, CY);

  // 8 slots, bottom to top, drawn by bound geometry: a padding-positioned wrapper holds a box whose
  // size is bound, which holds 16 same-size shapes of which the one flagged by `fill` shows.
  let bound = 0;
  for (let i = 0; i < 8; i++) {
    const wrap = wrapper(api, `slot ${i}`, 14 * K, 10 * K, "VERTICAL");
    put(canvas, wrap, 0, 0);
    bind(wrap, "paddingLeft", varOf(`L${i}/x`), log, `slot ${i}`);
    bind(wrap, "paddingTop", varOf(`L${i}/y`), log, `slot ${i}`);
    const holder = api.createFrame();
    holder.name = "box";
    holder.fills = [];
    holder.clipsContent = false;
    holder.resize(K, K);
    wrap.appendChild(holder);
    bind(holder, "width", varOf(`L${i}/w`), log, `slot ${i}`);
    bind(holder, "height", varOf(`L${i}/h`), log, `slot ${i}`);
    bind(holder, "visible", varOf(`L${i}/vis`), log, `slot ${i}`);
    PALETTE.forEach((hex, k) => {
      const r = api.createRectangle();
      r.name = `fill ${k}`;
      r.resize(K, K);
      r.fills = solid(hex);
      put(holder, r, 0, 0);
      bind(r, "width", varOf(`L${i}/w`), log, `slot ${i}`);
      bind(r, "height", varOf(`L${i}/h`), log, `slot ${i}`);
      bind(r, "cornerRadius", varOf(`L${i}/rr`), log, `slot ${i}`);
      bind(r, "visible", varOf(`L${i}/f/${k}`), log, `slot ${i}`);
      bound += 4;
    });
  }

  // Controls. Every event names the node it belongs to; nodes are made on first use.
  const nodes = new Map<string, SceneNode>();
  const need = (name: string, make: () => SceneNode) => {
    let n = nodes.get(name);
    if (!n) {
      n = make();
      n.name = name;
      nodes.set(name, n);
    }
    return n;
  };
  const toolNames = ed.events
    .filter((e) => e.node.startsWith("tool/"))
    .map((e) => e.node);
  const placeButton = (
    label: string,
    color: string,
    w: number,
    h: number,
    x: number,
    y: number,
  ) => put(root, button(api, label, color, w, h), x, y);
  toolNames.forEach((name, i) =>
    need(name, () =>
      placeButton(name.slice(5), COLORS.panel, 190, 26, 20, 60 + i * 30),
    ),
  );
  PALETTE.forEach((hex, k) =>
    need(`swatch/${k}`, () => {
      const s = box(api, "swatch", 28, 28, hex, 4);
      return put(root, s, 810 + (k % 4) * 34, 60 + Math.floor(k / 4) * 34);
    }),
  );
  for (let i = 0; i < 8; i++) {
    need(`layer/${i}`, () =>
      placeButton(`layer ${i + 1}`, COLORS.panel, 120, 24, 810, 210 + i * 28),
    );
    need(`eye/${i}`, () =>
      placeButton("eye", COLORS.reset, 56, 24, 936, 210 + i * 28),
    );
  }
  const rest = [...new Set(ed.events.map((e) => e.node))].filter(
    (n) =>
      !nodes.has(n) &&
      !n.startsWith("cell/") &&
      !n.startsWith("key/") &&
      !n.startsWith("handle/"),
  );
  rest.forEach((name, i) =>
    need(name, () =>
      placeButton(
        name,
        COLORS.step,
        120,
        22,
        240 + (i % 5) * 126,
        480 + Math.floor(i / 5) * 26,
      ),
    ),
  );
  for (let cy = 0; cy < 10; cy++)
    for (let cx = 0; cx < 14; cx++)
      need(`cell/${cx},${cy}`, () => {
        const h = api.createFrame();
        h.resize(K, K);
        h.fills = [];
        h.clipsContent = false;
        put(canvas, h, cx * K, cy * K);
        return h;
      });
  nodes.set("key", root);

  // Lamps for the state the screen does not draw yet: rows used / selected / hidden.
  put(
    root,
    text(api, "used", { size: 11, color: COLORS.dim }),
    240,
    470 - 36 * 0 + 150,
  );
  const lampRow = (label: string, name: (i: number) => string, y: number) => {
    put(root, text(api, label, { size: 11, color: COLORS.dim }), CX, y - 14);
    for (let i = 0; i < 8; i++) {
      const l = lamp(api, 14, COLORS.lampOn, `${label} ${i}`);
      bindVisible(l.lit, varOf(name(i)));
      put(root, l.node, CX + i * 22, y);
    }
  };
  lampRow("layers used", (i) => `L${i}/used`, 420);
  lampRow("selected", (i) => `L${i}/sel`, 456);
  lampRow("visible", (i) => `L${i}/vis`, 492);
  for (const [name, node] of nodes)
    if (node.type === "TEXT") node.name = `label ${name}`;

  // Reactions: one setReactionsAsync per node, with every action list compiled from the flow.
  const byNode = new Map<string, Reaction[]>();
  let wired = 0;
  for (const e of ed.events) {
    const nodeName = e.node.startsWith("key/") ? "key" : e.node;
    if (!nodes.has(nodeName)) continue;
    const list = byNode.get(nodeName) ?? [];
    list.push({
      trigger: TRIGGER[e.trigger.type](e),
      actions: compileSteps(e.steps, ids, types),
    });
    byNode.set(nodeName, list);
    wired++;
  }
  log.info(`wiring ${wired} reactions on ${byNode.size} nodes…`);
  let n = 0;
  for (const [nodeName, reactions] of byNode) {
    await react(
      log,
      nodes.get(nodeName)!,
      reactions,
      `reactions of ${nodeName}`,
    );
    if (++n % 100 === 0) {
      log.info(`  ${n}/${byNode.size} nodes`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  flows.push({ nodeId: root.id, name: "OS · Editor" });
  log.info(
    `editor built in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${bound} geometry bindings, ${wired} reactions`,
  );
}

// ---------- entry ----------

export interface SpikeReport {
  ok: boolean;
  errors: string[];
  lines: string[];
}

export async function buildSpike(
  api: PluginAPI,
  command: SpikeCommand = "all",
): Promise<SpikeReport> {
  const log = new Log(api);
  const t0 = Date.now();
  const page = await step(log, "open page", async () => {
    let p = api.root.children.find((x) => x.name === PAGE);
    if (!p) {
      try {
        p = api.createPage();
        p.name = PAGE;
      } catch {
        p = api.currentPage; // Starter plan files are capped at 3 pages
      }
    }
    await api.setCurrentPageAsync(p);
    return p;
  });
  if (!page) return { ok: false, errors: log.errors, lines: log.lines };
  await log.attach(page);
  log.info(`command: ${command}`);
  await step(log, "load fonts", () => loadFonts(api));
  const flows: Flow[] = [];

  if (command !== "editor") {
    await step(log, "clear old tests", async () => {
      await removeCollections(api, COLLECTION);
      for (const n of [...page.children])
        if (n.name.startsWith("OS · R") || n.name.startsWith("OS · I"))
          n.remove();
    });
    const c: Ctx = { api, page, log, vars: new Vars(api, COLLECTION), flows };
    if (command === "all" || command === "render") {
      await step(log, "R1 size", () => sizeTest(c));
      await step(log, "R2 position", () => positionTest(c));
      await step(log, "R3 fill", () => fillTest(c));
    }
    if (command === "all" || command === "input") {
      await step(log, "I1 pointer", () => pointerTest(c));
      await step(log, "I2 keys", () => keyTest(c));
    }
  }
  if (command === "editor")
    await step(log, "editor", () => editorBuild(api, page, log, flows));

  await step(log, "flows", () => setFlows(page, flows));
  log.info(
    `done in ${((Date.now() - t0) / 1000).toFixed(1)} s with ${log.errors.length} error(s)`,
  );
  return { ok: log.errors.length === 0, errors: log.errors, lines: log.lines };
}
