# FigmaCPU Silicon: the plugin

This dev plugin runs the whole pipeline inside Figma desktop. It draws the gate-level CPU as
components, reads the circuit back off the canvas, and compiles it into Figma variables plus
prototype actions. After that, Figma's own prototype engine computes the CPU: in Present mode,
one click on **Step** is one clock tick.

The canvas is the source of truth. Compile, Verify and the plugin clock all run the circuit
**extracted from the components on the page**, not the TypeScript description. If you edit an
instance's net property, the machine changes.

## Build

```sh
cd silicon
npm install            # once
node plugin/build.mjs  # → plugin/dist/code.js + plugin/dist/ui.html
```

## Run it in Figma desktop

1. Open **Figma desktop** and create a new **Design** file, or open one you don't mind filling. A Starter-plan file works. Everything goes on **one page**: a page named `Silicon` if one exists, otherwise the current page. Existing content stays where it is, and the silicon is placed below it.
2. Go to **Menu → Plugins → Development → Import plugin from manifest…** and pick `silicon/plugin/manifest.json`.
3. Go to **Menu → Plugins → Development → FigmaCPU Silicon**. The panel opens.
4. Click **Build hardware**. This takes a while: about 72k layers, with the progress bar counting through 33 modules.
5. Click **Create front panel**. This step is optional, because Compile creates the panel if it is missing.
6. Pick a program, for example `mul`, and click **Compile**. Wait until the log shows `compiled mul: … ▶ Present …`.
7. Press **▶ Present** and choose the flow **CPU · Step**. Click **Step**: every gate's highlight and every lit wire of the CPU updates. To watch the front panel run on its own, click **Run ▸**, or start the flow **CPU** and click **Run**. It loops until HLT. With `mul`, OUT shows `2A` after 162 ticks.
8. To change the program, pick another one (or edit the source) and click **Load program**. Then restart the prototype (press **R** in the viewer). You don't need to recompile.

**To run the full CPU at speed, use the plugin clock** (section 5, **Run**). It runs the same compiled circuit in the plugin and lights up the canvas live in the editor. Figma's viewer crashes when one event runs more than about 500–2000 actions ("Maximum call stack size exceeded", measured with the spike). A whole CPU tick is about 3,860 actions, and Reset is about 2,290. Present-mode stepping of the full CPU therefore needs the chunked ticks lane F is adding to `plan`/`apply`. Compile passes **Max actions / event** (`maxActionsPerEvent`) straight through to both, along with any other plan/apply options.

## The panel

| # | Button | What it does |
|---|---|---|
| 1 | **Build hardware** | Draws the 8 gates, every cell and `cell/CPU` as main components. It draws one module at a time and yields between modules, so Figma stays responsive. **gate labels** puts net names on gate leads (only for newly drawn gates). **redraw** replaces the existing components; without it, they are reused. **separate pages** draws onto `Silicon · Gates / Cells / CPU`, but only if the plan allows more pages. Otherwise it logs why and uses one page. |
| 2 | **Create front panel** | Creates the `Silicon · Front panel` component once: two 7-segment digits bound to `SEG_HI`/`SEG_LO`, and one lamp per bit of OUT, BUS, IR, PC, T, R0–R3, Z C N and HALTED. A frame named `lamp/<net>` (or `seg/<net>`) with a `lit` child is bound to that net, so renaming a lamp rewires it. |
| 3 | **Compile** | Runs extract → flatten → compile (`inputs: []`) → assemble the program → `powerOn` with RAM pokes → `plan` (halt = `halted`) → `collectBindings` → `apply`. Options (`flat`, `runDelayMs`, `maxActionsPerEvent`, and any extra `plan`/`apply` option) pass straight through. The result is the variable collection `CPU`, the frames `CPU · Control`, `CPU · Run A` and `CPU · Run B` (with the front panel), and the **`CPU · Step`** frame. That frame holds the `cell/CPU` main component itself. Its header is a **copy of the controls `apply` built** in `CPU · Control`: buttons with their reactions and bindings, counters, the front panel. The Control frame's own frame-level triggers (for example a key-held clock) are mirrored onto the Step frame, and navigation back to Control is redirected to the Step frame. No reaction is hand-built, so whatever scheme `apply` uses also runs in the Step frame. Compiling again replaces the old collection and frames. |
| 4 | **Load program** | Assembles the editor's source, with errors shown live. It writes the program's power-on state into the variables, so the RAM latches hold the program, and zeroes the tick counter. It then patches the power-on literals in the existing reactions (the Reset buttons, however `apply` shaped them). Only nets whose power-on value can depend on the program are patched, so a tick's own literals are never touched. No recompile is needed. |
| 5 | **Run · plugin clock** | This is the way to run the full CPU at speed. It reads the variables into `FastSim`, using the same schedule as the prototype. It runs N ticks per frame at the chosen speed and writes back only the variables that changed, so the highlights move in the editor. **Step** runs one tick, **Run** and **Pause** start and stop it, and **Reset** reloads the program. The panel shows OUT, ticks, registers and flags. |
| 6 | **Verify** | Extracts the canvas CPU and runs it on FastSim next to the T-state `IsaModel`. After every tick it compares every probe, every RAM byte and the bus during the LOW pass. It reports `✓ matches the ISA model for N ticks` or the first mismatch. |

## Layout on one page (top to bottom)

```
 (your existing content)
 Silicon · Gates   gate/AND … gate/BUF in a row
 Silicon · Cells   cell/DLATCH … cell/BUSMUX on shelves (rows ≤ 6000 px)
 Silicon · CPU     [front panel]   [CPU · Step frame ⊃ header + cell/CPU (45k × 9.5k px)]
                                   [CPU · Control] [CPU · Run A] [CPU · Run B]
```

The document remembers where the silicon is (root plugin data `silicon.pages` / `silicon.origin` / `silicon.program`), so a later session finds it even when another page is current.

**Don't delete the `CPU · Step` frame**: it contains the `cell/CPU` main component. To get rid of the frame, drag `cell/CPU` out of it first. Build hardware and Compile handle the frame themselves: they take `cell/CPU` out and put it back.

## Files

- `manifest.json` is the dev plugin: `editorType` figma, `documentAccess` dynamic-page, no network.
- `build.mjs` runs esbuild and inlines the UI script into `dist/ui.html`.
- `src/main.ts` is the entry point: `showUI` plus message routing.
- `src/app.ts` is `SiliconApp`: each button is a method, and it takes `api` + `post`, so it can be tested in Node.
- `src/where.ts` decides which page or pages to use, how to fall back on the Starter plan, and how the regions are laid out.
- `src/panel.ts` draws the front panel and finds its lamps.
- `src/canvas.ts` holds the `CPU · Step` frame and the helpers that move `cell/*` in and out of frames.
- `src/clock.ts` is the plugin clock.
- `src/program.ts` holds the assembler wrapper, RAM pokes and Verify.
- `src/messages.ts` defines the panel ↔ plugin messages.
- `ui/ui.html` and `ui/ui.ts` are the panel.
- Tests are in `../test/plugin.test.ts`. They run the full flow on the fake Figma (`../test/fake-figma.ts`): first a Starter-plan file whose `createPage` throws, then separate pages. The exact Step reaction JSON is replayed in `src/prototype/emulate`.
