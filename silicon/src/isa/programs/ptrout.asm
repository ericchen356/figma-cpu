; ptrout.asm — STR through a pointer: R1 holds the OUT address, so OUT shows 7 6 5 … 0.

        LDI R0, 7
        LDI R1, OUT     ; R1 = 15, a pointer to the OUT port
        LDI R2, 1
loop:   STR R0, [R1]    ; mem[R1] ← R0  (shows it on OUT)
        SUB R0, R2
        JC loop         ; until 0 - 1 borrows
        HLT
