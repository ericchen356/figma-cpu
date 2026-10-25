// Flow IR → the Plugin API objects Figma runs: SET_VARIABLE and CONDITIONAL actions whose values
// are VariableData expressions. Pure (no `figma` global), so tests replay the exact objects in
// silicon's strict emulator. The builders are silicon's (silicon/src/prototype/figma-actions.ts).
import {
  aliasData,
  boolData,
  conditional,
  exprData,
  floatData,
  setVariable,
  strData,
} from "../../silicon/src/prototype/figma-actions";
import {
  and,
  inline,
  not,
  ref,
  type Expr,
  type Fn,
  type Program,
  type Step,
  type Ty,
  type Val,
  type VarDecl,
} from "./ir";

/** Figma variable id per variable name. */
export type VarIds = Map<string, string>;

export interface CompileOptions {
  /** How a plain copy `a = b` is written. "expr" (default) wraps it in an expression that surely
   * reads b's current value (silicon's spike could not rule out that a bare alias links the two
   * variables instead of copying). "alias" writes the bare alias. Colors can only be copied by alias. */
  copy?: "expr" | "alias";
  /** "nested" (default) keeps the flow's `if` inside `if`, so the executed actions count exactly
   * as the interpreter counts them. "flat" moves every inner `if` to the top level (flatIfs):
   * Figma's setReactionsAsync rejects a CONDITIONAL inside another conditional's block. */
  ifs?: "nested" | "flat";
}

const RESOLVED: Record<Ty, VariableResolvedDataType> = {
  num: "FLOAT",
  bool: "BOOLEAN",
  str: "STRING",
  col: "COLOR",
};

const FN: Record<Fn, ExpressionFunction> = {
  add: "ADDITION",
  sub: "SUBTRACTION",
  mul: "MULTIPLICATION",
  div: "DIVISION",
  neg: "NEGATE",
  lt: "LESS_THAN",
  le: "LESS_THAN_OR_EQUAL",
  gt: "GREATER_THAN",
  ge: "GREATER_THAN_OR_EQUAL",
  eq: "EQUALS",
  ne: "NOT_EQUAL",
  and: "AND",
  or: "OR",
  not: "NOT",
};

/** The type of an expression; throws on a program Figma could not run. */
export function tyOf(e: Expr, types: ReadonlyMap<string, Ty>): Ty {
  switch (e.k) {
    case "num":
    case "bool":
    case "str":
    case "col":
      return e.k;
    case "var": {
      const ty = types.get(e.name);
      if (!ty) throw new Error(`undeclared variable ${e.name}`);
      return ty;
    }
    case "op": {
      const a = tyOf(e.a, types);
      const b = e.b ? tyOf(e.b, types) : undefined;
      const need = (ty: Ty, got: Ty | undefined) => {
        if (got !== ty) throw new Error(`${e.fn} needs ${ty}, got ${got}`);
      };
      switch (e.fn) {
        case "add":
          // number + number, or text + number (Figma writes the text first).
          if (a === "str" && b === "num") return "str";
          need("num", a);
          need("num", b);
          return "num";
        case "sub":
        case "mul":
        case "div":
          need("num", a);
          need("num", b);
          return "num";
        case "neg":
          need("num", a);
          return "num";
        case "lt":
        case "le":
        case "gt":
        case "ge":
          need("num", a);
          need("num", b);
          return "bool";
        case "eq":
        case "ne":
          if (a !== b || a === "col")
            throw new Error(`${e.fn} compares ${a} with ${b}`);
          return "bool";
        case "and":
        case "or":
          need("bool", a);
          need("bool", b);
          return "bool";
        case "not":
          need("bool", a);
          return "bool";
      }
    }
  }
}

export function typesOf(decls: readonly VarDecl[]): Map<string, Ty> {
  return new Map(decls.map((d) => [d.name, d.ty]));
}

/** An IR expression as Figma VariableData. */
export function exprToData(
  e: Expr,
  ids: VarIds,
  types: ReadonlyMap<string, Ty>,
): VariableData {
  switch (e.k) {
    case "num":
      return floatData(e.v);
    case "bool":
      return boolData(e.v);
    case "str":
      return strData(e.v);
    case "col":
      throw new Error("color literals are not used by the flow yet");
    case "var": {
      const id = ids.get(e.name);
      if (id === undefined) throw new Error(`no Figma variable for ${e.name}`);
      return aliasData(id, RESOLVED[tyOf(e, types)]);
    }
    case "op":
      return exprData(
        FN[e.fn],
        [
          exprToData(e.a, ids, types),
          ...(e.b ? [exprToData(e.b, ids, types)] : []),
        ],
        RESOLVED[tyOf(e, types)],
      );
  }
}

/** The value written by `set`. A plain copy is wrapped so it surely reads the source's current value. */
function setValue(
  to: Expr,
  ids: VarIds,
  types: ReadonlyMap<string, Ty>,
  opts: CompileOptions,
): VariableData {
  if (to.k === "var" && opts.copy !== "alias") {
    const ty = tyOf(to, types);
    const src = exprToData(to, ids, types);
    if (ty === "bool") return exprData("EQUALS", [src, boolData(true)]);
    if (ty === "num") return exprData("ADDITION", [src, floatData(0)], "FLOAT");
    if (ty === "str") return exprData("ADDITION", [strData(""), src], "STRING");
  }
  return exprToData(to, ids, types);
}

/** The variables an expression reads. */
function readsOf(e: Expr, into = new Set<string>()): Set<string> {
  if (e.k === "var") into.add(e.name);
  else if (e.k === "op") {
    readsOf(e.a, into);
    if (e.b) readsOf(e.b, into);
  }
  return into;
}

/** Every variable the steps write, in any branch. */
function writesOf(
  steps: readonly Step[],
  into = new Set<string>(),
): Set<string> {
  for (const s of inline(steps)) {
    if (s.k === "set") into.add(s.name);
    else if (s.k === "half") into.add(s.dst);
    else if (s.k === "if") {
      writesOf(s.then, into);
      if (s.else) writesOf(s.else, into);
    }
  }
  return into;
}

/** The boolean flatIfs keeps a condition in, for an `if` `depth` levels deep. */
export const flatTemp = (depth: number) => `flat/${depth}`;

/** The steps with no `if` inside an `if`. An inner `if` becomes top-level ifs on the conditions
 * around it ANDed together (an else branch takes the negation), and the sets between inner ifs
 * become top-level ifs on the outer condition. Each piece evaluates its condition again where it
 * lands, which is the same program while no piece writes what the condition reads; when one
 * can, the condition is first stored in a boolean (flatTemp) and the pieces read that. */
export function flatIfs(steps: readonly Step[]): Step[] {
  const out: Step[] = [];
  const emit = (list: readonly Step[], guard: Expr | null, depth: number) => {
    let run: Step[] = [];
    const flush = () => {
      if (run.length)
        out.push(
          ...(guard ? [{ k: "if", cond: guard, then: run } as Step] : run),
        );
      run = [];
    };
    for (const s of inline(list)) {
      if (s.k !== "if") {
        run.push(s);
        continue;
      }
      const nested = [...s.then, ...(s.else ?? [])].some((x) => x.k === "if");
      if (!guard && !nested) {
        flush();
        out.push(s); // one CONDITIONAL with an else, at the top: Figma judges it once
        continue;
      }
      flush();
      const reads = readsOf(s.cond);
      const written = writesOf([...s.then, ...(s.else ?? [])]);
      let cond = s.cond;
      if ([...reads].some((r) => written.has(r))) {
        const keep = flatTemp(depth + 1);
        out.push({
          k: "set",
          name: keep,
          to: guard ? and(guard, s.cond) : s.cond,
        });
        cond = ref(keep);
        emit(s.then, cond, depth + 1);
        if (s.else?.length)
          emit(s.else, guard ? and(guard, not(cond)) : not(cond), depth + 1);
        continue;
      }
      emit(s.then, guard ? and(guard, cond) : cond, depth + 1);
      if (s.else?.length)
        emit(s.else, guard ? and(guard, not(cond)) : not(cond), depth + 1);
    }
    flush();
  };
  emit(steps, null, 0);
  return out;
}

/** The booleans flatIfs writes for these steps, as declarations to create next to the program's
 * variables (false at the start; each is written before it is read in an event). */
export function flatTemps(...lists: (readonly Step[])[]): VarDecl[] {
  const names = new Set<string>();
  for (const list of lists)
    for (const s of flatIfs(list))
      if (s.k === "set" && s.name.startsWith("flat/")) names.add(s.name);
  return [...names]
    .sort()
    .map((name) => ({ name, ty: "bool", init: false, role: "temp" }));
}

/** Flow steps as Figma actions. Checks every set against its variable's declared type. */
export function compileSteps(
  steps: readonly Step[],
  ids: VarIds,
  types: ReadonlyMap<string, Ty>,
  opts: CompileOptions = {},
): Action[] {
  const conv = (list: readonly Step[]): Action[] =>
    inline(list).map((s) => {
      if (s.k === "half" || s.k === "unit")
        throw new Error(
          `${s.k} is a gate-level step; the word-level editor must not emit it`,
        );
      if (s.k === "set") {
        const want = types.get(s.name);
        const id = ids.get(s.name);
        if (!want || id === undefined)
          throw new Error(`set of undeclared variable ${s.name}`);
        const got = tyOf(s.to, types);
        if (got !== want) throw new Error(`set ${s.name}: ${got} into ${want}`);
        return setVariable(id, setValue(s.to, ids, types, opts));
      }
      if (tyOf(s.cond, types) !== "bool")
        throw new Error("condition is not a boolean");
      return conditional(
        exprToData(s.cond, ids, types),
        conv(s.then),
        s.else ? conv(s.else) : undefined,
      );
    });
  return conv(opts.ifs === "flat" ? flatIfs(steps) : steps);
}

// ---------- the size of a handler ----------

/** Most actions an event can execute: every `if` counts 1 plus its costlier branch. This is what
 * the viewer's per-event limit (about 500 to 2000 actions) is measured against. */
export function worstCase(input: readonly Step[]): number {
  const steps = inline(input);
  let n = 0;
  for (const s of steps)
    n +=
      s.k !== "if"
        ? 1
        : 1 + Math.max(worstCase(s.then), s.else ? worstCase(s.else) : 0);
  return n;
}

/** Every action stored in the reaction: both branches of every `if`. */
export function storedSize(input: readonly Step[]): number {
  const steps = inline(input);
  let n = 0;
  for (const s of steps)
    n +=
      s.k !== "if"
        ? 1
        : 1 + storedSize(s.then) + (s.else ? storedSize(s.else) : 0);
  return n;
}

/** Deepest expression nesting in the handler (an operator over variables and literals is 1). */
export function maxDepth(input: readonly Step[]): number {
  const steps = inline(input);
  const depth = (e: Expr): number =>
    e.k === "op" ? 1 + Math.max(depth(e.a), e.b ? depth(e.b) : 0) : 0;
  let d = 0;
  for (const s of steps)
    d = Math.max(
      d,
      s.k === "set"
        ? depth(s.to)
        : s.k === "half"
          ? depth(s.src)
          : s.k === "unit"
            ? maxDepth(s.steps)
            : Math.max(
                depth(s.cond),
                maxDepth(s.then),
                s.else ? maxDepth(s.else) : 0,
              ),
    );
  return d;
}

export interface EventStats {
  id: string;
  worst: number;
  stored: number;
  depth: number;
}

export interface ProgramStats {
  variables: number;
  events: number;
  /** Actions stored across all reactions. */
  stored: number;
  maxWorst: number;
  maxDepth: number;
  byEvent: EventStats[];
}

export function statsOf(p: Program): ProgramStats {
  const byEvent = p.events.map((e) => ({
    id: e.id,
    worst: worstCase(e.steps),
    stored: storedSize(e.steps),
    depth: maxDepth(e.steps),
  }));
  return {
    variables: p.vars.length,
    events: p.events.length,
    stored: byEvent.reduce((a, e) => a + e.stored, 0),
    maxWorst: Math.max(...byEvent.map((e) => e.worst)),
    maxDepth: Math.max(...byEvent.map((e) => e.depth)),
    byEvent,
  };
}

/** Initial values as Figma stores them (for creating the variables and for the emulator). */
export function initialValues(decls: readonly VarDecl[]): Map<string, Val> {
  return new Map(decls.map((d) => [d.name, d.init]));
}
