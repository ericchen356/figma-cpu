; mul.asm — 6 × 7 = 42 by repeated addition; OUT shows 2A (= 42), then HLT.
; There is no "jump if not zero": the loop repeats while SUB does not borrow (C = 1).

        LDI R0, 0       ; R0 = product
        LDI R1, 6       ; R1 = multiplicand
        LDI R2, 7-1     ; R2 = passes left after this one (7 in all)
        LDI R3, 1
loop:   ADD R0, R1      ; product += 6
        SUB R2, R3      ; R2 -= 1; C = 1 (no borrow) unless R2 was 0
        JC loop
        ST R0, [OUT]    ; OUT = 42
        HLT
