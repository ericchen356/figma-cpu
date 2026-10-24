# engine lane notes
**Shipped:** `src/engine/microops.ts` (micro-op text -> typed ops; the only place the Stage 1 vocabulary lives),
`src/engine/table.ts` (`readTable` reads `cpu/decoder/table` LIVE from the canvas, never from `spec/`; tolerant of case,
spaces, newlines, em dash; every bad row is reported with its op + mnemonic and dropped, others still work),
`src/main.ts` (binds to "Machine v2 (plugin test)" else "Machine v2", reports missing nodes + table problems).
**Test fixture:** `test/fixtures/decoder-table.json` is the REAL table pulled from the Figma file (29 rows). Drift tests edit it.
**Gotcha:** the canvas writes `SETHL W` (with operand); the parser accepts that and bare `SETHL`.
**NOT done (the critical path):** `createCpu` stepper (FETCH/DECODE/EXEC over parsed `ops`), diff renderer, Watch highlights, Turbo.
`test/helpers/oracle.ts` is an independent interpreter for tests; the real stepper must produce identical results on
count/fib/rect/bounce (`test/programs.test.ts` shows the expected end states).
