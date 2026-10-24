; fib.asm — Fibonacci numbers into RAM from 0x4000 until they overflow a byte.
; Watch the PINNED RAM window (base 4000) fill: 00 01 01 02 03 05 08 0D 15 22 37 59 90 E9

        LHL RAM         ; H:L = 0x4000
        LDI A, 0
        LDI B, 1
loop:   ST A, [HL]      ; mem[H:L] = A
        INHL
        MOV C, A
        ADD C, B        ; C = A + B, carry when > 255
        JC done
        MOV A, B
        MOV B, C
        JMP loop
done:   ST B, [HL]      ; last one that fits
        HLT
