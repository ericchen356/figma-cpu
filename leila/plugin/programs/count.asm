; count.asm — count A from 0 to 10, then halt.
; Best in Watch mode: every instruction is FETCH (T0–T2) + a few EXEC T-states.

        LDI A, 0
        LDI B, 10
loop:   INC A           ; A = A + 1, sets Z/C/N
        CMP A, B        ; flags of A - B, A is unchanged
        JNZ loop        ; until A == 10
        HLT
