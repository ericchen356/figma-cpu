; hello-os.asm: the smallest "OS" for the 64-byte gate-level CPU (docs/OS-CPU-CONTRACT.md).
; One window. A key/click byte arrives in IN = RAM[62] (INPUT, poked by the plugin between ticks):
;   0x80  toggles the window open/closed  -> flag = bit 7 of RAM[63] (OUT, also the 7-seg display)
;   0x01  moves the window right one step -> x    = bits 0..6 of RAM[12] (winx)
; Branch-free: R1 accumulates the keys with XOR, R2 with ADD. XOR or ADD of 0x80 flips only bit 7;
; XOR of 0x01 never touches bit 7, and ADD of 0x01 only changes bits 0..6 (until x wraps at 128),
; so each binding reads an exact bit slice. The other bits are noise the bindings do not read:
; RAM[63] bit 0 is the parity of move presses, RAM[12] bit 7 is the open flag again.
; Why the flag lives in OUT and not in its own data byte: it was written for the 16-byte CPU, where
; LD + consume + JMP + 3 stores (14 bytes of code) did not leave room for a flag byte, an x byte and OUT.
; R3 is never written, so it stays 0 and is the "consumed" value (contract §4: 0 = consumed).
; Known race: a byte poked after LD reads IN (T6) and before the consume ST writes it (T7 of
; the next instruction) is overwritten with 0 and lost; the plugin should only poke when IN
; already reads 0 and re-send if the state did not change. 12 bytes of code + 1 data byte.

loop:   LD  R0, [IN]     ; R0 = input byte (0 = nothing)
        ST  R3, [IN]     ; consume it right away
        XOR R1, R0       ; flag: 0x80 flips bit 7
        ADD R2, R0       ; x:    0x01 adds one to bits 0..6
        ST  R2, [winx]   ; window x byte (data)
        ST  R1, [OUT]    ; window-open flag byte = OUT, shown on the display
        JMP loop         ; 50 ticks per loop

        .org 12
winx:   .db 0            ; window x (bits 0..6)
; IN (62) and OUT (63) are predefined by the assembler.
