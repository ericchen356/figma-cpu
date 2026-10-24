// CPU state, the ALU, and the instruction-level interpreter used by Turbo and Step instr.
// The T-state engine in rtl.js must leave the machine in exactly the same state.

function alu(op, a, b) {
  let r = 0;
  let c = false;
  switch (op) {
    case "ADD": r = a + b; c = r > 0xff; break;
    case "SUB": case "CMP": r = a - b; c = a < b; break;
    case "AND": r = a & b; break;
    case "OR": r = a | b; break;
    case "XOR": r = a ^ b; break;
    case "INC": r = a + 1; c = a === 0xff; break;
    case "DEC": r = a - 1; c = a === 0; break;
    case "SHL": r = a << 1; c = (a & 0x80) !== 0; break;
    case "SHR": r = a >> 1; c = (a & 1) !== 0; break;
  }
  const y = r & 0xff;
  return { y, z: y === 0, c, n: (y & 0x80) !== 0 };
}

const H_INDEX = REGISTERS.indexOf("H");
const L_INDEX = REGISTERS.indexOf("L");

class Cpu {
  constructor() {
    this.mem = new Uint8Array(0x10000);
    this.r = new Uint8Array(REGISTERS.length);
    this.reset(true);
  }

  get hl() {
    return (this.r[H_INDEX] << 8) | this.r[L_INDEX];
  }
  set hl(v) {
    this.r[H_INDEX] = (v >> 8) & 0xff;
    this.r[L_INDEX] = v & 0xff;
  }

  /** Clears registers and latches; memory too when clearMemory. */
  reset(clearMemory) {
    if (clearMemory) this.mem.fill(0);
    this.r.fill(0);
    this.pc = MEMORY.programStart;
    this.sp = MEMORY.stackTop;
    this.ir = this.opr = this.t = this.w = this.mar = this.mdr = this.a = this.y = 0;
    this.z = this.c = this.n = false;
    this.halted = false;
    this.fault = null;
    this.instructions = 0;
    this.tstates = 0;
    this.rng = 0x5a;
    this.vramDirty = true;
    this.lastAlu = null;
    /** Mouse samples [x, y, btn]; reading MOUSE_BTN applies the next one, so slow polling misses nothing. */
    this.mouseQueue = [];
  }

  pushMouse(x, y, btn) {
    const q = this.mouseQueue;
    const last = q[q.length - 1];
    if (last && last[0] === x && last[1] === y && last[2] === btn) return;
    if (last && btn === 0 && last[2] === 0 && q.length > 1 && q[q.length - 2][2] === 0) q[q.length - 1] = [x, y, btn];
    else q.push([x, y, btn]);
    if (q.length > 4096) q.shift();
  }

  load(addr, bytes) {
    for (let i = 0; i < bytes.length; i++) this.write((addr + i) & 0xffff, bytes[i]);
  }

  nextRand() {
    let x = this.rng;
    x ^= (x << 7) & 0xff;
    x ^= x >> 5;
    x ^= (x << 3) & 0xff;
    this.rng = x || 0x5a;
    return this.rng;
  }

  /** A bus read: latches MAR and MDR like the hardware. */
  read(addr) {
    addr &= 0xffff;
    this.mar = addr;
    let v;
    if (addr === IO.RAND) {
      v = this.nextRand();
      this.mem[addr] = v;
    } else {
      if (addr === IO.MOUSE_BTN && this.mouseQueue.length) {
        const s = this.mouseQueue.shift();
        this.mem[IO.MOUSE_X] = s[0];
        this.mem[IO.MOUSE_Y] = s[1];
        this.mem[IO.MOUSE_BTN] = s[2];
      }
      v = this.mem[addr];
    }
    this.mdr = v;
    return v;
  }

  write(addr, v) {
    addr &= 0xffff;
    v &= 0xff;
    this.mar = addr;
    this.mdr = v;
    this.mem[addr] = v;
    if (addr >= MEMORY.vramStart && addr <= MEMORY.vramEnd) this.vramDirty = true;
  }

  /** Called once per display frame. */
  frame() {
    this.mem[IO.TICK] = (this.mem[IO.TICK] + 1) & 0xff;
  }

  regIndex(ref) {
    const i = ref.kind === "rd" ? this.opr >> 4 : ref.kind === "rs" ? this.opr & 15 : ref.index;
    if (i >= REGISTERS.length) throw new CpuFault(`register ${ref.kind} = ${i} does not exist (OPR = ${hex(this.opr, 2)})`);
    return i;
  }

  ptr(p) {
    return p === "HL" ? this.hl : this.w;
  }

  cond(c) {
    switch (c) {
      case null: return true;
      case "Z": return this.z;
      case "NZ": return !this.z;
      case "C": return this.c;
      case "NC": return !this.c;
      case "N": return this.n;
      case "NN": return !this.n;
    }
    return false;
  }

  applyAlu(op, a, b, setFlags) {
    const res = alu(op, a, b);
    this.a = a;
    this.y = res.y;
    if (setFlags !== false) {
      this.z = res.z;
      this.c = res.c;
      this.n = res.n;
    }
    this.lastAlu = { op, a, b, y: res.y };
    return res.y;
  }

  snapshot() {
    return {
      r: Array.from(this.r), pc: this.pc, sp: this.sp, ir: this.ir, opr: this.opr, t: this.t, w: this.w,
      mar: this.mar, mdr: this.mdr, a: this.a, y: this.y, z: this.z, c: this.c, n: this.n,
      halted: this.halted, fault: this.fault, instructions: this.instructions, rng: this.rng,
    };
  }

  restore(s) {
    this.r.set(s.r);
    for (const k of Object.keys(s)) if (k !== "r") this[k] = s[k];
  }
}

// ---------- instruction interpreter (Turbo and Step instr) ----------

function execMicro(cpu, m) {
  switch (m.k) {
    case "REG":
      cpu.opr = cpu.read(cpu.pc);
      cpu.pc = (cpu.pc + 1) & 0xffff;
      return;
    case "IMM8":
      cpu.t = cpu.read(cpu.pc);
      cpu.pc = (cpu.pc + 1) & 0xffff;
      return;
    case "IMM16": {
      const lo = cpu.read(cpu.pc);
      const hi = cpu.read((cpu.pc + 1) & 0xffff);
      cpu.w = lo | (hi << 8);
      cpu.pc = (cpu.pc + 2) & 0xffff;
      return;
    }
    case "SET": cpu.r[cpu.regIndex(m.d)] = cpu.t; return;
    case "COPY": cpu.r[cpu.regIndex(m.d)] = cpu.r[cpu.regIndex(m.s)]; return;
    case "LOAD": cpu.r[cpu.regIndex(m.d)] = cpu.read(cpu.ptr(m.ptr)); return;
    case "STORE": cpu.write(cpu.ptr(m.ptr), cpu.r[cpu.regIndex(m.s)]); return;
    case "SETHL": cpu.hl = cpu.w; return;
    case "INCHL": cpu.hl = (cpu.hl + 1) & 0xffff; return;
    case "ALU": {
      const d = cpu.regIndex(m.d);
      const b = m.s ? cpu.r[cpu.regIndex(m.s)] : 0;
      const y = cpu.applyAlu(m.op, cpu.r[d], b);
      if (m.op !== "CMP") cpu.r[d] = y;
      return;
    }
    case "JUMP": if (cpu.cond(m.cond)) cpu.pc = cpu.w; return;
    case "PUSH":
      cpu.sp = (cpu.sp - 1) & 0xffff;
      cpu.write(cpu.sp, cpu.r[cpu.regIndex(m.s)]);
      return;
    case "POP":
      cpu.r[cpu.regIndex(m.d)] = cpu.read(cpu.sp);
      cpu.sp = (cpu.sp + 1) & 0xffff;
      return;
    case "PUSHPC":
      cpu.sp = (cpu.sp - 1) & 0xffff;
      cpu.write(cpu.sp, cpu.pc >> 8);
      cpu.sp = (cpu.sp - 1) & 0xffff;
      cpu.write(cpu.sp, cpu.pc & 0xff);
      return;
    case "POPPC": {
      const lo = cpu.read(cpu.sp);
      cpu.sp = (cpu.sp + 1) & 0xffff;
      const hi = cpu.read(cpu.sp);
      cpu.sp = (cpu.sp + 1) & 0xffff;
      cpu.pc = lo | (hi << 8);
      return;
    }
    case "HALT": cpu.halted = true; return;
  }
}

/** Fetches, decodes and executes one instruction. Returns false if the CPU is stopped. */
function stepInstruction(cpu, table) {
  if (cpu.halted) return false;
  try {
    cpu.ir = cpu.read(cpu.pc);
    cpu.pc = (cpu.pc + 1) & 0xffff;
    const row = table.byOp[cpu.ir];
    if (!row) throw new CpuFault(`illegal opcode ${hex(cpu.ir, 2)} at ${hex((cpu.pc - 1) & 0xffff, 4)}`);
    for (const m of row.micro) execMicro(cpu, m);
    cpu.instructions++;
    return true;
  } catch (e) {
    if (!(e instanceof CpuFault)) throw e;
    cpu.halted = true;
    cpu.fault = e.message;
    return false;
  }
}

function runInstructions(cpu, table, max) {
  let i = 0;
  while (i < max && stepInstruction(cpu, table)) i++;
  return i;
}
