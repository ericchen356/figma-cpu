# CONTRACTS — frozen interfaces between lanes

The canvas team owns `spec/`, `tools/` and the Figma file. **We own `plugin/`.**
Read-only for every lane: `plugin/src/contracts/*`. Need a change? Ask in the group chat. ONE person edits
`plugin/scaffold`, everyone else rebases.

| Contract | File | Source of truth |
|---|---|---|
| Node names | `plugin/src/contracts/nodes.ts` | what `tools/draw-machine/draw.js` really draws (PRD §4.2 is the intent) |
| Messages UI↔main | `plugin/src/contracts/messages.ts` | this repo |
| ISA, memory map, palette | `plugin/src/contracts/spec.ts` ← `spec/*.json` | canvas team (Stage 1) |
| Micro-op vocabulary | STAGELOG Stage 1 | REG IMM8 IMM16 SET COPY LOAD STORE SETHL INCHL ALU JUMP PUSH POP PUSHPC POPPC HALT |

If the canvas team renames a node or changes `spec/`, they tell us and we update `nodes.ts` and re-run tests.
The binder reports missing names at plugin start, so drift is visible immediately.

## Lanes (our side), one branch and worktree each

| Lane | Branch | Owns | Must not edit |
|---|---|---|---|
| engine | `lane/engine` | `plugin/src/engine/`, `plugin/src/main.ts` | contracts, `ui/`, assembler, screen |
| asm | `lane/asm` | `plugin/src/assembler/`, `plugin/ui/`, `plugin/programs/` | contracts, engine, screen |
| screen | `lane/screen` | `plugin/src/screen/`, STAGELOG entries for stages 6/7 | contracts, engine, assembler |

Shared: `docs/notes/<lane>.md` (each lane's notes: what shipped, prompts, gotchas). The screen lane folds them into
STAGELOG.md in the PRD §13 format.
Merge: lane → `plugin/scaffold` when the lane's exit criterion passes, then `plugin/scaffold` → `main` by PR.

## Exit criteria
- **engine:** hand-loaded `LDI/ADD/JMP/HLT` steps on the canvas; behavior read from `cpu/decoder/table`, no ISA constants in code; Turbo ≥ 50k IPS.
- **asm:** `count.asm` and `fib.asm` assemble to golden bytes and run correctly end to end; controls + register readout work.
- **screen:** `rect.asm` draws crisp pixels via one image fill; IO (TICK/RAND/mouse/key) works; `bounce.asm` runs.

## Handoff: how anyone tests it
```bash
git checkout plugin/scaffold && cd plugin && npm ci && npm run build
# Figma desktop -> Plugins -> Development -> Import plugin from manifest -> plugin/manifest.json
# open the Machine v2 page, run FigmaCPU. The UI shows "bound N nodes, M missing".
npm test        # pure-Node tests (assembler, cpu core, vram)
```
Only ONE person drives the plugin against the shared Figma file at a time.

## Test page (do not run the engine on the canvas team's page)
Run the dev plugin `tools/clone-test-page/manifest.json` once (Figma desktop -> Plugins -> Development -> Import plugin
from manifest). It copies page "Machine v2" to "Machine v2 (plugin test)"; the plugin binds to that page when it exists.
Canvas team changes? Delete the test page and run the cloner again.
