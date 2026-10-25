; pow2.asm — OUT shows 01 02 04 08 10 20 40 80 (a bit marching left), then HLT when it falls off the end.
; ADD R0, R0 doubles R0; the carry flag catches the doubling of 80.

        LDI R0, 1
loop:   ST R0, [OUT]    ; show it
        ADD R0, R0      ; R0 *= 2 (C = 1 once 0x80 doubles to 0x100)
        JC done
        JMP loop
done:   HLT
