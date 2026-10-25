# CPU v2: what it must contain and what it costs

> **Correction (2026-10-24):** the ~0.9 hops/s came from a 1-second hop. Figma reads `AFTER_TIMEOUT.timeout` in
> seconds (its docs say milliseconds), and the spike and the Run loops wrote 1. With 0.001 (now the default, see
> `afterTimeout` in `src/prototype/figma-actions.ts`) a hop costs ~10–20 ms plus ~0.2 ms per executed action, so a
> ~400-action chunk runs at roughly 10 hops/s **(estimate from measured costs)**, and the specialized deploy of this CPU
> (`osflow/deploy/cpu.ts`) runs ~92 ticks/s on count **(measured)**.

Written 2026-10-24 for the CPU designer and for Nathan (the OS-like app). Every number in a table below is **measured**
by `tools/cost-model.ts` unless it is marked **(assumption)** or **(estimate)**. Reproduce any row with
`node tools/cost-model.mjs …` (commands are given under each table).

> **Built (2026-10-24):** the CPU now has 64 bytes of RAM, as recommended below, with LDR / STR and a stepping LDRI
> (POINTERS.md), but still the v1 encoding, no IN port in hardware (IN is RAM[62], written by the plugin), no CALL / RET
> and 4 registers. As built: 4,803 gates, 153,174 layers with gate labels (so build it without them), 24 events per tick.

## How the numbers are measured

- **Gates / variables / actions / events are not extrapolated.** For every configuration the model *builds* the CPU as a
  real netlist out of the existing cells (`src/cells`), the existing datapath blocks (`ALU`, `REGFILE`, `RAM_ROW`, `TSTATE`,
  `HALT_FF` from `src/cpu/datapath.ts`) and a control PLA generated exactly like `src/cpu/control.ts` (same algorithm,
  generalized over the opcode table). The parts that depend on the address width are new parametrized builders in
  `tools/cost-model.ts`: `RAM<2^N>`, `PC<N>`, `MAR` (`REG_W<N>`), `DEC<N>`, `BUSMUX`, plus the v2 parts (`SP`, `REGFILE8`,
  the condition mux, the IN mux, the IO decoder). The netlist is then flattened, compiled with the real `compile()`
  (`inputs: []`, or `["IN"]` with an input port) and planned with the real `plan()` (cap 400 actions per event, ungated,
  which is what the plugin uses: `plugin/src/app.ts` never sets `gate`).
- **Calibration (test/cost-model.test.ts):** the base configuration produces a netlist *identical* to `cpuNetlist()`. Since
  2026-10-24 that is the 64-byte CPU as built (see below and POINTERS.md: 4,803 gates, 4,805 variables, 8,750 actions and
  24 events per tick); the cost model now uses the CPU's own N-bit RAM / PC / decoder builders. The tables below were
  measured before that, on the 16-byte CPU: same 2,285 gates in the same order, same 2,289 nets. RAM(4) = 808, PC(4) = 67, MAR(4) = 40,
  DEC(4) = 30, CONTROL = 123, all equal to the real CPU. The plan matches too: 2,287 variables, 3,860 actions, 11 events
  per tick, 6 reset events (the numbers in WHATS-LEFT.md).
- **Layers** are counted from the plugin's own layout code (`src/figma/layout.ts`) node for node the way `src/figma/draw.ts`
  creates them: per module a title and subtitle, 4 nodes per port marker, 2 vectors per routed wire (+ the wires frame),
  and one INSTANCE per child **carrying a full copy of the child's layers** (that is how Figma instances work). The count
  is checked against a full draw on the fake Figma API (`test/fake-figma.ts`, which clones instance layers like Figma):
  the real CPU draws **72,333** layers (the "~72k" in WHATS-LEFT.md), and a 32-byte v2 CPU with 8 registers draws exactly
  what the model counts. Not counted: the front panel, the Control / Run / Step frames and the MEM lamp screen that
  Compile adds **(assumption: a few hundred layers today; the MEM screen grows with RAM if it keeps one lamp per bit)**.
- Gate labels ("labels" checkbox in the Build panel, 3 text layers per 2-input gate) are a big share of the layers, so
  every layer number is given with labels on and off.

## (a) Cost by RAM size

The proposed v2 CPU (all v2 features, 4 registers; see section b). `node tools/cost-model.mjs --sweep 4..9 --v2 --gated`
and `… --no-labels`.

| RAM bytes | free bytes | gates | RAM gates | variables (collections of 4,000) | layers, labels on | layers, labels off | actions / tick | events / tick (cap 400) | s / tick at 0.9 hops/s **(assumption)** | reset events |
|---|---|---|---|---|---|---|---|---|---|---|
| 16 | 14 | 2,441 | 808 | 2,451 (1) | 77,147 | 63,581 | 4,074 | 11 | 12.2 | 7 |
| 32 | 30 | 3,307 | 1,625 | 3,317 (1) | 106,188 | 87,329 | 5,751 | 16 | 17.8 | 9 |
| 64 | 62 | 4,961 | 3,230 | 4,971 (2) | 158,858 | 130,474 | 9,000 | 25 | 27.8 | 14 |
| 128 | 126 | 8,219 | 6,439 | 8,229 (3) | 262,272 | 215,143 | 15,421 | 45 | 50.0 | 23 |
| 256 | 254 | 14,681 | 12,852 | 14,691 (4) | 464,364 | 380,496 | 28,182 | 96 | 106.7 | 43 |
| 512 | 510 | 27,773 | 25,909 | 27,783 (7) | 880,144 | 720,019 | 53,836 | **over cap** | n/a | 95 |

The same sweep with the current v1 ISA (no features; `--sweep 4..9`), for reference:

| RAM bytes | gates | variables | layers, labels on | layers, labels off | actions / tick | events / tick |
|---|---|---|---|---|---|---|
| 16 | 2,285 | 2,287 | 72,333 | 59,633 | 3,860 | 11 |
| 32 | 3,131 | 3,133 | 100,596 | 82,728 | 5,508 | 15 |
| 64 | 4,765 | 4,767 | 152,488 | 125,220 | 8,728 | 24 |
| 128 | 8,003 | 8,005 | 255,124 | 209,236 | 15,120 | 44 |
| 256 | 14,445 | 14,447 | 457,248 | 374,626 | 27,852 | 94 |
| 512 | 27,543 | 27,545 | 873,266 | 714,350 | 53,512 | over cap |

(512 bytes needs 9 address bits, more than the 8-bit bus carries, so that row is built with the v2 page-bit path; see b.)

What the table says:

- **RAM is the CPU.** RAM(N) = 49·2^N + DEC(N) − 6 gates: 808 / 1,625 / 3,230 / 6,439 / 12,852 / 25,909 / 51,514 for
  N = 4..10. Each byte is ~50 gates, ~51 variables, ~100 actions per tick and **~1,600 layers** (labels on). The layers per
  byte are paid twice: once in the `RAM<n>` main component on the Cells region and once in its instance inside `cell/CPU`
  (at 64 bytes: `cell/RAM64` = 50,628 layers, `cell/CPU` = 79,127, of which ~50k is the RAM copy).
- **Everything else is ~1,500 (v1) to ~1,700 (v2) gates and stays nearly flat.** PC grows 16 gates per address bit, MAR
  10, the bus 2; the address decoder is inside RAM.
- **Events per tick** grow linearly (~0.3–0.4 events per byte). Above ~38,000 actions per tick the current chunk dispatcher
  cannot fit a tick under 400 actions per event at all: with k chunks each event spends k + 5 actions on dispatch and 4 on
  the tick counter, so a tick holds at most max_k k·(391 − k) = 38,220 actions (a little less after splitting). 512 bytes needs 53,836: **over cap**
  (it would need a different dispatcher, e.g. a two-level one).
- **Clock gating does not help this CPU.** Gated plans are larger at every size (64 bytes: 9,306 vs 9,000 actions, 27 vs 25
  events), because every RAM latch is written in the LOW pass whenever its row enable can change. Keep `gate` off.

## (b) What an OS-like program needs, and what each feature costs

Costs measured at 64 bytes against the v1 CPU of the same size (4,765 gates, 152,488 layers, 8,728 actions, 24 events).
`node tools/cost-model.mjs --addr 6 [--in] [--indirect] [--call] [--regs 8] [--v2] --json`.

| Feature | Why an OS needs it | Hardware | Δ gates | Δ layers (labels on) | Δ actions / tick | Δ events | Bytes lost |
|---|---|---|---|---|---|---|---|
| Input port (memory-mapped IN) | anything interactive: keys, a mouse click, a mode switch | 8 top-level inputs `IN[8]`, an address comparator, a MUX2_W8 in front of MDR | +28 | +384 | +52 | 0 | 1 (address 62) |
| Indirect load / store `LDR Rd,[Rs]`, `STR Rd,[Rs]` | arrays, buffers, a shape table, a pointer walking memory; without it every address is a constant in the code | 2 opcodes; MAR already loads from the bus, so only the PLA grows (and the v2 J<cc> mux, 13 gates) | +21 | +528 | +21 | 0 | 0 |
| CALL / RET | subroutines shared by several commands; without them code is duplicated in 62 bytes | stack pointer SP (6-bit up/down counter, reset to the byte below the IO bytes: 61 in the proposed v2), SP on the bus, 3 control signals; return addresses on a RAM stack (1 byte per level) | +157 | +5,766 | +209 | +1 | 1 per call level |
| All of the above (the proposed v2) | | | **+196** | **+6,370** | **+272** | **+1** | 2 + stack |
| 8 registers (two banks of 4) | more live values without memory traffic; a cheap context switch (kernel / user bank) | 4 more REG_W8, DEC3 write decoder, 8:1 read mux, a BANK flip-flop written by a store to address 61 | +430 | +14,450 | +727 | +2 | 1 (address 61) |
| Wider PC / MAR (each address bit) | room for code and data: this is the RAM table in (a) | PC +16 gates, MAR +10, bus +2 per bit up to 8 bits; above 8 bits a page-bit side path (an AND + a MUX2 per extra bit, + 1 NOT) | +28 per bit + RAM | see (a) | see (a) | see (a) | |

Per-block gates of the proposed v2 at 64 bytes: ram 3,230 · regs 390 · alu 178 · ctrl 156 · sp 110 · pc 99 · mar 60 ·
busmux 64 · the 8-bit latches (ir, mdr, A, Y, OUT) 80 each · seg_lo / seg_hi 54 each · tstate 42 · mdr_src, in_src 25 each ·
ccmux 13 · halt 12 · flags 30 · glue 19.

**Why 8 registers is a bank and not a wider field:** the instruction byte is `[7:4] opcode · [3:2] Rd · [1:0] Rs`; 8
registers need 3-bit Rd and Rs, which only fit in a 16-bit instruction (a third fetch cycle on every instruction, i.e. +2
ticks on all of them). The bank bit keeps the encoding and costs no opcode. **Recommendation: leave it out**; 14,450
layers buy far more as 9 bytes of RAM.

### The proposed v2 instruction set (still 4-bit opcodes)

Instruction byte unchanged: `[7:4] opcode · [3:2] Rd · [1:0] Rs`; LDI / LD / ST / J / CALL add an operand byte.
Memory-mapped IO at the top of memory, so no opcode is spent on IO: **OUT = top** (as now), **IN = top − 1**, **BANK =
top − 2** (only with 8 registers). At 64 bytes: OUT 63, IN 62, stack starts at 61 and grows down.

> v1 has since gained pointers: `0xA LDR Rd,[Rs]` (was NOT) and `0xE STR Rs,[Rd]` (was JN), see
> [POINTERS.md](POINTERS.md). The table below compares against the v1 from before that change.

What changes against `src/isa/spec.ts`, explicitly:

| v1 | v2 | Why |
|---|---|---|
| `0x0 NOP` | **dropped** | `MOV R0,R0` is the same 4-tick no-op |
| `0xB JMP`, `0xC JZ`, `0xD JC`, `0xE JN` | **merged into `0xD J<cc> a`**, cc = IR[3:2]: 00 always (= JMP), 01 Z, 10 C, 11 N | the Rd field of a jump is unused; a 13-gate 4:1 mux on IR[3:2] makes one opcode do all four. Frees 3 codes |
| `0xF HLT` | **`0x0 HLT`** | running into zeroed memory now halts instead of sliding through NOPs |
| `0x3 ST Rs,[a]` (source in IR[1:0]) | **`0x3 ST Rd,[a]` (source in IR[3:2])** | frees IR[1:0] of every address-carrying instruction for page bits (> 256 bytes). Assembly syntax `ST R1,[15]` is unchanged, only the encoding |
| (none) | **`0x4 LDR`, `0x5 STR`, `0xE CALL`, `0xF RET`** | the freed codes |
| Z C N into the PLA | one `COND` line into the PLA | the PLA only needs "is the jump taken" |

Microcode, in the format of `src/isa/spec.ts` (fetch T0–T2 is unchanged; every instruction still fits the 3-bit T counter,
T0–T7; `node tools/cost-model.mjs --v2 --microcode` prints it from the table the hardware is built from):

```
FETCH    T0: PC_OUT MAR_LOAD | T1: MEM_READ PC_INC | T2: MDR_OUT IR_LOAD
0x0 HLT  T3: HALT T_RESET                                                        4 ticks
0x1 LDI  T3: PC_OUT MAR_LOAD | T4: MEM_READ PC_INC | T5: MDR_OUT REG_LOAD_D T_RESET                 6
0x2 LD   T3: PC_OUT MAR_LOAD | T4: MEM_READ PC_INC | T5: MDR_OUT MAR_LOAD | T6: MEM_READ
         | T7: MDR_OUT REG_LOAD_D T_RESET                                                           8
0x3 ST   T3: PC_OUT MAR_LOAD | T4: MEM_READ PC_INC | T5: MDR_OUT MAR_LOAD | T6: REG_OUT_D MDR_LOAD
         | T7: MEM_WRITE T_RESET                                                                    8
0x4 LDR  T3: REG_OUT_S MAR_LOAD | T4: MEM_READ | T5: MDR_OUT REG_LOAD_D T_RESET                     6
0x5 STR  T3: REG_OUT_S MAR_LOAD | T4: REG_OUT_D MDR_LOAD | T5: MEM_WRITE T_RESET                    6
0x6 MOV  T3: REG_OUT_S REG_LOAD_D T_RESET                                                           4
0x7 ADD  T3: REG_OUT_D A_LOAD | T4: REG_OUT_S Y_LOAD FLAGS_LOAD | T5: Y_OUT REG_LOAD_D T_RESET      6
0x8 SUB  (as ADD, ALU SUB)                                                                          6
0x9 AND  0xA OR  0xB XOR  (as ADD, ALU sel 1 / 2 / 3)                                               6
0xC NOT  T3: REG_OUT_D A_LOAD | T4: Y_LOAD FLAGS_LOAD | T5: Y_OUT REG_LOAD_D T_RESET                6
0xD J    T3: PC_OUT MAR_LOAD | T4: MEM_READ PC_INC | T5: T_RESET, if COND: MDR_OUT PC_LOAD          6
0xE CALL T3: SP_OUT MAR_LOAD | T4: PC_OUT MDR_LOAD SP_DEC | T5: MEM_WRITE PC_OUT MAR_LOAD
         | T6: MEM_READ | T7: MDR_OUT PC_LOAD T_RESET                                               8
0xF RET  T3: SP_INC | T4: SP_OUT MAR_LOAD | T5: MEM_READ | T6: MDR_OUT PC_LOAD | T7: PC_INC T_RESET  8
```

New control signals: `SP_OUT` (SP → bus), `SP_INC`, `SP_DEC`. Notes:

- **CALL** pushes the address of its own operand byte (PC at T4) and RET adds 1 after popping, so the stack holds one byte
  per call level and CALL needs no temporary register. T5 writes the stack and loads MAR from PC in the same T-state; this
  is safe because RAM is written in the LOW pass from MAR's slave output, which only changes at the rising edge (same rule
  as SILICON.md §2).
- **SP** is stored as `SP ⊕ reset value`, so the all-zero power-on state already is SP = 61 (64 bytes): no plugin change.
- **J<cc>** has no "not zero"; `JZ done; JMP loop` (4 bytes) replaces a JNZ.
- **IN** is a level, not an event **(assumption for the devices owner)**: a key button sets `IN` on press and clears it on
  release, and the program waits for 0 again before taking the next key.
- **Verified at gate level, not just priced:** `test/cost-model.test.ts` runs two v2 programs on the 64-byte v2 netlist
  with FastSim: CALL/RET + LDR/STR + IN (OUT = 5 + 5 + IN, the stack slot holds 3, SP back to 61) and a JZ/JMP countdown
  loop. Both halt with the right result.
- **Above 256 bytes (N = 9, 10)** addresses are `{IR[1:0], operand byte}` (page bits), indirect and stack accesses use
  page 0, and fetch loads MAR's high bits from PC through a side path. Priced in the tables; the microcode above is
  **only verified for N ≤ 8**, and **RET across pages does not work** with a 1-byte stack slot (it needs a 2-byte push,
  +2 ticks on CALL and RET; not built).

## (c) Verdict

Limits **(given, not measured)**: (i) under 150,000 layers, (ii) a chunked tick of at most 40 events.

| Constraint | Largest RAM that passes (v2, 4 registers) |
|---|---|
| (ii) ≤ 40 events per tick | **64 bytes** (25 events). 128 bytes needs 45. |
| (i) < 150k layers, gate labels on | **32 bytes** (106,188). 64 bytes is 158,858. |
| (i) < 150k layers, gate labels off | **64 bytes** (130,474). 128 bytes is 215,143. |

**Build CPU v2 = 64 bytes, IN port, LDR/STR, CALL/RET, 4 registers, gate labels off: 4,961 gates, 4,971 variables (2
collections), 130,474 layers, 9,000 actions and 25 events per tick, 14 reset events.** Headroom: ~19.5k layers for the
panel, the frames and a 64-byte MEM screen **(the MEM screen at 64 × 8 lamps is not measured; budget ~1–2k layers,
estimate)**. Adding 8 registers still squeezes under (142,574 layers, 27 events) but leaves ~7k layers of headroom for
little gain, so it is not recommended. With labels on, the same CPU only fits at 32 bytes (30 free).

**Speed, the real limit.** At the spike's 0.9 hops/s **(assumption, Eric's spike v1)** one 64-byte tick is ~28 s in
Present mode and an instruction is 4–8 ticks: **2–4 minutes per instruction**. Present mode can show the machine stepping;
it cannot run anything that feels like an OS. Interactive use needs the plugin clock (Decision B in WHATS-LEFT.md), whose
speed on a 5k-gate CPU is **not measured** (it runs ~115k simulated ticks/s at 2.3k gates; the Figma variable writes per
frame, not the simulation, are expected to limit it **(guess)**).

**What a demo OS can do in 62 bytes (estimate, hand-counted, not assembled):** a key-driven monitor fits in ~35 bytes of
code: poll IN (7 bytes: `LD R0,[62]; OR R0,R0; JZ poll; CALL handle`), wait for release (7), a dispatcher that compares the
key and CALLs one of three commands (~13), and commands such as "count up on OUT" and "clear" (~4 each); plus an 8-byte
buffer written through a pointer with STR and shown on the MEM screen, and 1–2 bytes of stack. That leaves ~15 bytes.
So it **can**: take keys, dispatch commands, call shared subroutines, keep a small buffer or table walked by a pointer,
show a value on OUT and the buffer on the MEM screen, and patch its own code (code lives in RAM; a store into a J's
operand byte is a computed jump).

It **cannot**: draw (no framebuffer; OUT is two hex digits and the MEM screen is 64 × 8 lamps), run two tasks (SP cannot be
loaded and there are no interrupts), use jump tables or function pointers (no indirect jump), load programs at run time
(code is preloaded by the plugin), hold text or more than a few dozen data bytes, do 16-bit arithmetic cheaply (no
add-with-carry), or run at an interactive speed in Present mode.

For a "Figma OS" with a screen and a mouse, the block-level machine (Decision A1/A3 in WHATS-LEFT.md: 64 KB, 128 × 96
screen) remains the realistic host; the gate-level v2 is the proof that the same kind of program runs on real gates.

## Assumptions and limits, in one place

1. Layers = the nodes `src/figma/draw.ts` creates (gates, cells, CPU), with Figma instances carrying a full copy of their
   main component's layers; equal to a fake-Figma draw by test. That real Figma creates the same nodes per
   `createNodeFromSvg` as the fake is an **assumption**, supported by the real file being ~72k layers.
2. Not counted: front panel, Control / Run / Step frames, MEM screen.
3. 150k layers and 40 events are the limits given in the brief, not measured Figma limits.
4. 0.9 hops/s is Eric's spike v1; one event = one hop.
5. Cap 400 actions per event (`DEFAULT_MAX_ACTIONS_PER_EVENT`); reset events assume a 6-action reset tail.
6. 4,000 variables per collection (WHATS-LEFT.md risk list); the v2 64-byte CPU needs 2 collections.
7. The demo OS size is hand-counted, not assembled or run.
8. N > 8 microcode (page bits) is priced, not verified; RET across pages is not supported as built.
9. The IN key protocol (press sets, release clears) is for the devices owner to confirm.
10. The plan is ungated, as the plugin compiles today; gating measured larger at every size.
