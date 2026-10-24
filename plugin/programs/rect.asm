; fill an 80x40 rectangle at (20,20) with colour 8 (red), then halt.
; VRAM address = 0x8000 + (y<<7) + x ; (20,20) -> 0x8A14. After each 80-pixel row, skip 128-80 = 48.
.org 0
        LHL 0x8A14
        LDI A, 8        ; colour
        LDI D, 40       ; rows
        LDI B, 48       ; gap to the next row
row:    LDI C, 80       ; columns
col:    ST A
        INHL
        DEC C
        JNZ col
        ADD L, B        ; HL += 48
        JNC next
        INC H
next:   DEC D
        JNZ row
        HLT
