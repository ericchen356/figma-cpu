# FigmaCPU Silicon — a gate-level CPU that Figma itself computes

## 1. Principle

- **The only logic primitives are 2-input gates** (`AND OR NAND NOR XOR XNOR`) plus `NOT` and `BUF`. Every other part is a circuit made of gates, including latches, flip-flops, adders, registers, RAM, the ALU, the control unit and the CPU. There is no "flip-flop" or "adder" in code.
- **Each circuit is a Figma component.** A `FULL_ADDER` component contains gate instances; `ADDER_W8` contains 8 `FULL_ADDER` instances; and so on up to `CPU`. Ports are component **TEXT properties** whose values are net names, so you wire a part by typing net names in Figma's properties panel.
- **Figma computes it.** A build-time compiler (the "fab") turns the drawn circuit into Figma **variables**, one boolean per wire, plus prototype **SET_VARIABLE actions with AND/OR/NOT expressions**, one per gate, in evaluation order. In Present mode, clicking **Step** runs one clock cycle *inside Figma's prototype engine*. No plugin code runs at run time; plugin code only builds and checks the circuit.
- **Code is the fab and the test bench, never the CPU.** TypeScript describes circuits (`src/hdl`), draws them, compiles them, and tests them against a reference model. The canvas is the source of truth: the compiler reads circuits **off the canvas**, so editing a component changes the machine.

Run-time targets (same compiled schedule):

| Target | Purpose |
|---|---|
| **Figma prototype** (variables + actions) | The real thing: Figma's engine evaluates the gates |
| `FastSim` (JS, `src/compile`) | Tests, and an optional fast-run mode in the plugin |
| `RefSim` (JS, `src/sim/reference.ts`) | Golden reference: naive iterate-until-stable |

## 2. Clock and timing (all lanes must follow this)

- One global net **`CLK`**, an explicit top-level input wired down to every sequential cell.
- **One tick = LOW pass then HIGH pass.** Set CLK=0 and settle, then set CLK=1 and settle. State changes on the **rising edge**.
- **`DLATCH`** (feedback mux): `Q = D·EN + Q·¬EN`, 4 gates.
- **`DFF`**: master `DLATCH` with `EN = ¬CLK` (transparent while low), then slave `DLATCH` with `EN = CLK`.
- **`DFFE`** (load-enable flip-flop): master `EN = ¬CLK·LOAD`, slave `EN = CLK`. When LOAD=0 the master keeps the value it captured, which equals Q, so Q holds.
- **Design rules** that keep evaluation well defined:
  1. Every feedback loop goes through a latch.
  2. Control signals feeding a master enable or a RAM write enable must come from flip-flop outputs and combinational logic only. They are stable during the LOW pass.
  4. **Setup time:** top-level inputs (RESET, switches) may only change while CLK is high, and must settle before the next tick, as in real hardware. RefSim evaluates in netlist order and would otherwise show a transient glitch through RESET → CONTROL → master enables. The prototype's Reset button restores the power-on state instead of pulsing RESET.
  3. RAM bits are `DLATCH`es written only during the LOW pass (`EN = ¬CLK·WE·row`), with data from the MDR flip-flops. RAM reads go into MDR through its master during the LOW pass. This breaks every RAM↔bus loop by clock phase.

## 3. Netlist contracts (implemented: `src/netlist/types.ts`, `src/netlist/flatten.ts`, `src/hdl/builder.ts`)

- `ModuleDef { name, ports: PortDef[], instances: InstanceDef[] }`. Primitive cells are named `gate/<TYPE>` with inputs `A` (`B`) and output `Y`.
- `InstanceDef.conn`: child port name → parent nets, LSB first. Net names are `"0"`/`"1"` (constants), port bits (`D`, `D[3]`), or internal names.
- `flatten(lib, top)` → `FlatNetlist`: gates with net ids, `netNames`, `aliases` (every hierarchical name → id, e.g. `regs/r0/b3/master/Q`), `ports`, `driver`. It rejects multiple drivers and undriven reads.
- Builder: `define(lib, name, {in:{D:8,...}, out:{Q:8}}, b => { b.AND(x, y, out?); b.use("DFFE", {D, LOAD, CLK, Q}, "inst"); b.reduce("OR", nets) })`.
- `RefSim(net)`: `set(port, n)`, `get(port)`, `peek(name, width)`, `poke(name, v, width)`, `settle()`, `tick()`.

## 4. Generic cell library (`src/cells/` — lane B)

Exact names and ports; other lanes depend on them. All are built from gates or from cells listed above them.

| Module | Inputs | Outputs | Notes |
|---|---|---|---|
| `DLATCH` | D, EN | Q | feedback mux, 4 gates |
| `DFF` | D, CLK | Q | rising edge |
| `DFFE` | D, LOAD, CLK | Q | master EN = ¬CLK·LOAD |
| `REG_W3` / `REG_W4` / `REG_W8` | D[n], LOAD, CLK | Q[n] | n × DFFE |
| `MUX2` | A, B, S | Y | S=0 → A |
| `MUX2_W4` / `MUX2_W8` | A[n], B[n], S | Y[n] | |
| `MUX4_W8` | A[8], B[8], C[8], D[8], S[2] | Y[8] | |
| `HALF_ADDER` | A, B | S, CO | |
| `FULL_ADDER` | A, B, CI | S, CO | |
| `ADDER_W8` | A[8], B[8], CI | S[8], CO | ripple |
| `INC_W3` / `INC_W4` | A[n] | Y[n], CO | +1 |
| `DEC2` / `DEC3` / `DEC4` | A[k], EN | Y[2^k] | one-hot, all 0 when EN=0 |
| `ZERO_W8` | A[8] | Z | Z=1 iff A=0 |
| `HEX7SEG` | A[4] | SEG[7] | segments a..g = SEG[0..6], hex 0–F |

`src/cells/index.ts` exports `buildCells(lib: Library): void`, which defines all of the above.

## 5. CPU (lanes D1 + D2) — the handoff architecture, `src/isa/spec.ts` is the truth

- Datapath (D1, `src/cpu/datapath.ts`):
  - `ALU`: inputs A[8], B[8], SEL[3], SUB → outputs Y[8], CO, Z, N.
    - SEL: 0 = adder (SUB=1 → A + ¬B + 1), 1 = AND, 2 = OR, 3 = XOR, 4 = NOT A.
    - CO is the adder carry when SEL=0, else 0.
  - `REGFILE`: inputs D[8], WSEL[2], WE, RSEL[2], CLK → outputs Q[8] plus R0..R3[8] for display.
  - `RAM<2^N>` (`RAM64` for N = `RAM_ADDR_BITS` = 6): inputs ADDR[N], DIN[8], WE, CLK → output DOUT[8], following the RAM rule in §2.
  - `PC<N>`, `TSTATE` (3-bit counter with T_RESET and RESET), the bus (AND-OR of the drivers, plus `ONE_OUT` for LDRI's +1), `OUTPORT` (8-bit register plus two `HEX7SEG`).
- Control (D2, `src/cpu/control.ts`): `CONTROL`, a sum-of-products PLA **generated from `OPCODES` in `src/isa/spec.ts`**.
  - Inputs: OP[4] (= IR[7:4]), T[3], Z, C, N, HALTED, RESET.
  - Outputs: one per `SIGNALS` entry, plus ALU_SEL[3] and ALU_SUB.
  - All outputs are 0 when HALTED or RESET.
- Top (D2, `src/cpu/cpu.ts`): `CPU`, inputs CLK and RESET; outputs OUT[8] and SEG_LO[7], SEG_HI[7].
  - Synchronous RESET: T → 0, PC → 0, HALTED → 0.
- **Probes contract** (`src/cpu/probes.ts`, D2 owns it, everyone else reads it). It exports `PROBES: Record<string, { name: string; width: number }>` with keys `PC MAR MDR IR R0 R1 R2 R3 A Y Z C N T HALTED OUT BUS`, plus `ramBit(addr, bit): string`, the hierarchical name of the RAM latch output for that bit, used to preload programs.
- `buildCpu(lib)` defines every CPU module, assuming `buildCells(lib)` already ran. `cpuNetlist()` returns `flatten(lib, "CPU")`.

## 6. ISA tooling (lane C, `src/isa/`)

- `asm.ts`: `assemble(src) → { bytes: number[16], errors, symbols }`.
  - Syntax: `LDI R0, 5`, `ST R1, [15]`, labels, `.db`, `;` comments.
  - Encoding comes from `OPCODES` operand lists.
- `model.ts`: `class IsaModel`, a behavioral **T-state-accurate** model. It executes the microcode table signal by signal with the same bus/latch semantics as §5, and exposes the same state as `PROBES`. The gate-level CPU must match it tick for tick.
- `programs/*.asm`: `count` (OUT shows 1, 2, 3…), `mul` (6×7 = 42 → OUT), `fib` (Fibonacci on OUT until carry), plus small per-instruction tests.

## 7. Compiler (lane A, `src/compile/`)

- `compile(net) → Schedule`:
  - `{ passes: [{ clk: 0, order: number[] }, { clk: 1, order: number[] }], sccs: number[][] }`. `order` lists gate indices, with feedback groups repeated as needed.
  - Algorithm: per pass, propagate the constant CLK level (three-valued) to find dead gate inputs (AND/NAND input dead if the other input is const 0; OR/NOR if const 1; all inputs dead if the output is constant). Find strongly connected components of the live graph (Tarjan), topologically order the components, and repeat each cyclic component's gates enough times to settle.
- `FastSim(net, schedule)`: same API as `RefSim`. It must match `RefSim` on every tick for random stimuli and for the whole CPU.
- Report stats: actions per tick, which is the cost in Figma.

## 8. Figma canvas (lane E, `src/figma/`)

- Page **`Silicon · Gates`**: main components `gate/AND` … `gate/BUF`. Each has:
  - an ANSI-style symbol, drawn as a vector from SVG;
  - pin markers `pin/A`, `pin/B`, `pin/Y`;
  - TEXT properties `A`, `B`, `Y`, each holding a net name;
  - a hidden layer `lit` (an output highlight; the prototype compiler binds its visibility to the Y net).
- Page **`Silicon · Cells`**: one main component per ModuleDef, named `cell/<NAME>`.
  - Children are instances named after `InstanceDef.name`. Ports are TEXT properties with comma-separated net lists, LSB first, with the range shorthand `bus[0:7]` allowed.
  - Port markers `port/<in|out>/<NAME>/<width>`. Wires are vectors `wire/<net>`, with a hidden `wire/<net>/lit` copy.
  - Layout: logic-depth columns, readable.
- Page **`Silicon · CPU`**: the `cell/CPU` main component.
- `draw(lib)` and `extract(pages) → Library` must round-trip exactly. Tested with a fake Figma API in Node.
- Constraints: no `figma.notify`, use `setCurrentPageAsync`, load fonts before writing text, stay under 50k chars per MCP call (prefer the dev plugin).

## 9. Prototype compiler (lane F, `src/prototype/`)

- `plan(net, schedule, opts) → PrototypePlan`, pure data:
  - `variables`: one per non-constant net, with an initial value (RAM preload comes from `ramBit`).
  - `tick`: action list `[set CLK=0, …LOW pass gates…, set CLK=1, …HIGH pass gates…]`. Each gate action is `{ set: net, to: Expr }`, where `Expr` is var / const / not / and / or / eq / neq. NAND = not(and), XOR = neq, XNOR = eq.
  - Controls: Step, Run (two frames looping with AFTER_TIMEOUT, stopping when HALTED), Reset.
- `interpret(plan, state)` executes a plan in JS. Tests must show it equals `FastSim`.
- `apply(figma, plan, bindings)`: creates the variable collection `Silicon` (names `net/<hier>`), binds `lit` visibility to the nets, and builds control buttons with `setReactionsAsync` (`SET_VARIABLE` with `EXPRESSION` values, `CONDITIONAL`).
- **Spike first**: `silicon/spike/` is a stand-alone dev plugin that builds a small gate-level counter plus a configurable stress test (N gate actions per tick) as a prototype. The user runs it in Figma desktop Present mode to measure ticks per second before we scale up.

## 10. Rules for every lane

- Own only your files; read others'. If you need a shared contract changed, report it rather than editing someone else's file.
- **Don't commit or touch git.** The integrator commits.
- `npm test` and `npm run typecheck` in `silicon/` must pass for your files. Add tests for everything you build.
- Keep code idiomatic and commented like the existing files; no ISA or CPU behavior hidden in runtime code.
