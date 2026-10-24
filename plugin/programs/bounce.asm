; bounce.asm — an 8x8 square bouncing around the screen, one step per TICK. Use TURBO.
.include "hw.asm"
.equ BX,   0x4010
.equ BY,   0x4011
.equ DX,   0x4012           ; 01 or FF (-1)
.equ DY,   0x4013
.equ LAST, 0x4014           ; last TICK we drew on
.equ SIZE, 8
.equ BG,   1                ; dark blue
.equ FG,   10               ; yellow

        LDI A, 0            ; paint the background
        STA A, RX
        STA A, RY
        LDI A, SCREEN_W
        STA A, RW
        LDI A, SCREEN_H
        STA A, RH
        LDI A, BG
        STA A, RCOL
        CALL fill_rect
        LDI A, 10
        STA A, BX
        STA A, BY
        LDI A, 1
        STA A, DX
        STA A, DY

frame:  LDI A, BG           ; erase at the old position
        CALL square
        LDA A, BX           ; x += dx, bounce off left/right
        LDA B, DX
        ADD A, B
        STA A, BX
        LDI C, 0
        CMP A, C
        JZ flipx
        LDI C, SCREEN_W - SIZE
        CMP A, C
        JNZ movey
flipx:  LDI C, 0
        SUB C, B            ; dx = -dx
        STA C, DX
movey:  LDA A, BY           ; y += dy, bounce off top/bottom
        LDA B, DY
        ADD A, B
        STA A, BY
        LDI C, 0
        CMP A, C
        JZ flipy
        LDI C, SCREEN_H - SIZE
        CMP A, C
        JNZ draw
flipy:  LDI C, 0
        SUB C, B
        STA C, DY
draw:   LDI A, FG
        CALL square
wait:   LDA A, TICK         ; one step per frame
        LDA B, LAST
        CMP A, B
        JZ wait
        STA A, LAST
        JMP frame

; square: fill a SIZE x SIZE square at (BX, BY) with colour A
square: STA A, RCOL
        LDA A, BX
        STA A, RX
        LDA A, BY
        STA A, RY
        LDI A, SIZE
        STA A, RW
        STA A, RH
        JMP fill_rect       ; tail call: fill_rect's RET returns to our caller

.include "gfx.asm"
