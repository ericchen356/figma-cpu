// Prototype compiler (lane F): netlist + schedule → Figma variables and prototype actions.
export type { Expr, LitBindings, PlanAction, PlanStats, PlanVariable, PrototypePlan } from "./types";
export { and, countActions, eq, exprDepth, gateExpr, lit, neq, not, or, plan, type PlanOptions, ref, setActions, varName } from "./plan";
export { evalExpr, initialState, interpret, type PlanState, runPlanActions } from "./interpret";
export {
  aliasData,
  boolData,
  conditional,
  exprData,
  type FigmaActionOptions,
  figmaActions,
  figmaExpr,
  floatData,
  increment,
  navigate,
  setVariable,
  toFigmaActions,
  type VarIds,
} from "./figma-actions";
export { evalVariableData, type FigmaValue, runFigmaActions } from "./emulate";
export { apply, type ApplyOptions, type ApplyResult } from "./apply";
export { createVariables, removeCollections, bindVisible } from "./draw";
export { powerOnState, simpleSchedule } from "./schedule";
