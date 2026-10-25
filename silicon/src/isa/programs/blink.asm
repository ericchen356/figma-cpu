; blink.asm — OUT flips between AA and 55 forever: all eight lamps and both digits flash.

        LDI R0, 0xAA
        LDI R1, 0x55
loop:   ST R0, [OUT]
        ST R1, [OUT]
        JMP loop
