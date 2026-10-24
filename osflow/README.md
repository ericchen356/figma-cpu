# osflow: the Figma OS as a flow that Figma itself runs

`os-ui/` is the Figma OS editor as a TypeScript reducer. `osflow/` rewrites it as **variables
plus prototype actions**, the same kind of deployment as `silicon/`: after one build, ▶ Present
runs the whole editor with no plugin code at run time. Click a tool, drag on the canvas, and
Figma's own engine updates the layers.

```
os-ui/src/model.ts   the reducer (source of truth for behaviour)
        │  hand-ported, checked by test/lockstep.test.ts
        ▼
src/editor.ts        the flow: variables + one handler per UI event (src/ir.ts is its language)
        │  src/compile.ts, checked against silicon's strict emulator
        ▼
Figma Action[]       SET_VARIABLE + CONDITIONAL, stored as reactions on hotspot frames
        │  spike/ builds the page          ← the part only Figma can check
        ▼
▶ Present            variables change; nodes bound to them move, resize and show
```

## Run it

```sh
cd osflow
npm install
npm test            # lockstep with os-ui, compile vs the emulator, deploy onto a fake Figma
npm run stats       # variables, events, actions stored and executed per event
npm run spike       # bundles the Figma plugin → spike/dist/code.js
```

## Try it in Figma desktop (nothing here has run in real Figma yet)

1. New **Design** file. **Plugins → Development → Import plugin from manifest…** → `osflow/spike/manifest.json`.
2. **Plugins → Development → OS Flow Spike → Tests · render only.** Then ▶ Present and open each flow
   from the flow list. Do `OS · R1 · Size`, `R2 · Position`, `R3 · Fill` in that order.
3. Same for **Tests · input only** (`I1 · Pointer`, `I2 · Keys`).
4. **Editor · build the real compiled OS.** It makes 321 variables and about 540 reactions on a page
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

## What is checked, and what is not

|                                                                                                   | Checked by                                                           |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| The flow behaves like the reducer, after every action of 80 random sessions plus directed scripts | `test/lockstep.test.ts` (at least 8,000 events per pixel size, two sizes)        |
| 13 deliberately injected bugs (wrong tie-break, off-by-one hit test, missing delete shift…) are each caught | run by hand during development; not a committed test |
| The Figma `Action` objects behave like the flow, with the same action counts                      | `test/compile.test.ts` (silicon's emulator rejects malformed shapes) |
| The plugin builds the page, and the reactions it stores draw, move, recolor and delete a layer    | `test/deploy.test.ts` (silicon's fake Plugin API)                    |
| Number variables bound to size, padding and spacing update live in Present                        | **not checked**: spike R1, R2                                        |
| A held-button drag fires across hotspots                                                          | **not checked**: spike I1                                            |
| Key chords fire                                                                                   | **not checked**: spike I2                                            |
| A file with 94k stored actions loads and edits at a usable speed                                  | **not checked**: spike "Editor"                                      |

## The numbers (`npm run stats`)

321 variables, 541 events, 94,342 stored actions. The costliest event is Cut at **264** executed
actions, then Delete at 244; a pointer press is at most 65 and a hover over a cell at most 27.
Silicon measured that the viewer survives 501 actions per event and dies at 2,001, so nothing
needs chunking. Stored size is the cost to watch: each of the 140 hotspots carries its own copy
of its down, enter and up handler, because a prototype has no functions.

## How the editor became variables

- **Layers are 8 fixed slots** `L0…L7`, each a record of variables; slot order is z-order, and `g/n`
  counts the ones in use. Delete shifts the slots above it down; reorder swaps two.
- **No `array[i]`, so "the selected layer" is a decision tree** over `g/sel` (3 conditionals for 8
  slots). `ir.ts` `switchOn` builds it.
- **No functions, so each hotspot has its own handler** with its window cell folded in as a literal.
- **Geometry is in px** (cells × `K`, default 40), so a node's width and padding bind to it directly.
- **The canvas is unbounded** (±512 cells); the screen shows a 14 × 10 window. `v/x`, `v/y` are the
  window's corner, as pan is view state in `os-ui` too.
- **Drawing costs no actions.** Handlers keep the screen's variables current where they change:
  slot `vis`, `used` and `sel` flags, 16 `f/k` fill flags per slot, and `rr` (rendered radius).
- **Figma has no min, max, floor or modulo**, so `clamp` is two conditionals, and floor-halving
  (for `align` center) peels the bits of the cell count.

## Not in the flow yet

Pen, Paint, Erase, Text and Comment (they need a paint grid and typed text; the tools exist and a
press on the canvas does nothing), rotation, handle drags under the Scale tool (needs rounding),
panning (the `v/x`, `v/y` variables are there, no event moves them), load, image import, rename,
and the layer names and Properties numbers as text. `eventsFor` in `src/codec.ts` refuses these,
so the tests never claim coverage of them.

## Relation to `engine/`

`engine/` is the gate-level version of the same editor (5,110 gates, one tick per event). `osflow/`
is the word-level version: variables and conditionals, no gate chart. They answer the same Figma
questions, so one spike run settles both.

| | `engine/` (gates) | `osflow/` (word-level) |
|---|---|---|
| Drawn as | a netlist of 2-input gates | handlers of `set` and `if`; no gate chart yet |
| Executed actions per event | 20 to 1,608 (a press is about 1,466) | at most 264 (a press is at most 65) |
| Follows the current `os-ui` | no: 4-bit coordinates; `node engine/run.mjs fuzz.ts 1 6 60` reports mismatches where a layer is nudged below 0 | yes: unbounded canvas, parent-relative align |
| Layers, tools | 14 events; no text, paint, align or typed properties | 541 events; no text, paint, rotation or Scale handles |

## Keeping up with os-ui

`os-ui` was changing while this was written (its canvas became unbounded mid-session). The lockstep
suite is the alarm: when the reducer's behaviour moves, the first failing run prints the actions
that expose it, and `src/editor.ts` is where to follow it.
