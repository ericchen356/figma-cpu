// PrototypePlan → Plugin API `Action` objects (the shapes `setReactionsAsync` takes; see
// `Action`, `VariableData`, `Expression` in @figma/plugin-typings/plugin-api.d.ts). Pure: no
// `figma` global is touched, so this runs (and is tested) in Node.
import type { Expr, PlanAction, PrototypePlan } from "./types";

/** Figma variable id per net id. */
export type VarIds = Map<number, string> | Record<number, string>;

export interface FigmaActionOptions {
  /** How a plain copy `y = a` (a BUF) is encoded. "expr" (default): EQUALS(a, true), an
   * expression that surely reads a's current value. "alias": the bare VARIABLE_ALIAS. */
  copy?: "expr" | "alias";
}

// ---------- VariableData builders ----------

export const boolData = (value: boolean): VariableData => ({ type: "BOOLEAN", resolvedType: "BOOLEAN", value });
export const floatData = (value: number): VariableData => ({ type: "FLOAT", resolvedType: "FLOAT", value });
export const aliasData = (id: string, resolvedType: VariableResolvedDataType = "BOOLEAN"): VariableData => ({
  type: "VARIABLE_ALIAS",
  resolvedType,
  value: { type: "VARIABLE_ALIAS", id },
});
export const exprData = (
  expressionFunction: ExpressionFunction,
  expressionArguments: VariableData[],
  resolvedType: VariableResolvedDataType = "BOOLEAN",
): VariableData => ({ type: "EXPRESSION", resolvedType, value: { expressionFunction, expressionArguments } });

// ---------- Action builders ----------

export const setVariable = (variableId: string, variableValue: VariableData): Action => ({
  type: "SET_VARIABLE",
  variableId,
  variableValue,
});
/** `if cond then … else …` (the else block is the one without a condition). */
export const conditional = (condition: VariableData, then: Action[], otherwise?: Action[]): Action => ({
  type: "CONDITIONAL",
  conditionalBlocks: otherwise ? [{ condition, actions: then }, { actions: otherwise }] : [{ condition, actions: then }],
});
/** Instant navigation to a top-level frame. (Cast: with the "dom" lib, the typings' global
 * `Navigation` type collides with the DOM's `Navigation` interface.) */
export const navigate = (destinationId: string): Action =>
  ({ type: "NODE", destinationId, navigation: "NAVIGATE", transition: null }) as unknown as Action;
/** n = n + by, for a FLOAT variable. */
export const increment = (variableId: string, by = 1): Action =>
  setVariable(variableId, exprData("ADDITION", [aliasData(variableId, "FLOAT"), floatData(by)], "FLOAT"));

// ---------- plan → actions ----------

function lookup(varIds: VarIds): (n: number) => string {
  return (n) => {
    const id = varIds instanceof Map ? varIds.get(n) : varIds[n];
    if (id === undefined) throw new Error(`no Figma variable for net ${n}`);
    return id;
  };
}

/** A plan expression as Figma VariableData (nested EXPRESSIONs for nested operators). */
export function figmaExpr(e: Expr, id: (n: number) => string): VariableData {
  if ("var" in e) return aliasData(id(e.var));
  if ("const" in e) return boolData(e.const === 1);
  if ("not" in e) return exprData("NOT", [figmaExpr(e.not, id)]);
  const [fn, [a, b]] =
    "and" in e
      ? (["AND", e.and] as const)
      : "or" in e
        ? (["OR", e.or] as const)
        : "eq" in e
          ? (["EQUALS", e.eq] as const)
          : (["NOT_EQUAL", e.neq] as const);
  return exprData(fn, [figmaExpr(a, id), figmaExpr(b, id)]);
}

/** The value of a SET_VARIABLE for `to`; a bare copy is wrapped per `opts.copy`. */
function setValue(to: Expr, id: (n: number) => string, opts: FigmaActionOptions): VariableData {
  if ("var" in to && opts.copy !== "alias") return exprData("EQUALS", [aliasData(id(to.var)), boolData(true)]);
  return figmaExpr(to, id);
}

/** Any plan action list → Figma actions. */
export function figmaActions(list: PlanAction[], varIds: VarIds, opts: FigmaActionOptions = {}): Action[] {
  const id = lookup(varIds);
  const conv = (l: PlanAction[]): Action[] =>
    l.map((a) =>
      "set" in a
        ? setVariable(id(a.set), setValue(a.to, id, opts))
        : conditional(figmaExpr(a.if, id), conv(a.then), a.else ? conv(a.else) : undefined),
    );
  return conv(list);
}

/** The plan's tick (one Step) as Figma actions. */
export function toFigmaActions(plan: PrototypePlan, varIds: VarIds, opts: FigmaActionOptions = {}): Action[] {
  return figmaActions(plan.tick, varIds, opts);
}
