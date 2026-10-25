// Reaction synthesis: what ONE Figma trigger contains for ONE editor event.
//
// The machine is the same gates for every event, but a given event uses a small part of them.
// For an event (EVT tied to its code, ARG tied if the button fixes it, optionally the tool / drag
// mode tied because the clicked layer only exists in that mode) this:
//   1. folds the constants through the netlist (a tied line makes whole units constant);
//   2. turns identity gates (AND x 1, OR x 0, BUF …) into wires, and two gates of the same kind on
//      the same inputs into one;
//   3. keeps only what can change a register this event, plus the screen lines that depend on a
//      register that loads; the logic that only feeds one register's D moves inside that register's
//      `if (enable)` and is simplified there, where its LOAD is known to be 1;
//   4. emits ONE evaluation pass, then the commit:
//        LOW    CLK = 0, the logic in dependency order, each loading register's master latch
//        HIGH   CLK = 1, each loading register's slave latch
//        SCREEN the screen decode, each block behind `if (a register it reads loaded)`
//      or, with the "direct" commit, the logic, then Q = D for each loading register (the master
//      latch is the temporary only where registers swap); between events a master equals its
//      slave, so the master's lamps are bound to Q (`masterToQ`) and nothing on screen goes stale
// Every conditional is one level deep (`if (enable) { gates }`), which is what the editor itself
// can author. Every register group sits behind its own enable, so an idle register costs one
// action, or nothing when the event cannot load it.
// A RAM word (cells.ts, RAMW) is a group with a master and no slave: its master latch is its
// output, written in LOW and left alone in HIGH.
//
// The result is a PlanAction list (src/prototype/types.ts), convertible to Figma actions with
// `figmaActions`. Executing it on the machine's variables gives the same registers and the same
// screen lines as the full two-pass tick (checked by test/react.test.ts).
import { gateExpr } from "../../../src/prototype/plan";
import type { Expr, PlanAction } from "../../../src/prototype/types";
import {
  evalGate,
  type FlatGate,
  type FlatNetlist,
  type GateType,
  NET0,
  NET1,
} from "../../../src/netlist/types";

type K = 0 | 1 | 2; // 2 = unknown

function eval3(t: GateType, a: K, b: K): K {
  switch (t) {
    case "BUF":
      return a;
    case "NOT":
      return a === 2 ? 2 : ((a ^ 1) as K);
    case "AND":
      return a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : 2;
    case "OR":
      return a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : 2;
    case "NAND":
      return a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : 2;
    case "NOR":
      return a === 1 || b === 1 ? 0 : a === 0 && b === 0 ? 1 : 2;
    default:
      return a === 2 || b === 2 ? 2 : (evalGate(t, a, b) as K);
  }
}

// ---------- gate classes, by hierarchical path ----------

const RE_M = /^(.*)\/m\d+_(take|hold|merge)$/;
const RE_S = /^(.*)\/s\d+_(take|hold|merge)$/;
const RE_C = /^(.*)\/(men|nmen)$/;
/** Instance name of the screen decode in ENGINE. */
export const DISPLAY_PREFIX = "disp/";
/** The global inverted clock gate at the top of ENGINE. */
export const NCLK_PATH = "nclk";

/** M master latch gate (a RAM word's only latch), S slave latch gate, C register enable gate,
 * D screen decode, X plain logic. */
export type Cls = "M" | "S" | "C" | "D" | "X";
export interface Info {
  c: Cls;
  /** Register group (instance path of the REGS cell) for M / S / C. */
  group: string;
}
export function classify(g: Pick<FlatGate, "path">): Info {
  let m = RE_M.exec(g.path);
  if (m) return { c: "M", group: m[1] };
  m = RE_S.exec(g.path);
  if (m) return { c: "S", group: m[1] };
  m = RE_C.exec(g.path);
  if (m) return { c: "C", group: m[1] };
  if (g.path.startsWith(DISPLAY_PREFIX)) return { c: "D", group: "" };
  return { c: "X", group: "" };
}

export interface SynthStats {
  /** Gates left after folding and pruning. */
  kept: number;
  /** Gates folded to constants. */
  folded: number;
  /** Identity gates turned into wires. */
  aliased: number;
  /** Gates merged into an identical one (same kind, same inputs). */
  merged: number;
  /** Gates that fold away inside a register's `if (enable)`, where its LOAD is 1. */
  implied: number;
  groupsLive: number;
  groupsInert: number;
  /** Screen gates evaluated (when their registers load). */
  displayGates: number;
  displayBlocks: number;
  /** How the latches were committed. */
  latch: Commit;
}

export interface Reaction {
  actions: PlanAction[];
  /** Index in `actions` where the screen refresh starts (everything after it only updates lamps). */
  screenAt: number;
  /** Index in `actions` of the first write to a register: before it there is only logic. */
  commitAt: number;
  stats: SynthStats;
  /** Net ids of the `men` enables of the live register groups, by group path. */
  men: Map<string, number>;
}

/** Ties: a top-level input port name, or any net name, to a constant. */
export type Tie = Record<string, number>;

/** "gates": every latch gate (6 actions a bit). "compact": `m = D`, `Q = m` (2). "direct": `Q = D` (1). */
export type Commit = "gates" | "compact" | "direct";

export interface SynthOptions {
  /** Turn identity gates into wires (default true). Off: every gate keeps its own action, and
   * every lamp on the drawn circuit follows (about 30% more actions). */
  alias?: boolean;
  /** Move the logic only one register's D reads into that register's `if (enable)`, simplified
   * with its LOAD = 1 (default true, with `alias`). Fewer actions, but a longer commit: off where
   * the commit has to fit one event. */
  inside?: boolean;
  /** How a loading register is committed. "gates": every latch gate is evaluated (6 per bit, all
   * lamps follow). "compact": inside `if (enable)` a latch is exactly `m = D` and `Q = m`, 2 per
   * bit; the take / hold gates of the latch keep their last lamp. "direct": `Q = D`, 1 per bit (the
   * master's lamp shows Q, which it equals between events). "auto" (default): gates, unless the
   * reaction would exceed `budget` actions, then direct. */
  latch?: Commit | "auto";
  /** Largest reaction (actions, counting every branch) before "auto" commits directly. Default 900. */
  budget?: number;
  /** Registers whose value is known when the event starts (a register net or bus name → value),
   * because the control that runs the reaction only shows in that state. The logic reads them as
   * constants; the commit and the screen still see what they become. */
  given?: Tie;
}

export function synthesize(
  net: FlatNetlist,
  tie: Tie,
  opts: SynthOptions = {},
): Reaction {
  const nNets = net.netNames.length;
  const clk = net.aliases.get("CLK")!;

  // what the event knows of the registers: the logic reads those as constants (the screen does not:
  // it shows the registers after the commit)
  const givenNet = new Map<number, number>();
  for (const [name, value] of Object.entries(opts.given ?? {})) {
    const one = net.aliases.get(name);
    const ids =
      one !== undefined
        ? [one]
        : Array.from({ length: 32 }, (_, i) => net.aliases.get(`${name}[${i}]`)).filter(
            (id): id is number => id !== undefined,
          );
    if (!ids.length) throw new Error(`cannot assume ${name}: no such net`);
    ids.forEach((id, i) => givenNet.set(id, (value >> i) & 1 ? NET1 : NET0));
  }
  const source = givenNet.size
    ? net.gates.map((g) =>
        classify(g).c === "D" || !g.in.some((n) => givenNet.has(n))
          ? g
          : { ...g, in: g.in.map((n) => givenNet.get(n) ?? n) },
      )
    : net.gates;

  // the register groups with a slave latch (the others are RAM words: the master is the output)
  const slaved = slaveGroups(net);

  // 1. constants
  const Kv = new Int8Array(nNets).fill(2);
  Kv[NET0] = 0;
  Kv[NET1] = 1;
  for (const [name, value] of Object.entries(tie)) {
    const port = net.ports.find((p) => p.name === name);
    if (port) port.nets.forEach((id, i) => (Kv[id] = (value >> i) & 1));
    else {
      const id = net.aliases.get(name);
      if (id === undefined) throw new Error(`cannot tie ${name}: no such net`);
      Kv[id] = value & 1;
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const g of source) {
      const y = eval3(
        g.type,
        Kv[g.in[0]] as K,
        g.in.length > 1 ? (Kv[g.in[1]] as K) : 0,
      );
      if (y !== 2 && Kv[g.out] !== y) {
        Kv[g.out] = y;
        changed = true;
      }
    }
  }
  const lit = (id: number) => (Kv[id] === 0 ? NET0 : Kv[id] === 1 ? NET1 : id);

  // register groups that cannot load in this event vanish
  const inert = new Set<string>();
  const live = new Set<string>();
  for (const g of source) {
    const c = classify(g);
    if (c.c === "C" && g.path.endsWith("/men"))
      (Kv[g.out] === 0 ? inert : live).add(c.group);
  }

  // 2. fold constant gates away, substitute literals
  let gates: FlatGate[] = [];
  let folded = 0;
  for (const g of source) {
    if (Kv[g.out] !== 2) {
      folded++;
      continue;
    }
    const c = classify(g);
    if ((c.c === "M" || c.c === "S" || c.c === "C") && inert.has(c.group))
      continue;
    gates.push({ ...g, in: g.in.map(lit) });
  }

  // 3. identity gates become wires (plain logic only: register and screen nets are observed)
  const alias = Int32Array.from({ length: nNets }, (_, i) => i);
  const find = (x: number) => {
    while (alias[x] !== x) {
      alias[x] = alias[alias[x]];
      x = alias[x];
    }
    return x;
  };
  let aliased = 0;
  let merged = 0;
  const COMMUTES = new Set<GateType>([
    "AND",
    "OR",
    "NAND",
    "NOR",
    "XOR",
    "XNOR",
  ]);
  if (opts.alias !== false) {
    const dead = new Uint8Array(gates.length);
    for (let changed = true; changed;) {
      changed = false;
      // two gates of the same kind on the same inputs are one gate: the later becomes a wire
      const first = new Map<string, number>();
      gates.forEach((g, i) => {
        if (dead[i] || classify(g).c !== "X" || g.path === NCLK_PATH) return;
        const ins = g.in.map(find);
        if (COMMUTES.has(g.type)) ins.sort((x, y) => x - y);
        const key = `${g.type}:${ins.join(",")}`;
        const to = first.get(key);
        if (to === undefined) first.set(key, g.out);
        else if (find(to) !== find(g.out)) {
          alias[g.out] = find(to);
          dead[i] = 1;
          merged++;
          changed = true;
        }
      });
      gates.forEach((g, i) => {
        if (dead[i] || classify(g).c !== "X" || g.path === NCLK_PATH) return;
        const a = find(g.in[0]);
        const b = g.in.length > 1 ? find(g.in[1]) : -1;
        let to = -1;
        if (g.type === "BUF") to = a;
        else if (g.type === "AND")
          to = a === NET1 ? b : b === NET1 ? a : a === b ? a : -1;
        else if (g.type === "OR")
          to = a === NET0 ? b : b === NET0 ? a : a === b ? a : -1;
        else if (g.type === "XOR") to = a === NET0 ? b : b === NET0 ? a : -1;
        else if (g.type === "XNOR") to = a === NET1 ? b : b === NET1 ? a : -1;
        if (to >= 0 && to !== g.out) {
          alias[g.out] = find(to);
          dead[i] = 1;
          aliased++;
          changed = true;
        }
      });
    }
    gates = gates.filter((_, i) => !dead[i]);
  }
  gates.forEach((g) => (g.in = g.in.map(find)));

  // 4. prune: registers that load, the logic they need, the screen lines that read them
  const info = gates.map(classify);
  const driver = new Int32Array(nNets).fill(-1);
  gates.forEach((g, i) => (driver[g.out] = i));
  const keep = new Uint8Array(gates.length);
  const stack: number[] = [];
  gates.forEach((_, i) => {
    if (info[i].c === "M" || info[i].c === "S" || info[i].c === "C") {
      keep[i] = 1;
      stack.push(i);
    }
  });
  while (stack.length) {
    const i = stack.pop()!;
    for (const inp of gates[i].in) {
      const d = driver[inp];
      if (d >= 0 && !keep[d] && (info[d].c === "X" || info[d].c === "C")) {
        keep[d] = 1;
        stack.push(d);
      }
    }
  }
  // screen gates: which register groups does each read (through other screen gates)?
  // A register's output is its slave's; a RAM word (no slave) shows its master. Read from the full
  // netlist: the groups dropped as inert are not in `gates`.
  const groupOfQ = new Map<number, string>(); // net id of a register output -> its group
  for (const g of net.gates) {
    const c = classify(g);
    if (c.c === "S" && g.path.endsWith("_merge")) groupOfQ.set(g.out, c.group);
  }
  for (const g of net.gates) {
    const c = classify(g);
    if (c.c === "M" && g.path.endsWith("_merge") && !slaved.has(c.group))
      groupOfQ.set(g.out, c.group);
  }
  const support = new Map<number, Set<string>>();
  const supportOf = (i: number): Set<string> => {
    const hit = support.get(i);
    if (hit) return hit;
    const s = new Set<string>();
    support.set(i, s); // screen logic is acyclic
    for (const inp of gates[i].in) {
      const grp = groupOfQ.get(inp);
      if (grp !== undefined) s.add(grp);
      const d = driver[inp];
      if (d >= 0 && info[d].c === "D") for (const x of supportOf(d)) s.add(x);
    }
    return s;
  };
  const displayKept: number[] = [];
  gates.forEach((_, i) => {
    if (info[i].c !== "D") return;
    const s = [...supportOf(i)].filter((grp) => live.has(grp));
    if (s.length) {
      keep[i] = 1;
      displayKept.push(i);
    }
  });

  const kept = gates.map((g, i) => (keep[i] ? i : -1)).filter((i) => i >= 0);

  // 5. emit
  const set = (g: FlatGate): PlanAction => ({ set: g.out, to: gateExpr(g) });
  const comb = (gi: number) => info[gi].c === "X" || info[gi].c === "C";
  const nclkGate = gates.findIndex((g) => g.path === NCLK_PATH);
  const C0 = { const: 0 } as const;
  const C1 = { const: 1 } as const;

  // plain logic in dependency order (the same for both commit styles, minus nmen when compact)
  const order: number[] = [];
  const seen = new Uint8Array(gates.length);
  const visit = (gi: number) => {
    if (seen[gi]) return;
    seen[gi] = 1;
    for (const inp of gates[gi].in) {
      const d = driver[inp];
      if (d >= 0 && keep[d] && comb(d) && d !== nclkGate) visit(d);
    }
    order.push(gi);
  };
  for (const gi of kept) if (comb(gi) && gi !== nclkGate) visit(gi);

  // register groups: their latch gates, bit by bit
  interface Bit {
    take: number;
    mmerge: number;
    smerge: number;
  }
  const groups = new Map<
    string,
    {
      m: number[];
      s: number[];
      men: number;
      nmen: number;
      bits: Map<number, Bit>;
    }
  >();
  for (const gi of kept) {
    const c = info[gi];
    if (c.c !== "M" && c.c !== "S" && c.c !== "C") continue;
    const e = groups.get(c.group) ?? {
      m: [] as number[],
      s: [] as number[],
      men: -1,
      nmen: -1,
      bits: new Map<number, Bit>(),
    };
    groups.set(c.group, e);
    const leaf = gates[gi].path.slice(c.group.length + 1);
    const bitOf = (): Bit => {
      const i = Number(/\d+/.exec(leaf)![0]);
      const b = e.bits.get(i) ?? { take: -1, mmerge: -1, smerge: -1 };
      e.bits.set(i, b);
      return b;
    };
    if (c.c === "M") {
      e.m.push(gi);
      if (leaf.endsWith("_take")) bitOf().take = gi;
      else if (leaf.endsWith("_merge")) bitOf().mmerge = gi;
    } else if (c.c === "S") {
      e.s.push(gi);
      if (leaf.endsWith("_merge")) bitOf().smerge = gi;
    } else if (leaf === "men") e.men = gi;
    else e.nmen = gi;
  }
  const menOf = new Map<string, number>();
  for (const [grp, e] of groups) {
    if (e.men < 0) throw new Error(`register group ${grp} has no enable gate`);
    menOf.set(grp, gates[e.men].out);
  }
  // 4b. inside `if (enable)` a register's LOAD is 1. The logic that only that register's D reads
  // moves into its block (it runs only when the register loads) and folds under LOAD = 1: for
  // example a layer's input mux AND(select, data) becomes plain data when the select is the load.
  const moved = new Uint8Array(gates.length);
  const inside = new Map<
    string,
    { gates: FlatGate[]; res: (n: number) => number }
  >();
  let implied = 0;
  if (opts.alias !== false && opts.inside !== false) {
    const readers = new Map<number, number[]>();
    for (const gi of kept)
      for (const n of gates[gi].in) {
        const r = readers.get(n);
        if (r) r.push(gi);
        else readers.set(n, [gi]);
      }
    const position = new Int32Array(gates.length).fill(-1);
    order.forEach((gi, k) => (position[gi] = k));
    const nclkNet = nclkGate >= 0 ? gates[nclkGate].out : -1;
    const plain = (d: number) =>
      d >= 0 && keep[d] && info[d].c === "X" && d !== nclkGate && !moved[d];
    for (const [grp, e] of groups) {
      const load = gates[e.men].in.find((n) => n !== nclkNet);
      if (load === undefined || load <= NET1) continue;
      const takes = new Set<number>();
      for (const b of e.bits.values()) if (b.take >= 0) takes.add(b.take);
      // the cone only this register reads: every reader is one of its take gates or in the cone
      const mine = new Set<number>();
      let frontier = [...takes]
        .map((t) => driver[gates[t].in[0]])
        .filter(plain);
      while (frontier.length) {
        const next: number[] = [];
        for (const gi of frontier) {
          if (mine.has(gi)) continue;
          const rs = readers.get(gates[gi].out) ?? [];
          if (!rs.every((r) => takes.has(r) || mine.has(r))) continue;
          mine.add(gi);
          for (const n of gates[gi].in)
            if (plain(driver[n])) next.push(driver[n]);
        }
        frontier = next;
      }
      if (!mine.size) continue;
      // what LOAD = 1 implies, then constants and identities through the cone, in dependency order
      const known = new Map<number, 0 | 1>();
      const imply = (n: number, v: 0 | 1) => {
        if (n <= NET1 || known.has(n)) return;
        known.set(n, v);
        const d = driver[n];
        if (d < 0) return;
        const g = gates[d];
        if (g.type === "AND" && v === 1) g.in.forEach((x) => imply(x, 1));
        else if (g.type === "OR" && v === 0) g.in.forEach((x) => imply(x, 0));
        else if (g.type === "NOT") imply(g.in[0], v === 1 ? 0 : 1);
        else if (g.type === "BUF") imply(g.in[0], v);
      };
      imply(load, 1);
      const same = new Map<number, number>();
      const res = (n: number): number => {
        const v = known.get(n);
        if (v !== undefined) return v ? NET1 : NET0;
        return same.get(n) ?? n;
      };
      const kOf = (n: number): K => (n === NET0 ? 0 : n === NET1 ? 1 : 2);
      const body: FlatGate[] = [];
      for (const gi of [...mine].sort((a, b) => position[a] - position[b])) {
        const g = gates[gi];
        const ins = g.in.map(res);
        const [a, b] = [ins[0], ins.length > 1 ? ins[1] : -1];
        const y = eval3(g.type, kOf(a), b < 0 ? 0 : kOf(b));
        let to = -1;
        if (y !== 2) to = y ? NET1 : NET0;
        else if (g.type === "BUF") to = a;
        else if (g.type === "AND")
          to = a === NET1 ? b : b === NET1 ? a : a === b ? a : -1;
        else if (g.type === "OR")
          to = a === NET0 ? b : b === NET0 ? a : a === b ? a : -1;
        else if (g.type === "XOR") to = a === NET0 ? b : b === NET0 ? a : -1;
        else if (g.type === "XNOR") to = a === NET1 ? b : b === NET1 ? a : -1;
        if (to >= 0) {
          same.set(g.out, to);
          implied++;
        } else body.push({ ...g, in: ins });
      }
      for (const gi of mine) moved[gi] = 1;
      inside.set(grp, { gates: body, res });
    }
  }
  /** What a register's block runs before its commit, and how it reads a net there. */
  const blockOf = (grp: string) =>
    inside.get(grp) ?? { gates: [] as FlatGate[], res: (n: number) => n };

  const var_ = (n: number): Expr => ({ var: n });
  // a condition is always an expression, never a bare variable: EQUALS(var, true), or an OR of them
  // for a screen block that several registers feed (the shapes the real viewer runs)
  const isOn = (n: number): Expr => ({ eq: [{ var: n }, { const: 1 }] });

  // screen blocks: one per distinct set of live register groups; a block reads only registers and
  // earlier blocks of a subset, so smaller sets go first
  const blocks = new Map<string, { groups: string[]; gates: number[] }>();
  const dorder: number[] = [];
  const dseen = new Uint8Array(gates.length);
  const dvisit = (gi: number) => {
    if (dseen[gi]) return;
    dseen[gi] = 1;
    for (const inp of gates[gi].in) {
      const d = driver[inp];
      if (d >= 0 && keep[d] && info[d].c === "D") dvisit(d);
    }
    dorder.push(gi);
  };
  for (const gi of displayKept) dvisit(gi);
  for (const gi of dorder) {
    const sup = [...supportOf(gi)].filter((grp) => live.has(grp)).sort();
    const key = sup.join("|");
    const b = blocks.get(key) ?? { groups: sup, gates: [] };
    blocks.set(key, b);
    b.gates.push(gi);
  }
  const screen: PlanAction[] = [];
  [...blocks.values()]
    .sort((a, b) => a.groups.length - b.groups.length)
    .forEach((b) => {
      const guard: Expr = b.groups
        .map((grp): Expr => isOn(menOf.get(grp)!))
        .reduce((x, y) => ({ or: [x, y] }));
      screen.push({ if: guard, then: b.gates.map((gi) => set(gates[gi])) });
    });

  const emit = (
    commit: Commit,
  ): { actions: PlanAction[]; screenAt: number; commitAt: number } => {
    const nclk: PlanAction[] = nclkGate >= 0 ? [set(gates[nclkGate])] : [];
    const low: PlanAction[] = [
      { set: clk, to: C0 },
      ...nclk,
      ...order
        .filter(
          (gi) =>
            !moved[gi] &&
            !(
              commit !== "gates" &&
              info[gi].c === "C" &&
              gates[gi].path.endsWith("/nmen")
            ),
        )
        .map((gi) => set(gates[gi])),
    ];
    const high: PlanAction[] = [{ set: clk, to: C1 }, ...nclk];
    if (commit === "direct") {
      const { early, writes } = directCommit();
      low.push(...early);
      const commitAt = low.length;
      low.push(...writes);
      return {
        actions: [...low, ...high, ...screen],
        screenAt: low.length + high.length,
        commitAt,
      };
    }
    const commitAt = low.length;
    for (const [grp, e] of groups) {
      const men = menOf.get(grp)!;
      const { gates: cone, res } = blockOf(grp);
      const first = cone.map(set);
      if (commit === "gates") {
        low.push({
          if: isOn(men),
          then: [
            ...first,
            ...e.m.map((gi) =>
              set({ ...gates[gi], in: gates[gi].in.map(res) }),
            ),
          ],
        });
        if (e.s.length)
          high.push({ if: isOn(men), then: e.s.map((gi) => set(gates[gi])) });
        continue;
      }
      // with the enable on: master m = D (take = D·1, hold = m·0), slave Q = m (take = m·1, hold = Q·0);
      // a RAM word's master is its output, done in LOW
      const bits = latchBits(grp, e);
      low.push({
        if: isOn(men),
        then: [
          ...first,
          ...bits.map((b): PlanAction => ({ set: b.m, to: litExpr(b.d) })),
        ],
      });
      if (slaved.has(grp))
        high.push({
          if: isOn(men),
          then: bits.map((b): PlanAction => ({ set: b.q, to: var_(b.m) })),
        });
    }
    return {
      actions: [...low, ...high, ...screen],
      screenAt: low.length + high.length,
      commitAt,
    };
  };

  /** A group's bits: D as its block reads it (a net, or a constant when it folded away), master
   * and output nets (the slave's; a RAM word's master is its output). */
  const latchBits = (grp: string, e: { bits: Map<number, Bit> }) => {
    const { res } = blockOf(grp);
    return [...e.bits.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, b]) => ({
        d: b.take >= 0 ? res(gates[b.take].in[0]) : NET0,
        m: gates[b.mmerge].out,
        q: gates[b.smerge >= 0 ? b.smerge : b.mmerge].out,
      }));
  };

  /** Q = D for every loading register, ordered so a register is written only after every register
   * that reads it, as its D or in the logic its block runs first (a shift writes the far end
   * first). Registers in a cycle of D's (two records swapping), or reading another bit of
   * themselves, go through the master: m = D before the others, Q = m after them. A block whose
   * logic would close a cycle runs that logic early, before any register is written. */
  const directCommit = (): { early: PlanAction[]; writes: PlanAction[] } => {
    const list = [...groups.entries()].map(([grp, e]) => ({
      men: menOf.get(grp)!,
      bits: latchBits(grp, e),
      cone: blockOf(grp).gates,
    }));
    const all = list.map((_, i) => i);
    const owner = new Map<number, number>();
    list.forEach((g, i) => g.bits.forEach((b) => owner.set(b.q, i)));
    const before: number[][] = list.map(() => []); // i must commit before every j in before[i]
    const reads: number[][] = list.map(() => []); // the registers i's block logic reads
    const viaMaster = new Uint8Array(list.length);
    list.forEach((g, i) => {
      g.bits.forEach((b) => {
        const j = owner.get(b.d);
        if (j === undefined) return;
        if (j !== i) before[i].push(j);
        else if (b.d !== b.q) viaMaster[i] = 1;
      });
      for (const cg of g.cone)
        for (const n of cg.in) {
          const j = owner.get(n);
          if (j !== undefined && j !== i) reads[i].push(j);
        }
    });
    // the strongly connected sets (Tarjan) of more than one register: a cycle cannot be ordered
    const cycles = (nodes: number[], edges: (v: number) => number[]): number[][] => {
      const index = new Int32Array(list.length).fill(-1);
      const low = new Int32Array(list.length);
      const onStack = new Uint8Array(list.length);
      const stack: number[] = [];
      const out: number[][] = [];
      let next = 0;
      const strong = (v: number) => {
        index[v] = low[v] = next++;
        stack.push(v);
        onStack[v] = 1;
        for (const w of edges(v)) {
          if (index[w] < 0) {
            strong(w);
            low[v] = Math.min(low[v], low[w]);
          } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        }
        if (low[v] !== index[v]) return;
        const scc: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          scc.push(w);
        } while (w !== v);
        if (scc.length > 1) out.push(scc);
      };
      nodes.forEach((v) => index[v] < 0 && strong(v));
      return out;
    };
    for (const scc of cycles(all, (v) => before[v]))
      for (const x of scc) viaMaster[x] = 1;
    // the others commit in order, readers first; where a block's logic closes a cycle, that logic
    // runs early (a register in a cycle without block logic in it is in a cycle of D's: none left)
    const rest = all.filter((v) => !viaMaster[v]);
    const early = new Uint8Array(list.length);
    const edges = (v: number) =>
      [...before[v], ...(early[v] ? [] : reads[v])].filter((w) => !viaMaster[w]);
    for (const scc of cycles(rest, edges)) {
      const inside = new Set(scc);
      for (const x of scc) if (reads[x].some((w) => inside.has(w))) early[x] = 1;
    }
    const seen = new Uint8Array(list.length);
    const post: number[] = [];
    const visit = (v: number) => {
      if (seen[v]) return;
      seen[v] = 1;
      for (const w of edges(v)) visit(w);
      post.push(v);
    };
    rest.forEach(visit);
    const block = (
      i: number,
      f: (b: (typeof list)[number]["bits"][number]) => PlanAction,
      withCone: boolean,
    ): PlanAction => ({
      if: isOn(list[i].men),
      then: [
        ...(withCone ? list[i].cone.map(set) : []),
        ...list[i].bits.map(f),
      ],
    });
    const cyc = all.filter((i) => viaMaster[i]);
    return {
      early: all
        .filter((i) => early[i])
        .map((i) => ({ if: isOn(list[i].men), then: list[i].cone.map(set) })),
      writes: [
        ...cyc.map((i) =>
          block(i, (b) => ({ set: b.m, to: litExpr(b.d) }), true),
        ),
        ...post
          .reverse()
          .map((i) =>
            block(i, (b) => ({ set: b.q, to: litExpr(b.d) }), !early[i]),
          ),
        ...cyc
          .filter((i) => list[i].bits.some((b) => b.q !== b.m))
          .map((i) => block(i, (b) => ({ set: b.q, to: var_(b.m) }), false)),
      ],
    };
  };
  const litExpr = (n: number): Expr =>
    n === NET0 ? C0 : n === NET1 ? C1 : { var: n };

  const mode = opts.latch ?? "auto";
  let commit: Commit = mode === "auto" ? "gates" : mode;
  let emitted = emit(commit);
  if (mode === "auto" && staticSize(emitted.actions) > (opts.budget ?? 900)) {
    commit = "direct";
    emitted = emit(commit);
  }

  return {
    actions: emitted.actions,
    screenAt: emitted.screenAt,
    commitAt: emitted.commitAt,
    men: menOf,
    stats: {
      kept: kept.length,
      folded,
      aliased,
      merged,
      implied,
      groupsLive: live.size,
      groupsInert: inert.size,
      displayGates: displayKept.length,
      displayBlocks: blocks.size,
      latch: commit,
    },
  };
}

/** The register groups that have a slave latch (the rest are RAM words), once per netlist. */
const slavedOf = new WeakMap<FlatNetlist, Set<string>>();
function slaveGroups(net: FlatNetlist): Set<string> {
  let out = slavedOf.get(net);
  if (out) return out;
  out = new Set<string>();
  for (const g of net.gates) {
    const c = classify(g);
    if (c.c === "S") out.add(c.group);
  }
  slavedOf.set(net, out);
  return out;
}

/** Every register bit's master latch net → its slave (Q) net. Between events the two are equal, so
 * the master's lamps can be bound to Q; then a direct commit, which never writes the master, leaves
 * no stale lamp. */
export function masterToQ(net: FlatNetlist): Map<number, number> {
  const q = new Map<string, number>();
  for (const g of net.gates) {
    const m = /^(.*)\/s(\d+)_merge$/.exec(g.path);
    if (m) q.set(`${m[1]}/${m[2]}`, g.out);
  }
  const out = new Map<number, number>();
  for (const g of net.gates) {
    const m = /^(.*)\/m(\d+)_merge$/.exec(g.path);
    const to = m ? q.get(`${m[1]}/${m[2]}`) : undefined;
    if (to !== undefined) out.set(g.out, to);
  }
  return out;
}

// ---------- measuring ----------

/** Actions in a list including the branches' contents (the size of the reaction). */
export const staticSize = (a: PlanAction[]): number =>
  a.reduce(
    (n, x) =>
      n + ("set" in x ? 1 : 1 + staticSize(x.then) + staticSize(x.else ?? [])),
    0,
  );
/** Deepest conditional nesting (the editor can author 1). */
export const depth = (a: PlanAction[]): number =>
  a.reduce((d, x) => Math.max(d, "set" in x ? 0 : 1 + depth(x.then)), 0);
