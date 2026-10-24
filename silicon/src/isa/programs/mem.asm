; mem.asm — LD / ST on data bytes: z = x + y, read back; OUT shows 42 (hex), then HLT.

        LD R0, [x]      ; R0 = 12
        LD R1, [y]      ; R1 = 30
        ADD R0, R1      ; R0 = 42
        ST R0, [z]      ; z = 42
        LD R2, [z]      ; read it back
        ST R2, [OUT]
        HLT
x:      .db 0x12
y:      .db 0x30
z:      .db 0
