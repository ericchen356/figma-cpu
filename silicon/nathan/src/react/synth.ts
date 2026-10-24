// Reaction synthesis: what ONE Figma trigger contains for ONE editor event.
//
// The machine is the same gates for every event, but a given event uses a small part of them.
// For an event (EVT tied to its code, ARG tied if the button fixes it, optionally the tool / drag
// mode tied because the clicked layer only exists in that mode) this:
//   1. folds the constants through the netlist (a tied line makes whole units constant);
//   2. turns identity gates (AND x 1, OR x 0, BUF …) into wires;
//   3. keeps only what can change a register this event, plus the screen lines that depend on a
//      register that loads;
//   4. emits ONE evaluation pass, then the commit:
//        LOW    CLK = 0, the logic in dependency order, each loading register's master latch
//        HIGH   CLK = 1, each loading register's slave latch
//        SCREEN the screen decode, each block behind `if (a register it reads loaded)`
// Every conditional is one level deep (`if (enable) { gates }`), which is what the editor itself
// can author. Every register group sits behind its own enable, so an idle register costs one
// action, or nothing when the event cannot load it.
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

/** M master latch gate, S slave latch gate, C register enable gate, D screen decode, X plain logic. */
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
  groupsLive: number;
  groupsInert: number;
  /** Screen gates evaluated (when their registers load). */
  displayGates: number;
  displayBlocks: number;
  /** The latches were committed in compact form. */
  compact: boolean;
}

export interface Reaction {
  actions: PlanAction[];
  /** Index in `actions` where the screen refresh starts (everything after it only updates lamps). */
  screenAt: number;
  stats: SynthStats;
  /** Net ids of the `men` enables of the live register groups, by group path. */
  men: Map<string, number>;
}

/** Ties: a top-level input port name, or any net name, to a constant. */
export type Tie = Record<string, number>;

export interface SynthOptions {
  /** Turn identity gates into wires (default true). Off: every gate keeps its own action, and
   * every lamp on the drawn circuit follows (about 30% more actions). */
  alias?: boolean;
  /** How a loading register is committed. "gates": every latch gate is evaluated (6 per bit, all
   * lamps follow). "compact": inside `if (enable)` a latch is exactly `m = D` and `Q = m`, 2 per
   * bit; the take / hold gates of the latch keep their last lamp. "auto" (default): gates, unless
   * the reaction would exceed `budget` actions, then compact. */
  latch?: "gates" | "compact" | "auto";
  /** Largest reaction (actions, counting every branch) before "auto" compacts the latches. Default 900. */
  budget?: number;
}

export function synthesize(
  net: FlatNetlist,
  tie: Tie,
  opts: SynthOptions = {},
): Reaction {
  const nNets = net.netNames.length;
  const clk = net.aliases.get("CLK")!;

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
    for (const g of net.gates) {
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
  for (const g of net.gates) {
    const c = classify(g);
    if (c.c === "C" && g.path.endsWith("/men"))
      (Kv[g.out] === 0 ? inert : live).add(c.group);
  }

  // 2. fold constant gates away, substitute literals
  let gates: FlatGate[] = [];
  let folded = 0;
  for (const g of net.gates) {
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
  if (opts.alias !== false) {
    const dead = new Uint8Array(gates.length);
    for (let changed = true; changed;) {
      changed = false;
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
  const groupOfQ = new Map<number, string>(); // net id of a slave output -> its group
  gates.forEach((g, i) => {
    if (info[i].c === "S" && g.path.endsWith("_merge"))
      groupOfQ.set(g.out, info[i].group);
  });
  // the slave outputs of groups that were dropped as inert are not in `gates`; recover them from the full netlist
  for (const g of net.gates) {
    const c = classify(g);
    if (c.c === "S" && g.path.endsWith("_merge") && !groupOfQ.has(g.out))
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
  const var_ = (n: number): Expr => ({ var: n });
  // a condition is always an expression, EQUALS(var, true), the shape verified in the real viewer
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
    compact: boolean,
  ): { actions: PlanAction[]; screenAt: number } => {
    const nclk: PlanAction[] = nclkGate >= 0 ? [set(gates[nclkGate])] : [];
    const low: PlanAction[] = [
      { set: clk, to: C0 },
      ...nclk,
      ...order
        .filter(
          (gi) =>
            !(
              compact &&
              info[gi].c === "C" &&
              gates[gi].path.endsWith("/nmen")
            ),
        )
        .map((gi) => set(gates[gi])),
    ];
    const high: PlanAction[] = [{ set: clk, to: C1 }, ...nclk];
    for (const [grp, e] of groups) {
      const men = menOf.get(grp)!;
      if (!compact) {
        low.push({ if: isOn(men), then: e.m.map((gi) => set(gates[gi])) });
        high.push({ if: isOn(men), then: e.s.map((gi) => set(gates[gi])) });
        continue;
      }
      // with the enable on: master m = D (take = D·1, hold = m·0), slave Q = m (take = m·1, hold = Q·0)
      const bits = [...e.bits.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, b]) => b);
      low.push({
        if: isOn(men),
        // a take gate folded away means D is the constant 0
        then: bits.map((b): PlanAction => ({
          set: gates[b.mmerge].out,
          to: b.take >= 0 ? litExpr(gates[b.take].in[0]) : C0,
        })),
      });
      high.push({
        if: isOn(men),
        then: bits.map((b): PlanAction => ({
          set: gates[b.smerge].out,
          to: var_(gates[b.mmerge].out),
        })),
      });
    }
    return {
      actions: [...low, ...high, ...screen],
      screenAt: low.length + high.length,
    };
  };
  const litExpr = (n: number): Expr =>
    n === NET0 ? C0 : n === NET1 ? C1 : { var: n };

  const mode = opts.latch ?? "auto";
  let compact = mode === "compact";
  let emitted = emit(compact);
  if (mode === "auto" && staticSize(emitted.actions) > (opts.budget ?? 900)) {
    compact = true;
    emitted = emit(true);
  }

  return {
    actions: emitted.actions,
    screenAt: emitted.screenAt,
    men: menOf,
    stats: {
      kept: kept.length,
      folded,
      aliased,
      groupsLive: live.size,
      groupsInert: inert.size,
      displayGates: displayKept.length,
      displayBlocks: blocks.size,
      compact,
    },
  };
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
