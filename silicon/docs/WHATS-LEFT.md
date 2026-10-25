# What is left to make a fully functioning system inside Figma

> **Correction (2026-10-24):** the ~0.9 hops/s came from a 1-second hop. Figma reads `AFTER_TIMEOUT.timeout` in
> seconds (its docs say milliseconds), and the spike and the Run loops wrote 1. With 0.001 (now the default, see
> `afterTimeout` in `src/prototype/figma-actions.ts`) a hop costs ~10–20 ms plus ~0.2 ms per executed action, so a
> ~400-action chunk runs at roughly 10 hops/s **(estimate from measured costs)**, and the specialized deploy of this CPU
> (`osflow/deploy/cpu.ts`) runs ~92 ticks/s on count **(measured)**.

> **Since then (2026-10-24):** RAM is 64 bytes (OUT = 63, IN = 62) and the CPU has LDR / STR / LDRI pointers; see
> POINTERS.md. The 16-byte figures below are as written then.

Written 2026-10-24 for the three people working in parallel: **CPU design**, **"Figma OS"** (the app that runs on the CPU), and
**plugin/toolchain** (us). Every number below comes from the repo or from a test run; guesses are marked **(guess)**.

## The one-paragraph answer

The hardware is real and verified: a gate-level CPU (2,285 gates, 2,287 wires as Figma variables) that matches an instruction-set
model tick for tick, plus an assembler, programs, a front panel and a memory screen. What it **cannot** do yet is be a system:
it has **no input**, **16 bytes of RAM**, **two hex digits of output**, and the only way to run it fast is the **plugin clock**,
because Figma's prototype engine manages about **0.9 hops per second** (Eric's own spike). A full OS cannot live on the gate-level
CPU as it is built. Two decisions fix that: pick **which CPU the OS runs on**, and **how fast "running" has to be** (below).

## 1. What exists and is verified (in Node, against fake Figma APIs)

| Layer | State |
|---|---|
| Gate-level CPU (`eric/silicon`) | 2,285 gates; ISA of 16 opcodes; R0–R3, flags Z C N; 16 bytes RAM; verified against the ISA model for every program |
| Toolchain | assembler (labels, `.db`), 11 programs (count, mul, fib, sub, logic, mem + our pow2, triangle, mod, blink, lfsr) |
| Build into Figma | Build hardware → Compile → variables + prototype actions, **chunked** to ≤ 400 actions per event (Step = 11 events/tick; Reset = 6 events) |
| Output | OUT port on two 7-segment digits, 17 probe lamp rows, **16×8 MEM lamp screen** (ours) |
| Fast run | plugin clock: ~115,000 ticks/s simulated, ~110–120 variable writes per tick |
| Checks | `npm run audit` (file vs code), Verify button (canvas CPU vs ISA model) |
| Block-level machine (`plugin/scaffold`) | 64 KB RAM, 128×96 screen, mouse/key IO, opcode table read live from the canvas, bounce/paint-style programs; 90 tests |

## 2. What is not verified at all

Nothing has run inside the real Figma viewer since the chunking fix. Needs one person in Figma desktop: rebuild (Compile), press Step 11
times, press Reset, press Run, click through the MEM screen. Until then "chunked Step/Reset works" means "works in the emulator".
Eric's current file is **unchunked** (Step = 3,861 actions, Reset = 2,289; the viewer died at 2,001), so it must be rebuilt.

## 3. The gaps, by layer

| # | Gap | Why it matters | Owner | Size |
|---|---|---|---|---|
| 1 | **First real run in Figma** | Everything above is emulated | anyone, 30 min | S |
| 2 | **Input** | `compile` uses `inputs: []`: the CPU has CLK and RESET only. An OS needs a keypad/mouse. Option: input buttons set variables wired to an IN port + `LD` from an IO address | CPU design | M |
| 3 | **Memory** | 16 bytes, 4-bit PC. RAM is 808 of the 2,285 gates (~50 gates per byte). 256 bytes ≈ +12,000 gates, 1 KB ≈ +50,000. Layers are already ~72k at 16 bytes **(guess: Figma slows badly well before a few hundred thousand layers)** | CPU design | L, risky |
| 4 | **Display** | OUT (8 bits) + the MEM matrix. A "desktop" needs a framebuffer: gate-level pixels do not scale; a plugin-rendered image fill (our PNG pipeline) does | OS + us | M |
| 5 | **Speed** | Present-mode Run ≈ 0.9 hops/s (Eric's spike v1) → a chunked tick is 11 hops ≈ 12 s **(arithmetic from his number)**; `mul` is 162 ticks ≈ 33 min. The v2 spike results (keys, hover, triggers) were never recorded | all | decision |
| 6 | **Program size** | 16 bytes of code+data (and the last byte is OUT). Any OS-like program is orders of magnitude bigger | OS | tied to #3 |
| 7 | **Persistence / loading** | Program loads only through the plugin ("Load program"); nothing boots from a ROM or storage | CPU + us | M |
| 8 | **"Figma OS" itself** | I found no public project by that name. The PRD's Phase 2 is "a mini Figma app running on this CPU" (shape table in RAM, rect tool, layers panel, select/move); that is what I assume is meant | OS | L |

## 4. The two decisions that unblock everything

**Decision A: which CPU runs the OS?**

| Option | Gives | Costs |
|---|---|---|
| **A1. Block-level machine** (Machine v2, `plugin/scaffold`) runs the OS | 64 KB RAM, 128×96 screen, mouse/keys, an assembler and demo programs already exist; a mini-Figma app is realistic | The CPU is "physics in a plugin" (opcode table on the canvas), not gates; the Workflow-track story is weaker |
| **A2. Scale the gate-level CPU** | Pure "Figma computes it" story | Needs inputs, 10–100× the RAM, a framebuffer; size and speed may make it unusable **(guess)** |
| **A3. Both** (recommended) | OS and screen on A1; gate-level CPU shown as the proof that logic is real, running small programs (mul, lfsr, blink) with the MEM screen | Two ISAs to explain; a bridge (same programs on both) is optional and large |

**Decision B: does "running" mean Present mode or the plugin clock?** Present mode is the only way a viewer without the plugin can
see it, but at ~0.9 hops/s it demonstrates stepping, not an OS. The plugin clock runs at speed but only for the person with the
plugin. Pick one for the demo script; do not promise both.

## 5. Suggested split for the three people

- **CPU design:** inputs (#2), then memory growth only as far as layers allow (#3); report gates/layers per step. Keep `src/isa/spec.ts` the single truth.
- **Figma OS:** define the app (what must it do in 90 seconds), its memory map and drawing primitives; write it in assembly for the machine from Decision A.
- **Toolchain (us):** first real Figma run (#1), file audit after each rebuild, assembler support for whichever ISA wins, the display pipeline (#4), and the timing numbers the spike never recorded (#5).

## 6. Risks to watch

- Layer count and variable count (apply spills collections at 4,000 variables; the CPU is at 2,287 plus flags).
- A rebuild replaces the variable collection: keep a duplicate of the Figma file as the demo copy.
- Two plugins touching one file at once: only one person drives the plugin against a shared file.
