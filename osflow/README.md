# osflow: the Figma OS as a chart of gates that Figma itself computes

`os-ui/` is the Figma OS editor as a TypeScript reducer. `osflow/` turns it into **a machine of
2-input gates** (silicon's gates and latches, one clock tick per editor event), to be drawn in
Figma as a chart and computed by Figma's own prototype engine, with no plugin code at run time.
**The gate-level chart is the product.** On the way there the editor is a word-level flow
(variables, `set` and `if`): that is the TypeScript back end, the executable spec the gates are
checked against, and what the spike below deploys.

```
os-ui/src/model.ts   the reducer (source of truth for behaviour)
        │  hand-ported, checked by test/lockstep.test.ts and test/hardware.test.ts
        ▼
src/editor.ts        the flow: variables + one handler per UI event (src/ir.ts is its language)
        │
        ├─ target "hardware" ─▶ src/gates/   2-input gates, top module "OS"   ← the product
        │                          │  checked by test/gates-editor.test.ts, register by register
        │                          ▼
        │                       24,893 gates; drawing them and one reaction per event is phase 2
        │
        └─ target "word" ─────▶ src/compile.ts   Figma Action[] (SET_VARIABLE + CONDITIONAL)
                                   │  spike/ builds the page, checked against silicon's emulator
                                   ▼
                                ▶ Present: variables change; nodes bound to them move and show
```

## Run it

```sh
cd osflow
npm install
npm test            # lockstep with os-ui, the gates against the flow, compile, deploy onto a fake Figma
npm run gates       # the gate-level editor: gates per module, event codes, the cost of each event
npm run stats       # the word-level flow: variables, events, actions stored and executed per event
npm run spike       # bundles the word-level Figma plugin → spike/dist/code.js
```

## The gate-level chart (`src/gates/`, contract in `docs/GATES.md`)

What exists:

- **The hardware target of the flow**: `buildEditor({ target: "hardware", omit? })`. The same
  handlers in cells, with a bit width on every number, the 420 canvas hotspot events folded into
  `pointer#down`, `pointer#enter`, `pointer#up` that read the window cell from 4-bit inputs, and
  every helper wrapped in a named unit (`hit`, `create`, `drag`, `parent`, `align`…). `omit` leaves
  out `"style"`, `"clipboard"` or `"align"` to trim the chart.
- **The synthesizer**: `synthesize(program)` runs every handler symbolically, merges the branches
  of each `if` into multiplexers, and builds a silicon Library with top module `OS` (inputs `CLK`,
  `EVT[7]`, `in_px[4]`, `in_py[4]`): one module per unit (`U_parent`, `U_hit`…), `GLUE` for the
  logic outside every unit, `EVDEC` for the event lines, and a `REG_W<n>` of silicon's `DFFE`
  per state variable. `GateMachine` runs it on silicon's FastSim or RefSim, one tick per event.
- **What one Figma reaction per event executes**: `reactions()` ties EVT to the event's code,
  folds the constants that follow, and keeps the cone of gates that feeds a register that can
  still load, plus one commit per register bit. No clock and no latches are needed in Figma.
  `ReactionMachine` runs only those reactions and computes exactly what a whole tick does.

The numbers (`npm run gates`):

|                                      | every feature | without style | without style, clipboard | without style, clipboard, align |
| ------------------------------------ | ------------- | ------------- | ------------------------ | ------------------------------- |
| gates                                | 24,893        | 22,815        | 21,987                   | 13,213                          |
| register bits (10 gates each)        | 738           | 621           | 557                      | 557                             |
| event codes (events)                 | 107 (124)     | 84 (101)      | 81 (98)                  | 75 (92)                         |
| actions of a whole clock tick        | 36,964        | 33,266        | 31,716                   | 22,775                          |
| actions of one reaction: median, max | 121, 9,984    | 121, 9,984    | 121, 9,965               | 121, 3,606                      |
| event codes within 500 actions       | 77            | 54            | 54                       | 54                              |

Where the gates are, with every feature: `U_parent` 7,328 (align's search for the smallest frame
holding the selection: eight 10 × 10-bit area products, 4,164 of its gates), `GLUE` 4,184, `U_hit`
1,745, `U_align` 1,222, `U_handle` 852, `U_prop` 642, `U_drag` 626, `U_span` 437, `EVDEC` 179, the
rest under 160 each; the registers are 7,380. A gate shared by two units belongs to the first that
made it; the gates that flatten a tree of multiplexers belong to the tree's root.

The costliest reactions, with every feature: the six aligns, 9,764 to 9,984 actions (7,328 of
them in `U_parent`); a pointer press, 3,880; Cut, 3,679; Duplicate, 3,558; `]` and `[`, 3,057 and
3,000; Delete, 2,335. A tool button is 7 commits and no gates (11 for Pen, Paint and Erase, which
also drop the selection); picking a swatch is 121; releasing the pointer is 14 (the tool registers
load only when the drag created a layer, LOAD = that condition, D a constant).

## What is checked, and what is not

|                                                                                                         | Checked by                                                                                   |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The flow behaves like the reducer, after every action of 80 random sessions plus directed scripts       | `test/lockstep.test.ts` (at least 8,000 events per pixel size, two sizes)                    |
| The hardware target behaves like the reducer (five configurations), every write within its width        | `test/hardware.test.ts`                                                                      |
| The gates hold what the flow holds in every register after every event (four configurations)            | `test/gates-editor.test.ts`: random sessions, every event in any order, the scripts, RefSim  |
| The synthesizer on hand-written programs and on 1,000 random ones that use every construct              | `test/gates-programs.test.ts`, `gates-random`, `gates-structure`                             |
| A reaction per event (the cone, then the commits) computes what a clock tick does                       | `test/gates-reactions.test.ts`                                                               |
| The sessions and scripts reach every tool control, align inside a parent above slot 1, every edge clamp | `test/coverage.test.ts`                                                                      |
| Injected bugs (wrong tie-break, off-by-one hit test, missing delete shift…) are caught                  | run by hand; each bug a run found missed, or caught only by one lucky seed, has its own test |
| The Figma `Action` objects behave like the flow, with the same action counts                            | `test/compile.test.ts` (silicon's emulator rejects malformed shapes)                         |
| The plugin builds the page, and the reactions it stores draw, move, recolor and delete a layer          | `test/deploy.test.ts` (silicon's fake Plugin API)                                            |
| The gate chart drawn in Figma, and Figma running its reactions                                          | **not built yet**: phase 2                                                                   |
| Number variables bound to size, padding and spacing update live in Present                              | **not checked**: spike R1, R2                                                                |
| A held-button drag fires across hotspots                                                                | **not checked**: spike I1                                                                    |
| Key chords fire                                                                                         | **not checked**: spike I2                                                                    |
| A file with 78k stored actions loads and edits at a usable speed                                        | **not checked**: spike "Editor"                                                              |

## Not done yet at gate level

- **Drawing the chart.** The Library is ready for silicon's drawer (a module per unit, ports named
  after the values they carry), but nothing has drawn it in Figma.
- **The reactions as Figma actions.** The cost model exists; emitting each event's cone and
  commits as `SET_VARIABLE` actions does not. 30 of the 107 event codes need more than the 500
  actions silicon measured the viewer survives (it dies at 2,001): the aligns, the pointer press
  and drag, Cut, Copy, Paste, Duplicate, `[` and `]`, Delete, the arrows, three of the four
  handles and the x, y, w, h steppers. They need splitting over several reactions, or cheaper
  logic (`U_parent` is the first candidate). Keeping each slot's area in a 19-bit register, so
  align reads it instead of multiplying, was measured and left out: the aligns drop to 5,600 to
  5,820 actions, but the drag (`pointer#enter`) grows from 2,174 to 3,259, the w and h steppers
  from 567 to 1,688, Delete, Duplicate, Cut and `]` by 530 to 850 each, the registers by 171 bits;
  the gates fall only from 24,893 to 24,522, and no more codes fit in 500 actions.
- **The screen.** View variables (fill flags, rendered radius, row flags) are not synthesized;
  the display decode that computes them from the registers is phase 2.
- **Limits of the hardware.** It is exact while ids stay below 256 and every box within cells
  -2,048 … 2,047; the tests reject any session that leaves them. The reducer has no such limits.

## Try the word-level spike in Figma desktop (nothing here has run in real Figma yet)

1. New **Design** file. **Plugins → Development → Import plugin from manifest…** → `osflow/spike/manifest.json`.
2. **Plugins → Development → OS Flow Spike → Tests · render only.** Then ▶ Present and open each flow
   from the flow list. Do `OS · R1 · Size`, `R2 · Position`, `R3 · Fill` in that order.
3. Same for **Tests · input only** (`I1 · Pointer`, `I2 · Keys`).
4. **Editor · build the real compiled OS.** It makes 320 variables and about 540 reactions on a page
   at y = 2000. ▶ Present the flow `OS · Editor`: pick Rectangle, drag on the dark canvas.

If a flow crashes the viewer, reopen Present and pick the next one. Report back:

| Test   | What to look at                                                                                                                     | Why it matters                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| R1     | Does the box resize, round and fade live? Is opacity 50 half-faded (0–100 scale) or solid (0–1)? Does radius 9999 look fully round? | Layers are drawn by width/height/radius bound to variables. If these do not update live, drawing needs another route.         |
| R2     | Does padding move box A? What happens below zero? Does negative spacing push box B left of its edge?                                | `x` and `y` cannot be bound, so position is padding or spacing. Layers off the top-left of the window need a negative offset. |
| R3     | Does "next color" step through all 16 colors?                                                                                       | Fill is 16 stacked shapes shown by flags.                                                                                     |
| I1     | Press, drag over cells, release. `enters while held` should count; `up x` should be the release cell; does the orange box follow?   | Dragging a layer is MOUSE_DOWN, then MOUSE_ENTER on each hotspot, then MOUSE_UP.                                              |
| I2     | Which lamps light: Shift+S, Cmd+C, Delete, `[`?                                                                                     | Tool shortcuts and clipboard keys.                                                                                            |
| Editor | Did it build with 0 errors, and how long did it take? Does the drag draw a box that follows the pointer?                            | The real thing.                                                                                                               |

## The word-level numbers (`npm run stats`)

320 variables, 541 events, 77,846 stored actions. The costliest event is Cut at **270** executed
actions, then Delete at 251; a pointer press is at most 64 and a hover over a cell at most 37.
Silicon measured that the viewer survives 501 actions per event and dies at 2,001, so nothing
needs chunking. Stored size is the cost to watch: each of the 140 hotspots carries its own copy
of its down, enter and up handler, because a prototype has no functions.

## How the editor became variables

- **Layers are 8 fixed slots** `L0…L7`, each a record of variables; slot order is z-order, and `g/n`
  counts the ones in use. Delete shifts the slots above it down; reorder swaps two.
- **No `array[i]`, so "the selected layer" is a decision tree** over `g/sel` (3 conditionals for 8
  slots). `ir.ts` `switchOn` builds it. A handler loads the selected slot into a scratch record,
  computes on it and writes it back, so the gates hold one copy of the arithmetic, not eight.
- **No functions, so each hotspot has its own handler** with its window cell folded in as a literal.
  The hardware target has one handler per pointer event instead, reading the cell from inputs.
- **Geometry is in px** (cells × `K`, default 40), so a node's width and padding bind to it directly.
  The hardware target is in cells.
- **The canvas is unbounded** (±512 cells); the screen shows a 14 × 10 window. `v/x`, `v/y` are the
  window's corner, as pan is view state in `os-ui` too.
- **Drawing costs no actions.** Handlers keep the screen's variables current where they change:
  slot `vis`, `used` and `sel` flags, 16 `f/k` fill flags per slot, and `rr` (rendered radius).
- **Figma has no min, max, floor or modulo**, so `clamp` is two conditionals, and floor-halving
  (for `align` center) peels the bits of the cell count. In gates it is a shift.

## Not in the flow yet

Pen, Paint, Erase, Text and Comment (they need a paint grid and typed text; the tools exist and a
press on the canvas does nothing), rotation, handle drags under the Scale tool (needs rounding),
panning (the `v/x`, `v/y` variables are there, no event moves them), load, image import, rename,
and the layer names and Properties numbers as text. `eventsFor` in `src/codec.ts` refuses these,
so the tests never claim coverage of them.

## Relation to `engine/`

`engine/` is an earlier gate-level version of the same editor, written by hand against an older
`os-ui`. `osflow/` compiles its gates from the flow instead, so they follow the reducer.

|                             | `engine/`                                                                                                      | `osflow/` gates (`src/gates/`)                                        | `osflow/` word level (`src/compile.ts`)               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| Drawn as                    | a netlist of 2-input gates                                                                                     | a netlist of 2-input gates, a module per unit (not drawn yet)         | handlers of `set` and `if`                            |
| Size                        | 5,110 gates                                                                                                    | 24,893 gates; 13,213 without style, clipboard and align               | 320 variables, 77,846 stored actions                  |
| Executed actions per event  | 20 to 1,608 (a press is about 1,466)                                                                           | 4 to 9,984 as one reaction per event (a press is 3,880)               | at most 270 (a press is at most 64)                   |
| Follows the current `os-ui` | no: 4-bit coordinates; `node engine/run.mjs fuzz.ts 1 6 60` reports mismatches where a layer is nudged below 0 | yes: checked against the flow, which is checked against the reducer   | yes: unbounded canvas, parent-relative align          |
| Layers, tools               | 14 events; no text, paint, align or typed properties                                                           | 124 events: the word level's, with the canvas as three pointer events | 541 events; no text, paint, rotation or Scale handles |

## Keeping up with os-ui

`os-ui` was changing while this was written (its canvas became unbounded mid-session). The lockstep
suites are the alarm: when the reducer's behaviour moves, the first failing run prints the actions
that expose it, and `src/editor.ts` is where to follow it. The gates follow by themselves: they are
synthesized from the flow on every run.
