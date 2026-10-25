// What every control of the live Figma OS runs: one or more of the chip's events, each turned into
// Figma actions by NATHAN's synthesizer (one evaluation of the gates that event can change, then the
// register commits and the screen decode of what loaded).
//
// A control that only shows in one state of the machine runs its events specialised to it (`given`):
// a button in slot 3's Design panel knows the selection is 3. The canvas works by gesture, because
// Figma fires no hover while a button is held and drops a release that comes while an overlay chain
// runs: a press only records its cell, and the release records its own and runs the whole gesture
// (pointer down at the press cell, pointer move to the release cell, pointer up), picked by the
// tool, the layer count and whether the pointer moved.
import type { FlatNetlist } from "../../../src/netlist/types";
import type { Expr, PlanAction } from "../../../src/prototype/types";
import { classify, staticSize, synthesize } from "../../../nathan/src/react/synth";
import type { OsuiChip } from "../cpu/chip";
import { SLOTS } from "../cpu/disp";

/** The screen's own variables (not wires of the chip): the cells of the last press and release, and
 * the gesture flags. In plans they get ids after the chip's nets. */
export const UI_VARS = [
  ...[0, 1, 2, 3].map((i) => `pX${i}`),
  ...[0, 1, 2, 3].map((i) => `pY${i}`),
  ...[0, 1, 2, 3].map((i) => `rX${i}`),
  ...[0, 1, 2, 3].map((i) => `rY${i}`),
  /** A press on the canvas (a cell or a handle) is waiting for its release. */
  "pressed",
  /** The press was on a resize handle, `pC` (2 bits, CORNERS order). */
  "pHandle",
  "pC0",
  "pC1",
  /** The release is on the press cell (a click, not a drag). */
  "same",
  /** The viewer has been warmed up (a throwaway run when Present opens), and the bit it flips. */
  "warm",
  "scratch",
] as const;
export type UiVar = (typeof UI_VARS)[number];

export const CORNERS = ["nw", "ne", "sw", "se"] as const;
export const PROPS = ["x", "y", "w", "h", "opacity", "radius"] as const;
export const ALIGNS = [
  "left",
  "hcenter",
  "right",
  "top",
  "vcenter",
  "bottom",
] as const;
export const TOOL_NAMES = [
  "move",
  "hand",
  "scale",
  "frame",
  "section",
  "slice",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
  "pen",
  "paint",
  "erase",
  "text",
  "comment",
] as const;

export interface Step {
  /** A chip event (an id of osflow's editor, e.g. "pointer#down"). */
  event: string;
  /** Registers whose value the control knows (bus name → value). */
  given?: Record<string, number>;
  /** The pointer inputs: the cell of the press or of the release (copied from UI variables). */
  pointer?: "press" | "release";
}
export interface Run {
  name: string;
  steps: Step[];
}

/** Every run the live screen refers to, by name. */
export function liveRuns(chip: OsuiChip): Map<string, Run> {
  const runs = new Map<string, Run>();
  const add = (name: string, ...steps: Step[]) =>
    runs.set(name, { name, steps });
  const has = (id: string) => chip.syn.codes.has(id);
  for (const t of TOOL_NAMES) add(`tool/${t}`, { event: `tool/${t}#click` });
  for (let i = 0; i < SLOTS; i++) {
    add(`layer/${i}`, { event: `layer/${i}#click` });
    add(`eye/${i}`, { event: `eye/${i}#click` });
  }
  add("select/none", { event: "select/none#click" });
  add("new", { event: "new#click" });
  for (const to of ALIGNS) add(`align/${to}`, { event: `align/${to}#click` });
  // the Design panel of the selected layer s, and the canvas panel when nothing is selected
  for (let s = -1; s < SLOTS; s++) {
    const at = s < 0 ? "none" : String(s);
    const given = { g_sel: s };
    for (let k = 0; k < 16; k++)
      add(`swatch/${k}@${at}`, { event: `swatch/${k}#click`, given });
    if (s < 0) continue;
    for (const p of PROPS)
      for (const dir of ["inc", "dec"])
        add(`prop/${p}/${dir}@${at}`, {
          event: `prop/${p}/${dir}#click`,
          given,
        });
    add(`stroke/none@${at}`, { event: "stroke/none#click", given });
    for (let k = 0; k < 16; k++)
      add(`stroke/${k}@${at}`, { event: `stroke/${k}#click`, given });
    add(`shadow/on@${at}`, { event: "shadow/on#click", given });
    add(`shadow/off@${at}`, { event: "shadow/off#click", given });
  }
  // keyboard shortcuts (several keys can share an event: Delete and Backspace)
  for (const id of chip.syn.codes.keys())
    if (id.startsWith("key/")) add(id.slice(0, -"#key".length), { event: id });
  // canvas gestures
  const down = (given: Record<string, number>): Step => ({
    event: "pointer#down",
    pointer: "press",
    given,
  });
  const move = (given: Record<string, number>): Step => ({
    event: "pointer#enter",
    pointer: "release",
    given,
  });
  const up = (given?: Record<string, number>): Step => ({
    event: "pointer#up",
    given,
  });
  for (let k = 0; k < SLOTS; k++) {
    const g = { g_tCreate: 1, g_tSelect: 0, g_n: k };
    add(`gesture/create/${k}/click`, down(g), up({ d_mode: 1 }));
    add(
      `gesture/create/${k}/drag`,
      down(g),
      move({ d_mode: 1, g_sel: k }),
      up({ d_mode: 1 }),
    );
  }
  add(
    "gesture/create/full",
    down({ g_tCreate: 1, g_tSelect: 0, g_n: SLOTS }),
    up(),
  );
  const sel = { g_tCreate: 0, g_tSelect: 1 };
  add("gesture/select/click", down(sel), up());
  // after a select press the drag mode is 2, or nothing is selected and a move does nothing
  add("gesture/select/drag", down(sel), move({ d_mode: 2 }), up());
  for (const c of CORNERS) {
    if (!has(`handle/${c}#down`)) continue;
    add(
      `gesture/handle/${c}/click`,
      { event: `handle/${c}#down` },
      up({ d_mode: 3 }),
    );
    add(
      `gesture/handle/${c}/drag`,
      { event: `handle/${c}#down` },
      move({ d_mode: 3 }),
      up({ d_mode: 3 }),
    );
  }
  for (const r of runs.values())
    for (const s of r.steps)
      if (!has(s.event))
        throw new Error(`${r.name}: the chip has no event ${s.event}`);
  return runs;
}

/** Variable ids of a plan: the chip's nets, then the UI variables, then a `dirty` flag per slot
 * (its display tail has to run). */
export interface PlanIds {
  net: FlatNetlist;
  ui: Record<UiVar, number>;
  dirty: number[];
  /** Every id past the nets, with its variable name. */
  extra: Array<{ id: number; name: string }>;
}
export function planIds(net: FlatNetlist): PlanIds {
  const ui = {} as Record<UiVar, number>;
  const extra: Array<{ id: number; name: string }> = [];
  let next = net.netNames.length;
  for (const v of UI_VARS) {
    ui[v] = next;
    extra.push({ id: next++, name: `ui/${v}` });
  }
  const dirty = Array.from({ length: SLOTS }, (_, s) => {
    extra.push({ id: next, name: `ui/dirty${s}` });
    return next++;
  });
  return { net, ui, dirty, extra };
}

export interface CompiledRun {
  name: string;
  /** The events' logic and commits and the shared screen lines, then `dirty` set for every slot
   * whose registers may have loaded. */
  actions: PlanAction[];
  /** Slots whose display tail may have to run after the actions, in order. */
  touched: number[];
  /** Static size (every branch counted). */
  size: number;
}

/** Which slot's display a net belongs to (gates under disp/s<i>/), or -1. */
export function slotOfNet(net: FlatNetlist): Int8Array {
  const out = new Int8Array(net.netNames.length).fill(-1);
  for (const g of net.gates) {
    const m = /^disp\/s(\d+)\//.exec(g.path);
    if (m) out[g.out] = Number(m[1]);
  }
  return out;
}

/** The register groups (REGS instance paths) a slot's display reads: its fields' registers. */
export function slotGroups(chip: OsuiChip, slot: number): string[] {
  const out: string[] = [];
  for (const [name, r] of chip.syn.regs)
    if (
      name.startsWith(`L${slot}/`) &&
      r.nets.some((n) => n !== "0" && n !== "1")
    )
      out.push(`r_${name.replace(/[^A-Za-z0-9]/g, "_")}`);
  return out;
}

/** A top-level block that only computes slot `s`'s display lines, or -1. */
function slotBlock(a: PlanAction, slotOf: Int8Array): number {
  if ("set" in a || a.else?.length) return -1;
  let s = -2;
  for (const b of a.then) {
    if (!("set" in b)) return -1;
    const k = slotOf[b.set];
    if (k < 0 || (s >= 0 && k !== s)) return -1;
    s = k;
  }
  return s;
}

const orAll = (xs: Expr[]): Expr =>
  xs.length === 1
    ? xs[0]
    : {
        or: [
          orAll(xs.slice(0, xs.length >> 1)),
          orAll(xs.slice(xs.length >> 1)),
        ],
      };

/** A run as one action list: for each step, the pointer copied in when it needs one, then the
 * step's reaction without the slot displays (the display tails compute those, once, after the run),
 * then each touched slot's `dirty` flag: did any register of that slot load. */
export function compileRun(
  chip: OsuiChip,
  ids: PlanIds,
  run: Run,
  slotOf: Int8Array = slotOfNet(ids.net),
  foldable: Uint8Array = foldableNets(ids.net),
): CompiledRun {
  const { net } = ids;
  const port = (name: string) => {
    const p = net.ports.find((q) => q.name === name);
    if (!p) throw new Error(`the chip has no port ${name}`);
    return p.nets;
  };
  const px = port(chip.syn.inputs.get("in/px")!.port);
  const py = port(chip.syn.inputs.get("in/py")!.port);
  const groupSlot = new Map<string, number>();
  for (let s = 0; s < SLOTS; s++)
    for (const g of slotGroups(chip, s)) groupSlot.set(g, s);
  const actions: PlanAction[] = [];
  const touched = new Set<number>();
  for (const s of run.steps) {
    if (s.pointer) {
      const [x, y] = s.pointer === "press" ? ["pX", "pY"] : ["rX", "rY"];
      px.forEach((n, i) =>
        actions.push({ set: n, to: { var: ids.ui[`${x}${i}` as UiVar] } }),
      );
      py.forEach((n, i) =>
        actions.push({ set: n, to: { var: ids.ui[`${y}${i}` as UiVar] } }),
      );
    }
    const r = synthesize(
      net,
      { EVT: chip.syn.codes.get(s.event)! },
      { latch: "direct", alias: true, given: s.given },
    );
    actions.push(...r.actions.filter((a) => slotBlock(a, slotOf) < 0));
    // the slot registers that can load in this step leave their load enable in `men`
    const men = new Map<number, Expr[]>();
    for (const [grp, m] of r.men) {
      const slot = groupSlot.get(grp);
      if (slot === undefined) continue;
      men.set(slot, [...(men.get(slot) ?? []), { var: m }]);
    }
    for (const [slot, ms] of [...men].sort((a, b) => a[0] - b[0])) {
      const dirty = ids.dirty[slot];
      actions.push({ set: dirty, to: orAll([{ var: dirty }, ...ms]) });
      touched.add(slot);
    }
  }
  const folded = fold(actions, foldable);
  return {
    name: run.name,
    actions: folded,
    touched: [...touched].sort((a, b) => a - b),
    size: staticSize(folded),
  };
}

/** A slot's display tail: every display block of the slot, each behind the load enables of the
 * registers it reads (a block runs only when one of them loaded); then (in the build) the slot's
 * look-up tables; then those enables cleared, as the clock's rising edge would (`men` = ¬CLK ·
 * LOAD). Built from one reaction of every event at once, which keeps every block. */
export interface DisplayTail {
  blocks: PlanAction[];
  /** The load enable of each field's register, by field ("x", "fill" …). */
  men: Map<string, number>;
  clear: PlanAction[];
}
export function displayTails(
  chip: OsuiChip,
  ids: PlanIds,
  slotOf: Int8Array = slotOfNet(ids.net),
): DisplayTail[] {
  const { net } = ids;
  const all = synthesize(net, {}, { latch: "direct", alias: true });
  const lines = new Set<number>();
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      if ("net" in x) lines.add(net.aliases.get((x as { net: string }).net)!);
      else Object.values(x).forEach(walk);
    }
  };
  walk(chip.display);
  const inner = new Uint8Array(net.netNames.length);
  for (const g of net.gates)
    if (classify(g).c === "D" && !lines.has(g.out)) inner[g.out] = 1;
  return Array.from({ length: SLOTS }, (_, s) => {
    // the display's own intermediate gates (the decimal conversion's) fold away too: only the
    // lines the screen shows need a variable
    const blocks = fold(all.actions.filter((a) => slotBlock(a, slotOf) === s), inner);
    const men = new Map<string, number>();
    for (const name of chip.syn.regs.keys()) {
      if (!name.startsWith(`L${s}/`)) continue;
      const m = all.men.get(`r_${name.replace(/[^A-Za-z0-9]/g, "_")}`);
      if (m !== undefined) men.set(name.slice(`L${s}/`.length), m);
    }
    const clear: PlanAction[] = [...men.values()].map((m) => ({ set: m, to: { const: 0 } }));
    clear.push({ set: ids.dirty[s], to: { const: 0 } });
    return { blocks, men, clear };
  });
}

/** Cuts an action list into events of at most `budget` actions (counting every branch), between
 * top-level actions; `reserve` actions of each event are kept for the control that continues it. */
export function cut(
  actions: PlanAction[],
  budget: number,
  reserve = 1,
): PlanAction[][] {
  const parts: PlanAction[][] = [[]];
  let size = 0;
  for (const a of actions) {
    const n = staticSize([a]);
    if (n + reserve > budget)
      throw new Error(
        `one action block of ${n} actions does not fit an event of ${budget}`,
      );
    if (parts[parts.length - 1].length && size + n + reserve > budget) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(a);
    size += n;
  }
  return parts;
}

/** `a == b` for two plan variables, as an expression. */
export const same = (a: number, b: number): Expr => ({
  eq: [{ var: a }, { var: b }],
});

// ---------- folding gates into expressions ----------

/** Nets a reaction may fold away: outputs of plain logic gates (not registers, latches, load
 * enables or screen lines), which only the reaction that computes them reads. */
export function foldableNets(net: FlatNetlist): Uint8Array {
  const out = new Uint8Array(net.netNames.length);
  for (const g of net.gates) out[g.out] = classify(g).c === "X" && g.path !== "nclk" ? 1 : 0;
  return out;
}

const exprNodes = (e: Expr): number =>
  "var" in e || "const" in e
    ? 1
    : "not" in e
      ? 1 + exprNodes(e.not)
      : 1 + exprNodes(Object.values(e)[0][0]) + exprNodes(Object.values(e)[0][1]);

const exprVars = (e: Expr, out: Set<number> = new Set()): Set<number> => {
  if ("var" in e) out.add(e.var);
  else if ("not" in e) exprVars(e.not, out);
  else if (!("const" in e)) for (const x of Object.values(e)[0] as Expr[]) exprVars(x, out);
  return out;
};

const substitute = (e: Expr, n: number, by: Expr): Expr => {
  if ("var" in e) return e.var === n ? by : e;
  if ("const" in e) return e;
  if ("not" in e) return { not: substitute(e.not, n, by) };
  const [k, [a, b]] = Object.entries(e)[0] as [string, [Expr, Expr]];
  return { [k]: [substitute(a, n, by), substitute(b, n, by)] } as Expr;
};

/** Writes inside an action (and its blocks). */
const writesOf = (a: PlanAction, out: Set<number> = new Set()): Set<number> => {
  if ("set" in a) out.add(a.set);
  else for (const b of [...a.then, ...(a.else ?? [])]) writesOf(b, out);
  return out;
};

/** Folds a gate whose output is read once, by an action later in the same list, into that action's
 * expression: one SET (and one variable) less, a few expression nodes more, which Figma's viewer
 * evaluates about twenty times faster than it runs a SET. Never across a write to anything the
 * expression reads, never into a block the gate's own SET is not in, never past `maxNodes`. */
export function fold(actions: PlanAction[], foldable: Uint8Array, maxNodes = 24): PlanAction[] {
  const reads = new Map<number, number>();
  const count = (e: Expr) => {
    if ("var" in e) reads.set(e.var, (reads.get(e.var) ?? 0) + 1);
    else if ("not" in e) count(e.not);
    else if (!("const" in e)) for (const x of Object.values(e)[0] as Expr[]) count(x);
  };
  const scan = (l: PlanAction[]) =>
    l.forEach((a) => ("set" in a ? count(a.to) : (count(a.if), scan(a.then), scan(a.else ?? []))));
  scan(actions);
  const list = (l: PlanAction[]): PlanAction[] => {
    const out = l.map((a) => ("set" in a ? a : { ...a, then: list(a.then), else: a.else ? list(a.else) : undefined }));
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const a = out[i];
        if (!("set" in a) || !foldable[a.set] || reads.get(a.set) !== 1) continue;
        const inputs = exprVars(a.to);
        // the one reader: a later action of this list whose own expression (or condition) reads it
        let j = i + 1;
        let blocked = false;
        for (; j < out.length; j++) {
          const b = out[j];
          const own = "set" in b ? b.to : b.if;
          if (exprVars(own).has(a.set)) break;
          // read inside a block of b, or written before the reader: leave it
          if (!("set" in b) && JSON.stringify(b).includes(`{"var":${a.set}}`)) {
            blocked = true;
            break;
          }
          for (const w of writesOf(b))
            if (inputs.has(w) || w === a.set) blocked = true;
          if (blocked) break;
        }
        if (blocked || j >= out.length) continue;
        const b = out[j];
        const into = "set" in b ? b.to : b.if;
        const merged = substitute(into, a.set, a.to);
        if (exprNodes(merged) > maxNodes) continue;
        out[j] = "set" in b ? { set: b.set, to: merged } : { ...b, if: merged };
        out.splice(i, 1);
        reads.set(a.set, 0);
        i--;
        changed = true;
      }
    }
    return out;
  };
  return list(actions);
}
