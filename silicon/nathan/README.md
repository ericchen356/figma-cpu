# CPU NATHAN — the Figma OS editor as a gate-level machine, run by Figma

CPU NATHAN is a purpose-built CPU drawn in Figma: 4,820 logic gates in 47 modules. Its job is
to _be_ the Figma OS editor (`os-ui`):

- tools, by click or by shortcut key;
- click-click drawing, moving and resizing;
- colours, rectangles, ellipses and frames;
- the layers panel with show/hide;
- duplicate, delete, bring forward / send backward, and nudge.

In ▶ Present mode Figma's own prototype engine runs it, with no plugin and no code:

- every wire is a variable;
- every gate's lamp is a layer whose visibility is bound to its output;
- every click or key runs a stored reaction that evaluates the gates, in one event.

**The built file:** [CPU NATHAN](https://www.figma.com/design/443xQZpIzkilGbJVt0UyXJ/CPU-NATHAN)
(Drafts). Open it and press ▶; the flow is "CPU NATHAN".

## What you see in Present

| Frame                                          | What it is                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NATHAN · Figma OS** (opens first)            | The editor. Toolbar (V F R O), a 14 × 10-cell canvas, the layers panel, fill colours, Arrange buttons, and shortcuts (D, Delete/Backspace, `[` `]`, arrows, Esc).                                                       |
| **NATHAN · the machine** ("see the machine ▸") | All 4,820 gates on one screen, one lamp each, grouped by module (EVDEC, CONDS, HIT8, READPLANE, GEOM, the 8 LAYER records, STATE, DISPLAY…). Every click lights the gates it computes; the shortcut keys work here too. |
| **NATHAN · the circuit** ("the circuit ▸")     | The full drawing, every gate and wire, live, in a scrolling window. One button per module scrolls the window to it.                                                                                                     |

## Build it yourself

1. Figma desktop → **Plugins → Development → Import plugin from manifest…** → pick
   `silicon/nathan/plugin/manifest.json`.
2. In any design file: **Plugins → Development → CPU NATHAN**.
3. Press, in order:
   1. **Build hardware**: draws the gates on the page "CPU NATHAN", about 40 s.
   2. **Build the OS**: variables, lamps, reactions and the three frames, about 5 min.
   3. **Self-test**: should end with ✓.
4. Close the plugin and press ▶.

The plugin is only the builder: it draws the machine and stores its reactions. Nothing it does runs
when you use the file.

`plugin/dist/` is already built. After changing the source, run this from `silicon/`:
`npm install && node nathan/plugin/build.mjs`.

### Settings

- **max actions / event** (default 700). The viewer runs a reaction's actions recursively, about
  three stack frames each. On a cold page, 1,200 that ran in one event overflowed its stack and left
  the prototype dead to clicks until a reload. Actions behind an `if` that is false cost nothing:
  a 30,000-action reaction with all but two skipped ran fine.

  At 700 every control is one event (the longest, a click on canvas row 3, is 694). With a smaller
  budget, a longer reaction is cut between its top-level actions:
  1. the click or key runs the first part, then opens an invisible 1×1 overlay;
  2. the overlay's timer (1 ms) runs the next part on a fresh stack;
  3. it swaps in the next overlay, or closes.

  Only logic goes in the early events. Every register write and screen line is in the last one,
  so between two events nothing is half written. That needs those writes to fit one event: with the
  default settings, a budget of 352 or more (a drawing click's writes are 351 actions). Below that,
  Build the OS cuts those reactions anywhere and logs an error. The overlays are the frames named
  "NATHAN · then …"; while one is open the viewer ignores clicks.

- **latches**:
  - `auto` (default): every latch gate is evaluated where the reaction fits the budget, `Q = D`
    otherwise (59 and 51 of the 110 reactions).
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
                  └──► state (sel hassel tool cur drag r1 r2)
plane (READPLANE) reads one record · geom (MOVE SPAN NUDGE) computes the new rectangle · disp: 79 gates
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
  - The only display gates are those inverters, the round/square choice of each layer, and the 4
    lines that pick the click layer: 79 gates, down from 428 with one-hot decoders.
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
  - **Canvas clicks.** Four click layers cover the canvas, and the `hot` lines show the one that
    matches the machine's state (select / draw / drop / opposite corner). Each is 10 row strips with
    their own reaction, PY built in, which folds half the hit test away. Hovering a cell stores its
    column; the click copies it into the machine's PX.
  - **Duplicate, Bring forward, Send backward** have one reaction per selected slot: 8 stacked
    buttons, and 8 stacked layers for their keys D `]` `[`, picked by the selection register's bits
    like the selection outline. Only a layer that shows takes a click or a key, so the one for the
    slot runs. With the slot known, the 8-way read of the selected record and the reorder muxes
    fold away: Duplicate 875 → 515 actions, Bring forward 873 → 388.

## Numbers

|                             |                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------ |
| gates / modules             | 4,820 / 47 (display: 79)                                                             |
| variables                   | 4,843 (4,837 wires + 6 for the pointer column and the warm-up)                       |
| bound layers                | 14,026: 8,231 lamps on the drawing, 4,820 on the gate map, 947 on the editor screen, 28 on the D `[` `]` key layers of the other two frames |
| reactions                   | 110: 40 canvas rows, 46 controls, 24 per-slot; every one a single event, at most 694 |
| build time in Figma desktop | hardware ~40–55 s, OS ~5 min                                                         |

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

**In Node** (`npx vitest run nathan/test`, from `silicon/`):

- the machine matches the editor spec on 40 random sessions of 120 events, comparing every register,
  screen line and the drawn picture;
- every reaction matches the full gate-level tick on up to 140 sampled states where its control
  shows, in all four latch modes;
- the plugin runs end to end against a fake of the Figma API, at budget 700 (one event each) and
  at 400 with identity gates kept (chains of overlays).

## Limits

- The canvas is a fixed 14 × 10-cell, 8-layer subset of the editor (`src/model/reference.ts`).
  os-ui's live model has since moved to an unbounded canvas.
- A gate keeps its last lamp colour when a reaction does not evaluate it: folded to a constant
  (mostly the event decoder), turned into a wire, merged with an identical gate, or in the logic of a
  register that does not load this event. Everything that computes lights up.
- Synthetic scroll events didn't scroll the circuit window; the module buttons do. A trackpad
  should also work, but that wasn't tested.

## Folder

|                  |                                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| `src/hw`         | the machine: units (HIT8, MOVE, SPAN, NUDGE), registers, ENGINE         |
| `src/model`      | the frozen editor spec, the oracle, the screen contract                 |
| `src/react`      | reaction synthesis, the catalogue of controls, click staging            |
| `src/ui`         | the editor screen as data (`spec.ts`), the gate map, a generic renderer |
| `src/platform`   | the platform tests (13 small prototypes for checking a viewer)          |
| `plugin/`        | the builder plugin (panel, build, self-test)                            |
| `test/`          | hardware fuzz, reaction equivalence, plugin end to end                  |
| `lab/word-level` | an earlier word-level CPU experiment                                    |
