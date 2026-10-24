; count A from 0 to 10, then halt. Watch mode: narrate fetch / decode / execute.
.org 0
        LDI A, 0
        LDI B, 1        ; step
        LDI C, 10       ; limit
loop:   ADD A, B
        CMP A, C
        JNZ loop
        HLT
