; sub.asm — count down 5 4 3 2 1 0 on OUT; stop once SUB borrows (C = 0).

        LDI R0, 5
        LDI R1, 1
loop:   ST R0, [OUT]    ; show R0
        SUB R0, R1      ; R0 -= 1   (C = 1: no borrow; 0 - 1 borrows, C = 0)
        JC loop
        HLT
