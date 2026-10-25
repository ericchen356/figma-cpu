# FigmaCPU Live — run programs natively in Present mode, and see every layer of the machine

Goal: FIGMA-OS's "it all runs inside Figma's prototype player" experience, on the **gate-level** CPU, with far better
visuals: from the program, to the instruction cycle, to the datapath, down to individual gates, all lit live by the
same variables the gates compute. Added next to the existing work. Nothing existing is removed or renamed.

## 0. Ground rules (learned in the real app)

- **≤ 400 actions per event** (the viewer crashes around 500–2,000). A tick is ~3,860 actions, so it runs in ~11 chunks
  dispatched by `ctl/phase` (see `src/prototype/apply.ts`).
- **No CONDITIONAL inside another conditional's block**: Figma rejects it ("Unrecognized key conditionalBlocks").
  `nestedConditional()` / `guardReactions()` in `src/prototype` enforce it.
- **Holding a key does not auto-repeat** in the viewer: one key press = one event.
- **AFTER_TIMEOUT hops run at ~0.9/s** regardless of size.
- **A FLOAT can't bind to text** `characters`; use STRING variables (`concatText`).
- **Starter plan: max 3 pages per file.** Never require a new page; put new content in new regions/frames of the
  current page (default: the page that holds `cell/CPU`).
- **Visuals cost nothing per tick when they are pure bindings** (`setBoundVariable('visible', v)` on a layer). Every
  visual below must be a binding to an EXISTING net variable. No new gates, no new actions per tick.

## 1. What already exists (reuse, don't rebuild)

- Variables: one BOOLEAN per CPU net, named `net/<hierarchical name>` (`src/prototype/plan.ts`, `varName`), in the
  collection created by Compile (`apply`). Control vars `ctl/*` (ticks, tickText, phase, phaseNow, phaseText, running, go).
- Nets worth showing (all exist in `cpuNetlist()`):
  - control signals (top level): `PC_OUT MDR_OUT REG_OUT_D REG_OUT_S Y_OUT MAR_LOAD IR_LOAD MDR_LOAD REG_LOAD_D A_LOAD
    PC_LOAD PC_INC MEM_READ MEM_WRITE Y_LOAD FLAGS_LOAD T_RESET HALT`
  - opcode lines: `ctrl/op_NOP … ctrl/op_HLT` (one per opcode, from the opcode decoder)
  - T-state lines: the outputs of `ctrl/dec_t` (one per T0–T7; find the exact names in the netlist)
  - probes (`src/cpu/probes.ts`): `pc[0..3] mar[0..3] mdr[0..7] ir[0..7] r0..r3[0..7] a[0..7] y[0..7] flag_z flag_c
    flag_n t[0..2] halted OUT[0..7] bus[0..7]`, RAM bits `ramBit(addr, bit)`, 7-segment `SEG_LO[0..6] SEG_HI[0..6]`.
- Cells as Figma components `cell/<NAME>` (gate symbols with a hidden `lit` layer), drawn by Build hardware.
  `collectBindings(top, net)` (`src/figma/bindings.ts`) maps flat gate paths to `lit` nodes.
- Front panel, MEM screen, OS card (Aum's work in `plugin/src/*`, `src/os/*`).

## 2. The Live dashboard (lane L1: `src/live/*`)

A Figma-OS-style window (e.g. 1920×1200), built as a component `Live · Dashboard` so it can be instanced in the run
frames. Sections:

1. **Chrome:** title bar "FigmaCPU", program "disks" (one button per program, named `disk/<program>`), clock controls
   (named `ctl/step`, `ctl/run`, `ctl/stop`, `ctl/reset`), the tick and phase readouts (STRING vars), and a
   **clock pad** frame named `ctl/pad` containing N cells named `ctl/pad/<i>` (lane L2 attaches reactions).
2. **Microcode grid ("instruction-cycle flowchart"):** rows = the 16 opcodes (`OPCODES` in `src/isa/spec.ts`), columns =
   T0–T7; each cell shows that step's signals (from `microcode()`); FETCH columns T0–T2 shared. The row highlight binds
   to `ctrl/op_<MNEM>`, the column highlight to the T line. The active cell is where the lit row and column cross.
   Generated from the spec, so it can't drift from the hardware.
3. **Datapath diagram:** blocks PC, MAR, RAM, MDR, IR, CONTROL, R0–R3, A, ALU, Y, FLAGS, OUT, with the 8-bit **bus**,
   each register showing its bit lamps. **Arrows** for each transfer (PC→bus, bus→MAR, RAM→MDR, MDR→bus, bus→IR,
   Rd→bus, bus→A, A+bus→ALU→Y, Y→bus, bus→Rd, MDR→RAM, …), each arrow's lit copy bound to its control signal.
4. **Magnifiers:** instances of real cells, bound to the CPU's actual nets so their gates glow live:
   `cell/FULL_ADDER` at `alu/add/fa<k>/` (one or more bits), `cell/DFFE` for `regs/r0/b0/`, `cell/DLATCH` for a RAM bit,
   optionally `cell/HEX7SEG`. Each instance's internal gate paths map to `<prefix><gate path>` in the flat netlist.
5. **Memory and output:** a 16×8 RAM lamp matrix (bits bound to `ramBit`), the 2-digit 7-segment display (`SEG_*`), and
   the assembly listing of the loaded program (static text, rewritten when a program is loaded).

API: `buildDashboard(api, page, net, opts) → { component, nodes: { step, run, stop, reset, pad, padCells, disks } }`
and `bindDashboard(component, net, varByNet)`. All bindings are visibility bindings to existing variables.

### 2.1 As built (lane L1, 2026-10-24)

```ts
import { bindDashboard, buildDashboard } from "src/live";
const dash = await buildDashboard(api, page, net, { source, cellPages });   // component "Live · Dashboard", unbound
const report = bindDashboard(dash.component, net, varByNet, { ctl });       // ctl: the `ctl/*` variables by name
// … wireLive(api, plan, applyResult, dash, cpuPrograms(net, PROGRAMS, listingText), { padCell: dash.nodes.padCell })
bindDashboard(dash.component, net, varByNet, { ctl: ctlAgain, varsOnly: true }); // ctl/program, ctl/listing, ctl/loading
```

- **Layout (1920 × 1200, Figma-dark: canvas #1E1E1E, chrome #2C2C2C, Inter + Roboto Mono):** top bar 48 px (title, a
  gates/wires chip, Step / Run / Stop / Reset, TICK and PHASE readouts, a RUNNING pill); left panel 256 px (14 disks =
  13 programs + `custom`, the listing, "how it works"); right panel 296 px (clock pad 6 × 5, two 7-segment digits + OUT
  and HALT lamps, the RAM matrix 16 × 8 with the MAR row highlighted, legend, controls hint); centre 1336 px wide:
  datapath card (480 high), microcode card (16 rows × T0–T7, ~372 high), magnifier card (~234 high).
- **Canvas contract** (`src/live/names.ts`; layers found by name, so renaming retargets them, like the front panel):
  `<kind>/<net>` with a child `lit` for kind ∈ lamp, seg, arrow, row, col, tag (`lit`.visible ← the net);
  `var/<ctl variable>` (TEXT → characters ← a STRING; frame → its `lit` ← a BOOLEAN); `mag/<prefix>` holding an
  instance (every gate `lit` and `wire/<net>/lit` inside ← net `<prefix>/<path>`); controls `ctl/step|run|stop|reset`,
  `ctl/pad` with `ctl/pad/<i>` (instances of the component `Live · Pad cell`), `disk/<program>`, `disk/custom`.
- **Bound nets:** probes (pc mar mdr ir r0–r3 a y t bus OUT flags halted CLK), `alu_y`, `ram_out`, `ram/sel[k]` (decoded
  MAR: the RAM row highlight and the address lamps), `regs/load[k]` (register being written), `alu/sel[k]` + `alu_sub`
  (ALU function), `out_load` (MDR → OUT), the 18 control signals (transfer arrows and signal tags), `ctrl/T0..T7`
  (columns), `ctrl/op_<MNEM>` (rows) and `ctrl/op_J?if?` (the "taken" tag of the conditional jumps), RAM latches
  (`ramBit`), `SEG_LO/HI`. 457 lit layers in all (277 lamps, 14 segments, 17 arrows, 32 rows, 8 columns, 56 tags,
  19 magnifier gates, 33 magnifier wires, the RUNNING pill) + 4 texts (tick, phase, program, listing). 0 unbound.
- **Magnifiers** (default): `cell/FULL_ADDER` at `alu/add/fa3`, `cell/DFFE` at `regs/r0/b0`, `cell/DLATCH` at
  `ram/row15/b1` (bit 1 of the OUT byte), rescaled to fit (`rescale`), their port labels set to the CPU's net names.
- **Size:** ~1,890 layers in the component (340 of them the magnifier instances). Generated from `OPCODES` /
  `microcode()` (grid) and the netlist; nothing adds a gate, an action or a variable.

## 3. The native runtime (lane L2: `src/prototype/live.ts` + plugin wiring)

`wireLive(api, plan, compiled, dashboard, programs, opts)`, using the variables and chunked tick of `apply()`:

- **Frames:** `Live · Main` (an instance of the dashboard, flow starting point), `Live · Run A/B` (instances; the Run
  loop hops between them), `Live · Load A/B` (hop frames for chunked program loading).
- **Step** (`ctl/step`): ON_CLICK runs one chunk (the phase dispatcher). Optionally MOUSE_DOWN + MOUSE_UP for more
  chunks per physical click, but only if it stays flat and capped.
- **Clock pad** (`ctl/pad/<i>`): each cell runs one chunk on MOUSE_ENTER (and MOUSE_DOWN), so sweeping the mouse across
  the pad clocks the CPU at mouse speed, as FIGMA-OS's FAST CORE does.
- **Run / Stop:** the existing flattened AFTER_TIMEOUT loop (the ~0.9 hops/s fallback).
- **Reset:** the existing chunked Reset (power-on state).
- **Disks** (`disk/<program>`): load a program **inside Present mode**. Write the program's RAM bits (literal booleans)
  plus the power-on state, chunked ≤ 400 per event over Load A/B hops, then return to Main.
- Every reaction passes `guardReactions` (flat, ≤ cap). Emulator tests: replaying the exact reactions reaches the right
  OUT for several programs (e.g. `mul` → 0x2A), via Step, via the pad, and via a disk load.

### 3.1 As built (lane L2, 2026-10-24)

```ts
import { apply, cpuPrograms, plan, wireLive } from "src/prototype";
const res = await apply(api, p, { maxActionsPerEvent: 400 });           // Compile, as today
const disks = cpuPrograms(net, PROGRAMS /*, listingText */);             // power-on state per program (+ listing text)
const live = await wireLive(api, p, res, dashboard /* ComponentNode or { component } */, disks, opts);
```

- **`compiled`** is apply()'s result. apply() now also returns `runtime` (additive): the exact Step event, the
  dispatch blocks, the Run hop builder, the reset tail and every `ctl/*` variable. wireLive reuses them, so Live and
  the CPU · Control frame run the same tick.
- **Reactions sit on the dashboard component's layers** (`ctl/step`, `ctl/run`, `ctl/stop`, `ctl/reset`, `ctl/pad/<i>`,
  `disk/<program>`; found by name, not inside nested instances). Every instance inherits them, so all five frames
  have working controls. They don't depend on the frame that shows them; variables guard them:
  - `ctl/busy` (FLOAT, 0, or `LIVE_LOCK` = 1000 while a load runs) is added to the phase snapshot
    (`phaseNow = phase + busy`), so Step and the pad match no chunk during a load;
  - Run fires only when ¬busy ∧ ¬running, Stop only when ¬busy ∧ running. Running ⇔ a Run frame is showing, so no
    control navigates to the frame you are already on.
- **Frames** (row below everything on the dashboard's page, each = one instance of the dashboard, same size):
  `Live · Main` (flow "FigmaCPU Live"; ON_KEY_DOWN if `keys`), `Live · Run A/B` (AFTER_TIMEOUT: apply's flat hop, home =
  Main), `Live · Load A/B` (AFTER_TIMEOUT: load hop). No Reset frames: Reset is a load of the current disk.
- **Triggers:** Step = ON_CLICK (`stepTriggers` adds MOUSE_DOWN/MOUSE_UP, default off); pad cells = MOUSE_ENTER
  (`padTriggers` adds MOUSE_DOWN); disks / Run / Stop / Reset = ON_CLICK. Every event is one chunk at most.
- **Disk load:** the click sets `ctl/disk`, `ctl/program`, `ctl/listing`, locks, and writes, as literals, the nets whose
  power-on value differs between the disks (RAM bits and the nets they settle: 212 for the CPU). Then Load A ⇄ B hops
  write the 2,075 shared nets (+ flags) in chunks, the last one also the tail (ticks, texts, phase, go, running, unlock),
  and return to Main. Every net is written on every load, so the result is exactly powerOn(program) from any state.
  Reset does the same for the current `ctl/disk` (one exclusive `if disk == e` block per disk).
  `disk/custom` (or `bootName`) = the plan's own power-on values (the program Compile / Load program put in).
- **Variables added** (in apply's collection, reused when wiring again): `ctl/disk` FLOAT, `ctl/loadPhase` FLOAT,
  `ctl/loadNow` FLOAT, `ctl/busy` FLOAT, `ctl/loading` BOOLEAN (bind a "loading" lamp), `ctl/program` STRING,
  `ctl/listing` STRING (bind the program name / listing texts, e.g. `var/ctl/program`). They exist only after wireLive,
  so bind them after it.
- **Measured (real CPU, cap 400, `test/live-runtime.test.ts`):** 11 events per tick (Step clicks, pad entries or Run hops);
  Step / pad event ≤ 394 actions, Run hop ≤ 398; a disk load = 7 events (the click: 220 actions, then 6 hops of
  ≤ 390, the last 194); Reset click 230. `mul` (162 ticks) = 1,782 Step clicks or pad entries, `fib` (448 ticks) = 4,928.
  Stored: 3,896 actions per pad cell (each holds the whole dispatcher): 16 cells + the rest = 81,894 actions. If the
  cells are instances of one component, pass it as `padCell` and it is stored once (23,454 in all).
- **Rebuild after Compile or Load program:** the disks hold literals, and `ctl/disk` / `ctl/program` start at the
  compiled program, so wire Live again after either one.
- **To verify in the real app:** the instances inherit the component's reactions, including NAVIGATE to top-level
  frames; how many MOUSE_ENTER events per second the viewer runs at ~394 actions each, and whether it drops entries
  while one is still running; whether MOUSE_DOWN / MOUSE_UP / ON_CLICK on one layer are three events; the
  `phase + busy` FLOAT addition; the hop rate on Load A/B (a load ≈ 7 s at 0.9 hops/s); file weight with the pad.

## 4. Plugin

A new card "Live view" in the plugin panel: **Build Live view** (dashboard + frames + bindings + reactions, after
Compile), plus a status line. It reuses Compile's session (variables, plan).

### 4.1 As built (lane L1)

Card "Live view" (`plugin/src/live-card.ts`, message `{ type: "live" }`): **Build Live view** removes the top-level
`Live · *` layers of the CPU page (keeping the dashboard's spot; first time: right of everything), draws the dashboard,
binds it, calls `wireLive` with this session's `apply()` result (frames go 200 px below the dashboard), then binds
`ctl/program`, `ctl/listing`, `ctl/loading`. Progress bar + a stats line (`LiveStats`). Without a Compile in this
plugin session (e.g. reopened), it builds and binds the dashboard and says that the controls need a Compile first.
Rebuild after Compile or Load program (the disks hold literals). Tested in `test/live.test.ts`.
