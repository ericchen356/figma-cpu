# Pointers: LDR and STR

The v1 CPU could only reach memory at an address written into the program (`LD Rd,[a]`, `ST Rs,[a]`).
Two opcodes now take the address from a register instead, so a program can walk an array, copy a block, or
write to an address it computed. They replace the two opcodes least needed by the demo programs:

| code | was | now | operation | flags |
|---|---|---|---|---|
| `0xA` | `NOT Rd` | `LDR Rd, [Rs]` | Rd ← mem[Rs] | unchanged |
| `0xE` | `JN a` | `STR Rs, [Rd]` | mem[Rd] ← Rs | unchanged |

NOT is still one instruction away: `XOR Rd, Rk` with Rk = 0xFF. JN's tests can use `JC` after a `SUB` (a borrow sets C),
as `sub.asm` now does. The ALU keeps its NOT function (SEL 4); only the opcode is gone.

## Encoding and microcode

One byte, no operand byte: `[7:4] opcode · [3:2] Rd · [1:0] Rs`. The `[R]` brackets are assembler syntax for the
same register fields (`asm.ts` requires them and prints them when disassembling).

```
FETCH  T0: PC_OUT MAR_LOAD | T1: MEM_READ PC_INC | T2: MDR_OUT IR_LOAD
LDR    T3: REG_OUT_S MAR_LOAD | T4: MEM_READ | T5: MDR_OUT REG_LOAD_D T_RESET          (6 T-states)
STR    T3: REG_OUT_D MAR_LOAD | T4: REG_OUT_S MDR_LOAD | T5: MEM_WRITE T_RESET         (6 T-states)
```

No new datapath: the register file already drives the bus from either field (`REG_OUT_D` / `REG_OUT_S`), and the
bus already feeds MAR and MDR. The control PLA is generated from `OPCODES` in `src/isa/spec.ts`, so the change is
only in the spec; the hardware follows. Cost: **+11 gates** in `cell/CONTROL` (2,285 → 2,296 gates, 2,298 wires,
3,855 prototype actions per tick, still 11 events per tick at ≤ 400 actions).

## Programs

- `ptrout.asm`: R1 = 15 (the OUT address) is used as a pointer: `STR R0, [R1]` shows 7, 6, … 0, then HLT.
- `copy.asm`: copies a byte through two pointers and reads it back: OUT shows 5A, then HLT.
- `dump.asm`: walks memory with a pointer, showing every byte of RAM (its own code first), forever.
- `logic.asm` and `sub.asm` were rewritten without NOT / JN (same outputs except logic's NOT step).

Tests: `test/isa.test.ts` (encoding, model, programs) and `test/cpu.test.ts` (the gate-level CPU matches the ISA
model on every program, and the "pointers" hand program covers LDR/STR on the gates). Verified on the canvas in
testing2 with the plugin's Verify: ptrout ✓ (169 ticks), copy ✓ (45 ticks).
