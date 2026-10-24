# engine/ — the Figma OS editor as a gate-level machine

The editor in `os-ui/src/model.ts`, rebuilt as a **netlist of 2-input gates** with the silicon HDL
(`silicon/src/hdl`), so Figma's prototype engine can compute it and the whole chart is drawable.
One clock tick is one editor event. Nothing here runs at Figma run time: TypeScript is the fab and
the test bench, the same rule as `silicon/docs/SILICON.md`.

Why it exists: a general CPU needs about 6 ticks and ~2,600 executed actions per tick, so one
instruction costs ~15k actions and one editor click millions. Figma's viewer dies above ~2,000
actions per event. Making the hardware **wide** instead (all 8 layers compared in parallel, whole
records shifted in one tick) turns a click into **one reaction of 20 to 1,600 actions**.

## What is in the netlist (5,110 gates, 5,129 nets)

| Part       | Gates | Notes                                                                                                                             |
| ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| Layer file | 1,232 | 8 records x 24 bits: used, vis, kind (2), x0 x1 y0 y1 (4 each), fill (4); stack order = slot order                                |
| HIT8       | 623   | 8 layers x 4 comparators + priority encoder; topmost wins                                                                         |
| MOVE       | 264   | drag-move with clamp to the canvas                                                                                                |
| NUDGE      | 229   | arrow keys and the duplicate offset, saturating at the edge                                                                       |
| SPAN       | 100   | create-drag / resize rectangle from two corner cells                                                                              |
| Glue       | 2,662 | event decode, read plane on one layer, free-slot encoder, record shift muxes (delete / reorder move records in one tick), control |

Events (`EVT`, 4 bits): TOOL, FILL, DOWN, MOVE, UP, SELECT, HANDLE, VIS, DELETE, DUP, FWD `]`,
BACK `[`, NUDGE, ESC. Inputs: `PX`, `PY` (the pointer cell), `ARG` (tool, colour, slot, direction).

## Verified

`node engine/run.mjs fuzz.ts <seed> <episodes> <events>` drives the netlist (RefSim) and
`os-ui/src/model.ts` `reduce()` with the same random events and compares layers (z-order, geometry,
fill, kind, visibility), selection, tool, fill and drag mode after every event. About 94k random
events over five seeds on the final netlist: **0 mismatches**, with every branch hit (create each kind, create when
full, drag move / create / resize, handles, delete, duplicate, both reorders, nudge, visibility).
The compiled schedule (FastSim) also matches RefSim on every net after every tick.

## What one event costs in Figma actions

`react.ts` is the reaction compiler: tie `EVT` to the event, fold constants, turn identity gates
into wires, keep only gates that can change a state register, then emit ONE evaluation pass plus the
state commit (masters of loaded registers, then slaves). Executed actions, measured by running the
action list with the repo's own interpreter (`runPlanActions`: one per set, one per `if` plus the
branch it runs) on 1,200+ real states per event; the next state is compared with the full
gate-level engine every time (all identical).

| Event                      | executed (mean / max)                  |
| -------------------------- | -------------------------------------- |
| TOOL / UP / ESC / SELECT   | 20 / 34 / 41 / 66                      |
| VIS toggle / FILL / HANDLE | 78 / 128 / 350 (max 387)               |
| NUDGE / DUP / FWD / BACK   | 659 / 909 / 776 / 823 (max ~1,040)     |
| MOVE (any drag mode)       | 838 (max 907)                          |
| DOWN (any tool)            | 1,466 (max 1,608)                      |
| DELETE                     | 490 (max 1,507, all 8 layers shifting) |

Every reaction has conditional nesting depth 1 (`if (register enable) { ... }` with no else), which
is what the editor itself can author. Total static size of the 14 reactions: ~13.9k actions.
`measure.ts` also prints the cheaper numbers you get if DOWN / MOVE are dispatched on tool / drag
mode (needs nesting, or visibility-switched hotspot layers).

## Not done / not proven

- **Never run in Figma.** The cost model is the spike's (1 per set / conditional); the crash line is
  somewhere between 501 and 2,001 actions per event (unbracketed), and per-action latency with
  thousands of variables bound to lamps is unmeasured.
- Drawing it (~5k gates, extrapolated ~160k layers), binding lamps, and the reaction `apply` step
  (the existing `silicon/src/prototype/apply.ts` is boolean-only and tick-based).
- Display: gate state (4-bit buses) to rectangle size / position / colour needs an adapter; x / y
  are not bindable, so position is via auto-layout padding. Number variables cannot bind to text.
- Pointer plumbing: a grid of 14x10 hover cells setting `PX` / `PY`, and where the DOWN / MOVE / UP
  reactions live (instance-inherited reactions, click bubbling, hover while pressed are untested).
- Typed API vs accepted: `setReactionsAsync` may reject or mis-run what the typings allow.
- Text (layer names, properties numbers), pages, paint, undo, align, typed property edits are cut.

## Run

```
node engine/run.mjs fuzz.ts 5 40 150      # engine vs model.ts
node engine/run.mjs measure.ts            # executed actions per event
node engine/run.mjs sizes.ts              # static size and nesting depth of every reaction
NM=128 node engine/run.mjs word-level/bench.ts   # the word-level (non-gate) CPU experiment
```

`word-level/` is the earlier experiment: a word-level CPU as Figma actions (numbers, `+ - <`,
decision trees), ~5 actions per instruction compiled, ~24 interpreted, validated against
`model.ts`. It is the fallback if the gate-level plan hits a Figma limit.
