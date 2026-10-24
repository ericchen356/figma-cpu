; copy.asm — copy a byte through two pointers, then read it back: OUT shows 5A, then HLT.

        LDI R1, src     ; R1 → source byte
        LDI R2, dst     ; R2 → destination byte
        LDR R0, [R1]    ; R0 ← mem[src]
        STR R0, [R2]    ; mem[dst] ← R0
        LDR R3, [R2]    ; read the copy back
        ST R3, [OUT]
        HLT
src:    .db 0x5A
dst:    .db 0
