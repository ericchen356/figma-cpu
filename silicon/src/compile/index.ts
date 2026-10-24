// Lane A: the timing compiler (netlist → Schedule) and the fast schedule executor.
export { CODE, CompileError, type CompiledSchedule, type CompileOptions, compile, evalBit, type GateArrays, gateArrays } from "./schedule";
export { FastSim, powerOn } from "./fastsim";
export type { Pass, Schedule } from "./types";
