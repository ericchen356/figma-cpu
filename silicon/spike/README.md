# Silicon spike: does Figma's prototype engine run gates fast enough?

This dev plugin builds a page, **`Silicon · Spike`**, where Figma's own prototype engine
evaluates logic gates. Each wire is a boolean variable. Each gate is one `SET_VARIABLE`
action with an `AND`/`OR`/`NOT`/`EQUALS`/`NOT_EQUAL` expression. The plugin only builds
things. Once you press ▶, Figma does all the computing.

The page has three parts:

| Flow | What it is |
|---|---|
| **Counter** | A 4-bit counter made of 42 gates: 4 master/slave D flip-flops, each from two feedback-mux latches, plus an XOR/AND incrementer. The real timing compiler (`src/compile`) schedules it, so one Step is 72 actions (70 gate evaluations and 2 clock sets) plus 1 tick-counter action. The Run loop ping-pongs between two frames using a 1 ms *After delay*. |
| **Self-test** | Checks every expression shape the compiler emits (nested and flat), whether actions run sequentially, nested IF conditions, and how a bare alias behaves. |
| **Stress 500 / 2000 / 5000** | N gate actions per click (s0 = ¬s0, then s[i] = s[i-1] ⊕ s[i]), over N variables. Each has Click ×1 and a Run loop. |

## 1. Build

```sh
cd silicon
npm install          # once
node spike/build.mjs # → spike/dist/code.js
```

## 2. Install and run in Figma desktop

1. Open **Figma desktop** and create a new, empty **Design** file. Don't use a file you care about: the plugin adds about 7,600 variables.
2. Go to **Menu → Plugins → Development → Import plugin from manifest…** and pick `silicon/spike/manifest.json`.
3. Go to **Menu → Plugins → Development → Silicon Spike** and choose a command:
   - **Counter + self-test only** is quick. Run this first.
   - **Stress 500 / 2000 / 5000 only** takes longer: it creates about 7,500 variables.
   - **Build all** does both of the above.
   - **Heavy stress 10k + 20k** is optional and slow. It shows what a CPU-sized tick costs.
4. Wait for the toast "Silicon spike built". The page **`Silicon · Spike`** opens.
5. Read the **Spike log** text, which sits at the far left of the page (x = −1400). It must end with `done in … s with 0 error(s)`. If it lists errors, copy them into your report.

Running a command again rebuilds that part from scratch. It deletes the old `Spike*` collections and frames first.

## 3. Present and measure

Press **▶ Present** on the `Silicon · Spike` page. Pick a flow from the flow list: Counter, Self-test or Stress N.

To start over at any time, restart the prototype (press **R** in the viewer). This resets all variables to their initial values.

### A. Self-test (do this first)

Click each of the five blue buttons once: **Run nested**, **Run flat**, **Seq probe**, **If probe** and **Alias probe**. Then record which of the big lamps light up.

| Lamp | Meaning if lit |
|---|---|
| NESTED OK | Nested expressions work, e.g. `NOT(AND(a,b))` for NAND, or `AND(ok, EQUALS(x, true))`. |
| FLAT OK | The fallback encoding works. This is single-level expressions only, with NAND as two actions. |
| SEQUENTIAL | Each action sees values written by earlier actions **in the same click**. The whole design depends on this. |
| NESTED IF | A `CONDITIONAL` with an `AND(x, NOT(y))` condition works. The CPU's Run loop uses this to stop on HALTED. |
| ALIAS COPIES | Setting a variable to a bare variable alias copies the value. It doesn't bind the two together. |

The gate table shows one row per gate type, with lamps for inputs (A,B) = 00 01 10 11. Green lamps are nested, amber lamps are flat. Each row must match its `expect …` text.

### B. Counter

- Click **Step** a few times. The four big amber lamps show Q in binary, with Q3 on the left, and should count 1, 2, 3… The **ticks** number is the click count, and **Q = ticks mod 16** must hold. The small lamps show every wire.
- Click Step as fast as you can for about 5 seconds. Does each click register? Watch whether ticks equals your click count.
- Click **Run**. The view switches to "running (A)/(B)" and ticks climbs on its own. After **10 seconds** by a stopwatch, read the ticks value, then click **Stop**. The loop returns to the Counter frame.

### C. Stress 500, 2000, 5000 (and 10k, 20k if built)

For each size:

1. Click **Click ×1** once. Note how long it takes for the ticks number to change: instant, a noticeable lag, or seconds. **The tick counter is the last action in the list**, so if it goes up, all N gate actions ran.
2. Click as fast as you can for 10 seconds. Write down the ticks value.
3. Click **Reset**, then **Run**. Wait 10 seconds and read ticks, then click **Stop**.

The 16 green lamps are the first 16 chain bits. They should change on every click.

## 4. What to report back

Paste this filled in:

```
Figma desktop version:            ____
Machine (CPU / RAM):              ____
Build: "done in __ s", errors:    ____ (paste any log errors)
Editor sluggish after building?   yes / no

Self-test lamps:  NESTED OK _  FLAT OK _  SEQUENTIAL _  NESTED IF _  ALIAS COPIES _
Gate table rows all match?        yes / no (which rows differ)

Counter: Step works (Q = ticks mod 16)?   yes / no
Counter: fast clicking, 5 s → ticks       ____  (clicks you made: ____)
Counter: Run 10 s → ticks                 ____

             Click ×1 latency   10 s clicking → ticks   Run 10 s → ticks
Stress 500   ____               ____                    ____
Stress 2000  ____               ____                    ____
Stress 5000  ____               ____                    ____
Stress 10k   ____               ____                    ____   (optional)
Stress 20k   ____               ____                    ____   (optional)
```

Also worth checking:

- In the editor (not Present), select the **Step** button in the Counter frame and open the **Prototype** tab. Does the action list show "Set variable net/… to …" with expressions?
- Does the "ticks" text show a plain number like `12`? The text's characters are bound to a number variable.
- Are the variables visible under **Local variables** (collections `Spike`, `Spike Test`, `Spike Stress N` and `… · 2`)?

## Why these numbers matter

The CPU will be a few thousand gates. A tick evaluates each live gate about once per clock
phase, so it costs roughly **2 × gates** actions plus a few repeats in latch loops. That is
on the order of 5k–15k actions per Step. The stress rows show whether one click at that size
takes milliseconds or seconds, and how many ticks per second Run can reach.

## Files

- `manifest.json` is the dev plugin (`editorType: figma`, `documentAccess: dynamic-page`, menu commands).
- `build.mjs` is the esbuild bundle → `dist/code.js`.
- `src/main.ts` is the entry. `src/spike.ts` builds the page. `src/circuits.ts` holds the gate-level counter.
- The counter is compiled by `../src/compile` (`compile`, `powerOn`) and `../src/prototype` (`plan`, `toFigmaActions`, `apply`). The same code will build the CPU.
- Tests: `../test/prototype.test.ts` runs the whole spike against a fake Plugin API. It replays the exact reaction JSON in an emulator and checks it against the reference simulator.
