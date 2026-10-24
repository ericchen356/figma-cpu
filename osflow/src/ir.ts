// The flow IR: what the OS is made of once it stops being TypeScript. A program is a list of
// typed variables and a list of event handlers; a handler is a list of steps, and a step is
// either `set var = expr` or `if cond then … else …`. That is exactly what one Figma prototype
// reaction can do (SET_VARIABLE and CONDITIONAL), so the same data is run by the interpreter
// (interp.ts, for tests) and compiled to Figma actions (compile.ts). Nothing here knows about
// the editor: the editor is data built from these pieces (editor.ts).
//
// Smart constructors fold constants as they build, so a handler written for "any cell" shrinks
// when it is specialized for one cell: `x >= cx*K` becomes a comparison with a literal.

export type Ty = "num" | "bool" | "str" | "col";
export type Val = number | boolean | string;

/** Operators Figma's expression engine has (no min/max/floor/modulo: those are steps, see dsl.ts). */
export type Fn =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "neg"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "eq"
  | "ne"
  | "and"
  | "or"
  | "not";

export type Expr =
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "str"; v: string }
  /** A color literal, "#rrggbb". Only a SET can use it: there is no arithmetic on colors. */
  | { k: "col"; v: string }
  | { k: "var"; name: string }
  | { k: "op"; fn: Fn; a: Expr; b?: Expr };

export type Step =
  | { k: "set"; name: string; to: Expr }
  | { k: "if"; cond: Expr; then: Step[]; else?: Step[] }
  /** dst = floor(src / 2), for a whole number src ≥ 0. Gate level only: there it is a shift. The
   * word-level editor writes bit-peeling steps instead, because Figma has no floor. */
  | { k: "half"; dst: string; src: Expr }
  /** A named group of steps: one block of the gate-level chart (gates/ draws each unit as one
   * module). It runs its steps in place and costs no action itself. */
  | { k: "unit"; name: string; steps: Step[] };

/** What a variable is to the gate-level machine (gates/):
 *  · state  a register: it keeps its value from one event to the next;
 *  · temp   recomputed inside one event and never read there before it is written;
 *  · view   derived from the state for the screen (the display decode computes it, not a register);
 *  · input  driven from outside before each event (the pointer cell);
 *  · const  a fixed value (the window corner, until panning exists). */
export type Role = "state" | "temp" | "view" | "input" | "const";

export interface VarDecl {
  name: string;
  ty: Ty;
  init: Val;
  /** Gate level: what the variable is (default "state"). */
  role?: Role;
  /** Gate level: bit width of a num variable, and whether it is two's complement. */
  bits?: number;
  signed?: boolean;
}

export type Const = Extract<Expr, { k: "num" | "bool" | "str" | "col" }>;
export const isConst = (e: Expr): e is Const =>
  e.k === "num" || e.k === "bool" || e.k === "str" || e.k === "col";

// ---------- expressions ----------

export const num = (v: number): Expr => ({ k: "num", v });
export const bool = (v: boolean): Expr => ({ k: "bool", v });
export const str = (v: string): Expr => ({ k: "str", v });
export const col = (v: string): Expr => ({ k: "col", v });
export const ref = (name: string): Expr => ({ k: "var", name });

/** The value of an operator over values: the one definition shared by folding and the interpreter. */
export function applyFn(fn: Fn, a: Val, b?: Val): Val {
  switch (fn) {
    case "add":
      return typeof a === "string" || typeof b === "string"
        ? `${a}${b}`
        : (a as number) + (b as number);
    case "sub":
      return (a as number) - (b as number);
    case "mul":
      return (a as number) * (b as number);
    case "div":
      return (a as number) / (b as number);
    case "neg":
      return -(a as number);
    case "lt":
      return (a as number) < (b as number);
    case "le":
      return (a as number) <= (b as number);
    case "gt":
      return (a as number) > (b as number);
    case "ge":
      return (a as number) >= (b as number);
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "and":
      return (a as boolean) && (b as boolean);
    case "or":
      return (a as boolean) || (b as boolean);
    case "not":
      return !(a as boolean);
  }
}

const constOf = (v: Val): Expr =>
  typeof v === "number" ? num(v) : typeof v === "boolean" ? bool(v) : str(v);

function op(fn: Fn, a: Expr, b?: Expr): Expr {
  if (isConst(a) && (b === undefined || isConst(b)))
    return constOf(applyFn(fn, a.v, b && (b as Const).v));
  if (fn === "and") {
    if (a.k === "bool") return a.v ? b! : a;
    if (b!.k === "bool") return b!.v ? a : b!;
  }
  if (fn === "or") {
    if (a.k === "bool") return a.v ? a : b!;
    if (b!.k === "bool") return b!.v ? b! : a;
  }
  if (fn === "add" && b!.k === "num" && b!.v === 0 && a.k !== "str") return a;
  if (fn === "not" && a.k === "op" && a.fn === "not") return a.a;
  return b === undefined ? { k: "op", fn, a } : { k: "op", fn, a, b };
}

export const add = (a: Expr, b: Expr) => op("add", a, b);
export const sub = (a: Expr, b: Expr) => op("sub", a, b);
export const mul = (a: Expr, b: Expr) => op("mul", a, b);
export const div = (a: Expr, b: Expr) => op("div", a, b);
export const neg = (a: Expr) => op("neg", a);
export const lt = (a: Expr, b: Expr) => op("lt", a, b);
export const le = (a: Expr, b: Expr) => op("le", a, b);
export const gt = (a: Expr, b: Expr) => op("gt", a, b);
export const ge = (a: Expr, b: Expr) => op("ge", a, b);
export const eq = (a: Expr, b: Expr) => op("eq", a, b);
export const ne = (a: Expr, b: Expr) => op("ne", a, b);
export const not = (a: Expr) => op("not", a);
/** `and`/`or` take any number of operands and nest them to the left. */
export const and = (first: Expr, ...rest: Expr[]) =>
  rest.reduce((acc, e) => op("and", acc, e), first);
export const or = (first: Expr, ...rest: Expr[]) =>
  rest.reduce((acc, e) => op("or", acc, e), first);

// ---------- steps ----------

export type Part = Step | Step[];
/** Flattens nested step lists: handlers are written by composing small pieces. */
export const seq = (...parts: Part[]): Step[] => parts.flat();

export const set = (name: string, to: Expr): Step[] => [{ k: "set", name, to }];

/** dst = floor(src / 2) (gate level only, see Step). */
export const half = (dst: string, src: Expr): Step[] => [
  { k: "half", dst, src },
];

/** Groups steps into one named block of the chart. An empty group disappears. */
export function unit(name: string, ...parts: Part[]): Step[] {
  const steps = seq(...parts);
  return steps.length ? [{ k: "unit", name, steps }] : [];
}

/** The steps with every unit opened up, in order (what runs; units only group them for the chart). */
export function inline(steps: readonly Step[]): Step[] {
  return steps.flatMap((s): Step[] =>
    s.k === "unit"
      ? inline(s.steps)
      : s.k === "if"
        ? [
            {
              ...s,
              then: inline(s.then),
              ...(s.else ? { else: inline(s.else) } : {}),
            },
          ]
        : [s],
  );
}

/** `if cond then … else …`. A constant condition keeps only the branch that runs. */
export function when(cond: Expr, then: Part[], otherwise?: Part[]): Step[] {
  if (cond.k === "bool") return seq(...(cond.v ? then : (otherwise ?? [])));
  const t = seq(...then);
  const e = otherwise ? seq(...otherwise) : undefined;
  if (!t.length && !e?.length) return [];
  return [{ k: "if", cond, then: t, ...(e?.length ? { else: e } : {}) }];
}

/** Runs `body(i)` for the integer i in [lo, hi] that `index` holds, as a balanced decision tree
 * (log2 conditionals instead of one per case). An index outside the range runs the nearest end. */
export function switchOn(
  index: Expr,
  lo: number,
  hi: number,
  body: (i: number) => Part[],
): Step[] {
  if (index.k === "num")
    return seq(...body(Math.min(hi, Math.max(lo, index.v))));
  if (lo === hi) return seq(...body(lo));
  const mid = (lo + hi) >> 1;
  return when(
    le(index, num(mid)),
    [switchOn(index, lo, mid, body)],
    [switchOn(index, mid + 1, hi, body)],
  );
}

// ---------- program ----------

/** A named reaction on a named UI node: the unit the deploy step attaches to a Figma frame. */
export interface FlowEvent {
  /** Unique id, `<node>#<trigger>`. */
  id: string;
  /** Name of the UI element it belongs to (see layout.ts for what each name draws). */
  node: string;
  trigger: Trigger;
  steps: Step[];
}

export type Trigger =
  | { type: "click" }
  | { type: "down" }
  | { type: "up" }
  | { type: "enter" }
  /** JS keyCodes pressed together. */
  | { type: "key"; keyCodes: number[] };

export interface Program {
  vars: VarDecl[];
  events: FlowEvent[];
}

/** Variables read or written by a step list (for tests and for tracing which parts a flow touches). */
export function touched(
  steps: readonly Step[],
  into = { reads: new Set<string>(), writes: new Set<string>() },
) {
  const readsOf = (e: Expr): void => {
    if (e.k === "var") into.reads.add(e.name);
    else if (e.k === "op") {
      readsOf(e.a);
      if (e.b) readsOf(e.b);
    }
  };
  for (const s of steps) {
    if (s.k === "set") {
      into.writes.add(s.name);
      readsOf(s.to);
    } else if (s.k === "half") {
      into.writes.add(s.dst);
      readsOf(s.src);
    } else if (s.k === "unit") {
      touched(s.steps, into);
    } else {
      readsOf(s.cond);
      touched(s.then, into);
      if (s.else) touched(s.else, into);
    }
  }
  return into;
}
