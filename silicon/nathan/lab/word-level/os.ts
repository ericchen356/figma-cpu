export const HIT = `
        LDI R7, 0
        LD  R1, R7, 0
        LD  R2, R7, 1
        LDI R4, 72
        LDI R0, -1
next:   LD  R5, R4, 0
        BEQ R5, R7, skip
        LD  R5, R4, 1
        BLT R1, R5, skip
        LD  R6, R4, 3
        ADD R5, R6
        BGE R1, R5, skip
        LD  R5, R4, 2
        BLT R2, R5, skip
        LD  R6, R4, 4
        ADD R5, R6
        BGE R2, R5, skip
        LD  R0, R4, 6
        JMP done
skip:   ADDI R4, -8
        LDI R5, 16
        BGE R4, R5, next
done:   ST  R0, R7, 2
        HLT
`;
export const MOVE = `
        LDI R7, 0
        LD  R1, R7, 0
        LD  R2, R7, 1
        LD  R3, R7, 2
        LD  R4, R7, 5
        LD  R5, R7, 6
        MOV R6, R3
        ADD R6, R6
        ADD R6, R6
        ADD R6, R6
        ADDI R6, 16
        SUB R1, R4
        BGE R1, R7, xlo
        MOV R1, R7
xlo:    LD  R4, R6, 3
        LDI R3, 14
        SUB R3, R4
        BGE R3, R1, xhi
        MOV R1, R3
xhi:    ST  R1, R6, 1
        SUB R2, R5
        BGE R2, R7, ylo
        MOV R2, R7
ylo:    LD  R4, R6, 4
        LDI R3, 10
        SUB R3, R4
        BGE R3, R2, yhi
        MOV R2, R3
yhi:    ST  R2, R6, 2
        HLT
`;
