# Figma OS — design

A tiny Figma Design clone that is the whole operating system: it boots straight into the editor, and there is nothing else. It should look and behave like the real Figma Design editor, scaled down. This document is the product design only. CPU limits and memory sizes come later.

## 0a. What "the OS" is

The OS is two things together:

- **The screen:** everything the user sees and clicks (the editor UI, §1–§2b, §7).
- **The operating system software:** the program on the CPU that owns the document, handles input, decides what each click means and redraws the screen (§3–§6). It is the kernel and the app in one.

The design below covers both, and neither works without the other.

## 0. Two levels of design

1. **Full-resolution mock, in Figma Design.** The real-looking editor drawn as frames on the `FigmaOS` page, reusing the `OS Components` kit (buttons, cursor, app icon, layer row, toggle, label). This is the visual target for the demo and pitch. It needs no CPU.
2. **The running OS at 128×96.** The same layout shrunk onto the tile grid in §1. Panels become colored blocks plus 8×8 glyph labels. It keeps Figma's layout and colors, not its detail.

## 1. Screen (the Figma layout, in tiles)

128×96 pixels, drawn as a 16×12 grid of 8×8 tiles. Every UI element snaps to the tile grid, so the screen is a table of 192 tile numbers, not pixels.

```
col   0  1  2  3 | 4  5  6  7  8  9  10 11 | 12 13 14 15
row 0 [ file name        ·  ·  ·  ·  ·  ·   ·   Share  ]  top bar
    1 [ Pages     ][ canvas (dark 1E1E1E)  ][ Design    ]
    2 [ ▸ Page 1  ][                        ][ X  Y      ]
    3 [ Layers    ][       ┌────┐           ][ W  H      ]
    4 [ ▣ Frame   ][       │ ▭  │           ][ Fill  ■   ]
    5 [  ▭ Rect 1 ][       └────┘           ][ Stroke    ]
    6 [  ▭ Rect 2 ][                        ][           ]
    7 [           ][                        ][           ]
    8 [           ][                        ][           ]
    9 [           ][                        ][           ]
   10 [           ][                        ][           ]
   11 [ ·  ·  ·  · ][ V  F  R  O  T  H  ·  · ][ zoom 63% ]  bottom toolbar
```

- **Row 0, top bar.** The file name on the left and a Share button on the right.
- **Columns 0–3, left sidebar.** Pages list on top, Layers tree below with the selected row highlighted.
- **Columns 4–11, canvas.** Dark `1E1E1E` background. Layers are drawn here, with a blue selection box when one is selected.
- **Columns 12–15, Properties panel.** A Design tab, X, Y, W and H, and the Fill color of the selection.
- **Row 11, bottom toolbar.** The tool icons, centered under the canvas, with the active tool highlighted blue. The zoom percentage sits at the right.

## 2. Tools (Figma Design's real set)

| Tool      | Key | Real Figma behavior         | In the OS                                         |
| --------- | --- | --------------------------- | ------------------------------------------------- |
| Move      | V   | select, drag, resize layers | v1: click to select, click a cell to move         |
| Frame     | F   | create a frame (artboard)   | v1: drag two cells to make a frame                |
| Rectangle | R   | draw a rectangle            | v1: click two cells                               |
| Ellipse   | O   | draw an ellipse             | v1: same as rect, drawn with rounded corner tiles |
| Text      | T   | add a text layer            | v1: one line of 8×8 glyphs                        |
| Hand      | H   | pan the canvas              | v1: none, the canvas is fixed                     |
| Scale     | K   | proportional scale          | later                                             |
| Line      | L   | draw a line                 | later                                             |
| Pen       | P   | vector paths                | later                                             |
| Comment   | C   | comments                    | later                                             |
| Zoom      | Z   | zoom                        | later                                             |

The first release has Move, Frame, Rectangle, Ellipse and Text. Delete is the Delete key, and recoloring is done in the Properties panel's Fill swatches, as in real Figma.

## 2b. What must look like Figma (v1 bar)

1. A Layers panel with the selected row highlighted.
2. A blue selection box (`0D99FF`-style) with corner handles.
3. A Properties panel showing X, Y, W, H and a Fill swatch for the selection.
4. A bottom toolbar with the active tool highlighted.
5. The dark canvas and dark panels of Figma's dark theme.

## 3. Document model

- A document is up to **8 layers**. Each layer is a rect: `x, y, w, h` in cells (4 bits each), a color (16 colors) and a visible flag.
- Layer order is the array order. Later layers draw on top, and "Arrange" swaps neighbours.
- One **selection** (a layer id or none) and one **current color**.
- Nothing else: no groups, no components, no auto layout, no undo in v1.

## 4. Menus

Real Figma keeps these in the main menu. The OS has one menu, opened by clicking the file name in the top bar, as a 1-column list of 8×8 glyph rows over the canvas:

- **New:** clears all layers.
- **Duplicate** and **Delete** act on the selection.
- **Bring forward** and **Send backward** change the layer order (also draggable in the Layers panel later).
- **Save** and **Open:** the network bridge, optional in v1.

## 5. Input

- **Pointer:** the hovered or clicked **tile** (column, row), plus button down or up. There is no sub-tile precision.
- **Keys:** one key code per press (tool shortcuts above, digits and letters for color and text).
- Everything the user can do must be possible with the pointer alone. Keys are shortcuts.

## 6. Main loop

1. Read the input (tile, button, key).
2. Decide the action: toolbar click, menu click, canvas click or key.
3. Update the document (and the selection).
4. Redraw: clear the canvas tiles, draw each visible layer in order, draw the selection outline, redraw the status bar.

Redraw only touches the tiles that changed (the dirty cells), so a normal click changes only a handful of tiles.

## 7. Look

- **Palette:** PICO-8, 16 colors, from `spec/palette.json`. Colors 0 and 7 (black, white) are UI chrome. The color picker shows the other 14 plus those two.
- **Chrome:** Figma's dark theme in 16 colors: dark grey panels and `1E1E1E`-style canvas, light grey text, blue accent. The pitch mock in Figma uses the real colors.
- **Selection:** a 1-cell outline in bright blue with corner handles, drawn over the layer.
- **Glyphs:** an 8×8 bitmap font for A–Z, 0–9 and a few symbols. Tool icons are also 8×8 tiles.
- **Tile set:** every distinct 8×8 picture used above is one tile in a shared set (solid colors, glyphs, icons, outline edges). Build the set once, then reuse it.

## 8. Demo flow

1. Boot: the dark editor, an empty canvas, the Layers panel empty, Properties blank.
2. Press R, click two cells: a rectangle appears and a `Rect 1` row appears in Layers.
3. Press V, click the rect: the blue selection box shows and Properties fills in X, Y, W, H and Fill.
4. Click a Fill swatch in Properties: the rect recolors.
5. Click a canvas cell: the rect moves there.
6. Make two more rects overlapping, then Send backward from the menu, and the stacking order and the Layers rows change.
7. Menu → Save (if the network bridge is on), then New, then Open: the design returns.

## 9. Out of scope (v1)

Pan and zoom, multiple pages, vectors and the Pen tool, strokes, text beyond one line, auto layout, components, undo, multi-select, the Prototype tab, multiplayer.

## 10. Working rules for Figma MCP calls

Use the Figma MCP sparingly. Each call costs plan quota and time, and the stage log already records one run blocked by the MCP plan limit.

- **Batch.** Build a whole panel or screen in one `use_figma` call, not one call per shape. Stay under the per-call size limit (about 50k characters).
- **Prefer scripts for repeats.** Generate repeated things (tile set, layer rows, glyphs) in a single script, or with a dev plugin run from the repo, not by many MCP calls.
- **Reuse.** Search the design system and the `OS Components` kit first, and instantiate components instead of redrawing them.
- **Read once.** Take one screenshot or metadata read per milestone to verify, not after every edit.
- **Design in the file, test in code.** Run logic tests in the headless simulator in `silicon/`. Use MCP only to draw, bind and check the Figma side.
- **One session per task.** Create a session once and reuse its ID for the whole task.

## 11. Budget profile (what fits in under 4,000 actions per event)

The reference app in `os-ui/` is cut down to fit a prototype CPU. Its numbers are design-time estimates in `os-ui/src/cost.ts`, tested against a 4,000-action budget per event (one handler plus a full redraw). The viewer was measured crashing around 500–2,000 actions per event, so an event above 2,000 has to be chunked; the current worst case is about 1,500.

| Limit | Value | Why |
|---|---|---|
| Canvas | 14×10 cells (the 8×8 tile grid) | A redraw costs one pass per cell, so cells set the redraw cost |
| Layers | 8 | A slot read or write is one conditional per slot, so cost scales with this |
| Fields per layer | 6 (x, y, w, h, fill, visible), each in cells | Every field fits in 4 bits |
| Tools | Move, Frame, Rectangle, Ellipse | Text needs a glyph font and per-character storage, and Hand has no job on a fixed canvas, so both are cut |
| Input | Pointer cell, plus a key | Matches the OS input design in §5 |

Estimated cost (actions): redraw ≈ 1,430 (140 cells × 9 for the layer check, 140 for the selection, 24 for the Layers panel, 5 for Properties). Handlers: tool 1, hit test 8, create 56, resize drag 32, reorder 84, duplicate 104. The worst event is duplicate at about 1,530.

Everything in the table is a constant in `os-ui/src/model.ts` and `cost.ts`. Change one and the tests re-check the budget.
