; an 8x8 square bouncing around the 128x96 screen, one step per TICK (0xF004). Runs forever.
; RAM: 0x4000 x, 0x4001 y, 0x4002 dx (1 or 255=-1), 0x4003 dy, 0x4004 last tick, 0x4005 colour
.org 0
        JMP main

; draw: paints the 8x8 square at (x,y) in the colour stored at 0x4005
draw:   LDA A, 0x4001   ; y
        MOV B, A
        SHR B           ; B = y>>1, carry = y&1
        LDI L, 0
        JNC even
        LDI L, 128
even:   LDA C, 0x4000   ; x
        ADD L, C        ; L = (y&1)*128 + x   (x < 128, no overflow)
        LDI H, 0x80
        ADD H, B        ; H = 0x80 + (y>>1)
        LDA A, 0x4005   ; colour
        LDI D, 8        ; rows
drow:   LDI C, 8        ; columns
dcol:   ST A
        INHL
        DEC C
        JNZ dcol
        LDI B, 120      ; 128 - 8
        ADD L, B
        JNC dnext
        INC H
dnext:  DEC D
        JNZ drow
        RET

main:   LDI A, 60
        STA A, 0x4000
        LDI A, 40
        STA A, 0x4001
        LDI A, 1
        STA A, 0x4002
        STA A, 0x4003

loop:   LDA A, 0xF004   ; wait for the next frame
        LDA B, 0x4004
        CMP A, B
        JZ loop
        STA A, 0x4004

        LDI A, 0        ; erase at the old position
        STA A, 0x4005
        CALL draw

        LDA A, 0x4000   ; x += dx
        LDA B, 0x4002
        ADD A, B
        STA A, 0x4000
        LDI C, 120      ; right wall (128-8)
        CMP A, C
        JNZ xlo
        LDI B, 255
        STA B, 0x4002
xlo:    LDI C, 0        ; left wall
        CMP A, C
        JNZ ystep
        LDI B, 1
        STA B, 0x4002

ystep:  LDA A, 0x4001   ; y += dy
        LDA B, 0x4003
        ADD A, B
        STA A, 0x4001
        LDI C, 88       ; bottom wall (96-8)
        CMP A, C
        JNZ ylo
        LDI B, 255
        STA B, 0x4003
ylo:    LDI C, 0        ; top wall
        CMP A, C
        JNZ paint
        LDI B, 1
        STA B, 0x4003

paint:  LDI A, 8        ; draw at the new position
        STA A, 0x4005
        CALL draw
        JMP loop
