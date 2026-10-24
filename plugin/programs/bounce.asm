; bounce.asm — a square bouncing around the screen, one pixel per frame.
; Run it in Turbo. TICK (0xF004) increments once per frame; the loop waits on it.

.equ SIZE, 8
.equ COLOR, 12                  ; PICO-8 blue
.equ PX, RAM                    ; x position
.equ PY, RAM + 1                ; y position
.equ DX, RAM + 2                ; x step: 1 or 0xFF (-1)
.equ DY, RAM + 3                ; y step

start:  LDI A, 10
        STA A, [PX]
        LDI A, 30
        STA A, [PY]
        LDI A, 1
        STA A, [DX]
        STA A, [DY]

loop:   LDI A, COLOR
        CALL draw
        LDA B, [TICK]           ; wait for the next frame
wait:   LDA C, [TICK]
        CMP C, B
        JZ wait
        LDI A, 0                ; erase
        CALL draw

        LDA A, [PX]             ; x += dx, bounce at the edges
        LDA B, [DX]
        ADD A, B
        STA A, [PX]
        LDI C, 0
        CMP A, C
        JNZ xright
        LDI B, 1
        STA B, [DX]
xright: LDI C, SCREEN_W - SIZE
        CMP A, C
        JNZ ymove
        LDI B, 0xFF
        STA B, [DX]

ymove:  LDA A, [PY]             ; y += dy, bounce at the edges
        LDA B, [DY]
        ADD A, B
        STA A, [PY]
        LDI C, 0
        CMP A, C
        JNZ ybottom
        LDI B, 1
        STA B, [DY]
ybottom:
        LDI C, SCREEN_H - SIZE
        CMP A, C
        JNZ loop
        LDI B, 0xFF
        STA B, [DY]
        JMP loop

; draw: SIZE×SIZE square of color A at (PX, PY). Clobbers B C D H L.
draw:   LDA B, [PX]
        LDA C, [PY]
        MOV H, C                ; H = 0x80 + (y >> 1)
        SHR H
        LDI D, hi(VRAM)
        ADD H, D
        MOV L, C                ; L = ((y & 1) << 7) | x
        LDI D, 1
        AND L, D
        JZ even
        LDI L, 0x80
even:   OR L, B
        LDI C, SIZE
drow:   LDI B, SIZE
dpx:    ST A, [HL]
        INHL
        DEC B
        JNZ dpx
        LDI D, SCREEN_W - SIZE
        ADD L, D
        JNC dnext
        INC H
dnext:  DEC C
        JNZ drow
        RET
