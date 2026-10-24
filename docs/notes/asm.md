# asm lane notes
**Shipped:** `src/assembler/asm.ts` (two-pass; labels, `.org`, `.db`, label arithmetic, hex/bin/dec/char; opcode bytes and
operand layout come from `spec/opcodes.json` via `fmt`, no ISA constants), `programs/count.asm`, `programs/fib.asm`,
`ui/ui.{html,ts}` control panel (editor, Assemble/Load, Step/Run/Pause/Reset, Watch/Turbo + Hz, register/flag readout).
**Verified:** golden bytes per fmt class, every error class with line numbers, both programs run on the test oracle
(count: A=10; fib: 0 1 1 2 3 5 8 13 21 34 55 89 144 at 0x4000). UI checked in headless Chromium (no page errors).
**Syntax:** `LD A` and `LD A,[HL]` are the same; `LDA A,[0x4000]` brackets optional; registers A B C D H L.
**Gotcha:** `ADD` etc. reset the carry flag, so compute anything that needs the old carry first (see bounce.asm `draw`).
