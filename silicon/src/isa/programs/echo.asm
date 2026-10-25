; echo.asm — OUT mirrors the input byte forever. RAM[14] is the memory-mapped input register:
; the plugin clock writes the panel's input byte there between ticks (plugin/src/devices.ts).
; 6 bytes; byte 14 must stay free (input) and 15 is OUT.

loop:   LD R0, [14]     ; R0 = input byte
        ST R0, [OUT]    ; show it
        JMP loop
