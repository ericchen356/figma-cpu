; count.asm — count A up to 10 with ADD, then halt. Best in WATCH mode.
; Live demo: on the canvas, change the MICRO-OPS of row 20 (ADD) to
;     REG; ALU SUB rd rs
; and run it again: the same bytes now count DOWN (00, FF, FE, ... 0A).
        LDI A, 0
        LDI B, 1            ; step
        LDI C, 10           ; target
loop:   ADD A, B
        CMP A, C
        JNZ loop
        HLT
