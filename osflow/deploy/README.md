# deploy: gate-level machines that run in Figma Present, with no plugin

Two generators turn a silicon gate netlist into a Figma file whose prototype computes the machine
gate by gate: one BOOLEAN variable per wire, one `SET_VARIABLE` with a gate expression per gate
evaluation, lamps bound to wires. Nothing runs at Present time except Figma's prototype engine.

| generator            | machine                                          | build               | output            |
| -------------------- | ------------------------------------------------ | ------------------- | ----------------- |
| `nathan.ts`          | CPU NATHAN, the Figma OS editor (silicon/nathan) | `npm run -s nathan` | `deploy/out/`     |
| `cpu.ts` + `tick.ts` | silicon's 8-bit CPU, programs count / mul / fib  | `npm run -s cpu`    | `deploy/out-cpu/` |

Each output folder holds numbered chunks (`NN-step.js`) and a `manifest.json`. A chunk is
`runtime.js` (minified) plus one `RT.run(step, data, checksum)` call that builds part of the file
through the Plugin API: wire variables, the Present frame, the screen, reactions, the gate map.

## Loading a build into a file (browser, no plugin)

The figma.com editor page exposes the Plugin API as `figma` to page scripts. Open
`https://www.figma.com/design/<key>` in Chrome, add a file input to the page, give it the chunk
files, then run them in order:

```js
const AF = Object.getPrototypeOf(async () => {}).constructor;
for (const f of [...input.files].sort((a, b) => a.name.localeCompare(b.name)))
  await new AF("figma", await f.text())(figma);
```

Re-running a whole build replaces the previous one: variables and frames are found by name, and a
previous build's overlays by the prefixes the generator gives them. Every node's reactions are
stored by one call (the build stops if a node's reactions need more than a chunk). Close other
prototype tabs of the file while building: a viewer that receives a live rebuild can lose its click
handling until it is reloaded.

## What Figma's prototype engine does (measured)

- A `CONDITIONAL` keeps one IF and an optional ELSE. `setReactionsAsync` accepts more blocks, then
  silently keeps the first and turns the second into the ELSE. A `CONDITIONAL` inside another is
  rejected. `test/figma-shape.ts` checks every stored reaction for this.
- The viewer runs a reaction's actions recursively (about three stack frames per action). On a
  cold page, 1,000 sequential actions in one event ran and 1,200 overflowed the stack, after which
  the prototype ignores every click until reloaded. Warmed up, 2,000 ran. Only executed actions
  count: actions behind a false `if` cost nothing. Every event here stays at 700 or fewer: the
  CPU's ticks are 22 to 324 actions, the OS's controls are specialized per canvas row and per
  selected slot (the longest is 694), and a reaction longer than the part continues through timed
  overlays (below), with all its register writes in the last event. The OS frame also runs a
  one-time warm-up when Present opens (a few hundred throwaway actions).
- An overlay's `AFTER_TIMEOUT` timer (0.001 s) fires again after a `SWAP` to another overlay, so
  two overlays swapping into each other form a clock: the CPU's Run and Instruction, and the OS's
  continuations (an event runs part 1 and opens a 1×1 overlay whose timer runs part 2 on a fresh
  stack, then swaps on or closes). `CLOSE` inside a CONDITIONAL stops it. About 8 CPU ticks/s.
- `ON_CLICK` does not fire on a layer that also has `MOUSE_DOWN`/`MOUSE_UP`. An `ON_KEY_DOWN` key
  list is a chord (all keys held), not alternatives. A key goes to the showing layer that takes it
  before the frame, and hidden layers never take keys, so the OS's D [ ] sit on 8 layers picked by
  the selection register. `MOUSE_ENTER` must not carry `deprecatedVersion`. BOOLEAN variables
  reject `scopes = []`.

## Tests

`test/cpu-deploy.test.ts` and `test/nathan-deploy.test.ts` run every chunk against silicon's fake
Plugin API, then drive the stored reactions with silicon's emulator of the prototype engine (timer
overlays included). They compare the machine with its reference after each event: the ISA model
tick for tick, and the OS editor spec over a 600-event session that dispatches like Figma (exact
key codes to the showing layer, then the frame; shortcuts and buttons alternating). The OS test
builds at four sizes (700, 693, 400 and 300 actions an event) so the chain path runs, and checks
the built screen against `uiSpec()` layer by layer, every gate-map lamp, the per-event budget on
every stored reaction, the overlay chains, and the IF/ELSE and trigger shapes
(`test/nathan-checks.ts`, `test/figma-shape.ts`). `test/nathan-synth.test.ts` checks the long-
reaction handling against silicon's synthesizer directly and a rebuild over an older build;
`test/nathan-keys.test.ts` that key lists are stored unchanged.
