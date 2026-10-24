// Runs flow steps on a variable map. This is the reference behaviour of the flow: tests compare
// it with the os-ui reducer (lockstep) and with the compiled Figma actions (compile.test.ts).
// The action count follows Figma's cost model, as in silicon's emulator: a `set` is 1, an `if`
// is 1 plus the steps of the branch it took.
import {
  applyFn,
  type Expr,
  type Program,
  type Step,
  type Val,
  type VarDecl,
} from "./ir";

export type Vars = Map<string, Val>;

export function initialVars(decls: readonly VarDecl[]): Vars {
  const m: Vars = new Map();
  for (const d of decls) {
    if (m.has(d.name)) throw new Error(`variable ${d.name} declared twice`);
    m.set(d.name, d.init);
  }
  return m;
}

export function evalExpr(e: Expr, vars: Vars): Val {
  switch (e.k) {
    case "num":
    case "bool":
    case "str":
    case "col":
      return e.v;
    case "var": {
      const v = vars.get(e.name);
      if (v === undefined)
        throw new Error(`read of undeclared variable ${e.name}`);
      return v;
    }
    case "op":
      return applyFn(e.fn, evalExpr(e.a, vars), e.b && evalExpr(e.b, vars));
  }
}

/** Runs `steps` in place on `vars`; returns the number of actions executed. */
export function run(steps: readonly Step[], vars: Vars): number {
  let n = 0;
  for (const s of steps) {
    n++;
    if (s.k === "set") {
      const old = vars.get(s.name);
      if (old === undefined)
        throw new Error(`set of undeclared variable ${s.name}`);
      const v = evalExpr(s.to, vars);
      if (typeof v !== typeof old)
        throw new Error(`set ${s.name}: ${typeof v} into ${typeof old}`);
      vars.set(s.name, v);
    } else {
      const c = evalExpr(s.cond, vars);
      if (typeof c !== "boolean") throw new Error(`condition is not a boolean`);
      if (c) n += run(s.then, vars);
      else if (s.else) n += run(s.else, vars);
    }
  }
  return n;
}

/** A program with its variables: fire events at it and read the variables. */
export class Machine {
  readonly vars: Vars;
  private readonly byId = new Map<string, Step[]>();

  constructor(readonly program: Program) {
    this.vars = initialVars(program.vars);
    for (const e of program.events) {
      if (this.byId.has(e.id)) throw new Error(`event ${e.id} defined twice`);
      this.byId.set(e.id, e.steps);
    }
  }

  /** Fires the event with this id. Returns the actions it executed. */
  fire(id: string): number {
    const steps = this.byId.get(id);
    if (!steps) throw new Error(`no event ${id}`);
    return run(steps, this.vars);
  }
}
