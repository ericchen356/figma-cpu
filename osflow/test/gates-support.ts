// Shared by the gates-* tests: a truncating reference interpreter of the flow (the semantics the
// synthesizer promises), a seeded generator of random programs that uses every construct, a
// lockstep driver that runs a gate machine and the reference side by side, and the shape every
// synthesized netlist must have.
import { expect } from "vitest";
import { flatten } from "../../silicon/src/netlist/flatten";
import { NET0, NET1 } from "../../silicon/src/netlist/types";
import type { Expr, Fn, Program, Step, Val, VarDecl } from "../src/ir";
import type { GateMachine, Synth } from "../src/gates";

/** What the lockstep driver needs of a machine: GateMachine, or ReactionMachine. */
export type Machine = Pick<GateMachine, "fire" | "read">;

// ---------- a small seeded generator ----------

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    range: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

// ---------- the reference ----------

const role = (d: VarDecl) => d.role ?? "state";

/** v truncated to a declared width, two's complement when signed. */
export function wrap(v: number, bits: number, signed: boolean): number {
  const m = 2 ** bits;
  let u = ((v % m) + m) % m;
  if (signed && u >= m / 2) u -= m;
  return u + 0;
}

/** A program's state and input variables at power-on. */
export interface RefState {
  vars: Map<string, Val>;
}

export function refInit(p: Program): RefState {
  const vars = new Map<string, Val>();
  for (const d of p.vars)
    if (role(d) === "state" || role(d) === "input") vars.set(d.name, d.init);
  return { vars };
}

/** Runs one event the way the gates do: every write truncates to the variable's width, temps
 * start at 0, view writes are dropped, const variables keep their value, inputs come from outside. */
export function refFire(
  p: Program,
  st: RefState,
  eventId: string,
  inputs: Record<string, number> = {},
): void {
  const ev = p.events.find((e) => e.id === eventId);
  if (!ev) throw new Error(`no event ${eventId}`);
  const decl = new Map(p.vars.map((d) => [d.name, d]));
  for (const [k, v] of Object.entries(inputs)) st.vars.set(k, v);
  const env = new Map<string, Val>();
  for (const d of p.vars) {
    const r = role(d);
    if (r === "state" || r === "input") env.set(d.name, st.vars.get(d.name)!);
    else if (r === "temp") env.set(d.name, d.ty === "bool" ? false : 0);
    else if (r === "const") env.set(d.name, d.init);
  }
  const value = (e: Expr): Val => {
    switch (e.k) {
      case "num":
      case "bool":
        return e.v;
      case "str":
      case "col":
        throw new Error("no strings in the reference");
      case "var": {
        const v = env.get(e.name);
        if (v === undefined) throw new Error(`reference: read of ${e.name}`);
        return v;
      }
      case "op": {
        const a = value(e.a);
        const b = e.b ? value(e.b) : undefined;
        const n = (x: Val | undefined) => x as number;
        switch (e.fn) {
          case "add":
            return n(a) + n(b);
          case "sub":
            return n(a) - n(b);
          case "mul":
            return n(a) * n(b);
          case "div":
            return n(a) / n(b);
          case "neg":
            return 0 - n(a);
          case "lt":
            return n(a) < n(b);
          case "le":
            return n(a) <= n(b);
          case "gt":
            return n(a) > n(b);
          case "ge":
            return n(a) >= n(b);
          case "eq":
            return a === b;
          case "ne":
            return a !== b;
          case "and":
            return (a as boolean) && (b as boolean);
          case "or":
            return (a as boolean) || (b as boolean);
          case "not":
            return !a;
        }
      }
    }
  };
  const store = (name: string, v: Val) => {
    const d = decl.get(name)!;
    const r = role(d);
    if (r === "view" || r === "const") return;
    if (r === "input") throw new Error(`reference: write of input ${name}`);
    env.set(name, typeof v === "number" ? wrap(v, d.bits!, !!d.signed) : v);
  };
  const run = (steps: readonly Step[]): void => {
    for (const s of steps) {
      if (s.k === "set") {
        if (role(decl.get(s.name)!) === "view") continue;
        store(s.name, value(s.to));
      } else if (s.k === "half")
        store(s.dst, Math.floor((value(s.src) as number) / 2));
      else if (s.k === "unit") run(s.steps);
      else if (value(s.cond)) run(s.then);
      else if (s.else) run(s.else);
    }
  };
  run(ev.steps);
  for (const d of p.vars)
    if (role(d) === "state") st.vars.set(d.name, env.get(d.name)!);
}

// ---------- lockstep ----------

/** Fires `events` at the machine and the reference; every state variable must agree after each. */
export function lockstep(
  p: Program,
  syn: Synth,
  m: Machine,
  events: [string, Record<string, number>][],
  label = "",
): void {
  const st = refInit(p);
  const states = p.vars.filter((d) => role(d) === "state");
  const check = (when: string) => {
    for (const d of states) {
      const got = m.read(d.name);
      const want = st.vars.get(d.name);
      if (got !== want)
        expect.fail(
          `${label} ${when}: ${d.name} is ${String(got)} in gates, ${String(want)} in the reference`,
        );
    }
  };
  check("at power-on");
  events.forEach(([id, inputs], i) => {
    m.fire(id, inputs);
    refFire(p, st, id, inputs);
    check(`after event ${i} (${id} ${JSON.stringify(inputs)})`);
  });
  expect(syn.codes.size).toBe(p.events.length);
  // Events share an EVT code exactly when their steps are the same, in the same order.
  for (const e of p.events)
    for (const f of p.events)
      if (
        (syn.codes.get(e.id) === syn.codes.get(f.id)) !==
        (JSON.stringify(e.steps) === JSON.stringify(f.steps))
      )
        expect.fail(
          `${label}: ${e.id} and ${f.id} have codes ${syn.codes.get(e.id)} and ${syn.codes.get(f.id)}`,
        );
}

// ---------- the shape of a netlist ----------

const PORT = /^[A-Za-z_][\w]*$/;

/** What every synthesized OS must look like, whatever it computes: it flattens (silicon rejects
 * multiple drivers and undriven reads), no gate has a constant input, no two generated gates are
 * the same gate on the same inputs, ports are legal names, and the statistics add up. */
export function checkShape(syn: Synth, label: string): void {
  const net = flatten(syn.lib, syn.top);
  const top = syn.lib.get(syn.top)!;
  const regInsts = new Set(
    top.instances.filter((i) => i.cell.startsWith("REG_W")).map((i) => i.name),
  );
  const seen = new Map<string, string>();
  for (const g of net.gates) {
    for (const id of g.in)
      if (id === NET0 || id === NET1)
        expect.fail(`${label}: ${g.path} has a constant input`);
    if (regInsts.has(g.path.split("/")[0])) continue; // silicon's DFFE: one ¬CLK per bit, by design
    const key = `${g.type}(${[...g.in].sort((a, b) => a - b).join(",")})`;
    const dup = seen.get(key);
    if (dup) expect.fail(`${label}: ${g.path} and ${dup} are the same gate`);
    seen.set(key, g.path);
  }
  for (const inst of top.instances) {
    const m = syn.lib.get(inst.cell)!;
    for (const p of m.ports)
      expect(p.name, `${label}: ${inst.cell}.${p.name}`).toMatch(PORT);
  }
  for (const p of top.ports) expect(p.name).toMatch(PORT);
  expect(Object.values(syn.stats.byModule).reduce((a, b) => a + b, 0)).toBe(
    net.gates.length,
  );
  expect(syn.stats.gates).toBe(net.gates.length);
  const regBits = [...syn.regs.values()]
    .filter((r) => !r.nets.every((n) => n === "0" || n === "1"))
    .reduce((a, r) => a + r.bits, 0);
  expect(syn.stats.registers).toBe(regBits);
}

/** Random inputs for every input variable of the program. */
export function randomInputs(r: Rng, p: Program): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of p.vars)
    if (role(d) === "input") {
      const bits = d.bits!;
      out[d.name] = d.signed
        ? r.range(-(2 ** (bits - 1)), 2 ** (bits - 1) - 1)
        : r.range(0, 2 ** bits - 1);
    }
  return out;
}

/** Random events, each setting a random part of the inputs: the others keep their values (their
 * init until a fire first sets them). */
export function randomEvents(
  r: Rng,
  p: Program,
  n: number,
): [string, Record<string, number>][] {
  return Array.from({ length: n }, () => [
    r.pick(p.events).id,
    Object.fromEntries(
      Object.entries(randomInputs(r, p)).filter(() => r.chance(0.75)),
    ),
  ]);
}

// ---------- random programs ----------

const op = (fn: Fn, a: Expr, b?: Expr): Expr =>
  b ? { k: "op", fn, a, b } : { k: "op", fn, a };
const lit = (v: number): Expr => ({ k: "num", v });

/** A random program: 2–5 state variables (bools and numbers of 1–12 bits, signed or not), temps,
 * one or two inputs, maybe a const and a view, and 3–6 events of nested if / set / half / unit
 * over every operator. Some events repeat an earlier handler: as it is (they must share its EVT
 * code), or with its steps in another order (they must not). */
export function randomProgram(r: Rng): Program {
  const vars: VarDecl[] = [];
  const numVar = (
    name: string,
    roleName: VarDecl["role"],
    maxBits = 12,
  ): VarDecl => {
    const bits = r.range(1, maxBits);
    const signed = r.chance(0.5);
    const init = signed
      ? r.range(-(2 ** (bits - 1)), 2 ** (bits - 1) - 1)
      : r.range(0, 2 ** bits - 1);
    return { name, ty: "num", init, role: roleName, bits, signed };
  };
  const nState = r.range(2, 5);
  for (let i = 0; i < nState; i++)
    vars.push(
      r.chance(0.25)
        ? { name: `s${i}`, ty: "bool", init: r.chance(0.5), role: "state" }
        : numVar(`s${i}`, "state"),
    );
  for (let i = r.int(3); i > 0; i--)
    vars.push(
      r.chance(0.3)
        ? { name: `t${i}`, ty: "bool", init: false, role: "temp" }
        : { ...numVar(`t${i}`, "temp"), init: 0 },
    );
  for (let i = r.range(1, 2); i > 0; i--)
    vars.push(numVar(`in${i}`, "input", 8));
  if (r.chance(0.5))
    vars.push(
      r.chance(0.3)
        ? { name: "k", ty: "bool", init: r.chance(0.5), role: "const" }
        : numVar("k", "const"),
    );
  if (r.chance(0.5))
    vars.push({
      name: "v",
      ty: r.chance(0.5) ? "bool" : "num",
      init: 0,
      role: "view",
    });
  for (const d of vars)
    if (d.ty === "bool" && d.role === "view") d.init = false;

  const nums = vars.filter((d) => d.ty === "num" && d.role !== "view");
  const bools = vars.filter((d) => d.ty === "bool" && d.role !== "view");
  const writableNum = nums.filter(
    (d) => d.role === "state" || d.role === "temp",
  );
  const writableBool = bools.filter(
    (d) => d.role === "state" || d.role === "temp",
  );
  const bound = (d: VarDecl) => 2 ** (d.bits ?? 1);

  // Expressions carry a bound on |value| so products stay well inside the synthesizer's 48 bits.
  const numExpr = (depth: number): { e: Expr; b: number } => {
    if (depth >= 3 || r.chance(0.3)) {
      if (r.chance(0.35)) {
        const v = r.chance(0.8) ? r.range(-9, 9) : r.range(-3000, 3000);
        return { e: lit(v), b: Math.abs(v) };
      }
      const d = r.pick(nums);
      return { e: { k: "var", name: d.name }, b: bound(d) };
    }
    const roll = r.next();
    const x = numExpr(depth + 1);
    if (roll < 0.1) return { e: op("neg", x.e), b: x.b };
    if (roll < 0.14) return { e: op("div", x.e, lit(1)), b: x.b };
    const y = numExpr(depth + 1);
    if (roll < 0.3 && x.b * y.b <= 2 ** 36)
      return { e: op("mul", x.e, y.e), b: x.b * y.b };
    return { e: op(roll < 0.65 ? "add" : "sub", x.e, y.e), b: x.b + y.b };
  };
  const boolExpr = (depth: number): Expr => {
    if (depth >= 3 || r.chance(0.2)) {
      if (bools.length && r.chance(0.6))
        return { k: "var", name: r.pick(bools).name };
      if (r.chance(0.3)) return { k: "bool", v: r.chance(0.5) };
    }
    const roll = r.next();
    if (roll < 0.5)
      return op(
        r.pick(["lt", "le", "gt", "ge", "eq", "ne"] as const),
        numExpr(depth + 1).e,
        numExpr(depth + 1).e,
      );
    if (roll < 0.6)
      return op(
        r.pick(["eq", "ne"] as const),
        boolExpr(depth + 1),
        boolExpr(depth + 1),
      );
    if (roll < 0.7) return op("not", boolExpr(depth + 1));
    return op(
      r.pick(["and", "or"] as const),
      boolExpr(depth + 1),
      boolExpr(depth + 1),
    );
  };

  const views = vars.filter((d) => d.role === "view");
  const consts = vars.filter((d) => d.role === "const");
  const units = ["alpha", "beta", "gamma"];
  const steps = (depth: number, count: number): Step[] => {
    const out: Step[] = [];
    for (let i = 0; i < count; i++) {
      const roll = r.next();
      if (roll < 0.12 && depth < 3) {
        out.push({
          k: "if",
          cond: boolExpr(1),
          then: steps(depth + 1, r.range(1, 3)),
          ...(r.chance(0.6) ? { else: steps(depth + 1, r.range(1, 3)) } : {}),
        });
      } else if (roll < 0.2 && depth < 3) {
        out.push({
          k: "unit",
          name: r.pick(units),
          steps: steps(depth + 1, r.range(1, 3)),
        });
      } else if (roll < 0.28 && writableNum.length) {
        out.push({
          k: "half",
          dst: r.pick(writableNum).name,
          src: numExpr(1).e,
        });
      } else if (roll < 0.32 && views.length) {
        // Ignored by the gates, whatever it computes (even a string).
        out.push({
          k: "set",
          name: views[0].name,
          to: r.chance(0.5) ? { k: "str", v: "x" } : numExpr(1).e,
        });
      } else if (roll < 0.35 && consts.length) {
        out.push({
          k: "set",
          name: consts[0].name,
          to:
            consts[0].ty === "bool"
              ? { k: "bool", v: consts[0].init as boolean }
              : lit(consts[0].init as number),
        });
      } else if (writableBool.length && (roll < 0.5 || !writableNum.length)) {
        out.push({
          k: "set",
          name: r.pick(writableBool).name,
          to: boolExpr(1),
        });
      } else {
        out.push({
          k: "set",
          name: r.pick(writableNum).name,
          to: numExpr(1).e,
        });
      }
    }
    return out;
  };

  const events: Program["events"] = [];
  for (let i = r.range(3, 6); i > 0; i--) {
    const id = `e${events.length}`;
    const same = events.length && r.chance(0.2) ? r.pick(events) : undefined;
    let body = same
      ? (JSON.parse(JSON.stringify(same.steps)) as Step[])
      : steps(0, r.range(1, 5));
    // Half the repeats run the same steps in another order: their own code, unless the order
    // turns out the same.
    if (same && r.chance(0.5)) body = [...body.slice(1), body[0]];
    events.push({ id, node: id, trigger: { type: "click" }, steps: body });
  }
  return { vars, events };
}
