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
import type { Expr, Fn, Program, Step, Ty, Val, VarDecl } from "./ir";

/** Figma variable id per variable name. */
export type VarIds = Map<string, string>;

export interface CompileOptions {
  /** How a plain copy `a = b` is written. "expr" (default) wraps it in an expression that surely
   * reads b's current value (silicon's spike could not rule out that a bare alias links the two
   * variables instead of copying). "alias" writes the bare alias. Colors can only be copied by alias. */
  copy?: "expr" | "alias";
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

/** Flow steps as Figma actions. Checks every set against its variable's declared type. */
export function compileSteps(
  steps: readonly Step[],
  ids: VarIds,
  types: ReadonlyMap<string, Ty>,
  opts: CompileOptions = {},
): Action[] {
  const conv = (list: readonly Step[]): Action[] =>
    list.map((s) => {
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
  return conv(steps);
}

// ---------- the size of a handler ----------

/** Most actions an event can execute: every `if` counts 1 plus its costlier branch. This is what
 * the viewer's per-event limit (about 500 to 2000 actions) is measured against. */
export function worstCase(steps: readonly Step[]): number {
  let n = 0;
  for (const s of steps)
    n +=
      s.k === "set"
        ? 1
        : 1 + Math.max(worstCase(s.then), s.else ? worstCase(s.else) : 0);
  return n;
}

/** Every action stored in the reaction: both branches of every `if`. */
export function storedSize(steps: readonly Step[]): number {
  let n = 0;
  for (const s of steps)
    n +=
      s.k === "set"
        ? 1
        : 1 + storedSize(s.then) + (s.else ? storedSize(s.else) : 0);
  return n;
}

/** Deepest expression nesting in the handler (an operator over variables and literals is 1). */
export function maxDepth(steps: readonly Step[]): number {
  const depth = (e: Expr): number =>
    e.k === "op" ? 1 + Math.max(depth(e.a), e.b ? depth(e.b) : 0) : 0;
  let d = 0;
  for (const s of steps)
    d = Math.max(
      d,
      s.k === "set"
        ? depth(s.to)
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
