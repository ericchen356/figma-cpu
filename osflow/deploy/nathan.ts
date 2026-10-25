// Builds CPU NATHAN (silicon/nathan: the Figma OS editor as a 4,804-gate machine, by another
// session) into a Figma file through the Figma MCP, with no plugin: this generator reads the
// machine, its synthesized reactions and its screen spec (all read-only imports), encodes them
// compactly and packs them into chunks of at most 50,000 characters. Each chunk is runtime.js plus
// one call; run them in order with use_figma. In Present mode Figma's prototype engine then does
// all the computing: one boolean variable per wire, one SET_VARIABLE per gate.
//
// Two changes from the NATHAN plugin, both from measurements in real Figma (osflow/deploy/README.md):
// a reaction longer than 700 actions continues through timed overlays (the viewer runs actions
// recursively, and on a cold page 1,200 in one event overflowed its stack), and the drawn hardware
// is replaced by a gate map: one lamp per gate, on its output.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import {
  nathanLibrary,
  nathanNetlist,
  nathanPowerOn,
} from "../../silicon/nathan/src/hw";
import {
  buildCatalog,
  reactionSpecs,
} from "../../silicon/nathan/src/react/catalog";
import {
  masterToQ,
  staticSize,
  synthesize,
  type Reaction,
} from "../../silicon/nathan/src/react/synth";
import {
  KEYS,
  type NodeSpec,
  UI_H,
  UI_W,
  uiSpec,
} from "../../silicon/nathan/src/ui/spec";
import { GRID_H, GRID_W } from "../../silicon/nathan/src/model/reference";
import { strokePlan, strokeRun } from "../../silicon/nathan/src/react/stroke";
import { NET0, NET1 } from "../../silicon/src/netlist/types";
import type { Expr, PlanAction } from "../../silicon/src/prototype/types";

export interface GenOptions {
  /** Largest reaction before the synthesizer commits registers directly instead of through every latch gate. */
  budget?: number;
  /** Characters of code per chunk (the MCP's limit is 50,000). */
  maxChunk?: number;
  /** Most actions one event may run; a longer reaction continues through timed overlays. */
  part?: number;
  /** Where the Present frame goes on the page (the gate map's frame and the overlays follow it). */
  at?: { x: number; y: number };
}

export interface Chunk {
  step: string;
  code: string;
  note: string;
}

export interface Generated {
  chunks: Chunk[];
  stats: {
    gates: number;
    wires: number;
    reactions: number;
    staticActions: number;
    longest: { name: string; actions: number };
    /** The most actions one event runs (a longer reaction continues through timed overlays). */
    longestPart: number;
    /** Reactions that continue through overlays. */
    continued: number;
    /** Reactions whose register writes did not fit one event (then a fast second input could see them half done). */
    torn: number;
    uiNodes: number;
    missing: string[];
  };
  /** Wire number of every net id (tests read the machine through it). */
  wireOf: Map<number, number>;
  prefix: string;
  names: { frame: string; editor: string; chart: string; machine: string };
}

const here = dirname(fileURLToPath(import.meta.url));
const FRAME = "CPU NATHAN · Figma OS";
/** The gate map's own frame, a button away from the editor (the editor fills the screen). */
const MACHINE = "CPU NATHAN · the machine";
const CHART = "gate map";
const PREFIX = "w/";
const PAD = 48;
const HEADER = 140;
const GAP = 40;
const COLORS: Record<string, string> = {
  A: "#3DDC84",
  O: "#29ADFF",
  N: "#FF004D",
  X: "#FFA300",
  R: "#FF77A8",
  B: "#C2C3C7",
  D: "#B48EF6",
  E: "#FFEC27",
};
const TYPE_CODE: Record<string, string> = {
  AND: "A",
  OR: "O",
  NOT: "N",
  XOR: "X",
  NOR: "R",
  BUF: "B",
  NAND: "D",
  XNOR: "E",
};

/** The chart: which units go in which column (anything else lands in the first column). */
const COLUMNS = [
  ["nclk", "evdec", "conds", "layerctl", "free", "newrec", "state", "disp"],
  ["hit", "plane", "geom"],
  ["l0", "l1", "l2", "l3", "l4", "l5", "l6", "l7"],
];
const LAMP = { size: 6, pitch: 8, perRow: 44, pad: 10, top: 26 };

export function generate(o: GenOptions = {}): Generated {
  const maxChunk = o.maxChunk ?? 30000;
  const net = nathanNetlist(nathanLibrary());
  const init = nathanPowerOn(net);

  // ---------- wires: every net a gate reads or drives, plus the top ports ----------
  const used = new Set<number>();
  for (const g of net.gates) {
    used.add(g.out);
    for (const n of g.in) used.add(n);
  }
  for (const p of net.ports) for (const n of p.nets) used.add(n);
  used.delete(NET0);
  used.delete(NET1);
  const ids = [...used].sort((a, b) => a - b);
  const wireOf = new Map(ids.map((id, i) => [id, i]));
  const unitOfNet = (id: number) => {
    const d = net.driver[id];
    if (d < 0) return "io";
    const top = net.gates[d].path.split("/")[0];
    return /^g\d+$/.test(top) ? "glue" : top;
  };
  const unitNames: string[] = [];
  const unitIdx = (name: string) => {
    let i = unitNames.indexOf(name);
    if (i < 0) i = unitNames.push(name) - 1;
    return i;
  };
  const units = ids.map((id) => unitIdx(unitOfNet(id)));
  // the hover column: the cell the pointer was last over, copied into PX when a click starts (the
  // clicked row's own reaction has PY built in)
  const hover = {
    x: [0, 1, 2, 3].map((i) => ids.length + i),
    y: [] as number[],
  };
  // the warm-up when Present opens: done once (WARM), by flipping a bit (SCRATCH) a few hundred times
  const WARM = ids.length + hover.x.length;
  const SCRATCH = WARM + 1;
  // the pen's anchor: the cell its press went down on (column, row), for the release's straight line
  const anchor = {
    x: [0, 1, 2, 3].map((i) => SCRATCH + 1 + i),
    y: [0, 1, 2, 3].map((i) => SCRATCH + 5 + i),
  };
  const extraWires = hover.x.length + 2 + 8;
  for (let i = 0; i < extraWires; i++) units.push(unitIdx("ui"));
  const initBits =
    ids.map((id) => (init[id] ? "1" : "0")).join("") +
    "0".repeat(extraWires);
  const b36 = (n: number) => n.toString(36);
  const w = (id: number) => {
    const i = wireOf.get(id);
    if (i === undefined) throw new Error(`net ${net.netNames[id]} has no wire`);
    return b36(i);
  };

  // ---------- reactions ----------
  const catalog = buildCatalog(net, reactionSpecs(), {
    latch: "auto",
    // every latch gate is evaluated (all lamps follow) unless a reaction would not fit one event
    budget: o.budget ?? o.part ?? 700,
    alias: true,
  });
  const ex = (x: Expr): string => {
    if ("var" in x) return w(x.var);
    if ("const" in x) return x.const ? "T" : "F";
    if ("not" in x) return `!${ex(x.not)}`;
    const [op, [a, b]] =
      "and" in x
        ? (["&", x.and] as const)
        : "or" in x
          ? (["|", x.or] as const)
          : "eq" in x
            ? (["=", x.eq] as const)
            : (["^", x.neq] as const);
    return `${op}${ex(a)},${ex(b)}`;
  };
  const acts = (list: PlanAction[]): string =>
    list
      .map((a) =>
        "set" in a
          ? `${w(a.set)}:${"var" in a.to ? `=${w(a.to.var)},T` : ex(a.to)}`
          : `?${ex(a.if)}{${acts(a.then)}}${a.else ? `{${acts(a.else)}}` : ""}`,
      )
      .join(";");
  const runs = new Map<string, string>();
  let staticActions = 0;
  let longest = { name: "", actions: 0 };
  // The viewer runs a reaction's actions recursively, about three stack frames each: on a cold
  // page 1,000 sequential actions ran and 1,200 overflowed the stack and left the prototype dead to
  // clicks. So a reaction longer than PART runs as a few events: the trigger runs the first part and
  // opens an invisible overlay whose timer runs the next part on a fresh stack, then swaps in the
  // next overlay or closes. Only the logic is cut: the register writes and the screen lines (the
  // reaction from its first write on) run in the last event, so between two events nothing is half
  // written. silicon/nathan's plugin builds its chains the same way.
  const PART = o.part ?? 700;
  const port = (name: string) => net.ports.find((p) => p.name === name)!.nets;
  if (port("PX").length !== hover.x.length)
    throw new Error("PX is not as wide as the hover column");
  const lead = port("PX")
    .map((n, i) => `${w(n)}:=${b36(hover.x[i])},T`)
    .join(";");
  const LEAD = hover.x.length;
  /** A canvas reaction that reads the column the hover stored (its PX is not built in). */
  const needsLead = (run: string) =>
    run.startsWith("click/") && catalog.get(run)?.spec.ties.PX === undefined;
  // a hover stores the pointer's column: "pointer/<c>" alone, or before a run (the pen's stroke)
  const store = (c: number) =>
    hover.x.map((k, i) => `${b36(k)}:${(c >> i) & 1 ? "T" : "F"}`).join(";");
  for (let c = 0; c < 1 << hover.x.length; c++)
    runs.set(`pointer/${c}`, store(c));
  // the editor's way to the gate map
  runs.set("go/machine", `@go:${MACHINE}`);
  // the pen's anchor store, and its straight strokes (react/stroke.ts): one IF per anchor cell
  const bitsOf = (wires: number[], v: number) =>
    wires.map((k, i) => `${b36(k)}:${(v >> i) & 1 ? "T" : "F"}`);
  const anchorStore = (x: number, y: number) =>
    [...bitsOf(anchor.x, x), ...bitsOf(anchor.y, y)].join(";");
  const isAnchor = (x: number, y: number) => {
    const lits = [
      ...anchor.x.map((k, i) => ((x >> i) & 1 ? b36(k) : `!${b36(k)}`)),
      ...anchor.y.map((k, i) => ((y >> i) & 1 ? b36(k) : `!${b36(k)}`)),
    ];
    return lits.slice(0, -1).reduceRight((acc, l) => `&${l},${acc}`, lits[lits.length - 1]);
  };
  {
    const netWire = (name: string) => {
      const id = net.aliases.get(name);
      if (id === undefined) throw new Error(`no net ${name}`);
      return w(id);
    };
    const ink = `!${netWire("erase")}`;
    const pix = (i: number) => netWire(`pix[${i}]`);
    const pendownQ = net.aliases.get("pendown")!;
    const pendownM = [...masterToQ(net)].find(([, q]) => q === pendownQ)?.[0];
    const lift = [
      `${w(pendownQ)}:F`,
      ...(pendownM !== undefined && wireOf.has(pendownM) ? [`${w(pendownM)}:F`] : []),
      `${netWire("hot[4]")}:T`,
      `${netWire("hot[5]")}:F`,
    ].join(";");
    for (let r = 0; r < GRID_H; r++)
      for (let c = 0; c < GRID_W; c++) {
        const plan = strokePlan(r, c);
        const parts = [`${pix(plan.at)}:${ink}`];
        for (const l of plan.lines)
          if (l.bits.length)
            parts.push(`?${isAnchor(l.x, l.y)}{${l.bits.map((b) => `${pix(b)}:${ink}`).join(";")}}`);
        // a release away from the anchor ends the stroke: the pen comes up
        parts.push(`?!${isAnchor(c, r)}{${lift}}`);
        runs.set(strokeRun(r, c), parts.join(";"));
      }
  }
  const continued = new Map<string, number>(); // run → its number of events
  const overlays: Array<{ t: string; n: string; w: number; h: number }> = [];
  const then = (run: string, k: number) => `then ${run} ${k}`;
  const torn: string[] = [];
  let longestPart = 0;
  // every event of a chain ends with the action that opens, swaps in or closes an overlay: +1
  const greedy = (list: PlanAction[], first: number) => {
    const out: PlanAction[][] = [[]];
    let size = first + 1;
    for (const a of list) {
      const n = staticSize([a]);
      if (out[out.length - 1].length && size + n > PART) {
        out.push([]);
        size = 1;
      }
      out[out.length - 1].push(a);
      size += n;
    }
    return out;
  };
  // a reaction as events, its writes all in the last one; null if they do not fit one event
  const eventsOf = (r: Reaction, first: number): PlanAction[][] | null => {
    if (first + staticSize(r.actions) <= PART) return [r.actions];
    const [head, tail] = [
      r.actions.slice(0, r.commitAt),
      r.actions.slice(r.commitAt),
    ];
    const tailSize = staticSize(tail);
    if (tailSize + 1 > PART) return null;
    const parts = greedy(head, first);
    const last = parts[parts.length - 1];
    const lastSize =
      staticSize(last) + (parts.length === 1 ? first : 0) + 1;
    if (lastSize + tailSize <= PART) parts[parts.length - 1] = [...last, ...tail];
    else parts.push(tail);
    return parts;
  };
  for (const [name, e] of catalog) {
    const click = name.startsWith("click/");
    if (click && e.spec.ties.PY === undefined)
      throw new Error(
        `${name}: a click reaction needs its row (PY) built in, the hover holds only the column`,
      );
    // the first event also runs the copy of the hover column into PX (where PX is not built in)
    // and, on a canvas cell, the store of the pointer's column
    const first =
      (needsLead(name) ? LEAD : 0) +
      (click || name.startsWith("paint/") ? hover.x.length : 0);
    let parts = eventsOf(e.reaction, first);
    // more than one event: a direct commit (Q = D) is much shorter, and logic kept out of the
    // register blocks can go in the early events; take whichever needs the fewest
    if (!parts || parts.length > 1)
      for (const alt of [
        { latch: "direct" },
        { latch: "direct", inside: false },
      ] as const) {
        const r = synthesize(net, e.spec.ties, {
          ...alt,
          alias: true,
          given: e.spec.given,
        });
        const p = eventsOf(r, first);
        if (p && (!parts || p.length < parts.length)) {
          e.reaction = r;
          parts = p;
        }
      }
    if (!parts) {
      torn.push(name); // the writes cannot stay together: cut anywhere
      parts = greedy(e.reaction.actions, first);
    }
    const n = staticSize(e.reaction.actions) + first;
    staticActions += n;
    if (n > longest.actions) longest = { name, actions: n };
    const chained = parts.length > 1;
    longestPart = Math.max(
      longestPart,
      ...parts.map(
        (p, k) => staticSize(p) + (k ? 0 : first) + (chained ? 1 : 0),
      ),
    );
    if (!chained) {
      runs.set(name, acts(parts[0]));
      continue;
    }
    continued.set(name, parts.length);
    runs.set(name, `${acts(parts[0])};@open:${then(name, 1)}`);
    for (let k = 1; k < parts.length; k++) {
      const next =
        k + 1 < parts.length ? `@swap:${then(name, k + 1)}` : "@close";
      runs.set(`${name}#${k}`, `${acts(parts[k])};${next}`);
      overlays.push({ t: "f", n: then(name, k), w: 1, h: 1 });
    }
  }

  // ---------- the screen ----------
  const missing: string[] = [];
  let uiNodes = 0;
  const TYPE: Record<NodeSpec["type"], string> = {
    frame: "f",
    rect: "r",
    ellipse: "e",
    text: "x",
    svg: "s",
  };
  const isCell = (s: NodeSpec) =>
    !s.children?.length &&
    s.reactions?.length === 1 &&
    s.reactions[0].run.startsWith("pointer/");
  const compact = (s: NodeSpec): unknown => {
    uiNodes++;
    if (isCell(s)) {
      // "pointer/<column>" alone: the cell stores its column in the hover (its row takes the click;
      // a cell that takes its own click, or paints, is an ordinary layer)
      const [c, r = null] = s
        .reactions![0].run.slice("pointer/".length)
        .split(",")
        .map(Number);
      return [c, r, s.x, s.y, s.w, s.h];
    }
    const out: Record<string, unknown> = { t: TYPE[s.type], n: s.name };
    if (s.svg) out.svg = s.svg;
    for (const k of ["x", "y", "w", "h"] as const)
      if (s[k] !== undefined) out[k] = s[k];
    if (s.fill) out.f = s.fill;
    if (s.stroke) out.s = s.stroke;
    if (s.strokeWeight) out.sw = s.strokeWeight;
    if (s.radius) out.r = s.radius;
    if (s.clip) out.c = 1;
    if (s.layout) {
      const L: Record<string, unknown> = { d: s.layout.dir };
      if (s.layout.gap) L.g = s.layout.gap;
      if (s.layout.pad) L.p = s.layout.pad;
      if (s.layout.main) L.m = s.layout.main;
      if (s.layout.cross) L.x = s.layout.cross;
      out.L = L;
    }
    if (s.sizeH) out.sh = s.sizeH;
    if (s.sizeV) out.sv = s.sizeV;
    if (s.absolute) out.a = 1;
    if (s.text)
      out.tx = [
        s.text.chars,
        s.text.size ?? 12,
        s.text.bold ? 1 : 0,
        s.text.color ?? "#FFFFFF",
      ];
    if (s.visibleNet) {
      const id = net.aliases.get(s.visibleNet);
      if (id === undefined || id <= NET1 || !wireOf.has(id))
        missing.push(s.visibleNet);
      else out.v = wireOf.get(id);
    }
    if (s.hidden) out.hd = 1;
    if (s.children?.length) out.ch = s.children.map(compact);
    return out;
  };

  // reactions of the screen, by node path (the runtime finds nodes by the same rule)
  type Assign = [
    string,
    Array<[string, number[] | null, string, string | null]>,
  ];
  const assigns: Assign[] = [];
  const TRIG: Record<string, string> = {
    click: "c",
    enter: "e",
    down: "d",
    up: "u",
    key: "k",
  };
  const walk = (s: NodeSpec, path: string) => {
    if (s.reactions?.length && !isCell(s)) {
      const list = s.reactions.map(
        (r): [string, number[] | null, string, string | null] => {
          if (!runs.has(r.run))
            throw new Error(
              `the screen refers to a reaction that does not exist: ${r.run}`,
            );
          return [
            TRIG[r.trigger.on],
            r.trigger.on === "key" ? r.trigger.codes : null,
            r.run,
            [
              r.pointer !== undefined ? store(r.pointer) : "",
              r.anchor ? anchorStore(r.anchor.x, r.anchor.y) : "",
              needsLead(r.run) ? lead : "",
            ]
              .filter(Boolean)
              .join(";") || null,
          ];
        },
      );
      assigns.push([path, list]);
    }
    const seen: Record<string, number> = {};
    for (const c of s.children ?? []) {
      const k = (seen[c.name] = (seen[c.name] ?? -1) + 1);
      walk(c, `${path}/${c.name}${k ? `#${k}` : ""}`);
    }
  };
  const root = uiSpec();
  walk(root, "");
  // The frame Present opens (path "") takes the keyboard shortcuts (KEYS lists one key per
  // reaction: Figma reads a list as a chord) and, once, a warm-up: a fresh viewer is slow at its first
  // long reaction and its first overlay (silicon/nathan measured a 2 s first click, and the click
  // after a chain lost behind its overlay), so a timer runs a few hundred throwaway actions, and
  // opens and closes an empty overlay when the build has chains.
  const WARM_UP = "warm-up";
  const flips = Array.from(
    { length: Math.min(500, PART - 3) },
    () => `${b36(SCRATCH)}:!${b36(SCRATCH)}`,
  ).join(";");
  runs.set(
    "warm-up",
    `?=${b36(WARM)},F{${b36(WARM)}:T;${flips}${continued.size ? `;@open:${WARM_UP}` : ""}}`,
  );
  assigns.push([
    "",
    [
      ...KEYS.map((k): [string, number[] | null, string, null] => [
        "k",
        k.codes,
        k.run,
        null,
      ]),
      ["t", [0.001], "warm-up", null],
    ],
  ]);
  if (continued.size) {
    overlays.push({ t: "f", n: WARM_UP, w: 1, h: 1 });
    runs.set("warm-up/close", "@close");
    assigns.push([`@${WARM_UP}`, [["t", [0.001], "warm-up/close", null]]]);
  }
  for (const [run, n] of continued)
    for (let k = 1; k < n; k++)
      assigns.push([`@${then(run, k)}`, [["t", [0.001], `${run}#${k}`, null]]]);

  // ---------- the gate map ----------
  // a master latch equals its slave between events, so its lamp shows Q (a direct commit, Q = D,
  // never writes the master)
  const shadow = masterToQ(net);
  const byUnit = new Map<string, string[]>();
  for (const g of net.gates) {
    const top = g.path.split("/")[0];
    const unit = /^g\d+$/.test(top) ? "glue" : top;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit
      .get(unit)!
      .push(`${TYPE_CODE[g.type]}${w(shadow.get(g.out) ?? g.out)}`);
  }
  const placed = new Set(COLUMNS.flat());
  const columns = COLUMNS.map((c, i) =>
    i === 0 ? [...c, ...[...byUnit.keys()].filter((u) => !placed.has(u))] : c,
  );
  const blockW = LAMP.pad * 2 + LAMP.perRow * LAMP.pitch;
  const chartUnits: Array<{
    name: string;
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    gates: string;
  }> = [];
  let chartH = 0;
  columns.forEach((col, ci) => {
    let y = 16;
    for (const name of col) {
      const gates = byUnit.get(name);
      if (!gates) continue;
      const rows = Math.ceil(gates.length / LAMP.perRow);
      const h = LAMP.top + rows * LAMP.pitch + LAMP.pad;
      chartUnits.push({
        name,
        title: `${name} · ${gates.length} gates`,
        x: 16 + ci * (blockW + 16),
        y,
        w: blockW,
        h,
        gates: gates.join(","),
      });
      y += h + 12;
    }
    chartH = Math.max(chartH, y + 4);
  });
  const chartW = 16 + columns.length * (blockW + 16);

  // ---------- chunks ----------
  const runtime = runtimeCode();
  const chunks: Chunk[] = [];
  const add = (step: string, data: unknown, note: string) => {
    const json = JSON.stringify(data);
    const code = `${runtime}\nreturn await RT.run("${step}", ${json}, "${fnv(json)}");`;
    if (code.length > 50000)
      throw new Error(
        `chunk ${chunks.length + 1} (${step}) is ${code.length} characters`,
      );
    chunks.push({ step, code, note });
  };
  const room = maxChunk - runtime.length - 200;
  const names = { name: FRAME, editor: root.name, prefix: PREFIX };

  add(
    "vars",
    {
      coll: "CPU NATHAN wires",
      prefix: PREFIX,
      names: unitNames,
      units,
      init: initBits,
    },
    `${units.length} wire variables`,
  );

  const rootShell = compact({ ...root, children: [] });
  uiNodes = 0;
  add(
    "frame",
    {
      name: FRAME,
      flow: "CPU NATHAN · Figma OS",
      prefix: PREFIX,
      hover,
      // the editor fills the Present frame: 16:9, so it shows whole without scrolling
      w: UI_W,
      h: UI_H,
      x: o.at?.x ?? 0,
      y: o.at?.y ?? 0,
      bg: "#1E1E1E",
      rootX: 0,
      rootY: 0,
      texts: [],
      root: rootShell,
      // the overlays go in chunks of their own below (a small part makes hundreds)
      overlays: [],
      clear: ["then ", WARM_UP],
      machine: {
        name: MACHINE,
        w: Math.max(UI_W, chartW + 2 * PAD),
        h: HEADER + chartH + PAD,
        x: 0,
        y: UI_H + 160,
        bg: "#16181D",
        back: ["◂ back to the editor", 220, 40],
        texts: [
          [
            "CPU NATHAN — the Figma OS editor as a gate-level machine, computed by Figma itself",
            PAD,
            28,
            24,
            "#FFFFFF",
            1,
          ],
          [
            `${net.gates.length} gates · ${ids.length} wires (one boolean variable each) · ${catalog.size} reactions, the longest ${longest.actions} gate evaluations (at most ${longestPart} per event) · no plugin`,
            PAD,
            64,
            13,
            "#8A8F98",
            0,
          ],
          [
            "Every gate of the machine is a lamp that lights when its output is 1. Everything the editor shows, every layer, colour, highlight and pixel of ink,\nis a register bit of this machine; every click and key runs the gates its event needs.",
            PAD,
            88,
            12,
            "#8A8F98",
            0,
          ],
        ],
      },
      chart: {
        name: CHART,
        x: PAD,
        y: HEADER,
        w: chartW,
        h: chartH,
        bg: "#101216",
      },
    },
    "the Present frame, its header, the empty editor and the chart area",
  );

  for (let i = 0; i < overlays.length; ) {
    let size = 0;
    let j = i;
    while (j < overlays.length && size < room) size += JSON.stringify(overlays[j++]).length + 1;
    add(
      "overlays",
      {
        prefix: PREFIX,
        hover,
        x: o.at?.x ?? 0,
        y: o.at?.y ?? 0,
        w: UI_W,
        first: i,
        overlays: overlays.slice(i, j),
      },
      `${j - i} overlay frame(s)`,
    );
    i = j;
  }

  // the editor's subtrees, packed in order; a subtree too big for one chunk goes in as an empty
  // shell and its children are packed below it the same way
  const emitChildren = (parentPath: string, parentSpec: NodeSpec) => {
    let batch: unknown[] = [];
    let size = 0;
    const flush = () => {
      if (!batch.length) return;
      add(
        "ui",
        {
          ...names,
          parent: parentPath,
          parentSpec: parentSpec.layout
            ? { L: { d: parentSpec.layout.dir } }
            : null,
          hover,
          children: batch,
        },
        `${batch.length} screen subtree(s) under ${parentPath || "the editor"}`,
      );
      batch = [];
      size = 0;
    };
    const seen: Record<string, number> = {};
    for (const c of parentSpec.children ?? []) {
      const k = (seen[c.name] = (seen[c.name] ?? -1) + 1);
      const path = `${parentPath}/${c.name}${k ? `#${k}` : ""}`;
      const json = JSON.stringify(compact(c));
      if (json.length > room) {
        flush();
        add(
          "ui",
          {
            ...names,
            parent: parentPath,
            parentSpec: parentSpec.layout
              ? { L: { d: parentSpec.layout.dir } }
              : null,
            hover,
            children: [compact({ ...c, children: [] })],
          },
          `the shell of ${path}`,
        );
        emitChildren(path, c);
        continue;
      }
      if (size + json.length > room) flush();
      batch.push(JSON.parse(json));
      size += json.length;
    }
    flush();
  };
  emitChildren("", root);
  uiNodes = 0;
  compact(root);

  // reactions: nodes packed with the runs they use
  let rBatch: Assign[] = [];
  let rRuns = new Map<string, string>();
  let rSize = 0;
  const flushR = () => {
    if (!rBatch.length) return;
    add(
      "react",
      { ...names, runs: Object.fromEntries(rRuns), assign: rBatch },
      `reactions of ${rBatch.length} node(s), ${rRuns.size} run(s)`,
    );
    rBatch = [];
    rRuns = new Map();
    rSize = 0;
  };
  // Every node's reactions are stored by one call: batched with other nodes when they fit, alone
  // when they don't (adding to a node's reactions would mean reading them back from Figma), and the
  // build stops if one node's reactions need more than a chunk holds.
  const hardRoom = 50000 - runtime.length - 400;
  for (const [path, list] of assigns) {
    const used = new Map(list.map((item) => [item[2], runs.get(item[2])!]));
    const size =
      JSON.stringify([path, list]).length +
      [...used.values()].reduce((sz, r) => sz + r.length + 12, 0);
    if (size > hardRoom)
      throw new Error(
        `the reactions of ${path || "the frame"} need ${size} characters, more than one chunk holds`,
      );
    if (rSize + size > room) flushR();
    for (const [run, code] of used) rRuns.set(run, code);
    rBatch.push([path, list]);
    rSize += size;
    if (size > room) flushR();
  }
  flushR();

  // the gate map, a few units per chunk
  let cBatch: typeof chartUnits = [];
  let cSize = 0;
  const flushC = () => {
    if (!cBatch.length) return;
    add(
      "chart",
      {
        name: MACHINE,
        chart: CHART,
        prefix: PREFIX,
        colors: COLORS,
        blockBg: "#1C1F26",
        size: LAMP.size,
        pitch: LAMP.pitch,
        perRow: LAMP.perRow,
        pad: LAMP.pad,
        top: LAMP.top,
        units: cBatch,
      },
      `gate map: ${cBatch.map((u) => u.name).join(", ")}`,
    );
    cBatch = [];
    cSize = 0;
  };
  for (const u of chartUnits) {
    const s = JSON.stringify(u).length;
    if (cSize + s > room || cBatch.length >= 6) flushC();
    cBatch.push(u);
    cSize += s;
  }
  flushC();

  return {
    chunks,
    stats: {
      gates: net.gates.length,
      wires: units.length,
      reactions: catalog.size,
      staticActions,
      longest,
      longestPart,
      continued: continued.size,
      torn: torn.length,
      uiNodes,
      missing,
    },
    wireOf,
    prefix: PREFIX,
    names: { frame: FRAME, editor: root.name, chart: CHART, machine: MACHINE },
  };
}

/** FNV-1a, the same as the runtime's (base 36). */
export function fnv(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** runtime.js, minified (the chunk limit counts every character). */
export function runtimeCode(): string {
  const src = readFileSync(
    existsSync(join(here, "runtime.js"))
      ? join(here, "runtime.js")
      : join(process.cwd(), "deploy", "runtime.js"),
    "utf8",
  ).replace("const RT =", "globalThis.RT =");
  const min = transformSync(src, { minify: true, loader: "js" }).code.trim();
  return `${min}\nconst RT = globalThis.RT;`;
}
