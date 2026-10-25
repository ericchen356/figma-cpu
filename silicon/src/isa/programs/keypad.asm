; keypad.asm — adds every key pressed into R1 and shows the running sum on OUT.
; IN (RAM[62]) is the memory-mapped input register (written by the plugin clock, devices.ts).
; A nonzero byte there is a key: it is added once, then consumed (IN ← 0), so pressing
; the same key twice adds it twice. R2 is never written, so it stays 0. 12 bytes.

loop:   LD R0, [IN]     ; R0 = input byte
        OR R0, R0       ; set Z from R0 (LD sets no flags)
        JZ loop         ; no key: keep polling
        ST R2, [IN]     ; consume the key (R2 = 0)
        ADD R1, R0      ; R1 = running sum
        ST R1, [OUT]    ; show it
        JMP loop
