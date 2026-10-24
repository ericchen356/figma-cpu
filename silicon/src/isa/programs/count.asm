; count.asm — OUT shows 1, 2, 3, … forever (after FF it wraps to 00).
; One pass is 20 T-states: ADD 6 + ST 8 + JMP 6.

        LDI R0, 0       ; R0 = counter
        LDI R1, 1       ; R1 = step
loop:   ADD R0, R1      ; R0 = R0 + 1
        ST R0, [OUT]    ; show it
        JMP loop
