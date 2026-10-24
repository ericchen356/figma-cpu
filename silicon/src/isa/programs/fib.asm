; fib.asm — Fibonacci numbers on OUT until the next one overflows a byte (carry), then HLT.
; OUT: 1 1 2 3 5 8 13 21 34 55 89 144 233  (hex 01 01 02 03 05 08 0D 15 22 37 59 90 E9)

        LDI R0, 0       ; R0 = a
        LDI R1, 1       ; R1 = b
loop:   ST R1, [OUT]    ; show b
        MOV R2, R1      ; t = b
        ADD R1, R0      ; b = a + b
        JC done         ; more than 255: stop
        MOV R0, R2      ; a = t
        JMP loop
done:   HLT
