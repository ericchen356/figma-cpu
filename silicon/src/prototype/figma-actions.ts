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

export const boolData = (value: boolean): VariableData => ({
  type: "BOOLEAN",
  resolvedType: "BOOLEAN",
  value,
});
export const floatData = (value: number): VariableData => ({
  type: "FLOAT",
  resolvedType: "FLOAT",
  value,
});
export const aliasData = (
  id: string,
  resolvedType: VariableResolvedDataType = "BOOLEAN",
): VariableData => ({
  type: "VARIABLE_ALIAS",
  resolvedType,
  value: { type: "VARIABLE_ALIAS", id },
});
export const exprData = (
  expressionFunction: ExpressionFunction,
  expressionArguments: VariableData[],
  resolvedType: VariableResolvedDataType = "BOOLEAN",
): VariableData => ({
  type: "EXPRESSION",
  resolvedType,
  value: { expressionFunction, expressionArguments },
});

// ---------- Action builders ----------

export const setVariable = (
  variableId: string,
  variableValue: VariableData,
): Action => ({
  type: "SET_VARIABLE",
  variableId,
  variableValue,
});
/** `if cond then … else …` (the else block is the one without a condition). */
export const conditional = (
  condition: VariableData,
  then: Action[],
  otherwise?: Action[],
): Action => ({
  type: "CONDITIONAL",
  conditionalBlocks: otherwise
    ? [{ condition, actions: then }, { actions: otherwise }]
    : [{ condition, actions: then }],
});
/** Instant navigation to a top-level frame. (Cast: with the "dom" lib, the typings' global
 * `Navigation` type collides with the DOM's `Navigation` interface.) */
export const navigate = (destinationId: string): Action =>
  ({
    type: "NODE",
    destinationId,
    navigation: "NAVIGATE",
    transition: null,
  }) as unknown as Action;
/** n = n + by, for a FLOAT variable. */
export const increment = (variableId: string, by = 1): Action =>
  setVariable(
    variableId,
    exprData(
      "ADDITION",
      [aliasData(variableId, "FLOAT"), floatData(by)],
      "FLOAT",
    ),
  );

export const strData = (value: string): VariableData => ({
  type: "STRING",
  resolvedType: "STRING",
  value,
});
/** FLOAT variable compared with a literal (a BOOLEAN expression). */
export const compareData = (
  fn: "LESS_THAN" | "GREATER_THAN" | "EQUALS",
  variableId: string,
  value: number,
): VariableData =>
  exprData(fn, [aliasData(variableId, "FLOAT"), floatData(value)]);

// ---------- numbers on text layers ----------
// Text `characters` only bind to STRING variables (spike: binding a FLOAT throws "variable of
// resolved type 'FLOAT' cannot be bound to 'characters'"). Two ways to show a number:

/** s = prefix + n (Figma: "number values can be added on to a string value"). One action. */
export const concatText = (
  textId: string,
  numberId: string,
  prefix = "",
): Action =>
  setVariable(
    textId,
    exprData(
      "ADDITION",
      [strData(prefix), aliasData(numberId, "FLOAT")],
      "STRING",
    ),
  );

/** s = "0"…"9" from a FLOAT digit 0–9 by a binary search of nested CONDITIONALs (string
 * literals only; the fallback if concatenation does not work). ≤ 5 actions executed. */
export function digitText(
  digitId: string,
  textId: string,
  lo = 0,
  hi = 9,
): Action[] {
  if (lo === hi) return [setVariable(textId, strData(String(lo)))];
  const mid = (lo + hi) >> 1;
  return [
    conditional(
      compareData("LESS_THAN", digitId, mid + 0.5),
      digitText(digitId, textId, lo, mid),
      digitText(digitId, textId, mid + 1, hi),
    ),
  ];
}

/** Increments a decimal counter kept as FLOAT digits (LSB first) and their STRING texts. */
export function digitsIncrement(
  digitIds: string[],
  textIds: string[],
  i = 0,
): Action[] {
  const acts: Action[] = [increment(digitIds[i])];
  if (i + 1 < digitIds.length)
    acts.push(
      conditional(compareData("GREATER_THAN", digitIds[i], 9.5), [
        setVariable(digitIds[i], floatData(0)),
        ...digitsIncrement(digitIds, textIds, i + 1),
      ]),
    );
  acts.push(...digitText(digitIds[i], textIds[i]));
  return acts;
}

// ---------- triggers ----------

export const onClick = (): Trigger => ({ type: "ON_CLICK" });
export const mouseDown = (delay = 0): Trigger => ({
  type: "MOUSE_DOWN",
  delay,
});
export const mouseUp = (delay = 0): Trigger => ({ type: "MOUSE_UP", delay });
/** The typings list `deprecatedVersion` for MOUSE_ENTER, but setReactionsAsync rejects a trigger that
 * carries it (measured in Figma desktop, 2026-10-24), so it is left out. */
export const mouseEnter = (delay = 0): Trigger =>
  ({ type: "MOUSE_ENTER", delay }) as unknown as Trigger;
/** Key codes are JS keyCodes (Space 32, A–Z 65–90). */
export const keyDown = (keyCodes: number[]): Trigger => ({
  type: "ON_KEY_DOWN",
  device: "KEYBOARD",
  keyCodes,
});
/** `timeout` in SECONDS. developers.figma.com says milliseconds, but the viewer waits `timeout`
 * seconds (1 = one second, measured in Present 2026-10-24); 0.001 hops as soon as it can. */
export const afterTimeout = (timeout: number): Trigger => ({
  type: "AFTER_TIMEOUT",
  timeout,
});

/** Navigation of any kind (NAVIGATE / SWAP / CHANGE_TO …), instant. */
export const navigateWith = (
  destinationId: string,
  navigation: "NAVIGATE" | "SWAP" | "CHANGE_TO" | "OVERLAY" | "SCROLL_TO",
): Action =>
  ({
    type: "NODE",
    destinationId,
    navigation,
    transition: null,
  }) as unknown as Action;

/** Executed actions in the worst case (every condition taken the costliest way): what one
 * event can cost the viewer's stack. A CONDITIONAL counts 1 plus its largest block. */
export function worstCase(actions: readonly Action[]): number {
  let n = 0;
  for (const a of actions)
    n +=
      a.type === "CONDITIONAL"
        ? 1 +
          Math.max(0, ...a.conditionalBlocks.map((b) => worstCase(b.actions)))
        : 1;
  return n;
}

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
function setValue(
  to: Expr,
  id: (n: number) => string,
  opts: FigmaActionOptions,
): VariableData {
  if ("var" in to && opts.copy !== "alias")
    return exprData("EQUALS", [aliasData(id(to.var)), boolData(true)]);
  return figmaExpr(to, id);
}

/** Any plan action list → Figma actions. */
export function figmaActions(
  list: PlanAction[],
  varIds: VarIds,
  opts: FigmaActionOptions = {},
): Action[] {
  const id = lookup(varIds);
  const conv = (l: PlanAction[]): Action[] =>
    l.map((a) =>
      "set" in a
        ? setVariable(id(a.set), setValue(a.to, id, opts))
        : conditional(
            figmaExpr(a.if, id),
            conv(a.then),
            a.else ? conv(a.else) : undefined,
          ),
    );
  return conv(list);
}

/** The plan's tick (one Step) as Figma actions. */
export function toFigmaActions(
  plan: PrototypePlan,
  varIds: VarIds,
  opts: FigmaActionOptions = {},
): Action[] {
  return figmaActions(plan.tick, varIds, opts);
}

/** Debug aid: make `node.setReactionsAsync` log which node, trigger and first action Figma rejected. Never throws. */
export function guardReactions(node: unknown, label: string, log: (msg: string) => void): void {
  const n = node as { setReactionsAsync?: (r: Reaction[]) => Promise<void> } | undefined;
  if (!n || typeof n.setReactionsAsync !== "function") return;
  const orig = n.setReactionsAsync.bind(n);
  try {
    n.setReactionsAsync = async (r: Reaction[]) => {
      try {
        await orig(r);
      } catch (e) {
        const first = r[0]?.actions?.[0] as unknown as Record<string, unknown> | undefined;
        log(`FAILED setReactions on "${label}": ${String((e as Error)?.message ?? e).slice(0, 300)} | ${r.length} reaction(s), trigger=${JSON.stringify(r[0]?.trigger)}, actions[0] type=${String(first?.type)} keys=${first ? Object.keys(first).join(",") : "none"}`);
        throw e;
      }
    };
  } catch {
    /* node object does not allow overriding; skip */
  }
}

/** Figma's setReactionsAsync rejects a CONDITIONAL inside another conditional's block (real Figma, 2026-10-24:
 * `Unrecognized key: "conditionalBlocks" at [0].actions[0].conditionalBlocks[0].actions[1]`). Returns where, or null if flat. */
export function nestedConditional(actions: readonly Action[], path = "actions"): string | null {
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type !== "CONDITIONAL") continue;
    for (let b = 0; b < a.conditionalBlocks.length; b++) {
      const inner = a.conditionalBlocks[b].actions as Action[];
      const at = inner.findIndex((x) => x.type === "CONDITIONAL");
      if (at >= 0) return `${path}[${i}].conditionalBlocks[${b}].actions[${at}]`;
    }
  }
  return null;
}
