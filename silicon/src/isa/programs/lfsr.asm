; lfsr.asm — a pseudo-random byte generator on OUT: an 8-bit Galois LFSR (polynomial 0x11D), period 255.
; Shift left; when a 1 falls out of bit 7, XOR the feedback mask 0x1D back in. Starts 01 02 04 08 10 20 40 80 1D 3A …

        LDI R0, 1       ; state (never 0)
        LDI R3, 0x1D    ; feedback mask
loop:   ST R0, [OUT]
        ADD R0, R0      ; shift left; C = the bit that fell out
        JC fb
        JMP loop
fb:     XOR R0, R3
        JMP loop
