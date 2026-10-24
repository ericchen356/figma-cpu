# PRD: FigmaCPU — an 8-bit CPU built inside Figma

**Event:** Cal Hacks 13.0 (Oct 23–25, 2026) · **Team:** 2–4 · **Submit by:** Oct 25, 9 AM PST
**Target tracks (MVP):** [Figma] Most Creative · Best Use Case of Figma · Best Design · Best Use Case of Figma Agent · Most Creative Use Case of Figma Agent · Cal Hacks Most Technically Advanced
**Post-MVP sponsor layers (§16):** Factory (Droid SDK) · Convex · Cartesia
**Figma file:** https://www.figma.com/design/l2JmsK7AEQkfo3Cvx67NgN/Figma-CPU (file key `l2JmsK7AEQkfo3Cvx67NgN`, page **Machine v2**)

> **v2.1 merge note.** This PRD merges the original PRD with the "Architecture Handoff" doc. We keep the PRD's machine: 64KB, A–L registers, 29-opcode micro-op ISA, a 128×96 screen, and the already-drawn Machine v2 page. From the handoff we take the register-transfer level: MAR/MDR, the ALU A/Y latches, a T-state counter, OUT/LOAD control signals, and the "one writer per bus" rule. These drive Watch mode. The handoff's 256-byte / R0–R3 / 16-opcode machine is **not** used. 256 bytes cannot hold a framebuffer, and the screen demo is the payoff.

---

## 1. One-liner

An 8-bit computer drawn on the Figma canvas — registers, latches, ALU, buses, decoder, RAM, a 128×96 screen — that actually runs programs. You can watch every T-state move bytes across the buses.

> **Scope for this hackathon: the CPU only.** The "mini Figma running on the CPU" is Phase 2 (§17).

## 2. Goals / non-goals

**Goals**

- The CPU's structure _and_ behavior live in the Figma file. The opcode table is a frame on the canvas, and editing it changes how the CPU behaves.
- The plugin is only "physics": it reads the drawn machine, advances the clock, and writes the new state back. It contains no hidden emulator with its own hard-coded instruction set.
- A legible, live demo: step one T-state at a time and watch PC → MAR → memory → MDR → IR → latches → ALU → registers. Then flip to Turbo and run graphics on the screen.
- A Stage Log (`STAGELOG.md`) that someone else could follow to rebuild the project stage by stage.

**Non-goals (this hackathon)**

- Any Figma-clone guest app (Phase 2).
- Gate-level simulation.
- An OS, a file system, or a C compiler.
- Making the control-signal table _executable_ (it drives animation only; see §6.4).

## 3. Key decisions (locked)

| Area             | Decision                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute model    | Block-level CPU drawn as Figma frames. Behavior comes from the **micro-op table** on the canvas. The plugin parses it and steps the machine.              |
| ISA              | 8-bit data, 16-bit address, 29 opcodes (`spec/opcodes.json`), register byte `rd<<4 \| rs`                                                                 |
| Two levels       | **Instruction level** (micro-ops) is the source of truth for behavior. **T-state level** (control signals) is a fixed expansion of each micro-op, used for Watch-mode animation. |
| Buses            | 16-bit address bus + 8-bit data bus. Rule: **at most one OUT per bus per T-state**, checked by tests.                                                     |
| Display          | **128×96, 16 colors (PICO-8), 1 byte/pixel**, rendered as **one image-fill rect** (§8)                                                                   |
| Input            | Plugin UI → memory-mapped IO (mouse x/y/button, key, tick, rand)                                                                                          |
| Toolchain        | Two-pass assembler in the plugin UI. Assembled bytes go into RAM.                                                                                         |
| Speed            | **Watch mode:** one T-state per tick (2–10 Hz), every signal animated. **Step-instr:** one instruction per click. **Turbo:** micro-op level, syncs once per frame. |
| Running it       | A local development plugin (`plugin/manifest.json`) in Figma desktop. One person runs it; everyone else watches the file live.                        |
| Stage Log        | `STAGELOG.md`, one git tag per stage (push tags with `git push --tags`)                                                                                   |

## 4. System architecture

```
┌──────────── Figma file · page "Machine v2" ─────────────────┐
│ CPU blocks · latches · T-state lamps · signal lamps          │
│ OPCODE/MICRO-OP TABLE (data) · RAM window · IO · SCREEN      │
└──────────────────────────────────────────────────────────────┘
   ▲ read structure + opcode table   │ write state / highlights / screen image
   │                                 ▼
┌──────── plugin/src (main thread) — "physics" ─────────────────┐
│ binder: node-name → handle      decoder: parse table → micro-ops│
│ core:   micro-op interpreter    expand: micro-op → T-states     │
│ renderer: diff → batched node writes                            │
└────────────────────────────────────────────────────────────────┘
   ▲ postMessage (asm, run/step, mode, mouse/keys)  │ state + VRAM
   │                                                 ▼
┌──────── plugin/ui — control panel ─────────────────────────────┐
│ assembler editor · Step-T / Step-Instr / Run / Pause · Hz       │
│ register readout · VRAM → PNG encoder (for the screen)          │
└────────────────────────────────────────────────────────────────┘
```

**Code layout** (`plugin/` scaffold already exists; `build.mjs` expects `src/main.ts`, `ui/ui.ts`, `ui/ui.html`):

```
plugin/src/core/     cpu.ts (state + micro-op interpreter), expand.ts (micro-op → T-states),
                     asm.ts (assembler), decode.ts (table rows → micro-op lists)
                     ← pure TypeScript, no Figma API, unit-tested with vitest
plugin/src/main.ts   binder + renderer + message loop (Figma API)
plugin/ui/           ui.html + ui.ts (control panel, PNG encoder)
plugin/programs/     *.asm demo programs
```

The core has no Figma imports. That lets the team test the CPU in Node before touching Figma. Later, Convex or Droid can reuse the same core (§16).

### 4.1 Where state lives

- **Canonical state lives in the Figma document.** Registers, latches and the visible RAM cells are text layers. The full 64KB lives in `pluginData` on the `mem/ram` frame. The screen is an image fill.
- In **Turbo mode** the plugin keeps a working copy in memory and flushes it to the canvas once per frame (~10–30 Hz). Say this plainly in the writeup.

### 4.2 Node naming contract (the binder, MCP codegen, and agent all depend on it)

Already drawn (Stage 2):

```
cpu/reg/A … cpu/reg/L, cpu/reg/HL, cpu/reg/PC, cpu/reg/SP, cpu/reg/IR
cpu/flag/Z, cpu/flag/C, cpu/flag/N
cpu/alu, cpu/alu/op, cpu/alu/in1, cpu/alu/in2, cpu/alu/out
cpu/bus/addr, cpu/bus/data, cpu/bus/tap/<n>     (stroke highlights)
cpu/phase/FETCH|DECODE|EXEC, cpu/clock, cpu/cycles
cpu/decoder/table                                (frame of rows: row/<hex>)
mem/ram, mem/ram/base, mem/pin, mem/pin/base, mem/ram/cell/<hex>
mem/io/<name>, dev/screen, dev/palette/<i>
```

Added in Stage 2b (from the handoff):

```
cpu/reg/MAR (16-bit), cpu/reg/MDR (8-bit)
cpu/latch/T (imm8), cpu/latch/W (imm16), cpu/latch/OPR (register byte)
cpu/tstate, cpu/tstate/T<n>                      (T-state counter + lamps)
cpu/sig/<SIGNAL>                                 (one lamp per control signal, §6.3)
```

`cpu/alu/in1` is the **A latch** and `cpu/alu/out` is the **Y latch**. Relabel them on the canvas; don't rename the nodes.

## 5. Canvas layout

The **Machine v2** page is already drawn by `tools/draw-machine/` (404 nodes): CONTROL, REGISTERS, ALU+FLAGS, address and data buses, DECODER/OPCODE TABLE, RAM window + pinned window, SCREEN + palette, IO, and a dashed Phase 2 slot.

Stage 2b adds a **CONTROL SIGNALS** strip (signal lamps + the T-state counter) and the MAR/MDR/T/W/OPR latches. Generate them with the same draw script so the canvas stays reproducible.

## 6. ISA and execution model

### 6.1 Registers and encoding

- **Registers:** A, B, C, D, H, L (8-bit). H:L is the 16-bit pointer. PC and SP are 16-bit. Flags: Z, C, N.
- **Internal latches** (not visible to programs): MAR, MDR, IR, OPR, T, W, A-latch, Y-latch.
- **Encoding:** 1-byte opcode, then 0–3 operand bytes (see `spec/opcodes.json` → `formats`).

### 6.2 Instructions (`spec/opcodes.json`, 29 opcodes)

| Group | Instructions                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------- |
| Move  | `LDI r,imm8` · `MOV rd,rs` · `LD r,[HL]` · `ST r,[HL]` · `LDA r,[a16]` · `STA r,[a16]` · `LHL imm16` |
| ALU   | `ADD` `SUB` `AND` `OR` `XOR` `CMP` (rd,rs) · `INC r` · `DEC r` · `SHL r` · `SHR r` · `INHL`          |
| Flow  | `JMP a16` · `JZ` · `JNZ` · `JC` · `JNC` · `CALL a16` · `RET`                                         |
| Stack | `PUSH r` · `POP r`                                                                                   |
| Misc  | `NOP` · `HLT`                                                                                        |

**Opcode table on canvas:** each row has `op | mnem | fmt | micro-ops`. The micro-op vocabulary is fixed (STAGELOG Stage 1): `REG`, `IMM8`, `IMM16`, `SET`, `COPY`, `LOAD`, `STORE`, `SETHL`, `INCHL`, `ALU`, `JUMP`, `PUSH`, `POP`, `PUSHPC`, `POPPC`, `HALT`. The micro-ops are the only behavior defined in code.

**Demo moment:** edit a row on the canvas (e.g. change `ADD`'s micro-op to `ALU SUB rd rs`) and show the program's behavior change.

**Flag semantics:** Z = result is 0. N = bit 7 of the result. C = carry out of bit 7 (ADD, INC, SHL), borrow (SUB, CMP, DEC), or bit 0 shifted out (SHR). AND/OR/XOR clear C. `CMP` sets flags like `SUB` but doesn't write back. Lock these in Stage 3 tests.

### 6.3 Control signals (from the handoff, adapted to two buses)

| Signal                                                   | Effect                                              |
| -------------------------------------------------------- | --------------------------------------------------- |
| `PC_OUT` · `HL_OUT` · `W_OUT` · `SP_OUT`                  | Writes a 16-bit value to the **address bus**        |
| `MAR_LOAD`                                               | MAR reads the address bus                           |
| `MEM_READ` · `MEM_WRITE`                                 | MDR ← mem[MAR] · mem[MAR] ← MDR                     |
| `MDR_OUT` · `REG_OUT(r)` · `T_OUT` · `Y_OUT`              | Writes a byte to the **data bus**                   |
| `MDR_LOAD` · `IR_LOAD` · `OPR_LOAD` · `T_LOAD` · `W_LO_LOAD` · `W_HI_LOAD` · `REG_LOAD(r)` · `A_LOAD` | Reads the data bus |
| `ALU_OP` · `Y_LOAD` · `FLAGS_LOAD`                       | ALU computes A-latch ⊕ data bus → Y, sets flags      |
| `PC_INC` · `PC_LOAD` · `SP_INC` · `SP_DEC` · `HL_INC` · `HL_LOAD` | Counter / pointer updates                 |
| `T_RESET` · `HALT`                                       | End of instruction · stop the clock                 |

**Rule:** in each T-state, at most one `*_OUT` per bus. A vitest test expands every opcode and checks this.

### 6.4 Micro-op → T-state expansion

Each micro-op expands to a fixed list of T-states (`core/expand.ts`). Watch mode plays these one per tick and lights the matching `cpu/sig/*` lamps and bus highlights. The **end state of the expansion must equal the end state of the micro-op interpreter**. A test runs every demo program both ways and compares. This keeps the two levels honest without making the signal table a second source of behavior.

| Micro-op               | T-states                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| FETCH (implicit)       | `PC_OUT MAR_LOAD` → `MEM_READ PC_INC` → `MDR_OUT IR_LOAD`                                        |
| `REG`                  | `PC_OUT MAR_LOAD` → `MEM_READ PC_INC` → `MDR_OUT OPR_LOAD`                                       |
| `IMM8`                 | same as `REG`, ending in `T_LOAD`                                                                |
| `IMM16`                | `IMM8`-style ×2 → `W_LO_LOAD`, `W_HI_LOAD`                                                       |
| `SET rd T`             | `T_OUT REG_LOAD(rd)`                                                                             |
| `COPY rd rs`           | `REG_OUT(rs) REG_LOAD(rd)`                                                                       |
| `LOAD rd HL\|W`        | `HL_OUT\|W_OUT MAR_LOAD` → `MEM_READ` → `MDR_OUT REG_LOAD(rd)`                                   |
| `STORE rd HL\|W`       | `HL_OUT\|W_OUT MAR_LOAD` → `REG_OUT(rd) MDR_LOAD` → `MEM_WRITE`                                  |
| `ALU op rd rs`         | `REG_OUT(rd) A_LOAD` → `REG_OUT(rs) ALU_OP Y_LOAD FLAGS_LOAD` → `Y_OUT REG_LOAD(rd)` (CMP: no write-back; unary ops skip `REG_OUT(rs)`) |
| `JUMP W [cond]`        | if cond holds: `W_OUT PC_LOAD`; otherwise an empty T-state                                       |
| `SETHL W` · `INCHL`    | `W_OUT HL_LOAD` · `HL_INC`                                                                       |
| `PUSH r`               | `SP_DEC` → `SP_OUT MAR_LOAD` → `REG_OUT(r) MDR_LOAD` → `MEM_WRITE`                               |
| `POP r`                | `SP_OUT MAR_LOAD` → `MEM_READ` → `MDR_OUT REG_LOAD(r)` → `SP_INC`                                |
| `PUSHPC` · `POPPC`     | `PUSH`/`POP` of PC high byte then low byte                                                       |
| `HALT`                 | `HALT`                                                                                           |

The last T-state of every instruction also carries `T_RESET`. Unconditional jumps already skip the address bytes, because `IMM16` advanced PC.

## 7. Memory map (`spec/memory-map.json`)

| Range           | Use                                                        |
| --------------- | ---------------------------------------------------------- |
| `0x0000–0x3FFF` | Program + data (the assembler writes here)                 |
| `0x4000–0x7EFF` | General RAM. The stack starts at `0x7F00` and grows down (pre-decrement) |
| `0x8000–0xAFFF` | **VRAM** 128×96, 1 byte/pixel (low nibble = palette index) |
| `0xF000`        | `MOUSE_X` (0–127)                                          |
| `0xF001`        | `MOUSE_Y` (0–95)                                           |
| `0xF002`        | `MOUSE_BTN` (bit0 down)                                    |
| `0xF003`        | `KEY` (last key code; CPU writes 0 to ack)                 |
| `0xF004`        | `TICK` (increments each frame)                             |
| `0xF005`        | `RAND` (pseudo-random byte, seeded so runs are reproducible) |

## 8. Display

The screen is **one rectangle with an image fill**. Drawing each pixel as its own node tops out around 64×48.

1. The main thread sends VRAM (bytes) to the UI iframe.
2. The UI draws it onto a `<canvas>`, **upscaled with nearest-neighbor first** (6× → 768×576), so Figma's smoothing doesn't blur it.
3. `canvas.toBlob('image/png')` → bytes → back to main → `figma.createImage(bytes)` → fill on `dev/screen`.
4. In Turbo, refresh at most ~10–20 fps, and only when VRAM is dirty.

`addr = 0x8000 + (y<<7) + x`. 256×192 @ 4bpp is a post-MVP option.

## 9. Demo programs (`plugin/programs/`)

1. **count.asm**: count A from 0 to 10. Narrate it in Watch mode, T-state by T-state.
2. **fib.asm**: Fibonacci into RAM at `0x4000`. The pinned RAM window fills up.
3. **rect.asm**: fill a rectangle on the screen using `LHL` + `ST` + `INHL`. First pixels.
4. **bounce.asm**: a bouncing square using `TICK`, in Turbo. The "it's a real computer" moment. **← MVP cut line.**
5. **paint.asm** (stretch): paint pixels with the mouse via IO.

## 10. Visualization

**Watch mode (T-state level):**

- The T-state lamp advances (`cpu/tstate/T<n>`). The active signal lamps (`cpu/sig/*`) light.
- Whichever part is `*_OUT` drives the bus, and the bus highlights orange with its value. Every `*_LOAD` destination flashes green.
- During FETCH and DECODE, the matching opcode-table row highlights. During EXEC, the current micro-op is underlined in that row.
- The RAM window follows MAR. A pinned window shows any address you choose.

**Step-instr / Turbo:** skip the T-state animation. Update registers, flags, RAM and the screen per instruction or per frame.

Performance rules: cache node handles at bind time, only write nodes that changed, batch writes per frame, and avoid auto-layout on frequently updated nodes.

## 11. Figma workflow (for the Figma tracks)

| Tool                 | Used for                                                                                     | Evidence                |
| -------------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| **Figma Design**     | CPU components with variants (idle/active register, lamp, bus); layout                       | Screenshots + file link |
| **Figma agent / MCP**| Drawing the whole machine from `spec/*.json` (Stage 2), the signal strip (2b), table rows    | Prompts in STAGELOG     |
| **Figma Make**       | Prototyping the plugin control panel before coding it                                       | Make link + before/after|
| **Dev Mode / MCP**   | Claude Code reads node names through the Figma MCP and generates the binder and renderer   | MCP transcript snippets |

The story: **spec → the agent draws the machine → the canvas table _is_ the CPU's logic → a thin plugin makes it tick.**

## 12. Stage plan

Each stage ends with a commit, a `git tag stage-N`, a canvas screenshot, and a STAGELOG entry.

| #   | Stage                                                                                  | Exit criterion                                        | Status |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| 0   | PRD, layout slots, v1 prototype-variable CPU                                           | —                                                     | ✅     |
| 1   | `spec/` — opcodes + micro-ops, palette, memory map                                     | 29 opcodes                                            | ✅     |
| 2   | Draw Machine v2 via MCP                                                                | 404 contract-named nodes                              | ✅     |
| 2b  | Draw the CONTROL SIGNALS strip, T-state counter, MAR/MDR/T/W/OPR; relabel A/Y latches  | Binder finds every §4.2 name                          |        |
| 3   | `core/`: micro-op interpreter + decoder (from table rows) + vitest                     | Hand-assembled `count` runs headless                  |        |
| 4   | `core/asm.ts` two-pass assembler (labels, `.org`, `.db`) + `count`/`fib`               | `fib` correct in tests                                |        |
| 5   | `core/expand.ts` + bus-rule test + interpreter≡expansion test                          | All programs agree both ways; ≤1 OUT per bus          |        |
| 6   | Plugin `main.ts` binder + renderer + UI; Step-T / Step-Instr / Run / Turbo             | `count` steps on canvas in Figma desktop              |        |
| 7   | Screen: VRAM → PNG → image fill; `rect.asm`                                            | Crisp pixels                                          |        |
| 8   | IO (TICK, RAND, mouse, keys) + `bounce.asm`                                            | **MVP demo works** ← cut line                         |        |
| 9   | Live opcode-table edit demo; Make control panel                                        | —                                                     |        |
| 10  | Post-MVP sponsor layers (§16)                                                          | —                                                     |        |
| 11  | Demo video, STAGELOG polish, Devpost (image, repo, table #)                            | Submitted before Oct 25, 9 AM                         |        |

Stages 2b and 3–5 can run in parallel: canvas work and core work don't touch the same files.

## 13. Stage Log format (`STAGELOG.md`)

```markdown
## Stage N — <name> (tag: stage-N)

**Goal:** one sentence
**Inputs:** what must exist from previous stages
**Figma work:** what was built, which tool (Design / agent / Make / MCP)
**Prompts used:** verbatim agent/Claude prompts
**Code:** files touched
**Reproduce:** exact steps (git checkout stage-N, import plugin, open file X, click Y)
**Verify:** what you should see (screenshot)
**Gotchas:** what broke and the fix
```

## 14. Risks & mitigations

| Risk                                     | Mitigation                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Node updates too slow                    | Diff writes; the screen is a single image; Turbo frame-batching; T-state animation only in Watch |
| Image fill looks blurry                  | Upscale with nearest-neighbor in the UI canvas before PNG encoding                          |
| Many image updates bloat the file        | Cap refresh at ~10–20 fps; only refresh when VRAM is dirty                                  |
| Judges call it "just a JS emulator"      | Opcode table is parsed from the canvas; live-edit demo; the code has no ISA constants       |
| T-state expansion drifts from the micro-ops | Interpreter≡expansion test on every demo program                                         |
| Assembler eats time                      | Two-pass, labels + `.org` + `.db` only                                                      |
| Teammates can't run the plugin           | Document the local import steps in the README; one person drives the demo, others watch     |

## 15. Open questions

- Is a Turbo of ≥50k instructions/sec realistic in Figma desktop? Measure it in Stage 6.
- What is the handoff's target program "sigma"? If it's real, add it to §9.
- Should edits to the signal table on the canvas ever become executable? (Post-MVP: only if the Factory "hardware mode" needs it.)

## 16. Post-MVP sponsor layers (only after the Stage 8 cut line)

All three reuse `plugin/src/core` unchanged.

- **Factory (Droid SDK):** a local Node server running a Droid agent. It has CPU tools (`assemble`, `load_program`, `run_on_cpu`, `read_screen`, `read_registers`) and writes assembly for our ISA until the screen matches. Stretch: "hardware mode", where the agent edits a micro-op row on the canvas.
- **Convex:** shared CPU state plus a server-side `tick`. Phones send IO as mutations, and the ordered input log gives replay and rewind. If Convex holds the state, the plugin uploads the opcode table to it, so the canvas stays the source of behavior.
- **Cartesia:** voice narration of Watch mode ("PC drives the address bus… MDR loads 0x10…").

## 17. Phase 2 (after MVP, not this weekend unless it's going great)

A mini Figma program running on this CPU: a shape table in RAM, a rect tool, a layers panel that reads RAM, and select/move. The `slot/future/figma-app` frame on the canvas reserves its place, and `paint.asm` is the first step toward it.
