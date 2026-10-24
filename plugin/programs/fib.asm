; Fibonacci into RAM at 0x4000: 0 1 1 2 3 5 8 13 21 34 55 89 144 (13 values, all fit in a byte)
.org 0
        LHL 0x4000      ; H:L -> output pointer
        LDI A, 0        ; a
        LDI B, 1        ; b
        LDI D, 13       ; how many values to write
loop:   ST A            ; [HL] = a
        INHL
        MOV C, A
        ADD C, B        ; C = a + b
        MOV A, B        ; a = b
        MOV B, C        ; b = a + b
        DEC D
        JNZ loop
        HLT
