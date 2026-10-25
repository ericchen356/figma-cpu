# OS ↔ CPU contract (DRAFT v0, 2026-10-24)

> **Correction (2026-10-24):** the ~0.9 hops/s came from a 1-second hop. Figma reads `AFTER_TIMEOUT.timeout` in
> seconds (its docs say milliseconds), and the spike and the Run loops wrote 1. With 0.001 (now the default, see
> `afterTimeout` in `src/prototype/figma-actions.ts`) a hop costs ~10–20 ms plus ~0.2 ms per executed action, so a
> ~400-action chunk runs at roughly 10 hops/s **(estimate from measured costs)**, and the specialized deploy of this CPU
> (`osflow/deploy/cpu.ts`) runs ~92 ticks/s on count **(measured)**.

Status: draft for Nathan (Figma OS). Facts marked **(measured)** come from the repo; **(planned)** items are being built
right now by other agents on `ours/silicon`; **(open)** items need a decision. Nathan's OS is not in the repo yet, so
this contract is what the OS is built *against*, not a description of it.

## 1. Layers and owners

```
OS program (Nathan)         assembly source + manifest + bindings
   ↓ assemble (src/isa/asm.ts)
RAM image (16 bytes now)
   ↓ plugin "Load program" writes the RAM latch nets
Gate-level CPU (Eric)       fetch / decode / execute over 2,285 gates, one Figma boolean variable per wire
   ↓ plugin clock (FastSim, ~115k ticks/s simulated) writes only CHANGED variables
Figma variables → canvas    lamps, 7-segment OUT, MEM matrix; planned: OS window layers via bindings
   ↑ clicks / keys → plugin → input byte (planned RAM[14])
```

| Layer | Owner | Source of truth |
|---|---|---|
| ISA, gates | CPU design (Eric / Leila) | `src/isa/spec.ts` |
| Assembler, plugin clock, loader, bindings | toolchain (us) | `src/isa/asm.ts`, `plugin/src/*` |
| OS code, UI layers | Nathan | his asm + manifest + bindings |

## 2. Memory map of the CURRENT machine (64 bytes, 6-bit address; it was 16 bytes until 2026-10-24)

| Addr | Role | Who writes |
|---|---|---|
| 0–61 | code and data, shared (von Neumann) | OS program, CPU `ST` |
| 62 | **INPUT** byte (`IN`) | the plugin, between ticks; the CPU only reads it. A `ST` to 62 is overwritten |
| 63 | **OUT**: an `ST` here also latches the two 7-segment digits | CPU `ST`. Code must never reach address 63 |

Entry point is address 0 (PC resets to 0). Programs must end below 62. `IN` and `OUT` are predefined assembler symbols.

## 3. Same map, written to grow (open: depends on CPU v2, see `CPU-V2.md`)

| RAM | Code | Data | Framebuffer rows | INPUT | OUT |
|---|---|---|---|---|---|
| 16 B | 0–9 | 10–13 | none (MEM matrix shows all 16 B) | 14 | 15 |
| 64 B | 0–31 | 32–55 | 56–61 | 62 | 63 |
| 256 B | 0–127 | 128–223 | 224–253 | 254 | 255 |

The rule that stays fixed: INPUT and OUT are the last two bytes, code grows from 0, data and framebuffer sit between.

## 4. Canvas connection (planned)

* **RAM → canvas:** a binding table maps a RAM bit or bit-range to a layer property (`visible`, `x`, `y`, `text`, `fill`,
  `opacity`) with an optional scale/offset or lookup table. The plugin diffs successive RAM snapshots and writes only
  changed properties. This is the "GPU": the gates never draw, the plugin turns bytes into layer changes.
* **Canvas → CPU:** a click on a named layer or a key becomes a number written to the INPUT byte by a keymap. One input
  at a time; the OS clears or acknowledges by writing a value back (design choice for Nathan: "0 means consumed" is
  the simplest scheme the CPU can poll).

## 5. Timing the OS author must know

* A CPU tick costs 3 to 8 T-states per instruction (fetch T0–T2 plus up to five more), so one instruction is 3 to 8 ticks **(measured, spec.ts)**.
* Plugin clock: about 115,000 ticks/s simulated, but each tick writes about 110–120 variables into Figma; real speed
  inside Figma is **unmeasured**.
* Present mode: about 0.9 hops/s, 11 hops per tick, so roughly 12 s per tick. An OS cannot run there. **The OS targets the plugin clock.**

## 6. ISA limits the OS must design around (measured)

16 opcodes, 4 registers (R0–R3), flags Z C N, 8-bit data. No indirect addressing, no CALL/RET, no stack.
Workarounds: state machine kept in a data byte; dispatch by compare-and-branch chains; subroutines by inlining or by a
return-selector byte; self-modifying code is possible (code is in RAM) but untested here.
Hard consequence: a real windowing OS does not fit 14 bytes. Options: (a) OS as a tiny state machine driving a few
bound layers (demo-grade), (b) CPU v2 with indirect load/store and CALL/RET (`CPU-V2.md`), (c) OS on the block-level machine.

## 7. Quick start for Nathan

1. Write `os.asm` (labels and `.db` supported; look at `src/isa/programs/*.asm`).
2. Write a manifest: entry label, which RAM bytes are state, which are input/output.
3. Write bindings: for each visible thing, which RAM bit/byte drives which layer property.
4. Hand all three over; the toolchain assembles, validates against sections 2–3, and runs it on the gate-level CPU.

## 8. Built (2026-10-24)

`src/os/image.ts` (`loadImage`: manifest + source → RAM image, validated against §2), `src/os/bindings.ts`
(`applyBindings` RAM-diff → canvas writes, `inputFromEvent` keymap → input byte), the `os/hello-os.*` example, and
`test/os-contract.test.ts`, which runs hello-os on the gate-level CPU (FastSim) tick-for-tick against IsaModel. Not yet
wired into the plugin UI. hello-os keeps its window-open flag in RAM[15] (OUT): with 14 bytes, LD + consume + JMP plus three
separate stores do not fit.
