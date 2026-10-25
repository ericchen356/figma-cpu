# Leila's CPU in the Figma OS's CPU tab

An extension that puts silicon's 8-bit CPU (2,296 gates, Leila's LDR/STR pointers included) and its Live
dashboard into the live Figma OS frame (`os-ui · live (gate-level CPU)`). In Present, the rail's **CPU**
tab shows the dashboard over the canvas and the right panel: every lamp, arrow, microcode cell and
magnified gate is bound to one of the CPU's wires, and Figma's prototype engine computes them. Nothing
runs in a plugin at run time.

It adds to the file and rebuilds nothing. The OS chip, its variables and the other extensions' layers
are left alone.

## Use it

1. In Figma desktop, open the file with the live OS frame, and run **Figma OS · CPU + Learn**
   (`osui/extras`) first. This extension goes in that one's CPU tab, and reads its `tab/cpu` variable.
2. Plugins → Development → Import plugin from manifest… → `silicon/livetab/plugin/manifest.json`.
3. Run **Figma OS · Leila's CPU**, pick the program in RAM at power-on (default `ptrout`), and click
   **Add Leila's CPU**. It takes a minute or two (2,336 variables).
4. ▶ Present the live frame and open the **CPU** tab:
   - **Step** runs one chunk of a clock tick (10 chunks = one tick; the PHASE readout counts them).
   - **Run** plays the CPU in place until HALT. A "Running · chunk k of 10" bar with **Stop** appears
     at the bottom while it runs.
   - A program on the left (**mul**, **fib**, **ptrout**, **copy**, **dump**, …) loads it; **Reset**
     reloads the one that is loaded.
   - **OS chip ›** switches to the extension's OS-chip page; **‹ Leila's CPU** switches back.

Run **Add** again after re-running **Figma OS · CPU + Learn**: that one recreates `tab/cpu`, which this
binds to. **Remove** deletes everything this added (it keeps their ids in the document's shared plugin
data) and its `Leila CPU` variable collection.

From a figma.com editor tab, where the page's `figma` object is the Plugin API, load
`plugin/dist/page.js` and call `leilaCpu.add({ program: "ptrout" })` / `leilaCpu.remove()`.

## How it fits Figma's limits

- **≤ 400 actions per event, ≤ 400 stored per reaction.** The tick (~3,855 actions) is split into 10
  chunks. Step and Run are stacked: one button per chunk, only the current chunk's visible, so each
  reaction holds one chunk. Figma times out storing the whole tick in one reaction in a file this big.
- **Run in place.** Run and program loads play as full-size, see-through overlays that run one chunk
  per AFTER_TIMEOUT, SWAP to the next and CLOSE at the end. The OS frame stays on screen and lights up
  underneath. Navigating to Run frames would leave the OS.
- **Program loads.** The 225 wires whose power-on value differs between programs are written by the
  click. The other ~2,070 go in 6 overlay hops, with the clock's reset in the last one.
- **Clicks over the canvas.** Every button acts on MOUSE_UP and takes MOUSE_DOWN with the OS's own
  press actions, so the canvas cells underneath never start a gesture.
- **The clock pad is hidden**, because each of its cells would hold the whole tick in one reaction.
- Only the three magnified cells (`cell/FULL_ADDER`, `cell/DFFE`, `cell/DLATCH`) are drawn, not the
  whole ~72k-layer CPU. The dashboard and the overlays sit on the live frame's page, below it.

## Files

- `src/patch.ts`: `addLiveTab` / `removeLiveTab`.
- `src/page.ts`: the figma.com tab entry point.
- `plugin/`: the dev plugin (`node livetab/plugin/build.mjs` from `silicon/`).
- `test/livetab.test.ts`: the whole thing on the fake Figma API, replayed like the viewer. Step and Run
  match FastSim on every wire, ptrout halts with OUT = 0, mul loads from any state and runs to 0x2A,
  every event stays within the cap, and Remove leaves the file as it was.
