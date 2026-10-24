// Spike v2: the measurements the full CPU (≈4k actions per tick) needs, after v1 showed that
// one click with 2001 actions overflows the viewer's stack (501 is fine), that FLOAT variables
// cannot be bound to text, and that the Run loop does ~0.9 hops/s whatever the action count.
//   A. Limit N        one click = N actions, N = 600…1800 (find the crash point)
//   B. Conditionals   do skipped branches cost stack? does a CONDITIONAL give a fresh stack?
//   C. Triggers       MOUSE_DOWN + MOUSE_UP + ON_CLICK on one button: all three fire? own stacks?
//   D. Keys           ON_KEY_DOWN (Space, letters; on the frame and on a child): auto-repeat rate
//   E. Hover          MOUSE_ENTER on a grid of cells: events per second while waving the mouse
//   F. Text           ways to show a number (STRING concat, number-first concat, alias, digits)
//   G. Loops          AFTER_TIMEOUT delays, NAVIGATE vs SWAP, 3 frames, variant CHANGE_TO loops
// Each test is its own frame and flow: a crash kills the viewer, so the user reopens Present
// and picks the next flow. All counters show a concat text, a lamp that flips on every event
// and, where a rate is measured, a digits text that works even if concatenation does not.
import {
  aliasData,
  boolData,
  conditional,
  concatText,
  digitsIncrement,
  exprData,
  figmaActions,
  floatData,
  keyDown,
  mouseDown,
  mouseEnter,
  mouseUp,
  navigateWith,
  onClick,
  afterTimeout,
  setVariable,
  strData,
  worstCase,
} from "../../src/prototype/figma-actions";
import { bindVisible, box, button, COLORS, lamp, put, removeCollections, text } from "../../src/prototype/draw";
import type { PlanAction } from "../../src/prototype/types";

export const V2_LIMITS = [600, 800, 1000, 1200, 1400, 1600, 1800];
export const V2_TRIGGER_N = [10, 300, 450, 600];
export const V2_COLLECTION = "Spike v2";
export const V2_PREFIX = "v2 · ";
const POOL = 256;
export const Y0 = 3400;

export interface V2Log {
  info(msg: string): void;
  error(where: string, e: unknown): void;
}

type Flow = { nodeId: string; name: string };

/** Variables made one by one in a single collection (v2 needs a few hundred). */
class Vars {
  readonly coll: VariableCollection;
  constructor(
    private api: PluginAPI,
    name: string,
  ) {
    this.coll = api.variables.createVariableCollection(name);
  }
  private make(name: string, type: VariableResolvedDataType, init: boolean | number | string) {
    const v = this.api.variables.createVariable(name, this.coll, type);
    v.setValueForMode(this.coll.defaultModeId, init);
    return v;
  }
  bool = (name: string, init = false) => this.make(name, "BOOLEAN", init);
  float = (name: string, init = 0) => this.make(name, "FLOAT", init);
  str = (name: string, init = "") => this.make(name, "STRING", init);
}

/** A counter display: concat text, a lamp that flips per event, optional digits text. */
interface Counter {
  actions: Action[];
  node: FrameNode;
}

export class V2 {
  readonly flows: Flow[] = [];
  private vars!: Vars;
  private pool: string[] = [];
  private isTrue!: VariableData;
  private isFalse!: VariableData;

  constructor(
    private api: PluginAPI,
    private page: PageNode,
    private log: V2Log,
  ) {}

  /** Removes everything a previous v2 build made, then creates the shared variables. */
  async init(): Promise<void> {
    for (const n of [...this.page.children]) if (n.name.startsWith(V2_PREFIX)) n.remove();
    await removeCollections(this.api, V2_COLLECTION);
    this.vars = new Vars(this.api, V2_COLLECTION);
    this.pool = Array.from({ length: POOL }, (_, i) => this.vars.bool(`pool/${i}`).id);
    const t = this.vars.bool("const/true", true);
    const f = this.vars.bool("const/false", false);
    this.isTrue = exprData("EQUALS", [aliasData(t.id), boolData(true)]);
    this.isFalse = exprData("EQUALS", [aliasData(f.id), boolData(true)]);
  }

  /** n gate actions over the variable pool: p0 = ¬p0, then p[i] = p[i-1] ⊕ p[i] (cycling). */
  chain(n: number): Action[] {
    const ids = new Map(this.pool.map((id, i) => [i + 2, id]));
    const k = (i: number) => 2 + (i % POOL);
    const acts: PlanAction[] = [];
    for (let i = 0; i < n; i++)
      acts.push(i === 0 ? { set: k(0), to: { not: { var: k(0) } } } : { set: k(i), to: { neq: [{ var: k(i - 1) }, { var: k(i) }] } });
    return figmaActions(acts, ids);
  }

  counter(name: string, label: string, digits = false): Counter {
    const n = this.vars.float(`${name}/n`);
    const s = this.vars.str(`${name}/text`, "0");
    const l = this.vars.bool(`${name}/flip`);
    const actions: Action[] = [
      setVariable(n.id, exprData("ADDITION", [aliasData(n.id, "FLOAT"), floatData(1)], "FLOAT")),
      concatText(s.id, n.id),
      setVariable(l.id, exprData("NOT", [aliasData(l.id)])),
    ];
    const node = box(this.api, `counter/${name}`, 230, digits ? 92 : 64, COLORS.panel, 6);
    put(node, text(this.api, label, { size: 11, color: COLORS.dim }), 10, 6);
    const lp = lamp(this.api, 14, COLORS.lampOn, "flip");
    bindVisible(lp.lit, l);
    put(node, lp.node, 206, 8);
    const t = put(node, text(this.api, "0", { size: 22, bold: true, color: COLORS.amber, name: "count" }), 10, 24);
    this.bindText(t, s, name);
    if (digits) {
      const d = [0, 1, 2, 3].map((i) => this.vars.float(`${name}/digit${i}`));
      const ds = [0, 1, 2, 3].map((i) => this.vars.str(`${name}/digitText${i}`, "0"));
      actions.push(...digitsIncrement(d.map((v) => v.id), ds.map((v) => v.id)));
      put(node, text(this.api, "digits", { size: 10, color: COLORS.dim }), 10, 64);
      [3, 2, 1, 0].forEach((i, col) => this.bindText(put(node, text(this.api, "0", { size: 16, bold: true, name: `digit${i}` }), 60 + col * 14, 60), ds[i], name));
    }
    return { actions, node };
  }

  private bindText(t: TextNode, v: Variable, what: string): void {
    try {
      t.setBoundVariable("characters", v);
    } catch (e) {
      this.log.error(`bind text ${what}`, e);
    }
  }

  private frame(name: string, w: number, h: number, x: number, y: number, note: string, flow = true): FrameNode {
    const f = box(this.api, `${V2_PREFIX}${name}`, w, h, COLORS.bg);
    put(this.page, f, x, y);
    put(f, text(this.api, name, { size: 18, bold: true, name: "title" }), 20, 14);
    put(f, text(this.api, note, { size: 11, color: COLORS.dim, name: "note" }), 20, 42);
    if (flow) this.flows.push({ nodeId: f.id, name: `${V2_PREFIX}${name}` });
    return f;
  }

  private async react(node: SceneNode & ReactionMixin, reactions: Reaction[], what: string): Promise<boolean> {
    try {
      await node.setReactionsAsync(reactions);
      return true;
    } catch (e) {
      this.log.error(what, e);
      return false;
    }
  }

  // ---------- A. max actions per event ----------

  async limits(): Promise<void> {
    for (const [i, n] of V2_LIMITS.entries()) {
      const f = this.frame(`Limit ${n}`, 400, 230, i * 440, Y0, "One click = exactly this many actions.\nIf the viewer freezes or dies: too many.\nReopen Present and pick the next flow.");
      const c = this.counter(`limit${n}`, "clicks that completed");
      const acts = [...this.chain(n - worstCase(c.actions)), ...c.actions];
      const b = put(f, button(this.api, `Click: ${acts.length}`, COLORS.step, 180, 40), 20, 96);
      await this.react(b, [{ trigger: onClick(), actions: acts }], `limit ${n}`);
      put(f, c.node, 20, 150);
    }
    this.log.info(`v2 limits: ${V2_LIMITS.join(", ")} actions per click`);
  }

  // ---------- B. conditionals and the stack ----------

  async conditionals(): Promise<void> {
    const y = Y0 + 280;
    const tests: Array<[string, string, () => Action[]]> = [
      ["If false ×3000", "CONDITIONAL(false) around 3000 actions.\nExecutes 1 + counter. Dies → skipped\nbranches cost stack.", () => [conditional(this.isFalse, this.chain(3000))]],
      ["If true ×2500", "CONDITIONAL(true) around 2500 actions.\nDies → a conditional is no fresh stack\n(expected, like a flat list).", () => [conditional(this.isTrue, this.chain(2500))]],
      ["5 × If true ×400", "Five CONDITIONAL(true) blocks of 400\n(2000 executed). Survives → each block\ngets a fresh stack.", () => Array.from({ length: 5 }, () => conditional(this.isTrue, this.chain(400)))],
      [
        "Nested 4 × 500",
        "if true {500; if true {500; if true\n{500; if true {500}}}} (2000 executed).",
        () => {
          let inner: Action[] = this.chain(500);
          for (let k = 0; k < 3; k++) inner = [...this.chain(500), conditional(this.isTrue, inner)];
          return [conditional(this.isTrue, inner)];
        },
      ],
    ];
    for (const [i, [name, note, make]] of tests.entries()) {
      const f = this.frame(name, 400, 240, i * 440, y, note);
      const c = this.counter(`cond${i}`, "clicks that completed");
      const acts = [...make(), ...c.actions];
      const b = put(f, button(this.api, "Click", COLORS.step, 140, 40), 20, 104);
      await this.react(b, [{ trigger: onClick(), actions: acts }], name);
      put(f, c.node, 20, 160);
    }
    this.log.info("v2 conditionals: 4 frames");
  }

  // ---------- C. several triggers on one node ----------

  async triggers(): Promise<void> {
    const f = this.frame(
      "Triggers",
      1000,
      420,
      0,
      Y0 + 580,
      "Each button has MOUSE_DOWN, MOUSE_UP and ON_CLICK reactions, each running N actions + its own counter.\nClick each button once (smallest first). Do all three counters move? Does 3 × N exceed the one-click limit without dying?",
    );
    for (const [i, n] of V2_TRIGGER_N.entries()) {
      const x = 20 + i * 245;
      const b = put(f, button(this.api, `3 triggers × ${n}`, COLORS.step, 200, 40), x, 84);
      const cs = (["down", "up", "click"] as const).map((k) => this.counter(`trig${n}/${k}`, `${k} (${n} actions)`));
      cs.forEach((c, k) => put(f, c.node, x, 140 + k * 72));
      const mk = (c: Counter) => [...this.chain(n), ...c.actions];
      const all: Reaction[] = [
        { trigger: mouseDown(), actions: mk(cs[0]) },
        { trigger: mouseUp(), actions: mk(cs[1]) },
        { trigger: onClick(), actions: mk(cs[2]) },
      ];
      if (!(await this.react(b, all, `triggers ${n} (down+up+click)`)))
        if (!(await this.react(b, all.slice(0, 2), `triggers ${n} (down+up)`))) await this.react(b, all.slice(2), `triggers ${n} (click)`);
    }
    this.log.info("v2 triggers: MOUSE_DOWN + MOUSE_UP + ON_CLICK on one node");
  }

  // ---------- D. keys ----------

  async keys(): Promise<void> {
    const f = this.frame(
      "Keys",
      760,
      420,
      1040,
      Y0 + 580,
      "Click once inside the prototype to give it keyboard focus. Then HOLD each key for 5 s (stopwatch)\nand note the counter: does it auto-repeat? Space, K: 10 actions. J: 450 actions. L: reaction on a child\nlayer. M: reaction on a hidden child.",
    );
    const specs: Array<[string, number, number, "frame" | "child" | "hidden"]> = [
      ["Space", 32, 10, "frame"],
      ["K", 75, 10, "frame"],
      ["J", 74, 450, "frame"],
      ["L", 76, 10, "child"],
      ["M", 77, 10, "hidden"],
    ];
    const frameReactions: Reaction[] = [];
    for (const [i, [label, code, n, where]] of specs.entries()) {
      const c = this.counter(`key${label}`, `${label} held (${n} actions)`, true);
      put(f, c.node, 20 + (i % 3) * 245, 110 + Math.floor(i / 3) * 110);
      const r: Reaction = { trigger: keyDown([code]), actions: [...this.chain(n), ...c.actions] };
      if (where === "frame") frameReactions.push(r);
      else {
        const target = put(f, box(this.api, `key target ${label}`, 120, 40, COLORS.reset, 6), 500 + (where === "hidden" ? 130 : 0), 330);
        put(target, text(this.api, `${label} target${where === "hidden" ? " (hidden)" : ""}`, { size: 11 }), 8, 12);
        await this.react(target, [r], `key ${label} on a child`);
        if (where === "hidden") target.visible = false;
      }
    }
    await this.react(f, frameReactions, "keys on the frame");
    this.log.info("v2 keys: Space, K, J on the frame; L on a child; M on a hidden child");
  }

  // ---------- E. hover ----------

  async hover(): Promise<void> {
    const f = this.frame("Hover", 760, 420, 1840, Y0 + 580, "Every cell has MOUSE_ENTER → 100 actions + counter.\nWave the mouse across the grid for 5 s; note the counter.");
    const c = this.counter("hover", "cells entered", true);
    put(f, c.node, 500, 90);
    const acts = [...this.chain(100), ...c.actions];
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 7; k++) {
        const cell = put(f, box(this.api, `cell ${r}.${k}`, 56, 56, (r + k) % 2 ? COLORS.panel : COLORS.lampOff, 4), 20 + k * 64, 90 + r * 64);
        await this.react(cell, [{ trigger: mouseEnter(), actions: acts }], `hover cell ${r}.${k}`);
      }
    this.log.info("v2 hover: 28 cells with MOUSE_ENTER");
  }

  // ---------- F. numbers as text ----------

  async textDisplay(): Promise<void> {
    const f = this.frame("Text", 1000, 300, 0, Y0 + 1060, "Click each button 3 times. Which texts show 1, 2, 3?");
    const n = [1, 2, 3].map((i) => this.vars.float(`text/n${i}`));
    const s = [1, 2, 3].map((i) => this.vars.str(`text/s${i}`, "–"));
    const ways: Array<[string, Action[], number]> = [
      ["E1 \"n=\" + number", [concatText(s[0].id, n[0].id, "n=")], 0],
      ["E2 number + \"\"", [setVariable(s[1].id, exprData("ADDITION", [aliasData(n[1].id, "FLOAT"), strData("")], "STRING"))], 1],
      ["E3 string := number alias", [setVariable(s[2].id, aliasData(n[2].id, "FLOAT"))], 2],
    ];
    for (const [i, [label, acts, k]] of ways.entries()) {
      const x = 20 + i * 240;
      const b = put(f, button(this.api, label, COLORS.step, 220, 40), x, 84);
      await this.react(b, [{ trigger: onClick(), actions: [setVariable(n[k].id, exprData("ADDITION", [aliasData(n[k].id, "FLOAT"), floatData(1)], "FLOAT")), ...acts] }], label);
      const t = put(f, text(this.api, "–", { size: 28, bold: true, color: COLORS.amber }), x, 140);
      this.bindText(t, s[k], label);
    }
    const c = this.counter("text/digits", "E4 digits (and concat)", true);
    const b = put(f, button(this.api, "E4 digits", COLORS.step, 220, 40), 740, 84);
    await this.react(b, [{ trigger: onClick(), actions: c.actions }], "E4 digits");
    put(f, c.node, 740, 140);
    this.log.info("v2 text: concat (string+number, number+string), alias, digits");
  }

  // ---------- G. run-loop speed ----------

  async loops(): Promise<void> {
    const y = Y0 + 1420;
    const menu = this.frame(
      "Loops",
      1000,
      560,
      0,
      y,
      "Start one loop, wait 10 s (stopwatch), read its hop counter, click Stop. Also select each loop frame in the editor\nand note the 'After delay' value the Prototype panel shows.",
    );
    const running = this.vars.bool("loop/running");
    const isRunning = exprData("EQUALS", [aliasData(running.id), boolData(true)]);
    const stopActs = [setVariable(running.id, boolData(false))];
    const specs: Array<{ name: string; frames: number; nav: "NAVIGATE" | "SWAP"; t: number }> = [
      { name: "NAVIGATE t=1", frames: 2, nav: "NAVIGATE", t: 1 },
      { name: "NAVIGATE t=10", frames: 2, nav: "NAVIGATE", t: 10 },
      { name: "NAVIGATE t=100", frames: 2, nav: "NAVIGATE", t: 100 },
      { name: "NAVIGATE t=0", frames: 2, nav: "NAVIGATE", t: 0 },
      { name: "SWAP t=1", frames: 2, nav: "SWAP", t: 1 },
      { name: "NAVIGATE 3 frames t=1", frames: 3, nav: "NAVIGATE", t: 1 },
    ];
    let row = 0;
    for (const spec of specs) {
      const c = this.counter(`loop/${spec.name}`, `${spec.name}: hops`, true);
      const frames = Array.from({ length: spec.frames }, (_, k) => {
        const lf = this.frame(`Loop ${spec.name} · ${"ABC"[k]}`, 300, 200, 1040 + k * 320, y + row * 230, "Running… Stop returns to Loops.", false);
        put(lf, c.node.clone(), 20, 70);
        return lf;
      });
      for (const [k, lf] of frames.entries()) {
        const stop = put(lf, button(this.api, "Stop", COLORS.stop, 90, 32), 196, 10);
        await this.react(stop, [{ trigger: onClick(), actions: stopActs }], `${spec.name} stop`);
        const next = frames[(k + 1) % frames.length];
        const hop = conditional(isRunning, [...c.actions, navigateWith(next.id, spec.nav)], [navigateWith(menu.id, "NAVIGATE")]);
        if (await this.react(lf, [{ trigger: afterTimeout(spec.t), actions: [hop] }], `${spec.name} loop`))
          this.log.info(`${spec.name}: timeout read back = ${JSON.stringify((lf.reactions[0]?.trigger as { timeout?: number } | null)?.timeout)}`);
      }
      const start = put(menu, button(this.api, `Start ${spec.name}`, COLORS.run, 220, 36), 20, 90 + row * 74);
      await this.react(start, [{ trigger: onClick(), actions: [setVariable(running.id, boolData(true)), navigateWith(frames[0].id, "NAVIGATE")] }], `${spec.name} start`);
      put(menu, c.node, 260, 80 + row * 74);
      row++;
    }
    // Interactive-component loops: two variants that CHANGE_TO each other after a delay.
    for (const [j, t] of [1, 0].entries()) {
      const name = `variants t=${t}`;
      await this.variantLoop(name, t, j, menu, y);
    }
    this.log.info("v2 loops: NAVIGATE t=1/10/100/0, SWAP, 3 frames, variant CHANGE_TO t=1/0");
  }

  private async variantLoop(name: string, t: number, j: number, menu: FrameNode, y: number): Promise<void> {
    const [mx, my] = [520, 90 + j * 150];
    const c = this.counter(`loop/${name}`, `${name}: hops`, true);
    const lf = this.frame(`Loop ${name}`, 420, 200, 1040 + j * 460, y + 6 * 230, "The instance flips variants by itself (CHANGE_TO\nafter a delay). Back returns to Loops.", false);
    const variants = (["A", "B"] as const).map((k) => {
      const comp = this.api.createComponent();
      comp.name = `state=${k}`;
      comp.resize(120, 40);
      comp.fills = [{ type: "SOLID", color: k === "A" ? { r: 0.2, g: 0.4, b: 0.9 } : { r: 0.9, g: 0.5, b: 0.1 } }];
      put(comp, text(this.api, `variant ${k}`, { size: 12, color: "#ffffff" }), 10, 12);
      return comp;
    });
    let set: ComponentSetNode | null = null;
    try {
      set = this.api.combineAsVariants(variants, this.page);
      set.name = `${V2_PREFIX}variants ${name}`;
      set.x = lf.x;
      set.y = lf.y + 220;
    } catch (e) {
      this.log.error(`${name}: combineAsVariants`, e);
      return;
    }
    for (const [k, comp] of variants.entries())
      await this.react(comp, [{ trigger: afterTimeout(t), actions: [...c.actions, navigateWith(variants[1 - k].id, "CHANGE_TO")] }], `${name} variant ${k}`);
    put(lf, variants[0].createInstance(), 20, 70);
    put(lf, c.node, 160, 70);
    const back = put(lf, button(this.api, "Back", COLORS.stop, 90, 32), 310, 10);
    await this.react(back, [{ trigger: onClick(), actions: [navigateWith(menu.id, "NAVIGATE")] }], `${name} back`);
    const start = put(menu, button(this.api, `Open ${name}`, COLORS.run, 220, 36), mx, my);
    await this.react(start, [{ trigger: onClick(), actions: [navigateWith(lf.id, "NAVIGATE")] }], `${name} open`);
    put(menu, c.node.clone(), mx + 240, my - 10);
  }
}
