// Symbolic execution: one event handler run on the DAG instead of on values. Variables hold
// nodes; `set` and `half` replace a variable's node; an `if` whose condition is not constant runs
// both branches and merges every variable they leave different with a multiplexer (`ite`). What
// comes out is, per state variable, the node of its value after the event as a function of the
// registers and inputs before it. A `unit` only changes which module owns the nodes made inside it.
import type { Expr, Role, Step, VarDecl } from "../ir";
import type { Dag } from "./dag";
import { typeRange } from "./dag";

/** A variable as the gates see it. */
export interface VarSpec {
  name: string;
  role: Role;
  bool: boolean;
  /** Bit width and two's complement flag of a number (1 and false for a boolean). */
  bits: number;
  signed: boolean;
  /** Initial value, a boolean as 0 or 1. */
  init: number;
}

/** Reads the declarations the way the synthesizer needs them; throws on what gates cannot hold. */
export function varSpecs(decls: readonly VarDecl[]): Map<string, VarSpec> {
  const out = new Map<string, VarSpec>();
  for (const d of decls) {
    if (out.has(d.name)) throw new Error(`variable ${d.name} declared twice`);
    const role = d.role ?? "state";
    if (role === "view") {
      out.set(d.name, {
        name: d.name,
        role,
        bool: d.ty === "bool",
        bits: d.bits ?? 1,
        signed: !!d.signed,
        init: 0,
      });
      continue;
    }
    if (d.ty === "str" || d.ty === "col")
      throw new Error(
        `${d.name}: gates have no ${d.ty === "str" ? "strings" : "colors"} (role ${role})`,
      );
    if (d.ty === "bool") {
      if (typeof d.init !== "boolean")
        throw new Error(`${d.name}: a bool needs a boolean init`);
      out.set(d.name, {
        name: d.name,
        role,
        bool: true,
        bits: 1,
        signed: false,
        init: d.init ? 1 : 0,
      });
      continue;
    }
    if (d.bits === undefined)
      throw new Error(`${d.name}: a ${role} number needs a bit width`);
    if (!Number.isInteger(d.bits) || d.bits < 1 || d.bits > 32)
      throw new Error(`${d.name}: bit width ${d.bits} is not 1..32`);
    const signed = !!d.signed;
    if (typeof d.init !== "number" || !Number.isInteger(d.init))
      throw new Error(
        `${d.name}: init ${String(d.init)} is not a whole number`,
      );
    const [lo, hi] = typeRange(d.bits, signed);
    if (d.init < lo || d.init > hi)
      throw new Error(
        `${d.name}: init ${d.init} does not fit ${d.bits} ${signed ? "signed" : "unsigned"} bits`,
      );
    out.set(d.name, {
      name: d.name,
      role,
      bool: false,
      bits: d.bits,
      signed,
      init: d.init,
    });
  }
  return out;
}

/** Variable bindings of one branch: writes are kept here, reads fall through to the parent. */
class Env {
  readonly own = new Map<string, number>();
  constructor(readonly parent?: Env) {}
  get(name: string): number {
    for (let e: Env | undefined = this; e; e = e.parent) {
      const v = e.own.get(name);
      if (v !== undefined) return v;
    }
    throw new Error(`no binding for ${name}`);
  }
}

export interface ExecContext {
  dag: Dag;
  vars: ReadonlyMap<string, VarSpec>;
  /** The node a state or temp variable holds when the event starts. */
  start: ReadonlyMap<string, number>;
  /** Module index of a unit label. */
  unit: (name: string) => number;
  /** Filled in: every multiplexer an `if` made for a variable, as `${node}:${variable}`.
   * writes() and merged() follow only these, so they take apart how a variable is written,
   * never a value written into it. */
  merges: Set<string>;
}

/** Runs one handler symbolically. Returns the node of every state and temp variable afterwards. */
export function execute(
  steps: readonly Step[],
  cx: ExecContext,
): Map<string, number> {
  const { dag, vars } = cx;
  const root = new Env();
  for (const [k, v] of cx.start) root.own.set(k, v);

  const spec = (name: string) => {
    const v = vars.get(name);
    if (!v) throw new Error(`undeclared variable ${name}`);
    return v;
  };

  const read = (name: string, env: Env): number => {
    const v = spec(name);
    switch (v.role) {
      case "state":
      case "temp":
        return env.get(name);
      case "const":
        return v.bool ? dag.bool(v.init === 1) : dag.num(v.init);
      case "input":
        return dag.input(name, v.bool, v.bits, v.signed);
      case "view":
        return dag.view(name, v.bool);
    }
  };

  const expr = (e: Expr, env: Env): number => {
    switch (e.k) {
      case "num":
        return dag.num(e.v);
      case "bool":
        return dag.bool(e.v);
      case "str":
      case "col":
        throw new Error(
          `${JSON.stringify(e.v)}: gates have no ${e.k === "str" ? "strings" : "colors"}`,
        );
      case "var":
        return read(e.name, env);
      case "op": {
        const a = expr(e.a, env);
        if (e.fn === "not") return dag.not(a);
        if (e.fn === "neg") return dag.neg(a);
        if (!e.b) throw new Error(`${e.fn} needs two operands`);
        const b = expr(e.b, env);
        switch (e.fn) {
          case "add":
            return dag.add(a, b);
          case "sub":
            return dag.sub(a, b);
          case "mul":
            return dag.mul(a, b);
          case "div":
            return dag.div(a, b);
          case "lt":
            return dag.lt(a, b);
          case "le":
            return dag.le(a, b);
          case "gt":
            return dag.gt(a, b);
          case "ge":
            return dag.ge(a, b);
          case "eq":
            return dag.eq(a, b);
          case "ne":
            return dag.ne(a, b);
          case "and":
            return dag.and(a, b);
          case "or":
            return dag.or(a, b);
        }
      }
    }
  };

  const write = (name: string, value: () => number, env: Env): void => {
    const v = spec(name);
    switch (v.role) {
      case "view":
        return; // the display decode computes view variables; their writes are not synthesized
      case "input":
        throw new Error(`${name} is an input: a handler cannot write it`);
      case "const": {
        const n = value();
        if (dag.constant(n) !== v.init || dag.nodes[n].bool !== v.bool)
          throw new Error(
            `${name} is a const (${v.init}); a write must give that same value`,
          );
        return;
      }
      default: {
        const n = value();
        if (dag.isPoison(n)) {
          env.own.set(name, n);
          return;
        }
        if (dag.nodes[n].bool !== v.bool)
          throw new Error(
            `set ${name}: ${v.bool ? "a number into a boolean" : "a boolean into a number"}`,
          );
        env.own.set(name, v.bool ? n : dag.wrap(n, v.bits, v.signed));
      }
    }
  };

  const exec = (list: readonly Step[], env: Env): void => {
    for (const s of list) {
      switch (s.k) {
        case "set":
          write(s.name, () => expr(s.to, env), env);
          break;
        case "half":
          if (spec(s.dst).bool)
            throw new Error(`half into ${s.dst}, which is a boolean`);
          write(s.dst, () => dag.shr1(expr(s.src, env)), env);
          break;
        case "unit": {
          const saved = dag.owner;
          dag.owner = cx.unit(s.name);
          exec(s.steps, env);
          dag.owner = saved;
          break;
        }
        case "if": {
          const c = expr(s.cond, env);
          if (dag.isPoison(c))
            throw new Error(
              `a condition reads the view variable ${dag.nodes[c].name}`,
            );
          if (!dag.nodes[c].bool)
            throw new Error("a condition is not a boolean");
          const cc = dag.constant(c);
          if (cc !== undefined) {
            exec(cc ? s.then : (s.else ?? []), env);
            break;
          }
          const yes = new Env(env);
          exec(s.then, yes);
          const no = new Env(env);
          if (s.else) exec(s.else, no);
          for (const k of new Set([...yes.own.keys(), ...no.own.keys()])) {
            const a = yes.get(k);
            const b = no.get(k);
            const m =
              a === b ? a : dag.ite(c, a, b, vars.get(k)?.role === "state");
            if (dag.nodes[m].op === "ite") cx.merges.add(`${m}:${k}`);
            env.own.set(k, m);
          }
          break;
        }
      }
    }
  };

  exec(steps, root);
  const out = new Map<string, number>();
  for (const k of cx.start.keys()) out.set(k, root.get(k));
  return out;
}

/** The value an event writes to a register wherever it writes one of the values not `absent`:
 * its own multiplexers kept, the branches that end in an absent value (the register itself, or a
 * value written separately) dropped. undefined if every branch ends in one.
 *
 * A run of ifs is a chain of multiplexers as long as the run, so this walks it with a stack of
 * its own, not the JS stack: the `then` side first, then the `else` side, then the multiplexer,
 * the order a recursive walk would make the new nodes in. */
export function merged(
  dag: Dag,
  next: number,
  absent: (value: number) => boolean,
  isMerge: (node: number) => boolean,
  memo = new Map<number, number | undefined>(),
): number | undefined {
  const stack = [next];
  while (stack.length) {
    const n = stack[stack.length - 1];
    if (memo.has(n)) {
      stack.pop();
      continue;
    }
    const N = dag.nodes[n];
    if (N.op !== "ite" || !isMerge(n)) {
      memo.set(n, absent(n) ? undefined : n);
      stack.pop();
      continue;
    }
    const [c, a, b] = N.args;
    if (!memo.has(a)) stack.push(a);
    else if (!memo.has(b)) stack.push(b);
    else {
      stack.pop();
      const x = memo.get(a);
      const y = memo.get(b);
      memo.set(n, x === undefined ? y : y === undefined ? x : dag.ite(c, x, y));
    }
  }
  return memo.get(next);
}

/** One way an event writes a register: the value, and the condition under which it is written. */
export interface Write {
  cond: number;
  data: number;
}

/** The writes an event makes to a register, read off its next value: exclusive conditions, each
 * with a different value; none if the event leaves the register alone. Only the multiplexers the
 * variable's own `if`s left (`merges`, see ExecContext) are taken apart; a value written into it
 * is kept whole, even when it happens to contain the register (a read multiplexer over every
 * slot does), so it stays shared with the other slots.
 *
 * Like merged(), it walks a chain of multiplexers with a stack of its own, in the order a
 * recursive walk would: the `then` side's writes, each under c, then ¬c, then the `else` side's. */
export function writes(
  dag: Dag,
  next: number,
  self: number,
  isMerge: (node: number) => boolean,
  memo = new Map<number, Write[]>(),
): Write[] {
  /** The writes of a node already known (the register itself, a value, a merge seen before). */
  const known = (n: number): Write[] | undefined => {
    if (n === self) return [];
    const hit = memo.get(n);
    if (hit) return hit;
    if (dag.nodes[n].op === "ite" && isMerge(n)) return undefined;
    const out = [{ cond: dag.TRUE, data: n }];
    memo.set(n, out);
    return out;
  };
  const first = known(next);
  if (first) return first;
  /** A merge being taken apart: `done` of its two sides are in (`then` first), each case under
   * its side's condition; `nc` is ¬c, made once the `then` side is in. */
  interface Open {
    n: number;
    done: number;
    nc: number;
    byData: Map<number, number>;
  }
  const open = (n: number): Open => ({ n, done: 0, nc: -1, byData: new Map() });
  const stack = [open(next)];
  while (stack.length) {
    const f = stack[stack.length - 1];
    if (f.done === 2) {
      stack.pop();
      memo.set(
        f.n,
        [...f.byData].map(([data, cond]) => ({ cond, data })),
      );
      continue;
    }
    const [c, a, b] = dag.nodes[f.n].args;
    const side = f.done === 0 ? a : b;
    const ws = known(side);
    if (!ws) {
      stack.push(open(side));
      continue;
    }
    const cond = f.done === 0 ? c : f.nc;
    for (const w of ws) {
      const prev = f.byData.get(w.data);
      const both = dag.and(cond, w.cond);
      f.byData.set(w.data, prev === undefined ? both : dag.or(prev, both));
    }
    if (f.done === 0) f.nc = dag.not(c);
    f.done++;
  }
  return memo.get(next)!;
}
