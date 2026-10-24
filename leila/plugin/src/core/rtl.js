// Register-transfer level: every micro-op expands into T-states of control signals. Each T-state
// drives at most one value per bus; loads latch the bus. Watch mode plays these one per clock tick.

const ADDR_DRIVERS = new Set(SIGNALS.filter((s) => s.drives === "addr").map((s) => s.name));
const DATA_DRIVERS = new Set(SIGNALS.filter((s) => s.drives === "data").map((s) => s.name));
const KNOWN_SIGNALS = new Set(SIGNALS.map((s) => s.name));

function sig(s, extra) {
  if (!KNOWN_SIGNALS.has(s)) throw new Error(`signal ${s} is not in signals.json`);
  return Object.assign({ s }, extra || {});
}
const ts = (...sigs) => ({ sigs });

/** Reads the next instruction-stream byte into a latch: PC → MAR, MEM → MDR, MDR → latch. */
function streamByte(load) {
  return [ts(sig("PC_OUT"), sig("MAR_LOAD")), ts(sig("MEM_READ"), sig("PC_INC")), ts(sig("MDR_OUT"), sig(load))];
}
const FETCH = streamByte("IR_LOAD");
const ptrOut = (p) => sig(p === "HL" ? "HL_OUT" : "W_OUT");

/** Expands one micro-op into T-states; register refs and conditions resolve against the live CPU. */
function expand(m, cpu) {
  switch (m.k) {
    case "REG": return streamByte("OPR_LOAD");
    case "IMM8": return streamByte("T_LOAD");
    case "IMM16": return streamByte("W_LO_LOAD").concat(streamByte("W_HI_LOAD"));
    case "SET": return [ts(sig("T_OUT"), sig("REG_LOAD", { r: cpu.regIndex(m.d) }))];
    case "COPY": return [ts(sig("REG_OUT", { r: cpu.regIndex(m.s) }), sig("REG_LOAD", { r: cpu.regIndex(m.d) }))];
    case "LOAD":
      return [ts(ptrOut(m.ptr), sig("MAR_LOAD")), ts(sig("MEM_READ")), ts(sig("MDR_OUT"), sig("REG_LOAD", { r: cpu.regIndex(m.d) }))];
    case "STORE":
      return [ts(ptrOut(m.ptr), sig("MAR_LOAD")), ts(sig("REG_OUT", { r: cpu.regIndex(m.s) }), sig("MDR_LOAD")), ts(sig("MEM_WRITE"))];
    case "SETHL": return [ts(sig("W_OUT"), sig("HL_LOAD"))];
    case "INCHL": return [ts(sig("HL_INC"))];
    case "ALU": {
      const d = cpu.regIndex(m.d);
      const compute = [sig("ALU_OP", { op: m.op }), sig("Y_LOAD"), sig("FLAGS_LOAD")];
      const out = [
        ts(sig("REG_OUT", { r: d }), sig("A_LOAD")),
        m.s ? ts(sig("REG_OUT", { r: cpu.regIndex(m.s) }), ...compute) : ts(...compute),
      ];
      if (m.op !== "CMP") out.push(ts(sig("Y_OUT"), sig("REG_LOAD", { r: d })));
      return out;
    }
    case "JUMP": return [cpu.cond(m.cond) ? ts(sig("W_OUT"), sig("PC_LOAD")) : ts()];
    case "PUSH":
      return [ts(sig("SP_DEC")), ts(sig("SP_OUT"), sig("MAR_LOAD")), ts(sig("REG_OUT", { r: cpu.regIndex(m.s) }), sig("MDR_LOAD")), ts(sig("MEM_WRITE"))];
    case "POP":
      return [ts(sig("SP_OUT"), sig("MAR_LOAD")), ts(sig("MEM_READ")), ts(sig("MDR_OUT"), sig("REG_LOAD", { r: cpu.regIndex(m.d) })), ts(sig("SP_INC"))];
    case "PUSHPC": {
      const out = [];
      for (const o of ["PCH_OUT", "PCL_OUT"])
        out.push(ts(sig("SP_DEC")), ts(sig("SP_OUT"), sig("MAR_LOAD")), ts(sig(o), sig("MDR_LOAD")), ts(sig("MEM_WRITE")));
      return out;
    }
    case "POPPC": {
      const out = [];
      for (const l of ["PCL_LOAD", "PCH_LOAD"])
        out.push(ts(sig("SP_OUT"), sig("MAR_LOAD")), ts(sig("MEM_READ")), ts(sig("MDR_OUT"), sig(l)), ts(sig("SP_INC")));
      return out;
    }
    case "HALT": return [ts(sig("HALT"))];
  }
  throw new Error(`cannot expand ${m.k}`);
}

/** Executes one T-state. Throws CpuFault on a bus conflict or a load from an undriven bus. */
function applyTState(cpu, state) {
  let addrBus = null;
  let dataBus = null;
  const has = (name) => state.sigs.some((x) => x.s === name);
  for (const x of state.sigs) {
    if (ADDR_DRIVERS.has(x.s)) {
      if (addrBus !== null) throw new CpuFault(`address bus conflict: ${x.s} and another driver`);
      addrBus = x.s === "PC_OUT" ? cpu.pc : x.s === "HL_OUT" ? cpu.hl : x.s === "W_OUT" ? cpu.w : cpu.sp;
    } else if (DATA_DRIVERS.has(x.s)) {
      if (dataBus !== null) throw new CpuFault(`data bus conflict: ${x.s} and another driver`);
      dataBus =
        x.s === "MDR_OUT" ? cpu.mdr
        : x.s === "REG_OUT" ? cpu.r[x.r]
        : x.s === "T_OUT" ? cpu.t
        : x.s === "Y_OUT" ? cpu.y
        : x.s === "PCH_OUT" ? cpu.pc >> 8
        : cpu.pc & 0xff;
    }
  }
  const needAddr = (name) => {
    if (addrBus === null) throw new CpuFault(`${name} with nothing driving the address bus`);
    return addrBus;
  };
  const needData = (name) => {
    if (dataBus === null) throw new CpuFault(`${name} with nothing driving the data bus`);
    return dataBus;
  };
  if (has("MAR_LOAD")) cpu.mar = needAddr("MAR_LOAD");
  if (has("MEM_READ")) cpu.read(cpu.mar);
  if (has("MEM_WRITE")) cpu.write(cpu.mar, cpu.mdr);
  let aluOut = null;
  for (const x of state.sigs) {
    switch (x.s) {
      case "MDR_LOAD": cpu.mdr = needData(x.s); break;
      case "IR_LOAD": cpu.ir = needData(x.s); break;
      case "OPR_LOAD": cpu.opr = needData(x.s); break;
      case "T_LOAD": cpu.t = needData(x.s); break;
      case "W_LO_LOAD": cpu.w = (cpu.w & 0xff00) | needData(x.s); break;
      case "W_HI_LOAD": cpu.w = (cpu.w & 0x00ff) | (needData(x.s) << 8); break;
      case "A_LOAD": cpu.a = needData(x.s); break;
      case "REG_LOAD": cpu.r[x.r] = needData(x.s); break;
      case "PC_LOAD": cpu.pc = needAddr(x.s); break;
      case "PCH_LOAD": cpu.pc = (cpu.pc & 0x00ff) | (needData(x.s) << 8); break;
      case "PCL_LOAD": cpu.pc = (cpu.pc & 0xff00) | needData(x.s); break;
      case "HL_LOAD": cpu.hl = needAddr(x.s); break;
      case "ALU_OP": {
        const b = dataBus === null ? 0 : dataBus;
        const a = cpu.a;
        const keepY = cpu.y;
        cpu.applyAlu(x.op, a, b, has("FLAGS_LOAD"));
        if (!has("Y_LOAD")) cpu.y = keepY;
        aluOut = { op: x.op, a, b, y: cpu.lastAlu.y };
        break;
      }
    }
  }
  if (has("PC_INC")) cpu.pc = (cpu.pc + 1) & 0xffff;
  if (has("SP_INC")) cpu.sp = (cpu.sp + 1) & 0xffff;
  if (has("SP_DEC")) cpu.sp = (cpu.sp - 1) & 0xffff;
  if (has("HL_INC")) cpu.hl = (cpu.hl + 1) & 0xffff;
  if (has("HALT")) cpu.halted = true;
  return { addrBus, dataBus, alu: aluOut };
}

/** Steps one T-state at a time. Micro-ops expand lazily so conditions see the state before them. */
class Rtl {
  constructor(cpu, getTable) {
    this.cpu = cpu;
    this.getTable = getTable;
    this.reset();
  }

  get midInstruction() {
    return this.inInstruction;
  }

  reset() {
    this.queue = [];
    this.queueStep = -1;
    this.inInstruction = false;
    this.t = 0;
    this.stepIndex = 0;
    this.row = null;
    this.last = null;
  }

  refill() {
    if (!this.inInstruction) {
      this.queue = FETCH.map((x) => ts(...x.sigs));
      this.queueStep = -1;
      this.inInstruction = true;
      this.t = 0;
      this.row = null;
      this.stepIndex = 0;
      return;
    }
    const row = this.row;
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
  step() {
    const cpu = this.cpu;
    if (cpu.halted) return null;
    try {
      if (this.queue.length === 0) this.refill();
      const state = this.queue.shift();
      const t = this.t++;
      const phase = this.row ? "EXEC" : "FETCH";
      const bus = applyTState(cpu, state);
      cpu.tstates++;
      let decoded = false;
      if (state.sigs.some((x) => x.s === "IR_LOAD")) {
        const row = this.getTable().byOp[cpu.ir];
        if (!row) throw new CpuFault(`illegal opcode ${hex(cpu.ir, 2)} at ${hex((cpu.pc - 1) & 0xffff, 4)}`);
        this.row = row;
        decoded = true;
      }
      const end = state.sigs.some((x) => x.s === "T_RESET");
      const result = {
        t, phase, sigs: state.sigs, addrBus: bus.addrBus, dataBus: bus.dataBus, alu: bus.alu,
        row: this.row, step: phase === "EXEC" ? this.queueStep : -1, decoded, endOfInstruction: end,
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

  /** Runs the rest of the current instruction so Turbo can take over cleanly. */
  finishInstruction() {
    while (this.inInstruction && !this.cpu.halted) this.step();
  }
}
