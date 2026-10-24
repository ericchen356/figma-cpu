; triangle.asm — triangular numbers on OUT: 1 3 6 10 15 21 28 … 253, then HLT when the next would overflow.
; n counts 1, 2, 3 …; sum += n each pass.

        LDI R0, 0       ; R0 = sum
        LDI R1, 0       ; R1 = n
        LDI R2, 1       ; R2 = the constant 1
loop:   ADD R1, R2      ; n += 1
        ADD R0, R1      ; sum += n   (C = 1 means it passed 255)
        JC done
        ST R0, [OUT]    ; show it
        JMP loop
done:   HLT
