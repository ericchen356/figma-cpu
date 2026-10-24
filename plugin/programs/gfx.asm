; gfx.asm — fill_rect for the 128x96 screen.
; Parameters live at fixed RAM addresses so you can watch them in the PINNED window.
.equ RX,   0x4000           ; left   (0..127)
.equ RY,   0x4001           ; top    (0..95)
.equ RW,   0x4002           ; width  (1..128)
.equ RH,   0x4003           ; height (1..96)
.equ RCOL, 0x4004           ; palette index (0..15)

; fill_rect: paint RW x RH pixels at (RX, RY) with RCOL. Clobbers A B C D H L.
fill_rect:
        LDA D, RH           ; D = rows left
        LDA B, RY           ; B = current y
fr_row: MOV A, B
        SHR A               ; A = y >> 1, carry = y & 1
        MOV H, A
        LDI L, 0
        JNC fr_even
        LDI L, 0x80         ; odd rows start half-way into the 256-byte page
fr_even:
        LDI C, hi(VRAM)
        ADD H, C            ; H = 0x80 + (y >> 1)
        LDA C, RX
        ADD L, C            ; L = ((y & 1) << 7) + x
        LDA C, RW           ; C = columns left
        LDA A, RCOL
fr_col: ST A                ; [HL] = colour
        INHL
        DEC C
        JNZ fr_col
        INC B
        DEC D
        JNZ fr_row
        RET
