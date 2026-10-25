"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value2) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value: value2 }) : obj[key] = value2;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/isa/programs/copy.asm
  var copy_default = "; copy.asm \u2014 copy a byte through two pointers, then read it back: OUT shows 5A, then HLT.\n\n        LDI R1, src     ; R1 \u2192 source byte\n        LDI R2, dst     ; R2 \u2192 destination byte\n        LDR R0, [R1]    ; R0 \u2190 mem[src]\n        STR R0, [R2]    ; mem[dst] \u2190 R0\n        LDR R3, [R2]    ; read the copy back\n        ST R3, [OUT]\n        HLT\nsrc:    .db 0x5A\ndst:    .db 0\n";

  // src/isa/programs/count.asm
  var count_default = "; count.asm \u2014 OUT shows 1, 2, 3, \u2026 forever (after FF it wraps to 00).\n; One pass is 20 T-states: ADD 6 + ST 8 + JMP 6.\n\n        LDI R0, 0       ; R0 = counter\n        LDI R1, 1       ; R1 = step\nloop:   ADD R0, R1      ; R0 = R0 + 1\n        ST R0, [OUT]    ; show it\n        JMP loop\n";

  // src/isa/programs/dump.asm
  var dump_default = "; dump.asm \u2014 walk memory with a pointer: OUT shows the bytes at 0, 1, 2, \u2026 (this program's own\n; machine code first), forever. The pointer wraps around the 16 bytes of RAM.\n\n        LDI R1, 0       ; R1 = pointer\n        LDI R3, 1\nloop:   LDR R0, [R1]    ; R0 \u2190 mem[R1]\n        ST R0, [OUT]\n        ADD R1, R3      ; next address\n        JMP loop\n";

  // src/isa/programs/fib.asm
  var fib_default = "; fib.asm \u2014 Fibonacci numbers on OUT until the next one overflows a byte (carry), then HLT.\n; OUT: 1 1 2 3 5 8 13 21 34 55 89 144 233  (hex 01 01 02 03 05 08 0D 15 22 37 59 90 E9)\n\n        LDI R0, 0       ; R0 = a\n        LDI R1, 1       ; R1 = b\nloop:   ST R1, [OUT]    ; show b\n        MOV R2, R1      ; t = b\n        ADD R1, R0      ; b = a + b\n        JC done         ; more than 255: stop\n        MOV R0, R2      ; a = t\n        JMP loop\ndone:   HLT\n";

  // src/isa/programs/logic.asm
  var logic_default = "; logic.asm \u2014 bitwise ops on 0F and 3C; OUT shows 33, 30, 3C (hex), then HLT.\n; (NOT is XOR with FF; its opcode now holds LDR.)\n\n        LDI R0, 0x0F    ; R0 = 0000 1111\n        LDI R1, 0x3C    ; R1 = 0011 1100\n        XOR R0, R1      ; R0 = 0011 0011 = 33\n        ST R0, [OUT]\n        AND R0, R1      ; R0 = 0011 0000 = 30\n        ST R0, [OUT]\n        OR R0, R1       ; R0 = 0011 1100 = 3C\n        ST R0, [OUT]\n        HLT\n";

  // src/isa/programs/mem.asm
  var mem_default = "; mem.asm \u2014 LD / ST on data bytes: z = x + y, read back; OUT shows 42 (hex), then HLT.\n\n        LD R0, [x]      ; R0 = 12\n        LD R1, [y]      ; R1 = 30\n        ADD R0, R1      ; R0 = 42\n        ST R0, [z]      ; z = 42\n        LD R2, [z]      ; read it back\n        ST R2, [OUT]\n        HLT\nx:      .db 0x12\ny:      .db 0x30\nz:      .db 0\n";

  // src/isa/programs/mul.asm
  var mul_default = '; mul.asm \u2014 6 \xD7 7 = 42 by repeated addition; OUT shows 2A (= 42), then HLT.\n; There is no "jump if not zero": the loop repeats while SUB does not borrow (C = 1).\n\n        LDI R0, 0       ; R0 = product\n        LDI R1, 6       ; R1 = multiplicand\n        LDI R2, 7-1     ; R2 = passes left after this one (7 in all)\n        LDI R3, 1\nloop:   ADD R0, R1      ; product += 6\n        SUB R2, R3      ; R2 -= 1; C = 1 (no borrow) unless R2 was 0\n        JC loop\n        ST R0, [OUT]    ; OUT = 42\n        HLT\n';

  // src/isa/programs/ptrout.asm
  var ptrout_default = "; ptrout.asm \u2014 STR through a pointer: R1 holds the OUT address, so OUT shows 7 6 5 \u2026 0.\n\n        LDI R0, 7\n        LDI R1, OUT     ; R1 = 15, a pointer to the OUT port\n        LDI R2, 1\nloop:   STR R0, [R1]    ; mem[R1] \u2190 R0  (shows it on OUT)\n        SUB R0, R2\n        JC loop         ; until 0 - 1 borrows\n        HLT\n";

  // src/isa/programs/sub.asm
  var sub_default = "; sub.asm \u2014 count down 5 4 3 2 1 0 on OUT; stop once SUB borrows (C = 0).\n\n        LDI R0, 5\n        LDI R1, 1\nloop:   ST R0, [OUT]    ; show R0\n        SUB R0, R1      ; R0 -= 1   (C = 1: no borrow; 0 - 1 borrows, C = 0)\n        JC loop\n        HLT\n";

  // src/isa/programs/pow2.asm
  var pow2_default = "; pow2.asm \u2014 OUT shows 01 02 04 08 10 20 40 80 (a bit marching left), then HLT when it falls off the end.\n; ADD R0, R0 doubles R0; the carry flag catches the doubling of 80.\n\n        LDI R0, 1\nloop:   ST R0, [OUT]    ; show it\n        ADD R0, R0      ; R0 *= 2 (C = 1 once 0x80 doubles to 0x100)\n        JC done\n        JMP loop\ndone:   HLT\n";

  // src/isa/programs/triangle.asm
  var triangle_default = "; triangle.asm \u2014 triangular numbers on OUT: 1 3 6 10 15 21 28 \u2026 253, then HLT when the next would overflow.\n; n counts 1, 2, 3 \u2026; sum += n each pass.\n\n        LDI R0, 0       ; R0 = sum\n        LDI R1, 0       ; R1 = n\n        LDI R2, 1       ; R2 = the constant 1\nloop:   ADD R1, R2      ; n += 1\n        ADD R0, R1      ; sum += n   (C = 1 means it passed 255)\n        JC done\n        ST R0, [OUT]    ; show it\n        JMP loop\ndone:   HLT\n";

  // src/isa/programs/mod.asm
  var mod_default = "; mod.asm \u2014 100 mod 7 = 2 by repeated subtraction; OUT shows 02, then HLT.\n; SUB keeps C = 1 while it does not borrow; the loop runs one subtraction too far, ADD puts it back.\n\n        LDI R0, 100     ; dividend\n        LDI R2, 7       ; divisor\nloop:   SUB R0, R2\n        JC loop         ; no borrow yet: subtract again\n        ADD R0, R2      ; undo the last (borrowing) subtraction: the remainder\n        ST R0, [OUT]\n        HLT\n";

  // src/isa/programs/blink.asm
  var blink_default = "; blink.asm \u2014 OUT flips between AA and 55 forever: all eight lamps and both digits flash.\n\n        LDI R0, 0xAA\n        LDI R1, 0x55\nloop:   ST R0, [OUT]\n        ST R1, [OUT]\n        JMP loop\n";

  // src/isa/programs/lfsr.asm
  var lfsr_default = "; lfsr.asm \u2014 a pseudo-random byte generator on OUT: an 8-bit Galois LFSR (polynomial 0x11D), period 255.\n; Shift left; when a 1 falls out of bit 7, XOR the feedback mask 0x1D back in. Starts 01 02 04 08 10 20 40 80 1D 3A \u2026\n\n        LDI R0, 1       ; state (never 0)\n        LDI R3, 0x1D    ; feedback mask\nloop:   ST R0, [OUT]\n        ADD R0, R0      ; shift left; C = the bit that fell out\n        JC fb\n        JMP loop\nfb:     XOR R0, R3\n        JMP loop\n";

  // src/isa/programs/echo.asm
  var echo_default = "; echo.asm \u2014 OUT mirrors the input byte forever. RAM[14] is the memory-mapped input register:\n; the plugin clock writes the panel's input byte there between ticks (plugin/src/devices.ts).\n; 6 bytes; byte 14 must stay free (input) and 15 is OUT.\n\nloop:   LD R0, [14]     ; R0 = input byte\n        ST R0, [OUT]    ; show it\n        JMP loop\n";

  // src/isa/programs/keypad.asm
  var keypad_default = "; keypad.asm \u2014 adds every key pressed into R1 and shows the running sum on OUT.\n; RAM[14] is the memory-mapped input register (written by the plugin clock, devices.ts).\n; A nonzero byte there is a key: it is added once, then consumed (RAM[14] \u2190 0), so pressing\n; the same key twice adds it twice. R2 is never written, so it stays 0. 12 bytes.\n\nloop:   LD R0, [14]     ; R0 = input byte\n        OR R0, R0       ; set Z from R0 (LD sets no flags)\n        JZ loop         ; no key: keep polling\n        ST R2, [14]     ; consume the key (R2 = 0)\n        ADD R1, R0      ; R1 = running sum\n        ST R1, [OUT]    ; show it\n        JMP loop\n";

  // src/isa/spec.ts
  var RAM_ADDR_BITS = 4;
  var RAM_BYTES = 1 << RAM_ADDR_BITS;
  var OUT_ADDR = RAM_BYTES - 1;
  var REGISTERS = ["R0", "R1", "R2", "R3"];
  var SIGNALS = [
    "PC_OUT",
    // PC → bus[0:3] (bus[4:7] = 0)
    "MDR_OUT",
    // MDR → bus
    "REG_OUT_D",
    // register[IR.Rd] → bus
    "REG_OUT_S",
    // register[IR.Rs] → bus
    "Y_OUT",
    // Y latch (ALU result) → bus
    "MAR_LOAD",
    // MAR ← bus[0:3]
    "IR_LOAD",
    // IR ← bus
    "MDR_LOAD",
    // MDR ← bus
    "REG_LOAD_D",
    // register[IR.Rd] ← bus
    "A_LOAD",
    // A latch (ALU input 1) ← bus
    "PC_LOAD",
    // PC ← bus[0:3]
    "PC_INC",
    // PC ← PC + 1
    "MEM_READ",
    // MDR ← RAM[MAR]
    "MEM_WRITE",
    // RAM[MAR] ← MDR (and OUT ← MDR when MAR = OUT_ADDR)
    "Y_LOAD",
    // Y ← ALU(A latch, bus)
    "FLAGS_LOAD",
    // Z C N ← ALU flags
    "T_RESET",
    // next T-state is T0 (end of instruction)
    "HALT"
    // stop: HALTED flip-flop set, all signals forced off
  ];
  var BUS_DRIVERS = ["PC_OUT", "MDR_OUT", "REG_OUT_D", "REG_OUT_S", "Y_OUT"];
  var ALU_SEL = { ADD: 0, SUB: 0, AND: 1, OR: 2, XOR: 3, NOT: 4 };
  var FETCH = [
    { t: 0, signals: ["PC_OUT", "MAR_LOAD"] },
    { t: 1, signals: ["MEM_READ", "PC_INC"] },
    { t: 2, signals: ["MDR_OUT", "IR_LOAD"] }
  ];
  var OPERAND = [
    { t: 3, signals: ["PC_OUT", "MAR_LOAD"] },
    { t: 4, signals: ["MEM_READ", "PC_INC"] }
  ];
  var aluOp = (code, mnem, doc) => ({
    code,
    mnem,
    operands: ["Rd", "Rs"],
    alu: { sel: ALU_SEL[mnem], sub: mnem === "SUB" },
    steps: [
      { t: 3, signals: ["REG_OUT_D", "A_LOAD"] },
      { t: 4, signals: ["REG_OUT_S", "Y_LOAD", "FLAGS_LOAD"] },
      { t: 5, signals: ["Y_OUT", "REG_LOAD_D", "T_RESET"] }
    ],
    doc
  });
  var jump = (code, mnem, flag, doc) => ({
    code,
    mnem,
    operands: ["addr"],
    steps: [
      ...OPERAND,
      flag ? { t: 5, signals: ["T_RESET"], when: { flag, signals: ["MDR_OUT", "PC_LOAD"] } } : { t: 5, signals: ["MDR_OUT", "PC_LOAD", "T_RESET"] }
    ],
    doc
  });
  var OPCODES = [
    { code: 0, mnem: "NOP", operands: [], steps: [{ t: 3, signals: ["T_RESET"] }], doc: "no operation" },
    {
      code: 1,
      mnem: "LDI",
      operands: ["Rd", "imm"],
      steps: [...OPERAND, { t: 5, signals: ["MDR_OUT", "REG_LOAD_D", "T_RESET"] }],
      doc: "Rd \u2190 n"
    },
    {
      code: 2,
      mnem: "LD",
      operands: ["Rd", "addr"],
      steps: [
        ...OPERAND,
        { t: 5, signals: ["MDR_OUT", "MAR_LOAD"] },
        { t: 6, signals: ["MEM_READ"] },
        { t: 7, signals: ["MDR_OUT", "REG_LOAD_D", "T_RESET"] }
      ],
      doc: "Rd \u2190 mem[a]"
    },
    {
      code: 3,
      mnem: "ST",
      operands: ["Rs", "addr"],
      steps: [
        ...OPERAND,
        { t: 5, signals: ["MDR_OUT", "MAR_LOAD"] },
        { t: 6, signals: ["REG_OUT_S", "MDR_LOAD"] },
        { t: 7, signals: ["MEM_WRITE", "T_RESET"] }
      ],
      doc: "mem[a] \u2190 Rs (a = 15 also shows it on the OUT display)"
    },
    {
      code: 4,
      mnem: "MOV",
      operands: ["Rd", "Rs"],
      steps: [{ t: 3, signals: ["REG_OUT_S", "REG_LOAD_D", "T_RESET"] }],
      doc: "Rd \u2190 Rs"
    },
    aluOp(5, "ADD", "Rd \u2190 Rd + Rs (Z C N)"),
    aluOp(6, "SUB", "Rd \u2190 Rd \u2212 Rs (Z C N; C = 1 means no borrow)"),
    aluOp(7, "AND", "Rd \u2190 Rd AND Rs (Z N, C = 0)"),
    aluOp(8, "OR", "Rd \u2190 Rd OR Rs (Z N, C = 0)"),
    aluOp(9, "XOR", "Rd \u2190 Rd XOR Rs (Z N, C = 0)"),
    {
      code: 10,
      mnem: "LDR",
      operands: ["Rd", "[Rs]"],
      steps: [
        { t: 3, signals: ["REG_OUT_S", "MAR_LOAD"] },
        { t: 4, signals: ["MEM_READ"] },
        { t: 5, signals: ["MDR_OUT", "REG_LOAD_D", "T_RESET"] }
      ],
      doc: "Rd \u2190 mem[Rs] (load through a pointer; flags unchanged)"
    },
    jump(11, "JMP", null, "PC \u2190 a"),
    jump(12, "JZ", "Z", "if Z: PC \u2190 a"),
    jump(13, "JC", "C", "if C: PC \u2190 a"),
    {
      code: 14,
      mnem: "STR",
      operands: ["Rs", "[Rd]"],
      steps: [
        { t: 3, signals: ["REG_OUT_D", "MAR_LOAD"] },
        { t: 4, signals: ["REG_OUT_S", "MDR_LOAD"] },
        { t: 5, signals: ["MEM_WRITE", "T_RESET"] }
      ],
      doc: "mem[Rd] \u2190 Rs (store through a pointer; Rd = 15 also shows it on the OUT display)"
    },
    { code: 15, mnem: "HLT", operands: [], steps: [{ t: 3, signals: ["HALT", "T_RESET"] }], doc: "stop the clock" }
  ];
  function microcode(op) {
    return [...FETCH, ...op.steps];
  }

  // src/isa/asm.ts
  var PREDEFINED_SYMBOLS = { OUT: OUT_ADDR };
  var BY_MNEM = new Map(OPCODES.map((o) => [o.mnem, o]));
  var ADDR_MASK = RAM_BYTES - 1;
  var AsmFail = class extends Error {
  };
  var isData = (kind) => kind === "imm" || kind === "addr";
  var usage = (op) => [op.mnem, op.operands.join(", ")].filter(Boolean).join(" ");
  var writesMemory = (op) => op.steps.some((s) => s.signals.includes("MEM_WRITE"));
  var loadsPc = (op) => op.steps.some((s) => {
    var _a;
    return s.signals.includes("PC_LOAD") || !!((_a = s.when) == null ? void 0 : _a.signals.includes("PC_LOAD"));
  });
  function regIndex(s) {
    return REGISTERS.indexOf(s.trim().toUpperCase());
  }
  var CHAR = /^'(\\.|[^\\'])'/;
  var ESCAPES = { n: 10, r: 13, t: 9, "0": 0 };
  function lex(src) {
    var _a;
    const out = [];
    let i = 0;
    while (i < src.length) {
      if (/\s/.test(src[i])) {
        i++;
        continue;
      }
      const rest = src.slice(i);
      let m;
      if (m = rest.match(/^0x[0-9a-f]+/i)) out.push({ t: "num", v: parseInt(m[0].slice(2), 16) });
      else if (m = rest.match(/^0b[01]+/i)) out.push({ t: "num", v: parseInt(m[0].slice(2), 2) });
      else if (m = rest.match(/^[0-9]+/)) out.push({ t: "num", v: parseInt(m[0], 10) });
      else if (m = rest.match(CHAR)) {
        const c = m[1];
        out.push({ t: "num", v: c.length === 2 ? (_a = ESCAPES[c[1]]) != null ? _a : c.charCodeAt(1) : c.charCodeAt(0) });
      } else if (m = rest.match(/^[A-Za-z_]\w*/)) out.push({ t: "id", v: m[0] });
      else if (m = rest.match(/^[-+()]/)) out.push({ t: "op", v: m[0] });
      else throw new AsmFail(`unexpected "${src[i]}" in "${src.trim()}"`);
      i += m[0].length;
    }
    return out;
  }
  function evaluate(src, symbols) {
    const toks = lex(src);
    if (toks.length === 0) throw new AsmFail("missing value");
    let p = 0;
    const term = () => {
      var _a;
      const tok = toks[p++];
      if (!tok) throw new AsmFail(`incomplete expression "${src.trim()}"`);
      if (tok.t === "num") return tok.v;
      if (tok.t === "id") {
        const v2 = symbols.get(tok.v);
        if (v2 !== void 0) return v2;
        const near = [...symbols.keys()].find((k) => k.toLowerCase() === tok.v.toLowerCase());
        throw new AsmFail(`unknown symbol "${tok.v}"${near ? ` (did you mean "${near}"?)` : ""}`);
      }
      if (tok.v === "(") {
        const v2 = sum();
        if (((_a = toks[p++]) == null ? void 0 : _a.v) !== ")") throw new AsmFail(`missing ")" in "${src.trim()}"`);
        return v2;
      }
      if (tok.v === "-") return -term();
      if (tok.v === "+") return term();
      throw new AsmFail(`unexpected "${tok.v}" in "${src.trim()}"`);
    };
    const sum = () => {
      let v2 = term();
      for (let tok = toks[p]; (tok == null ? void 0 : tok.t) === "op" && (tok.v === "+" || tok.v === "-"); tok = toks[p]) {
        p++;
        v2 = tok.v === "+" ? v2 + term() : v2 - term();
      }
      return v2;
    };
    const v = sum();
    if (p < toks.length) throw new AsmFail(`unexpected "${toks[p].v}" in "${src.trim()}"`);
    return v;
  }
  function scan(s, visit) {
    for (let i = 0; i < s.length; i++) {
      const lit3 = s[i] === "'" ? s.slice(i).match(CHAR) : null;
      if (lit3) i += lit3[0].length - 1;
      else if (visit(s[i], i)) return;
    }
  }
  function stripComment(line) {
    let end = line.length;
    scan(line, (ch, i) => {
      if (ch !== ";") return false;
      end = i;
      return true;
    });
    return line.slice(0, end);
  }
  function splitOperands(s) {
    if (!s.trim()) return [];
    const out = [];
    let depth = 0;
    let start = 0;
    scan(s, (ch, i) => {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (ch === "," && depth === 0) {
        out.push(s.slice(start, i).trim());
        start = i + 1;
      }
    });
    out.push(s.slice(start).trim());
    return out;
  }
  function parse(raw, line) {
    var _a;
    const st = { line, args: [], addr: 0, ok: true };
    let s = stripComment(raw).trim();
    const lm = s.match(/^([A-Za-z_]\w*)\s*:/);
    if (lm) {
      st.label = lm[1];
      s = s.slice(lm[0].length).trim();
    }
    if (!s) return st;
    const om = s.match(/^(\.?[A-Za-z_]\w*)(?:\s+(.*))?$/);
    if (!om) throw new AsmFail(`cannot parse "${s}"`);
    st.op = om[1];
    st.args = splitOperands((_a = om[2]) != null ? _a : "");
    return st;
  }
  function value(arg, symbols, what) {
    if (regIndex(arg) >= 0) throw new AsmFail(`expected ${what}, got register ${arg.trim().toUpperCase()}`);
    return evaluate(arg, symbols);
  }
  function byte(arg, symbols) {
    const v = value(arg, symbols, "a value");
    if (v < -128 || v > 255) throw new AsmFail(`${v} does not fit in a byte (-128..255)`);
    return v & 255;
  }
  function encode(op, args, symbols) {
    let first = op.code << 4;
    const rest = [];
    op.operands.forEach((kind, i) => {
      const arg = args[i];
      if (kind === "Rd" || kind === "Rs") {
        const r = regIndex(arg);
        if (r < 0) throw new AsmFail(`${usage(op)}: expected a register (${REGISTERS.join(" ")}), got "${arg}"`);
        first |= kind === "Rd" ? r << 2 : r;
      } else if (kind === "[Rd]" || kind === "[Rs]") {
        const inner = /^\[(.*)\]$/.exec(arg.trim());
        const r = inner ? regIndex(inner[1]) : -1;
        if (r < 0) throw new AsmFail(`${usage(op)}: expected a register in brackets, like [R1], got "${arg}"`);
        first |= kind === "[Rd]" ? r << 2 : r;
      } else if (kind === "imm") {
        if (/^\[.*\]$/.test(arg)) throw new AsmFail(`${usage(op)}: ${arg} is a memory operand, ${op.mnem} takes a value`);
        rest.push(byte(arg, symbols));
      } else {
        const bare = /^\[.*\]$/.test(arg) ? arg.slice(1, -1) : arg;
        const a = value(bare, symbols, "an address");
        if (a < 0 || a > ADDR_MASK) throw new AsmFail(`address ${a} is outside RAM (0..${ADDR_MASK})`);
        rest.push(a);
      }
    });
    return [first, ...rest];
  }
  function sizeOf(st) {
    const dir = st.op.toLowerCase();
    if (dir === ".db") {
      if (!st.args.length) throw new AsmFail(".db expects at least one value");
      return st.args.length;
    }
    if (dir.startsWith(".")) throw new AsmFail(`unknown directive "${st.op}" (use .org or .db)`);
    const op = BY_MNEM.get(st.op.toUpperCase());
    if (!op) throw new AsmFail(`unknown instruction "${st.op}"`);
    if (st.args.length !== op.operands.length) {
      const n = op.operands.length;
      throw new AsmFail(`${usage(op)}: expects ${n} operand${n === 1 ? "" : "s"}, got ${st.args.length}`);
    }
    return 1 + op.operands.filter(isData).length;
  }
  function assemble(src) {
    var _a;
    const errors = [];
    const warnings = [];
    const symbols = new Map(Object.entries(PREDEFINED_SYMBOLS));
    const labelLine = /* @__PURE__ */ new Map();
    const report = (line, e) => {
      if (!(e instanceof AsmFail)) throw e;
      errors.push({ line, msg: e.message });
    };
    const stmts = src.split(/\r?\n/).map((raw, i) => {
      try {
        return parse(raw, i + 1);
      } catch (e) {
        report(i + 1, e);
        return { line: i + 1, args: [], addr: 0, ok: false };
      }
    });
    const define2 = (st, name, at) => {
      if (regIndex(name) >= 0) throw new AsmFail(`"${name}" is a register name`);
      if (name in PREDEFINED_SYMBOLS) throw new AsmFail(`"${name}" is predefined (= ${PREDEFINED_SYMBOLS[name]})`);
      if (labelLine.has(name)) throw new AsmFail(`label "${name}" is already defined on line ${labelLine.get(name)}`);
      symbols.set(name, at);
      labelLine.set(name, st.line);
    };
    let pc = 0;
    let end = 0;
    const tooFar = [];
    for (const st of stmts) {
      if (!st.ok) continue;
      const isOrg = ((_a = st.op) == null ? void 0 : _a.toLowerCase()) === ".org";
      if (isOrg) {
        try {
          if (st.args.length !== 1) throw new AsmFail(".org expects one address");
          const a = evaluate(st.args[0], symbols);
          if (a < 0 || a > ADDR_MASK) throw new AsmFail(`.org ${a} is outside RAM (0..${ADDR_MASK})`);
          pc = a;
        } catch (e) {
          report(st.line, e);
          st.ok = false;
        }
      }
      if (st.label) {
        try {
          define2(st, st.label, pc);
        } catch (e) {
          report(st.line, e);
        }
      }
      if (!st.op || isOrg || !st.ok) continue;
      try {
        const size = sizeOf(st);
        st.addr = pc;
        pc += size;
        end = Math.max(end, pc);
        if (pc > RAM_BYTES) {
          tooFar.push(st);
          st.ok = false;
        }
      } catch (e) {
        report(st.line, e);
        st.ok = false;
      }
    }
    if (tooFar.length)
      errors.push({
        line: tooFar[0].line,
        msg: `program needs ${end} bytes but RAM has ${RAM_BYTES} (0..${ADDR_MASK}); this is the first line that does not fit`
      });
    const bytes = new Array(RAM_BYTES).fill(0);
    const owner = new Array(RAM_BYTES);
    const lineAddr = {};
    let storesToOut = false;
    for (const st of stmts) {
      if (!st.ok || !st.op || st.op.toLowerCase() === ".org") continue;
      try {
        const op = BY_MNEM.get(st.op.toUpperCase());
        const out = op ? encode(op, st.args, symbols) : st.args.map((a) => byte(a, symbols));
        out.forEach((_, i) => {
          const prev = owner[st.addr + i];
          if (prev !== void 0) throw new AsmFail(`address ${st.addr + i} is already used by line ${prev}`);
        });
        out.forEach((b, i) => {
          bytes[st.addr + i] = b;
          owner[st.addr + i] = st.line;
        });
        lineAddr[st.line] = st.addr;
        if (op && writesMemory(op))
          op.operands.filter(isData).forEach((kind, i) => {
            if (kind === "addr" && out[1 + i] === OUT_ADDR) storesToOut = true;
          });
      } catch (e) {
        report(st.line, e);
      }
    }
    const atOut = owner[OUT_ADDR];
    if (storesToOut && atOut !== void 0)
      warnings.push({
        line: atOut,
        msg: `address ${OUT_ADDR} is the OUT port: storing to [OUT] overwrites the byte placed here`
      });
    errors.sort((a, b) => a.line - b.line);
    return { ok: errors.length === 0, bytes, errors, warnings, symbols: Object.fromEntries(symbols), lineAddr };
  }
  function disassemble(ram, addr = 0) {
    const at = (a) => {
      var _a;
      return ((_a = ram[a & ADDR_MASK]) != null ? _a : 0) & 255;
    };
    const b = at(addr);
    const op = OPCODES[b >> 4];
    let next = addr + 1;
    const args = op.operands.map((kind) => {
      switch (kind) {
        case "Rd":
          return REGISTERS[b >> 2 & 3];
        case "Rs":
          return REGISTERS[b & 3];
        case "[Rd]":
          return `[${REGISTERS[b >> 2 & 3]}]`;
        case "[Rs]":
          return `[${REGISTERS[b & 3]}]`;
        case "imm":
          return String(at(next++));
        case "addr": {
          const a = at(next++) & ADDR_MASK;
          if (loadsPc(op)) return String(a);
          return a === OUT_ADDR ? "[OUT]" : `[${a}]`;
        }
      }
    });
    return { text: [op.mnem, args.join(", ")].filter(Boolean).join(" "), size: next - addr };
  }

  // src/isa/model.ts
  var ADDR_MASK2 = RAM_BYTES - 1;

  // src/isa/index.ts
  var PROGRAMS = { count: count_default, mul: mul_default, fib: fib_default, sub: sub_default, logic: logic_default, mem: mem_default, pow2: pow2_default, triangle: triangle_default, mod: mod_default, blink: blink_default, lfsr: lfsr_default, echo: echo_default, keypad: keypad_default, ptrout: ptrout_default, copy: copy_default, dump: dump_default };

  // src/netlist/types.ts
  var GATE_TYPES = ["BUF", "NOT", "AND", "OR", "NAND", "NOR", "XOR", "XNOR"];
  var GATE_ARITY = {
    BUF: 1,
    NOT: 1,
    AND: 2,
    OR: 2,
    NAND: 2,
    NOR: 2,
    XOR: 2,
    XNOR: 2
  };
  var GATE_PREFIX = "gate/";
  var isGateCell = (cell) => cell.startsWith(GATE_PREFIX);
  var gateTypeOf = (cell) => cell.slice(GATE_PREFIX.length);
  function evalGate(type, a, b) {
    switch (type) {
      case "BUF":
        return a ? 1 : 0;
      case "NOT":
        return a ? 0 : 1;
      case "AND":
        return a && b ? 1 : 0;
      case "OR":
        return a || b ? 1 : 0;
      case "NAND":
        return a && b ? 0 : 1;
      case "NOR":
        return a || b ? 0 : 1;
      case "XOR":
        return (a ? 1 : 0) ^ (b ? 1 : 0) ? 1 : 0;
      case "XNOR":
        return (a ? 1 : 0) ^ (b ? 1 : 0) ? 0 : 1;
    }
  }
  var CONST0 = "0";
  var CONST1 = "1";
  function gatePorts(type) {
    return GATE_ARITY[type] === 1 ? [
      { name: "A", dir: "in", width: 1 },
      { name: "Y", dir: "out", width: 1 }
    ] : [
      { name: "A", dir: "in", width: 1 },
      { name: "B", dir: "in", width: 1 },
      { name: "Y", dir: "out", width: 1 }
    ];
  }
  function portBits(p) {
    return p.width === 1 ? [p.name] : Array.from({ length: p.width }, (_, i) => `${p.name}[${i}]`);
  }
  var NET0 = 0;
  var NET1 = 1;

  // src/compile/schedule.ts
  var CompileError = class extends Error {
  };
  var CODE = { BUF: 0, NOT: 1, AND: 2, OR: 3, NAND: 4, NOR: 5, XOR: 6, XNOR: 7 };
  var [BUF, NOT, AND, OR, NAND, NOR, XOR] = [0, 1, 2, 3, 4, 5, 6];
  function gateArrays(net, order) {
    const n = order ? order.length : net.gates.length;
    const out = { t: new Uint8Array(n), a: new Int32Array(n), b: new Int32Array(n), y: new Int32Array(n) };
    for (let k = 0; k < n; k++) {
      const g = net.gates[order ? order[k] : k];
      out.t[k] = CODE[g.type];
      out.a[k] = g.in[0];
      out.b[k] = g.in.length > 1 ? g.in[1] : g.in[0];
      out.y[k] = g.out;
    }
    return out;
  }
  function evalBit(t, a, b) {
    switch (t) {
      case BUF:
        return a;
      case NOT:
        return a ^ 1;
      case AND:
        return a & b;
      case OR:
        return a | b;
      case NAND:
        return a & b ^ 1;
      case NOR:
        return (a | b) ^ 1;
      case XOR:
        return a ^ b;
      default:
        return a ^ b ^ 1;
    }
  }
  var X = -1;
  function eval3(t, a, b) {
    switch (t) {
      case BUF:
        return a;
      case NOT:
        return a === X ? X : a ^ 1;
      case AND:
        return a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : X;
      case OR:
        return a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : X;
      case NAND:
        return a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : X;
      case NOR:
        return a === 1 || b === 1 ? 0 : a === 0 && b === 0 ? 1 : X;
      case XOR:
        return a === X || b === X ? X : a ^ b;
      default:
        return a === X || b === X ? X : a ^ b ^ 1;
    }
  }
  function constants(g, rs, rd, nNets, clk, level) {
    const k = new Int8Array(nNets).fill(X);
    const rank = new Int32Array(nNets);
    k[NET0] = 0;
    k[NET1] = 1;
    if (clk >= 0) k[clk] = level;
    const n = g.t.length;
    if (n === 0) return { k, rank };
    const queue = new Int32Array(n);
    const queued = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) queue[i] = i;
    let head = 0;
    let size = n;
    let next = 1;
    while (size > 0) {
      const i = queue[head];
      head = (head + 1) % n;
      size--;
      queued[i] = 0;
      const y = g.y[i];
      if (k[y] !== X) continue;
      const v = eval3(g.t[i], k[g.a[i]], k[g.b[i]]);
      if (v === X) continue;
      k[y] = v;
      rank[y] = next++;
      for (let e = rs[y]; e < rs[y + 1]; e++) {
        const r = rd[e];
        if (!queued[r] && k[g.y[r]] === X) {
          queued[r] = 1;
          queue[(head + size) % n] = r;
          size++;
        }
      }
    }
    return { k, rank };
  }
  function tarjan(n, p0, p1) {
    const start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      if (p0[i] >= 0) start[p0[i] + 1]++;
      if (p1[i] >= 0) start[p1[i] + 1]++;
    }
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const succ = new Int32Array(start[n]);
    const fill = start.slice(0, n);
    for (let i = 0; i < n; i++) {
      if (p0[i] >= 0) succ[fill[p0[i]]++] = i;
      if (p1[i] >= 0) succ[fill[p1[i]]++] = i;
    }
    const index = new Int32Array(n).fill(-1);
    const low = new Int32Array(n);
    const comp = new Int32Array(n).fill(-1);
    const onStack = new Uint8Array(n);
    const stack = new Int32Array(n);
    const call = new Int32Array(n);
    const edge = new Int32Array(n);
    let sp = 0;
    let cp = 0;
    let idx = 0;
    let count = 0;
    for (let s = 0; s < n; s++) {
      if (index[s] !== -1) continue;
      index[s] = low[s] = idx++;
      stack[sp++] = s;
      onStack[s] = 1;
      call[cp] = s;
      edge[cp++] = start[s];
      while (cp > 0) {
        const v = call[cp - 1];
        if (edge[cp - 1] < start[v + 1]) {
          const w = succ[edge[cp - 1]++];
          if (index[w] === -1) {
            index[w] = low[w] = idx++;
            stack[sp++] = w;
            onStack[w] = 1;
            call[cp] = w;
            edge[cp++] = start[w];
          } else if (onStack[w] && index[w] < low[v]) low[v] = index[w];
          continue;
        }
        cp--;
        if (cp > 0 && low[v] < low[call[cp - 1]]) low[call[cp - 1]] = low[v];
        if (low[v] === index[v]) {
          let w;
          do {
            w = stack[--sp];
            onStack[w] = 0;
            comp[w] = count;
          } while (w !== v);
          count++;
        }
      }
    }
    return { comp, count };
  }
  var MinHeap = class {
    constructor(capacity) {
      this.size = 0;
      this.h = new Int32Array(Math.max(1, capacity));
    }
    push(x) {
      const h = this.h;
      let i = this.size++;
      while (i > 0) {
        const p = i - 1 >> 1;
        if (h[p] <= x) break;
        h[i] = h[p];
        i = p;
      }
      h[i] = x;
    }
    pop() {
      const h = this.h;
      const top = h[0];
      const x = h[--this.size];
      let i = 0;
      for (; ; ) {
        let c = 2 * i + 1;
        if (c >= this.size) break;
        if (c + 1 < this.size && h[c + 1] < h[c]) c++;
        if (h[c] >= x) break;
        h[i] = h[c];
        i = c;
      }
      h[i] = x;
      return top;
    }
  };
  function topoComponents(n, comp, count, p0, p1) {
    const members = Array.from({ length: count }, () => []);
    for (let i = 0; i < n; i++) members[comp[i]].push(i);
    const indeg = new Int32Array(count);
    const outs = Array.from({ length: count }, () => []);
    const link = (p, i) => {
      if (p < 0 || comp[p] === comp[i]) return;
      indeg[comp[i]]++;
      outs[comp[p]].push(comp[i]);
    };
    for (let i = 0; i < n; i++) {
      link(p0[i], i);
      link(p1[i], i);
    }
    const heap = new MinHeap(count);
    for (let c = 0; c < count; c++) if (indeg[c] === 0) heap.push(members[c][0]);
    const order = [];
    while (heap.size > 0) {
      const c = comp[heap.pop()];
      order.push(members[c]);
      for (const d of outs[c]) if (--indeg[d] === 0) heap.push(members[d][0]);
    }
    return order;
  }
  function settleLength(net, gs, g, K, maxRounds, memo) {
    const k = gs.length;
    const local = /* @__PURE__ */ new Map();
    gs.forEach((i, j) => local.set(g.y[i], j));
    const ext = /* @__PURE__ */ new Map();
    const kind = new Uint8Array(2 * k);
    const val = new Int32Array(2 * k);
    const encode2 = (slot, id) => {
      const l = local.get(id);
      if (l !== void 0) [kind[slot], val[slot]] = [0, l];
      else if (K[id] !== X) [kind[slot], val[slot]] = [1, K[id]];
      else {
        let e = ext.get(id);
        if (e === void 0) ext.set(id, e = ext.size);
        [kind[slot], val[slot]] = [2, e];
      }
    };
    gs.forEach((i, j) => {
      encode2(2 * j, g.a[i]);
      encode2(2 * j + 1, g.b[i]);
    });
    const t = gs.map((i) => g.t[i]);
    const key = t.map((tj, j) => `${tj}${kind[2 * j]}${val[2 * j]},${kind[2 * j + 1]}${val[2 * j + 1]}`).join(";");
    const hit = memo.get(key);
    if (hit !== void 0) return hit;
    const m = ext.size;
    const bits = k + m;
    const exhaustive = bits <= 20 && 2 ** bits * k <= 1 << 18;
    const states = exhaustive ? 2 ** bits : 4096;
    const vals = new Uint8Array(k);
    const xs = new Uint8Array(m);
    const operand = (slot) => kind[slot] === 0 ? vals[val[slot]] : kind[slot] === 1 ? val[slot] : xs[val[slot]];
    let seed = 625341585;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed & 1;
    };
    let need2 = 0;
    for (let s = 0; s < states; s++) {
      for (let j = 0; j < k; j++) vals[j] = exhaustive ? Math.floor(s / 2 ** j) & 1 : rand();
      for (let j = 0; j < m; j++) xs[j] = exhaustive ? Math.floor(s / 2 ** (k + j)) & 1 : rand();
      let pos = 0;
      let last = -1;
      let quiet = 0;
      while (quiet < k) {
        const j = pos % k;
        const y = evalBit(t[j], operand(2 * j), operand(2 * j + 1));
        if (y !== vals[j]) {
          if (pos >= k * maxRounds) {
            const paths = gs.slice(0, 8).map((i) => net.gates[i].path);
            throw new CompileError(
              `feedback group of ${k} gates does not settle within ${maxRounds} rounds (oscillating loop?): ${paths.join(", ")}${k > 8 ? ", \u2026" : ""}`
            );
          }
          vals[j] = y;
          last = pos;
          quiet = 0;
        } else quiet++;
        pos++;
      }
      need2 = Math.max(need2, last + 1);
    }
    if (!exhaustive) need2 += k;
    memo.set(key, need2);
    return need2;
  }
  function holdFilter(gs, seq, g, K) {
    const k = gs.length;
    const local = /* @__PURE__ */ new Map();
    gs.forEach((i, j) => local.set(g.y[i], j));
    const src = new Int32Array(k);
    const inv = new Uint8Array(k);
    for (let j = 0; j < k; j++) {
      const i = gs[j];
      const [t, a, b] = [g.t[i], g.a[i], g.b[i]];
      let x;
      let c = -1;
      if (t === BUF || t === NOT || a === b) x = a;
      else if (K[a] === X && K[b] !== X) [x, c] = [a, K[b]];
      else if (K[b] === X && K[a] !== X) [x, c] = [b, K[a]];
      else return null;
      const s = local.get(x);
      if (s === void 0) return null;
      src[j] = s;
      if (t === BUF || t === AND || t === OR) inv[j] = 0;
      else if (t === NOT || t === NAND || t === NOR) inv[j] = 1;
      else if (c < 0) return null;
      else inv[j] = t === XOR ? c : c ^ 1;
    }
    const symSrc = Int32Array.from({ length: k }, (_, j) => j);
    const symInv = new Uint8Array(k);
    const moves = new Uint8Array(k);
    for (const i of seq) {
      const j = local.get(g.y[i]);
      const [s, p] = [symSrc[src[j]], symInv[src[j]] ^ inv[j]];
      if (s !== j || p !== 0) moves[j] = 1;
      symSrc[j] = s;
      symInv[j] = p;
    }
    return {
      keep: seq.filter((i) => moves[local.get(g.y[i])]),
      changing: gs.filter((_, j) => moves[j]).map((i) => g.y[i])
    };
  }
  function compile(net, opts = {}) {
    var _a, _b, _c, _d;
    const prune = (_a = opts.prune) != null ? _a : true;
    const maxRounds = (_b = opts.maxRounds) != null ? _b : 16;
    const g = gateArrays(net);
    const n = g.t.length;
    const nNets = net.netNames.length;
    const { driver } = net;
    const clk = (_c = net.aliases.get("CLK")) != null ? _c : -1;
    if (clk >= 0 && driver[clk] !== -1) throw new CompileError("CLK must be a top-level input");
    const rs = new Int32Array(nNets + 1);
    for (let i = 0; i < n; i++) {
      rs[g.a[i] + 1]++;
      if (g.b[i] !== g.a[i]) rs[g.b[i] + 1]++;
    }
    for (let i = 0; i < nNets; i++) rs[i + 1] += rs[i];
    const rd = new Int32Array(rs[nNets]);
    const fill = rs.slice(0, nNets);
    for (let i = 0; i < n; i++) {
      rd[fill[g.a[i]]++] = i;
      if (g.b[i] !== g.a[i]) rd[fill[g.b[i]]++] = i;
    }
    const inPorts = net.ports.filter((p) => p.dir === "in");
    const inputNets = [];
    for (const name of (_d = opts.inputs) != null ? _d : inPorts.map((p) => p.name).filter((x) => x !== "CLK")) {
      const p = inPorts.find((x) => x.name === name);
      if (!p) throw new CompileError(`no top-level input ${name}`);
      for (const id of p.nets) if (id !== clk) inputNets.push(id);
    }
    const levels = [constants(g, rs, rd, nNets, clk, 0), constants(g, rs, rd, nNets, clk, 1)];
    const memo = /* @__PURE__ */ new Map();
    const plan2 = (level) => {
      const { k: K, rank } = levels[level];
      const Kprev = levels[1 - level].k;
      const p0 = new Int32Array(n);
      const p1 = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const y = g.y[i];
        const live = (id) => {
          const d = driver[id];
          if (d < 0) return -1;
          if (K[y] === X) return d;
          return K[id] !== X && rank[id] < rank[y] ? d : -1;
        };
        p0[i] = live(g.a[i]);
        p1[i] = g.b[i] === g.a[i] ? -1 : live(g.b[i]);
      }
      const { comp, count } = tarjan(n, p0, p1);
      const comps = topoComponents(n, comp, count, p0, p1);
      const chg = new Uint8Array(nNets);
      if (clk >= 0) chg[clk] = 1;
      if (level === 0) for (const id of inputNets) chg[id] = 1;
      const changes = (i) => {
        const [y, a, b] = [g.y[i], g.a[i], g.b[i]];
        if (K[y] === X) return chg[a] === 1 || chg[b] === 1;
        if (Kprev[y] === K[y]) return false;
        const forced = (id) => K[id] !== X && rank[id] < rank[y] && chg[id] === 1;
        return forced(a) || forced(b);
      };
      const order = [];
      const sccs = [];
      for (const gs of comps) {
        const i0 = gs[0];
        if (gs.length === 1 && p0[i0] !== i0 && p1[i0] !== i0) {
          if (!prune) order.push(i0);
          else if (changes(i0)) {
            order.push(i0);
            chg[g.y[i0]] = 1;
          }
          continue;
        }
        sccs.push(gs);
        const need2 = settleLength(net, gs, g, K, maxRounds, memo);
        if (!prune) {
          for (let r = Math.max(1, Math.ceil(need2 / gs.length)); r > 0; r--) order.push(...gs);
          continue;
        }
        const c = comp[i0];
        const moved = (id) => chg[id] === 1 && (driver[id] < 0 || comp[driver[id]] !== c);
        if (!gs.some((i) => moved(g.a[i]) || moved(g.b[i]))) continue;
        const seq = Array.from({ length: need2 }, (_, j) => gs[j % gs.length]);
        const hold = holdFilter(gs, seq, g, K);
        order.push(...hold ? hold.keep : seq);
        for (const y of hold ? hold.changing : seq.map((i) => g.y[i])) chg[y] = 1;
      }
      return { order, sccs };
    };
    const low = plan2(0);
    const high = plan2(1);
    return {
      passes: [
        { clk: 0, order: low.order },
        { clk: 1, order: high.order }
      ],
      sccs: [low.sccs, high.sccs],
      stats: {
        gates: n,
        actionsPerTick: low.order.length + high.order.length,
        largestScc: [...low.sccs, ...high.sccs].reduce((m, s) => Math.max(m, s.length), 0)
      },
      inputNets
    };
  }

  // src/hdl/builder.ts
  function cellPorts(lib, cell) {
    if (isGateCell(cell)) {
      const t = cell.slice(GATE_PREFIX.length);
      if (!(t in GATE_ARITY)) throw new Error(`unknown gate ${cell}`);
      return gatePorts(t);
    }
    const m = lib.get(cell);
    if (!m) throw new Error(`unknown cell ${cell}`);
    return m.ports;
  }
  var ModuleBuilder = class {
    constructor(lib, name, spec) {
      this.lib = lib;
      this.name = name;
      this.ports = [];
      this.instances = [];
      this.used = /* @__PURE__ */ new Set();
      this.counters = /* @__PURE__ */ new Map();
      this.BUF = (a, out) => this.gate("BUF", [a], out);
      this.NOT = (a, out) => this.gate("NOT", [a], out);
      this.AND = (a, b, out) => this.gate("AND", [a, b], out);
      this.OR = (a, b, out) => this.gate("OR", [a, b], out);
      this.NAND = (a, b, out) => this.gate("NAND", [a, b], out);
      this.NOR = (a, b, out) => this.gate("NOR", [a, b], out);
      this.XOR = (a, b, out) => this.gate("XOR", [a, b], out);
      this.XNOR = (a, b, out) => this.gate("XNOR", [a, b], out);
      var _a, _b;
      for (const [n, w] of Object.entries((_a = spec.in) != null ? _a : {})) this.ports.push({ name: n, dir: "in", width: w });
      for (const [n, w] of Object.entries((_b = spec.out) != null ? _b : {})) this.ports.push({ name: n, dir: "out", width: w });
      for (const p of this.ports) {
        if (!/^[A-Za-z_][\w]*$/.test(p.name)) throw new Error(`${name}: bad port name ${p.name}`);
        for (const b of portBits(p)) this.used.add(b);
      }
    }
    port(name, dir) {
      const p = this.ports.find((x) => x.name === name);
      if (!p) throw new Error(`${this.name}: no port ${name}`);
      if (p.dir !== dir) throw new Error(`${this.name}: port ${name} is ${p.dir}, not ${dir}`);
      return portBits(p);
    }
    /** Bit nets of an input port (LSB first). */
    in(name) {
      return this.port(name, "in");
    }
    /** Bit nets of an output port (LSB first). Drive each bit exactly once. */
    out(name) {
      return this.port(name, "out");
    }
    /** Single-bit helpers. */
    in1(name) {
      return this.in(name)[0];
    }
    out1(name) {
      return this.out(name)[0];
    }
    /** Fresh internal net names (unique within the module). */
    wire(base, width = 1) {
      var _a;
      const out = [];
      for (let i = 0; i < width; i++) {
        let n = width === 1 ? base : `${base}[${i}]`;
        if (this.used.has(n)) {
          let k = (_a = this.counters.get(base)) != null ? _a : 1;
          while (this.used.has(width === 1 ? `${base}_${k}` : `${base}_${k}[${i}]`)) k++;
          this.counters.set(base, k);
          n = width === 1 ? `${base}_${k}` : `${base}_${k}[${i}]`;
        }
        this.used.add(n);
        out.push(n);
      }
      return out;
    }
    wire1(base) {
      return this.wire(base)[0];
    }
    instName(base) {
      var _a;
      const k = ((_a = this.counters.get(`#${base}`)) != null ? _a : 0) + 1;
      this.counters.set(`#${base}`, k);
      return `${base}${k}`;
    }
    /** Places a primitive gate. Returns its output net (`out`, or a fresh net). */
    gate(type, inputs, out, inst) {
      if (inputs.length !== GATE_ARITY[type]) throw new Error(`${this.name}: ${type} takes ${GATE_ARITY[type]} inputs`);
      const y = out != null ? out : this.wire1(type.toLowerCase());
      if (out && !this.used.has(out)) this.used.add(out);
      const conn = { A: [inputs[0]], Y: [y] };
      if (inputs.length === 2) conn.B = [inputs[1]];
      this.instances.push({ name: inst != null ? inst : this.instName(type.toLowerCase()), cell: `${GATE_PREFIX}${type}`, conn });
      return y;
    }
    /** AND/OR/XOR of many nets as a balanced tree of 2-input gates. */
    reduce(type, nets, out) {
      if (nets.length === 0) return type === "AND" ? CONST1 : CONST0;
      if (nets.length === 1) return out ? this.BUF(nets[0], out) : nets[0];
      let level = nets;
      while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
          if (i + 1 === level.length) next.push(level[i]);
          else next.push(this.gate(type, [level[i], level[i + 1]], level.length === 2 ? out : void 0));
        }
        level = next;
      }
      return level[0];
    }
    /** Instantiates another module. `conn` maps child port → parent nets; unconnected
     * child outputs get fresh nets. Returns every child port's nets in this scope. */
    use(cell, conn, inst) {
      const ports = cellPorts(this.lib, cell);
      const name = inst != null ? inst : this.instName(cell.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
      if (this.instances.some((i) => i.name === name)) throw new Error(`${this.name}: duplicate instance ${name}`);
      const out = {};
      const resolved = {};
      for (const p of ports) {
        let nets = conn[p.name];
        if (nets === void 0) {
          if (p.dir === "in") throw new Error(`${this.name}/${name}: input ${p.name} of ${cell} is not connected`);
          nets = this.wire(`${name}_${p.name}`, p.width);
        }
        const bus = typeof nets === "string" ? [nets] : nets;
        if (bus.length !== p.width)
          throw new Error(`${this.name}/${name}: ${cell}.${p.name} is ${p.width} bits, got ${bus.length}`);
        for (const n of bus) if (n !== CONST0 && n !== CONST1) this.used.add(n);
        resolved[p.name] = bus;
        out[p.name] = bus;
      }
      for (const k of Object.keys(conn))
        if (!ports.some((p) => p.name === k)) throw new Error(`${this.name}/${name}: ${cell} has no port ${k}`);
      this.instances.push({ name, cell, conn: resolved });
      return out;
    }
    build(doc) {
      return { name: this.name, ports: this.ports, instances: this.instances, doc };
    }
  };
  function define(lib, name, spec, body2, doc) {
    if (lib.has(name)) throw new Error(`module ${name} defined twice`);
    const b = new ModuleBuilder(lib, name, spec);
    body2(b);
    const m = b.build(doc);
    lib.set(name, m);
    return m;
  }

  // src/netlist/flatten.ts
  var NetlistError = class extends Error {
  };
  function flatten(lib, top) {
    const topDef = lib.get(top);
    if (!topDef) throw new NetlistError(`no module ${top}`);
    const netNames = [CONST0, CONST1];
    const aliases = /* @__PURE__ */ new Map([
      [CONST0, NET0],
      [CONST1, NET1]
    ]);
    const gates = [];
    const newNet = (name) => {
      netNames.push(name);
      aliases.set(name, netNames.length - 1);
      return netNames.length - 1;
    };
    const ports = topDef.ports.map((p) => ({ name: p.name, dir: p.dir, nets: portBits(p).map((b) => newNet(b)) }));
    const topBinding = /* @__PURE__ */ new Map();
    topDef.ports.forEach((p, i) => portBits(p).forEach((b, k) => topBinding.set(b, ports[i].nets[k])));
    const expand = (moduleName, prefix, binding, depth) => {
      var _a;
      if (depth > 64) throw new NetlistError(`hierarchy too deep at ${prefix} (recursive module?)`);
      const def = lib.get(moduleName);
      const local = new Map(binding);
      const resolve = (n) => {
        if (n === CONST0) return NET0;
        if (n === CONST1) return NET1;
        let id = local.get(n);
        if (id === void 0) {
          id = newNet(`${prefix}${n}`);
          local.set(n, id);
        } else if (!aliases.has(`${prefix}${n}`)) aliases.set(`${prefix}${n}`, id);
        return id;
      };
      for (const inst of def.instances) {
        const path = `${prefix}${inst.name}`;
        if (isGateCell(inst.cell)) {
          const type = gateTypeOf(inst.cell);
          const ins = (inst.conn.B ? ["A", "B"] : ["A"]).map((p) => {
            var _a2;
            const n = (_a2 = inst.conn[p]) == null ? void 0 : _a2[0];
            if (n === void 0) throw new NetlistError(`${path}: gate input ${p} not connected`);
            return resolve(n);
          });
          const y = (_a = inst.conn.Y) == null ? void 0 : _a[0];
          if (y === void 0) throw new NetlistError(`${path}: gate output Y not connected`);
          gates.push({ type, in: ins, out: resolve(y), path });
          continue;
        }
        if (!lib.has(inst.cell)) throw new NetlistError(`${path}: unknown cell ${inst.cell}`);
        const childBinding = /* @__PURE__ */ new Map();
        for (const p of cellPorts(lib, inst.cell)) {
          const nets = inst.conn[p.name];
          if (!nets) {
            if (p.dir === "in") throw new NetlistError(`${path}: input ${p.name} of ${inst.cell} not connected`);
            continue;
          }
          const bits = portBits(p);
          if (nets.length !== bits.length) throw new NetlistError(`${path}: ${inst.cell}.${p.name} width mismatch`);
          bits.forEach((b, i) => childBinding.set(b, resolve(nets[i])));
        }
        expand(inst.cell, `${path}/`, childBinding, depth + 1);
        for (const [b, id] of childBinding) if (!aliases.has(`${path}/${b}`)) aliases.set(`${path}/${b}`, id);
      }
    };
    expand(top, "", topBinding, 0);
    const driver = new Int32Array(netNames.length).fill(-1);
    gates.forEach((g, i) => {
      if (g.out === NET0 || g.out === NET1) throw new NetlistError(`${g.path}: drives a constant`);
      if (driver[g.out] !== -1)
        throw new NetlistError(`net ${netNames[g.out]} has two drivers: ${gates[driver[g.out]].path} and ${g.path}`);
      driver[g.out] = i;
    });
    const inputNets = new Set(ports.filter((p) => p.dir === "in").flatMap((p) => p.nets));
    for (const n of inputNets) if (driver[n] !== -1) throw new NetlistError(`top input ${netNames[n]} is driven inside the circuit`);
    const undriven = /* @__PURE__ */ new Set();
    for (const g of gates)
      for (const n of g.in) if (n > NET1 && driver[n] === -1 && !inputNets.has(n)) undriven.add(`${netNames[n]} (read by ${g.path})`);
    for (const p of ports)
      if (p.dir === "out") {
        for (const n of p.nets) if (n > NET1 && driver[n] === -1 && !inputNets.has(n)) undriven.add(`${netNames[n]} (top output)`);
      }
    if (undriven.size) throw new NetlistError(`undriven nets: ${[...undriven].slice(0, 12).join(", ")}${undriven.size > 12 ? ` \u2026 (+${undriven.size - 12})` : ""}`);
    return { top, netNames, aliases, gates, ports, driver };
  }
  function netId(n, name) {
    const id = n.aliases.get(name);
    if (id === void 0) throw new NetlistError(`no net named ${name}`);
    return id;
  }
  function busIds(n, base, width) {
    return Array.from({ length: width }, (_, i) => netId(n, width === 1 ? base : `${base}[${i}]`));
  }

  // src/sim/reference.ts
  var OscillationError = class extends Error {
  };
  var RefSim = class {
    constructor(net) {
      this.net = net;
      this.ticks = 0;
      this.v = new Uint8Array(net.netNames.length);
      this.v[NET1] = 1;
    }
    port(name) {
      const p = this.net.ports.find((x) => x.name === name);
      if (!p) throw new Error(`no top port ${name}`);
      return p;
    }
    /** Drives a top-level input port (number for buses, LSB = bit 0). Does not settle. */
    set(name, value2) {
      const p = this.port(name);
      if (p.dir !== "in") throw new Error(`${name} is an output`);
      p.nets.forEach((n, i) => this.v[n] = value2 >> i & 1);
    }
    /** Reads a top-level port as a number. */
    get(name) {
      return this.port(name).nets.reduce((acc, n, i) => acc | this.v[n] << i, 0);
    }
    /** Reads any net / bus by hierarchical name. */
    peek(name, width = 1) {
      return busIds(this.net, name, width).reduce((acc, n, i) => acc | this.v[n] << i, 0);
    }
    /** Forces a net value (e.g. preloading RAM latch outputs). */
    poke(name, value2, width = 1) {
      busIds(this.net, name, width).forEach((n, i) => this.v[n] = value2 >> i & 1);
    }
    /** Re-evaluates gates until stable. Returns the number of sweeps. */
    settle(maxSweeps = 500) {
      const { gates } = this.net;
      for (let sweep = 1; sweep <= maxSweeps; sweep++) {
        let changed = false;
        for (const g of gates) {
          const y = evalGate(g.type, this.v[g.in[0]], g.in.length > 1 ? this.v[g.in[1]] : 0);
          if (this.v[g.out] !== y) {
            this.v[g.out] = y;
            changed = true;
          }
        }
        if (!changed) return sweep;
      }
      throw new OscillationError(`circuit did not settle in ${maxSweeps} sweeps (oscillating loop?)`);
    }
    /** One clock cycle: CLK low, settle; CLK high, settle (rising edge). Requires a top input CLK. */
    tick() {
      const clk = netId(this.net, "CLK");
      this.v[clk] = 0;
      this.settle();
      this.v[clk] = 1;
      this.settle();
      this.ticks++;
    }
  };

  // src/compile/fastsim.ts
  function pokeIds(net, name) {
    const id = net.aliases.get(name);
    if (id !== void 0) return [id];
    const ids = [];
    for (let i = 0; net.aliases.has(`${name}[${i}]`); i++) ids.push(net.aliases.get(`${name}[${i}]`));
    if (!ids.length) throw new NetlistError(`no net named ${name}`);
    return ids;
  }
  function powerOn(net, pokes = {}) {
    const sim = new RefSim(net);
    for (const [name, value2] of Object.entries(pokes)) pokeIds(net, name).forEach((id, i) => sim.v[id] = value2 >> i & 1);
    const clk = net.aliases.get("CLK");
    if (clk !== void 0) sim.v[clk] = 1;
    sim.settle();
    return sim.v.slice();
  }

  // src/cpu/control.ts
  var FLAGS = ["Z", "C", "N"];
  var OP_BITS = 4;
  var T_BITS = 3;
  var ALU_SEL_BITS = 3;
  var N_OPS = 1 << OP_BITS;
  var N_T = 1 << T_BITS;
  var lit = (code, flag) => code * 4 + (flag ? FLAGS.indexOf(flag) + 1 : 0);
  var litCode = (l) => l >> 2;
  var litFlag = (l) => FLAGS[(l & 3) - 1];
  var setKey = (lits) => lits.join(",");
  var isAll = (lits) => lits.length === N_OPS && lits.every((l) => !litFlag(l));
  function opcodeTable() {
    const ops = [...OPCODES].sort((a, b) => a.code - b.code);
    if (ops.length !== N_OPS || ops.some((o, i) => o.code !== i))
      throw new Error(`CONTROL: OPCODES must define each code 0\u2013${N_OPS - 1} exactly once`);
    for (const o of ops) if (!/^[A-Za-z]\w*$/.test(o.mnem)) throw new Error(`CONTROL: bad mnemonic ${o.mnem}`);
    return ops;
  }
  function label(ops, lits) {
    const name = (l) => ops[litCode(l)].mnem + (litFlag(l) ? `if${litFlag(l)}` : "");
    const parts = [];
    for (let i = 0; i < lits.length; ) {
      let j = i;
      if (!litFlag(lits[i]))
        while (j + 1 < lits.length && !litFlag(lits[j + 1]) && litCode(lits[j + 1]) === litCode(lits[j]) + 1) j++;
      if (j - i >= 2) parts.push(`${name(lits[i])}to${name(lits[j])}`);
      else for (let k = i; k <= j; k++) parts.push(name(lits[k]));
      i = j + 1;
    }
    return parts.join("_");
  }
  function signalTable() {
    const on = new Map(SIGNALS.map((s) => [s, Array.from({ length: N_T }, () => /* @__PURE__ */ new Set())]));
    for (const op of OPCODES)
      for (const step of microcode(op)) {
        if (step.t < 0 || step.t >= N_T) throw new Error(`CONTROL: ${op.mnem} uses T${step.t}; the T counter has ${N_T} states`);
        for (const s of step.signals) on.get(s)[step.t].add(lit(op.code));
        if (step.when) for (const s of step.when.signals) on.get(s)[step.t].add(lit(op.code, step.when.flag));
      }
    const table = /* @__PURE__ */ new Map();
    for (const [s, perT] of on)
      table.set(
        s,
        perT.map((set) => [...set].filter((l) => !litFlag(l) || !set.has(lit(litCode(l)))).sort((a, b) => a - b))
      );
    return table;
  }
  var OpcodeGroups = class {
    constructor(b, ops, opLine) {
      this.b = b;
      this.ops = ops;
      this.opLine = opLine;
      this.groups = /* @__PURE__ */ new Map();
      this.flagged = /* @__PURE__ */ new Map();
    }
    /** The net of one literal: an opcode line, or op_<MNEM>if<FLAG> = line · flag. */
    literal(l) {
      const flag = litFlag(l);
      if (!flag) return this.opLine[litCode(l)];
      let net = this.flagged.get(l);
      if (!net) {
        net = gate(this.b, "AND", [this.opLine[litCode(l)], this.b.in1(flag)], `op_${label(this.ops, [l])}`);
        this.flagged.set(l, net);
      }
      return net;
    }
    netOf(lits) {
      return lits.length === 1 ? this.literal(lits[0]) : this.groups.get(setKey(lits)).net;
    }
    /** OR of two disjoint built sets (one gate, unless that union already exists). */
    union(x, y) {
      const lits = [...x, ...y].sort((a, b) => a - b);
      const key = setKey(lits);
      if (!this.groups.has(key))
        this.groups.set(key, { lits, net: gate(this.b, "OR", [this.netOf(x), this.netOf(y)], `ops_${label(this.ops, lits)}`) });
      return lits;
    }
    balanced(sets) {
      let level = sets;
      while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? this.union(level[i], level[i + 1]) : level[i]);
        level = next;
      }
      return level[0];
    }
    /** The net that is 1 iff any literal of the (sorted) set is: "0" if empty, "1" for all opcodes. */
    net(lits) {
      var _a;
      if (lits.length === 0) return CONST0;
      if (isAll(lits)) return CONST1;
      if (lits.length === 1 || this.groups.has(setKey(lits))) return this.netOf(lits);
      const rest = new Set(lits);
      const pieces = [];
      for (; ; ) {
        let best;
        for (const g of this.groups.values())
          if (g.lits.length > ((_a = best == null ? void 0 : best.length) != null ? _a : 1) && g.lits.every((l) => rest.has(l))) best = g.lits;
        if (!best) break;
        pieces.push(best);
        for (const l of best) rest.delete(l);
      }
      for (const l of rest) pieces.push([l]);
      pieces.sort((x, y) => x[0] - y[0]);
      const runs = [];
      for (const p of pieces) {
        const run = runs[runs.length - 1];
        const prev = run == null ? void 0 : run[run.length - 1];
        if (prev && litCode(p[0]) === litCode(prev[prev.length - 1]) + 1) run.push(p);
        else runs.push([p]);
      }
      return this.netOf(this.balanced(runs.map((r) => this.balanced(r))));
    }
  };
  function gate(b, type, inputs, name) {
    const y = b.wire1(name);
    return b.gate(type, inputs, y, y);
  }
  function orTree(b, nets, name) {
    if (nets.length === 0) return CONST0;
    let level = nets;
    let k = 0;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2)
        next.push(i + 1 < level.length ? gate(b, "OR", [level[i], level[i + 1]], level.length === 2 ? name : `${name}_${++k}`) : level[i]);
      level = next;
    }
    return level[0];
  }
  function buildControl(lib) {
    define(
      lib,
      "CTRL_DEC2",
      { in: { A: 2 }, out: { Y: 4 } },
      (b) => {
        const a = b.in("A");
        const na = a.map((x, i) => gate(b, "NOT", [x], `nA${i}`));
        b.out("Y").forEach((y, k) => b.gate("AND", [k & 2 ? a[1] : na[1], k & 1 ? a[0] : na[0]], y, `y${k}`));
      },
      "2\u21924 one-hot predecoder: Y[k] = 1 iff A = k. 2 NOT + 4 AND."
    );
    define(
      lib,
      "CTRL_DEC3",
      { in: { A: 3 }, out: { Y: 8 } },
      (b) => {
        const a = b.in("A");
        const lo = b.use("CTRL_DEC2", { A: a.slice(0, 2), Y: b.wire("lo", 4) }, "lo").Y;
        const na2 = gate(b, "NOT", [a[2]], "nA2");
        b.out("Y").forEach((y, k) => b.gate("AND", [lo[k & 3], k & 4 ? a[2] : na2], y, `y${k}`));
      },
      "3\u21928 one-hot decoder (the T-state lines): a CTRL_DEC2 on A[1:0], then Y[k] = lo[k mod 4] \xB7 (A[2] or \xACA[2])."
    );
    define(
      lib,
      "CTRL_DEC4",
      { in: { A: 4 }, out: { Y: 16 } },
      (b) => {
        const a = b.in("A");
        const lo = b.use("CTRL_DEC2", { A: a.slice(0, 2), Y: b.wire("lo", 4) }, "lo").Y;
        const hi = b.use("CTRL_DEC2", { A: a.slice(2, 4), Y: b.wire("hi", 4) }, "hi").Y;
        b.out("Y").forEach((y, k) => b.gate("AND", [lo[k & 3], hi[k >> 2]], y, `y${k}`));
      },
      "4\u219216 one-hot decoder (the opcode lines): CTRL_DEC2 predecoders on A[1:0] and A[3:2], then Y[k] = lo[k mod 4] \xB7 hi[k div 4]."
    );
    const ops = opcodeTable();
    const table = signalTable();
    const aluSets = [
      ...Array.from({ length: ALU_SEL_BITS }, (_, bit) => ({
        port: "ALU_SEL",
        bit,
        lits: ops.filter((o) => o.alu && o.alu.sel >> bit & 1).map((o) => lit(o.code))
      })),
      { port: "ALU_SUB", bit: 0, lits: ops.filter((o) => {
        var _a;
        return (_a = o.alu) == null ? void 0 : _a.sub;
      }).map((o) => lit(o.code)) }
    ];
    for (const o of ops)
      if (o.alu && (o.alu.sel < 0 || o.alu.sel >= 1 << ALU_SEL_BITS)) throw new Error(`CONTROL: ${o.mnem} ALU sel out of range`);
    define(
      lib,
      "CONTROL",
      {
        in: { OP: OP_BITS, T: T_BITS, Z: 1, C: 1, N: 1, HALTED: 1, RESET: 1 },
        out: __spreadProps(__spreadValues({}, Object.fromEntries(SIGNALS.map((s) => [s, 1]))), { ALU_SEL: ALU_SEL_BITS, ALU_SUB: 1 })
      },
      (b) => {
        const opLine = ops.map((o) => b.wire1(`op_${o.mnem}`));
        const tLine = Array.from({ length: N_T }, (_, t) => b.wire1(`T${t}`));
        b.use("CTRL_DEC4", { A: b.in("OP"), Y: opLine }, "dec_op");
        b.use("CTRL_DEC3", { A: b.in("T"), Y: tLine }, "dec_t");
        const run = gate(b, "NOR", [b.in1("HALTED"), b.in1("RESET")], "run");
        const groups = new OpcodeGroups(b, ops, opLine);
        const sets = /* @__PURE__ */ new Map();
        for (let t = 0; t < N_T; t++) for (const s of SIGNALS) sets.set(setKey(table.get(s)[t]), table.get(s)[t]);
        for (const lits of [...sets.values()].sort((x, y) => x.length - y.length)) groups.net(lits);
        const aluNets = aluSets.map((a) => groups.net(a.lits));
        const terms = /* @__PURE__ */ new Map();
        const term = (t, lits) => {
          if (isAll(lits)) return tLine[t];
          const key = `${t}|${setKey(lits)}`;
          let net = terms.get(key);
          if (!net) {
            net = gate(b, "AND", [tLine[t], groups.net(lits)], `term_${label(ops, lits)}_T${t}`);
            terms.set(key, net);
          }
          return net;
        };
        const signalTerms = /* @__PURE__ */ new Map();
        for (const s of SIGNALS) signalTerms.set(s, []);
        for (let t = 0; t < N_T; t++)
          for (const s of SIGNALS) {
            const lits = table.get(s)[t];
            if (lits.length) signalTerms.get(s).push(term(t, lits));
          }
        const sums = /* @__PURE__ */ new Map();
        for (const s of SIGNALS) {
          const nets = signalTerms.get(s);
          const key = nets.join(",");
          if (!sums.has(key)) sums.set(key, orTree(b, nets, `or_${s}`));
          b.gate("AND", [run, sums.get(key)], b.out1(s), `out_${s}`);
        }
        aluSets.forEach((a, i) => {
          const port = b.out(a.port);
          b.gate("AND", [run, aluNets[i]], port[a.bit], `out_${a.port}${port.length > 1 ? a.bit : ""}`);
        });
      },
      "Control unit: a sum-of-products PLA generated from the microcode table. dec_op / dec_t decode the opcode and T-state into one-hot lines; each term_<ops>_T<t> ANDs a T line with an OR of opcode lines (ops_<ops>, op_JZifZ = JZ \xB7 Z); each control signal is the OR of its terms (or_<SIGNAL>), and out_<SIGNAL> gates it with run = NOR(HALTED, RESET). ALU_SEL / ALU_SUB are opcode groups from each instruction's ALU field."
    );
  }

  // src/cells/util.ts
  function place(b, type, name, inputs, out) {
    if (b.instances.some((i) => i.name === name)) throw new Error(`${b.name}: duplicate instance ${name}`);
    return b.gate(type, inputs, out != null ? out : b.wire1(name), name);
  }
  function orTree2(b, name, nets, out) {
    if (nets.length === 0) throw new Error(`${b.name}: empty OR tree ${name}`);
    if (nets.length === 1) return place(b, "BUF", name, nets, out);
    let level = nets;
    let k = 0;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 === level.length) next.push(level[i]);
        else next.push(place(b, "OR", `${name}${++k}`, [level[i], level[i + 1]], level.length === 2 ? out : void 0));
      }
      level = next;
    }
    return level[0];
  }

  // src/cells/arith.ts
  function defineHalfAdder(lib) {
    define(
      lib,
      "HALF_ADDER",
      { in: { A: 1, B: 1 }, out: { S: 1, CO: 1 } },
      (b) => {
        const [A, B] = [b.in1("A"), b.in1("B")];
        place(b, "XOR", "sum", [A, B], b.out1("S"));
        place(b, "AND", "carry", [A, B], b.out1("CO"));
      },
      "Half adder: S = A \u2295 B, CO = A\xB7B"
    );
  }
  function defineFullAdder(lib) {
    define(
      lib,
      "FULL_ADDER",
      { in: { A: 1, B: 1, CI: 1 }, out: { S: 1, CO: 1 } },
      (b) => {
        const [A, B, CI] = [b.in1("A"), b.in1("B"), b.in1("CI")];
        const p = place(b, "XOR", "p", [A, B]);
        place(b, "XOR", "sum", [p, CI], b.out1("S"));
        const gen = place(b, "AND", "gen", [A, B]);
        const pc = place(b, "AND", "pc", [p, CI]);
        place(b, "OR", "carry", [gen, pc], b.out1("CO"));
      },
      "Full adder: S = A \u2295 B \u2295 CI, CO = A\xB7B + (A \u2295 B)\xB7CI"
    );
  }
  function defineAdder(lib, width) {
    define(
      lib,
      `ADDER_W${width}`,
      { in: { A: width, B: width, CI: 1 }, out: { S: width, CO: 1 } },
      (b) => {
        const [A, B, S] = [b.in("A"), b.in("B"), b.out("S")];
        let carry = b.in1("CI");
        for (let i = 0; i < width; i++) {
          const co = i === width - 1 ? b.out1("CO") : b.wire1(`c${i + 1}`);
          b.use("FULL_ADDER", { A: A[i], B: B[i], CI: carry, S: S[i], CO: co }, `fa${i}`);
          carry = co;
        }
      },
      `${width}-bit ripple-carry adder: {CO, S} = A + B + CI`
    );
  }
  function defineInc(lib, width) {
    if (width < 2) throw new Error(`INC_W${width}: width must be \u2265 2`);
    define(
      lib,
      `INC_W${width}`,
      { in: { A: width }, out: { Y: width, CO: 1 } },
      (b) => {
        const [A, Y] = [b.in("A"), b.out("Y")];
        place(b, "NOT", "b0", [A[0]], Y[0]);
        let carry = A[0];
        for (let i = 1; i < width; i++) {
          const co = i === width - 1 ? b.out1("CO") : b.wire1(`c${i + 1}`);
          b.use("HALF_ADDER", { A: A[i], B: carry, S: Y[i], CO: co }, `b${i}`);
          carry = co;
        }
      },
      `${width}-bit incrementer: {CO, Y} = A + 1`
    );
  }
  function defineZero(lib, width) {
    if (width < 2) throw new Error(`ZERO_W${width}: width must be \u2265 2`);
    define(
      lib,
      `ZERO_W${width}`,
      { in: { A: width }, out: { Z: 1 } },
      (b) => {
        let level = b.in("A");
        let depth = 1;
        while (level.length > 2) {
          const next = [];
          for (let i = 0; i < level.length; i += 2)
            next.push(i + 1 === level.length ? level[i] : place(b, "OR", `or${depth}_${i / 2}`, [level[i], level[i + 1]]));
          level = next;
          depth++;
        }
        place(b, "NOR", "nor", [level[0], level[1]], b.out1("Z"));
      },
      `${width}-bit zero detector: Z = 1 iff A = 0`
    );
  }

  // src/cells/decode.ts
  function minterms2(b, p, [lo, nlo], [hi, nhi], en, outs) {
    const h = en ? [place(b, "AND", `${en.name}0`, [en.net, nhi]), place(b, "AND", `${en.name}1`, [en.net, hi])] : [nhi, hi];
    return [0, 1, 2, 3].map((v) => place(b, "AND", `${p}${v}`, [h[v >> 1], v & 1 ? lo : nlo], outs == null ? void 0 : outs[v]));
  }
  var inverters = (b, A) => A.map((a, i) => place(b, "NOT", `n${i}`, [a]));
  function defineDec2(lib) {
    define(
      lib,
      "DEC2",
      { in: { A: 2, EN: 1 }, out: { Y: 4 } },
      (b) => {
        const A = b.in("A");
        const n = inverters(b, A);
        minterms2(b, "y", [A[0], n[0]], [A[1], n[1]], { net: b.in1("EN"), name: "en" }, b.out("Y"));
      },
      "2\u21924 one-hot decoder: Y[A] = EN, all other outputs 0"
    );
  }
  function defineDec3(lib) {
    define(
      lib,
      "DEC3",
      { in: { A: 3, EN: 1 }, out: { Y: 8 } },
      (b) => {
        const [A, EN, Y] = [b.in("A"), b.in1("EN"), b.out("Y")];
        const n = inverters(b, A);
        const lo = minterms2(b, "lo", [A[0], n[0]], [A[1], n[1]]);
        const hi = [place(b, "AND", "hi0", [EN, n[2]]), place(b, "AND", "hi1", [EN, A[2]])];
        for (let v = 0; v < 8; v++) place(b, "AND", `y${v}`, [hi[v >> 2], lo[v & 3]], Y[v]);
      },
      "3\u21928 one-hot decoder: Y[A] = EN, all other outputs 0"
    );
  }
  function defineDec4(lib) {
    define(
      lib,
      "DEC4",
      { in: { A: 4, EN: 1 }, out: { Y: 16 } },
      (b) => {
        const [A, EN, Y] = [b.in("A"), b.in1("EN"), b.out("Y")];
        const n = inverters(b, A);
        const lo = minterms2(b, "lo", [A[0], n[0]], [A[1], n[1]]);
        const hi = minterms2(b, "hi", [A[2], n[2]], [A[3], n[3]], { net: EN, name: "hi_en" });
        for (let v = 0; v < 16; v++) place(b, "AND", `y${v}`, [hi[v >> 2], lo[v & 3]], Y[v]);
      },
      "4\u219216 one-hot decoder: Y[A] = EN, all other outputs 0"
    );
  }

  // src/cells/display.ts
  var PRODUCTS = [
    // 2-literal
    ["a2a1", "a2", "a1"],
    ["n2n0", "n2", "n0"],
    ["n2n1", "n2", "n1"],
    ["a3n2", "a3", "n2"],
    ["n3a2", "n3", "a2"],
    ["a3n1", "a3", "n1"],
    ["a3a2", "a3", "a2"],
    ["a3a1", "a3", "a1"],
    ["n1n0", "n1", "n0"],
    ["a3a0", "a3", "a0"],
    ["n2a1", "n2", "a1"],
    ["a3n0", "a3", "n0"],
    ["a1a0", "a1", "a0"],
    // 3-literal, each built on a shared pair
    ["a3n2n1", "a3n2", "n1"],
    ["n3a1a0", "n3", "a1a0"],
    ["n3n1n0", "n3", "n1n0"],
    ["a3n1a0", "a3n1", "a0"],
    ["n2a1a0", "n2a1", "a0"],
    ["n3n2n0", "n3", "n2n0"],
    ["a2a1n0", "a2a1", "n0"],
    ["n3a2n1", "n3a2", "n1"],
    // 4-literal (digit 5 only)
    ["n3a2n1a0", "n3a2n1", "a0"]
  ];
  var SEGMENTS = [
    /* a */
    ["n2n0", "a2a1", "n3a1a0", "a3n0", "a3n2n1", "n3a2n1a0"],
    /* b */
    ["n2n0", "n2n1", "n3a1a0", "n3n1n0", "a3n1a0"],
    /* c */
    ["n2n1", "n3a2", "a3n2", "n3a1a0", "a3n1a0"],
    /* d */
    ["a3n1", "n3n2n0", "n2a1a0", "a2a1n0", "n3a2n1a0"],
    /* e */
    ["n2n0", "a3a2", "a3a1", "a2a1n0"],
    /* f */
    ["n1n0", "a3n2", "a3a1", "a2a1n0", "n3a2n1a0"],
    /* g */
    ["n2a1", "a3a0", "a3n2n1", "n3a2n1", "a2a1n0"]
  ];
  function defineHex7Seg(lib) {
    define(
      lib,
      "HEX7SEG",
      { in: { A: 4 }, out: { SEG: 7 } },
      (b) => {
        const [A, SEG] = [b.in("A"), b.out("SEG")];
        const net = /* @__PURE__ */ new Map();
        A.forEach((a, k) => {
          net.set(`a${k}`, a);
          net.set(`n${k}`, place(b, "NOT", `n${k}`, [a]));
        });
        const get = (x) => {
          const n = net.get(x);
          if (!n) throw new Error(`HEX7SEG: unknown term ${x}`);
          return n;
        };
        for (const [name, x, y] of PRODUCTS) net.set(name, place(b, "AND", name, [get(x), get(y)]));
        SEGMENTS.forEach((terms, s) => orTree2(b, `seg_${"abcdefg"[s]}`, terms.map(get), SEG[s]));
      },
      "Hex to 7-segment decoder: SEG[0..6] = segments a..g, glyphs 0-9 A b C d E F"
    );
  }

  // src/cells/latches.ts
  function defineDLatch(lib) {
    define(
      lib,
      "DLATCH",
      { in: { D: 1, EN: 1 }, out: { Q: 1 } },
      (b) => {
        const [D, EN, Q] = [b.in1("D"), b.in1("EN"), b.out1("Q")];
        const nen = place(b, "NOT", "nen", [EN]);
        const take = place(b, "AND", "take", [D, EN]);
        const hold = place(b, "AND", "hold", [Q, nen]);
        place(b, "OR", "merge", [take, hold], Q);
      },
      "Gated D latch, feedback mux Q = D\xB7EN + Q\xB7\xACEN: transparent while EN=1, holds while EN=0"
    );
  }
  function defineDff(lib) {
    define(
      lib,
      "DFF",
      { in: { D: 1, CLK: 1 }, out: { Q: 1 } },
      (b) => {
        const CLK = b.in1("CLK");
        const nclk = place(b, "NOT", "nclk", [CLK]);
        const m = b.wire1("m");
        b.use("DLATCH", { D: b.in1("D"), EN: nclk, Q: m }, "master");
        b.use("DLATCH", { D: m, EN: CLK, Q: b.out1("Q") }, "slave");
      },
      "Rising-edge D flip-flop: master latch open while CLK=0, slave latch open while CLK=1"
    );
  }
  function defineDffe(lib) {
    define(
      lib,
      "DFFE",
      { in: { D: 1, LOAD: 1, CLK: 1 }, out: { Q: 1 } },
      (b) => {
        const CLK = b.in1("CLK");
        const nclk = place(b, "NOT", "nclk", [CLK]);
        const men = place(b, "AND", "men", [nclk, b.in1("LOAD")]);
        const m = b.wire1("m");
        b.use("DLATCH", { D: b.in1("D"), EN: men, Q: m }, "master");
        b.use("DLATCH", { D: m, EN: CLK, Q: b.out1("Q") }, "slave");
      },
      "Load-enable flip-flop: master EN = \xACCLK\xB7LOAD, slave EN = CLK; takes D on the rising edge when LOAD=1"
    );
  }
  function defineReg(lib, width) {
    define(
      lib,
      `REG_W${width}`,
      { in: { D: width, LOAD: 1, CLK: 1 }, out: { Q: width } },
      (b) => {
        const [D, Q, LOAD, CLK] = [b.in("D"), b.out("Q"), b.in1("LOAD"), b.in1("CLK")];
        for (let i = 0; i < width; i++) b.use("DFFE", { D: D[i], LOAD, CLK, Q: Q[i] }, `b${i}`);
      },
      `${width}-bit register (${width} \xD7 DFFE sharing LOAD, CLK): loads D on the rising edge when LOAD=1`
    );
  }

  // src/cells/mux.ts
  function defineMux2(lib) {
    define(
      lib,
      "MUX2",
      { in: { A: 1, B: 1, S: 1 }, out: { Y: 1 } },
      (b) => {
        const S = b.in1("S");
        const ns = place(b, "NOT", "ns", [S]);
        const pa = place(b, "AND", "pass_a", [b.in1("A"), ns]);
        const pb = place(b, "AND", "pass_b", [b.in1("B"), S]);
        place(b, "OR", "join", [pa, pb], b.out1("Y"));
      },
      "2:1 multiplexer: Y = S ? B : A"
    );
  }
  function defineMux2W(lib, width) {
    define(
      lib,
      `MUX2_W${width}`,
      { in: { A: width, B: width, S: 1 }, out: { Y: width } },
      (b) => {
        const [A, B, S, Y] = [b.in("A"), b.in("B"), b.in1("S"), b.out("Y")];
        const ns = place(b, "NOT", "ns", [S]);
        const pa = b.wire("pass_a", width);
        const pb = b.wire("pass_b", width);
        for (let i = 0; i < width; i++) {
          place(b, "AND", `pass_a${i}`, [A[i], ns], pa[i]);
          place(b, "AND", `pass_b${i}`, [B[i], S], pb[i]);
          place(b, "OR", `join${i}`, [pa[i], pb[i]], Y[i]);
        }
      },
      `${width}-bit 2:1 multiplexer: Y = S ? B : A`
    );
  }
  function defineMux4W(lib, width) {
    define(
      lib,
      `MUX4_W${width}`,
      { in: { A: width, B: width, C: width, D: width, S: 2 }, out: { Y: width } },
      (b) => {
        const ins = [b.in("A"), b.in("B"), b.in("C"), b.in("D")];
        const [s0, s1] = b.in("S");
        const Y = b.out("Y");
        const ns0 = place(b, "NOT", "ns0", [s0]);
        const ns1 = place(b, "NOT", "ns1", [s1]);
        const sel = [
          place(b, "AND", "sel_a", [ns1, ns0]),
          place(b, "AND", "sel_b", [ns1, s0]),
          place(b, "AND", "sel_c", [s1, ns0]),
          place(b, "AND", "sel_d", [s1, s0])
        ];
        const pass = ["a", "b", "c", "d"].map((x) => b.wire(`pass_${x}`, width));
        const ab = b.wire("ab", width);
        const cd = b.wire("cd", width);
        for (let i = 0; i < width; i++) {
          ["a", "b", "c", "d"].forEach((x, k) => place(b, "AND", `pass_${x}${i}`, [ins[k][i], sel[k]], pass[k][i]));
          place(b, "OR", `ab${i}`, [pass[0][i], pass[1][i]], ab[i]);
          place(b, "OR", `cd${i}`, [pass[2][i], pass[3][i]], cd[i]);
          place(b, "OR", `join${i}`, [ab[i], cd[i]], Y[i]);
        }
      },
      `${width}-bit 4:1 multiplexer: Y = [A, B, C, D][S]`
    );
  }

  // src/cells/index.ts
  function buildCells(lib) {
    defineDLatch(lib);
    defineDff(lib);
    defineDffe(lib);
    for (const w of [3, 4, 8]) defineReg(lib, w);
    defineMux2(lib);
    defineMux2W(lib, 4);
    defineMux2W(lib, 8);
    defineMux4W(lib, 8);
    defineHalfAdder(lib);
    defineFullAdder(lib);
    defineAdder(lib, 8);
    defineInc(lib, 3);
    defineInc(lib, 4);
    defineDec2(lib);
    defineDec3(lib);
    defineDec4(lib);
    defineZero(lib, 8);
    defineHex7Seg(lib);
  }

  // src/cpu/datapath.ts
  var ALU_FUNCS = [
    ["add", ALU_SEL.ADD],
    ["and", ALU_SEL.AND],
    ["or", ALU_SEL.OR],
    ["xor", ALU_SEL.XOR],
    ["not", ALU_SEL.NOT]
  ];
  function defineAlu(lib) {
    define(
      lib,
      "ALU",
      { in: { A: 8, B: 8, SEL: 3, SUB: 1 }, out: { Y: 8, CO: 1, Z: 1, N: 1 } },
      (b) => {
        const [A, B, SUB, Y] = [b.in("A"), b.in("B"), b.in1("SUB"), b.out("Y")];
        const bx = b.wire("bx", 8);
        for (let i = 0; i < 8; i++) place(b, "XOR", `bx${i}`, [B[i], SUB], bx[i]);
        const sum = b.wire("sum", 8);
        const carry = b.wire1("carry");
        b.use("ADDER_W8", { A, B: bx, CI: SUB, S: sum, CO: carry }, "add");
        const fn = {
          add: sum,
          and: A.map((a, i) => place(b, "AND", `and${i}`, [a, B[i]])),
          or: A.map((a, i) => place(b, "OR", `or${i}`, [a, B[i]])),
          xor: A.map((a, i) => place(b, "XOR", `xor${i}`, [a, B[i]])),
          not: A.map((a, i) => place(b, "NOT", `not${i}`, [a]))
        };
        const lines = b.wire("sel", 8);
        b.use("DEC3", { A: b.in("SEL"), EN: CONST1, Y: lines }, "dec");
        for (let i = 0; i < 8; i++) {
          const picked = ALU_FUNCS.map(([f, sel]) => place(b, "AND", `pick_${f}${i}`, [fn[f][i], lines[sel]]));
          const lo = place(b, "OR", `merge_a${i}`, [picked[0], picked[1]]);
          const hi = place(b, "OR", `merge_b${i}`, [picked[2], picked[3]]);
          const mid = place(b, "OR", `merge_c${i}`, [lo, hi]);
          place(b, "OR", `result${i}`, [mid, picked[4]], Y[i]);
        }
        place(b, "AND", "carry_out", [carry, lines[ALU_SEL.ADD]], b.out1("CO"));
        b.use("ZERO_W8", { A: Y, Z: b.out1("Z") }, "zero");
        place(b, "BUF", "sign", [Y[7]], b.out1("N"));
      },
      "8-bit ALU: SEL 0 = A + B (SUB: A + \xACB + 1, CO = 1 means no borrow), 1 = AND, 2 = OR, 3 = XOR, 4 = NOT A. CO is the adder carry only when SEL = 0; Z = (Y = 0); N = Y[7]."
    );
  }
  function defineRegfile(lib) {
    define(
      lib,
      "REGFILE",
      { in: { D: 8, WSEL: 2, WE: 1, RSEL: 2, CLK: 1 }, out: { Q: 8, R0: 8, R1: 8, R2: 8, R3: 8 } },
      (b) => {
        const [D, CLK] = [b.in("D"), b.in1("CLK")];
        const load = b.wire("load", 4);
        b.use("DEC2", { A: b.in("WSEL"), EN: b.in1("WE"), Y: load }, "wdec");
        const R = [0, 1, 2, 3].map((k) => b.out(`R${k}`));
        R.forEach((Q, k) => b.use("REG_W8", { D, LOAD: load[k], CLK, Q }, `r${k}`));
        b.use("MUX4_W8", { A: R[0], B: R[1], C: R[2], D: R[3], S: b.in("RSEL"), Y: b.out("Q") }, "rmux");
      },
      "Register file R0\u2013R3: R[WSEL] \u2190 D on the rising edge when WE = 1; Q = R[RSEL]"
    );
  }
  function defineRamRow(lib) {
    define(
      lib,
      "RAM_ROW",
      { in: { D: 8, WE: 1, SEL: 1 }, out: { Q: 8, RD: 8 } },
      (b) => {
        const [D, Q, RD, SEL] = [b.in("D"), b.out("Q"), b.out("RD"), b.in1("SEL")];
        const en = place(b, "AND", "wen", [b.in1("WE"), SEL]);
        for (let i = 0; i < 8; i++) b.use("DLATCH", { D: D[i], EN: en, Q: Q[i] }, `b${i}`);
        for (let i = 0; i < 8; i++) place(b, "AND", `rd${i}`, [Q[i], SEL], RD[i]);
      },
      "One RAM byte: 8 D latches open while WE\xB7SEL; RD = Q\xB7SEL (read gating)"
    );
  }
  function defineRam16(lib) {
    define(
      lib,
      "RAM16",
      { in: { ADDR: 4, DIN: 8, WE: 1, CLK: 1 }, out: { DOUT: 8 } },
      (b) => {
        const [DIN, DOUT] = [b.in("DIN"), b.out("DOUT")];
        const nclk = place(b, "NOT", "nclk", [b.in1("CLK")]);
        const we = place(b, "AND", "we_low", [nclk, b.in1("WE")]);
        const sel = b.wire("sel", 16);
        b.use("DEC4", { A: b.in("ADDR"), EN: CONST1, Y: sel }, "dec");
        const rd = [];
        for (let k = 0; k < 16; k++)
          rd.push(b.use("RAM_ROW", { D: DIN, WE: we, SEL: sel[k], Q: b.wire(`mem${k}`, 8), RD: b.wire(`rd${k}`, 8) }, `row${k}`).RD);
        for (let i = 0; i < 8; i++) {
          let level = rd.map((r) => r[i]);
          let depth = 1;
          while (level.length > 1) {
            const next = [];
            for (let j = 0; j < level.length; j += 2)
              next.push(place(b, "OR", `out${i}_${depth}_${j / 2}`, [level[j], level[j + 1]], level.length === 2 ? DOUT[i] : void 0));
            level = next;
            depth++;
          }
        }
      },
      "16 \xD7 8 RAM of D latches: row ADDR is written with DIN while CLK = 0 and WE = 1; DOUT = row ADDR"
    );
  }
  function definePc4(lib) {
    define(
      lib,
      "PC4",
      { in: { D: 4, LOAD: 1, INC: 1, RESET: 1, CLK: 1 }, out: { Q: 4 } },
      (b) => {
        const [D, Q, LOAD, RESET] = [b.in("D"), b.out("Q"), b.in1("LOAD"), b.in1("RESET")];
        const next = b.wire("next", 4);
        b.use("INC_W4", { A: Q, Y: next }, "inc");
        const pick = b.wire("pick", 4);
        b.use("MUX2_W4", { A: next, B: D, S: LOAD, Y: pick }, "src");
        const nrst = place(b, "NOT", "nrst", [RESET]);
        const d = pick.map((p, i) => place(b, "AND", `clr${i}`, [p, nrst]));
        const step = place(b, "OR", "step", [LOAD, b.in1("INC")]);
        const load = place(b, "OR", "load", [step, RESET]);
        b.use("REG_W4", { D: d, LOAD: load, CLK: b.in1("CLK"), Q }, "reg");
      },
      "4-bit program counter: PC \u2190 0 on RESET, \u2190 D on LOAD, \u2190 PC + 1 on INC"
    );
  }
  function defineTstate(lib) {
    define(
      lib,
      "TSTATE",
      { in: { T_RESET: 1, RESET: 1, HALTED: 1, CLK: 1 }, out: { Q: 3 } },
      (b) => {
        const [Q, RESET] = [b.out("Q"), b.in1("RESET")];
        const next = b.wire("next", 3);
        b.use("INC_W3", { A: Q, Y: next }, "inc");
        const clr = place(b, "OR", "clr", [b.in1("T_RESET"), RESET]);
        const keep = place(b, "NOT", "keep", [clr]);
        const d = next.map((n, i) => place(b, "AND", `d${i}`, [n, keep]));
        const run = place(b, "NOT", "run", [b.in1("HALTED")]);
        const load = place(b, "OR", "load", [run, RESET]);
        b.use("REG_W3", { D: d, LOAD: load, CLK: b.in1("CLK"), Q }, "reg");
      },
      "T-state counter: T \u2190 0 on RESET or T_RESET, else T + 1; holds while HALTED (unless RESET)"
    );
  }
  function defineHaltFf(lib) {
    define(
      lib,
      "HALT_FF",
      { in: { HALT: 1, RESET: 1, CLK: 1 }, out: { Q: 1 } },
      (b) => {
        const Q = b.out1("Q");
        const set = place(b, "OR", "set", [Q, b.in1("HALT")]);
        const nrst = place(b, "NOT", "nrst", [b.in1("RESET")]);
        const d = place(b, "AND", "d", [set, nrst]);
        b.use("DFF", { D: d, CLK: b.in1("CLK"), Q }, "ff");
      },
      "HALTED flip-flop: set by HALT, cleared by RESET (synchronous)"
    );
  }
  function defineBusmux(lib) {
    define(
      lib,
      "BUSMUX",
      {
        in: { PC: 4, PC_OUT: 1, MDR: 8, MDR_OUT: 1, REG: 8, REG_OUT: 1, Y: 8, Y_OUT: 1 },
        out: { BUS: 8 }
      },
      (b) => {
        const BUS = b.out("BUS");
        const drivers = [
          ["pc", b.in("PC"), b.in1("PC_OUT")],
          ["mdr", b.in("MDR"), b.in1("MDR_OUT")],
          ["reg", b.in("REG"), b.in1("REG_OUT")],
          ["y", b.in("Y"), b.in1("Y_OUT")]
        ];
        for (let i = 0; i < 8; i++) {
          const terms = drivers.filter(([, src]) => i < src.length).map(([name, src, en]) => place(b, "AND", `${name}${i}`, [src[i], en]));
          const ab = place(b, "OR", `or_a${i}`, [terms[0], terms[1]]);
          if (terms.length === 4) {
            const cd = place(b, "OR", `or_b${i}`, [terms[2], terms[3]]);
            place(b, "OR", `bus${i}`, [ab, cd], BUS[i]);
          } else place(b, "OR", `bus${i}`, [ab, terms[2]], BUS[i]);
        }
      },
      "The bus: BUS = PC\xB7PC_OUT + MDR\xB7MDR_OUT + REG\xB7REG_OUT + Y\xB7Y_OUT (PC drives bits 0\u20133 only)"
    );
  }
  function buildDatapath(lib) {
    defineAlu(lib);
    defineRegfile(lib);
    defineRamRow(lib);
    defineRam16(lib);
    definePc4(lib);
    defineTstate(lib);
    defineHaltFf(lib);
    defineBusmux(lib);
  }

  // src/cpu/cpu.ts
  function buildCpu(lib) {
    if (!lib.has("DLATCH")) buildCells(lib);
    if (!lib.has("CONTROL")) buildControl(lib);
    if (!lib.has("ALU")) buildDatapath(lib);
    define(
      lib,
      "CPU",
      { in: { CLK: 1, RESET: 1 }, out: { OUT: 8, SEG_LO: 7, SEG_HI: 7 } },
      (b) => {
        const [CLK, RESET, OUT] = [b.in1("CLK"), b.in1("RESET"), b.out("OUT")];
        const pc = b.wire("pc", 4);
        const mar = b.wire("mar", 4);
        const ir = b.wire("ir", 8);
        const mdr = b.wire("mdr", 8);
        const a = b.wire("a", 8);
        const y = b.wire("y", 8);
        const [z, c, n] = [b.wire1("flag_z"), b.wire1("flag_c"), b.wire1("flag_n")];
        const t = b.wire("t", 3);
        const halted = b.wire1("halted");
        const r = [0, 1, 2, 3].map((k) => b.wire(`r${k}`, 8));
        const bus = b.wire("bus", 8);
        const sig = Object.fromEntries(SIGNALS.map((s) => [s, b.wire1(s)]));
        const aluSel = b.wire("alu_sel", 3);
        const aluSub = b.wire1("alu_sub");
        b.use("PC4", { D: bus.slice(0, 4), LOAD: sig.PC_LOAD, INC: sig.PC_INC, RESET, CLK, Q: pc }, "pc");
        b.use("REG_W4", { D: bus.slice(0, 4), LOAD: sig.MAR_LOAD, CLK, Q: mar }, "mar");
        b.use("REG_W8", { D: bus, LOAD: sig.IR_LOAD, CLK, Q: ir }, "ir");
        const mdrIn = b.wire("mdr_in", 8);
        const mdrLoad = place(b, "OR", "mdr_load", [sig.MDR_LOAD, sig.MEM_READ]);
        b.use("REG_W8", { D: mdrIn, LOAD: mdrLoad, CLK, Q: mdr }, "mdr");
        b.use("REG_W8", { D: bus, LOAD: sig.A_LOAD, CLK, Q: a }, "alatch");
        const aluY = b.wire("alu_y", 8);
        const [aluZ, aluC, aluN] = [b.wire1("alu_z"), b.wire1("alu_c"), b.wire1("alu_n")];
        b.use("REG_W8", { D: aluY, LOAD: sig.Y_LOAD, CLK, Q: y }, "ylatch");
        b.use("DFFE", { D: aluZ, LOAD: sig.FLAGS_LOAD, CLK, Q: z }, "fz");
        b.use("DFFE", { D: aluC, LOAD: sig.FLAGS_LOAD, CLK, Q: c }, "fc");
        b.use("DFFE", { D: aluN, LOAD: sig.FLAGS_LOAD, CLK, Q: n }, "fn");
        b.use("TSTATE", { T_RESET: sig.T_RESET, RESET, HALTED: halted, CLK, Q: t }, "tstate");
        b.use("HALT_FF", { HALT: sig.HALT, RESET, CLK, Q: halted }, "halt");
        b.use(
          "CONTROL",
          __spreadProps(__spreadValues({ OP: ir.slice(4, 8), T: t, Z: z, C: c, N: n, HALTED: halted, RESET }, sig), { ALU_SEL: aluSel, ALU_SUB: aluSub }),
          "ctrl"
        );
        const rd = ir.slice(2, 4);
        const rs = ir.slice(0, 2);
        const rsel = b.wire("rsel", 2);
        for (let i = 0; i < 2; i++) b.use("MUX2", { A: rd[i], B: rs[i], S: sig.REG_OUT_S, Y: rsel[i] }, `rsel${i}`);
        const regQ = b.wire("reg_q", 8);
        b.use(
          "REGFILE",
          { D: bus, WSEL: rd, WE: sig.REG_LOAD_D, RSEL: rsel, CLK, Q: regQ, R0: r[0], R1: r[1], R2: r[2], R3: r[3] },
          "regs"
        );
        const regOut = place(b, "OR", "reg_out", [sig.REG_OUT_D, sig.REG_OUT_S]);
        b.use(
          "BUSMUX",
          { PC: pc, PC_OUT: sig.PC_OUT, MDR: mdr, MDR_OUT: sig.MDR_OUT, REG: regQ, REG_OUT: regOut, Y: y, Y_OUT: sig.Y_OUT, BUS: bus },
          "busmux"
        );
        b.use("ALU", { A: a, B: bus, SEL: aluSel, SUB: aluSub, Y: aluY, CO: aluC, Z: aluZ, N: aluN }, "alu");
        const ramOut = b.wire("ram_out", 8);
        b.use("MUX2_W8", { A: bus, B: ramOut, S: sig.MEM_READ, Y: mdrIn }, "mdr_src");
        b.use("RAM16", { ADDR: mar, DIN: mdr, WE: sig.MEM_WRITE, CLK, DOUT: ramOut }, "ram");
        const marLo = place(b, "AND", "mar_lo", [mar[0], mar[1]]);
        const marHi = place(b, "AND", "mar_hi", [mar[2], mar[3]]);
        const atOut = place(b, "AND", "at_out", [marLo, marHi]);
        const outLoad = place(b, "AND", "out_load", [sig.MEM_WRITE, atOut]);
        b.use("REG_W8", { D: mdr, LOAD: outLoad, CLK, Q: OUT }, "outreg");
        b.use("HEX7SEG", { A: OUT.slice(0, 4), SEG: b.out("SEG_LO") }, "seg_lo");
        b.use("HEX7SEG", { A: OUT.slice(4, 8), SEG: b.out("SEG_HI") }, "seg_hi");
      },
      "The CPU: 8-bit data, one shared bus, 16 bytes of RAM, R0\u2013R3, flags Z C N, a PLA control unit stepping T-states T0\u2013T7. OUT shows every store to address 15 on two hex digits."
    );
  }
  function cpuLibrary() {
    const lib = /* @__PURE__ */ new Map();
    buildCpu(lib);
    return lib;
  }
  function cpuNetlist() {
    return flatten(cpuLibrary(), "CPU");
  }

  // src/cpu/probes.ts
  var PROBES = {
    PC: { name: "pc", width: 4 },
    MAR: { name: "mar", width: 4 },
    MDR: { name: "mdr", width: 8 },
    IR: { name: "ir", width: 8 },
    R0: { name: "r0", width: 8 },
    R1: { name: "r1", width: 8 },
    R2: { name: "r2", width: 8 },
    R3: { name: "r3", width: 8 },
    A: { name: "a", width: 8 },
    Y: { name: "y", width: 8 },
    Z: { name: "flag_z", width: 1 },
    C: { name: "flag_c", width: 1 },
    N: { name: "flag_n", width: 1 },
    T: { name: "t", width: 3 },
    HALTED: { name: "halted", width: 1 },
    OUT: { name: "OUT", width: 8 },
    BUS: { name: "bus", width: 8 }
  };
  function ramBit(addr, bit) {
    if (addr < 0 || addr >= RAM_BYTES || bit < 0 || bit > 7) throw new Error(`no RAM bit ${addr}.${bit}`);
    return `ram/row${addr}/b${bit}/Q`;
  }

  // src/figma/names.ts
  var CELL_PREFIX = "cell/";
  var PIN_PREFIX = "pin/";
  var PORT_PREFIX = "port/";
  var WIRE_PREFIX = "wire/";
  var LIT = "lit";
  var LIT_SUFFIX = "/lit";
  var gateComponentName = (t) => `${GATE_PREFIX}${t}`;
  var cellComponentName = (module) => `${CELL_PREFIX}${module}`;
  var wireName = (net) => `${WIRE_PREFIX}${net}`;
  var wireLitName = (net) => `${WIRE_PREFIX}${net}${LIT_SUFFIX}`;
  var pinName = (port) => `${PIN_PREFIX}${port}`;
  var portMarkerName = (p) => `${PORT_PREFIX}${p.dir}/${p.name}/${p.width}`;
  var MARKER_RE = /^port\/(in|out)\/([A-Za-z_]\w*)\/([1-9]\d*)$/;
  function parsePortMarker(name) {
    const m = MARKER_RE.exec(name);
    return m ? { name: m[2], dir: m[1], width: Number(m[3]) } : null;
  }
  function wireLitNet(layerName) {
    return layerName.startsWith(WIRE_PREFIX) && layerName.endsWith(LIT_SUFFIX) && layerName.length > WIRE_PREFIX.length + LIT_SUFFIX.length ? layerName.slice(WIRE_PREFIX.length, -LIT_SUFFIX.length) : null;
  }
  function propName(key) {
    const i = key.lastIndexOf("#");
    return i < 0 ? key : key.slice(0, i);
  }
  var BIT_RE = /^(.+)\[(\d+)\]$/;
  function formatNets(nets) {
    const parts = [];
    let i = 0;
    while (i < nets.length) {
      const m = BIT_RE.exec(nets[i]);
      if (m) {
        const base = m[1];
        const start = Number(m[2]);
        let j = i + 1;
        let step = 0;
        while (j < nets.length) {
          const n = BIT_RE.exec(nets[j]);
          if (!n || n[1] !== base) break;
          const d = Number(n[2]) - Number(BIT_RE.exec(nets[j - 1])[2]);
          if (step === 0 && (d === 1 || d === -1)) step = d;
          if (d !== step) break;
          j++;
        }
        if (j - i >= 2) {
          parts.push(`${base}[${start}:${start + step * (j - i - 1)}]`);
          i = j;
          continue;
        }
      }
      parts.push(nets[i]);
      i++;
    }
    return parts.join(", ");
  }

  // src/figma/style.ts
  var C = {
    bg: "#141414",
    card: "#1E1E1E",
    cell: "#262626",
    stroke: "#333333",
    text: "#E8E8E8",
    dim: "#8C8C8C",
    gate: "#BDBDBD",
    lead: "#8C8C8C",
    wire: "#5E5E5E",
    net: "#D9A441",
    lit: "#F5C542"
  };
  function rgb(hex3) {
    const n = parseInt(hex3.slice(1), 16);
    return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 };
  }
  function solid(hex3, opacity = 1) {
    return [{ type: "SOLID", color: rgb(hex3), opacity }];
  }
  var fonts = null;
  async function loadFonts() {
    if (fonts) return fonts;
    const sans = { family: "Inter", style: "Regular" };
    const bold = { family: "Inter", style: "Bold" };
    await figma.loadFontAsync(sans);
    await figma.loadFontAsync(bold);
    let mono = { family: "Roboto Mono", style: "Regular" };
    try {
      await figma.loadFontAsync(mono);
    } catch (e) {
      mono = sans;
    }
    fonts = { sans, bold, mono };
    return fonts;
  }
  function addText(parent, name, chars, x, y, o = {}) {
    var _a, _b, _c;
    if (!fonts) throw new Error("addText before loadFonts()");
    const t = figma.createText();
    parent.appendChild(t);
    t.name = name;
    t.fontName = fonts[(_a = o.font) != null ? _a : "sans"];
    t.fontSize = (_b = o.size) != null ? _b : 12;
    t.characters = chars;
    t.fills = solid((_c = o.color) != null ? _c : C.text);
    t.x = x;
    t.y = y;
    return t;
  }
  function textWidth(s, size) {
    return Math.ceil(s.length * size * 0.62);
  }
  function unwrapSvg(parent, svg, x = 0, y = 0) {
    const f = figma.createNodeFromSvg(svg);
    parent.appendChild(f);
    f.x = x;
    f.y = y;
    const out = [];
    for (const c of [...f.children]) {
      const cx = f.x + c.x;
      const cy = f.y + c.y;
      parent.appendChild(c);
      c.x = cx;
      c.y = cy;
      out.push(c);
    }
    f.remove();
    return out;
  }

  // src/figma/layout.ts
  var GRID = 8;
  var PITCH = 16;
  var STUB = 16;
  var BAND = 16;
  var TITLE_H = 48;
  var PAD = 16;
  var NAME_SIZE = 9;
  var NET_SIZE = 8;
  var ROW_GAP = 24;
  var PORT_GAP = 8;
  var MIN_CHANNEL = 32;
  var MAX_CHANNEL = 192;
  var LABEL_CHANNEL = 48;
  var up = (v) => Math.ceil(v / GRID) * GRID;
  var portMarkerHeight = (width) => BAND + width * PITCH;
  var bitOffset = (i) => BAND + PITCH / 2 + i * PITCH;
  function portMarkerWidth(p) {
    const name = textWidth(p.name, NAME_SIZE);
    return up(
      p.dir === "in" ? Math.max(STUB + 8, 2 + name + 4 + textWidth(formatNets(portBits(p)), NET_SIZE) + 4) : Math.max(STUB + 8, 6 + name + 4 + STUB)
    );
  }
  function moduleGeom(ports, w, h, markerY) {
    const pins = /* @__PURE__ */ new Map();
    const outLabels = /* @__PURE__ */ new Map();
    ports.forEach((p, i) => {
      portBits(p).forEach((b, k) => pins.set(b, { x: p.dir === "in" ? 0 : w, y: markerY[i] + bitOffset(k), dir: p.dir }));
      if (p.dir === "out") outLabels.set(p.name, { x: w - STUB + 2, y: markerY[i] + 4, h: 11, size: NET_SIZE });
    });
    return { w, h, ports, pins, outLabels };
  }
  function layoutModule(def, geomOf, opts = {}) {
    var _a, _b, _c, _d;
    const n = def.instances.length;
    const geoms = def.instances.map((i) => geomOf(i.cell));
    const nets = /* @__PURE__ */ new Map();
    const info = (name) => {
      let x = nets.get(name);
      if (!x) nets.set(name, x = { name, driver: null, sinks: [] });
      return x;
    };
    def.ports.forEach(
      (p, pi) => portBits(p).forEach((b, k) => {
        const e = { inst: -1, key: b, port: pi, k };
        const x = info(b);
        if (p.dir === "out") x.sinks.push(e);
        else if (!x.driver) x.driver = e;
      })
    );
    def.instances.forEach((inst, ii) => {
      var _a2;
      for (const p of geoms[ii].ports) {
        const bits = portBits(p);
        ((_a2 = inst.conn[p.name]) != null ? _a2 : []).forEach((net, k) => {
          if (net === CONST0 || net === CONST1 || k >= bits.length) return;
          const e = { inst: ii, key: bits[k], port: -1, k };
          const x = info(net);
          if (p.dir === "in") x.sinks.push(e);
          else if (!x.driver) x.driver = e;
        });
      }
    });
    const preds = def.instances.map(() => []);
    for (const x of nets.values())
      if (x.driver && x.driver.inst >= 0) {
        for (const s of x.sinks) if (s.inst >= 0) preds[s.inst].push(x.driver.inst);
      }
    const depth = new Int32Array(n).fill(-1);
    const onStack = new Uint8Array(n);
    const visit = (i) => {
      if (depth[i] >= 0) return depth[i];
      if (onStack[i]) return -1;
      onStack[i] = 1;
      let d = 0;
      for (const j of preds[i]) d = Math.max(d, visit(j));
      onStack[i] = 0;
      return depth[i] = d + 1;
    };
    for (const p of def.ports)
      if (p.dir === "out")
        for (const b of portBits(p)) {
          const d = (_a = nets.get(b)) == null ? void 0 : _a.driver;
          if (d && d.inst >= 0) visit(d.inst);
        }
    for (let i = 0; i < n; i++) visit(i);
    const nLogical = n ? Math.max(...depth) : 0;
    const logical = Array.from({ length: nLogical }, () => []);
    for (let i = 0; i < n; i++) logical[depth[i] - 1].push(i);
    let sinkCount = 0;
    for (const x of nets.values()) if (x.driver) sinkCount += x.sinks.length;
    const wired = opts.wires === true || opts.wires !== false && n <= ((_b = opts.maxWiredInstances) != null ? _b : 40) && sinkCount <= ((_c = opts.maxWiredSinks) != null ? _c : 240);
    const area = geoms.reduce((a, g) => a + g.w * g.h, 0);
    const maxColH = wired ? 4800 : Math.max(1200, 1.5 * Math.sqrt(area));
    const cols = [];
    for (const col of logical) {
      const hsum = col.reduce((a, i) => a + geoms[i].h + ROW_GAP, 0);
      const parts = Math.max(1, Math.ceil(hsum / maxColH));
      const per = Math.ceil(col.length / parts);
      for (let k = 0; k < col.length; k += per) cols.push(col.slice(k, k + per));
    }
    const ncol = cols.length;
    const colOf = new Int32Array(n);
    cols.forEach((c, ci) => c.forEach((i) => colOf[i] = ci));
    const tracks = Array.from({ length: ncol + 1 }, () => /* @__PURE__ */ new Set());
    for (const x of nets.values()) {
      if (!x.driver || !x.sinks.length) continue;
      for (const s of x.sinks) tracks[s.inst >= 0 ? colOf[s.inst] : ncol].add(x.name);
      tracks[x.driver.inst >= 0 ? colOf[x.driver.inst] + 1 : 0].add(x.name);
    }
    const chan = tracks.map(
      (t) => wired ? Math.min(MAX_CHANNEL, Math.max(MIN_CHANNEL, up(GRID * (t.size + 3)))) : LABEL_CHANNEL
    );
    const ins = def.ports.map((p, i) => ({ p, i })).filter((x) => x.p.dir === "in");
    const outs = def.ports.map((p, i) => ({ p, i })).filter((x) => x.p.dir === "out");
    const markerW = def.ports.map(portMarkerWidth);
    const inW = Math.max(0, ...ins.map((x) => markerW[x.i]));
    const outW = Math.max(0, ...outs.map((x) => markerW[x.i]));
    const colW = cols.map((c) => Math.max(...c.map((i) => geoms[i].w)));
    const colX = [];
    let cx = up(Math.max(STUB, inW) + chan[0]);
    for (let c = 0; c < ncol; c++) {
      colX.push(cx);
      cx += colW[c] + chan[c + 1];
    }
    const lastRight = ncol ? colX[ncol - 1] + colW[ncol - 1] : Math.max(inW, STUB);
    const W = up(Math.max(lastRight + chan[ncol] + Math.max(STUB, outW), inW + outW + 4 * GRID, ((_d = opts.titleWidth) != null ? _d : 0) + 2 * PAD));
    const instY = new Float64Array(n);
    const portY = new Float64Array(def.ports.length);
    const pinY = (e) => e.inst >= 0 ? instY[e.inst] + geoms[e.inst].pins.get(e.key).y : portY[e.port] + bitOffset(e.k);
    const stack = (list, want) => {
      let cursor = TITLE_H;
      for (const { p, i } of list) {
        const w = want(i);
        portY[i] = up(Math.max(cursor, Number.isNaN(w) ? cursor : w));
        cursor = portY[i] + portMarkerHeight(p.width) + PORT_GAP;
      }
    };
    stack(ins, () => NaN);
    stack(outs, () => NaN);
    const pinsOf = (dir) => def.instances.map((inst, ii) => {
      var _a2;
      const out = [];
      for (const p of geoms[ii].ports) {
        if (p.dir !== dir) continue;
        const bits = portBits(p);
        ((_a2 = inst.conn[p.name]) != null ? _a2 : []).forEach((net, k) => {
          const x = nets.get(net);
          if (x && k < bits.length) out.push({ key: bits[k], net: x });
        });
      }
      return out;
    });
    const inputPins = pinsOf("in");
    const outputPins = pinsOf("out");
    const mean = (v) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
    for (let pass = 0; pass < 3; pass++) {
      for (let c = 0; c < ncol; c++) {
        const items = cols[c].map((i) => {
          const back = [];
          const fwd = [];
          for (const { key, net } of inputPins[i]) {
            const d = net.driver;
            if (d && (d.inst < 0 || colOf[d.inst] < c)) back.push(pinY(d) - geoms[i].pins.get(key).y);
          }
          if (pass > 0) {
            for (const { key, net } of outputPins[i])
              for (const s of net.sinks)
                if (s.inst < 0 || colOf[s.inst] > c) fwd.push(pinY(s) - geoms[i].pins.get(key).y);
          }
          return { i, want: mean([mean(back), mean(fwd)].filter((v) => !Number.isNaN(v))) };
        });
        items.sort((a, b) => (Number.isNaN(a.want) ? 1e12 : a.want) - (Number.isNaN(b.want) ? 1e12 : b.want) || a.i - b.i);
        let cursor = TITLE_H;
        for (const { i, want } of items) {
          instY[i] = up(Math.max(cursor, Number.isNaN(want) ? cursor : want));
          cursor = instY[i] + geoms[i].h + ROW_GAP;
        }
      }
      const portWant = (i) => {
        const p = def.ports[i];
        const ys = [];
        portBits(p).forEach((b, k) => {
          const x = nets.get(b);
          if (!x) return;
          const ends = p.dir === "in" ? x.sinks : x.driver ? [x.driver] : [];
          for (const e of ends) if (e.inst >= 0) ys.push(pinY(e) - bitOffset(k));
        });
        return mean(ys);
      };
      stack(ins, portWant);
      stack(outs, portWant);
    }
    let top = Infinity;
    for (let i = 0; i < n; i++) top = Math.min(top, instY[i]);
    for (let i = 0; i < def.ports.length; i++) top = Math.min(top, portY[i]);
    if (Number.isFinite(top) && top > TITLE_H) {
      for (let i = 0; i < n; i++) instY[i] -= top - TITLE_H;
      for (let i = 0; i < def.ports.length; i++) portY[i] -= top - TITLE_H;
    }
    let bottom = TITLE_H;
    for (let i = 0; i < n; i++) bottom = Math.max(bottom, instY[i] + geoms[i].h);
    def.ports.forEach((p, i) => bottom = Math.max(bottom, portY[i] + portMarkerHeight(p.width)));
    let feedback = 0;
    if (wired)
      for (const x of nets.values()) {
        const d = x.driver;
        if (d && d.inst >= 0 && x.sinks.some((s) => s.inst >= 0 && colOf[s.inst] <= colOf[d.inst])) feedback++;
      }
    const H = up(bottom + PAD + feedback * GRID);
    const instances = def.instances.map((d, i) => ({ def: d, x: colX[colOf[i]], y: instY[i], geom: geoms[i], col: colOf[i] }));
    const ports = def.ports.map((p, i) => ({
      def: p,
      x: p.dir === "in" ? 0 : W - markerW[i],
      y: portY[i],
      w: markerW[i],
      h: portMarkerHeight(p.width)
    }));
    const geom = moduleGeom(def.ports, W, H, Array.from(portY));
    const endPoint = (e) => e.inst >= 0 ? { x: instances[e.inst].x + geoms[e.inst].pins.get(e.key).x, y: pinY(e) } : { x: def.ports[e.port].dir === "in" ? STUB : W - STUB, y: pinY(e) };
    const fromRight = (e) => e.inst >= 0 ? geoms[e.inst].pins.get(e.key).dir === "out" : def.ports[e.port].dir === "in";
    const jobs = [...nets.values()].filter((x) => x.driver && x.sinks.length).map((x, id) => {
      const ends = [x.driver, ...x.sinks];
      const pts = ends.map(endPoint);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { x, id, ends, pts, hpwl: Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) };
    });
    const attempt = (order) => {
      var _a2;
      const router = new Router(W, H);
      if (!router.ok) return null;
      router.blockRect(0, 0, W, TITLE_H - GRID);
      router.blockRect(0, 0, STUB, H);
      router.blockRect(W - STUB, 0, W, H);
      for (const pl of ports) router.blockRect(pl.x, pl.y, pl.x + pl.w, pl.y + BAND);
      for (const pi of instances) {
        router.blockRect(pi.x, pi.y, pi.x + pi.geom.w, pi.y + pi.geom.h);
        for (const [port, a] of pi.geom.outLabels) {
          const right = a.x + textWidth(formatNets((_a2 = pi.def.conn[port]) != null ? _a2 : []), a.size);
          if (right > pi.geom.w) router.blockInside(pi.x + pi.geom.w, pi.y + a.y, pi.x + right, pi.y + a.y + a.h);
        }
        for (const [, pin] of pi.geom.pins) router.markPin(pi.x + pin.x, pi.y + pin.y, pin.dir === "out", -1);
      }
      for (const pl of ports)
        portBits(pl.def).forEach(
          (_, k) => router.markPin(pl.def.dir === "in" ? STUB : W - STUB, pl.y + bitOffset(k), pl.def.dir === "in", -1)
        );
      for (const j of jobs) j.ends.forEach((e, k) => router.markPin(j.pts[k].x, j.pts[k].y, fromRight(e), j.id));
      const out = /* @__PURE__ */ new Map();
      for (const j of order) {
        const w = router.routeNet(j.id, j.pts[0], j.pts.slice(1));
        if (w) out.set(j.x.name, __spreadValues({ net: j.x.name }, w));
      }
      return out;
    };
    let routed = null;
    if (wired && jobs.length) {
      jobs.sort((a, b) => a.hpwl - b.hpwl || a.id - b.id);
      routed = attempt(jobs);
      if (routed && routed.size < jobs.length) {
        const failed = jobs.filter((j) => !routed.has(j.x.name));
        const retry = attempt([...failed, ...jobs.filter((j) => routed.has(j.x.name))]);
        if (retry.size > routed.size) routed = retry;
      }
    }
    const wires = [];
    const labeled = [];
    for (const x of nets.values()) {
      if (!x.sinks.length) continue;
      const w = routed == null ? void 0 : routed.get(x.name);
      if (w) wires.push(w);
      else labeled.push(x.name);
    }
    const mode = wired && (routed || !jobs.length) ? "wires" : "labels";
    return { name: def.name, w: W, h: H, ports, instances, wires, labeled, mode, geom };
  }
  var DX = [1, -1, 0, 0];
  var DY = [0, 0, 1, -1];
  var BEND = 6;
  var CROSS = 10;
  var NOBODY = 2147483647;
  var MAX_NODES = 6e5;
  var WINDOW = 14;
  var Heap = class {
    constructor() {
      this.k = [];
      this.v = [];
    }
    get size() {
      return this.v.length;
    }
    clear() {
      this.k.length = 0;
      this.v.length = 0;
    }
    push(key, val) {
      const { k, v } = this;
      let i = v.length;
      k.push(key);
      v.push(val);
      while (i > 0) {
        const p = i - 1 >> 1;
        if (k[p] <= key) break;
        k[i] = k[p];
        v[i] = v[p];
        i = p;
      }
      k[i] = key;
      v[i] = val;
    }
    pop() {
      const { k, v } = this;
      const top = v[0];
      const lk = k.pop();
      const lv = v.pop();
      const n = v.length;
      if (n) {
        let i = 0;
        for (; ; ) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c];
          v[i] = v[c];
          i = c;
        }
        k[i] = lk;
        v[i] = lv;
      }
      return top;
    }
  };
  var Router = class {
    constructor(w, h) {
      this.stamp = 0;
      this.heap = new Heap();
      this.nx = w / GRID + 1;
      this.ny = h / GRID + 1;
      const size = this.nx * this.ny;
      this.ok = size <= MAX_NODES;
      if (!this.ok) return;
      this.blocked = new Uint8Array(size);
      this.pin = new Int32Array(size);
      this.reserve = new Int32Array(size);
      this.occH = new Int32Array(size);
      this.occV = new Int32Array(size);
      this.corner = new Int32Array(size);
      this.tree = new Int32Array(size);
      this.g = new Int32Array(size * 4);
      this.prev = new Int32Array(size * 4);
      this.seen = new Int32Array(size * 4);
      this.closed = new Int32Array(size * 4);
    }
    node(x, y) {
      const gx = Math.round(x / GRID);
      const gy = Math.round(y / GRID);
      return gx < 0 || gy < 0 || gx >= this.nx || gy >= this.ny ? -1 : gy * this.nx + gx;
    }
    /** Blocks every grid node in the closed rectangle (px; edges snap outward). */
    blockRect(x0, y0, x1, y1) {
      this.fill(Math.floor(x0 / GRID), Math.floor(y0 / GRID), Math.ceil(x1 / GRID), Math.ceil(y1 / GRID));
    }
    /** Blocks only grid nodes strictly covered by the rectangle (edges snap inward). */
    blockInside(x0, y0, x1, y1) {
      this.fill(Math.ceil(x0 / GRID), Math.ceil(y0 / GRID), Math.floor(x1 / GRID), Math.floor(y1 / GRID));
    }
    fill(gx0, gy0, gx1, gy1) {
      for (let gy = Math.max(0, gy0); gy <= Math.min(this.ny - 1, gy1); gy++)
        for (let gx = Math.max(0, gx0); gx <= Math.min(this.nx - 1, gx1); gx++) this.blocked[gy * this.nx + gx] = 1;
    }
    /** Marks a pin and reserves the grid node in front of it (to its right if `fromRight`) for
     * the pin's net; net = -1 marks it for nobody (unrouted pins stay clear too). */
    markPin(x, y, fromRight, net) {
      const p = this.node(x, y);
      if (p < 0) return;
      const gx = p % this.nx;
      const a = fromRight ? gx + 1 < this.nx ? p + 1 : -1 : gx > 0 ? p - 1 : -1;
      const v = net < 0 ? NOBODY : net + 1;
      if (net >= 0 || !this.pin[p]) this.pin[p] = v;
      if (a >= 0 && (net >= 0 || !this.reserve[a])) this.reserve[a] = v;
    }
    /** Routes one net from its driver pin to each sink pin. Returns null (and leaves the grid
     * untouched) if any sink cannot be reached. */
    routeNet(net, drv, sinks) {
      const K = net + 1;
      const d = this.node(drv.x, drv.y);
      if (d < 0) return null;
      const touched = [d];
      this.tree[d] = K;
      const bb = { x0: d % this.nx, y0: Math.floor(d / this.nx), x1: d % this.nx, y1: Math.floor(d / this.nx) };
      const paths = [];
      const junctions = [];
      const order = sinks.map((s) => ({ s, dist: Math.abs(s.x - drv.x) + Math.abs(s.y - drv.y) })).sort((a, b) => a.dist - b.dist);
      for (const { s } of order) {
        const start = this.node(s.x, s.y);
        let states = start < 0 ? null : this.search(start, K, d, bb, true);
        if (!states && start >= 0) states = this.search(start, K, d, bb, false);
        if (!states) {
          for (const t of touched) {
            if (this.occH[t] === K) this.occH[t] = 0;
            if (this.occV[t] === K) this.occV[t] = 0;
            if (this.corner[t] === K) this.corner[t] = 0;
            if (this.tree[t] === K) this.tree[t] = 0;
          }
          return null;
        }
        const nodes = states.map((x) => x >> 2);
        const dirs = states.map((x) => x & 3);
        const pts = [this.point(nodes[0])];
        for (let i = 1; i < nodes.length; i++) {
          const axis = dirs[i] < 2 ? this.occH : this.occV;
          axis[nodes[i - 1]] = K;
          axis[nodes[i]] = K;
          touched.push(nodes[i]);
          if (i < nodes.length - 1 && dirs[i + 1] !== dirs[i]) {
            this.corner[nodes[i]] = K;
            pts.push(this.point(nodes[i]));
          }
        }
        const end = nodes[nodes.length - 1];
        pts.push(this.point(end));
        if (end !== d) {
          this.corner[end] = K;
          junctions.push(this.point(end));
        }
        for (let i = 1; i < nodes.length; i++) {
          const q = nodes[i];
          this.tree[q] = K;
          const qx = q % this.nx;
          const qy = (q - qx) / this.nx;
          bb.x0 = Math.min(bb.x0, qx);
          bb.x1 = Math.max(bb.x1, qx);
          bb.y0 = Math.min(bb.y0, qy);
          bb.y1 = Math.max(bb.y1, qy);
        }
        paths.push(pts);
      }
      return { paths, junctions };
    }
    point(p) {
      const gx = p % this.nx;
      return { x: gx * GRID, y: (p - gx) / this.nx * GRID };
    }
    /** Can the search stop at tree node p, arriving in direction d? */
    isStop(p, d, K, drv) {
      if (p === drv) return d === 1;
      if (this.pin[p]) return false;
      const h = this.occH[p];
      const v = this.occV[p];
      return !(h && h !== K || v && v !== K);
    }
    enterable(q, nd, K) {
      if (this.blocked[q] || this.pin[q]) return false;
      const r = this.reserve[q];
      if (r && r !== K) return false;
      const c = this.corner[q];
      if (c && c !== K) return false;
      const same = nd < 2 ? this.occH[q] : this.occV[q];
      return !(same && same !== K);
    }
    /** A* from a sink pin (leaving it leftwards) to any node of the net's tree. */
    search(start, K, drv, bb, windowed) {
      const { nx, ny, heap, g, prev, seen, closed } = this;
      const st = ++this.stamp;
      const sx = start % nx;
      const sy = (start - sx) / nx;
      const m = windowed ? WINDOW : nx + ny;
      const wx0 = Math.max(0, Math.min(sx, bb.x0) - m);
      const wx1 = Math.min(nx - 1, Math.max(sx, bb.x1) + m);
      const wy0 = Math.max(0, Math.min(sy, bb.y0) - m);
      const wy1 = Math.min(ny - 1, Math.max(sy, bb.y1) + m);
      const h = (qx, qy) => Math.max(0, bb.x0 - qx, qx - bb.x1) + Math.max(0, bb.y0 - qy, qy - bb.y1);
      heap.clear();
      const s0 = start * 4 + 1;
      seen[s0] = st;
      g[s0] = 0;
      prev[s0] = -1;
      heap.push(h(sx, sy), s0);
      let budget = 4 * (wx1 - wx0 + 1) * (wy1 - wy0 + 1) + 64;
      while (heap.size) {
        const s = heap.pop();
        if (closed[s] === st) continue;
        closed[s] = st;
        const p = s >> 2;
        const d = s & 3;
        if (p !== start && this.tree[p] === K && this.isStop(p, d, K, drv)) {
          const out = [];
          for (let x = s; x !== -1; x = prev[x]) out.push(x);
          return out.reverse();
        }
        if (--budget < 0) return null;
        const px = p % nx;
        const py = (p - px) / nx;
        const bendOk = p !== start && !this.pin[p] && !this.occH[p] && !this.occV[p] && !this.corner[p];
        for (let nd = 0; nd < 4; nd++) {
          if (nd === (d ^ 1) || nd !== d && !bendOk) continue;
          const qx = px + DX[nd];
          const qy = py + DY[nd];
          if (qx < wx0 || qx > wx1 || qy < wy0 || qy > wy1) continue;
          const q = qy * nx + qx;
          let cost = 1 + (nd !== d ? BEND : 0);
          if (!(this.tree[q] === K && this.isStop(q, nd, K, drv))) {
            if (!this.enterable(q, nd, K)) continue;
            const other = nd < 2 ? this.occV[q] : this.occH[q];
            if (other && other !== K) cost += CROSS;
          }
          const ns = q * 4 + nd;
          const ng = g[s] + cost;
          if (seen[ns] !== st || ng < g[ns]) {
            seen[ns] = st;
            g[ns] = ng;
            prev[ns] = s;
            heap.push(ng + h(qx, qy), ns);
          }
        }
      }
      return null;
    }
  };

  // src/figma/symbols.ts
  var GATE_W = 96;
  var GATE_H = 48;
  var PIN_Y = { A: 16, B: 32, Y: 24 };
  var PIN_Y1 = { A: 24, Y: 24 };
  var NET_LABEL_SIZE = 7;
  function gateGeom(type) {
    const ports = gatePorts(type);
    const ys = GATE_ARITY[type] === 1 ? PIN_Y1 : PIN_Y;
    const pins = /* @__PURE__ */ new Map();
    for (const p of ports) pins.set(p.name, { x: p.dir === "in" ? 0 : GATE_W, y: ys[p.name], dir: p.dir });
    const outLabels = /* @__PURE__ */ new Map([["Y", { x: outLead(type) + 2, y: 14, h: 9, size: NET_LABEL_SIZE }]]);
    return { w: GATE_W, h: GATE_H, ports, pins, outLabels };
  }
  var bubble = (cx) => `M ${cx + 4} 24 A 4 4 0 1 1 ${cx - 4} 24 A 4 4 0 1 1 ${cx + 4} 24 Z`;
  var AND_BODY = "M 24 6 L 48 6 A 18 18 0 0 1 48 42 L 24 42 Z";
  var OR_BODY = "M 22 6 Q 52 6 68 24 Q 52 42 22 42 Q 32 24 22 6 Z";
  var BUF_BODY = "M 26 8 L 62 24 L 26 40 Z";
  function body(t) {
    switch (t) {
      case "AND":
        return AND_BODY;
      case "NAND":
        return `${AND_BODY} ${bubble(70)}`;
      case "OR":
      case "XOR":
        return OR_BODY;
      case "NOR":
      case "XNOR":
        return `${OR_BODY} ${bubble(72)}`;
      case "BUF":
        return BUF_BODY;
      case "NOT":
        return `${BUF_BODY} ${bubble(66)}`;
    }
  }
  function outLead(t) {
    return { AND: 66, NAND: 74, OR: 68, XOR: 68, NOR: 76, XNOR: 76, BUF: 62, NOT: 70 }[t];
  }
  var BACK_EDGE = { AND: 24, NAND: 24, OR: 26, NOR: 26, XOR: 20, XNOR: 20 };
  function leads(t) {
    var _a;
    const out = `M ${outLead(t)} 24 L 96 24`;
    if (GATE_ARITY[t] === 1) return `M 0 24 L 26 24 ${out}`;
    const back = (_a = BACK_EDGE[t]) != null ? _a : 24;
    const arc = t === "XOR" || t === "XNOR" ? " M 16 6 Q 26 24 16 42" : "";
    return `M 0 16 L ${back} 16 M 0 32 L ${back} 32 ${out}${arc}`;
  }
  var svgDoc = (paths) => `<svg width="${GATE_W}" height="${GATE_H}" viewBox="0 0 ${GATE_W} ${GATE_H}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  function gateSymbolSvg(t) {
    return svgDoc(
      `<path d="${body(t)}" fill="${C.cell}" stroke="${C.gate}" stroke-width="1.5"/><path d="${leads(t)}" fill="none" stroke="${C.lead}" stroke-width="1.5"/>`
    );
  }
  function gateLitSvg(t) {
    return svgDoc(
      `<path d="${body(t)} M ${outLead(t)} 24 L 96 24" fill="${C.lit}" fill-opacity="0.22" stroke="${C.lit}" stroke-width="2"/>`
    );
  }
  var DOC = {
    BUF: "Buffer. Y = A",
    NOT: "Inverter. Y = \xACA",
    AND: "Y = A\xB7B",
    OR: "Y = A + B",
    NAND: "Y = \xAC(A\xB7B)",
    NOR: "Y = \xAC(A + B)",
    XOR: "Y = A \u2295 B",
    XNOR: "Y = \xAC(A \u2295 B)"
  };
  async function drawGates(page, opts = {}) {
    await figma.setCurrentPageAsync(page);
    await loadFonts();
    const out = /* @__PURE__ */ new Map();
    const existing = /* @__PURE__ */ new Map();
    for (const n of page.children) if (n.type === "COMPONENT") existing.set(n.name, n);
    GATE_TYPES.forEach((t, i) => {
      const name = gateComponentName(t);
      const old = existing.get(name);
      if (old && !opts.redraw) {
        out.set(t, old);
        return;
      }
      const x = old ? old.x : i * (GATE_W + 48);
      const y = old ? old.y : 0;
      if (old) old.remove();
      const comp = drawGate(t, opts.labels !== false);
      page.appendChild(comp);
      comp.x = x;
      comp.y = y;
      out.set(t, comp);
    });
    return out;
  }
  function drawGate(t, labels) {
    const comp = figma.createComponent();
    comp.name = gateComponentName(t);
    comp.resize(GATE_W, GATE_H);
    comp.fills = [];
    comp.clipsContent = false;
    comp.description = DOC[t];
    const [b, l] = unwrapSvg(comp, gateSymbolSvg(t));
    b.name = "body";
    if (l) l.name = "leads";
    const [lit3] = unwrapSvg(comp, gateLitSvg(t));
    lit3.name = LIT;
    lit3.visible = false;
    const geom = gateGeom(t);
    for (const p of geom.ports) {
      const pin = geom.pins.get(p.name);
      const r = figma.createRectangle();
      comp.appendChild(r);
      r.name = pinName(p.name);
      r.resize(4, 4);
      r.x = pin.x - 2;
      r.y = pin.y - 2;
      r.cornerRadius = 1;
      r.fills = solid(C.lead);
    }
    for (const p of geom.ports) {
      const key = comp.addComponentProperty(p.name, "TEXT", p.name);
      if (!labels) continue;
      const pin = geom.pins.get(p.name);
      const x = p.dir === "in" ? 2 : outLead(t) + 2;
      const txt = addText(comp, `label/${p.name}`, p.name, x, pin.y - 10, { size: NET_LABEL_SIZE, font: "mono", color: C.dim });
      txt.componentPropertyReferences = { characters: key };
    }
    return comp;
  }

  // src/figma/draw.ts
  function dependencyOrder(lib, roots = lib.keys()) {
    const out = [];
    const state = /* @__PURE__ */ new Map();
    const visit = (name, from) => {
      if (isGateCell(name)) return;
      const s = state.get(name);
      if (s === 2) return;
      if (s === 1) throw new Error(`module ${name} contains itself (via ${from})`);
      const def = lib.get(name);
      if (!def) throw new Error(`${from}: unknown cell ${name}`);
      state.set(name, 1);
      for (const i of def.instances) visit(i.cell, name);
      state.set(name, 2);
      out.push(name);
    };
    for (const r of roots) visit(r, "(root)");
    return out;
  }
  var ROW_LIMIT = 6e3;
  var GAP = 96;
  async function drawLibrary(lib, pages, opts = {}) {
    var _a, _b, _c;
    const gates = await drawGates(pages.gates, { labels: opts.gateLabels });
    await loadFonts();
    const order = dependencyOrder(lib, opts.only);
    const cpuName = (_a = opts.cpuModule) != null ? _a : "CPU";
    const existing = /* @__PURE__ */ new Map();
    for (const page of /* @__PURE__ */ new Set([pages.cells, pages.cpu])) {
      await page.loadAsync();
      for (const n of page.children)
        if (n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX)) existing.set(n.name.slice(CELL_PREFIX.length), n);
    }
    if (opts.redraw)
      for (const name of order) {
        (_b = existing.get(name)) == null ? void 0 : _b.remove();
        existing.delete(name);
      }
    const cells = /* @__PURE__ */ new Map();
    const geoms = /* @__PURE__ */ new Map();
    const layouts = /* @__PURE__ */ new Map();
    const reused = [];
    const geomOf = (cell) => {
      if (isGateCell(cell)) return gateGeom(gateTypeOf(cell));
      const g = geoms.get(cell);
      if (!g) throw new Error(`no geometry for ${cell}`);
      return g;
    };
    const mainOf = (cell) => {
      const m = isGateCell(cell) ? gates.get(gateTypeOf(cell)) : cells.get(cell);
      if (!m) throw new Error(`no component for ${cell}`);
      return m;
    };
    const shelves = /* @__PURE__ */ new Map();
    let current = null;
    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      const def = lib.get(name);
      const old = existing.get(name);
      if (old) {
        cells.set(name, old);
        geoms.set(name, geomFromComponent(old, def.ports));
        reused.push(name);
        continue;
      }
      (_c = opts.onModule) == null ? void 0 : _c.call(opts, name, i, order.length);
      const page = name === cpuName ? pages.cpu : pages.cells;
      if (current !== page) {
        await figma.setCurrentPageAsync(page);
        current = page;
      }
      const layout = layoutModule(def, geomOf, {
        wires: opts.wires,
        maxWiredInstances: opts.maxWiredInstances,
        maxWiredSinks: opts.maxWiredSinks,
        titleWidth: textWidth(def.name, 12) + 40
      });
      const comp = drawModule(def, layout, mainOf);
      page.appendChild(comp);
      let shelf = shelves.get(page);
      if (!shelf) shelves.set(page, shelf = newShelf(page, comp));
      place2(shelf, comp);
      cells.set(name, comp);
      geoms.set(name, layout.geom);
      layouts.set(name, layout);
    }
    return { gates, cells, layouts, reused };
  }
  function newShelf(page, skip) {
    let bottom = -Infinity;
    for (const n of page.children) if (n !== skip) bottom = Math.max(bottom, n.y + n.height);
    return { x: 0, y: bottom === -Infinity ? 0 : bottom + 2 * GAP, rowH: 0 };
  }
  function place2(s, n) {
    if (s.x > 0 && s.x + n.width > ROW_LIMIT) {
      s.x = 0;
      s.y += s.rowH + GAP;
      s.rowH = 0;
    }
    n.x = s.x;
    n.y = s.y;
    s.x += n.width + GAP;
    s.rowH = Math.max(s.rowH, n.height);
  }
  var keyCache = /* @__PURE__ */ new WeakMap();
  function propertyKeys(main) {
    let m = keyCache.get(main);
    if (!m) {
      m = /* @__PURE__ */ new Map();
      for (const [key, d] of Object.entries(main.componentPropertyDefinitions)) if (d.type === "TEXT") m.set(propName(key), key);
      keyCache.set(main, m);
    }
    return m;
  }
  function drawModule(def, L2, mainOf) {
    var _a, _b;
    const comp = figma.createComponent();
    comp.name = cellComponentName(def.name);
    comp.resize(L2.w, L2.h);
    comp.fills = solid(C.card);
    comp.strokes = solid(C.stroke);
    comp.strokeWeight = 1;
    comp.cornerRadius = 10;
    comp.clipsContent = false;
    comp.description = (_a = def.doc) != null ? _a : "";
    addText(comp, "title", def.name, 12, 10, { size: 12, font: "bold" });
    const sub = subtitle(def, L2);
    if (sub) addText(comp, "subtitle", sub, 12, 28, { size: 9, color: C.dim });
    const keys = /* @__PURE__ */ new Map();
    for (const p of def.ports) keys.set(p.name, comp.addComponentProperty(p.name, "TEXT", formatNets(portBits(p))));
    if (L2.wires.length) {
      const wf = figma.createFrame();
      comp.appendChild(wf);
      wf.name = "wires";
      wf.resize(L2.w, L2.h);
      wf.x = 0;
      wf.y = 0;
      wf.fills = [];
      wf.clipsContent = false;
      for (const w of L2.wires) drawWire(wf, w);
    }
    for (const pi of L2.instances) {
      const main = mainOf(pi.def.cell);
      const inst = main.createInstance();
      comp.appendChild(inst);
      inst.name = pi.def.name;
      inst.x = pi.x;
      inst.y = pi.y;
      const props = {};
      for (const [port, key] of propertyKeys(main)) props[key] = formatNets((_b = pi.def.conn[port]) != null ? _b : []);
      inst.setProperties(props);
    }
    for (const pl of L2.ports) drawPortMarker(comp, pl, keys.get(pl.def.name));
    return comp;
  }
  function subtitle(def, L2) {
    var _a;
    const parts = [(_a = def.doc) != null ? _a : "", `${def.instances.length} parts`];
    if (L2.mode === "labels" && L2.labeled.length) parts.push("nets by name");
    const s = parts.filter(Boolean).join(" \xB7 ");
    const max = Math.max(8, Math.floor((L2.w - 24) / (9 * 0.58)));
    return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
  }
  var num = (v) => String(Math.round(v * 100) / 100);
  var square = (p, r) => `M ${num(p.x - r)} ${num(p.y - r)} L ${num(p.x + r)} ${num(p.y - r)} L ${num(p.x + r)} ${num(p.y + r)} L ${num(p.x - r)} ${num(p.y + r)} Z`;
  function polyVector(parent, name, lines, dots, color, weight) {
    const all = [...lines.flat(), ...dots.flatMap((d) => [{ x: d.x - 2, y: d.y - 2 }, { x: d.x + 2, y: d.y + 2 }])];
    const x0 = Math.min(...all.map((p) => p.x));
    const y0 = Math.min(...all.map((p) => p.y));
    const rel = (p) => ({ x: p.x - x0, y: p.y - y0 });
    const data = lines.map((pts) => pts.map((p, i) => `${i ? "L" : "M"} ${num(p.x - x0)} ${num(p.y - y0)}`).join(" ")).join(" ");
    const paths = [{ windingRule: "NONE", data }];
    if (dots.length) paths.push({ windingRule: "NONZERO", data: dots.map((d) => square(rel(d), 2)).join(" ") });
    const v = figma.createVector();
    parent.appendChild(v);
    v.name = name;
    v.vectorPaths = paths;
    v.x = x0;
    v.y = y0;
    v.strokes = solid(color);
    v.strokeWeight = weight;
    v.strokeJoin = "MITER";
    v.fills = solid(color);
    return v;
  }
  function drawWire(parent, w) {
    polyVector(parent, wireName(w.net), w.paths, w.junctions, C.wire, 1.5);
    const lit3 = polyVector(parent, wireLitName(w.net), w.paths, w.junctions, C.lit, 2);
    lit3.visible = false;
  }
  function drawPortMarker(comp, pl, key) {
    const p = pl.def;
    const isIn = p.dir === "in";
    const f = figma.createFrame();
    comp.appendChild(f);
    f.name = portMarkerName(p);
    f.resize(pl.w, pl.h);
    f.x = pl.x;
    f.y = pl.y;
    f.fills = [];
    f.clipsContent = false;
    const x0 = isIn ? 0 : pl.w - STUB;
    const bits = portBits(p).map((_, k) => bitOffset(k));
    polyVector(
      f,
      "stub",
      bits.map((y) => [
        { x: x0, y },
        { x: x0 + STUB, y }
      ]),
      bits.map((y) => ({ x: isIn ? 0 : pl.w, y })),
      C.lead,
      1.5
    );
    const name = addText(f, "name", p.name, 2, 3, { size: NAME_SIZE, font: "bold", color: C.dim });
    const net = addText(f, "net", formatNets(portBits(p)), 0, 4, { size: NET_SIZE, font: "mono", color: C.net });
    if (isIn) net.x = 2 + name.width + 4;
    else {
      name.x = pl.w - STUB - 4 - name.width;
      net.x = pl.w - STUB + 2;
    }
    net.componentPropertyReferences = { characters: key };
  }
  function geomFromComponent(comp, ports) {
    const ys = ports.map((p) => {
      const m = comp.children.find((c) => c.name === portMarkerName(p));
      if (!m) throw new Error(`${comp.name}: no port marker ${portMarkerName(p)} (redraw it)`);
      return m.y;
    });
    return moduleGeom(ports, comp.width, comp.height, ys);
  }

  // src/prototype/draw.ts
  var chunkName = (name, i) => i === 0 ? name : `${name} \xB7 ${i + 1}`;
  var isChunkOf = (coll, name) => coll === name || new RegExp(`^${escapeRe(name)} \xB7 \\d+$`).test(coll);
  var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  async function removeCollections(api, name) {
    const all = await api.variables.getLocalVariableCollectionsAsync();
    let n = 0;
    for (const c of all)
      if (isChunkOf(c.name, name)) {
        c.remove();
        n++;
      }
    return n;
  }
  async function createVariables(api, name, specs, o = {}) {
    var _a, _b, _c;
    const max = (_a = o.max) != null ? _a : 4e3;
    const yieldEvery = (_b = o.yieldEvery) != null ? _b : 500;
    const collections = [];
    const vars = [];
    for (let i = 0; i < specs.length; i++) {
      if (i % max === 0) collections.push(api.variables.createVariableCollection(chunkName(name, collections.length)));
      const coll = collections[collections.length - 1];
      const s = specs[i];
      let v;
      try {
        v = api.variables.createVariable(s.name, coll, s.type);
      } catch (e) {
        const safe = s.name.replace(/[^\w/ -]/g, "_");
        if (safe === s.name) throw new Error(`createVariable(${s.name}): ${e}`);
        v = api.variables.createVariable(safe, coll, s.type);
      }
      v.setValueForMode(coll.defaultModeId, s.init);
      vars.push(v);
      if ((i + 1) % yieldEvery === 0) {
        (_c = o.log) == null ? void 0 : _c.call(o, `  ${name}: ${i + 1}/${specs.length} variables`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return { collections, vars };
  }
  function bindVisible(node, v) {
    if (typeof v === "boolean") node.visible = v;
    else node.setBoundVariable("visible", v);
  }

  // src/live/names.ts
  var LIVE_PREFIX = "Live \xB7 ";
  var DASHBOARD_NAME = `${LIVE_PREFIX}Dashboard`;
  var CTL_STEP = "ctl/step";
  var CTL_RUN = "ctl/run";
  var CTL_STOP = "ctl/stop";
  var CTL_RESET = "ctl/reset";
  var CTL_PAD = "ctl/pad";
  var padCellName = (i) => `${CTL_PAD}/${i}`;
  var DISK_PREFIX = "disk/";
  var diskName = (program) => `${DISK_PREFIX}${program}`;
  var CUSTOM_DISK = "custom";
  var PAD_CELL_NAME = `${LIVE_PREFIX}Pad cell`;
  var LISTING = "var/ctl/listing";
  var PROGRAM_NAME = "var/ctl/program";
  var NET_KINDS = ["lamp", "seg", "arrow", "row", "col", "tag"];
  var NET_RE = new RegExp(`^(${NET_KINDS.join("|")})\\/(.+)$`);
  var VAR_RE = /^var\/(.+)$/;
  var MAG_RE = /^mag\/(.+)$/;
  var bound = (kind, net) => `${kind}/${net}`;
  var varBound = (variable) => `var/${variable}`;
  var magName = (prefix) => `mag/${prefix.replace(/\/+$/, "")}`;
  function parseBound(name) {
    const m = NET_RE.exec(name);
    return m ? { kind: m[1], net: m[2] } : null;
  }
  function parseVar(name) {
    var _a, _b;
    return (_b = (_a = VAR_RE.exec(name)) == null ? void 0 : _a[1]) != null ? _b : null;
  }
  function parseMag(name) {
    const m = MAG_RE.exec(name);
    return m ? `${m[1]}/` : null;
  }
  var isLiveNode = (n) => n.name.startsWith(LIVE_PREFIX);

  // src/live/style.ts
  var L = {
    /** Canvas behind everything. */
    bg: "#1E1E1E",
    /** Top bar and side panels. */
    chrome: "#2C2C2C",
    /** Cards on the canvas. */
    card: "#252525",
    /** Blocks inside cards. */
    block: "#2F2F2F",
    /** Grid cells, inputs. */
    cell: "#333333",
    line: "#383838",
    line2: "#4A4A4A",
    text: "#FFFFFF",
    text2: "#B3B3B3",
    text3: "#7C7C7C",
    /** A lamp that is off. */
    off: "#3D3D3D",
    /** Figma's selection blue: microcode row / column highlights. */
    blue: "#0D99FF",
    // Signal categories (Figma's brand colors).
    drive: "#FFC700",
    // drives the bus
    load: "#1ABCFE",
    // loads from the bus
    mem: "#A259FF",
    // memory
    alu: "#0ACF83",
    // ALU, flags
    out: "#F24E1E",
    // output port, 7-segment
    ctrl: "#FF7262",
    // control unit
    /** Register bits. */
    bit: "#0ACF83",
    segOff: "#3A2420",
    display: "#141414"
  };
  function rgb2(hex3) {
    const n = parseInt(hex3.replace("#", ""), 16);
    return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 };
  }
  function solid2(hex3, opacity = 1) {
    return [{ type: "SOLID", color: rgb2(hex3), opacity }];
  }
  async function loadLiveFonts(api) {
    const tryLoad = async (want, fallback) => {
      for (const f of want) {
        try {
          await api.loadFontAsync(f);
          return f;
        } catch (e) {
        }
      }
      await api.loadFontAsync(fallback);
      return fallback;
    };
    const regular = { family: "Inter", style: "Regular" };
    const bold = { family: "Inter", style: "Bold" };
    await api.loadFontAsync(regular);
    await api.loadFontAsync(bold);
    const medium = await tryLoad([{ family: "Inter", style: "Medium" }], regular);
    const semibold = await tryLoad([{ family: "Inter", style: "Semi Bold" }], bold);
    const mono = await tryLoad([{ family: "Roboto Mono", style: "Regular" }], regular);
    const monoBold = await tryLoad([{ family: "Roboto Mono", style: "Bold" }, { family: "Roboto Mono", style: "Medium" }], mono);
    return { regular, medium, semibold, bold, mono, monoBold };
  }
  function put(parent, child2, x, y) {
    parent.appendChild(child2);
    child2.x = Math.round(x * 2) / 2;
    child2.y = Math.round(y * 2) / 2;
    return child2;
  }
  function frame(ctx, parent, name, x, y, w, h, o = {}) {
    var _a, _b, _c;
    const f = ctx.api.createFrame();
    f.name = name;
    f.resize(Math.max(1, w), Math.max(1, h));
    f.fills = o.fill ? solid2(o.fill, (_a = o.fillOpacity) != null ? _a : 1) : [];
    if (o.radius) f.cornerRadius = o.radius;
    if (o.stroke) {
      f.strokes = solid2(o.stroke);
      f.strokeWeight = (_b = o.strokeWeight) != null ? _b : 1;
    }
    f.clipsContent = (_c = o.clip) != null ? _c : false;
    return put(parent, f, x, y);
  }
  function rect(ctx, parent, name, x, y, w, h, o = {}) {
    var _a, _b;
    const r = ctx.api.createRectangle();
    r.name = name;
    r.resize(Math.max(1, w), Math.max(1, h));
    r.fills = o.fill ? solid2(o.fill, (_a = o.fillOpacity) != null ? _a : 1) : [];
    if (o.radius) r.cornerRadius = o.radius;
    if (o.stroke) {
      r.strokes = solid2(o.stroke);
      r.strokeWeight = (_b = o.strokeWeight) != null ? _b : 1;
    }
    return put(parent, r, x, y);
  }
  function text(ctx, parent, chars, x, y, o = {}) {
    var _a, _b, _c, _d, _e, _f;
    const t = ctx.api.createText();
    t.fontName = ctx.fonts[(_a = o.font) != null ? _a : "regular"];
    t.fontSize = (_b = o.size) != null ? _b : 12;
    if (o.lineHeight) t.lineHeight = { value: o.lineHeight, unit: "PIXELS" };
    if (o.tracking) t.letterSpacing = { value: o.tracking, unit: "PERCENT" };
    t.characters = chars;
    t.fills = solid2((_c = o.color) != null ? _c : L.text, (_d = o.opacity) != null ? _d : 1);
    t.name = (_e = o.name) != null ? _e : chars.slice(0, 40) || "text";
    if (o.align) t.textAlignHorizontal = o.align;
    if (o.valign) t.textAlignVertical = o.valign;
    if (o.w) {
      t.resize(o.w, (_f = o.h) != null ? _f : Math.max(1, t.height));
      t.textAutoResize = o.h ? "NONE" : "HEIGHT";
    }
    return put(parent, t, x, y);
  }
  function header(ctx, parent, label2, x, y) {
    return text(ctx, parent, label2.toUpperCase(), x, y, { size: 10, font: "semibold", color: L.text2, tracking: 6, name: `header/${label2}` });
  }
  function glow(node, hex3, radius = 8, alpha = 0.6) {
    try {
      const c = rgb2(hex3);
      node.effects = [
        { type: "DROP_SHADOW", color: __spreadProps(__spreadValues({}, c), { a: alpha }), offset: { x: 0, y: 0 }, radius, spread: 0, visible: true, blendMode: "NORMAL" }
      ];
    } catch (e) {
    }
  }
  var num2 = (v) => String(Math.round(v * 100) / 100);
  function vector(ctx, parent, name, lines, polys, color, weight, o = {}) {
    var _a, _b;
    const all = [...lines.flat(), ...polys.flat()];
    const x0 = Math.min(...all.map((p) => p[0]));
    const y0 = Math.min(...all.map((p) => p[1]));
    const d = (pts, close) => pts.map((p, i) => `${i ? "L" : "M"} ${num2(p[0] - x0)} ${num2(p[1] - y0)}`).join(" ") + (close ? " Z" : "");
    const paths = [];
    if (lines.length) paths.push({ windingRule: "NONE", data: lines.map((l) => d(l, false)).join(" ") });
    if (polys.length) paths.push({ windingRule: "NONZERO", data: polys.map((p) => d(p, true)).join(" ") });
    const v = ctx.api.createVector();
    v.name = name;
    v.vectorPaths = paths;
    v.strokes = solid2(color, (_a = o.opacity) != null ? _a : 1);
    v.strokeWeight = weight;
    v.strokeJoin = "ROUND";
    v.strokeCap = "ROUND";
    v.fills = polys.length ? solid2(color, (_b = o.opacity) != null ? _b : 1) : [];
    if (o.dash) v.dashPattern = o.dash;
    return put(parent, v, x0, y0);
  }
  function arrowHead(pts, size = 7) {
    const [ax, ay] = pts[pts.length - 2];
    const [bx, by] = pts[pts.length - 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const base = [bx - ux * size, by - uy * size];
    const half = size * 0.6;
    const head = [
      [bx, by],
      [base[0] - uy * half, base[1] + ux * half],
      [base[0] + uy * half, base[1] - ux * half]
    ];
    return { line: [...pts.slice(0, -1), base], head };
  }

  // src/live/widgets.ts
  function lamp(ctx, parent, net, x, y, size, color, o = {}) {
    var _a, _b, _c, _d, _e;
    const w = (_a = o.w) != null ? _a : size;
    const h = (_b = o.h) != null ? _b : size;
    const radius = (_c = o.radius) != null ? _c : Math.max(1, Math.round(Math.min(w, h) / 4));
    const f = frame(ctx, parent, bound((_d = o.kind) != null ? _d : "lamp", net), x, y, w, h, { fill: (_e = o.off) != null ? _e : L.off, radius });
    const lit3 = rect(ctx, f, "lit", 0, 0, w, h, { fill: color, radius });
    lit3.visible = false;
    return f;
  }
  function lampRow(ctx, parent, nets, x, y, size, pitch, color, o = {}) {
    return nets.map((n, i) => lamp(ctx, parent, n, x + i * pitch, y, size, color, o));
  }
  var bitsMsbFirst = (name, width) => width === 1 ? [name] : Array.from({ length: width }, (_, i) => `${name}[${width - 1 - i}]`);
  function tag(ctx, parent, net, label2, x, y, color, o = {}) {
    var _a, _b, _c, _d, _e;
    const size = (_a = o.size) != null ? _a : 9;
    const h = (_b = o.h) != null ? _b : 18;
    const w = (_c = o.w) != null ? _c : Math.ceil(label2.length * size * 0.62) + 14;
    const f = frame(ctx, parent, (_d = o.name) != null ? _d : bound("tag", net), x, y, w, h, __spreadValues({
      fill: null,
      radius: h / 2
    }, o.outline === false ? {} : { stroke: L.line2 }));
    text(ctx, f, label2, 0, 0, { size, font: "mono", color: L.text3, w, h, align: "CENTER", valign: "CENTER", name: "label" });
    const lit3 = frame(ctx, f, "lit", 0, 0, w, h, { fill: color, radius: h / 2 });
    text(ctx, lit3, label2, 0, 0, { size, font: "monoBold", color: (_e = o.litText) != null ? _e : "#111111", w, h, align: "CENTER", valign: "CENTER", name: "label" });
    lit3.visible = false;
    return f;
  }
  function arrow(ctx, parent, net, pts, color, o = {}) {
    var _a, _b, _c;
    const pad = 10;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs) - pad;
    const y0 = Math.min(...ys) - pad;
    const w = Math.max(...xs) - x0 + pad;
    const h = Math.max(...ys) - y0 + pad;
    const name = (_a = o.name) != null ? _a : net ? bound("arrow", net) : "link";
    const f = frame(ctx, parent, name, x0, y0, w, h, { fill: null });
    const local = pts.map(([x, y]) => [x - x0, y - y0]);
    const { line, head } = o.head === false ? { line: local, head: [] } : arrowHead(local, 7);
    vector(ctx, f, "line", [line], head.length ? [head] : [], net ? L.line2 : L.text3, (_b = o.weight) != null ? _b : 1.5);
    const labelPos = () => {
      if (o.labelAt) return [local[0][0] + o.labelAt[0], local[0][1] + o.labelAt[1]];
      const [a, b] = [local[0], local[1]];
      return [Math.min(a[0], b[0]) + 2, Math.min(a[1], b[1]) - 13];
    };
    if (o.label) {
      const [lx, ly] = labelPos();
      text(ctx, f, o.label, lx, ly, { size: 8, font: "mono", color: L.text3, name: "label" });
    }
    if (!net) return f;
    const lit3 = frame(ctx, f, "lit", 0, 0, w, h, { fill: null });
    const v = vector(ctx, lit3, "line", [line], head.length ? [head] : [], color, ((_c = o.weight) != null ? _c : 1.5) + 1.5);
    glow(v, color, 6, 0.7);
    if (o.label) {
      const [lx, ly] = labelPos();
      text(ctx, lit3, o.label, lx, ly, { size: 8, font: "monoBold", color, name: "label" });
    }
    lit3.visible = false;
    return f;
  }
  function button(ctx, parent, name, label2, x, y, w, h, color, o = {}) {
    const f = frame(ctx, parent, name, x, y, w, h, o.outline ? { fill: L.cell, radius: 6, stroke: L.line2 } : { fill: color, radius: 6 });
    const fg = o.outline ? L.text : "#FFFFFF";
    const chars = o.icon ? `${o.icon}  ${label2}` : label2;
    text(ctx, f, chars, 0, 0, { size: 12, font: "semibold", color: fg, w, h, align: "CENTER", valign: "CENTER", name: "label" });
    return f;
  }
  function block(ctx, parent, name, title, x, y, w, h, sub, accent) {
    const f = frame(ctx, parent, `block/${name}`, x, y, w, h, { fill: L.block, radius: 8, stroke: L.line });
    if (accent) rect(ctx, f, "accent", 0, 10, 3, Math.max(8, h - 20), { fill: accent, radius: 1.5 });
    text(ctx, f, title, 12, 8, { size: 11, font: "bold", color: L.text, name: "title" });
    if (sub) text(ctx, f, sub, 12, 23, { size: 8.5, color: L.text3, name: "subtitle" });
    return f;
  }
  function bitLabels(ctx, parent, width, x, y, pitch, size) {
    const fs = 7;
    const chars = Array.from({ length: width }, (_, i) => String((width - 1 - i) % 10)).join("");
    const t = text(ctx, parent, chars, x + size / 2 - fs * 0.6 / 2, y, { size: fs, font: "mono", color: L.text3, name: "bits" });
    try {
      t.letterSpacing = { value: pitch - fs * 0.6, unit: "PIXELS" };
    } catch (e) {
    }
    return t;
  }

  // src/live/grid.ts
  var SHORT = {
    PC_OUT: "PC\u2192bus",
    MDR_OUT: "MDR\u2192bus",
    REG_OUT_D: "Rd\u2192bus",
    REG_OUT_S: "Rs\u2192bus",
    Y_OUT: "Y\u2192bus",
    MAR_LOAD: "bus\u2192MAR",
    IR_LOAD: "bus\u2192IR",
    MDR_LOAD: "bus\u2192MDR",
    REG_LOAD_D: "bus\u2192Rd",
    A_LOAD: "bus\u2192A",
    PC_LOAD: "bus\u2192PC",
    PC_INC: "PC+1",
    MEM_READ: "RAM\u2192MDR",
    MEM_WRITE: "MDR\u2192RAM",
    Y_LOAD: "ALU\u2192Y",
    FLAGS_LOAD: "\u2192ZCN",
    HALT: "HALT"
  };
  var MARKERS = ["T_RESET"];
  var short = (s) => {
    var _a;
    return (_a = SHORT[s]) != null ? _a : s;
  };
  var tLineNet = (t) => `ctrl/T${t}`;
  var opLineNet = (mnem) => `ctrl/op_${mnem}`;
  var flagLineNet = (mnem, flag) => `ctrl/op_${mnem}if${flag}`;
  var cellOf = (mnem, s) => {
    const main = s.signals.filter((x) => !MARKERS.includes(x)).map(short);
    const when = s.when ? { flag: s.when.flag, signals: s.when.signals, net: flagLineNet(mnem, s.when.flag) } : void 0;
    const parts = [...main];
    if (when) parts.push(`${when.flag}? ${when.signals.map(short).join(" ")}`);
    return __spreadProps(__spreadValues({ t: s.t, text: parts.join("  ") || "\u2013", signals: s.signals }, when ? { when } : {}), { end: s.signals.includes("T_RESET"), halt: s.signals.includes("HALT") });
  };
  var sameStep = (a, b) => !!a && !!b && !a.when && !b.when && a.signals.length === b.signals.length && a.signals.every((s, i) => s === b.signals[i]);
  function microcodeTable(tStates = 8) {
    const ops = [...OPCODES].sort((a, b) => a.code - b.code);
    const stepAt = ops.map((op) => new Map(microcode(op).map((s) => [s.t, s])));
    const shared = /* @__PURE__ */ new Map();
    for (let t = 0; t < tStates; t++) {
      const first = stepAt[0].get(t);
      if (first && stepAt.every((m) => sameStep(m.get(t), first))) shared.set(t, cellOf("", first));
    }
    const rows = ops.map((op, i) => ({
      code: op.code,
      mnem: op.mnem,
      operands: op.operands.join(", "),
      doc: op.doc,
      opNet: opLineNet(op.mnem),
      cells: Array.from({ length: tStates }, (_, t) => {
        const s = stepAt[i].get(t);
        return s && !shared.has(t) ? cellOf(op.mnem, s) : null;
      })
    }));
    return { tStates, shared, rows };
  }
  function drawMicrocode(ctx, parent, x, y, w, rowH = 21) {
    const table = microcodeTable();
    const pad = 16;
    const top = 44;
    const headH = 22;
    const labelW = 156;
    const sharedW = 108;
    const nShared = table.shared.size;
    const nOther = table.tStates - nShared;
    const otherW = Math.floor((w - 2 * pad - labelW - nShared * sharedW) / Math.max(1, nOther));
    const colX = [];
    const colW = [];
    let cx = pad + labelW;
    for (let t = 0; t < table.tStates; t++) {
      colX.push(cx);
      colW.push(table.shared.has(t) ? sharedW : otherW);
      cx += colW[t];
    }
    const gridW = cx - pad;
    const rowsY = top + headH + 4;
    const h = rowsY + table.rows.length * rowH + pad;
    const card = frame(ctx, parent, "microcode", x, y, w, h, { fill: L.card, radius: 12, stroke: L.line });
    text(ctx, card, "Microcode", pad, 14, { size: 13, font: "bold", name: "title" });
    text(ctx, card, "the instruction cycle, generated from OPCODES in src/isa/spec.ts  \xB7  lit row = the opcode in IR  \xB7  lit column = the T-state", pad + 84, 17, {
      size: 10,
      color: L.text3,
      name: "subtitle"
    });
    const lx = w - pad - 290;
    rect(ctx, card, "legend/end", lx, 18, 3, 11, { fill: L.ctrl, radius: 1.5 });
    text(ctx, card, "last step (T_RESET \u2192 T0)", lx + 8, 17, { size: 9.5, color: L.text3, name: "legend/end" });
    text(ctx, card, "F? \u2026  only if flag F", lx + 148, 17, { size: 9.5, font: "mono", color: L.drive, name: "legend/cond" });
    table.rows.forEach((_, r) => {
      if (r % 2 === 0) rect(ctx, card, "stripe", pad, rowsY + r * rowH, gridW, rowH, { fill: "#292929", radius: 3 });
    });
    table.rows.forEach(
      (row, r) => row.cells.forEach((c, t) => {
        if (c) rect(ctx, card, `cell/${row.mnem}/T${t}`, colX[t] + 2, rowsY + r * rowH + 2, colW[t] - 4, rowH - 4, { fill: L.block, radius: 4 });
      })
    );
    for (const [t] of table.shared)
      rect(ctx, card, `cell/FETCH/T${t}`, colX[t] + 2, rowsY + 2, colW[t] - 4, table.rows.length * rowH - 4, { fill: "#28303A", radius: 6 });
    table.rows.forEach((row, r) => {
      const f = frame(ctx, card, bound("row", row.opNet), pad, rowsY + r * rowH, gridW, rowH, { fill: null });
      const lit3 = rect(ctx, f, "lit", 0, 0, gridW, rowH, { fill: L.blue, fillOpacity: 0.16, radius: 4, stroke: L.blue });
      lit3.strokes = [{ type: "SOLID", color: { r: 13 / 255, g: 153 / 255, b: 1 }, opacity: 0.55 }];
      lit3.visible = false;
    });
    for (let t = 0; t < table.tStates; t++) {
      const colH = rowsY - top + table.rows.length * rowH;
      const f = frame(ctx, card, bound("col", tLineNet(t)), colX[t], top, colW[t], colH, { fill: null });
      const lit3 = frame(ctx, f, "lit", 0, 0, colW[t], colH, { fill: null });
      const band = rect(ctx, lit3, "band", 0, 0, colW[t], colH, { fill: L.blue, fillOpacity: 0.12, radius: 5 });
      band.strokes = [{ type: "SOLID", color: { r: 13 / 255, g: 153 / 255, b: 1 }, opacity: 0.5 }];
      rect(ctx, lit3, "head", 2, 2, colW[t] - 4, headH - 2, { fill: L.blue, radius: 4 });
      lit3.visible = false;
    }
    for (let t = 0; t < table.tStates; t++)
      text(ctx, card, `T${t}`, colX[t], top + 1, { size: 10.5, font: "monoBold", color: L.text, w: colW[t], h: headH, align: "CENTER", valign: "CENTER", name: `head/T${t}` });
    text(ctx, card, "opcode", pad + 8, top + 5, { size: 9.5, color: L.text3, name: "head/opcode" });
    table.rows.forEach((row, r) => {
      const ry = rowsY + r * rowH;
      const mid = ry + rowH / 2;
      text(ctx, card, row.code.toString(16).toUpperCase(), pad + 8, mid - 6, { size: 9.5, font: "mono", color: L.text3, name: `code/${row.mnem}` });
      text(ctx, card, row.mnem, pad + 24, mid - 7, { size: 11, font: "semibold", color: L.text, name: `mnem/${row.mnem}` });
      if (row.operands) text(ctx, card, row.operands, pad + 66, mid - 6, { size: 9.5, font: "mono", color: L.text3, name: `operands/${row.mnem}` });
      row.cells.forEach((c, t) => {
        if (!c) return;
        const cw = colW[t];
        const cx0 = colX[t];
        text(ctx, card, c.text, cx0 + 8, mid - 6, { size: 9.5, font: "mono", color: c.halt ? L.out : c.when ? L.drive : c.signals.length === 1 && c.end ? L.text3 : L.text2, name: `step/${row.mnem}/T${t}` });
        if (c.end) rect(ctx, card, `end/${row.mnem}`, cx0 + cw - 7, ry + 5, 3, rowH - 10, { fill: L.ctrl, radius: 1.5 });
        if (c.when) tag(ctx, card, c.when.net, "taken", cx0 + cw - 50, ry + 3, L.drive, { w: 38, h: rowH - 6, size: 7.5 });
      });
    });
    for (const [t, c] of table.shared) {
      const cx0 = colX[t];
      const midY = rowsY + table.rows.length * rowH / 2;
      text(ctx, card, "FETCH", cx0, midY - 34, { size: 9, font: "semibold", color: L.text3, w: colW[t], align: "CENTER", tracking: 8, name: `fetch/T${t}` });
      text(ctx, card, c.text.split("  ").join("\n"), cx0, midY - 14, { size: 10, font: "mono", color: L.text2, w: colW[t], align: "CENTER", lineHeight: 15, name: `step/FETCH/T${t}` });
    }
    return card;
  }

  // src/live/datapath.ts
  var DATAPATH_W = 1336;
  var DATAPATH_H = 480;
  function signalColor(s) {
    if (BUS_DRIVERS.includes(s)) return L.drive;
    if (s === "MEM_READ" || s === "MEM_WRITE") return L.mem;
    if (s === "Y_LOAD" || s === "FLAGS_LOAD" || s === "PC_INC") return L.alu;
    if (s.endsWith("_LOAD")) return L.load;
    return L.ctrl;
  }
  var RAM_X = 16;
  var RAM_W = 196;
  var LEFT_X = 280;
  var LEFT_W = 236;
  var BUS_X = 584;
  var BUS_W = 60;
  var RIGHT_X = 712;
  var RIGHT_W = 248;
  var FAR_X = 1028;
  var FAR_W = 292;
  var TOP = 48;
  var BOTTOM = 464;
  var LAMP = 14;
  var PITCH2 = 18;
  var L_END = LEFT_X + LEFT_W;
  var BUS_R = BUS_X + BUS_W;
  var R_MID = RIGHT_X + RIGHT_W / 2;
  var ROW = { PC: [48, 60], MAR: [122, 60], MDR: [196, 60], IR: [270, 60], CTRL: [352, 112] };
  var RROW = { REGS: [48, 122], A: [184, 48], ALU: [256, 76], Y: [358, 48] };
  function transfers() {
    const s = (net, pts, label2 = net, labelAt) => __spreadValues({ net, pts, color: signalColor(net), label: label2 }, labelAt ? { labelAt } : {});
    const right = (y) => [
      [L_END, y],
      [BUS_X, y]
    ];
    const left = (y) => [
      [BUS_X, y],
      [L_END, y]
    ];
    const rRight = (y) => [
      [BUS_R, y],
      [RIGHT_X, y]
    ];
    const rLeft = (y) => [
      [RIGHT_X, y],
      [BUS_R, y]
    ];
    const ramR = RAM_X + RAM_W;
    return [
      s("PC_OUT", right(72)),
      s("PC_LOAD", left(94)),
      s("MAR_LOAD", left(152)),
      s("MEM_READ", [
        [ramR, 212],
        [LEFT_X, 212]
      ]),
      s("MEM_WRITE", [
        [LEFT_X, 234],
        [ramR, 234]
      ]),
      s("MDR_OUT", right(214)),
      s("MDR_LOAD", left(238)),
      // OUT ← MDR on a store to address 15 (out_load = MEM_WRITE · (MAR = 15), src/cpu/cpu.ts).
      { net: "out_load", pts: [[LEFT_X, 250], [ramR + 30, 250], [ramR + 30, 300], [ramR, 300]], color: L.out, label: "\u2192OUT", labelAt: [-34, 4] },
      s("IR_LOAD", left(300)),
      s("REG_OUT_D", rLeft(80)),
      s("REG_OUT_S", rLeft(104)),
      s("REG_LOAD_D", rRight(140)),
      s("A_LOAD", rRight(208)),
      // The ALU's B input is the bus; it matters when Y_LOAD captures the result.
      s("Y_LOAD", rRight(294), "bus\u2192B"),
      s("Y_LOAD", [
        [R_MID, RROW.ALU[0] + RROW.ALU[1]],
        [R_MID, RROW.Y[0]]
      ], "Y_LOAD", [6, 4]),
      s("Y_OUT", rLeft(382)),
      s("FLAGS_LOAD", [
        [RIGHT_X + RIGHT_W, 294],
        [FAR_X, 294]
      ])
    ];
  }
  function drawDatapath(ctx, parent, x, y, w = DATAPATH_W, h = DATAPATH_H) {
    const card = frame(ctx, parent, "datapath", x, y, w, h, { fill: L.card, radius: 12, stroke: L.line });
    text(ctx, card, "Datapath", 16, 14, { size: 13, font: "bold", name: "title" });
    text(ctx, card, "one 8-bit bus; an arrow lights while its control signal is 1, a lamp while its wire is 1 (all variable bindings: no extra gates)", 96, 17, {
      size: 10,
      color: L.text3,
      name: "subtitle"
    });
    const bus = frame(ctx, card, "block/BUS", BUS_X, TOP, BUS_W, BOTTOM - TOP, { fill: "#262626", radius: 8, stroke: L.line });
    text(ctx, bus, "BUS", 0, 8, { size: 10, font: "bold", color: L.text, w: BUS_W, align: "CENTER", name: "title" });
    text(ctx, bus, "7 \xB7 \xB7 \xB7 \xB7 \xB7 \xB7 0", 0, 22, { size: 7, font: "mono", color: L.text3, w: BUS_W, align: "CENTER", name: "bits" });
    bitsMsbFirst("bus", 8).forEach((n, i) => lamp(ctx, bus, n, 8 + i * 6.25, 36, 3, L.drive, { w: 3, h: BOTTOM - TOP - 48, radius: 1.5 }));
    const reg = (name, title, sub, [by, bh], probe, width, accent) => {
      const b = block(ctx, card, name, title, LEFT_X, by, LEFT_W, bh, sub, accent);
      lampRow(ctx, b, bitsMsbFirst(probe, width), 12, 34, LAMP, PITCH2, L.bit);
      return b;
    };
    const pc = reg("PC", "PC", "program counter \xB7 4 bits", ROW.PC, "pc", 4, L.load);
    tag(ctx, pc, "PC_INC", "+1", LEFT_W - 46, 30, L.alu, { w: 34, h: 18, size: 9 });
    reg("MAR", "MAR", "memory address \xB7 4 bits", ROW.MAR, "mar", 4, L.load);
    reg("MDR", "MDR", "memory data \xB7 8 bits", ROW.MDR, "mdr", 8, L.mem);
    const ir = reg("IR", "IR", "instruction \xB7 op | Rd | Rs", ROW.IR, "ir", 8, L.ctrl);
    text(ctx, ir, "opcode", 12, 50, { size: 7, font: "mono", color: L.text3, name: "field/op" });
    text(ctx, ir, "Rd", 12 + 4 * PITCH2, 50, { size: 7, font: "mono", color: L.text3, name: "field/rd" });
    text(ctx, ir, "Rs", 12 + 6 * PITCH2, 50, { size: 7, font: "mono", color: L.text3, name: "field/rs" });
    const st = block(ctx, card, "STATE", "T-STATE", RAM_X, ROW.PC[0], RAM_W, ROW.PC[1], "t[2:0] \xB7 clock \xB7 halted", L.ctrl);
    lampRow(ctx, st, bitsMsbFirst("t", 3), 12, 34, LAMP, PITCH2, L.ctrl);
    text(ctx, st, "CLK", 84, 36, { size: 8, font: "mono", color: L.text3, name: "label/CLK" });
    lamp(ctx, st, "CLK", 106, 34, LAMP, L.drive);
    text(ctx, st, "HLT", 132, 36, { size: 8, font: "mono", color: L.text3, name: "label/HLT" });
    lamp(ctx, st, "halted", 156, 34, LAMP, L.out);
    const ram = block(ctx, card, "RAM", "RAM", RAM_X, ROW.MAR[0], RAM_W, ROW.MDR[0] + ROW.MDR[1] - ROW.MAR[0], "16 \xD7 8 \xB7 D latches", L.mem);
    text(ctx, ram, "address (decoded MAR)", 12, 40, { size: 8, color: L.text3, name: "label/addr" });
    for (let k = 0; k < 16; k++) lamp(ctx, ram, `ram/sel[${k}]`, 12 + k * 10.5, 54, 8, L.mem, { radius: 2 });
    text(ctx, ram, "0", 12, 64, { size: 7, font: "mono", color: L.text3, name: "addr/0" });
    text(ctx, ram, "F", 12 + 15 * 10.5 + 2, 64, { size: 7, font: "mono", color: L.text3, name: "addr/F" });
    text(ctx, ram, "RAM[MAR]", 12, 80, { size: 8, color: L.text3, name: "label/data" });
    lampRow(ctx, ram, bitsMsbFirst("ram_out", 8), 12, 94, LAMP, PITCH2, L.mem);
    bitLabels(ctx, ram, 8, 12, 111, PITCH2, LAMP);
    const out = block(ctx, card, "OUT", "OUT", RAM_X, ROW.IR[0], RAM_W, ROW.IR[1], "port 15 \xB7 shown on the 7-segment", L.out);
    lampRow(ctx, out, bitsMsbFirst("OUT", 8), 12, 34, LAMP, PITCH2, L.out);
    arrow(ctx, card, null, [
      [LEFT_X, 152],
      [RAM_X + RAM_W, 152]
    ], L.text3, { label: "addr", labelAt: [-34, 4], name: "link/MAR\u2192RAM" });
    arrow(ctx, card, null, [
      [LEFT_X + 60, ROW.IR[0] + ROW.IR[1]],
      [LEFT_X + 60, ROW.CTRL[0]]
    ], L.text3, { label: "opcode", labelAt: [6, 4], name: "link/IR\u2192CONTROL" });
    arrow(ctx, card, null, [
      [R_MID, RROW.A[0] + RROW.A[1]],
      [R_MID, RROW.ALU[0]]
    ], L.text3, { label: "A", labelAt: [6, 4], name: "link/A\u2192ALU" });
    const ctrl = block(ctx, card, "CONTROL", "CONTROL", RAM_X, ROW.CTRL[0], L_END - RAM_X, ROW.CTRL[1], "PLA from the microcode: T-state decoder \xB7 opcode decoder", L.ctrl);
    for (let t = 0; t < 8; t++) tag(ctx, ctrl, tLineNet(t), `T${t}`, 12 + t * 61, 38, L.blue, { w: 56, h: 18, size: 9, litText: "#FFFFFF" });
    [...OPCODES].sort((a2, b) => a2.code - b.code).forEach((o, i) => tag(ctx, ctrl, opLineNet(o.mnem), o.mnem, 12 + i % 8 * 61, 62 + Math.floor(i / 8) * 22, L.blue, { w: 56, h: 18, size: 9, litText: "#FFFFFF" }));
    const regs = block(ctx, card, "REGS", "REGISTERS", RIGHT_X, RROW.REGS[0], RIGHT_W, RROW.REGS[1], "R0\u2013R3 \xB7 W = being written", L.bit);
    for (let k = 0; k < 4; k++) {
      const ry = 34 + k * 21;
      text(ctx, regs, `R${k}`, 12, ry + 2, { size: 9, font: "monoBold", color: L.text2, name: `label/R${k}` });
      lampRow(ctx, regs, bitsMsbFirst(`r${k}`, 8), 36, ry, LAMP, PITCH2, L.bit);
      tag(ctx, regs, `regs/load[${k}]`, "W", 36 + 8 * PITCH2 + 6, ry - 1, L.load, { w: 28, h: 16, size: 8 });
    }
    const a = block(ctx, card, "A", "A", RIGHT_X, RROW.A[0], RIGHT_W, RROW.A[1], "ALU input latch", L.alu);
    lampRow(ctx, a, bitsMsbFirst("a", 8), 96, 17, LAMP, PITCH2, L.bit);
    const alu = block(ctx, card, "ALU", "ALU", RIGHT_X, RROW.ALU[0], RIGHT_W, RROW.ALU[1], "A op bus", L.alu);
    const fns = [
      ["alu/sel[0]", "ADD"],
      ["alu_sub", "SUB"],
      ["alu/sel[1]", "AND"],
      ["alu/sel[2]", "OR"],
      ["alu/sel[3]", "XOR"],
      ["alu/sel[4]", "NOT"]
    ];
    fns.forEach(([net, label2], i) => tag(ctx, alu, net, label2, 70 + i * 29, 8, L.alu, { w: 27, h: 16, size: 7.5 }));
    lampRow(ctx, alu, bitsMsbFirst("alu_y", 8), 96, 38, LAMP, PITCH2, L.alu);
    text(ctx, alu, "result", 12, 41, { size: 8, color: L.text3, name: "label/result" });
    const yb = block(ctx, card, "Y", "Y", RIGHT_X, RROW.Y[0], RIGHT_W, RROW.Y[1], "ALU result latch", L.alu);
    lampRow(ctx, yb, bitsMsbFirst("y", 8), 96, 17, LAMP, PITCH2, L.bit);
    const sig = block(ctx, card, "SIGNALS", "CONTROL SIGNALS", FAR_X, TOP, FAR_W, 210, "the PLA's outputs this T-state", L.ctrl);
    SIGNALS.forEach((s, i) => tag(ctx, sig, s, s, 12 + i % 2 * 138, 38 + Math.floor(i / 2) * 19, signalColor(s), { w: 132, h: 16, size: 8.5 }));
    const fl = block(ctx, card, "FLAGS", "FLAGS", FAR_X, 270, FAR_W, 60, "Z C N \u2190 ALU on FLAGS_LOAD; read by the jumps", L.alu);
    ["flag_z", "flag_c", "flag_n"].forEach((n, i) => {
      text(ctx, fl, "ZCN"[i], 12 + i * 48, 36, { size: 9, font: "monoBold", color: L.text2, name: `label/${n}` });
      lamp(ctx, fl, n, 24 + i * 48, 34, LAMP, L.drive);
    });
    const lg = block(ctx, card, "LEGEND", "ARROWS", FAR_X, 344, FAR_W, BOTTOM - 344, void 0, void 0);
    const legend = [
      [L.drive, "drives the bus (\u2026_OUT)"],
      [L.load, "loads from the bus (\u2026_LOAD)"],
      [L.mem, "memory read / write"],
      [L.alu, "ALU, flags, PC + 1"],
      [L.out, "output port (store to 15)"]
    ];
    legend.forEach(([c, label2], i) => {
      rect(ctx, lg, `swatch/${i}`, 12, 32 + i * 16, 18, 3, { fill: c, radius: 1.5 });
      text(ctx, lg, label2, 38, 26 + i * 16, { size: 9, color: L.text2, name: `legend/${i}` });
    });
    for (const t of transfers()) arrow(ctx, card, t.net, t.pts, t.color, __spreadValues({ label: t.label }, t.labelAt ? { labelAt: t.labelAt } : {}));
    return card;
  }

  // src/live/magnifier.ts
  function collectPrefixed(top, net, prefix) {
    const gateAt = /* @__PURE__ */ new Map();
    net.gates.forEach((g, i) => {
      if (g.path.startsWith(prefix)) gateAt.set(g.path, i);
    });
    const gateLit = /* @__PURE__ */ new Map();
    const wireLit = /* @__PURE__ */ new Map();
    const stray = [];
    const walk = (node, scope) => {
      for (const c of node.children) {
        if (c.type === "INSTANCE") {
          const path = scope + c.name;
          const gi = gateAt.get(path);
          if (gi !== void 0) {
            const lit3 = c.children.find((x) => x.name === LIT);
            if (lit3) gateLit.set(gi, lit3);
          } else if (c.children.some((x) => x.name === LIT) && !c.children.some((x) => x.type === "INSTANCE")) stray.push(path);
          else walk(c, `${path}/`);
          continue;
        }
        const local = wireLitNet(c.name);
        if (local !== null) {
          const id = net.aliases.get(scope + local);
          if (id !== void 0 && id > 1) {
            const list = wireLit.get(id);
            if (list) list.push(c);
            else wireLit.set(id, [c]);
          }
          continue;
        }
        if (c.name.startsWith(PORT_PREFIX)) continue;
        if ("children" in c) walk(c, scope);
      }
    };
    walk(top, prefix);
    const missing = [...gateAt].filter(([, i]) => !gateLit.has(i)).map(([p]) => p);
    return { gateLit, wireLit, missing, stray };
  }
  var DEFAULT_MAGNIFIERS = [
    { cell: "FULL_ADDER", prefix: "alu/add/fa3", title: "the adder's bit 3", caption: "cell/FULL_ADDER at alu/add/fa3 \xB7 these gates are the CPU's own, live" },
    { cell: "DFFE", prefix: "regs/r0/b0", title: "R0, bit 0", caption: "cell/DFFE at regs/r0/b0 \xB7 a flip-flop: master + slave latch" },
    { cell: "DLATCH", prefix: "ram/row15/b1", title: "RAM[15], bit 1", caption: "cell/DLATCH at ram/row15/b1 \xB7 one bit of memory" }
  ];
  function componentPorts(main) {
    const out = [];
    for (const c of main.children) {
      const p = parsePortMarker(c.name);
      if (p) out.push({ name: p.name, dir: p.dir, width: p.width });
    }
    return out;
  }
  function drawMagnifier(ctx, parent, spec, main, net, x, y, w, h) {
    const prefix = `${spec.prefix.replace(/\/+$/, "")}/`;
    const f = frame(ctx, parent, magName(prefix), x, y, w, h, { fill: L.block, radius: 10, stroke: L.line });
    text(ctx, f, spec.title, 14, 10, { size: 11, font: "bold", name: "title" });
    text(ctx, f, spec.caption, 14, 26, { size: 9, color: L.text3, name: "caption" });
    const vpY = 44;
    const vpH = h - vpY - 30;
    const vp = frame(ctx, f, "viewport", 14, vpY, w - 28, vpH, { fill: "#1A1A1A", radius: 6, clip: true });
    if (!main) {
      text(ctx, vp, `cell/${spec.cell} is not on the canvas: run Build hardware`, 12, vpH / 2 - 7, { size: 10, color: L.text3, name: "missing" });
      return { frame: f, instance: null, scale: 0 };
    }
    const inst = main.createInstance();
    vp.appendChild(inst);
    try {
      const props = {};
      const ports = new Map(componentPorts(main).map((p) => [p.name, p]));
      for (const [key, d] of Object.entries(main.componentPropertyDefinitions)) {
        const p = ports.get(propName(key));
        if (d.type !== "TEXT" || !p) continue;
        const nets = portBits(p).map((b) => {
          const id = net.aliases.get(prefix + b);
          return id === void 0 ? b : net.netNames[id];
        });
        props[key] = formatNets(nets);
      }
      if (Object.keys(props).length) inst.setProperties(props);
    } catch (e) {
    }
    const scale = Math.min(1, (w - 44) / inst.width, (vpH - 12) / inst.height);
    if (scale < 1 && typeof inst.rescale === "function") inst.rescale(scale);
    const sw = typeof inst.rescale === "function" ? inst.width : inst.width * scale;
    const sh = typeof inst.rescale === "function" ? inst.height : inst.height * scale;
    inst.x = Math.round((w - 28 - sw) / 2);
    inst.y = Math.round((vpH - sh) / 2);
    let px = 14;
    const py = h - 22;
    for (const p of [...componentPorts(main)].sort((a, b) => a.dir === b.dir ? 0 : a.dir === "in" ? -1 : 1)) {
      for (const b of portBits(p)) {
        const label2 = text(ctx, f, b, px, py + 1, { size: 8.5, font: "mono", color: p.dir === "in" ? L.text2 : L.text, name: `port/${b}` });
        px += Math.max(label2.width, b.length * 5.3) + 4;
        lamp(ctx, f, prefix + b, px, py, 12, p.dir === "in" ? L.load : L.alu);
        px += 22;
      }
      if (p.dir === "in") px += 0;
    }
    return { frame: f, instance: inst, scale };
  }

  // src/live/panels.ts
  var hex = (n, w) => n.toString(16).toUpperCase().padStart(w, "0");
  function listingText(source) {
    const r = assemble(source);
    if (r.errors.length) return source.trim();
    const lines = source.split(/\r?\n/);
    const out = [];
    lines.forEach((raw, i) => {
      const code = raw.replace(/;.*$/, "").replace(/\s+/g, " ").trim();
      if (!code) return;
      const addr = r.lineAddr[i + 1];
      if (addr === void 0) {
        if (/^[A-Za-z_]\w*:$/.test(code)) out.push(`         ${code}`);
        return;
      }
      const op = code.replace(/^[A-Za-z_]\w*:\s*/, "");
      const size = op.startsWith(".") ? Math.max(1, op.slice(op.indexOf(" ") + 1).split(",").length) : disassemble(r.bytes, addr).size;
      const bytes = r.bytes.slice(addr, Math.min(RAM_BYTES, addr + size)).map((b) => hex(b, 2)).join(" ");
      out.push(`${hex(addr, 1)}  ${bytes.padEnd(5)}  ${code}`);
    });
    return out.join("\n");
  }
  function programBlurb(source) {
    const first = source.split(/\r?\n/).find((l) => l.trim().startsWith(";"));
    if (!first) return "";
    let s = first.replace(/^\s*;\s*/, "");
    const dash = s.indexOf("\u2014");
    if (dash >= 0) s = s.slice(dash + 1);
    s = s.split(/[;.](\s|$)/)[0].trim();
    return s.length > 36 ? `${s.slice(0, 35)}\u2026` : s;
  }
  function drawListing(ctx, parent, x, y, w, name, source) {
    const program = text(ctx, parent, name, x, y, { size: 12, font: "semibold", color: L.text, name: PROGRAM_NAME });
    const listing = text(ctx, parent, listingText(source), x, y + 22, { size: 10, font: "mono", color: L.text2, w, lineHeight: 15, name: LISTING });
    return { program, listing };
  }
  function diskColor(name) {
    const palette = [L.load, L.alu, L.mem, L.drive, L.ctrl, L.out, L.blue];
    let h = 0;
    for (const c of name) h = h * 31 + c.charCodeAt(0) >>> 0;
    return palette[h % palette.length];
  }
  function drawDisks(ctx, parent, x, y, w, programs, rowH = 36, gap = 2) {
    const disks = /* @__PURE__ */ new Map();
    const names = [...Object.keys(programs), CUSTOM_DISK];
    names.forEach((name, i) => {
      const custom = name === CUSTOM_DISK && !(name in programs);
      const f = frame(ctx, parent, diskName(name), x, y + i * (rowH + gap), w, rowH, custom ? { fill: L.chrome, radius: 6, stroke: L.line2 } : { fill: L.cell, radius: 6 });
      if (custom) f.dashPattern = [4, 3];
      const c = custom ? L.text3 : diskColor(name);
      rect(ctx, f, "icon", 10, rowH / 2 - 10, 20, 20, __spreadValues({ fill: c, radius: 3 }, custom ? { fill: null, stroke: c } : {}));
      if (!custom) {
        rect(ctx, f, "icon/label", 14, rowH / 2 - 1, 12, 8, { fill: "#FFFFFF", fillOpacity: 0.9, radius: 1 });
        rect(ctx, f, "icon/shutter", 15, rowH / 2 - 10, 9, 6, { fill: "#000000", fillOpacity: 0.35, radius: 1 });
      }
      text(ctx, f, name, 40, 4, { size: 11.5, font: "semibold", color: custom ? L.text2 : L.text, name: "name" });
      const blurb = custom ? "the program the plugin loaded last" : programBlurb(programs[name]);
      text(ctx, f, blurb, 40, 19, { size: 9, color: L.text3, name: "blurb" });
      disks.set(name, f);
    });
    return disks;
  }
  function drawPad(ctx, parent, x, y, cols, rows, cell = 30, gap = 3, cellComponent) {
    const inset = 6;
    const w = 2 * inset + cols * cell + (cols - 1) * gap;
    const h = 2 * inset + rows * cell + (rows - 1) * gap;
    const pad = frame(ctx, parent, CTL_PAD, x, y, w, h, { fill: "#232323", radius: 10, stroke: L.line });
    const cells = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const t = (r + c) / (rows + cols - 2 || 1);
        const shade = Math.round(52 + t * 16).toString(16).padStart(2, "0");
        const fill = `#${shade}${shade}${shade}`;
        const [cx, cy] = [inset + c * (cell + gap), inset + r * (cell + gap)];
        if (cellComponent) {
          const inst = cellComponent.createInstance();
          inst.name = padCellName(i);
          put(pad, inst, cx, cy);
          inst.fills = solid2(fill);
          cells.push(inst);
        } else cells.push(frame(ctx, pad, padCellName(i), cx, cy, cell, cell, { fill, radius: 6 }));
      }
    return { pad, cells };
  }
  var SEGS = [
    [9, 0, 38, 8],
    [48, 8, 8, 38],
    [48, 54, 8, 38],
    [9, 92, 38, 8],
    [0, 54, 8, 38],
    [0, 8, 8, 38],
    [9, 46, 38, 8]
  ];
  function drawSevenSeg(ctx, parent, x, y, w, h) {
    const win = frame(ctx, parent, "display", x, y, w, h, { fill: L.display, radius: 10, stroke: L.line });
    const dw = 56;
    const gap = 28;
    const x0 = Math.round((w - 2 * dw - gap) / 2);
    const y0 = Math.round((h - 100) / 2);
    ["SEG_HI", "SEG_LO"].forEach(
      (port, d) => SEGS.forEach(([sx, sy, sw, sh], s) => {
        const seg = lamp(ctx, win, `${port}[${s}]`, x0 + d * (dw + gap) + sx, y0 + sy, Math.min(sw, sh), L.out, { kind: "seg", w: sw, h: sh, radius: 3, off: L.segOff });
        const lit3 = seg.children.find((c) => c.name === "lit");
        if (lit3) glow(lit3, L.out, 10, 0.8);
      })
    );
    return win;
  }
  function drawRamMatrix(ctx, parent, x, y, w, lampSize = 13, pitch = 17) {
    const h = 18 + RAM_BYTES * pitch + 4;
    const f = frame(ctx, parent, "memory", x, y, w, h, { fill: null });
    const lx = 22;
    bitLabels(ctx, f, 8, lx, 2, pitch, lampSize);
    for (let a = 0; a < RAM_BYTES; a++) {
      const ry = 16 + a * pitch;
      const band = frame(ctx, f, bound("row", `ram/sel[${a}]`), 0, ry - 2, w, pitch, { fill: null });
      const lit3 = frame(ctx, band, "lit", 0, 0, w, pitch, { fill: L.mem, fillOpacity: 0.16, radius: 4 });
      lit3.strokes = [{ type: "SOLID", color: solid2(L.mem)[0].color, opacity: 0.6 }];
      text(ctx, lit3, "\u2190 MAR", w - 46, 2, { size: 8.5, font: "monoBold", color: L.mem, name: "label" });
      lit3.visible = false;
      text(ctx, f, hex(a, 1), 4, ry, { size: 9, font: "mono", color: L.text3, name: `addr/${a}` });
      for (let i = 0; i < 8; i++) lamp(ctx, f, ramBit(a, 7 - i), lx + i * pitch, ry, lampSize, L.mem, { radius: 3 });
    }
    return f;
  }

  // src/live/dashboard.ts
  var DASHBOARD_W = 1920;
  var DASHBOARD_H = 1200;
  var TOPBAR = 48;
  var SIDE_L = 256;
  var SIDE_R = 296;
  function findDashboard(page) {
    var _a;
    return (_a = page.children.find((n) => n.type === "COMPONENT" && n.name === DASHBOARD_NAME)) != null ? _a : null;
  }
  var PAD_CELL = 38;
  function drawPadCell(ctx, page, x, y) {
    const c = ctx.api.createComponent();
    page.appendChild(c);
    c.name = PAD_CELL_NAME;
    c.resize(PAD_CELL, PAD_CELL);
    c.x = x;
    c.y = y;
    c.cornerRadius = 8;
    c.fills = [{ type: "SOLID", color: { r: 58 / 255, g: 58 / 255, b: 58 / 255 } }];
    c.description = "One cell of the Live clock pad: entering it with the mouse runs one chunk of the CPU's tick (lane L2 stores that reaction here once).";
    rect(ctx, c, "dot", PAD_CELL / 2 - 2, PAD_CELL / 2 - 2, 4, 4, { fill: "#FFFFFF", fillOpacity: 0.12, radius: 2 });
    return c;
  }
  function freeSpot(page, gap = 800) {
    const others = page.children.filter((n) => !isLiveNode(n));
    if (!others.length) return { x: 0, y: 0 };
    return {
      x: Math.round(Math.max(...others.map((n) => n.x + n.width)) + gap),
      y: Math.round(Math.min(...others.map((n) => n.y)))
    };
  }
  function findCellComponent(pages, name) {
    const full = `cell/${name}`;
    for (const p of pages) {
      const top = p.children.find((n) => n.type === "COMPONENT" && n.name === full);
      if (top) return top;
    }
    for (const p of pages) {
      const deep = p.findAllWithCriteria({ types: ["COMPONENT"] }).find((n) => n.name === full);
      if (deep) return deep;
    }
    return null;
  }
  async function buildDashboard(api, page, net, opts = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    const log = (_a = opts.log) != null ? _a : (() => {
    });
    await page.loadAsync();
    await api.setCurrentPageAsync(page);
    const fonts2 = await loadLiveFonts(api);
    const ctx = { api, fonts: fonts2 };
    const programs = (_b = opts.programs) != null ? _b : PROGRAMS;
    const source = (_e = (_d = (_c = opts.source) != null ? _c : programs.mul) != null ? _d : Object.values(programs)[0]) != null ? _e : "";
    const programName = (_g = opts.programName) != null ? _g : (_f = Object.keys(programs).find((k) => programs[k] === source)) != null ? _f : "custom";
    const old = findDashboard(page);
    const at = (_h = opts.at) != null ? _h : old ? { x: old.x, y: old.y } : freeSpot(page);
    if (old) {
      old.remove();
      log(`replaced the old ${DASHBOARD_NAME}`);
    }
    for (const n of [...page.children]) if (n.type === "COMPONENT" && n.name === PAD_CELL_NAME) n.remove();
    const padCell = drawPadCell(ctx, page, at.x, at.y - PAD_CELL - 40);
    const comp = api.createComponent();
    page.appendChild(comp);
    comp.name = DASHBOARD_NAME;
    comp.resize(DASHBOARD_W, DASHBOARD_H);
    comp.x = at.x;
    comp.y = at.y;
    comp.fills = [{ type: "SOLID", color: { r: 30 / 255, g: 30 / 255, b: 30 / 255 } }];
    comp.clipsContent = true;
    comp.description = "FigmaCPU Live: the gate-level CPU at every layer \u2014 program, microcode, datapath, gates \u2014 lit by variable bindings only. Built by the plugin (Live view); lane L2 wires ctl/step, ctl/run, ctl/stop, ctl/reset, ctl/pad/<i> and disk/<program>.";
    rect(ctx, comp, "chrome/top", 0, 0, DASHBOARD_W, TOPBAR, { fill: L.chrome });
    rect(ctx, comp, "chrome/top/edge", 0, TOPBAR - 1, DASHBOARD_W, 1, { fill: L.line });
    rect(ctx, comp, "chrome/left", 0, TOPBAR, SIDE_L, DASHBOARD_H - TOPBAR, { fill: L.chrome });
    rect(ctx, comp, "chrome/left/edge", SIDE_L - 1, TOPBAR, 1, DASHBOARD_H - TOPBAR, { fill: L.line });
    const rx = DASHBOARD_W - SIDE_R;
    rect(ctx, comp, "chrome/right", rx, TOPBAR, SIDE_R, DASHBOARD_H - TOPBAR, { fill: L.chrome });
    rect(ctx, comp, "chrome/right/edge", rx, TOPBAR, 1, DASHBOARD_H - TOPBAR, { fill: L.line });
    const chip = frame(ctx, comp, "logo", 16, 12, 24, 24, { fill: null, radius: 6, stroke: L.text2, strokeWeight: 1.5 });
    rect(ctx, chip, "core", 7, 7, 10, 10, { fill: L.blue, radius: 2 });
    text(ctx, comp, "FigmaCPU", 50, 15, { size: 14, font: "bold", name: "title" });
    text(ctx, comp, "Live", 128, 15, { size: 14, color: L.text2, name: "title/live" });
    const pill = frame(ctx, comp, "chip/stats", 172, 13, 392, 22, { fill: L.cell, radius: 11 });
    text(ctx, pill, `${thousands(net.gates.length)} gates \xB7 ${thousands(net.netNames.length - 2)} wires \xB7 computed by Figma's prototype engine`, 0, 0, {
      size: 9.5,
      font: "mono",
      color: L.text2,
      w: 392,
      h: 22,
      align: "CENTER",
      valign: "CENTER",
      name: "label"
    });
    const bw = 92;
    const bx = Math.round(DASHBOARD_W / 2 - (4 * bw + 3 * 8) / 2);
    const step = button(ctx, comp, CTL_STEP, "Step", bx, 8, bw, 32, L.blue);
    const run = button(ctx, comp, CTL_RUN, "Run", bx + (bw + 8), 8, bw, 32, "#14AE5C");
    const stop = button(ctx, comp, CTL_STOP, "Stop", bx + 2 * (bw + 8), 8, bw, 32, "#F24822");
    const reset = button(ctx, comp, CTL_RESET, "Reset", bx + 3 * (bw + 8), 8, bw, 32, L.cell, { outline: true });
    vector(ctx, step, "icon", [[[22, 10], [22, 22]]], [[[12, 10], [20, 16], [12, 22]]], "#FFFFFF", 2);
    vector(ctx, run, "icon", [], [[[14, 10], [23, 16], [14, 22]]], "#FFFFFF", 1);
    rect(ctx, stop, "icon", 13, 11, 10, 10, { fill: "#FFFFFF", radius: 2 });
    for (const b of [step, run, stop]) {
      const label2 = b.children.find((c) => c.name === "label");
      if (label2) {
        label2.x = 16;
        label2.resize(bw - 20, 32);
      }
    }
    const ro = DASHBOARD_W - 380;
    text(ctx, comp, "TICK", ro, 8, { size: 8.5, font: "semibold", color: L.text3, tracking: 8, name: "label/tick" });
    const tickText = text(ctx, comp, "0", ro, 20, { size: 17, font: "monoBold", color: L.drive, name: varBound("ctl/tickText") });
    text(ctx, comp, "PHASE", ro + 100, 8, { size: 8.5, font: "semibold", color: L.text3, tracking: 8, name: "label/phase" });
    const phaseText = text(ctx, comp, "0", ro + 100, 20, { size: 17, font: "monoBold", color: L.text, name: varBound("ctl/phaseText") });
    const running = frame(ctx, comp, varBound("ctl/running"), DASHBOARD_W - 156, 12, 140, 24, { fill: null, radius: 12, stroke: L.line2 });
    text(ctx, running, "\u25CF  stopped", 0, 0, { size: 10, font: "semibold", color: L.text3, w: 140, h: 24, align: "CENTER", valign: "CENTER", name: "label" });
    const runLit = frame(ctx, running, "lit", 0, 0, 140, 24, { fill: "#14AE5C", fillOpacity: 0.22, radius: 12, stroke: "#14AE5C" });
    text(ctx, runLit, "\u25CF  RUNNING", 0, 0, { size: 10, font: "bold", color: "#3DDC84", w: 140, h: 24, align: "CENTER", valign: "CENTER", name: "label" });
    runLit.visible = false;
    const lx = 16;
    const lw = SIDE_L - 32;
    header(ctx, comp, "Disks", lx, 64);
    text(ctx, comp, "click one to load it, in Present mode", lx + 52, 64, { size: 9, color: L.text3, name: "hint/disks" });
    const disks = drawDisks(ctx, comp, lx, 84, lw, programs);
    const loading = frame(ctx, comp, varBound("ctl/loading"), lx, 58, lw, 22, { fill: null });
    const loadLit = frame(ctx, loading, "lit", 0, 0, lw, 22, { fill: L.mem, radius: 11 });
    text(ctx, loadLit, "loading disk\u2026  (one chunk per hop)", 0, 0, { size: 10, font: "semibold", color: "#FFFFFF", w: lw, h: 22, align: "CENTER", valign: "CENTER", name: "label" });
    loadLit.visible = false;
    const listY = 84 + disks.size * 38 + 18;
    header(ctx, comp, "Listing", lx, listY);
    const { listing, program } = drawListing(ctx, comp, lx, listY + 20, lw, programName, source);
    header(ctx, comp, "How it works", lx, DASHBOARD_H - 196);
    text(
      ctx,
      comp,
      `Every wire of the CPU is a BOOLEAN variable (${thousands(net.netNames.length - 2)} of them) and every one of its ${thousands(net.gates.length)} gates is a SET_VARIABLE action, run by Figma's prototype engine on each Step. Everything on this page is a visibility binding to those variables: it adds no gate and no action.`,
      lx,
      DASHBOARD_H - 176,
      { size: 10, color: L.text3, w: lw, lineHeight: 15, name: "about" }
    );
    const px = rx + 16;
    const pw = SIDE_R - 32;
    header(ctx, comp, "Clock pad", px, 64);
    text(ctx, comp, "sweep the mouse across the pad: every cell you enter runs one chunk of the tick", px, 80, { size: 9.5, color: L.text3, w: pw, lineHeight: 13, name: "hint/pad" });
    const cols = (_i = opts.padCols) != null ? _i : 6;
    const rows = (_j = opts.padRows) != null ? _j : 5;
    const gapP = Math.max(2, Math.floor((pw - 12 - cols * PAD_CELL) / Math.max(1, cols - 1)));
    const { pad, cells: padCells } = drawPad(ctx, comp, px, 112, cols, rows, PAD_CELL, gapP, padCell);
    const outY = 112 + pad.height + 20;
    header(ctx, comp, "Output", px, outY);
    drawSevenSeg(ctx, comp, px, outY + 20, pw, 128);
    text(ctx, comp, "OUT", px, outY + 160, { size: 9, font: "monoBold", color: L.text2, name: "label/out" });
    lampRow(ctx, comp, bitsMsbFirst("OUT", 8), px + 32, outY + 158, 13, 17, L.out);
    text(ctx, comp, "HALT", px + 32 + 8 * 17 + 14, outY + 160, { size: 9, font: "monoBold", color: L.text2, name: "label/halt" });
    lamp(ctx, comp, "halted", px + 32 + 8 * 17 + 48, outY + 158, 13, L.out);
    const memY = outY + 196;
    header(ctx, comp, "Memory", px, memY);
    text(ctx, comp, "16 bytes \xB7 code and data share it", px + 70, memY, { size: 9, color: L.text3, name: "hint/memory" });
    const mem = drawRamMatrix(ctx, comp, px, memY + 20, pw, 15, 19);
    const legY = memY + 20 + mem.height + 16;
    header(ctx, comp, "Highlights", px, legY);
    const legend = [
      [L.blue, "microcode: row = opcode in IR, column = T-state; the cell where they cross is executing"],
      [L.mem, "memory: the row MAR addresses"]
    ];
    let ly = legY + 20;
    for (const [c, s] of legend) {
      rect(ctx, comp, "legend/swatch", px, ly + 2, 10, 10, { fill: c, fillOpacity: 0.5, radius: 2, stroke: c });
      const t = text(ctx, comp, s, px + 18, ly, { size: 9.5, color: L.text3, w: pw - 18, lineHeight: 13, name: "legend/text" });
      ly += Math.max(18, t.height + 6);
    }
    header(ctx, comp, "Controls", px, DASHBOARD_H - 150);
    text(
      ctx,
      comp,
      "Step runs one chunk of a tick (a tick is several chunks: the viewer allows ~400 actions per event). Run loops by itself (~1 chunk/s). The pad clocks at mouse speed. Reset reloads the current disk; a disk loads its program in a few hops.",
      px,
      DASHBOARD_H - 130,
      { size: 9.5, color: L.text3, w: pw, lineHeight: 14, name: "hint/controls" }
    );
    const cx = SIDE_L + 16;
    const cw = DASHBOARD_W - SIDE_L - SIDE_R - 32;
    drawDatapath(ctx, comp, cx, TOPBAR + 16, Math.max(cw, DATAPATH_W), DATAPATH_H);
    const mc = drawMicrocode(ctx, comp, cx, TOPBAR + 16 + DATAPATH_H + 16, cw, 18);
    const magY = mc.y + mc.height + 16;
    const magH = DASHBOARD_H - 16 - magY;
    const specs = (_k = opts.magnifiers) != null ? _k : DEFAULT_MAGNIFIERS;
    const cellPages = (_l = opts.cellPages) != null ? _l : [page];
    const mains = specs.map((s) => findCellComponent(cellPages, s.cell));
    const magCard = frame(ctx, comp, "magnifiers", cx, magY, cw, magH, { fill: L.card, radius: 12, stroke: L.line });
    text(ctx, magCard, "Magnifiers", 16, 12, { size: 13, font: "bold", name: "title" });
    text(ctx, magCard, "instances of the real cell components from the canvas, each bound to one copy inside the CPU: its gates glow with the CPU's own wires", 112, 15, {
      size: 10,
      color: L.text3,
      name: "subtitle"
    });
    const gapM = 16;
    const avail = cw - 32 - gapM * (specs.length - 1);
    const weights = mains.map((m) => Math.pow(m ? m.width : 500, 0.7));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    let mx = 16;
    const magnifiers = [];
    specs.forEach((s, i) => {
      const w = Math.floor(avail * weights[i] / wsum);
      magnifiers.push(drawMagnifier(ctx, magCard, s, mains[i], net, mx, 38, w, magH - 38 - 14));
      mx += w + gapM;
    });
    const missingCells = specs.filter((_, i) => !mains[i]).map((s) => `cell/${s.cell}`);
    if (missingCells.length) log(`magnifiers: ${missingCells.join(", ")} not found (Build hardware first)`);
    const containers = Object.fromEntries(NET_KINDS.map((k) => [k, 0]));
    const all = comp.findAll();
    for (const n of all) {
      const b = parseBound(n.name);
      if (b && "children" in n && n.children.some((c) => c.name === "lit")) containers[b.kind]++;
    }
    const stats = {
      w: DASHBOARD_W,
      h: DASHBOARD_H,
      layers: all.length,
      containers,
      padCells: padCells.length,
      disks: disks.size,
      magnifiers: magnifiers.map((m, i) => ({
        cell: specs[i].cell,
        prefix: specs[i].prefix,
        found: !!m.instance,
        scale: Math.round(m.scale * 1e3) / 1e3,
        layers: m.instance ? m.instance.findAll().length + 1 : 0
      })),
      missingCells
    };
    log(`${DASHBOARD_NAME}: ${stats.layers} layers, ${Object.values(containers).reduce((a, b) => a + b, 0)} lit containers, ${magnifiers.filter((m) => m.instance).length} magnifier(s)`);
    return {
      component: comp,
      nodes: { step, run, stop, reset, pad, padCells, padCell, disks, listing, program, tickText, phaseText, running, loading, magnifiers },
      stats
    };
  }
  function thousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function bindDashboard(root, net, varByNet, opts = {}) {
    const report = {
      bound: 0,
      constant: 0,
      unbound: [],
      unknown: [],
      byKind: { lamp: 0, seg: 0, arrow: 0, row: 0, col: 0, tag: 0, gate: 0, wire: 0, var: 0 },
      texts: 0,
      missingVars: [],
      magnifiers: []
    };
    const unbound = /* @__PURE__ */ new Set();
    const bindNet = (node, id, kind) => {
      if (id <= 1) {
        bindVisible(node, id === 1);
        report.constant++;
        return;
      }
      const v = varByNet.get(id);
      if (!v) {
        unbound.add(net.netNames[id]);
        return;
      }
      bindVisible(node, v);
      report.bound++;
      report.byKind[kind]++;
    };
    const bindInstance = (inst, prefix) => {
      const b = collectPrefixed(inst, net, prefix);
      for (const [gi, node] of b.gateLit) bindNet(node, net.gates[gi].out, "gate");
      let wires = 0;
      for (const [id, nodes] of b.wireLit)
        for (const node of nodes) {
          bindNet(node, id, "wire");
          wires++;
        }
      report.magnifiers.push({ prefix, gates: b.gateLit.size, wires, missing: b.missing, stray: b.stray });
    };
    const walk = (node, mag) => {
      var _a;
      for (const c of node.children) {
        if (c.type === "INSTANCE") {
          if (mag && !opts.varsOnly) bindInstance(c, mag);
          continue;
        }
        const b = parseBound(c.name);
        if (b && "children" in c) {
          if (opts.varsOnly) continue;
          const lit3 = c.children.find((x) => x.name === "lit");
          if (!lit3) continue;
          const id = net.aliases.get(b.net);
          if (id === void 0) report.unknown.push(c.name);
          else bindNet(lit3, id, b.kind);
          continue;
        }
        const vn = parseVar(c.name);
        if (vn !== null) {
          const v = (_a = opts.ctl) == null ? void 0 : _a.get(vn);
          if (c.type === "TEXT") {
            if (v && v.resolvedType === "STRING") {
              c.setBoundVariable("characters", v);
              report.texts++;
              report.byKind.var++;
            } else report.missingVars.push(vn);
          } else if ("children" in c) {
            const lit3 = c.children.find((x) => x.name === "lit");
            if (lit3 && v && v.resolvedType === "BOOLEAN") {
              bindVisible(lit3, v);
              report.bound++;
              report.byKind.var++;
            } else if (lit3) report.missingVars.push(vn);
          }
          continue;
        }
        const m = parseMag(c.name);
        if ("children" in c) walk(c, m != null ? m : mag);
      }
    };
    walk(root, null);
    report.unbound = [...unbound];
    return report;
  }

  // src/prototype/figma-actions.ts
  var boolData = (value2) => ({
    type: "BOOLEAN",
    resolvedType: "BOOLEAN",
    value: value2
  });
  var floatData = (value2) => ({
    type: "FLOAT",
    resolvedType: "FLOAT",
    value: value2
  });
  var aliasData = (id, resolvedType = "BOOLEAN") => ({
    type: "VARIABLE_ALIAS",
    resolvedType,
    value: { type: "VARIABLE_ALIAS", id }
  });
  var exprData = (expressionFunction, expressionArguments, resolvedType = "BOOLEAN") => ({
    type: "EXPRESSION",
    resolvedType,
    value: { expressionFunction, expressionArguments }
  });
  var setVariable = (variableId, variableValue) => ({
    type: "SET_VARIABLE",
    variableId,
    variableValue
  });
  var conditional = (condition, then, otherwise) => ({
    type: "CONDITIONAL",
    conditionalBlocks: otherwise ? [{ condition, actions: then }, { actions: otherwise }] : [{ condition, actions: then }]
  });
  var increment = (variableId, by = 1) => setVariable(
    variableId,
    exprData(
      "ADDITION",
      [aliasData(variableId, "FLOAT"), floatData(by)],
      "FLOAT"
    )
  );
  var strData = (value2) => ({
    type: "STRING",
    resolvedType: "STRING",
    value: value2
  });
  var concatText = (textId, numberId, prefix = "") => setVariable(
    textId,
    exprData(
      "ADDITION",
      [strData(prefix), aliasData(numberId, "FLOAT")],
      "STRING"
    )
  );
  var onClick = () => ({ type: "ON_CLICK" });
  var mouseDown = (delay = 0) => ({
    type: "MOUSE_DOWN",
    delay
  });
  var mouseUp = (delay = 0) => ({ type: "MOUSE_UP", delay });
  var afterTimeout = (timeout) => ({
    type: "AFTER_TIMEOUT",
    timeout
  });
  var navigateWith = (destinationId, navigation) => ({
    type: "NODE",
    destinationId,
    navigation,
    transition: null
  });
  function worstCase(actions) {
    let n = 0;
    for (const a of actions)
      n += a.type === "CONDITIONAL" ? 1 + Math.max(0, ...a.conditionalBlocks.map((b) => worstCase(b.actions))) : 1;
    return n;
  }
  function lookup(varIds) {
    return (n) => {
      const id = varIds instanceof Map ? varIds.get(n) : varIds[n];
      if (id === void 0) throw new Error(`no Figma variable for net ${n}`);
      return id;
    };
  }
  function figmaExpr(e, id) {
    if ("var" in e) return aliasData(id(e.var));
    if ("const" in e) return boolData(e.const === 1);
    if ("not" in e) return exprData("NOT", [figmaExpr(e.not, id)]);
    const [fn, [a, b]] = "and" in e ? ["AND", e.and] : "or" in e ? ["OR", e.or] : "eq" in e ? ["EQUALS", e.eq] : ["NOT_EQUAL", e.neq];
    return exprData(fn, [figmaExpr(a, id), figmaExpr(b, id)]);
  }
  function setValue(to, id, opts) {
    if ("var" in to && opts.copy !== "alias")
      return exprData("EQUALS", [aliasData(id(to.var)), boolData(true)]);
    return figmaExpr(to, id);
  }
  function figmaActions(list, varIds, opts = {}) {
    const id = lookup(varIds);
    const conv = (l) => l.map(
      (a) => "set" in a ? setVariable(id(a.set), setValue(a.to, id, opts)) : conditional(
        figmaExpr(a.if, id),
        conv(a.then),
        a.else ? conv(a.else) : void 0
      )
    );
    return conv(list);
  }
  function nestedConditional(actions, path = "actions") {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.type !== "CONDITIONAL") continue;
      for (let b = 0; b < a.conditionalBlocks.length; b++) {
        const inner = a.conditionalBlocks[b].actions;
        const at = inner.findIndex((x) => x.type === "CONDITIONAL");
        if (at >= 0) return `${path}[${i}].conditionalBlocks[${b}].actions[${at}]`;
      }
    }
    return null;
  }

  // src/prototype/schedule.ts
  var X2 = 2;
  function eval32(type, a, b) {
    switch (type) {
      case "BUF":
        return a;
      case "NOT":
        return a === X2 ? X2 : a ? 0 : 1;
      case "AND":
      case "NAND": {
        const y = a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : X2;
        return type === "AND" || y === X2 ? y : y ? 0 : 1;
      }
      case "OR":
      case "NOR": {
        const y = a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : X2;
        return type === "OR" || y === X2 ? y : y ? 0 : 1;
      }
      case "XOR":
      case "XNOR": {
        if (a === X2 || b === X2) return X2;
        const y = a ^ b;
        return type === "XOR" ? y : 1 - y;
      }
    }
  }
  function constants3(net, clk, level) {
    const k = new Uint8Array(net.netNames.length).fill(X2);
    k[NET0] = 0;
    k[NET1] = 1;
    if (clk >= 0) k[clk] = level;
    for (let changed = true; changed; ) {
      changed = false;
      for (const g of net.gates) {
        if (k[g.out] !== X2) continue;
        const y = eval32(g.type, k[g.in[0]], g.in.length > 1 ? k[g.in[1]] : 0);
        if (y !== X2) {
          k[g.out] = y;
          changed = true;
        }
      }
    }
    return k;
  }

  // src/prototype/gating.ts
  function gateSchedule(net, schedule, opts = {}) {
    var _a, _b, _c, _d;
    const minSaving = (_a = opts.minSaving) != null ? _a : 4;
    const clk = (_b = net.aliases.get("CLK")) != null ? _b : -1;
    const K = [constants3(net, clk, 0), constants3(net, clk, 1)];
    const { gates, driver } = net;
    const readers = net.netNames.map(() => []);
    gates.forEach((g, i) => new Set(g.in).forEach((n) => readers[n].push(i)));
    const lowOrder = schedule.passes[0].order;
    const highOrder = schedule.passes[1].order;
    const positions = (order) => {
      const pos = /* @__PURE__ */ new Map();
      order.forEach((gi, p) => {
        var _a2;
        return pos.set(gi, [...(_a2 = pos.get(gi)) != null ? _a2 : [], p]);
      });
      return pos;
    };
    const lowPos = positions(lowOrder);
    const highPos = positions(highOrder);
    const forcedBy = (seeds, v) => {
      const f = new Map([
        [NET0, 0],
        [NET1, 1],
        ...seeds.map((w) => [w, v])
      ]);
      const val = (n) => f.has(n) ? f.get(n) : X2;
      const work = [...seeds];
      while (work.length) {
        const n = work.pop();
        for (const gi of readers[n]) {
          const g = gates[gi];
          if (f.has(g.out)) continue;
          const y = eval32(g.type, val(g.in[0]), g.in.length > 1 ? val(g.in[1]) : 0);
          if (y !== X2) {
            f.set(g.out, y);
            work.push(g.out);
          }
        }
      }
      return f;
    };
    const greatest = (allowed, forced) => {
      const r = new Set(allowed);
      for (let changed = true; changed; ) {
        changed = false;
        for (const gi of r) {
          const g = gates[gi];
          if (forced(g.out)) continue;
          if (g.in.every((n) => n === NET0 || n === NET1 || forced(n) || driver[n] >= 0 && r.has(driver[n]))) continue;
          r.delete(gi);
          changed = true;
        }
      }
      return r;
    };
    const lowRegion = (seeds, v, pool) => {
      const ds = new Set(seeds.map((w) => driver[w]));
      const after = Math.max(...seeds.flatMap((w) => {
        var _a2;
        return (_a2 = lowPos.get(driver[w])) != null ? _a2 : [-1];
      }));
      const f = forcedBy(seeds, v);
      const cone = /* @__PURE__ */ new Set();
      const work = [...seeds];
      const seen = new Set(seeds);
      while (work.length) {
        const n = work.pop();
        for (const gi of readers[n]) {
          if (!pool.has(gi) || ds.has(gi) || cone.has(gi)) continue;
          if (Math.min(...lowPos.get(gi)) <= after) continue;
          cone.add(gi);
          const o = gates[gi].out;
          if (!seen.has(o)) {
            seen.add(o);
            work.push(o);
          }
        }
      }
      return greatest(cone, (n) => f.has(n));
    };
    const evals = (r, pos) => [...r].reduce((s, gi) => {
      var _a2, _b2;
      return s + ((_b2 = (_a2 = pos.get(gi)) == null ? void 0 : _a2.length) != null ? _b2 : 0);
    }, 0);
    const vn = valueNumbers(net, lowPos, new Set(schedule.sccs.flat(2)));
    const classes = /* @__PURE__ */ new Map();
    for (let w = 2; w < net.netNames.length; w++) {
      if (K[0][w] !== X2 || K[1][w] === X2 || driver[w] < 0 || !lowPos.has(driver[w]) || w === clk) continue;
      classes.set(vn[w], [...(_c = classes.get(vn[w])) != null ? _c : [], w]);
    }
    const choose = (pool, exclude) => {
      const cands = [];
      for (const seeds of classes.values()) {
        if (seeds.some((w) => exclude.has(w))) continue;
        const v = K[1][seeds[0]];
        const size = evals(lowRegion(seeds, v, pool), lowPos);
        if (size >= minSaving) cands.push({ seeds, v, size });
      }
      cands.sort((a, b) => b.size - a.size || a.seeds[0] - b.seeds[0]);
      const free = new Set(pool);
      const out = [];
      for (const c of cands) {
        const r = lowRegion(c.seeds, c.v, free);
        if (evals(r, lowPos) < minSaving) continue;
        for (const gi of r) free.delete(gi);
        out.push({ w: c.seeds[0], seeds: c.seeds, v: c.v, gates: r, children: choose(r, /* @__PURE__ */ new Set([...exclude, ...c.seeds])) });
      }
      return out;
    };
    const top = choose(new Set(lowOrder), /* @__PURE__ */ new Set([clk]));
    const flagBase = (_d = opts.flagBase) != null ? _d : net.netNames.length;
    const flags = [];
    const highGates = new Set(highOrder);
    const highRegion = /* @__PURE__ */ new Map();
    const assignHigh = (rs) => {
      for (const r of rs) {
        const allowed = new Set([...r.gates].filter((gi) => highGates.has(gi)));
        const h = greatest(allowed, (n) => K[1][n] !== X2);
        if (evals(h, highPos) >= minSaving) {
          r.flag = flagBase + flags.length;
          flags.push(r.flag);
          highRegion.set(r, h);
        }
        assignHigh(r.children);
      }
    };
    assignHigh(top);
    let blocks = 0;
    const lowGuard = (r) => r.v === 0 ? { var: r.w } : { not: { var: r.w } };
    const buildLow = (items, rs) => {
      for (const r of rs) {
        const g = lowGuard(r);
        items = segment(items, r.gates, g, gates);
        for (const it of items)
          if (typeof it !== "number" && it.guard === g) {
            blocks++;
            it.items = buildLow(it.items, r.children);
            if (r.flag !== void 0) it.setFlag = { id: r.flag, value: 1 };
          }
      }
      return items;
    };
    const buildHigh = (items, rs) => {
      for (const r of rs) {
        const h = highRegion.get(r);
        if (!h || r.flag === void 0) {
          items = buildHigh(items, r.children);
          continue;
        }
        const g = { var: r.flag };
        items = segment(items, h, g, gates);
        const mine = items.filter((it) => typeof it !== "number" && it.guard === g);
        mine.forEach((b) => {
          blocks++;
          b.items = buildHigh(b.items, r.children);
        });
        if (mine.length) mine[mine.length - 1].setFlag = { id: r.flag, value: 0 };
        else throw new Error(`gating: HIGH region of ${net.netNames[r.w]} not found in its pass`);
      }
      return items;
    };
    const low = buildLow([...lowOrder], top);
    const high = buildHigh([...highOrder], top);
    return { passes: [low, high], flags, blocks };
  }
  function valueNumbers(net, lowPos, cyclic) {
    const { gates, driver } = net;
    const vn = new Array(net.netNames.length).fill(-1);
    const intern = /* @__PURE__ */ new Map();
    const unique = (n) => {
      intern.set(`#${n}`, intern.size);
      return vn[n] = intern.get(`#${n}`);
    };
    const onStack = /* @__PURE__ */ new Set();
    const sym = /* @__PURE__ */ new Set(["AND", "OR", "NAND", "NOR", "XOR", "XNOR"]);
    const visit = (n) => {
      var _a, _b;
      if (vn[n] >= 0) return vn[n];
      const d = driver[n];
      if (n <= 1 || d < 0 || cyclic.has(d) || onStack.has(n) || ((_b = (_a = lowPos.get(d)) == null ? void 0 : _a.length) != null ? _b : 0) > 1) return unique(n);
      onStack.add(n);
      const g = gates[d];
      const ins = g.in.map(visit);
      onStack.delete(n);
      if (vn[n] >= 0) return vn[n];
      if (sym.has(g.type)) ins.sort((a, b) => a - b);
      const key = `${g.type}${lowPos.has(d) ? "L" : "S"}(${ins.join(",")})`;
      if (!intern.has(key)) intern.set(key, intern.size);
      return vn[n] = intern.get(key);
    };
    for (let n = 0; n < net.netNames.length; n++) visit(n);
    return vn;
  }
  function rwOf(it, gates) {
    if (typeof it === "number") return { reads: new Set(gates[it].in), writes: /* @__PURE__ */ new Set([gates[it].out]) };
    const rw = { reads: new Set(exprVars(it.guard)), writes: /* @__PURE__ */ new Set() };
    if (it.setFlag) rw.writes.add(it.setFlag.id);
    for (const c of it.items) {
      const x = rwOf(c, gates);
      x.reads.forEach((n) => rw.reads.add(n));
      x.writes.forEach((n) => rw.writes.add(n));
    }
    return rw;
  }
  function exprVars(e) {
    if ("var" in e) return [e.var];
    if ("const" in e) return [];
    if ("not" in e) return exprVars(e.not);
    const [a, b] = "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
    return [...exprVars(a), ...exprVars(b)];
  }
  var meets = (a, b) => {
    const [s, l] = a.size < b.size ? [a, b] : [b, a];
    for (const x of s) if (l.has(x)) return true;
    return false;
  };
  var commutes = (a, b) => !meets(a.writes, b.reads) && !meets(b.writes, a.reads) && !meets(a.writes, b.writes);
  var addRW = (to, x) => {
    x.reads.forEach((n) => to.reads.add(n));
    x.writes.forEach((n) => to.writes.add(n));
  };
  function segment(items, region, guard, gates) {
    const out = [];
    let cur = null;
    let curRW = { reads: /* @__PURE__ */ new Set(), writes: /* @__PURE__ */ new Set() };
    let before = [];
    let after = [];
    let afterRW = { reads: /* @__PURE__ */ new Set(), writes: /* @__PURE__ */ new Set() };
    const flush = () => {
      if (!cur) return;
      out.push(...before, { guard, items: cur }, ...after);
      cur = null;
      before = [];
      after = [];
      afterRW = { reads: /* @__PURE__ */ new Set(), writes: /* @__PURE__ */ new Set() };
    };
    for (const it of items) {
      const inRegion = typeof it === "number" && region.has(it);
      const rw = rwOf(it, gates);
      if (inRegion) {
        if (cur && commutes(rw, afterRW)) {
          cur.push(it);
          addRW(curRW, rw);
          continue;
        }
        flush();
        cur = [it];
        curRW = { reads: /* @__PURE__ */ new Set([...rw.reads, ...exprVars(guard)]), writes: new Set(rw.writes) };
        continue;
      }
      if (!cur) {
        out.push(it);
        continue;
      }
      if (commutes(rw, curRW) && commutes(rw, afterRW)) before.push(it);
      else {
        after.push(it);
        addRW(afterRW, rw);
      }
    }
    flush();
    return out;
  }

  // src/prototype/plan.ts
  var ZERO = { const: 0 };
  var ONE = { const: 1 };
  function ref(net) {
    return net === NET0 ? ZERO : net === NET1 ? ONE : { var: net };
  }
  var lit2 = (v) => v ? ONE : ZERO;
  var sameVar = (a, b) => "var" in a && "var" in b && a.var === b.var;
  function not(e) {
    if ("const" in e) return lit2(!e.const);
    if ("not" in e) return e.not;
    return { not: e };
  }
  function and(a, b) {
    if ("const" in a) return a.const ? b : ZERO;
    if ("const" in b) return b.const ? a : ZERO;
    return sameVar(a, b) ? a : { and: [a, b] };
  }
  function or(a, b) {
    if ("const" in a) return a.const ? ONE : b;
    if ("const" in b) return b.const ? ONE : a;
    return sameVar(a, b) ? a : { or: [a, b] };
  }
  function eq(a, b) {
    if ("const" in a) return a.const ? b : not(b);
    if ("const" in b) return b.const ? a : not(a);
    return sameVar(a, b) ? ONE : { eq: [a, b] };
  }
  function neq(a, b) {
    if ("const" in a) return a.const ? not(b) : b;
    if ("const" in b) return b.const ? not(a) : a;
    return sameVar(a, b) ? ZERO : { neq: [a, b] };
  }
  function gateExpr(g) {
    const a = ref(g.in[0]);
    const b = g.in.length > 1 ? ref(g.in[1]) : ZERO;
    switch (g.type) {
      case "BUF":
        return a;
      case "NOT":
        return not(a);
      case "AND":
        return and(a, b);
      case "OR":
        return or(a, b);
      case "NAND":
        return not(and(a, b));
      case "NOR":
        return not(or(a, b));
      case "XOR":
        return neq(a, b);
      case "XNOR":
        return eq(a, b);
    }
  }
  function setActions(out, e, flat = false) {
    if (flat && "not" in e && !("var" in e.not) && !("not" in e.not))
      return [
        { set: out, to: e.not },
        { set: out, to: { not: { var: out } } }
      ];
    return [{ set: out, to: e }];
  }
  function exprDepth(e) {
    if ("var" in e || "const" in e) return 0;
    if ("not" in e) return 1 + exprDepth(e.not);
    const [a, b] = "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
    return 1 + Math.max(exprDepth(a), exprDepth(b));
  }
  function countActions(list) {
    var _a;
    let n = 0;
    for (const a of list) n += "set" in a ? 1 : 1 + countActions(a.then) + countActions((_a = a.else) != null ? _a : []);
    return n;
  }
  function worstActions(list) {
    var _a;
    let n = 0;
    for (const a of list) n += "set" in a ? 1 : 1 + Math.max(worstActions(a.then), worstActions((_a = a.else) != null ? _a : []));
    return n;
  }
  var DEFAULT_MAX_ACTIONS_PER_EVENT = 400;
  var needsChunks = (worst, cap, tickExtra = 4) => Number.isFinite(cap) && worst + tickExtra + 2 > cap;
  var dispatchOverhead = (chunks) => chunks + 5;
  function planVars(e) {
    if ("var" in e) return [e.var];
    if ("const" in e) return [];
    if ("not" in e) return planVars(e.not);
    const [a, b] = "and" in e ? e.and : "or" in e ? e.or : "eq" in e ? e.eq : e.neq;
    return [...planVars(a), ...planVars(b)];
  }
  function writes(list, out = /* @__PURE__ */ new Set()) {
    var _a;
    for (const a of list) {
      if ("set" in a) out.add(a.set);
      else {
        writes(a.then, out);
        writes((_a = a.else) != null ? _a : [], out);
      }
    }
    return out;
  }
  function splitActions(list, budget) {
    var _a;
    if (budget < 1) throw new Error(`chunk budget ${budget} is too small`);
    const out = [];
    let cur = [];
    let w = 0;
    const add = (a, wa) => {
      if (w + wa > budget && cur.length) {
        out.push(cur);
        cur = [];
        w = 0;
      }
      cur.push(a);
      w += wa;
    };
    for (const a of list) {
      const wa = worstActions([a]);
      if (wa <= budget || "set" in a) {
        add(a, wa);
        continue;
      }
      const thenP = splitActions(a.then, budget - 1);
      const elseP = ((_a = a.else) == null ? void 0 : _a.length) ? splitActions(a.else, budget - 1) : [];
      const n = Math.max(thenP.length, elseP.length);
      const at = (ps, j) => {
        var _a2;
        return (_a2 = ps[j - (n - ps.length)]) != null ? _a2 : [];
      };
      const cond = new Set(planVars(a.if));
      for (let j = 0; j < n; j++) {
        const t = at(thenP, j);
        const e = at(elseP, j);
        if (j < n - 1 && [...writes([...t, ...e])].some((x) => cond.has(x)))
          throw new Error("cannot split a conditional whose body changes its own condition before its end");
        const piece = e.length ? { if: a.if, then: t, else: e } : { if: a.if, then: t };
        add(piece, worstActions([piece]));
      }
    }
    if (cur.length) out.push(cur);
    return out;
  }
  function chunkTick(tick, o) {
    var _a;
    const cap = o.maxActionsPerEvent;
    const tickExtra = (_a = o.tickExtra) != null ? _a : 4;
    for (let k = 1; ; k++) {
      const budget = cap - dispatchOverhead(k) - tickExtra;
      if (budget < 1) throw new Error(`maxActionsPerEvent ${cap} is too small for this tick: dispatching ${k} chunks leaves no room`);
      const chunks = splitActions(tick, budget);
      if (chunks.length > k) {
        k = chunks.length - 1;
        continue;
      }
      const perEvent = chunks.map((c, i) => worstActions(c) + dispatchOverhead(chunks.length) + (i === chunks.length - 1 ? tickExtra : 0));
      return { maxActionsPerEvent: cap, tickExtra, chunks, perEvent };
    }
  }
  function maxDepth(list) {
    var _a;
    let d = 0;
    for (const a of list)
      d = Math.max(d, "set" in a ? exprDepth(a.to) : Math.max(exprDepth(a.if), maxDepth(a.then), maxDepth((_a = a.else) != null ? _a : [])));
    return d;
  }
  function varName(hier) {
    const clean = hier.replace(/[.{}]/g, "_").split("/").map((s) => s.trim()).filter(Boolean).join("/");
    return `net/${clean || "_"}`;
  }
  function plan(net, schedule, opts) {
    var _a, _b, _c, _d, _e;
    const { initial } = opts;
    if (initial.length !== net.netNames.length) throw new Error(`initial has ${initial.length} values for ${net.netNames.length} nets`);
    const [low, high] = schedule.passes;
    if (low.clk !== 0 || high.clk !== 1) throw new Error("schedule must be [CLK=0 pass, CLK=1 pass]");
    const clk = netId(net, (_a = opts.clk) != null ? _a : "CLK");
    const used = /* @__PURE__ */ new Set([clk]);
    for (const g of net.gates) {
      used.add(g.out);
      for (const n of g.in) used.add(n);
    }
    for (const p of net.ports) for (const n of p.nets) used.add(n);
    used.delete(NET0);
    used.delete(NET1);
    const taken = /* @__PURE__ */ new Set();
    const variables = [...used].sort((a, b) => a - b).map((n) => {
      let name = varName(net.netNames[n]);
      for (let k = 2; taken.has(name); k++) name = `${varName(net.netNames[n])}~${k}`;
      taken.add(name);
      return { net: n, name, init: initial[n] === 1 };
    });
    const gateActs = (gi) => {
      const g = net.gates[gi];
      if (!g) throw new Error(`schedule refers to gate ${gi}, netlist has ${net.gates.length}`);
      return setActions(g.out, gateExpr(g), opts.flat);
    };
    const gating = opts.gate ? gateSchedule(net, schedule) : null;
    const items = (list) => list.flatMap(
      (it) => typeof it === "number" ? gateActs(it) : [{ if: it.guard, then: [...items(it.items), ...it.setFlag ? [{ set: it.setFlag.id, to: lit2(it.setFlag.value) }] : []] }]
    );
    const lowActs = gating ? items(gating.passes[0]) : low.order.flatMap(gateActs);
    const highActs = gating ? items(gating.passes[1]) : high.order.flatMap(gateActs);
    const tick = [{ set: clk, to: ZERO }, ...lowActs, { set: clk, to: ONE }, ...highActs];
    const flags = ((_b = gating == null ? void 0 : gating.flags) != null ? _b : []).map((id, k) => ({ net: id, name: `gate/dirty/${k}`, init: false }));
    const reset = [...variables, ...flags].map((v) => ({ set: v.net, to: lit2(v.init) }));
    const cap = (_c = opts.maxActionsPerEvent) != null ? _c : DEFAULT_MAX_ACTIONS_PER_EVENT;
    const chunking = needsChunks(worstActions(tick), cap, opts.tickExtra) ? chunkTick(tick, { maxActionsPerEvent: cap, tickExtra: opts.tickExtra }) : void 0;
    return __spreadProps(__spreadValues(__spreadValues(__spreadProps(__spreadValues({
      name: (_d = opts.name) != null ? _d : "Silicon",
      variables,
      flags,
      clk
    }, opts.halt !== void 0 ? { halt: netId(net, opts.halt) } : {}), {
      gateOut: net.gates.map((g) => g.out),
      tick,
      reset
    }), Number.isFinite(cap) ? { maxActionsPerEvent: cap } : {}), chunking ? { chunking } : {}), {
      stats: __spreadValues({
        gates: net.gates.length,
        variables: variables.length,
        actionsPerTick: countActions(tick),
        lowPass: countActions(lowActs),
        highPass: countActions(highActs),
        maxDepth: maxDepth(tick),
        worstCase: worstActions(tick),
        gatedBlocks: (_e = gating == null ? void 0 : gating.blocks) != null ? _e : 0
      }, chunking ? { chunks: chunking.chunks.length, maxEvent: Math.max(...chunking.perEvent) } : {})
    });
  }

  // src/prototype/live.ts
  function cpuPrograms(net, sources, listing = asmListing) {
    return Object.entries(sources).map(([name, src]) => {
      var _a;
      const r = assemble(src);
      if (r.errors.length) throw new Error(`disk ${name}: ${r.errors.map((e) => `line ${e.line}: ${e.msg}`).join("; ")}`);
      const pokes = {};
      for (let a = 0; a < RAM_BYTES; a++) {
        const v = ((_a = r.bytes[a]) != null ? _a : 0) & 255;
        for (let b = 0; b < 8; b++) pokes[ramBit(a, b)] = v >> b & 1;
      }
      return { name, initial: powerOn(net, pokes), listing: listing(src) };
    });
  }
  function asmListing(source) {
    return source.split("\n").map((l) => l.replace(/;.*$/, "").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  }

  // livetab/src/patch.ts
  var LIVE = "os-ui \xB7 live (gate-level CPU)";
  var ACTS_NS = "osui";
  var ACTS_KEY = "acts";
  var PREFIX = "Leila CPU \xB7 ";
  var COLLECTION = "Leila CPU";
  var VIEW_COLLECTION = "Figma OS \xB7 view";
  var TAB_VAR = "tab/cpu";
  var NS = "livetab";
  var MADE = "made";
  var CAP = 400;
  var AROUND = 10;
  var DEFAULT_PROGRAM = "ptrout";
  var CUSTOM = "custom";
  var CLOSE = { type: "CLOSE" };
  var child = (n, pred) => {
    var _a;
    return (_a = n.children.find(pred)) != null ? _a : null;
  };
  var need = (x, what) => {
    if (x == null) throw new Error(`the live frame has no ${what}`);
    return x;
  };
  var actsOf = (n) => {
    try {
      return n.getSharedPluginData(ACTS_NS, ACTS_KEY);
    } catch (e) {
      return "";
    }
  };
  async function findLive(api) {
    for (const page of [
      api.currentPage,
      ...api.root.children.filter((p) => p !== api.currentPage)
    ]) {
      await page.loadAsync();
      const frame2 = page.children.find(
        (c) => c.name === LIVE && c.type === "FRAME"
      );
      if (frame2) return { page, frame: frame2 };
    }
    return null;
  }
  async function removeLiveTab(api) {
    let n = 0;
    let ids = [];
    try {
      ids = JSON.parse(api.root.getSharedPluginData(NS, MADE) || "[]");
    } catch (e) {
      ids = [];
    }
    for (const id of ids) {
      const node = await api.getNodeByIdAsync(id);
      if (node && !node.removed && node.type !== "PAGE" && node.type !== "DOCUMENT") {
        node.remove();
        n++;
      }
    }
    api.root.setSharedPluginData(NS, MADE, "");
    await removeCollections(api, COLLECTION);
    return n;
  }
  async function addLiveTab(api, o = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const log = (_a = o.log) != null ? _a : (() => {
    });
    const breathe2 = (_b = o.breathe) != null ? _b : (async () => {
    });
    const problems = [];
    const where = await findLive(api);
    if (!where)
      throw new Error(`no frame "${LIVE}" in this file: build the live OS first`);
    const { page, frame: frame2 } = where;
    await removeLiveTab(api);
    const made = [];
    const keep = (n) => (made.push(n), n);
    const remember = () => api.root.setSharedPluginData(
      NS,
      MADE,
      JSON.stringify(made.filter((n) => !n.removed).map((n) => n.id))
    );
    const app = need(frame2.children[0], "app");
    const right = need(
      child(app, (n) => n.name.startsWith("aside.right-panel")),
      "right panel"
    );
    const canvas = need(
      child(app, (n) => n.name.startsWith("main.canvas")),
      "canvas"
    );
    const views = (await api.variables.getLocalVariableCollectionsAsync()).find(
      (c) => c.name === VIEW_COLLECTION
    );
    const tabVar = views && (await api.variables.getLocalVariablesAsync()).find(
      (v) => v.variableCollectionId === views.id && v.name === TAB_VAR
    );
    if (!tabVar)
      throw new Error(
        `no "${TAB_VAR}" variable in "${VIEW_COLLECTION}": add the Figma OS extension (CPU + Learn) first, then this`
      );
    const blocker = frame2.findOne(
      (n) => actsOf(n) === JSON.stringify([{ on: "block" }])
    );
    const press = ((_e = (_d = (_c = blocker == null ? void 0 : blocker.reactions) == null ? void 0 : _c[0]) == null ? void 0 : _d.actions) != null ? _e : []).slice();
    if (!press.length)
      log(
        "no press actions found on the live frame: clicks on the view only block the canvas"
      );
    log("compiling the CPU\u2026");
    const net = cpuNetlist();
    const sched = compile(net, { inputs: [] });
    const programs = cpuPrograms(net, PROGRAMS, listingText);
    const bootName = (_f = o.program) != null ? _f : DEFAULT_PROGRAM;
    const boot = programs.findIndex((d) => d.name === bootName);
    if (boot < 0)
      throw new Error(
        `no program "${bootName}" (programs: ${programs.map((d) => d.name).join(", ")})`
      );
    const disks = [...programs, __spreadProps(__spreadValues({}, programs[boot]), { name: CUSTOM })];
    const p = plan(net, sched, {
      initial: programs[boot].initial,
      name: COLLECTION,
      halt: PROBES.HALTED.name,
      maxActionsPerEvent: Infinity
    });
    const chunks = splitActions(p.tick, CAP - AROUND);
    const K = chunks.length;
    const control = [
      { name: "ctl/ticks", type: "FLOAT", init: 0 },
      { name: "ctl/tickText", type: "STRING", init: "0" },
      { name: "ctl/running", type: "BOOLEAN", init: false },
      { name: "ctl/phase", type: "FLOAT", init: 0 },
      { name: "ctl/phaseText", type: "STRING", init: "0" },
      ...chunks.map((_, k) => ({
        name: `ctl/phaseIs/${k}`,
        type: "BOOLEAN",
        init: k === 0
      })),
      { name: "ctl/program", type: "STRING", init: bootName },
      { name: "ctl/listing", type: "STRING", init: (_g = programs[boot].listing) != null ? _g : "" },
      { name: "ctl/loading", type: "BOOLEAN", init: false },
      ...disks.map((_, e) => ({
        name: `ctl/diskIs/${e}`,
        type: "BOOLEAN",
        init: e === boot
      })),
      { name: "view/show", type: "BOOLEAN", init: true },
      { name: "view/hide", type: "BOOLEAN", init: false },
      { name: "view/tap", type: "BOOLEAN", init: false }
    ];
    const netVars = [...p.variables, ...(_h = p.flags) != null ? _h : []];
    log(
      `creating ${control.length + netVars.length} variables in "${COLLECTION}"\u2026`
    );
    const { vars } = await createVariables(
      api,
      COLLECTION,
      [
        ...control,
        ...netVars.map((v) => ({
          name: v.name,
          type: "BOOLEAN",
          init: v.init
        }))
      ],
      { log }
    );
    const ctl = new Map(control.map((c, i) => [c.name, vars[i]]));
    const cv = (name) => need(ctl.get(name), `variable ${name}`);
    const varIds = /* @__PURE__ */ new Map();
    const varByNet = /* @__PURE__ */ new Map();
    netVars.forEach((v, i) => {
      varIds.set(v.net, vars[control.length + i].id);
      varByNet.set(v.net, vars[control.length + i]);
    });
    await breathe2();
    const ticks = cv("ctl/ticks");
    const running = cv("ctl/running");
    const phase = cv("ctl/phase");
    const phaseIs = (k) => cv(`ctl/phaseIs/${k}`);
    const set = (v, x) => setVariable(
      v.id,
      typeof x === "boolean" ? boolData(x) : typeof x === "number" ? floatData(x) : strData(x)
    );
    const tickDone = [
      increment(ticks.id),
      concatText(cv("ctl/tickText").id, ticks.id)
    ];
    const chunkEvent = (k) => {
      const next = (k + 1) % K;
      return [
        ...figmaActions(chunks[k], varIds),
        set(phase, next),
        concatText(cv("ctl/phaseText").id, phase.id),
        set(phaseIs(k), false),
        set(phaseIs(next), true),
        ...k === K - 1 ? tickDone : []
      ];
    };
    const isRunning = exprData("EQUALS", [aliasData(running.id), boolData(true)]);
    const halted = p.halt !== void 0 && p.halt > 1 ? varIds.get(p.halt) : void 0;
    const keepGoing = halted ? exprData("AND", [
      aliasData(running.id),
      exprData("NOT", [aliasData(halted)])
    ]) : isRunning;
    const values = disks.map(
      (d) => p.variables.map((v) => d.initial[v.net] ? 1 : 0)
    );
    const varying = [];
    const shared = [];
    p.variables.forEach((v, i) => {
      if (values.some((vals) => vals[i] !== values[0][i])) varying.push(i);
      else shared.push({ set: v.net, to: lit2(values[0][i] === 1) });
    });
    for (const f of (_i = p.flags) != null ? _i : []) shared.push({ set: f.net, to: lit2(false) });
    const tail = [
      set(ticks, 0),
      set(cv("ctl/tickText"), "0"),
      set(phase, 0),
      set(cv("ctl/phaseText"), "0"),
      ...chunks.map((_, k) => set(phaseIs(k), k === 0)),
      set(running, false),
      set(cv("ctl/loading"), false)
    ];
    const loads = splitActions(shared, CAP - AROUND - tail.length);
    const startLoad = (e) => {
      var _a2;
      return [
        set(running, false),
        set(cv("ctl/loading"), true),
        ...disks.map((_, x) => set(cv(`ctl/diskIs/${x}`), x === e)),
        set(cv("ctl/program"), disks[e].name),
        set(cv("ctl/listing"), (_a2 = disks[e].listing) != null ? _a2 : ""),
        ...varying.map(
          (i) => setVariable(
            varIds.get(p.variables[i].net),
            boolData(values[e][i] === 1)
          )
        )
      ];
    };
    let stored = 0;
    const react = async (node, label2, reactions) => {
      var _a2, _b2;
      for (const r of reactions) {
        const acts = (_a2 = r.actions) != null ? _a2 : [];
        const bad = nestedConditional(acts);
        if (bad)
          throw new Error(
            `${label2}: a CONDITIONAL nested at ${bad} (Figma rejects it)`
          );
        const w = worstCase(acts);
        if (w > CAP)
          throw new Error(
            `${label2} (${(_b2 = r.trigger) == null ? void 0 : _b2.type}) can execute ${w} actions in one event, more than ${CAP}`
          );
        stored += countAll(acts);
      }
      try {
        await node.setReactionsAsync(reactions);
      } catch (e) {
        problems.push(`${label2}: ${e instanceof Error ? e.message : e}`);
      }
    };
    const tapActs = (acts) => [
      {
        trigger: mouseDown(),
        actions: press.length ? press : [set(cv("view/tap"), true)]
      },
      { trigger: mouseUp(), actions: [...press, ...acts] }
    ];
    const blockAll = () => {
      const acts = press.length ? press : [set(cv("view/tap"), true)];
      return [
        { trigger: mouseDown(), actions: acts },
        { trigger: mouseUp(), actions: acts },
        { trigger: onClick(), actions: acts }
      ];
    };
    await loadFonts2(api);
    const at = { x: frame2.x, y: frame2.y + frame2.height + 400 };
    log("drawing the magnified cells\u2026");
    const before = new Set(page.children.map((n) => n.id));
    const mags = DEFAULT_MAGNIFIERS.map((m) => m.cell);
    await drawLibrary(
      cpuLibrary(),
      { gates: page, cells: page, cpu: page },
      { only: mags, gateLabels: false }
    );
    const libNodes = page.children.filter((n) => !before.has(n.id));
    let lx = at.x;
    const ly = at.y + 1200 + 200;
    for (const n of libNodes) {
      n.x = lx;
      n.y = ly;
      lx += n.width + 80;
      keep(n);
    }
    remember();
    await breathe2();
    log("drawing the dashboard\u2026");
    const dash = await buildDashboard(api, page, net, {
      at,
      source: PROGRAMS[bootName],
      programName: bootName,
      programs: PROGRAMS,
      cellPages: [page],
      log
    });
    const comp = keep(dash.component);
    comp.name = `${PREFIX}Dashboard`;
    keep(dash.nodes.padCell);
    remember();
    const report = bindDashboard(comp, net, varByNet, { ctl });
    log(
      `bound ${report.bound} lights${report.unbound.length ? `, ${report.unbound.length} without a variable` : ""}`
    );
    if (report.missingVars.length)
      log(`texts without a variable: ${report.missingVars.join(", ")}`);
    const pad = comp.findOne((n) => n.name === CTL_PAD);
    if (pad) pad.visible = false;
    for (const t of comp.findAll(
      (n) => n.type === "TEXT" && (n.name === "hint/pad" || n.characters === "Clock pad")
    ))
      t.visible = false;
    await breathe2();
    const W = frame2.width;
    const H = frame2.height;
    const overlay = (name, label2, stop, i) => {
      const f = keep(api.createFrame());
      page.appendChild(f);
      f.name = `${PREFIX}${name}`;
      f.resize(W, H);
      f.x = at.x + 2e3 + i % 4 * (W + 80);
      f.y = at.y + Math.floor(i / 4) * (H + 80);
      f.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.01 }];
      f.clipsContent = true;
      const pill = api.createFrame();
      f.appendChild(pill);
      pill.name = "pill";
      pill.resize(stop ? 320 : 260, 44);
      pill.x = Math.round((W - pill.width) / 2);
      pill.y = H - 44 - 28;
      pill.cornerRadius = 10;
      pill.fills = [{ type: "SOLID", color: hex2("#2C2C2C") }];
      pill.strokes = [{ type: "SOLID", color: hex2("#444444") }];
      pill.effects = [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.4 },
          offset: { x: 0, y: 4 },
          radius: 16,
          spread: 0,
          visible: true,
          blendMode: "NORMAL"
        }
      ];
      const t = api.createText();
      pill.appendChild(t);
      t.fontName = { family: "Inter", style: "Medium" };
      t.fontSize = 12;
      t.characters = label2;
      t.fills = [{ type: "SOLID", color: hex2("#E6E6E6") }];
      t.x = 16;
      t.y = Math.round((44 - t.height) / 2);
      let button2 = null;
      if (stop) {
        button2 = api.createFrame();
        pill.appendChild(button2);
        button2.name = "stop";
        button2.resize(72, 28);
        button2.x = pill.width - 72 - 8;
        button2.y = 8;
        button2.cornerRadius = 6;
        button2.fills = [{ type: "SOLID", color: hex2("#E5484D") }];
        const s2 = api.createText();
        button2.appendChild(s2);
        s2.fontName = { family: "Inter", style: "Medium" };
        s2.fontSize = 12;
        s2.characters = "Stop";
        s2.fills = [{ type: "SOLID", color: hex2("#FFFFFF") }];
        s2.x = Math.round((72 - s2.width) / 2);
        s2.y = Math.round((28 - s2.height) / 2);
      }
      return { f, button: button2 };
    };
    const runs = chunks.map(
      (_, k) => overlay(`Run ${k + 1}`, `Running \xB7 chunk ${k + 1} of ${K}`, true, k)
    );
    const loadOv = loads.map(
      (_, j) => overlay(
        `Load ${j + 1}`,
        `Loading the program \xB7 ${j + 1} of ${loads.length}`,
        false,
        K + j
      )
    );
    remember();
    const delay = 1e-3;
    log(`wiring the clock: ${K} chunks per tick, ${loads.length} hops per load\u2026`);
    for (const [k, r] of runs.entries()) {
      const go = [...chunkEvent(k), navigateWith(runs[(k + 1) % K].f.id, "SWAP")];
      const stopNow = [set(running, false), CLOSE];
      await react(r.f, `Run ${k + 1}`, [
        {
          trigger: afterTimeout(delay),
          actions: [conditional(k === 0 ? keepGoing : isRunning, go, stopNow)]
        },
        ...blockAll()
      ]);
      await react(
        r.button,
        `Run ${k + 1} \xB7 Stop`,
        tapActs([set(running, false)])
      );
      await breathe2();
    }
    for (const [j, l] of loadOv.entries()) {
      const last = j === loads.length - 1;
      const acts = [
        ...figmaActions(loads[j], varIds),
        ...last ? [...tail, CLOSE] : [navigateWith(loadOv[j + 1].f.id, "SWAP")]
      ];
      await react(l.f, `Load ${j + 1}`, [
        { trigger: afterTimeout(delay), actions: acts },
        ...blockAll()
      ]);
      await breathe2();
    }
    const loadClick = (e) => [
      ...startLoad(e),
      navigateWith(loadOv[0].f.id, "OVERLAY")
    ];
    const named = (name) => comp.findAll(
      (n) => n.name === name && !insideInstance(n, comp)
    );
    const stackOf = (name, count, visibleBy) => {
      const base = need(named(name)[0], `dashboard layer ${name}`);
      const out = [base];
      const parent = base.parent;
      for (let i = 1; i < count; i++) {
        const c = base.clone();
        parent.appendChild(c);
        c.x = base.x;
        c.y = base.y;
        out.push(c);
      }
      out.forEach((b, i) => bindVisible(b, visibleBy(i)));
      return out;
    };
    const steps = stackOf(CTL_STEP, K, phaseIs);
    for (const [k, b] of steps.entries())
      await react(b, `Step ${k + 1}`, tapActs(chunkEvent(k)));
    const runButtons = stackOf(CTL_RUN, K, phaseIs);
    for (const [k, b] of runButtons.entries())
      await react(
        b,
        `Run ${k + 1}`,
        tapActs([set(running, true), navigateWith(runs[k].f.id, "OVERLAY")])
      );
    for (const b of named(CTL_STOP))
      await react(b, "Stop", tapActs([set(running, false)]));
    const resets = stackOf(CTL_RESET, disks.length, (e) => cv(`ctl/diskIs/${e}`));
    for (const [e, b] of resets.entries())
      await react(b, `Reset (${disks[e].name})`, tapActs(loadClick(e)));
    for (const [e, d] of disks.entries())
      for (const b of named(diskName(d.name)))
        await react(b, `disk ${d.name}`, tapActs(loadClick(e)));
    await breathe2();
    const x0 = canvas.x;
    const y0 = canvas.y;
    const vw = right.x + right.width - x0;
    const vh = frame2.height - y0;
    const root = keep(api.createFrame());
    app.appendChild(root);
    root.name = `${PREFIX}tab`;
    root.resize(vw, vh);
    root.x = x0;
    root.y = y0;
    root.fills = [];
    root.clipsContent = true;
    bindVisible(root, tabVar);
    const view = api.createFrame();
    root.appendChild(view);
    view.name = `${PREFIX}view`;
    view.resize(vw, vh);
    view.x = 0;
    view.y = 0;
    view.fills = [{ type: "SOLID", color: hex2("#1E1E1E") }];
    bindVisible(view, cv("view/show"));
    await react(view, "view", blockAll());
    const inst = comp.createInstance();
    view.appendChild(inst);
    inst.name = `${PREFIX}Live`;
    const s = Math.min((vw - 24) / comp.width, (vh - 56) / comp.height);
    if ("rescale" in inst) inst.rescale(s);
    else inst.resize(comp.width * s, comp.height * s);
    inst.x = Math.round((vw - comp.width * s) / 2);
    inst.y = 44;
    const toggle = (parent, name, label2, x, y) => {
      const b = api.createFrame();
      parent.appendChild(b);
      b.name = `${PREFIX}${name}`;
      b.resize(10, 28);
      b.cornerRadius = 6;
      b.fills = [{ type: "SOLID", color: hex2("#2C2C2C") }];
      b.strokes = [{ type: "SOLID", color: hex2("#444444") }];
      const t = api.createText();
      b.appendChild(t);
      t.fontName = { family: "Inter", style: "Medium" };
      t.fontSize = 12;
      t.characters = label2;
      t.fills = [{ type: "SOLID", color: hex2("#E6E6E6") }];
      b.resize(Math.ceil(t.width) + 24, 28);
      t.x = 12;
      t.y = Math.round((28 - t.height) / 2);
      b.x = x - b.width;
      b.y = y;
      return b;
    };
    const title = api.createText();
    view.appendChild(title);
    title.fontName = { family: "Inter", style: "Medium" };
    title.fontSize = 13;
    title.characters = "Leila's CPU \xB7 2,296 gates running in Figma \xB7 LDR/STR pointers";
    title.fills = [{ type: "SOLID", color: hex2("#E6E6E6") }];
    title.x = inst.x;
    title.y = 14;
    const toOs = toggle(view, "show OS chip", "OS chip \u203A", vw - 16, 8);
    await react(
      toOs,
      "OS chip",
      tapActs([set(cv("view/show"), false), set(cv("view/hide"), true)])
    );
    const back = toggle(
      root,
      "show Leila CPU",
      "\u2039 Leila's CPU",
      canvas.width - 16,
      8
    );
    bindVisible(back, cv("view/hide"));
    await react(
      back,
      "Leila's CPU",
      tapActs([set(cv("view/show"), true), set(cv("view/hide"), false)])
    );
    remember();
    const worst = (acts) => worstCase(acts);
    const perEvent = {
      step: Math.max(
        ...chunks.map((_, k) => worst([...press, ...chunkEvent(k)]))
      ),
      runHop: Math.max(
        ...chunks.map(
          (_, k) => worst([
            conditional(
              isRunning,
              [...chunkEvent(k), CLOSE],
              [set(running, false), CLOSE]
            )
          ])
        )
      ),
      diskClick: Math.max(
        ...disks.map((_, e) => worst([...press, ...loadClick(e)]))
      ),
      loadHop: Math.max(
        ...loads.map(
          (l, j) => worst([
            ...figmaActions(l, varIds),
            ...j === loads.length - 1 ? [...tail, CLOSE] : [CLOSE]
          ])
        )
      )
    };
    const layers = made.reduce(
      (n, m) => n + 1 + ("findAll" in m ? m.findAll(() => true).length : 0),
      0
    );
    log(
      `added: ${K} events per tick (\u2264 ${perEvent.step} actions), a load = 1 click (${varying.length} wires) + ${loads.length} hops, ${stored} actions stored, ${layers} layers`
    );
    return {
      frame: frame2,
      view,
      dashboard: comp,
      variables: control.length + netVars.length,
      chunks: K,
      loadHops: loads.length,
      disks: disks.map((d) => d.name),
      perEvent,
      stored,
      layers,
      bound: report.bound,
      problems,
      net,
      schedule: sched,
      varIds,
      controls: new Map([...ctl].map(([n, v]) => [n, v.id])),
      overlays: { runs: runs.map((r) => r.f), loads: loadOv.map((l) => l.f) }
    };
  }
  function insideInstance(n, top) {
    for (let q = n.parent; q && q !== top; q = q.parent)
      if (q.type === "INSTANCE") return true;
    return false;
  }
  function countAll(actions) {
    let n = 0;
    for (const a of actions)
      n += 1 + (a.type === "CONDITIONAL" ? a.conditionalBlocks.reduce((s, b) => s + countAll(b.actions), 0) : 0);
    return n;
  }
  function hex2(h) {
    const v = parseInt(h.slice(1), 16);
    return {
      r: (v >> 16 & 255) / 255,
      g: (v >> 8 & 255) / 255,
      b: (v & 255) / 255
    };
  }
  async function loadFonts2(api) {
    for (const style of ["Regular", "Medium", "Bold"])
      await api.loadFontAsync({ family: "Inter", style });
  }

  // livetab/plugin/src/main.ts
  figma.showUI(__html__, { width: 360, height: 440, title: "Figma OS \xB7 Leila's CPU" });
  var post = (m) => figma.ui.postMessage(m);
  var breathe = () => new Promise((r) => setTimeout(r, 0));
  post({ type: "programs", names: Object.keys(PROGRAMS), selected: DEFAULT_PROGRAM });
  figma.ui.onmessage = async (msg) => {
    post({ type: "busy", on: true });
    try {
      if (msg.type === "add") {
        const t0 = Date.now();
        const r = await addLiveTab(figma, { program: msg.program, breathe, log: (text2) => post({ type: "log", level: "info", text: text2 }) });
        if (r.problems.length)
          post({ type: "log", level: "error", text: `${r.problems.length} things Figma refused, e.g. ${r.problems.slice(0, 4).join("; ")}` });
        post({
          type: "log",
          level: "ok",
          text: `Added in ${((Date.now() - t0) / 1e3).toFixed(0)} s: ${r.variables} variables, ${r.chunks} events per tick. \u25B6 Present, open the CPU tab, then Step or Run.`
        });
        const where = await findLive(figma);
        if (where) figma.viewport.scrollAndZoomIntoView([where.frame]);
      } else {
        const n = await removeLiveTab(figma);
        post({ type: "log", level: "ok", text: `Removed: ${n} nodes and the "Leila CPU" variables.` });
      }
    } catch (e) {
      post({ type: "log", level: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      post({ type: "busy", on: false });
    }
  };
})();
