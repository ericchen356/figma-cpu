// The synthesizer (docs/GATES.md §2): a flow program in, a silicon Library of 2-input gates out,
// with top module "OS" that runs one editor event per clock tick.
//
//   events ──codes──▶ EVT ──EVDEC──▶ one-hot event lines
//   handlers ──symbolic execution──▶ word DAG ──writes──▶ per register: LOAD, D ──bits──▶ gates
//
// A register's LOAD is the OR over events of (event line AND the condition under which that
// event writes it), so an event that leaves it alone does not load it; D is the AND-OR of the
// values the events write (one-hot lines need no priority). A register no event can move from its
// initial value is a constant, not a register: that is proved by a greatest fixpoint (assume
// every register constant, drop the ones some event writes with another value, repeat).
import { buildCells, defineReg } from "../../../silicon/src/cells";
import { flatten } from "../../../silicon/src/netlist/flatten";
import { portBits, type Library } from "../../../silicon/src/netlist/types";
import type { FlowEvent, Program, Step } from "../ir";
import { Aig, extend, F, T, type Lit } from "./aig";
import { Blaster } from "./blast";
import { bitLength, bitsOfValue, Dag } from "./dag";
import {
  execute,
  merged,
  varSpecs,
  writes,
  type VarSpec,
  type Write,
} from "./exec";
import {
  assemble,
  emitGates,
  Namer,
  sanitize,
  type BlockSpec,
  type RegisterSpec,
} from "./netlist";

export interface SynthOptions {
  /** Prove which registers never leave their initial value and build them as constants
   * (default true). Off, only registers that no event writes at all become constants. */
  constantRegisters?: boolean;
}

export interface Synth {
  /** silicon's buildCells() plus the generated modules. */
  lib: Library;
  /** "OS". */
  top: string;
  /** Event id → EVT code ≥ 1; events with identical handlers share a code; 0 does nothing. */
  codes: Map<string, number>;
  evtBits: number;
  /** State variable → top-level register output nets, LSB first ("0"/"1" for a constant one).
   * `init` is 0/1 for a bool, which `bool` marks. */
  regs: Map<string, RegInfo>;
  /** Input variable → its OS input port. */
  inputs: Map<string, { port: string; bits: number; signed: boolean }>;
  /** For silicon's powerOn(): both latches of every register bit, and the input ports, at their initial values. */
  pokes: Record<string, number>;
  stats: { gates: number; registers: number; byModule: Record<string, number> };
}

export interface RegInfo {
  nets: string[];
  bits: number;
  signed: boolean;
  init: number;
  bool: boolean;
}

const TOP = "OS";
const GLUE = 0;
const EVDEC = 1;

/** Canonical JSON (sorted keys), so two handlers with the same steps compare equal. */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

interface Group {
  code: number;
  ids: string[];
  steps: Step[];
}

/** EVT codes: events whose steps are identical share one, numbered from 1 in program order. */
function eventCodes(events: readonly FlowEvent[]): {
  codes: Map<string, number>;
  groups: Group[];
} {
  const codes = new Map<string, number>();
  const byKey = new Map<string, Group>();
  const groups: Group[] = [];
  for (const e of events) {
    if (codes.has(e.id)) throw new Error(`event ${e.id} defined twice`);
    const key = canonical(e.steps);
    let g = byKey.get(key);
    if (!g) {
      g = { code: groups.length + 1, ids: [], steps: e.steps };
      byKey.set(key, g);
      groups.push(g);
    }
    g.ids.push(e.id);
    codes.set(e.id, g.code);
  }
  return { codes, groups };
}

interface Run {
  dag: Dag;
  units: Map<string, number>;
  start: Map<string, number>;
  finals: Map<string, number>[];
  merges: Set<string>;
}

/** Every handler run symbolically, with the registers in `constant` fixed at their init. */
function run(
  vars: Map<string, VarSpec>,
  groups: readonly Group[],
  constant: ReadonlySet<string>,
): Run {
  const dag = new Dag();
  const units = new Map<string, number>();
  const unit = (name: string) => {
    let k = units.get(name);
    if (k === undefined) units.set(name, (k = 2 + units.size));
    return k;
  };
  const start = new Map<string, number>();
  for (const v of vars.values()) {
    if (v.role === "state")
      start.set(
        v.name,
        constant.has(v.name)
          ? constNode(dag, v)
          : dag.state(v.name, v.bool, v.bits, v.signed),
      );
    else if (v.role === "temp")
      start.set(v.name, v.bool ? dag.FALSE : dag.num(0));
  }
  dag.owner = GLUE;
  const merges = new Set<string>();
  const finals = groups.map((g) =>
    execute(g.steps, { dag, vars, start, unit, merges }),
  );
  return { dag, units, start, finals, merges };
}

const constNode = (dag: Dag, v: VarSpec) =>
  v.bool ? dag.bool(v.init === 1) : dag.num(v.init);

/** Compiles a flow program into gates. See docs/GATES.md §2 for the contract. */
export function synthesize(program: Program, opts: SynthOptions = {}): Synth {
  const vars = varSpecs(program.vars);
  const { codes, groups } = eventCodes(program.events);
  const evtBits = Math.max(1, bitLength(groups.length));
  const stateVars = [...vars.values()].filter((v) => v.role === "state");
  const inputVars = [...vars.values()].filter((v) => v.role === "input");

  // Registers proved constant: `fixed` by the greatest fixpoint at word level (no event gives
  // them another value while all the constants hold), and `unloaded`, which only the bits show
  // never change (LOAD folds to 0, or each D bit to the register's own output or, whenever LOAD
  // is on, to its initial value). Each unloaded proof assumed the fixed set of its time, so it
  // is dropped (and made again) whenever that set shrinks; while it holds, the word-level test
  // does not apply to them (it cannot see the bit level, and would put them back forever). fixed
  // shrinks at most once per register, and between two shrinks unloaded grows at most once per
  // register: that bounds the loop.
  const fixed = new Set(
    opts.constantRegisters === false ? [] : stateVars.map((v) => v.name),
  );
  const unloaded = new Set<string>();
  const constant = (name: string) => fixed.has(name) || unloaded.has(name);
  for (let round = 0; ; round++) {
    if (round > (stateVars.length + 1) ** 2)
      throw new Error(
        "internal: the constant-register proof does not converge",
      );
    const r = run(vars, groups, new Set([...fixed, ...unloaded]));
    const moved = [...fixed].filter((name) =>
      r.finals.some((f) => f.get(name) !== r.start.get(name)),
    );
    if (moved.length) {
      for (const name of moved) fixed.delete(name);
      unloaded.clear();
      continue;
    }
    const built = build(r);
    if (typeof built === "string") {
      unloaded.add(built);
      continue;
    }
    return built;
  }

  /** Gates for one symbolic run, or the name of a register that turned out never to change. */
  function build({ dag, units, start, finals, merges }: Run): Synth | string {
    const regVars = stateVars.filter((v) => !constant(v.name));

    // Per register: LOAD, and each value written with the selects (event lines, or an event
    // line AND the case's condition when one event writes different values) that pick it.
    dag.owner = EVDEC;
    const lines = groups.map((g) => dag.ev(g.code));
    dag.owner = GLUE;
    // Events that share a write condition, or a written value, share one OR of their lines.
    const anyOf = (ls: number[]) => dag.orAll([...ls].sort((a, b) => a - b));
    const grouped = (pairs: [number, number][]) => {
      const m = new Map<number, number[]>();
      for (const [key, x] of pairs) {
        const list = m.get(key);
        if (list) list.push(x);
        else m.set(key, [x]);
      }
      return [...m];
    };
    const plans: {
      v: VarSpec;
      load: number;
      values: { data: number; selects: number[]; select: number }[];
    }[] = [];
    for (const v of regVars) {
      const self = start.get(v.name)!;
      const memo = new Map<number, Write[]>();
      const isMerge = (n: number) => merges.has(`${n}:${v.name}`);
      // Each event writes one value, its own multiplexer over the cases (shared when the
      // multiplexer is: across slots, say); a case whose value another event writes whole is
      // split off instead, with its condition in the select, so the two share one D term.
      const events: { gi: number; next: number; ws: Write[]; whole: number }[] =
        [];
      groups.forEach((_, gi) => {
        const next = finals[gi].get(v.name)!;
        if (dag.isPoison(next))
          throw new Error(
            `state ${v.name} depends on the view variable ${dag.nodes[next].name}`,
          );
        const ws = writes(dag, next, self, isMerge, memo);
        if (!ws.length) return;
        const whole =
          ws.length === 1
            ? ws[0].data
            : merged(dag, next, (x) => x === self, isMerge)!;
        events.push({ gi, next, ws, whole });
      });
      if (!events.length) return v.name;
      const wholes = new Set(events.map((e) => e.whole));
      const loads: [number, number][] = [];
      const values: [number, number][] = [];
      for (const { gi, next, ws, whole } of events) {
        const line = lines[gi];
        loads.push([dag.orAll(ws.map((w) => w.cond)), line]);
        const apart =
          ws.length > 1
            ? ws.filter((w) => w.data !== whole && wholes.has(w.data))
            : [];
        if (!apart.length) {
          values.push([whole, line]);
          continue;
        }
        for (const w of apart) values.push([w.data, dag.and(line, w.cond)]);
        const rest = ws.filter((w) => !apart.includes(w));
        if (rest.length === 1)
          values.push([rest[0].data, dag.and(line, rest[0].cond)]);
        else if (rest.length > 1) {
          const out = new Set(apart.map((w) => w.data));
          const mux = merged(
            dag,
            next,
            (x) => x === self || out.has(x),
            isMerge,
          )!;
          values.push([mux, dag.and(line, dag.orAll(rest.map((w) => w.cond)))]);
        }
      }
      const load = dag.orAll(
        grouped(loads).map(([c, ls]) => dag.and(anyOf(ls), c)),
      );
      plans.push({
        v,
        load,
        values: grouped(values).map(([data, selects]) => ({
          data,
          selects,
          select: anyOf(selects),
        })),
      });
    }

    // Bus names: a word node's operation and id, a variable's name, an event line's first event.
    const labels: string[] = [];
    const originOfNode = new Map<number, number>();
    const named = new Map<number, string>();
    groups.forEach((g, gi) => named.set(lines[gi], `ev_${g.ids[0]}`));
    for (const p of plans)
      if (!named.has(p.load) && dag.nodes[p.load].owner === GLUE)
        named.set(p.load, `load_${p.v.name}`);
    const label = (s: string) => labels.push(s) - 1;
    const originOf = (n: number) => {
      let o = originOfNode.get(n);
      if (o === undefined) {
        const N = dag.nodes[n];
        o = label(
          named.get(n) ??
            (N.op === "state" || N.op === "input"
              ? N.name
              : `${OP_NAME[N.op] ?? N.op}_${n}`),
        );
        originOfNode.set(n, o);
      }
      return o;
    };

    // Bits of every word node a register needs, in creation order (first creator owns a gate).
    const live = new Uint8Array(dag.nodes.length);
    const parents = new Int32Array(dag.nodes.length);
    const muxValue = new Uint8Array(dag.nodes.length);
    const stack: number[] = [];
    for (const p of plans) {
      stack.push(p.load);
      for (const s of p.values)
        stack.push(
          s.data,
          ...(p.values.length > 1 ? [s.select, ...s.selects] : []),
        );
    }
    for (const n of stack) parents[n]++;
    while (stack.length) {
      const n = stack.pop()!;
      if (live[n]) continue;
      live[n] = 1;
      const N = dag.nodes[n];
      for (const a of N.args) parents[a]++;
      if (N.op === "ite") muxValue[N.args[1]] = muxValue[N.args[2]] = 1;
      stack.push(...N.args);
    }
    const aig = new Aig();
    const blaster = new Blaster(
      dag,
      aig,
      evtBits,
      originOf,
      (n) => parents[n],
      (n) => dag.nodes[n].op === "ite" && parents[n] === 1 && !!muxValue[n],
    );
    for (let n = 0; n < dag.nodes.length; n++) if (live[n]) blaster.bits(n);

    // Register inputs. D bit i is an OR of terms: each select of a value that has a constant 1
    // there, and select·bit for the other values. Every OR is a chain with the terms most D bits
    // share first, so registers written by the same events (the slots) share the chain's start.
    aig.ctxOwner = GLUE;
    const sums = plans.map((p) => {
      aig.ctxOrigin = label(`d_${p.v.name}`);
      const vec = (n: number) =>
        extend(blaster.bits(n), dag.nodes[n].signed, p.v.bits);
      if (p.values.length === 1) return vec(p.values[0].data).map((l) => [l]);
      const terms = p.values.map((s) => ({
        selects: s.selects.map((l) => blaster.bits(l)[0]),
        select: blaster.bits(s.select)[0],
        bits: vec(s.data),
      }));
      return Array.from({ length: p.v.bits }, (_, i) =>
        terms.flatMap((t) =>
          t.bits[i] === F
            ? []
            : t.bits[i] === T
              ? t.selects
              : [aig.and(t.select, t.bits[i])],
        ),
      );
    });
    const uses = new Map<Lit, number>();
    for (const bits of sums)
      for (const ts of bits)
        for (const t of ts) uses.set(t, (uses.get(t) ?? 0) + 1);
    const chains = plans.map((p, k) => {
      aig.ctxOrigin = label(`d_${p.v.name}`);
      return sums[k].map((ts) =>
        [...ts]
          .sort((a, b) => uses.get(b)! - uses.get(a)! || a - b)
          .reduce((acc, t) => aig.or(acc, t), F),
      );
    });
    // Built after every chain, so that no chain reuses an AND made only to test a register.
    const roots: Lit[] = [];
    const regLits: { v: VarSpec; load: Lit; d: Lit[] }[] = [];
    for (const [k, p] of plans.entries()) {
      const load = blaster.bits(p.load)[0];
      const sum = chains[k];
      // Never loads, or no load moves a bit from its initial value: the bits found the register
      // constant where the words could not. A bit stays when its D is its own output or, with
      // the proof on, its initial value whenever LOAD is on.
      const q = blaster.bits(start.get(p.v.name)!);
      const init = bitsOfValue(p.v.init, p.v.bits);
      const stays = (l: Lit, i: number) =>
        l === q[i] ||
        (opts.constantRegisters !== false &&
          aig.and(load, init[i] ? l ^ 1 : l) === F);
      if (load === F || sum.every(stays)) return p.v.name;
      // A constant D bit is LOAD itself (1) or ¬LOAD (0): only its value under LOAD matters, and
      // no gate gets a constant input.
      const d = sum.map((l) => (l === T ? load : l === F ? load ^ 1 : l));
      regLits.push({ v: p.v, load, d });
      roots.push(load, ...d);
    }

    // Names for the top level and the blocks.
    const topNames = new Namer(["CLK", "EVT"]);
    const inputs = new Map(
      inputVars.map((v) => [
        v.name,
        {
          port: topNames.unique(sanitize(v.name)),
          bits: v.bits,
          signed: v.signed,
        },
      ]),
    );
    const blockNames = new Namer(["GLUE", "EVDEC", TOP]);
    const blockInsts = new Namer(["glue", "evdec"]);
    const blocks: BlockSpec[] = [
      { name: "GLUE", inst: "glue" },
      { name: "EVDEC", inst: "evdec" },
    ];
    for (const name of units.keys()) {
      const base = sanitize(name);
      blocks.push({
        name: blockNames.unique(`U_${base}`),
        inst: blockInsts.unique(`u_${base}`),
      });
    }

    const external = (key: string) => {
      const [kind, bit, name] = key.split(":");
      return { bus: kind === "e" ? "EVT" : name, index: Number(bit) };
    };
    const emitted = emitGates(aig, roots, (o) => labels[o], external, GLUE);

    const lib: Library = new Map();
    buildCells(lib);
    const regNets = new Namer();
    const regInsts = new Namer();
    let k = 0;
    const registers: RegisterSpec[] = regLits.map(({ v }) => {
      const base = sanitize(v.name);
      const load = emitted.rootSignals[k++];
      const d = emitted.rootSignals.slice(k, (k += v.bits));
      if (!lib.has(`REG_W${v.bits}`)) defineReg(lib, v.bits);
      return {
        name: v.name,
        inst: regInsts.unique(`r_${base}`),
        net: regNets.unique(base),
        bits: v.bits,
        load,
        d,
      };
    });
    const qNets = assemble(lib, blocks, emitted, registers, {
      name: TOP,
      evtBits,
      inputs: inputVars.map((v) => ({
        name: v.name,
        port: inputs.get(v.name)!.port,
        bits: v.bits,
      })),
    });

    // Power-on values: the register's output (slave latch) and its master latch, and the inputs.
    const pokes: Record<string, number> = {};
    for (const r of registers) {
      const v = vars.get(r.name)!;
      bitsOfValue(v.init, v.bits).forEach((bit, i) => {
        pokes[qNets.get(r.name)![i]] = bit;
        pokes[`${r.inst}/b${i}/m`] = bit;
      });
    }
    for (const v of inputVars) {
      const bits = portBits({ name: inputs.get(v.name)!.port, width: v.bits });
      bitsOfValue(v.init, v.bits).forEach((bit, i) => (pokes[bits[i]] = bit));
    }

    const regs = new Map<string, RegInfo>();
    for (const v of stateVars)
      regs.set(v.name, {
        nets:
          qNets.get(v.name) ??
          bitsOfValue(v.init, v.bits).map((b) => (b ? "1" : "0")),
        bits: v.bits,
        signed: v.signed,
        init: v.init,
        bool: v.bool,
      });

    const flat = flatten(lib, TOP);
    const cellOf = new Map(
      lib.get(TOP)!.instances.map((i) => [i.name, i.cell]),
    );
    const byModule: Record<string, number> = {};
    for (const g of flat.gates) {
      const cell = cellOf.get(g.path.split("/")[0])!;
      byModule[cell] = (byModule[cell] ?? 0) + 1;
    }
    return {
      lib,
      top: TOP,
      codes,
      evtBits,
      regs,
      inputs,
      pokes,
      stats: {
        gates: flat.gates.length,
        registers: registers.reduce((a, r) => a + r.bits, 0),
        byModule,
      },
    };
  }
}

/** Short operation names for bus labels. */
const OP_NAME: Partial<Record<string, string>> = {
  isneg: "lt",
  ite: "mux",
  shr1: "half",
};
