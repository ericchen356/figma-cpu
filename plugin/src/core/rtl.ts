// Register-transfer level: every micro-op expands into T-states of control signals
// (PRD §6.4). Each T-state drives at most one value per bus; loads latch the bus.
// Watch mode plays these one per clock tick. The end state must match stepInstruction().
import { Cpu, CpuFault, hex } from "./cpu";
import type { AluOp, Micro, OpRow, OpTable, Ptr } from "./micro";
import { SIGNALS } from "./spec";

export type SignalName = string;

export interface Sig {
  s: SignalName;
  /** Register index for REG_OUT / REG_LOAD. */
  r?: number;
  /** ALU operation for ALU_OP. */
  op?: AluOp;
}

export interface TState {
  sigs: Sig[];
}

export type Phase = "FETCH" | "EXEC";

export interface TResult {
  /** T-state number inside the instruction (T0 = first fetch step). */
  t: number;
  phase: Phase;
  sigs: Sig[];
  addrBus: number | null;
  dataBus: number | null;
  alu: { op: AluOp; a: number; b: number; y: number } | null;
  /** Row being executed (null until decoded). */
  row: OpRow | null;
  /** Index of the micro-op step this T-state belongs to (-1 during fetch). */
  step: number;
  decoded: boolean;
  endOfInstruction: boolean;
}

const ADDR_DRIVERS = new Set(SIGNALS.filter((s) => s.drives === "addr").map((s) => s.name));
const DATA_DRIVERS = new Set(SIGNALS.filter((s) => s.drives === "data").map((s) => s.name));
const KNOWN = new Set(SIGNALS.map((s) => s.name));

const sig = (s: SignalName, extra: Partial<Sig> = {}): Sig => {
  if (!KNOWN.has(s)) throw new Error(`signal ${s} is not in spec/signals.json`);
  return { s, ...extra };
};
const ts = (...sigs: Sig[]): TState => ({ sigs });

/** Read the next instruction-stream byte into a latch: PC → MAR, MEM → MDR, MDR → latch. */
function streamByte(load: SignalName): TState[] {
  return [ts(sig("PC_OUT"), sig("MAR_LOAD")), ts(sig("MEM_READ"), sig("PC_INC")), ts(sig("MDR_OUT"), sig(load))];
}

export const FETCH: TState[] = streamByte("IR_LOAD");

const ptrOut = (p: Ptr) => sig(p === "HL" ? "HL_OUT" : "W_OUT");

/** Expands one micro-op into T-states. Register refs and jump conditions resolve against the live CPU. */
export function expand(m: Micro, cpu: Cpu): TState[] {
  switch (m.k) {
    case "REG":
      return streamByte("OPR_LOAD");
    case "IMM8":
      return streamByte("T_LOAD");
    case "IMM16":
      return [...streamByte("W_LO_LOAD"), ...streamByte("W_HI_LOAD")];
    case "SET":
      return [ts(sig("T_OUT"), sig("REG_LOAD", { r: cpu.regIndex(m.d) }))];
    case "COPY":
      return [ts(sig("REG_OUT", { r: cpu.regIndex(m.s) }), sig("REG_LOAD", { r: cpu.regIndex(m.d) }))];
    case "LOAD":
      return [
        ts(ptrOut(m.ptr), sig("MAR_LOAD")),
        ts(sig("MEM_READ")),
        ts(sig("MDR_OUT"), sig("REG_LOAD", { r: cpu.regIndex(m.d) })),
      ];
    case "STORE":
      return [
        ts(ptrOut(m.ptr), sig("MAR_LOAD")),
        ts(sig("REG_OUT", { r: cpu.regIndex(m.s) }), sig("MDR_LOAD")),
        ts(sig("MEM_WRITE")),
      ];
    case "SETHL":
      return [ts(sig("W_OUT"), sig("HL_LOAD"))];
    case "INCHL":
      return [ts(sig("HL_INC"))];
    case "ALU": {
      const d = cpu.regIndex(m.d);
      const compute = [sig("ALU_OP", { op: m.op }), sig("Y_LOAD"), sig("FLAGS_LOAD")];
      const out: TState[] = [
        ts(sig("REG_OUT", { r: d }), sig("A_LOAD")),
        m.s ? ts(sig("REG_OUT", { r: cpu.regIndex(m.s) }), ...compute) : ts(...compute),
      ];
      if (m.op !== "CMP") out.push(ts(sig("Y_OUT"), sig("REG_LOAD", { r: d })));
      return out;
    }
    case "JUMP":
      return [cpu.cond(m.cond) ? ts(sig("W_OUT"), sig("PC_LOAD")) : ts()];
    case "PUSH":
      return [
        ts(sig("SP_DEC")),
        ts(sig("SP_OUT"), sig("MAR_LOAD")),
        ts(sig("REG_OUT", { r: cpu.regIndex(m.s) }), sig("MDR_LOAD")),
        ts(sig("MEM_WRITE")),
      ];
    case "POP":
      return [
        ts(sig("SP_OUT"), sig("MAR_LOAD")),
        ts(sig("MEM_READ")),
        ts(sig("MDR_OUT"), sig("REG_LOAD", { r: cpu.regIndex(m.d) })),
        ts(sig("SP_INC")),
      ];
    case "PUSHPC":
      return ["PCH_OUT", "PCL_OUT"].flatMap((out) => [
        ts(sig("SP_DEC")),
        ts(sig("SP_OUT"), sig("MAR_LOAD")),
        ts(sig(out), sig("MDR_LOAD")),
        ts(sig("MEM_WRITE")),
      ]);
    case "POPPC":
      return ["PCL_LOAD", "PCH_LOAD"].flatMap((load) => [
        ts(sig("SP_OUT"), sig("MAR_LOAD")),
        ts(sig("MEM_READ")),
        ts(sig("MDR_OUT"), sig(load)),
        ts(sig("SP_INC")),
      ]);
    case "HALT":
      return [ts(sig("HALT"))];
  }
}

/** Executes one T-state on the datapath. Throws CpuFault on a bus conflict. */
export function applyTState(cpu: Cpu, state: TState): Pick<TResult, "addrBus" | "dataBus" | "alu"> {
  let addrBus: number | null = null;
  let dataBus: number | null = null;
  const has = (name: string) => state.sigs.some((x) => x.s === name);

  // 1. Drivers put values on the buses (sampled before any latch changes).
  for (const x of state.sigs) {
    if (ADDR_DRIVERS.has(x.s)) {
      if (addrBus !== null) throw new CpuFault(`address bus conflict: ${x.s} and another driver`);
      addrBus = x.s === "PC_OUT" ? cpu.pc : x.s === "HL_OUT" ? cpu.hl : x.s === "W_OUT" ? cpu.w : cpu.sp;
    } else if (DATA_DRIVERS.has(x.s)) {
      if (dataBus !== null) throw new CpuFault(`data bus conflict: ${x.s} and another driver`);
      dataBus =
        x.s === "MDR_OUT"
          ? cpu.mdr
          : x.s === "REG_OUT"
            ? cpu.r[x.r!]
            : x.s === "T_OUT"
              ? cpu.t
              : x.s === "Y_OUT"
                ? cpu.y
                : x.s === "PCH_OUT"
                  ? cpu.pc >> 8
                  : cpu.pc & 0xff;
    }
  }
  const needAddr = (name: string) => {
    if (addrBus === null) throw new CpuFault(`${name} with nothing driving the address bus`);
    return addrBus;
  };
  const needData = (name: string) => {
    if (dataBus === null) throw new CpuFault(`${name} with nothing driving the data bus`);
    return dataBus;
  };

  // 2. Address latch, then memory.
  if (has("MAR_LOAD")) cpu.mar = needAddr("MAR_LOAD");
  if (has("MEM_READ")) cpu.read(cpu.mar);
  if (has("MEM_WRITE")) cpu.write(cpu.mar, cpu.mdr);

  // 3. Latches and registers load from the buses.
  let alu: TResult["alu"] = null;
  for (const x of state.sigs) {
    switch (x.s) {
      case "MDR_LOAD":
        cpu.mdr = needData(x.s);
        break;
      case "IR_LOAD":
        cpu.ir = needData(x.s);
        break;
      case "OPR_LOAD":
        cpu.opr = needData(x.s);
        break;
      case "T_LOAD":
        cpu.t = needData(x.s);
        break;
      case "W_LO_LOAD":
        cpu.w = (cpu.w & 0xff00) | needData(x.s);
        break;
      case "W_HI_LOAD":
        cpu.w = (cpu.w & 0x00ff) | (needData(x.s) << 8);
        break;
      case "A_LOAD":
        cpu.a = needData(x.s);
        break;
      case "REG_LOAD":
        cpu.r[x.r!] = needData(x.s);
        break;
      case "PC_LOAD":
        cpu.pc = needAddr(x.s);
        break;
      case "PCH_LOAD":
        cpu.pc = (cpu.pc & 0x00ff) | (needData(x.s) << 8);
        break;
      case "PCL_LOAD":
        cpu.pc = (cpu.pc & 0xff00) | needData(x.s);
        break;
      case "HL_LOAD":
        cpu.hl = needAddr(x.s);
        break;
      case "ALU_OP": {
        const b = dataBus ?? 0;
        const a = cpu.a;
        // The ALU output only reaches Y / the flags when Y_LOAD / FLAGS_LOAD are on.
        const keepY = cpu.y;
        cpu.applyAlu(x.op!, a, b, has("FLAGS_LOAD"));
        if (!has("Y_LOAD")) cpu.y = keepY;
        alu = { op: x.op!, a, b, y: cpu.lastAlu!.y };
        break;
      }
    }
  }

  // 4. Counters.
  if (has("PC_INC")) cpu.pc = (cpu.pc + 1) & 0xffff;
  if (has("SP_INC")) cpu.sp = (cpu.sp + 1) & 0xffff;
  if (has("SP_DEC")) cpu.sp = (cpu.sp - 1) & 0xffff;
  if (has("HL_INC")) cpu.hl = (cpu.hl + 1) & 0xffff;
  if (has("HALT")) cpu.halted = true;

  return { addrBus, dataBus, alu };
}

/** Steps the machine one T-state at a time. Micro-ops expand lazily, so jump
 * conditions and rd/rs see the state left by the steps before them. */
export class Rtl {
  private queue: TState[] = [];
  private queueStep = -1;
  private inInstruction = false;
  private t = 0;
  private stepIndex = 0;
  row: OpRow | null = null;
  last: TResult | null = null;

  constructor(
    private cpu: Cpu,
    private table: () => OpTable,
  ) {}

  /** True between T0 and the T-state that carries T_RESET. */
  get midInstruction(): boolean {
    return this.inInstruction;
  }

  reset(): void {
    this.queue = [];
    this.inInstruction = false;
    this.t = 0;
    this.stepIndex = 0;
    this.row = null;
    this.last = null;
  }

  private refill(): void {
    if (!this.inInstruction) {
      this.queue = FETCH.map((x) => ts(...x.sigs));
      this.queueStep = -1;
      this.inInstruction = true;
      this.t = 0;
      this.row = null;
      this.stepIndex = 0;
      return;
    }
    const row = this.row!;
    if (row.micro.length === 0) {
      this.queue = [ts(sig("T_RESET"))];
      this.queueStep = -1;
      return;
    }
    const i = this.stepIndex++;
    this.queue = expand(row.micro[i], this.cpu);
    this.queueStep = i;
    if (this.stepIndex === row.micro.length) this.queue[this.queue.length - 1].sigs.push(sig("T_RESET"));
  }

  /** Executes one T-state. Returns null when the CPU is halted. */
  step(): TResult | null {
    const cpu = this.cpu;
    if (cpu.halted) return null;
    try {
      if (this.queue.length === 0) this.refill();
      const state = this.queue.shift()!;
      const t = this.t++;
      const phase: Phase = this.row ? "EXEC" : "FETCH";
      const bus = applyTState(cpu, state);
      cpu.tstates++;
      let decoded = false;
      if (state.sigs.some((x) => x.s === "IR_LOAD")) {
        const row = this.table().byOp[cpu.ir];
        if (!row) throw new CpuFault(`illegal opcode ${hex(cpu.ir, 2)} at ${hex((cpu.pc - 1) & 0xffff, 4)}`);
        this.row = row;
        decoded = true;
      }
      const end = state.sigs.some((x) => x.s === "T_RESET");
      const result: TResult = {
        t,
        phase,
        sigs: state.sigs,
        ...bus,
        row: this.row,
        step: phase === "EXEC" ? this.queueStep : -1,
        decoded,
        endOfInstruction: end,
      };
      if (end) {
        this.inInstruction = false;
        cpu.instructions++;
      }
      this.last = result;
      return result;
    } catch (e) {
      if (!(e instanceof CpuFault)) throw e;
      cpu.halted = true;
      cpu.fault = e.message;
      this.inInstruction = false;
      this.queue = [];
      return null;
    }
  }

  /** Runs the rest of the current instruction (if any), so Turbo can take over. */
  finishInstruction(): void {
    while (this.inInstruction && !this.cpu.halted) this.step();
  }
}
