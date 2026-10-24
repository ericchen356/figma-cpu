# Leila CPU

A Figma plugin that runs the FigmaCPU machine drawn on the **Leila** page. The opcode table on the canvas is the CPU's logic: the plugin reads it, steps the machine one T-state or one instruction at a time, and writes registers, buses, connectors, control signals, RAM and the 128×96 screen back onto the canvas.

It follows the FigmaCPU plugin on `eric/cpu-plugin` (same micro-ops, signals, assembler and programs) and adds:

- **Leila only.** It always drives the `Machine v2` frame on the Leila page, whichever page it's launched from, and pauses if you switch pages.
- **Per-signal connectors.** Each T-state lights only the connectors that carry a value, using the connector names drawn by `tools/draw-leila` (on the `leila/draw-machine` branch).
- **Load & run.** Each demo starts in the mode it needs; the screen sits right under the clock controls.
- **No dependencies.** Plain JavaScript; `node build.mjs` writes `dist/`.

## Run it

```bash
node build.mjs
```

Then in **Figma desktop**: Plugins → Development → Import plugin from manifest → `manifest.json` → run **Leila CPU**.

| Program | Mode | What you see |
|---|---|---|
| count | Watch | Every FETCH / DECODE / EXEC step on the canvas |
| fib | Watch | Fibonacci numbers fill the pinned RAM window at 4000 |
| rect | Turbo | A red 40×32 rectangle on the screen |
| bounce | Turbo | A square bouncing around the screen |
| paint | Turbo | Draw on the panel's screen; click it and press 0–9 for colors |

## Test it

```bash
node build.mjs && node test/run.mjs
```

19 tests: the opcode table and assembler, all five programs, the T-state engine against the instruction interpreter at every instruction (with at most one driver per bus), and the binder + renderer against the real Leila drawing in an in-memory fake of the Figma API. The last test reads `../tools/draw-leila/use-figma.js` from the `leila/draw-machine` branch and is skipped when that file isn't there.

## Layout

```
src/core/      spec, micro-op parser, CPU + interpreter, T-state engine, assembler (no Figma API)
src/figma/     binder (layer names → nodes) and diffing renderer
src/main.js    plugin main thread: clock, Watch/Turbo, IO, screen, saved state
ui/            control panel (editor, clock, screen + mouse/keys)
programs/      count, fib, rect, bounce, paint
test/          Node tests
```
