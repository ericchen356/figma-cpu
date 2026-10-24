# Stage Log — FigmaCPU

An 8-bit CPU built inside Figma, one reproducible stage at a time.

**How to read this:** every stage is a git tag. `git checkout stage-N` puts the repo exactly where that stage ended. Every entry uses the same template: Goal → Inputs → Figma work → Prompts used → Code → Reproduce → Verify → Gotchas. Screenshots live in [`docs/stages/`](docs/stages/).

**Figma file:** https://www.figma.com/design/l2JmsK7AEQkfo3Cvx67NgN/Untitled
**Tool tags:** `[Design]` Figma Design · `[MCP]` Figma MCP / agent writes · `[Make]` Figma Make · `[Code]` repo code

---

## Stage 0 — v1 CPU from prototype variables + the PRD (tag: `stage-0`)

**Goal:** prove that "a CPU inside Figma" can be built with zero code, and lock the plan for the real build.

**Inputs:** an empty Figma file and the CalHacks track descriptions (Best Figma Workflow, Best Stage Log).

**Figma work:** `[Design]` Page 1 → frame `Main`: registers, flags, controls, and a 16-word memory. Everything is bound to 122 local variables in a `CPU` collection: `pc`, `acc`, `irOp`, `op0…15`, `arg0…15`, `b0…b7`, `at0…15`, and so on. It was built in Figma Design before this log started. Its instruction set is an accumulator machine (`1 LDA · 2 ADD · 3 SUB · 4 STA · 5 LDI · 6 JMP · 7 JC · 8 JZ · 14 OUT · 15 HLT`), preloaded with a counter program.

**Prompts used:**

- Kickoff (verbatim): _"Im trying to create a cpu in figma ask me quesitons to create a prd file documenting how thsi project should actually go …"_
- The interview answers are captured as locked decisions in [PRD.md §3](PRD.md).
- Rescope (verbatim): _"Can you rescope to just CPU and no like figma.com yet? but also create lika visualization rectangle to show where we need add shit -> also a bigger screen would be so muc nicer"_

**Code:** [`PRD.md`](PRD.md), [`tools/layout-slots/`](tools/layout-slots/) (a dev plugin that draws dashed placeholder frames).

**Reproduce:**

1. Open the Figma file → Page 1.
2. Read `PRD.md`.

**Verify:** ![v1](docs/stages/stage-0-v1.png)

**Gotchas:**

- Prototype variables can _hold_ CPU state, but executing anything needs a conditional branch for every opcode × memory slot. That stops scaling at about 16 words, and the v1 interactions were never wired.
- That limit is the reason for v2: keep the CPU's **logic on the canvas** (as a micro-op table) and move only the "physics" into a plugin.

---

## Stage 1 — One spec to rule them all   (tag: `stage-1`)

**Goal:** a single machine-readable definition of the ISA, palette and memory map. The canvas drawing, the assembler and the tests are all generated from or checked against it.

**Inputs:** PRD §6 (ISA) and §8 (memory map).

**Figma work:** none. This stage feeds Stage 2.

**Prompts used:** *"start drawing the entire cpu out try to one shot the PRD. CREATE A PLAN TO ONESHOT THE PRD CPU SPECS"* → the approved plan locked the open questions:
- palette = PICO-8;
- v2 goes on a new page;
- registers are encoded as `rd<<4 | rs`;
- a fixed micro-op vocabulary.

**Code:**
- [`spec/opcodes.json`](spec/opcodes.json): 29 opcodes, each with `op | mnem | fmt | micro`.
- [`spec/palette.json`](spec/palette.json)
- [`spec/memory-map.json`](spec/memory-map.json)

**Micro-op vocabulary** (the only behavior written in code; everything else is data on the canvas):

| micro-op | meaning |
|---|---|
| `REG` | read the register byte: `rd = b>>4`, `rs = b&15` |
| `IMM8` / `IMM16` | read an immediate into `T` / `W` (little-endian) |
| `SET r T` · `COPY r r` | register writes |
| `LOAD r HL\|W` · `STORE r HL\|W` | memory access |
| `SETHL W` · `INCHL` | the H:L pointer |
| `ALU op r [r]` | ADD SUB AND OR XOR CMP INC DEC SHL SHR |
| `JUMP W [Z\|NZ\|C\|NC\|N\|NN]` | control flow |
| `PUSH r` · `POP r` · `PUSHPC` · `POPPC` | stack |
| `HALT` | stop |

FETCH (`IR ← mem[PC]; PC++`) runs before every instruction.

**Reproduce:** `git checkout stage-1 && cat spec/opcodes.json`

**Verify:** `node -e "console.log(require('./spec/opcodes.json').opcodes.length)"` prints `29`.

**Gotchas:** register operands are packed into one byte, so every register instruction has a fixed size. That keeps the two-pass assembler trivial.
