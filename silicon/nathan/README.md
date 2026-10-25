# CPU NATHAN — the Figma OS editor as a gate-level machine, run by Figma

CPU NATHAN is a purpose-built CPU drawn in Figma: 5,636 logic gates in 51 modules. Its job is
to _be_ the Figma OS editor (`os-ui`):

- tools, by click or by shortcut key;
- drawing, moving and resizing by dragging, as in Figma;
- colours, rectangles, ellipses and frames;
- the layers panel with show/hide;
- duplicate, delete, bring forward / send backward, and nudge;
- the Pen: freehand drawing on a 14 × 10-pixel bitmap held in the machine's own RAM, with Erase
  and Clear.

In ▶ Present mode Figma's own prototype engine runs it, with no plugin and no code:

- every wire is a variable;
- every gate's lamp is a layer whose visibility is bound to its output;
- every click or key runs a stored reaction that evaluates the gates, in one event.

**The built file:** [CPU NATHAN](https://www.figma.com/design/443xQZpIzkilGbJVt0UyXJ/CPU-NATHAN)
(Drafts). Open it and press ▶; the flow is "CPU NATHAN".

## What you see in Present

| Frame                                          | What it is                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NATHAN · Figma OS** (opens first)            | The editor, a 1440 × 810 screen laid out like Figma's UI3: the rail and Layers panel on the left, the canvas with its rulers and the floating toolbar (Move, Frame, Rectangle, Ellipse, Pen; Erase and Clear beside it), the Design panel on the right (the current fill, 16 colours, Arrange, nudge), and shortcuts (V F R O P, D, Delete/Backspace, `[` `]`, arrows, Esc, E, C). |
| **NATHAN · the machine** ("See gates")          | All 5,636 gates on one screen, one lamp each, grouped by module (EVDEC, CONDS, HIT8, READPLANE, GEOM, PEN, PAINT, the 8 LAYER records, STATE, DISPLAY…). Every click lights the gates it computes; the shortcut keys work here too. The editor's blue "See gates" button and the rail's Gates tab lead here. |
| **NATHAN · the circuit** ("the circuit ▸")     | The full drawing, every gate and wire, live, in a scrolling window. One button per module scrolls the window to it.                                                                                                     |

## Build it yourself

1. Figma desktop → **Plugins → Development → Import plugin from manifest…** → pick
   `silicon/nathan/plugin/manifest.json`.
2. In any design file: **Plugins → Development → CPU NATHAN**.
3. Press, in order:
   1. **Build hardware**: draws the gates on the page "CPU NATHAN", about 40 s.
   2. **Build the OS**: variables, lamps, reactions and the three frames: about 5 min before the
      press/release rebuild, which stores 1.8× the actions, so expect longer.
   3. **Self-test**: should end with ✓.
4. Close the plugin and press ▶.

On the canvas, as in Figma: drag a layer to move it, drag on empty canvas with Frame, Rectangle or
Ellipse to draw one (a click makes a one-cell shape), drag a selection handle to resize. The layer
lands where the button is let go (the viewer reports nothing in between, below).

To draw: press **P** (or the Pen button), press on the canvas to put the pen down, move the mouse
(every cell the pointer enters is inked), press again to lift the pen. While the button is held
the viewer reports no movement, so a drag inks only where it starts and where it is let go: draw
with the button up. **E** toggles Erase (the pen inks the background back), **C** clears the
bitmap. Any other tool, or Esc, leaves the pen.

The plugin is only the builder: it draws the machine and stores its reactions. Nothing it does runs
when you use the file.

`plugin/dist/` is already built. After changing the source, run this from `silicon/`:
`npm install && node nathan/plugin/build.mjs`.

### Settings

- **max actions / event** (default 700). The viewer runs a reaction's actions recursively, about
  three stack frames each. On a cold page, 1,200 that ran in one event overflowed its stack and left
  the prototype dead to clicks until a reload. Actions behind an `if` that is false cost nothing:
  a 30,000-action reaction with all but two skipped ran fine.

  At 700 every control is one event (the longest, a drop on canvas cell (7, 7), is 631).
  With a smaller budget, a longer reaction is cut between its top-level actions:
  1. the click or key runs the first part, then opens an invisible 1×1 overlay;
  2. the overlay's timer (1 ms) runs the next part on a fresh stack;
  3. it swaps in the next overlay, or closes.

  Only logic goes in the early events. Every register write and screen line is in the last one,
  so between two events nothing is half written. That needs those writes to fit one event: with the
  default settings, a budget of 356 or more (a drawing click's writes are 355 actions). Below that,
  Build the OS cuts those reactions anywhere and logs an error. The overlays are the frames named
  "NATHAN · then …"; while one is open the viewer ignores clicks.

- **latches**:
  - `auto` (default): every latch gate is evaluated where the reaction fits the budget, `Q = D`
    otherwise.
  - `every gate`, `compact` and `direct` are also available.
- **identity gates as wires** (on): `AND x 1`, `BUF` and similar gates become wires inside a
  reaction, two gates of the same kind on the same inputs become one, and the logic only one
  register reads is simplified inside that register's `if (load)`. Off: every gate is its own
  action.
- **redraw**: redraws all modules, needed after the hardware changes.

## How it works

```
EVT ─► evdec ──► conds ──► layerctl ──► l0 … l7   layer file: 8 × 24-bit records (used vis kind x0 x1 y0 y1 fill)
                  │  ▲  hit (HIT8: all 8 layers compared at once)
PX PY ────────────┤  └─ free (FREESLOT)            delete / reorder shift whole records
  │               ├──► state (sel hassel tool cur drag r1 r2)
  │               └──► pen (pendown erase) ──► paint: 14 × 10 one-bit RAM words, the bitmap
  └──────────────────────── word line PY, bit line PX ──┘
plane (READPLANE) reads one record · geom (MOVE SPAN NUDGE) computes the new rectangle · disp: 83 gates
```

- **One clock tick = one editor event.** Units are spatial, not microcoded. For example, HIT8 tests
  the pointer against all 8 layers in parallel, and NUDGE steps a rectangle and clamps it at the edge.
- **The screen is bound to register bits.**
  - A layer's rectangle is placed by binary-weighted spacer frames (1, 2, 4, 8 cells) bound to its
    x0/x1/y0/y1 bits. The y1 spacers give the box its height, the y0 spacers push the content down,
    the x1 spacers give the width and the x0 spacers push the body right. The auto layout does the
    subtraction.
  - A colour, a kind name or the selected outline is one leaf of a tree of frames, one level per bit:
    child 0 shows on the inverted bit, child 1 on the bit, so exactly one leaf is visible.
  - The only display gates are those inverters, the round/square choice of each layer, and the 6
    lines that pick the click layer: 83 gates, down from 428 with one-hot decoders.
  - The ink is 140 cell-sized rectangles above the layers, each bound to its pixel's RAM bit.
- **The reactions.** For each control, the plugin takes the same netlist and:
  1. ties the event's constants and folds them through the gates;
  2. turns identity gates into wires, and merges gates that compute the same thing;
  3. keeps only what can change a register this event. Logic that only one register's D reads moves
     inside that register's `if (load)`, where it runs only when the register loads and folds with
     its LOAD known to be 1;
  4. emits one pass: the logic in dependency order, then the register commit, then the screen lines
     whose registers changed.

  Conditionals are one level deep, and every condition is an expression, which is what Figma
  accepts: `EQUALS(load, true)`, or an `OR` of two such tests for a screen block that two loading
  registers feed.
  A master latch equals its slave between events, so its lamp is bound to Q.

- **Controls made for the state they show in.** A reaction is synthesized with everything its
  control implies held constant, so the gates that would only decide it fold away:
  - **Canvas presses and releases.** Six click layers cover the canvas, and the `hot` lines show
    the one that matches the machine's state (select / draw / drop / opposite corner / pen up / pen
    down). The canvas takes a mouse click apart: the press (MOUSE_DOWN) starts a gesture (pick up,
    first corner, the pen down or up), the release (MOUSE_UP) ends one (drop, opposite corner), so
    a drag is one move or one shape, and a plain click still works. The machine's events are the
    same CLICK as before, the first half and the second.
    The first-corner layer is 10 row strips with their own reaction, PY built in, which folds half
    the hit test away; hovering a cell stores its column, and the press copies it into the
    machine's PX. Every other layer has a reaction per cell, PX built in too (it copies nothing):
    the pick-up and the pen because the hit test folds to constants, the drop and the opposite
    corner because they are releases, and no hover fires while the button is held, so the column
    cannot come from one. Every cell stores its column on hover and on release (the pen-down cells
    before they paint): the layer showing changes under a pointer that has not moved, and the next
    press must find the column there.
  - **Duplicate, Bring forward, Send backward** have one reaction per selected slot: 8 stacked
    buttons, and 8 stacked layers for their keys D `]` `[`, picked by the selection register's bits
    like the selection outline. Only a layer that shows takes a click or a key, so the one for the
    slot runs. With the slot known, the 8-way read of the selected record and the reorder muxes
    fold away: Duplicate 875 → 515 actions, Bring forward 873 → 388.

## The Pen

Freehand drawing, computed by new hardware in the netlist (816 gates, 4,820 → 5,636), not by the
screen:

- **The paint plane is RAM.** 140 pixels, each a one-bit RAM word (`RAMW1`, `src/hw/cells.ts`): one
  latch, no slave, written in the LOW pass only, while its word line and bit line are both
  selected (silicon/docs/SILICON.md §2, rule 3: `EN = ¬CLK · WE · row`). 5 gates a pixel, against 8
  for a one-bit register. `PAINT` decodes PY into 10 word lines (gated by `PLOT · ¬CLK`) and PX
  into 14 bit lines, two address bits predecoded at a time; 10 `PAINTROW`s of 14 words. Clear
  raises every predecoded line, so every word is selected, with ink 0: 140 words in one event.
  The plane reads nothing and feeds only the screen, so it is independent of the layer stack.
- **The pen is two registers and a tool code.** The tool register is 3 bits (4 = Pen), so the
  toolbar highlight moves to the Pen button by the same spacers, and picking another tool or Esc
  leaves the pen. `PEN` holds `pendown` (a pen click flips it; any tool or Esc clears it) and
  `erase` (toggled), and makes `PLOT` (a pen click, or `PAINT` while the pen is down and nothing
  is pending) and the ink `DIN = PLOT · ¬erase`.
- **Events.** EVT is 5 bits: codes 0–15 are as before, 16 `PAINT` (the pointer entered cell PX,
  PY), 17 `ERASE`, 18 `CLEAR`. The pen's click is `CLICK` with the pen tool and nothing pending:
  it inks the cell and flips the pen (the hardware's DOWN then finds nothing to do).
- **Strokes are hovers.** The pen-up and pen-down click layers (`hot` lines 4 and 5, picked by
  the `pendown` bit) have a reaction per cell, PX and PY built in; a press on either is the pen's
  click. On the pen-down layer, entering a cell (MOUSE_ENTER) or letting the button go over it
  (MOUSE_UP) stores the pointer's column, then runs `paint/<row>/<col>`, made with the pen known
  to be down: every pixel but that one folds away, and what is left is that word's latch.

| control                       | reactions | actions (one event)                                  |
| ----------------------------- | --------- | ---------------------------------------------------- |
| a stroke cell (hover, release) | 140      | 15, every one (4 store the pointer's column)         |
| a pen press (down or up)      | 140       | 26, every one (shared by the pen-up and pen-down layers) |
| Pen tool (P)                  | 1         | 44 (the other tools 44–45: they now also lift the pen) |
| Erase (E)                     | 1         | 15                                                   |
| Clear (C)                     | 1         | 424 (140 × `if (men) Q = 0`, latches Q = D)          |

## Numbers

|                             |                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------ |
| gates / modules             | 5,636 / 51 (display: 83; the pen: PEN 26, PAINT 766)                                 |
| variables                   | 5,660 (5,654 wires + 6 for the pointer column and the warm-up)                       |
| bound layers                | 17,608: 10,541 lamps on the drawing, 5,636 on the gate map, 1,403 on the editor screen, 28 on the D `[` `]` key layers of the other two frames |
| reactions                   | 951: 710 on the canvas (140 pick-up cells, 10 first-corner rows, 140 drop cells, 140 opposite-corner cells, 140 pen presses, 140 strokes), 25 controls, 216 per-slot; 263,671 actions stored on the editor's layers; every one a single event, at most 631 |
| build time in Figma desktop | hardware ~40–55 s, OS ~5 min (measured before the pen and the press/release rebuild, which together store nearly twice the actions) |

## Verified, and where

**In Figma desktop** (computer use, file above):

- the self-test passes: 300 random user actions through the reactions stored in the file, with
  registers, screen lines and editor layers matching the spec (49 of them by shortcut key);
- in Present: tools by click and key (V F R O), drawing rectangles, ellipses and frames, recolouring,
  moving, resizing by a handle, selecting from the layers panel, show/hide, Duplicate (button and D),
  Delete (button and Backspace), Bring forward, nudge (arrow keys), the gate map lighting live, and
  the circuit's module buttons;
- after the per-row and per-slot rebuild, in Present: drawing by two clicks, picking a layer up and
  dropping it with the two clicks 0.3 s apart, D `[` `]` in the editor and D in the machine frame,
  the Duplicate button, recolouring, nudging and Backspace;
- platform tests 2, 12 and 13: a skipped branch costs no stack; a key on a layer inside the frame
  fires without hovering it, one layer per press; a hidden layer never takes a key.

**Measured by the CPU-team session** in Figma desktop:

- one event ran 1,700 actions on a warm viewer, but on a cold page 1,200 overflowed the stack and
  left the prototype dead to clicks until a reload, hence the 700-action events;
- a CONDITIONAL keeps only its first condition and an ELSE; extra blocks are silently dropped
  (CPU NATHAN uses single-block conditionals only);
- `setReactionsAsync` rejects a CONDITIONAL inside a CONDITIONAL and a `deprecatedVersion` key on
  MOUSE_ENTER;
- a keyCodes list is a chord (all keys held at once);
- a layer with mouse-down and mouse-up reactions doesn't also fire its click;
- spacers, click bubbling and visibility-switched click layers work.

**Measured in the browser's Present view** (test 14 "press, drag, release", scripted pointer
events, 2026-10-24), which is why the canvas takes presses and releases:

- no MOUSE_ENTER fires while the mouse button is held, on any layer, whether the press landed on
  the layer itself, on its parent, or on a layer with no reactions;
- MOUSE_DOWN fires on the layer under the press, MOUSE_UP on the layer under the release, also
  when the press made that layer visible (a press that shows another click layer, then a release
  over it);
- a parent takes a press and a release its children have no reaction for;
- `setReactionsAsync` rejects ON_DRAG with SET_VARIABLE actions;
- a frame taller than the view scrolls, and then every drag scrolls the whole screen instead of
  reaching the layers, even one that starts on a layer with a MOUSE_DOWN reaction. The editor is
  1440 × 810 (16:9), wider than a laptop's Present view, so it shows whole and nothing scrolls.

**In Node** (`npx vitest run nathan/test`, from `silicon/`):

- the machine matches the editor spec on 40 random sessions of 120 events (with pen sessions:
  strokes, pen clicks, Erase, Clear), comparing every register, every pixel, screen line and the
  drawn picture; a scripted pen session checks strokes, erasing, leaving the pen and Clear pixel
  by pixel;
- every reaction matches the full gate-level tick on up to 140 sampled states where its control
  shows, in all four latch modes;
- the plugin runs end to end against a fake of the Figma API, at budget 700 (one event each) and
  at 400 with identity gates kept (chains of overlays); its self-test drives the canvas as the
  viewer does (a press, the button held through a drag with no hovers, the release where it lands)
  and starts with a fixed pen session (P, a stroke by hovers, lift, Erase and an erasing stroke, a
  rectangle, Esc, Clear), checking every ink rectangle's binding after every action.

The press/release build has not been run in Figma desktop yet; the click-to-toggle pen of the
build before it inked cells in the browser's Present view.

## Limits

- The canvas is a fixed 14 × 10-cell, 8-layer subset of the editor (`src/model/reference.ts`).
  os-ui's live model has since moved to an unbounded canvas.
- The pen inks whole cells, in one colour (near-white, on the dark canvas). A stroke is the cells
  the viewer reports the pointer entering: a fast flick can skip a cell. Drawing with the button
  held is impossible (no hover fires while it is held), so the pen is pressed down and up.
- A dragged layer jumps to where the button is let go: the viewer reports nothing in between, so
  it cannot follow the pointer.
- A gate keeps its last lamp colour when a reaction does not evaluate it: folded to a constant
  (mostly the event decoder), turned into a wire, merged with an identical gate, or in the logic of a
  register that does not load this event. Everything that computes lights up.
- Synthetic scroll events didn't scroll the circuit window; the module buttons do. A trackpad
  should also work, but that wasn't tested.

## Folder

|                  |                                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| `src/hw`         | the machine: units (HIT8, MOVE, SPAN, NUDGE), registers, RAM, ENGINE    |
| `src/model`      | the frozen editor spec, the oracle, the screen contract                 |
| `src/react`      | reaction synthesis, the catalogue of controls, click staging            |
| `src/ui`         | the editor screen as data (`spec.ts`), the gate map, a generic renderer |
| `src/platform`   | the platform tests (13 small prototypes for checking a viewer)          |
| `plugin/`        | the builder plugin (panel, build, self-test)                            |
| `test/`          | hardware fuzz, reaction equivalence, plugin end to end                  |
| `lab/word-level` | an earlier word-level CPU experiment                                    |
