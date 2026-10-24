; paint.asm — draw with the mouse on the plugin's screen preview. Use TURBO.
; Keys 0-9 (or the palette swatches in the plugin panel) pick the colour.
.include "hw.asm"
.equ COLOR, 0x4010
.equ BRUSH, 2

        LDI A, 7            ; start with white
        STA A, COLOR
loop:   LDA A, KEY          ; colour change?
        LDI B, 0
        CMP A, B
        JZ mouse
        LDI B, 15
        AND A, B
        STA A, COLOR
        LDI A, 0
        STA A, KEY          ; acknowledge the key
mouse:  LDA A, MOUSE_BTN
        LDI B, 1
        AND A, B
        JZ loop
        LDA A, MOUSE_X
        STA A, RX
        LDA A, MOUSE_Y
        STA A, RY
        LDI A, BRUSH
        STA A, RW
        STA A, RH
        LDA A, COLOR
        STA A, RCOL
        CALL fill_rect
        JMP loop

.include "gfx.asm"
