; paint.asm — draw on the screen with the mouse (3×3 brush).
; Run in Turbo, then click/drag on the screen preview in the plugin panel.
; Keys pick the color (key code & 15): 0-9, j=10 k=11 l=12 m=13 n=14 o=15.

.equ COLOR, RAM                 ; current color

        LDI A, 7                ; start with white
        STA A, [COLOR]

loop:   LDA A, [KEY]            ; key pressed?
        LDI B, 0
        CMP A, B
        JZ mouse
        STA B, [KEY]            ; ack the key
        LDI B, 15               ; color = key & 15  ('0'..'9' → 0..9, 'a'..'f' → 1..6)
        AND A, B
        STA A, [COLOR]

mouse:  LDA A, [MOUSE_BTN]
        LDI B, 1
        AND A, B
        JZ loop

        LDA B, [MOUSE_X]        ; H:L = VRAM + y*128 + x
        LDA C, [MOUSE_Y]
        MOV H, C
        SHR H
        LDI D, hi(VRAM)
        ADD H, D
        MOV L, C
        LDI D, 1
        AND L, D
        JZ even
        LDI L, 0x80
even:   OR L, B
        LDA A, [COLOR]          ; 3×3 brush
        LDI C, 3
brow:   ST A, [HL]
        INHL
        ST A, [HL]
        INHL
        ST A, [HL]
        LDI D, SCREEN_W - 2     ; down one row, back two pixels
        ADD L, D
        JNC bnext
        INC H
bnext:  DEC C
        JNZ brow
        JMP loop
