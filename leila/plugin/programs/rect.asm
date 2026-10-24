; rect.asm — fill a 40×32 red rectangle on the screen.
; VRAM is 128×96, one byte per pixel: addr = VRAM + y*128 + x.

.equ X0, 20
.equ Y0, 16
.equ W, 40
.equ HGT, 32
.equ COLOR, 8                   ; PICO-8 red

        LHL VRAM + Y0*SCREEN_W + X0
        LDI A, COLOR
        LDI D, SCREEN_W - W     ; bytes to skip to reach the next row
        LDI C, HGT
row:    LDI B, W
px:     ST A, [HL]
        INHL
        DEC B
        JNZ px
        ADD L, D                ; H:L += 128 - W  (8-bit add with carry into H)
        JNC samepage
        INC H
samepage:
        DEC C
        JNZ row
        HLT
