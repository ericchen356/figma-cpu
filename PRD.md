# PRD: FigmaCPU — an 8-bit CPU built inside Figma

**Event:** CalHacks · **Team:** solo · **Time budget:** ~36h
**Target tracks:** Best Figma Workflow ($2000) · Best Stage Log ($2000)
**Figma file:** https://www.figma.com/design/l2JmsK7AEQkfo3Cvx67NgN/Untitled (file key `l2JmsK7AEQkfo3Cvx67NgN`)

---

## 1. One-liner

An 8-bit computer drawn on the Figma canvas — registers, ALU, buses, decoder, RAM, a 128×96 screen — that actually runs programs. You can watch every instruction move through the machine.

> **Scope for this hackathon: the CPU only.** The "mini Figma running on the CPU" is Phase 2 (§15). The canvas reserves a slot for it, but no work goes into it until the CPU MVP ships.

## 2. Goals / non-goals

**Goals**

- The CPU's structure _and_ behavior live in the Figma file. The opcode table is a frame on the canvas, and editing it changes how the CPU behaves.
- The plugin is only "physics": it reads the drawn machine, advances one clock, and writes the new state back. It contains no hidden emulator with its own hard-coded instruction set.
- A legible, live demo: load a program and watch PC → bus → decoder → ALU → registers/RAM → screen.
- A Stage Log that someone else could follow to rebuild the project stage by stage.
- Real use of Figma Design, the Figma agent, Figma Make, and Dev Mode/MCP, with each one documented in the log.

**Non-goals (this hackathon)**

- Any Figma-clone guest app (Phase 2).
- Gate-level simulation (a stretch zoom-in only).
- An OS, a file system, or a C compiler.

## 3. Key decisions (locked)

| Area          | Decision                                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute model | The CPU is built block-level as Figma frames. Its behavior comes from the opcode/micro-op table on the canvas. The plugin reads the table and steps the machine. |
| ISA           | Custom 8-bit data, 16-bit address, ~24 opcodes                                                                                                                   |
| Display       | **128×96, 16 colors, 1 byte/pixel**, rendered as **one image-fill rect** (§7)                                                                                    |
| Input         | Plugin UI → memory-mapped IO (mouse x/y/button + a key byte)                                                                                                     |
| Toolchain     | Assembler in the plugin UI; assembled bytes are written into the RAM nodes on the canvas                                                                         |
| Speed         | **Watch mode** (2–5 Hz, every change animated) + **Turbo mode** (fast, syncs once per frame)                                                                     |
| Layout        | Placeholder **slot frames** are drawn first (§5) and real parts get built into them                                                                              |
| Stage Log     | `STAGELOG.md` in the repo, one git tag per stage                                                                                                                 |
| Demo          | Step through a program in Watch mode, then flip to Turbo and run a graphics demo on the screen                                                                   |

## 4. System architecture

```
┌──────────── Figma file · page "Machine" ────────────┐
│ CPU blocks (frames) · opcode table (data) · RAM     │
│ window (text cells) · IO regs · SCREEN (image fill) │
└─────────────────────────────────────────────────────┘
   ▲ read structure + opcode table   │ write state / highlights / screen image
   │                                 ▼
┌──────── Plugin main thread (code.ts) — "physics" ────────┐
│ binder: node-name → handle    stepper: fetch/decode/exec │
│ decoder parses OPCODE TABLE   renderer: diff → node writes│
└──────────────────────────────────────────────────────────┘
   ▲ postMessage (asm, run/step, mouse/keys)   │ state + VRAM
   │                                           ▼
┌──────── Plugin UI (ui.html) — control panel ─────────────┐
│ assembler editor · Step/Run/Pause · Watch↔Turbo · Hz     │
│ register readout · VRAM → PNG encoder (for the screen)    │
└──────────────────────────────────────────────────────────┘
```

### 4.1 Where state lives

- **Canonical state lives in the Figma document.** Registers and the visible RAM cells are text layers. The full 64KB lives in `pluginData` on the `mem/ram` frame. The screen is an image fill.
- In **Turbo mode** the plugin holds a working copy in memory and flushes it to the canvas once per frame (~10–30 Hz). Say this plainly in the writeup.

### 4.2 Node naming contract (the binder, MCP codegen, and agent all depend on it)

```
cpu/reg/A … cpu/reg/L, cpu/reg/PC, cpu/reg/SP, cpu/reg/IR
cpu/flag/Z, cpu/flag/C, cpu/flag/N
cpu/alu, cpu/alu/op, cpu/alu/out
cpu/bus/addr, cpu/bus/data          (stroke highlights)
cpu/decoder/table                   (frame of rows: row/<hex>)
mem/ram/cell/<hex addr>             (visible window cells)
mem/io/<name>
dev/screen                          (single rect, image fill)
slot/…                              (placeholder frames — see §5)
```

## 5. Canvas layout & placeholder slots

Before building anything, run the **layout-slots dev plugin** (`tools/layout-slots/`). It draws a dashed, labeled placeholder frame for each part, showing where it goes, what it is, and which stage builds it. You build each real component inside its slot. Once a slot is filled, change its stroke from dashed to solid (or delete the label) so the canvas doubles as a progress board.

```
x→   0            650              1400           2100
y=0  ┌──────────── FigmaCPU · title band ──────────────────────────────┐
200  ┌ CONTROL ──┐ ┌ REGISTERS ────┐ ┌ ALU+FLAGS ─┐ ┌ SCREEN 128×96 ────┐
     │ PC SP IR  │ │ A B C D H L   │ │ op · out   │ │ (image fill, 6×)  │
     │ clock     │ │               │ │ Z C N      │ │                   │
650  └───────────┘ └───────────────┘ └────────────┘ │                   │
700  ═══════════ ADDRESS BUS (16-bit) ════════════  │                   │
820  ═══════════ DATA BUS (8-bit) ════════════════  └───────────────────┘
980  ┌ DECODER / OPCODE TABLE ─────┐ ┌ RAM WINDOW ┐ ┌ IO / INPUT ───────┐
     │ op|mnem|args|micro-ops      │ │ PC-follow  │ │ mouse · keys ·    │
     │ (the CPU's "program logic") │ │ + pinned   │ │ timer             │
     │                             │ │ region     │ └───────────────────┘
     │                             │ │            │ ┌ PHASE 2: FIGMA ───┐
     │                             │ │            │ │ app slot (future) │
1880 └─────────────────────────────┘ └────────────┘ └───────────────────┘
```

| Slot                                     | Built in stage |
| ---------------------------------------- | -------------- |
| `slot/cpu/control`                       | 1              |
| `slot/cpu/registers`                     | 1              |
| `slot/cpu/alu`                           | 1              |
| `slot/cpu/bus/addr`, `slot/cpu/bus/data` | 1              |
| `slot/cpu/decoder`                       | 2              |
| `slot/mem/ram`                           | 2              |
| `slot/dev/screen`                        | 6              |
| `slot/dev/io`                            | 7              |
| `slot/future/figma-app`                  | Phase 2        |

## 6. ISA (v0, edit on canvas)

- **Registers:** A, B, C, D, H, L (8-bit). H:L is the 16-bit pointer. PC and SP are 16-bit. Flags: Z, C, N.
- **Encoding:** 1-byte opcode, followed by 0–2 operand bytes.

| Group | Instructions                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------- |
| Move  | `LDI r,imm8` · `MOV rd,rs` · `LD r,[HL]` · `ST r,[HL]` · `LDA r,[a16]` · `STA r,[a16]` · `LHL imm16` |
| ALU   | `ADD` `SUB` `AND` `OR` `XOR` `CMP` (rd,rs) · `INC r` · `DEC r` · `SHL r` · `SHR r` · `INHL` (HL++)   |
| Flow  | `JMP a16` · `JZ` · `JNZ` · `JC` · `JNC` · `CALL a16` · `RET`                                         |
| Stack | `PUSH r` · `POP r`                                                                                   |
| Misc  | `NOP` · `HLT`                                                                                        |

**Opcode table on canvas:** each row has `opcode | mnemonic | operand format | micro-ops`, where micro-ops is a small fixed vocabulary such as `FETCH8`, `ALU.ADD rd rs`, `MEM.READ HL→r`, `PC←a16 if Z`. The micro-op primitives are the only behavior defined in code. Demo moment: swap two rows on the canvas live and show the program's behavior change.

## 7. Display: yes, it can be bigger

**Why it's possible:** drawing every pixel as its own Figma node tops out around 64×48 (~3k nodes). Updating them is too slow beyond that. Instead, the screen is **one rectangle with an image fill**:

1. The plugin main thread sends VRAM (bytes) to the UI iframe.
2. The UI draws it onto a `<canvas>`, **upscaled with nearest-neighbor first** (e.g. 6× → 768×576). Figma smooths scaled image fills, so upscaling before encoding keeps the pixels crisp.
3. `canvas.toBlob('image/png')` → bytes → back to main → `figma.createImage(bytes)` → set as the fill on `dev/screen`.
4. In Turbo mode, refresh at most ~10–20 fps, and only when VRAM is dirty.

**What actually limits resolution:** the CPU's 64KB address space and how fast it can draw, not Figma.

| Option                | VRAM      | Notes                                                                                                                              |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 64×48 @ 1B/px         | 3 KB      | old plan                                                                                                                           |
| **128×96 @ 1B/px** ✅ | **12 KB** | `addr = 0x8000 + (y<<7) + x`; simple to program                                                                                    |
| 256×192 @ 4bpp        | 24 KB     | ZX-Spectrum size. Two pixels per byte, so every pixel write is a read-modify-write and drawing is slower. Upgrade later if wanted. |

The screen is the only image on the canvas. Everything else (registers, buses, RAM cells) stays as real nodes so it can animate.

## 8. Memory map

| Range           | Use                                                        |
| --------------- | ---------------------------------------------------------- |
| `0x0000–0x3FFF` | Program + data (assembler writes here)                     |
| `0x4000–0x7EFF` | General RAM; stack grows down from `0x7EFF`                |
| `0x8000–0xAFFF` | **VRAM** 128×96, 1 byte/pixel (low nibble = palette index) |
| `0xF000`        | `MOUSE_X` (0–127)                                          |
| `0xF001`        | `MOUSE_Y` (0–95)                                           |
| `0xF002`        | `MOUSE_BTN` (bit0 down)                                    |
| `0xF003`        | `KEY` (last key code; CPU writes 0 to ack)                 |
| `0xF004`        | `TICK` (increments each frame, for animation timing)       |
| `0xF005`        | `RAND` (pseudo-random byte)                                |

## 9. Demo programs (shipped with the assembler)

1. **count.asm**: count A from 0 to 10. Use it in Watch mode to narrate fetch/decode/execute.
2. **fib.asm**: Fibonacci into RAM. Shows the RAM window filling up.
3. **rect.asm**: fill a rectangle on the screen. The first pixels appear.
4. **bounce.asm**: a bouncing square using `TICK`, in Turbo mode. This is the "it's a real computer" moment.
5. **paint.asm** (stretch): paint pixels with the mouse via IO. This also sets up Phase 2.

## 10. Visualization (Watch mode)

- **Fetch:** PC pulses, the address bus highlights, the RAM cell at PC highlights, and the value travels over the data bus into IR.
- **Decode:** the matching opcode-table row highlights.
- **Execute:** the ALU shows the op and its output, the destination register flashes, and RAM/IO writes flash.
- The RAM window follows PC. A second pinned window shows any address you choose.

Performance rules: cache node handles at bind time, only write nodes that changed, batch writes per frame, and avoid auto-layout on frequently updated nodes.

## 11. Figma workflow (for the Workflow track)

| Tool                 | Used for                                                                                                  | Evidence                 |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Figma Design**     | CPU components with variants (idle/active register, bus, RAM cell); slot layout                           | Screenshots + file link  |
| **Figma agent / AI** | Generating repetitive parts: RAM cell grid, opcode table rows from the ISA spec                           | Prompts in STAGELOG      |
| **Figma Make**       | Prototyping the plugin control panel (assembler, run controls) before coding it                           | Make link + before/after |
| **Dev Mode / MCP**   | Claude Code reads components and names through the Figma MCP server and generates the binder and renderer | MCP transcript snippets  |

The story: **slot the layout → design the parts → let the agent mass-produce the repetitive ones → Make the control panel → MCP turns the design into the code that runs it.**

## 12. Stage plan (solo, ~36h)

Each stage ends with a commit, a `git tag stage-N`, a canvas screenshot, and a STAGELOG entry.

| #   | Hours | Stage                                                                       | Exit criterion                       |
| --- | ----- | --------------------------------------------------------------------------- | ------------------------------------ |
| 0   | 0–1   | Repo, run `layout-slots`, plugin scaffold (TS + esbuild), STAGELOG template | Slots on canvas; "hello" plugin runs |
| 1   | 1–4   | Design CPU blocks into slots: control, registers, ALU, buses                | All `cpu/*` names exist              |
| 2   | 4–6   | Agent-generated RAM window + opcode table rows                              | Binder finds every node              |
| 3   | 6–10  | Stepper: parse opcode table → micro-ops; `LDI/ADD/JMP/HLT`                  | Hand-loaded program steps on canvas  |
| 4   | 10–13 | Full ISA + assembler in UI + load into RAM nodes                            | `count.asm`, `fib.asm` correct       |
| 5   | 13–16 | Watch-mode animation + Turbo mode                                           | Turbo ≥ 50k IPS                      |
| 🛌  | 16–21 | Sleep                                                                       | —                                    |
| 6   | 21–25 | Screen: VRAM → PNG → image fill                                             | `rect.asm` draws crisp pixels        |
| 7   | 25–28 | IO (TICK, RAND, mouse, keys) + `bounce.asm`                                 | **MVP demo works** ← cut line        |
| 8   | 28–31 | Control panel from Figma Make; live opcode-table edit demo                  | —                                    |
| 9   | 31–33 | Stretch: `paint.asm`, gate-level ALU zoom-in                                | —                                    |
| 10  | 33–36 | Demo video, STAGELOG polish, Devpost                                        | Submitted                            |

## 13. Stage Log format (`STAGELOG.md`)

```markdown
## Stage N — <name> (tag: stage-N, ~Xh)

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

| Risk                                | Mitigation                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Node updates too slow               | Diff writes; the screen is a single image; Turbo frame-batching                       |
| Image fill looks blurry             | Upscale with nearest-neighbor in the UI canvas before PNG encoding                    |
| Many image updates bloat the file   | Cap refresh at ~10–20 fps; only refresh when VRAM is dirty                            |
| Judges call it "just a JS emulator" | Opcode table is parsed from the canvas; live-edit demo; the code has no ISA constants |
| Assembler eats time                 | Two-pass, labels + `.org` + `.db` only                                                |

## 15. Phase 2 (after MVP, not this weekend unless it's going great)

A mini Figma program running on this CPU. It would add a shape table in RAM, a rect tool, a layers panel that reads RAM, and select/move. The `slot/future/figma-app` frame on the canvas reserves its place, and `paint.asm` is the first step toward it.

## 16. Open questions

- Exact micro-op vocabulary. Lock it in Stage 3.
- Palette: PICO-8 16 colors, or Figma's UI colors?
- Stay at 128×96, or go to 256×192 @ 4bpp after the MVP?
