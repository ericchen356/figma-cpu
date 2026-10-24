# engine lane notes
**Shipped (all tested in Node; none run inside Figma yet):**
- `engine/microops.ts` micro-op text -> typed ops (the only place the Stage 1 vocabulary lives).
- `engine/table.ts` `readTable`: reads `cpu/decoder/table` LIVE from the canvas, never from `spec/`. Tolerant of case/space/newline/em dash; bad rows reported loudly and dropped. Real-table fixture: `test/fixtures/decoder-table.json`.
- `engine/cpu.ts` `createCpu(rows, bus)`: FETCH/DECODE/EXEC from table ops only; no opcode or mnemonic in code. Returns `StepInfo` for animation. `setTable` hot-swaps the decoder. Matches the independent oracle on count/fib/rect and bounce (identical VRAM after 120 frames). Pure core: ~10M instr/s in Node (PRD target 50k; Figma's sandbox is slower, measure there).
- `engine/render.ts` diff renderer through a `RenderPort`: writes only what changed (second identical render = 0 writes).
- `engine/runner.ts` Watch (1 instr per 1/hz s) and Turbo (25 ms slices, one canvas flush per slice). TICK advances at ~30 Hz wall time in both.
- `engine/figma-port.ts` + `main.ts`: binder, `figma.createImage` on `dev/screen`, queued text writes with font loading.
**SAFETY (do not weaken):** the port is `writable` only when bound to "Machine v2 (plugin test)". On the canvas team's "Machine v2" every write is blocked and counted (`stats.blocked`), tested to leave the node tree byte-identical.
**Real-tree test:** `test/figma-port.test.ts` runs the renderer against a fake Figma built from the real 1,104-node page: 0 unresolved names.
**Gotchas:** the canvas writes `SETHL W` (operand); `ADD` etc. reset carry; Figma needs fonts loaded before `characters=` (port queues + `flush()`).
**Still unverified (needs a human in Figma desktop once):** the plugin loads, binds, the font names used by the canvas text load, `setProperties({State})` on register instances, image fill rendering, and Turbo IPS inside Figma's sandbox.
