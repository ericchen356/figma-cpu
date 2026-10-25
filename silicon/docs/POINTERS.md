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

## LDRI: a pointer that steps (and 64 bytes of RAM)

Added 2026-10-24, with RAM grown from 16 to 64 bytes (6-bit PC and MAR, `RAM_ADDR_BITS = 6` in `src/isa/spec.ts`;
`docs/CPU-V2.md` recommends that size). The memory-mapped bytes moved to the top: **OUT = 63**, **IN = 62** (both
predefined assembler symbols); programs use `[OUT]` and `[IN]`, not numbers.

| code | was | now | operation | flags |
|---|---|---|---|---|
| `0x0` | `NOP` | `LDRI Rd, [Rs+]` | Rd ← mem[Rs], Rs ← Rs + 1 (with Rd = Rs, Rd gets the byte) | unchanged |

`NOP` still assembles, as `MOV R0, R0` (0x40): the same 4-tick no-op, and no program used the opcode. A zero byte
is now `LDRI R0, [R0+]`.

```
LDRI   T3: REG_OUT_S MAR_LOAD A_LOAD | T4: MEM_READ ONE_OUT Y_LOAD | T5: Y_OUT REG_LOAD_S
       | T6: MDR_OUT REG_LOAD_D T_RESET                                                (7 T-states)
```

The +1 comes from the ALU's adder with a new bus driver, `ONE_OUT` (the constant 1 on bus bit 0), while MEM_READ
fills MDR; `REG_LOAD_S` writes the stepped pointer back through a new write-select mux (Rd or Rs). Hardware:
2 signals, 2 MUX2 and an OR at the register file, 1 OR in the bus, and the PLA grows from 134 to 145 gates.

The whole machine: **4,803 gates** (RAM 3,230 of them), 4,805 wire variables, 8,750 prototype actions per tick, 24
events per tick at ≤ 400 actions (the Live view), 153,174 layers when drawn with gate labels (build it without them;
`CPU-V2.md`'s limit is 150k). It includes 6 display-only inverters, `pc_n`, for the Live view's PC marker.

### perceptron.asm: inference on the gates

A trained perceptron decides, from the 7 lit segments of each digit 0–9, whether the digit is even. Each digit's
segments are a byte (bit 7 = segment a … bit 1 = g, bit 0 a marker); `ADD R3, R3` shifts the next segment into C,
`LDRI R2, [R1+]` reads its weight, and a lit segment adds it to the score; the byte is 0 exactly when the marker has
left, so the loop runs 7 times. Score ≥ 0 is class 1. OUT shows d·16 + class for every digit:
`01 10 21 30 41 50 61 70 81 90` (the even digits are class 1). 59 of the 64 bytes, 580 instructions, 3,678 ticks.
The weights (−3, 1, −3, −3, 7, 3, 1, bias −1) came from the perceptron rule on the ten digits.

Tests: the ISA model and the gate-level CPU run it tick for tick (`test/cpu.test.ts` › program: perceptron.asm), a
hand-assembled LDRI program checks the pointer step and Rd = Rs on the gates, and osflow's fast deploy runs it to
HALT with one Run click (`osflow/test/cpu-deploy.test.ts`).
