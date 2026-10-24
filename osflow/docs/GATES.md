# osflow at gate level: the editor as a chart of gates

The word-level flow (`src/editor.ts`) is the TypeScript back end: it is checked against
`os-ui/src/model.ts` event by event. This document is the contract for compiling that flow into
**a machine of 2-input gates**, built with silicon's HDL and cells, so that it can be drawn in Figma
as a chart (silicon's drawer) and computed by Figma's prototype engine. TypeScript builds and tests
it; nothing runs at Figma run time but Figma.

```
src/editor.ts  buildEditor({ target: "hardware" })      the flow, in cells, with bit widths
      │  src/gates/  synthesize()                          symbolic execution → gates
      ▼
Library (silicon/src/netlist/types.ts), top "OS"            modules = chart blocks
      │  flatten()                                          silicon/src/netlist/flatten.ts
      ▼
FlatNetlist ── FastSim / RefSim: one tick = one editor event ── checked against the interpreter
      │  reactions(): EVT tied, constants folded, the cone that can load a register, the commits
      │  phase 2: the reactions as Figma actions, drawing, screen, plugin
      ▼
Figma: drawn chart + variables + reactions
```

Rules from `silicon/docs/SILICON.md` §1–2 hold: the only primitives are `gate/BUF NOT AND OR NAND
NOR XOR XNOR`; registers are latches made of gates (silicon's `DFFE`: master EN = ¬CLK·LOAD, slave
EN = CLK); one tick is CLK low then high, state changes on the rising edge; every LOAD and D comes
from register outputs and top inputs through combinational logic only; top inputs change only while
CLK is high.

## 1. The hardware target of the flow (`src/editor.ts`, `src/spec.ts`)

`buildEditor({ target: "hardware", omit?: Feature[] })` returns an `Editor` (same type) whose:

- `K` is 1: geometry is in cells.
- every `VarDecl` has a `role` (`src/ir.ts` `Role`); every num variable whose role is state, temp,
  input or const has `bits` and `signed`, wide enough for every value the reducer produces while
  ids stay below 256 and every box stays within cells -2048 … 2047. (No width holds every session:
  the reducer's ids grow without bound, and a frame that sticks out past the canvas edge lets align
  place a layer further out each time. `test/support.ts`'s `Runner` rejects any write, temps
  included, that does not fit its width.);
- the canvas events are three generic events `pointer#down`, `pointer#enter`, `pointer#up` that
  read the input variables `in/px`, `in/py` (role input, unsigned 4 bits: the window cell) instead
  of a per-cell literal. `v/x`, `v/y` (the window corner) have role const, value 0;
- every other event has the same id and the same behaviour as in the word-level target;
- `align`'s floor-halving is a `half` step (a shift in gates) instead of the bit-peeling steps;
- helpers wrap their steps in `unit(name, …)` (`src/ir.ts`), so the chart shows named blocks:
  `align`, `copy`, `create`, `drag`, `duplicate`, `eye`, `handle`, `hit`, `new`, `nudge`,
  `parent`, `paste`, `prop`, `recolor`, `remove`, `reorder`, `select`, `span`, `style`, `tool`;
- there are no str or col variables, and no `rot` (rotation is always 0);
- `omit` drops whole feature groups from the hardware target, to measure and trim the chart:
  `"clipboard"` (meta+c/x/v and `clip/*`), `"align"`, `"style"` (stroke, shadow, opacity, radius
  events and fields). An omitted event does not exist; an omitted field is not declared.

Both targets must behave exactly like the reducer for every action the tests drive. Firing
`pointer#down` after setting `in/px = cx`, `in/py = cy` is the same as `cell/cx,cy#down`.

**Load, compute, store.** Wherever a handler computes on the selected (or hit, or parent) record,
it first copies the record's fields it needs into a scratch record (`tmp/*`, or another declared
scratch), computes on the scratch, then writes the result back under `switchOn`. Written this way,
symbolic execution produces one copy of the arithmetic plus a read multiplexer and per-slot write
enables, instead of eight copies of the arithmetic. Required for: nudge, the property steppers, the
handle anchors, the drag offset at pointer down, and the parent search in align (which must loop
over all slots with a runtime `j ≠ sel` test instead of the compile-time `j !== i`). The move,
create/resize, duplicate and align's placement are written the same way.

## 2. The synthesizer (`src/gates/`)

```ts
synthesize(program: Program, opts?: SynthOptions): Synth

interface Synth {
  lib: Library;          // silicon buildCells() + the generated modules
  top: string;           // "OS"
  codes: Map<string, number>;   // event id → EVT code ≥ 1; identical handlers share a code; 0 = nothing
  evtBits: number;
  regs: Map<string, RegInfo>;   // state var → top-level register output nets, LSB first ("0"/"1" for a constant)
  inputs: Map<string, { port: string; bits: number; signed: boolean }>;            // input var → OS input port
  pokes: Record<string, number>;   // for silicon powerOn(): registers start at their init values
  stats: { gates: number; registers: number; byModule: Record<string, number> };
}
interface RegInfo { nets: string[]; bits: number; signed: boolean; init: number; bool: boolean }

class GateMachine {               // FastSim (or RefSim) wrapper used by tests
  constructor(syn: Synth, opts?: { reference?: boolean });
  readonly net: FlatNetlist;
  fire(eventId: string, inputs?: Record<string, number>): void;   // set EVT and inputs, one tick
  read(varName: string): number | boolean;                        // register bits, decoded
  reset(): void;                                                  // back to power-on
}
```

Semantics, per event (= per EVT code):

- the event's steps run symbolically on the current register values; `if` becomes a multiplexer
  on the condition; constants fold as the DAG is built; identical nodes are shared (hash-consing);
- **temp** variables start each event at 0 and are not registers; **view** variables are not
  synthesized (their writes are ignored: the display decode will compute them); **const**
  variables are their init value (a write to one must provably write that value); **input**
  variables are OS input ports; inputs a `fire` does not set keep their values;
- arithmetic is exact two's complement: an intermediate result is as wide as its exact range of
  values needs, never wider than the plain rule (add: one bit more than the wider operand; mul:
  the sum of the widths), at most 48 bits; a declared width is 1 to 32 bits, and a `set` truncates
  to it; `div` is only allowed by the constant 1; `half` is an arithmetic shift right (floor, also
  of a negative value, which `src/interp.ts` refuses);
- a register's LOAD is the OR over events of (event line AND the condition under which that event
  writes it): a value of the form `if c then x else <itself>` becomes LOAD = c, D = x, so a register
  that an event does not change does not load. That holds for a boolean register too: its merge
  stays a multiplexer, not the AND or OR it equals (`f OR c` for `if c then f = true`). D is the
  AND-OR of the per-event values (event lines are one-hot). A register no event can move from its
  initial value is a constant, not a register (its `regs` nets are "0" and "1"): proved at word
  level, and at bit level when LOAD folds to 0 or each D bit is, whenever LOAD is on, the
  register's own bit or its initial value;
- nothing recurses down a chain of multiplexers (taking the merges apart into writes, flattening
  them into AND-ORs), so the JS stack sets no limit on a run of ifs: 10,000 ifs writing three
  values to one register synthesize in under a second. Time and gates grow with the length of
  the run times the number of different values written (8,000 ifs writing 256 values: 16 s);
- every gate made while a `unit` runs belongs to that unit's module `U_<name>` (the first unit to
  create a shared node owns it; a tree of multiplexers flattened into one AND-OR belongs to its
  root's module); ports are the bits crossing module boundaries, grouped into buses
  by the node they come from. Logic outside every unit goes to `GLUE`; `EVDEC` decodes EVT. A
  module exists only if it has gates (a unit that only writes constants, or whose logic another
  unit made first, has none). Adders, comparators and multiplexers are plain gates, not silicon's
  `FULL_ADDER` or `MUX2` cells: a cell fed a constant would have gates with constant inputs inside.
  Registers are generic `REG_W<n>` cells built from silicon's `DFFE` (silicon's own REG_W3/4/8 are
  reused where the width matches).

## 3. Tests (all in `test/`, run with `npm test`)

- the synthesizer alone: small and randomly generated programs, synthesized, simulated with
  RefSim and FastSim, against the interpreter on random event sequences, each event setting a
  random part of the inputs; events share an EVT code exactly when their steps are the same, in
  the same order (`gates-programs`, `gates-random`, `gates-structure`);
- the hardware target of the editor against the reducer (the existing lockstep generator, pointer
  actions mapped to `in/px`, `in/py` and `pointer#…`), with a range check: every num variable with
  `bits` holds a value that fits after every event (`hardware`);
- the synthesized editor (`GateMachine`) against the interpreter, every state variable after every
  event, in four configurations (every feature, without style, without style and clipboard,
  without all three): random sessions, every event fired in any order, the directed scripts, a
  few hundred events on RefSim; power-on equals the program's initial values; and the events that
  leave a register alone do not load it (`gates-editor`);
- what the random sessions and the scripts reach, so that a branch cannot go uncompared: every
  tool button and shortcut, align with a parent above slot 1, every clamp an arrow key or a
  stepper hits at a canvas edge (`coverage`);
- per-event reactions (§4) against a whole tick, on random programs and on the editor
  (`gates-reactions`).

## 4. Phase 2

Started: **per-event reactions** (`src/gates/reaction.ts`, printed by `npm run gates`). Figma
needs no clock: an event's reaction ties EVT to the event's code, folds the constants that follow
(three-valued propagation over the flattened netlist), evaluates the cone of gates that feeds the
LOAD or D of every register bit whose LOAD is not constant 0, one action per gate in dependency
order, then commits each such bit (Q = LOAD ? D : Q, one action, all reading the values from
before the event). `ReactionMachine` runs exactly that and is held to the gate machine. Its cost,
per event code, is what one Figma reaction executes.

Not built yet: emitting the reactions as Figma actions, and splitting the ones over the viewer's
limit (silicon measured 501 actions per event survive and 2,001 do not; 30 of the editor's 107
codes are over 500, align at about 10,000), the display decode for the screen (window-relative
boxes as binary-weighted spacers bound to nets), drawing the chart, per-unit "run this part"
flows, and the plugin. CPU NATHAN (`silicon/nathan/`, another session) solves the same phase-2
problems for a 4-tool subset; read it for ideas, never edit it.
