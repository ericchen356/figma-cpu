# Figma CPU Live Link

The gate-level CPU running in Figma Present (FINAL CPU, `L4EvJzAkufSEbavPliVPcf`, the OS's CPU tab)
drives the Silicon CPU Lab in Figma Make (`PEjJitQWqkkPAIrLqMq8bH`) live, on another laptop.

```
FINAL CPU in Present ──▶ Chrome extension ──▶ Supabase Realtime ──▶ Make app (cpu-link.js)
  (pure Figma)          reads tick/phase/program   channel "figma-cpu"     steps its own engine to match
```

Both run silicon's same 2,298-wire netlist with LDR/STR (every wire name matches), so only the clock
travels: `{program, tick, phase, running}`. The Make app reloads the program's power-on wires when the
program changes or Figma's clock goes back (Reset), then steps its engine to Figma's tick and phase.
At every whole tick all 2,298 wires equal silicon's FastSim (tested for mul, ptrout and fib).

## How the extension reads Figma

Figma Present has no network actions, and plugins can't see a running prototype. But with
**Options → Advanced settings → Accessibility settings → "Adapt content for screen readers"** on, the
viewer mirrors every shown text layer into the page, and text bound to a variable updates live.
`content.js` reads:

- `<n> ticks` and `<p> phase (of 10)` from the CPU tab's bar (exact);
- `Running · chunk k of 10` while Run plays (only the overlay is mirrored then), counting a tick on
  each wrap and correcting when the counters come back;
- the loaded program: the blue button, picked from a screenshot of the tab at the buttons' positions.

## Your laptop (Figma side)

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder's `extension/`.
2. Open FINAL CPU in Present in Chrome and click the rail's **CPU** tab. Keep that tab in front
   (the program colour is read from a screenshot of the visible tab).
3. The extension's popup shows Supabase `live`, the program and tick. Step / Run / Reset / programs
   all stream.

## His laptop (Make side)

Add `make/dist/cpu-link.js` to the Make project as `cpu-link.js` (next to `viewer.js`), and append
these two lines to the end of `viewer.js`:

```js
import { connectCpuLink } from "./cpu-link.js";
connectCpuLink(window.siliconCAD);
```

A badge at the bottom left says "LIVE FROM FIGMA · program · tick". The lab's own clock pauses while
Figma drives it. Use `?channel=name` on the Make URL (and the same channel in the popup) to run
separate sessions.

## The Figma OS link (what you do in the OS, gate by gate)

The OS in FINAL CPU runs on its own gate chip (os-ui's editor, 12,748 wires stored as variables).
The extension also sends every pointer and key input on the OS frame, in frame coordinates
(`os` messages; keys only when the prototype took them). `make/os-emu.js` replays Figma's prototype
viewer on an export of the frame (`make/public/data/os-*.txt`, 4.8 MB, from 88 MB of reactions), so
the Make app runs the same reactions on the same variables and draws the chip's wires as they switch
(`make/os-link.js`, panel "FIGMA OS CHIP").

- Hit test as the viewer does it: press beats click, only shown layers take input, keys go to the
  deepest shown layer, timed overlay chains; auto layout is reflowed from live visibility, and the
  resize handles follow their slot's spacer bits.
- Checked: 3 random sessions (500 + 400 + 400 actions, clicks at layer centres, drags, handles, menus,
  keys) match silicon's simulator of the OS chip on all 2,075 watched wires after every action.
  The draw units (Pencil/Pen, Text, Comments) are not in that chip, so those sessions leave them out;
  the emulator runs them from the file like everything else.
- Live in Chrome: drawing, resizing, duplicating, a fill swatch and moves gave the same layers,
  positions, sizes and fill as Figma. One long synthetic drag moved one row less in Figma than its
  recorded coordinates say; three controlled drags matched. The panel reads Figma's own Design panel
  (via the mirror) and says "in step" or what differs; press R in Present to start both over.
- Joining late: the panel asks for the Figma tab's input log and replays it.

Rebuild the data: in a figma.com editor tab of FINAL CPU load `tools/export-os.js`
(`osExport.run({withMeta: true})`, `osExport.send(...)` to `tools/receive.mjs`), the handle and layout
snippets, then `node tools/build-data.mjs data/os-export-meta.json data/handles.json data/layout.json`.

## His Make app, all of it

Add to the Make project: `make/dist/cpu-link.js` → `cpu-link.js`, `make/dist/os-link.js` →
`os-link.js` (next to `viewer.js`), and `make/public/data/os-0.txt … os-6.txt` + `os-index.json` →
`public/data/`. Then at the end of `viewer.js`:

```js
import {connectCpuLink} from './cpu-link.js';
import {connectOsLink} from './os-link.js';
connectCpuLink(window.siliconCAD);
connectOsLink();
```

## Files

- `extension/`: MV3 extension (`content.js` reader, `background.js` Supabase connection, popup).
- `make/cpu-link.js`: the listener (`createFollower` is the DOM-free part); `make/realtime.js`:
  dependency-free Supabase Realtime broadcast client (same as the extension's); `make/programs.js`:
  every program's power-on wire values by variable name, generated by `tools/gen-programs.ts`.
- `make/dist/cpu-link.js`: the three bundled into one file for Make
  (`npx --prefix ../silicon esbuild make/cpu-link.js --bundle --format=esm --outfile=make/dist/cpu-link.js`).

Supabase: project `tyewtrrwvzvginqoqwxs`, anon (public) key only; Realtime broadcast needs no tables.
Free-tier projects pause after a week without use; restore them from the dashboard.
