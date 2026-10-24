; fib.asm — Fibonacci numbers into RAM at 0x4000 until they overflow 8 bits.
; Watch them appear in the PINNED window (base 4000): 01 01 02 03 05 08 0D 15 22 37 59 90 E9
.include "hw.asm"
        LHL RAM
        LDI A, 1            ; A = f(n-1)
        LDI B, 1            ; B = f(n)
        ST A
        INHL
loop:   ST B
        INHL
        MOV C, B            ; C = f(n)
        ADD B, A            ; B = f(n+1)
        JC done             ; carry: no longer fits in a byte
        MOV A, C
        JMP loop
done:   HLT
