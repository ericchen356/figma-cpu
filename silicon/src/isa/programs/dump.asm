; dump.asm — walk memory with a pointer: OUT shows the bytes at 0, 1, 2, … (this program's own
; machine code first), forever. The pointer wraps around the 16 bytes of RAM.

        LDI R1, 0       ; R1 = pointer
        LDI R3, 1
loop:   LDR R0, [R1]    ; R0 ← mem[R1]
        ST R0, [OUT]
        ADD R1, R3      ; next address
        JMP loop
