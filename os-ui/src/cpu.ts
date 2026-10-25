// The CPU tab's chip: this editor compiled by osflow to two-input gates (one clock tick per
// editor event) and run on silicon's FastSim beside the reducer. Every action dispatch() applies
// is fired at the chip as the events a person would cause in Figma (codec.ts eventsFor, then
// onHardware), and the nets each tick changes are what the CPU panel flashes. Whatever the chip
// has no event for (undo, a typed jump, a pointer outside its 14 x 10 window…) is loaded into it
// from the editor's state instead (stateVars), when it can hold that state at all (representable).
// After every event its registers are decoded and compared with the editor's state: "in step".
// Nothing here touches the DOM (cpuview.ts draws it), and nothing here may break the editor: a
// failure only shows in the status line.
import {
  decode,
  eventsFor,
  onHardware,
  representable,
  stateVars,
  Unsupported,
  viewOf,
} from "../../osflow/src/codec";
import { buildEditor } from "../../osflow/src/editor";
import { pokesFor, type RegisterValues } from "../../osflow/src/gates/load";
import { decodeRegister, inputPort } from "../../osflow/src/gates/machine";
import { synthesize, type Synth } from "../../osflow/src/gates/synthesize";
import type { Vars } from "../../osflow/src/interp";
import { compile, FastSim, powerOn } from "../../silicon/src/compile";
import { flatten, netId } from "../../silicon/src/netlist/flatten";
import type { FlatNetlist } from "../../silicon/src/netlist/types";
import {
  GRID_H,
  GRID_W,
  getSelected,
  initialState,
  type Action,
  type Align,
  type Corner,
  type State,
  type Tool,
} from "./model";

// ---- The chip on FastSim

/** The chip: fire() is one editor event (EVT and the inputs set, one clock tick), load() puts its
 * registers at given values. Both return the nets whose value they changed. */
export class Chip {
  readonly net: FlatNetlist;
  readonly sim: FastSim;
  /** Each register's nets, LSB first, by state variable. */
  private readonly regNets = new Map<string, number[]>();
  /** The net values before the last fire or load. */
  private readonly before: Uint8Array;

  constructor(readonly syn: Synth) {
    this.net = flatten(syn.lib, syn.top);
    this.sim = new FastSim(
      this.net,
      compile(this.net),
      powerOn(this.net, syn.pokes),
    );
    this.before = new Uint8Array(this.net.netNames.length);
    for (const [name, r] of syn.regs)
      this.regNets.set(
        name,
        r.nets.map((n) => netId(this.net, n)),
      );
  }

  fire(id: string, inputs: Record<string, number> = {}): Int32Array {
    const code = this.syn.codes.get(id);
    if (code === undefined) throw new Error(`the chip has no event ${id}`);
    this.before.set(this.sim.v);
    for (const [name, value] of Object.entries(inputs)) {
      const p = inputPort(this.syn, name, value);
      this.sim.set(p.port, p.bits);
    }
    this.sim.set("EVT", code);
    this.sim.tick();
    return this.changed();
  }

  /** Both latches of every register bit at `vars` (pokesFor), EVT and the inputs at 0, settled:
   * exactly the state GateMachine.load() boots (powerOn from zero with the same pokes), since a
   * settled state is decided by its latches and inputs. From the current state it takes a few
   * sweeps instead of a power-on. */
  load(vars: RegisterValues): Int32Array {
    const pokes = pokesFor(this.syn, vars);
    this.before.set(this.sim.v);
    for (const [name, bit] of Object.entries(pokes))
      this.sim.v[netId(this.net, name)] = bit;
    this.sim.set("EVT", 0);
    this.sim.settle();
    return this.changed();
  }

  /** Every register, decoded, by state variable. */
  registers(): Vars {
    const out: Vars = new Map();
    for (const [name, r] of this.syn.regs)
      out.set(name, decodeRegister(r, this.regNets.get(name)!, this.sim.v));
    return out;
  }

  private changed(): Int32Array {
    const a = this.before;
    const b = this.sim.v;
    let n = 0;
    for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) n++;
    const out = new Int32Array(n);
    for (let i = 0, k = 0; i < b.length; i++) if (a[i] !== b[i]) out[k++] = i;
    return out;
  }
}

// ---- Blocks: the chip's modules, as the panel draws them

/** What a module does: an editor operation, state, or the logic that routes events to them. */
export type Role = "unit" | "register" | "control";

export interface Block {
  /** The top-level module ("U_parent", "GLUE", "EVDEC"), or "REG" for every REG_W<n>. */
  id: string;
  name: string;
  role: Role;
  /** Its gates, as indices into the flattened netlist's gates, in netlist order. */
  gates: Int32Array;
}

const BLOCK_NAMES: Record<string, string> = {
  U_parent: "parent search",
  U_hit: "hit test",
  U_align: "align",
  U_handle: "resize handles",
  U_prop: "properties",
  U_drag: "drag",
  U_span: "draw span",
  U_duplicate: "duplicate",
  U_create: "create",
  U_reorder: "reorder",
  U_nudge: "nudge",
  U_paste: "paste",
  U_copy: "copy",
  U_eye: "visibility",
  U_new: "new file",
  U_recolor: "recolor",
  U_remove: "remove",
  U_select: "select",
  U_style: "style",
  U_tool: "tool",
  GLUE: "glue logic",
  EVDEC: "event decoder",
  REG: "registers",
};

/** The chip's gates by top-level module, largest first. */
function blocksOf(syn: Synth, net: FlatNetlist): Block[] {
  const cellOf = new Map(
    syn.lib.get(syn.top)!.instances.map((i) => [i.name, i.cell]),
  );
  const byBlock = new Map<string, number[]>();
  net.gates.forEach((g, i) => {
    const cell = cellOf.get(g.path.slice(0, g.path.indexOf("/"))) ?? "GLUE";
    const id = cell.startsWith("REG_W") ? "REG" : cell;
    const list = byBlock.get(id);
    if (list) list.push(i);
    else byBlock.set(id, [i]);
  });
  return [...byBlock]
    .map(([id, gates]) => ({
      id,
      name: BLOCK_NAMES[id] ?? id.replace(/^U_/, "").replace(/_/g, " "),
      role: (id === "REG"
        ? "register"
        : id === "GLUE" || id === "EVDEC"
          ? "control"
          : "unit") as Role,
      gates: Int32Array.from(gates),
    }))
    .sort((a, b) => b.gates.length - a.gates.length || (a.id < b.id ? -1 : 1));
}

// ---- The editor's actions in words

const TOOL_WORDS: Record<Tool, string> = {
  move: "Move",
  hand: "Hand",
  scale: "Scale",
  frame: "Frame",
  section: "Section",
  slice: "Slice",
  rect: "Rectangle",
  line: "Line",
  arrow: "Arrow",
  ellipse: "Ellipse",
  polygon: "Polygon",
  star: "Star",
  pen: "Pen",
  paint: "Pencil",
  erase: "Eraser",
  text: "Text",
  comment: "Comment",
};
const ALIGN_WORDS: Record<Align, string> = {
  left: "Align left",
  hcenter: "Align horizontal centers",
  right: "Align right",
  top: "Align top",
  vcenter: "Align vertical centers",
  bottom: "Align bottom",
};
const CORNER_WORDS: Record<Corner, string> = {
  nw: "top-left",
  ne: "top-right",
  sw: "bottom-left",
  se: "bottom-right",
};
const PROP_WORDS: Record<string, string> = {
  x: "X",
  y: "Y",
  w: "W",
  h: "H",
  opacity: "Opacity",
  radius: "Radius",
  rotation: "Rotation",
};
const KEY_WORDS: Record<string, string> = {
  Escape: "Esc",
  ArrowLeft: "Left arrow",
  ArrowRight: "Right arrow",
  ArrowUp: "Up arrow",
  ArrowDown: "Down arrow",
  " ": "Space",
};
const NO_EVENT: Record<string, string> = {
  title: "renaming the file",
  "layer-rename": "renaming a layer",
  edit: "editing text",
  text: "typing text",
  image: "placing an image",
  load: "opening a file",
};

/** The action `a` on the state `s`, as a person would say it: "Rectangle tool", "Press at 3, 4". */
export function actionWords(s: State, a: Action): string {
  const name = (id: number | null) =>
    s.layers.find((l) => l.id === id)?.name ?? `layer ${String(id)}`;
  const hex = (c: string) => c.slice(1).toUpperCase();
  switch (a.t) {
    case "down":
      return a.handle && getSelected(s)
        ? `Press the ${CORNER_WORDS[a.handle]} handle`
        : `Press at ${a.x}, ${a.y}`;
    case "move":
      return `Drag to ${a.x}, ${a.y}`;
    case "up":
      return "Release";
    case "key": {
      const k =
        KEY_WORDS[a.key] ?? (a.key.length === 1 ? a.key.toUpperCase() : a.key);
      return a.meta ? `⌘${k}` : `${a.shift ? "⇧" : ""}${k} key`;
    }
    case "tool":
      return `${TOOL_WORDS[a.tool]} tool`;
    case "select":
      return a.id === null ? "Deselect" : `Select ${name(a.id)}`;
    case "visible":
      return `${s.layers.find((l) => l.id === a.id)?.visible ? "Hide" : "Show"} ${name(a.id)}`;
    case "fill":
      return `Fill ${hex(a.color)}`;
    case "stroke":
      return a.color ? `Stroke ${hex(a.color)}` : "Remove stroke";
    case "shadow":
      return a.on ? "Add drop shadow" : "Remove drop shadow";
    case "prop":
      return `${PROP_WORDS[a.prop]} ${a.value}`;
    case "align":
      return ALIGN_WORDS[a.to];
    case "title":
      return "Rename file";
    case "layer-rename":
      return `Rename ${name(a.id)}`;
    case "edit":
      return `Edit ${name(a.id)}`;
    case "text":
      return "Type text";
    case "image":
      return "Place image";
    case "new":
      return "New file";
    case "load":
      return "Open file";
  }
}

/** A typed property value as the reducer took it (rounded, clamped, "90%" as 90, a blank or
 * unreadable field as no change), so the chip's steppers fire for what the editor did. */
function applied(a: Action, after: State): Action {
  if (a.t !== "prop" || a.prop === "rotation") return a;
  const l = getSelected(after);
  if (!l) return a;
  return {
    ...a,
    value: String(a.prop === "opacity" ? l.opacity * 10 : l[a.prop]),
  };
}

/** Why the chip computes nothing for `a`, from eventsFor's refusal, in words. */
function refusal(e: Unsupported, a: Action): string {
  const m = e.message;
  let r: RegExpExecArray | null;
  if (
    (a.t === "down" || a.t === "move") &&
    m.startsWith("pointer outside the window")
  )
    return `the pointer at ${a.x}, ${a.y} is outside the chip's ${GRID_W} × ${GRID_H} window, so the chip didn't compute it`;
  if ((r = /^tool (\w+)$/.exec(m)))
    return `the chip has no ${TOOL_WORDS[r[1] as Tool] ?? r[1]} tool yet`;
  if (m.startsWith("resize handles under the Scale tool"))
    return "a resize under the Scale tool keeps the ratio, which the chip can't do yet";
  if ((r = /^prop (\w+) jumps from (-?\d+) to (.+)$/.exec(m)))
    return `the typed ${PROP_WORDS[r[1]] ?? r[1]} jumps from ${r[2]} to ${r[3]}, and the chip's steppers move by one`;
  if (m === "prop rotation") return "the chip has no rotation yet";
  if (/^prop \w+$/.test(m)) return "nothing is selected";
  if ((r = /^no layer (.+)$/.exec(m))) return `there is no layer ${r[1]}`;
  if ((r = /^action (.+)$/.exec(m)))
    return `the chip has no event for ${NO_EVENT[r[1]] ?? r[1]}`;
  return m;
}

/** The first place two decoded views differ, or null. */
function firstDiff(
  chip: unknown,
  editor: unknown,
  at = "the state",
): string | null {
  if (chip === editor) return null;
  if (
    chip &&
    editor &&
    typeof chip === "object" &&
    typeof editor === "object"
  ) {
    const keys = new Set([...Object.keys(chip), ...Object.keys(editor)]);
    for (const k of keys) {
      const d = firstDiff(
        (chip as Record<string, unknown>)[k],
        (editor as Record<string, unknown>)[k],
        Array.isArray(chip) ? `${at}[${k}]` : `${at}.${k}`,
      );
      if (d) return d;
    }
    return null;
  }
  return `${at} is ${JSON.stringify(chip)} on the chip, ${JSON.stringify(editor)} in the editor`;
}

// ---- The runtime beside the editor

export type StatusKind = "wait" | "step" | "resync" | "off" | "bug";
export interface Status {
  kind: StatusKind;
  text: string;
}

/** What the chip did for one editor action. */
export interface CpuStep {
  /** The action in words. */
  words: string;
  /** The events it fired, in order, with their EVT code and inputs. None for a load. */
  fired: { id: string; code: number; inputs: Record<string, number> }[];
  /** Every net that changed value: the ticks', or the load's. */
  nets: Int32Array;
  /** How many of those are gate outputs (the rest are the EVT and input pins). */
  gates: number;
  /** The chip was loaded from the editor's state instead of computing it. */
  loaded: boolean;
  /** performance.now() when it happened. */
  at: number;
}

type Pending =
  { before: State; a: Action; after: State } | { state: State; label: string };

const IN_STEP =
  "In step: the chip's registers hold exactly what the editor holds.";
const now = () => performance.now();
/** Runs `fn` after the next paint, when the page is idle (a timer where there is no idle callback). */
function later(fn: () => void): void {
  const idle = () =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(fn, { timeout: 1000 })
      : setTimeout(fn, 30);
  if (typeof requestAnimationFrame === "function")
    requestAnimationFrame(() => setTimeout(idle, 0));
  else setTimeout(idle, 0);
}

export class Cpu {
  chip: Chip | null = null;
  blocks: Block[] = [];
  /** blockOf[g]: the index in `blocks` of gate g. */
  blockOf = new Uint8Array(0);
  /** Build times in ms: buildEditor and synthesize, then flatten, compile and power-on. */
  timing = { synth: 0, boot: 0 };
  status: Status = { kind: "wait", text: "Building the chip…" };
  /** The last action the chip did anything for. */
  last: CpuStep | null = null;
  /** The editor state the chip's registers hold, while `synced`. */
  private held: State = initialState();
  private synced = true;
  private started = false;
  private pending: Pending[] = [];
  private readonly listeners = new Set<(step: CpuStep | null) => void>();

  /** Builds the chip off the next paint, in two idle slices so the editor stays responsive; `state`
   * is the editor's state now. cpuview.ts calls it when the CPU tab first shows, so a page that
   * never shows it pays nothing. Actions from then until it is ready wait in a queue. */
  start(state: State): void {
    if (this.started) return;
    this.started = true;
    this.held = state;
    later(() =>
      this.guard(() => {
        const t = now();
        const syn = synthesize(buildEditor({ target: "hardware" }));
        this.timing.synth = now() - t;
        later(() => this.guard(() => this.build(syn)));
      }),
    );
  }

  /** Builds the chip now (or boots the given synthesis), then catches up with the queue. */
  build(syn?: Synth): void {
    if (this.chip) return;
    let t = now();
    if (!syn) {
      syn = synthesize(buildEditor({ target: "hardware" }));
      this.timing.synth = now() - t;
      t = now();
    }
    this.chip = new Chip(syn);
    this.timing.boot = now() - t;
    this.blocks = blocksOf(syn, this.chip.net);
    this.blockOf = new Uint8Array(this.chip.net.gates.length);
    this.blocks.forEach((b, k) =>
      b.gates.forEach((g) => (this.blockOf[g] = k)),
    );
    // Powered on, the chip holds the initial state; the editor may already be elsewhere.
    this.guard(() => {
      const off = this.mismatch(this.held);
      if (off)
        this.resync(
          this.held,
          "Start",
          "the editor was already past its initial state",
        );
      else this.setStatus("step", IN_STEP);
    });
    const queue = this.pending;
    this.pending = [];
    for (const p of queue)
      "a" in p
        ? this.step(p.before, p.a, p.after)
        : this.sync(p.state, p.label);
    this.emit(null);
  }

  /** The editor applied `a` to `before` and got `after`: the chip fires the events that cause it. */
  step(before: State, a: Action, after: State): void {
    if (!this.chip) return this.queue({ before, a, after });
    this.guard(() => {
      const words = actionWords(before, a);
      // The chip can only compute from the state it holds: otherwise load the result.
      if (!this.synced)
        return this.resync(after, words, "the file fits the chip again");
      if (before !== this.held) {
        if (this.mismatch(before))
          return this.resync(
            after,
            words,
            "the editor changed without a chip event",
          );
        this.held = before; // another object, but the state the chip holds
      }
      let ids: string[];
      try {
        ids = eventsFor(before, applied(a, after));
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        // No event, and none needed when the chip holds the result already (a rename).
        if (this.mismatch(after))
          return this.resync(after, words, refusal(e, a));
        this.held = after;
        return this.setStatus("step", IN_STEP);
      }
      const why = representable(after);
      if (why) return this.off(after, why);
      // A release names no cell: the pointer stays where it is (onHardware's stand-in 0,0 would
      // move it and switch the hit test for nothing; up reads only the drag mode).
      const firings = ids
        .map(onHardware)
        .map((f) => (f.id === "pointer#up" ? { ...f, inputs: {} } : f));
      const missing = firings.find((f) => !this.chip!.syn.codes.has(f.id));
      if (missing) {
        // A key the editor ignores (Shift, A…) has no event, and none is needed.
        if (after === before) return this.setStatus("step", IN_STEP);
        return this.resync(after, words, `the chip has no event ${missing.id}`);
      }
      const at = now();
      const nets = concat(firings.map((f) => this.chip!.fire(f.id, f.inputs)));
      this.held = after;
      const off = this.mismatch(after);
      if (off) {
        this.resync(after, words, "it was out of step");
        return this.setStatus(
          "bug",
          `Out of step after ${words}: ${off}. Resynced.`,
        );
      }
      this.setStatus("step", IN_STEP);
      // An event that changes nothing at all (the pointer still in the same cell) is not news.
      if (!nets.length) return;
      this.record({
        words,
        fired: firings.map((f) => ({
          ...f,
          code: this.chip!.syn.codes.get(f.id)!,
        })),
        nets,
        gates: this.gateCount(nets),
        loaded: false,
        at,
      });
    });
  }

  /** The editor's state was replaced without an action (undo, redo): load it into the chip. */
  sync(state: State, label: string): void {
    if (!this.chip) return this.queue({ state, label });
    this.guard(() =>
      this.resync(state, label, `${label.toLowerCase()} replaced the file`),
    );
  }

  /** Why the chip's registers are not the editor state `s`, or null when they are. */
  mismatch(s: State): string | null {
    if (!this.chip) return "the chip isn't built yet";
    const bad = representable(s);
    if (bad) return `the chip can't hold it: ${bad}`;
    try {
      const regs = this.chip.registers();
      const off = firstDiff(decode(regs, 1), viewOf(s));
      if (off) return off;
      // decode() reads the tool, not the two flags the chip keeps beside it.
      const want = stateVars(s);
      for (const flag of ["g/tCreate", "g/tSelect"])
        if (regs.get(flag) !== want.get(flag))
          return `${flag} is ${String(regs.get(flag))} on the chip, ${String(want.get(flag))} in the editor`;
      return null;
    } catch (e) {
      return `its registers don't decode (${(e as Error).message})`;
    }
  }

  /** Switched gates per block for `nets`, busiest first, without the blocks where none switched. */
  busiest(nets: Int32Array): { block: Block; switched: number }[] {
    const net = this.chip?.net;
    if (!net) return [];
    const counts = new Int32Array(this.blocks.length);
    for (const n of nets) {
      const g = net.driver[n];
      if (g >= 0) counts[this.blockOf[g]]++;
    }
    return this.blocks
      .map((block, k) => ({ block, switched: counts[k] }))
      .filter((b) => b.switched > 0)
      .sort((a, b) => b.switched - a.switched);
  }

  /** Calls `fn` after every change: with the step when the chip did something, else null. */
  listen(fn: (step: CpuStep | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Before the chip is built, an action waits for it: from start() until the build is done, or
   * has failed (nothing would replay it then). */
  private queue(p: Pending): void {
    if (this.started && this.status.kind === "wait") this.pending.push(p);
  }

  /** Loads `target` into the chip, or says why it can't hold it. */
  private resync(target: State, words: string, why: string): void {
    const bad = representable(target);
    if (bad) return this.off(target, bad);
    const at = now();
    const nets = this.chip!.load(stateVars(target));
    this.held = target;
    this.synced = true;
    this.setStatus("resync", `Resynced because ${why}.`);
    // A load that changes no net is not news either.
    if (nets.length)
      this.record({
        words,
        fired: [],
        nets,
        gates: this.gateCount(nets),
        loaded: true,
        at,
      });
  }

  private off(target: State, why: string): void {
    this.held = target;
    this.synced = false;
    this.setStatus("off", `Can't hold this file yet: ${why}.`);
  }

  private gateCount(nets: Int32Array): number {
    const driver = this.chip!.net.driver;
    let n = 0;
    for (const id of nets) if (driver[id] >= 0) n++;
    return n;
  }

  private setStatus(kind: StatusKind, text: string): void {
    if (this.status.kind === kind && this.status.text === text) return;
    this.status = { kind, text };
    this.emit(null);
  }

  private record(step: CpuStep): void {
    this.last = step;
    this.emit(step);
  }

  private emit(step: CpuStep | null): void {
    for (const fn of this.listeners) fn(step);
  }

  /** The chip is a passenger: whatever goes wrong in it shows in the status line, never in the editor. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.synced = false;
      this.pending = [];
      this.setStatus("bug", `The chip stopped: ${(e as Error).message}.`);
    }
  }
}

function concat(parts: Int32Array[]): Int32Array {
  if (parts.length === 1) return parts[0];
  const seen = new Set<number>();
  for (const p of parts) for (const n of p) seen.add(n);
  return Int32Array.from([...seen].sort((a, b) => a - b));
}

/** The app's chip, fed by main.ts and started by cpuview.ts when the CPU tab first shows. */
export const cpu = new Cpu();
