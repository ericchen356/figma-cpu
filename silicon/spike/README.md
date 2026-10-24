# Silicon spike: does Figma's prototype engine run gates fast enough?

## Spike v2: the measurements the CPU needs

v1 showed four things. Gates work. **One click with 2001 actions kills the viewer**, while 501
is fine. A number variable can't be bound to text. And the Run loop manages only about 0.9
hops per second. A CPU tick is about 3,860 actions, so it has to be split across several
events. v2 measures how far that can go.

**Steps** (about 15 minutes):

1. `cd silicon && node spike/build.mjs`
2. In the same Figma file as before ("Eric testing"), run **Plugins → Development → Silicon
   Spike → v2 · all tests**. The plugin was already imported, so it re-reads the new
   manifest; if the menu doesn't change, re-import `spike/manifest.json`. The v2 frames land
   below the v1 ones (y ≥ 3400). Check that "Spike log" ends with `0 error(s)`.
3. Press **▶ Present**. Each test is its own flow, named `v2 · …`, in the flow list.
   **When a test crashes the viewer, close it, press ▶ again and pick the next flow.**
   Restarting the viewer resets every counter.
   - **A. `v2 · Limit 600` … `Limit 1800`**: click once in each, smallest first. Record the
     largest N that works and the smallest N that crashes.
   - **B. `v2 · If false ×3000`, `If true ×2500`, `5 × If true ×400`, `Nested 4 × 500`**:
     click once in each. Does the counter go to 1, or does the viewer crash?
   - **C. `v2 · Triggers`**: click each button once, smallest first. Which of the three
     counters (down, up, click) move? Which button crashes?
   - **D. `v2 · Keys`**: click inside the prototype once so it has focus. Hold **Space** for
     5 seconds and read its counter. Then do the same for **K** and **J** (450 actions each),
     and tap **L** and **M**.
   - **E. `v2 · Hover`**: wave the mouse across the grid for 5 seconds and read the counter.
   - **F. `v2 · Text`**: click each button 3 times. Which texts show 3?
   - **G. `v2 · Loops`**: start each loop, wait 10 seconds by a stopwatch, read its hop
     counter, then click Stop. For the variant loops, use Open and then Back.
     **In the editor**, select `v2 · Loop NAVIGATE t=1 · A` and note the *After delay* value
     shown in the Prototype panel. Do the same for t=10, t=100 and t=0.
   - **H. `v2 · chunked counter`**: the counter compiled with a 30-action event budget, so one
     tick is 4 events. Click **Step** 4 times: phase goes 1, 2, 3, 0, and ticks becomes 1. Try
     **Step ×3**: does one click advance the phase by 3? Hold **Space** or **K**. Try Run.

**Report template** (paste back):

```
A  largest Limit that works: ____   smallest that crashes: ____
B  If false ×3000: ok / crash     If true ×2500: ok / crash
   5 × If true ×400: ok / crash   Nested 4 × 500: ok / crash
C  3 triggers × 10:  down _ up _ click _      × 300: down _ up _ click _ (crash?)
   × 450: down _ up _ click _ (crash?)         × 600: down _ up _ click _ (crash?)
D  Space held 5 s → ____   K held 5 s → ____   J (450) held 5 s → ____ (crash?)
   auto-repeat? yes / no    L (child) works? __   M (hidden child) works? __
E  Hover 5 s waving → ____ (crash?)
F  E1 "n=" + number → shows ____   E2 number + "" → ____   E3 alias → ____   E4 digits → ____
G  hops in 10 s:  NAVIGATE t=1 ____  t=10 ____  t=100 ____  t=0 ____
                  SWAP t=1 ____  3 frames t=1 ____  variants t=1 ____  variants t=0 ____
   Prototype panel "After delay" for t=1 / 10 / 100 / 0: ____ / ____ / ____ / ____
H  4 Steps = 1 tick? __   Step ×3 advances by 3? __   Space/K advances? __ held repeats? __
   Run: ticks in 10 s ____
Spike log errors (if any): ____
```

## Spike v1

This dev plugin builds a page, **`Silicon · Spike`**, where Figma's own prototype engine
evaluates logic gates. Each wire is a boolean variable. Each gate is one `SET_VARIABLE`
action with an `AND`/`OR`/`NOT`/`EQUALS`/`NOT_EQUAL` expression. The plugin only builds
things. Once you press ▶, Figma does all the computing.

The page has three parts:

| Flow | What it is |
|---|---|
| **Counter** | A 4-bit counter made of 42 gates: 4 master/slave D flip-flops, each from two feedback-mux latches, plus an XOR/AND incrementer. The real timing compiler (`src/compile`) schedules it, so one Step is 72 actions (70 gate evaluations and 2 clock sets) plus 2 tick-counter actions (the number and its text). The Run loop ping-pongs between two frames using a 1 ms *After delay*. |
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
   - **v1 · Counter + self-test only** is quick. Run this first.
   - **v1 · Stress 500 / 2000 / 5000 only** takes longer: it creates about 7,500 variables.
   - **v1 · Build all** does both of the above.
   - **v1 · Heavy stress 10k + 20k** is optional and slow. It shows what a CPU-sized tick costs.
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
- Does the "ticks" text show a plain number like `12`? Text binds only to STRING variables, so it shows `ctl/tickText`, which is set to "" + ticks.
- Are the variables visible under **Local variables** (collections `Spike`, `Spike Test`, `Spike Stress N` and `… · 2`)?

## Why these numbers matter

The CPU will be a few thousand gates. A tick evaluates each live gate about once per clock
phase, so it costs roughly **2 × gates** actions plus a few repeats in latch loops. That is
on the order of 5k–15k actions per Step. The stress rows show whether one click at that size
takes milliseconds or seconds, and how many ticks per second Run can reach.

## Files

- `manifest.json` is the dev plugin (`editorType: figma`, `documentAccess: dynamic-page`, menu commands).
- `build.mjs` is the esbuild bundle → `dist/code.js`.
- `src/main.ts` is the entry. `src/spike.ts` builds the page (v1 and the chunked counter). `src/v2.ts` builds the v2 tests. `src/circuits.ts` holds the gate-level counter.
- The counter is compiled by `../src/compile` (`compile`, `powerOn`) and `../src/prototype` (`plan`, `toFigmaActions`, `apply`). The same code will build the CPU.
- Tests: `../test/prototype.test.ts` runs the whole spike against a fake Plugin API. It replays the exact reaction JSON in an emulator and checks it against the reference simulator.
