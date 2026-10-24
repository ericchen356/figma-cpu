; sub.asm — count down 5 4 3 2 1 0 on OUT; stop once the result goes negative (N = 1).

        LDI R0, 5
        LDI R1, 1
loop:   ST R0, [OUT]    ; show R0
        SUB R0, R1      ; R0 -= 1   (0 - 1 = FF: N = 1, C = 0 means borrow)
        JN done
        JMP loop
done:   HLT
