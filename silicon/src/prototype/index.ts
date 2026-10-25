// Prototype compiler (lane F): netlist + schedule → Figma variables and prototype actions.
export type { Chunking, Expr, LitBindings, PlanAction, PlanStats, PlanVariable, PrototypePlan } from "./types";
export {
  and,
  chunkTick,
  countActions,
  DEFAULT_MAX_ACTIONS_PER_EVENT,
  dispatchOverhead,
  eq,
  exprDepth,
  gateExpr,
  lit,
  needsChunks,
  neq,
  not,
  or,
  plan,
  type PlanOptions,
  ref,
  setActions,
  splitActions,
  varName,
  worstActions,
} from "./plan";
export { evalExpr, initialState, interpret, interpretChunked, type PlanState, runPlanActions } from "./interpret";
export {
  afterTimeout,
  aliasData,
  boolData,
  compareData,
  concatText,
  conditional,
  digitsIncrement,
  digitText,
  exprData,
  type FigmaActionOptions,
  figmaActions,
  figmaExpr,
  floatData,
  increment,
  keyDown,
  mouseDown,
  mouseEnter,
  mouseUp,
  navigate,
  navigateWith,
  onClick,
  setVariable,
  strData,
  toFigmaActions,
  type VarIds,
  worstCase,
} from "./figma-actions";
export { evalVariableData, type FigmaValue, runFigmaActions } from "./emulate";
export { apply, type ApplyOptions, type ApplyResult, type ApplyRuntime } from "./apply";
export { applyPerChunk, type PerChunkOptions, type PerChunkResult } from "./apply-per-chunk";
export {
  asmListing,
  cpuPrograms,
  LIVE_LOCK,
  type LiveFrames,
  liveFrameNames,
  type LiveOptions,
  type LiveProgram,
  type LiveResult,
  type LiveTrigger,
  wireLive,
} from "./live";
export { bindVisible, createVariables, removeCollections, setFlows } from "./draw";
export { type Gating, gateSchedule } from "./gating";
export { powerOnState, simpleSchedule } from "./schedule";
