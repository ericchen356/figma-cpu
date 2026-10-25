; echo.asm — OUT mirrors the input byte forever. IN (RAM[62]) is the memory-mapped input register:
; the plugin clock writes the panel's input byte there between ticks (plugin/src/devices.ts).
; 6 bytes; byte 62 (IN) must stay free and 63 is OUT.

loop:   LD R0, [IN]     ; R0 = input byte
        ST R0, [OUT]    ; show it
        JMP loop
