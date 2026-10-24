// The control unit: a sum-of-products PLA synthesized from the microcode table
// (OPCODES / FETCH in src/isa/spec.ts). Nothing below is written per signal or per opcode;
// edit the table and the hardware regenerates.
//
//   OP[4] → dec_op (CTRL_DEC4) → op_NOP … op_HLT   one-hot opcode lines
//   T[3]  → dec_t  (CTRL_DEC3) → T0 … T7           one-hot T-state lines
//   op_JZifZ      = op_JZ · Z                       flag-qualified line (conditional steps)
//   ops_<group>   = OR of opcode lines              e.g. ops_ADDtoNOT = the ALU instructions
//   term_<group>_T<t> = T<t> · ops_<group>          AND plane: one gate per (T-state, group)
//   or_<SIGNAL>   = OR of the signal's terms        OR plane
//   out_<SIGNAL>  = run · or_<SIGNAL>               run = NOR(HALTED, RESET): all off when halted
//
// Sharing: FETCH (T0–T2) is the same for every opcode, so its term is the bare T line.
// Signals active in the same T-state for the same group share one term (REG_OUT_D and A_LOAD
// are both term_ADDtoNOT_T3). Groups are built smallest first and later groups reuse earlier
// ones (ops_LDI_ADDtoNOT = op_LDI + ops_ADDtoNOT), with runs of consecutive opcodes kept as
// their own subtrees so they can be reused too (ops_JMPtoJN).
import { define, type ModuleBuilder } from "../hdl/builder";
import { type Flag, microcode, OPCODES, type OpcodeSpec, type Signal, SIGNALS, signalsAt } from "../isa/spec";
import { CONST0, CONST1, type GateType, type Library } from "../netlist/types";

const FLAGS: Flag[] = ["Z", "C", "N"];
const OP_BITS = 4;
const T_BITS = 3;
const ALU_SEL_BITS = 3;
const N_OPS = 1 << OP_BITS;
const N_T = 1 << T_BITS;

/** Output ports of CONTROL besides the 1-bit SIGNALS. */
export type ControlOutput = Signal | "ALU_SEL" | "ALU_SUB";

/** What CONTROL must output, straight from the spec: every port by name (`ALU_SEL` as its
 * 3-bit value, the rest 0/1). All zero while halted or in reset. */
export function controlTruth(
  op: number,
  t: number,
  flags: Record<Flag, boolean>,
  halted: boolean,
  reset: boolean,
): Record<ControlOutput, number> {
  const run = !halted && !reset;
  const on = signalsAt(op, t, flags);
  const out = {} as Record<ControlOutput, number>;
  for (const s of SIGNALS) out[s] = run && on.has(s) ? 1 : 0;
  const alu = OPCODES[op & (N_OPS - 1)].alu;
  out.ALU_SEL = run && alu ? alu.sel : 0;
  out.ALU_SUB = run && alu?.sub ? 1 : 0;
  return out;
}

// ---------- literals: the inputs of the AND plane besides the T lines ----------

/** An opcode line, or an opcode line ANDed with a flag (for `when` steps). Encoded as
 * code·4 + (0 | 1 + flag index) so that sorted literal sets are in opcode order. */
type Lit = number;
const lit = (code: number, flag?: Flag): Lit => code * 4 + (flag ? FLAGS.indexOf(flag) + 1 : 0);
const litCode = (l: Lit) => l >> 2;
const litFlag = (l: Lit): Flag | undefined => FLAGS[(l & 3) - 1];
const setKey = (lits: Lit[]) => lits.join(",");
/** The set of every opcode, unconditionally (FETCH): its OR is constant 1. */
const isAll = (lits: Lit[]) => lits.length === N_OPS && lits.every((l) => !litFlag(l));

/** Opcodes indexed by code; the decoder needs exactly codes 0–15. */
function opcodeTable(): OpcodeSpec[] {
  const ops = [...OPCODES].sort((a, b) => a.code - b.code);
  if (ops.length !== N_OPS || ops.some((o, i) => o.code !== i))
    throw new Error(`CONTROL: OPCODES must define each code 0–${N_OPS - 1} exactly once`);
  for (const o of ops) if (!/^[A-Za-z]\w*$/.test(o.mnem)) throw new Error(`CONTROL: bad mnemonic ${o.mnem}`);
  return ops;
}

/** Readable name of a literal set (used for net and layer names): three or more consecutive
 * opcodes collapse to "ADDtoNOT", flag-qualified literals read "JZifZ". */
function label(ops: OpcodeSpec[], lits: Lit[]): string {
  const name = (l: Lit) => ops[litCode(l)].mnem + (litFlag(l) ? `if${litFlag(l)}` : "");
  const parts: string[] = [];
  for (let i = 0; i < lits.length; ) {
    let j = i;
    if (!litFlag(lits[i]))
      while (j + 1 < lits.length && !litFlag(lits[j + 1]) && litCode(lits[j + 1]) === litCode(lits[j]) + 1) j++;
    if (j - i >= 2) parts.push(`${name(lits[i])}to${name(lits[j])}`);
    else for (let k = i; k <= j; k++) parts.push(name(lits[k]));
    i = j + 1;
  }
  return parts.join("_");
}

/** For every signal and T-state, the sorted literals that assert it (from the microcode).
 * A flag-qualified literal is dropped when the same opcode asserts the signal anyway. */
function signalTable(): Map<Signal, Lit[][]> {
  const on = new Map<Signal, Set<Lit>[]>(SIGNALS.map((s) => [s, Array.from({ length: N_T }, () => new Set<Lit>())]));
  for (const op of OPCODES)
    for (const step of microcode(op)) {
      if (step.t < 0 || step.t >= N_T) throw new Error(`CONTROL: ${op.mnem} uses T${step.t}; the T counter has ${N_T} states`);
      for (const s of step.signals) on.get(s)![step.t].add(lit(op.code));
      if (step.when) for (const s of step.when.signals) on.get(s)![step.t].add(lit(op.code, step.when.flag));
    }
  const table = new Map<Signal, Lit[][]>();
  for (const [s, perT] of on)
    table.set(
      s,
      perT.map((set) => [...set].filter((l) => !litFlag(l) || !set.has(lit(litCode(l)))).sort((a, b) => a - b)),
    );
  return table;
}

/** Opcode groups: OR trees of literals, cached by set so later groups (and the ALU_SEL bits)
 * reuse earlier ones. Every gate is named after the net it drives. */
class OpcodeGroups {
  private groups = new Map<string, { lits: Lit[]; net: string }>();
  private flagged = new Map<Lit, string>();

  constructor(
    private b: ModuleBuilder,
    private ops: OpcodeSpec[],
    private opLine: string[],
  ) {}

  /** The net of one literal: an opcode line, or op_<MNEM>if<FLAG> = line · flag. */
  private literal(l: Lit): string {
    const flag = litFlag(l);
    if (!flag) return this.opLine[litCode(l)];
    let net = this.flagged.get(l);
    if (!net) {
      net = gate(this.b, "AND", [this.opLine[litCode(l)], this.b.in1(flag)], `op_${label(this.ops, [l])}`);
      this.flagged.set(l, net);
    }
    return net;
  }

  private netOf(lits: Lit[]): string {
    return lits.length === 1 ? this.literal(lits[0]) : this.groups.get(setKey(lits))!.net;
  }

  /** OR of two disjoint built sets (one gate, unless that union already exists). */
  private union(x: Lit[], y: Lit[]): Lit[] {
    const lits = [...x, ...y].sort((a, b) => a - b);
    const key = setKey(lits);
    if (!this.groups.has(key))
      this.groups.set(key, { lits, net: gate(this.b, "OR", [this.netOf(x), this.netOf(y)], `ops_${label(this.ops, lits)}`) });
    return lits;
  }

  private balanced(sets: Lit[][]): Lit[] {
    let level = sets;
    while (level.length > 1) {
      const next: Lit[][] = [];
      for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? this.union(level[i], level[i + 1]) : level[i]);
      level = next;
    }
    return level[0];
  }

  /** The net that is 1 iff any literal of the (sorted) set is: "0" if empty, "1" for all opcodes. */
  net(lits: Lit[]): string {
    if (lits.length === 0) return CONST0;
    if (isAll(lits)) return CONST1;
    if (lits.length === 1 || this.groups.has(setKey(lits))) return this.netOf(lits);
    // Greedy cover: take the largest existing group that fits, repeat; the rest are single lines.
    const rest = new Set(lits);
    const pieces: Lit[][] = [];
    for (;;) {
      let best: Lit[] | undefined;
      for (const g of this.groups.values())
        if (g.lits.length > (best?.length ?? 1) && g.lits.every((l) => rest.has(l))) best = g.lits;
      if (!best) break;
      pieces.push(best);
      for (const l of best) rest.delete(l);
    }
    for (const l of rest) pieces.push([l]);
    pieces.sort((x, y) => x[0] - y[0]);
    // Runs of consecutive opcodes become subtrees first, so each run is a group of its own.
    const runs: Lit[][][] = [];
    for (const p of pieces) {
      const run = runs[runs.length - 1];
      const prev = run?.[run.length - 1];
      if (prev && litCode(p[0]) === litCode(prev[prev.length - 1]) + 1) run.push(p);
      else runs.push([p]);
    }
    return this.netOf(this.balanced(runs.map((r) => this.balanced(r))));
  }
}

/** Places a gate whose instance is named after the (fresh) net it drives. */
function gate(b: ModuleBuilder, type: GateType, inputs: string[], name: string): string {
  const y = b.wire1(name);
  return b.gate(type, inputs, y, y);
}

/** Balanced OR tree named `name` (inner gates `name_1`, `name_2`, …). "0" for no nets. */
function orTree(b: ModuleBuilder, nets: string[], name: string): string {
  if (nets.length === 0) return CONST0;
  let level = nets;
  let k = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(i + 1 < level.length ? gate(b, "OR", [level[i], level[i + 1]], level.length === 2 ? name : `${name}_${++k}`) : level[i]);
    level = next;
  }
  return level[0];
}

/** Defines CTRL_DEC2, CTRL_DEC3, CTRL_DEC4 and CONTROL. */
export function buildControl(lib: Library): void {
  define(
    lib,
    "CTRL_DEC2",
    { in: { A: 2 }, out: { Y: 4 } },
    (b) => {
      const a = b.in("A");
      const na = a.map((x, i) => gate(b, "NOT", [x], `nA${i}`));
      b.out("Y").forEach((y, k) => b.gate("AND", [k & 2 ? a[1] : na[1], k & 1 ? a[0] : na[0]], y, `y${k}`));
    },
    "2→4 one-hot predecoder: Y[k] = 1 iff A = k. 2 NOT + 4 AND.",
  );

  define(
    lib,
    "CTRL_DEC3",
    { in: { A: 3 }, out: { Y: 8 } },
    (b) => {
      const a = b.in("A");
      const lo = b.use("CTRL_DEC2", { A: a.slice(0, 2), Y: b.wire("lo", 4) }, "lo").Y;
      const na2 = gate(b, "NOT", [a[2]], "nA2");
      b.out("Y").forEach((y, k) => b.gate("AND", [lo[k & 3], k & 4 ? a[2] : na2], y, `y${k}`));
    },
    "3→8 one-hot decoder (the T-state lines): a CTRL_DEC2 on A[1:0], then Y[k] = lo[k mod 4] · (A[2] or ¬A[2]).",
  );

  define(
    lib,
    "CTRL_DEC4",
    { in: { A: 4 }, out: { Y: 16 } },
    (b) => {
      const a = b.in("A");
      const lo = b.use("CTRL_DEC2", { A: a.slice(0, 2), Y: b.wire("lo", 4) }, "lo").Y;
      const hi = b.use("CTRL_DEC2", { A: a.slice(2, 4), Y: b.wire("hi", 4) }, "hi").Y;
      b.out("Y").forEach((y, k) => b.gate("AND", [lo[k & 3], hi[k >> 2]], y, `y${k}`));
    },
    "4→16 one-hot decoder (the opcode lines): CTRL_DEC2 predecoders on A[1:0] and A[3:2], then Y[k] = lo[k mod 4] · hi[k div 4].",
  );

  const ops = opcodeTable();
  const table = signalTable();
  const aluSets: { port: string; bit: number; lits: Lit[] }[] = [
    ...Array.from({ length: ALU_SEL_BITS }, (_, bit) => ({
      port: "ALU_SEL",
      bit,
      lits: ops.filter((o) => o.alu && (o.alu.sel >> bit) & 1).map((o) => lit(o.code)),
    })),
    { port: "ALU_SUB", bit: 0, lits: ops.filter((o) => o.alu?.sub).map((o) => lit(o.code)) },
  ];
  for (const o of ops)
    if (o.alu && (o.alu.sel < 0 || o.alu.sel >= 1 << ALU_SEL_BITS)) throw new Error(`CONTROL: ${o.mnem} ALU sel out of range`);

  define(
    lib,
    "CONTROL",
    {
      in: { OP: OP_BITS, T: T_BITS, Z: 1, C: 1, N: 1, HALTED: 1, RESET: 1 },
      out: { ...Object.fromEntries(SIGNALS.map((s) => [s, 1])), ALU_SEL: ALU_SEL_BITS, ALU_SUB: 1 },
    },
    (b) => {
      // Decoders: one line per opcode and per T-state.
      const opLine = ops.map((o) => b.wire1(`op_${o.mnem}`));
      const tLine = Array.from({ length: N_T }, (_, t) => b.wire1(`T${t}`));
      b.use("CTRL_DEC4", { A: b.in("OP"), Y: opLine }, "dec_op");
      b.use("CTRL_DEC3", { A: b.in("T"), Y: tLine }, "dec_t");
      const run = gate(b, "NOR", [b.in1("HALTED"), b.in1("RESET")], "run");

      // Opcode groups, smallest first so larger groups can build on them; ALU fields last.
      const groups = new OpcodeGroups(b, ops, opLine);
      const sets = new Map<string, Lit[]>();
      for (let t = 0; t < N_T; t++) for (const s of SIGNALS) sets.set(setKey(table.get(s)![t]), table.get(s)![t]);
      for (const lits of [...sets.values()].sort((x, y) => x.length - y.length)) groups.net(lits);
      const aluNets = aluSets.map((a) => groups.net(a.lits));

      // AND plane: one product term per distinct (T-state, group); FETCH terms are bare T lines.
      const terms = new Map<string, string>();
      const term = (t: number, lits: Lit[]): string => {
        if (isAll(lits)) return tLine[t];
        const key = `${t}|${setKey(lits)}`;
        let net = terms.get(key);
        if (!net) {
          net = gate(b, "AND", [tLine[t], groups.net(lits)], `term_${label(ops, lits)}_T${t}`);
          terms.set(key, net);
        }
        return net;
      };
      const signalTerms = new Map<Signal, string[]>();
      for (const s of SIGNALS) signalTerms.set(s, []);
      for (let t = 0; t < N_T; t++)
        for (const s of SIGNALS) {
          const lits = table.get(s)![t];
          if (lits.length) signalTerms.get(s)!.push(term(t, lits));
        }

      // OR plane (signals with identical terms share one tree), then the run gate per output.
      const sums = new Map<string, string>();
      for (const s of SIGNALS) {
        const nets = signalTerms.get(s)!;
        const key = nets.join(",");
        if (!sums.has(key)) sums.set(key, orTree(b, nets, `or_${s}`));
        b.gate("AND", [run, sums.get(key)!], b.out1(s), `out_${s}`);
      }
      aluSets.forEach((a, i) => {
        const port = b.out(a.port);
        b.gate("AND", [run, aluNets[i]], port[a.bit], `out_${a.port}${port.length > 1 ? a.bit : ""}`);
      });
    },
    "Control unit: a sum-of-products PLA generated from the microcode table. dec_op / dec_t decode " +
      "the opcode and T-state into one-hot lines; each term_<ops>_T<t> ANDs a T line with an OR of " +
      "opcode lines (ops_<ops>, op_JZifZ = JZ · Z); each control signal is the OR of its terms " +
      "(or_<SIGNAL>), and out_<SIGNAL> gates it with run = NOR(HALTED, RESET). ALU_SEL / ALU_SUB " +
      "are opcode groups from each instruction's ALU field.",
  );
}
