; mod.asm — 100 mod 7 = 2 by repeated subtraction; OUT shows 02, then HLT.
; SUB keeps C = 1 while it does not borrow; the loop runs one subtraction too far, ADD puts it back.

        LDI R0, 100     ; dividend
        LDI R2, 7       ; divisor
loop:   SUB R0, R2
        JC loop         ; no borrow yet: subtract again
        ADD R0, R2      ; undo the last (borrowing) subtraction: the remainder
        ST R0, [OUT]
        HLT
