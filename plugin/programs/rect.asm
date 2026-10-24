; rect.asm — a tiny "design": an artboard with three overlapping rectangles.
; Walks a shape table (x, y, w, h, colour) and calls fill_rect for each. Use TURBO.
.include "hw.asm"
        LHL shapes
next:   LD A                ; x, or FF = end of table
        LDI B, 0xFF
        CMP A, B
        JZ done
        STA A, RX
        INHL
        LD A
        STA A, RY
        INHL
        LD A
        STA A, RW
        INHL
        LD A
        STA A, RH
        INHL
        LD A
        STA A, RCOL
        INHL
        PUSH H              ; fill_rect clobbers HL
        PUSH L
        CALL fill_rect
        POP L
        POP H
        JMP next
done:   HLT

shapes: .db 8, 8, 112, 80, 1        ; dark-blue artboard
        .db 20, 20, 44, 30, 12      ; blue
        .db 46, 38, 50, 28, 8       ; red
        .db 80, 14, 30, 50, 11      ; green
        .db 0xFF

.include "gfx.asm"
