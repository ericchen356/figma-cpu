# Running the gate-level CPU in Present mode, wired through the Figma connector

How the testing2 file got a working prototype of the gate-level CPU when the plugin's Compile could not finish
in Figma desktop, and how to repeat it. Everything at run time is Figma's prototype engine: one boolean variable
per wire, one `SET_VARIABLE` per gate (`AND` / `OR` / `NOT` / `NOT_EQUAL` = XOR / `EQUALS` = buffer), opcodes
decoded by the gates of `cell/CONTROL`. The scripts below only write those reactions into the file.

## Why a second route

- Figma desktop (126.10) timed out in `setReactionsAsync` ("Unable to establish connection to Figma after 10
  seconds") on the Step reaction of a chunked tick: one reaction holding all 11 chunks, ~4,300 actions. Every
  action was valid on its own (the `setReactions` probe in `src/prototype/apply-per-chunk.ts` checks that and logs
  the smallest rejected piece).
- Even ≤ 400-action reactions timed out inside the plugin there, and Figma crashed during the probe. The same
  reactions, written through the Figma MCP (`use_figma`), take 0.3–0.8 s each.
- Upstream `apply()` (`src/prototype/apply.ts`) separately fixed nested CONDITIONALs, which Figma rejects
  ("Unrecognized key: conditionalBlocks"). Both rules hold: **flat reactions, ≤ 400 actions per event, and small
  reactions when the file is big.**

## Layout (`applyPerChunk`, `src/prototype/apply-per-chunk.ts`)

An alternative to `apply()`, same variables and gate actions, one reaction per chunk:

- `CPU · Control`: one **Step** and one **Run** button per phase, stacked; each is visible only while
  `ctl/phaseIs/k` is true, so a click reaches exactly chunk k. Reset, tick and phase counters, the front panel.
- `CPU · Run 1…11`: a ring; frame k runs chunk k−1 on AFTER_TIMEOUT and goes to the next (frame 1 also stops on
  HALTED, so a tick is never cut in half).
- Tests: `test/prototype.test.ts` › "applyPerChunk()" (Step = one chunk, K Steps = one tick ≡ FastSim, the Run ring
  stops on HALTED, no reaction holds more than one chunk, and ptrout on the real CPU counts OUT 7 → 0).

If `applyPerChunk` runs in the plugin but its `setReactionsAsync` calls time out, the variables, frames and stacked
buttons are already in the file. The connector scripts then add the reactions.

## The connector route, step by step

Prerequisites: the Figma MCP connected, the file key, and a file where Build hardware + Compile created the `CPU`
variables and the `applyPerChunk` frames. Each `.js` file below is pasted whole as the `use_figma` code.

1. **Chunks**: `npm run connector:chunks -- ptrout` → `tools/connector/out/c0…c10.json` + `meta.json`
   (compact: variable names + `[target, expression]` per gate; ~15–19 kB per chunk).
   The gate actions are the same for every program: a program is only the RAM bits' power-on values.
2. **Wire each chunk**: `node tools/connector/wire-chunk.mjs <k>` prints a script that sets Step button k and
   Run frame k+1. It checks its own name/action counts first, so a truncated paste changes nothing.
3. **Controls**: `tools/connector/controls.js` wires the Run / Stop buttons, the chunked Reset chain
   (`CPU · Reset 1…7`, ≤ 380 restores each, back to Control) and the Present flow "CPU".
4. **Live view**: `tools/connector/live-view.js` builds `CPU · Live` (1920 × 1080): the whole CPU as a scaled
   instance, zoom windows on the ALU, the register file and the control unit, and a copy of the controls.
5. **Run in place**: `tools/connector/live-overlays.js` makes Run / Reset in the Live view play as small overlays
   (SWAP between overlay frames, CLOSE at the end), so the CPU stays on screen and lights up while it runs, and
   brightens every gate's `lit` highlight.
6. **Check**: `tools/connector/check-replay.js` (read-only) replays the stored Step reactions from power-on;
   ptrout gives OUT 7, 6, … 0 from tick 23 (one step per 18 ticks) and HALTED at tick 165 (1,836 clicks).
   `tools/connector/check-render.js` sets every wire to 1, screenshots the Live view, and restores every value.

## Using it in Present mode

Flow **CPU · Live** → **Step** runs one chunk (11 per clock tick; the phase counter shows where you are) and
**Run** loops on its own until HALT or **Stop**. Gates light yellow while their output is 1, in all four views.
A tick is ~3,855 variable updates, so the speed is whatever the viewer manages to redraw.

## Limits

- Overlay position is read-only in the Plugin API (Figma centres the Run bar).
- The Live view's region coordinates match Build hardware's layout of the v1 CPU (`live-view.js`).
- `wire-chunk.mjs` resolves variables by name, so it needs a file compiled from the same netlist (same ISA).
- Upstream's `wireLive` dashboard (`src/live`, `docs/LIVE.md`) is the plugin-built alternative to steps 4–5.
