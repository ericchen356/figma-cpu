# FigmaCPU

An 8-bit CPU drawn on the Figma canvas that actually runs programs. The opcode table on the canvas **is** the CPU's logic: the plugin reads it, steps the machine one T-state or one instruction at a time, and writes registers, buses, latches, control signals, RAM and the 128×96 screen back onto the canvas.

- Design: [`PRD.md`](PRD.md) · build history: [`STAGELOG.md`](STAGELOG.md)
- Figma file: https://www.figma.com/design/l2JmsK7AEQkfo3Cvx67NgN/Figma-CPU (pages **Eric** and **Machine v2**)

## Run it in Figma (each teammate, once)

The plugin is a local development plugin. It runs in the **Figma desktop app** (not the browser) and needs no tokens.

```bash
cd plugin
npm install
npm run build          # → plugin/dist/code.js + dist/ui.html   (npm run watch while developing)
```

1. Figma desktop → open the file → go to a page that has the drawn machine (**Eric**).
2. Menu → Plugins → Development → **Import plugin from manifest…** → `plugin/manifest.json`.
3. Plugins → Development → **FigmaCPU**.

Only the person clicking Run needs the plugin. Everyone else with the file open sees the canvas update live.

### Using the panel

| Control | What it does |
|---|---|
| Program + **Assemble & load** (⌘↵) | Assembles with the opcode table currently on the canvas and loads it into RAM |
| **Step T-state** | One clock tick. Lights the active control signals, drives the buses, latches values |
| **Step instr** | Finishes the current instruction (FETCH → DECODE → EXEC) |
| **▶ Watch** | Runs T-state by T-state at the speed slider's rate (1–30 Hz) |
| **⏩ Turbo** | Runs at full speed, redraws ~30 fps, the screen at ≤15 fps |
| Screen preview | Click/drag = mouse IO (`0xF000–F002`); with it focused, keys go to `KEY` (`0xF003`) |
| Pin | Base address of the pinned RAM window on the canvas (e.g. `4000`, `8000`) |

Try it:

- `count` in Watch to narrate fetch/decode/execute.
- `fib` and watch the pinned window at `4000`.
- `rect`, then `bounce` in Turbo.
- `paint`: draw with the mouse, and keys `0`–`9`/`a`–`f` pick colors.

**Live rewiring:** while it runs, edit a micro-op in the DECODER table on the canvas, e.g. change `ADD`'s `ALU ADD rd rs` to `ALU SUB rd rs`. The next instruction uses the new logic. Bad edits show up in the panel's table pill, and only that row is disabled.

State (RAM, registers, program) is saved into the file, so closing and reopening the plugin resumes.

## Test it without Figma

```bash
cd plugin
npm test               # vitest: 40 tests
npm run typecheck
```

What the tests cover:

- The table parser.
- ALU flags.
- The assembler.
- All five programs, including the bouncing square across 140 frames.
- Live table edits.
- The bus rule: at most one driver per bus per T-state, for every opcode.
- The fast interpreter and the T-state engine agree, field by field, at every instruction of every program.
- The real draw script, binder, renderer and MCP smoke entry, run against an in-memory fake of the Figma API that, like Figma, throws on unloaded fonts.

## Drawing the machine

`tools/draw-machine/` generates the whole machine from `spec/*.json`:

```bash
node tools/draw-machine/build.mjs --page Eric      # add --force to replace an existing drawing
```

Then either:

- **Plugin (no quota):** Figma desktop → Plugins → Development → Import plugin from manifest → `tools/draw-machine/manifest.json` → run.
- **Figma MCP:** pass `tools/draw-machine/use-figma.js` to `use_figma` (see `tools/run-in-figma.sh`). MCP calls are rate-limited on View seats, so prefer the plugin.

`plugin/dist/use-figma-smoke.js` is a `use_figma` body that binds the drawn machine, reads the table off the canvas, runs a program, and paints the result. Edit `SMOKE` on its first line to choose the page and program.

## Layout

```
spec/                 opcodes + micro-ops, control signals, memory map, palette (single source of truth)
plugin/src/core/      pure TS, no Figma API: micro-op parser, CPU + interpreter, T-state engine, assembler, PNG
plugin/src/figma/     binder (contract names → nodes) and diffing renderer
plugin/src/main.ts    plugin main thread: run loop, IO, screen, persistence
plugin/ui/            control panel (editor, controls, screen encoder + mouse/keys)
plugin/programs/      count, fib, rect, bounce, paint
tools/draw-machine/   draws the machine from spec/
```

Figma REST reads (verification scripts) use `FIGMA_TOKEN` from a gitignored `.env`. Never commit it.
