; logic.asm — bitwise ops on 0F and 3C; OUT shows 33, 30, 3C (hex), then HLT.
; (NOT is XOR with FF; its opcode now holds LDR.)

        LDI R0, 0x0F    ; R0 = 0000 1111
        LDI R1, 0x3C    ; R1 = 0011 1100
        XOR R0, R1      ; R0 = 0011 0011 = 33
        ST R0, [OUT]
        AND R0, R1      ; R0 = 0011 0000 = 30
        ST R0, [OUT]
        OR R0, R1       ; R0 = 0011 1100 = 3C
        ST R0, [OUT]
        HLT
