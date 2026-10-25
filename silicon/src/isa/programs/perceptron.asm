; perceptron.asm — a trained perceptron, inferred on the gates: is a digit even, judged only by
; which of its 7 segments are lit? For every digit d = 0..9 OUT shows d·16 + the class, so 01 21
; 41 61 81 are the even digits (class 1) and 10 30 50 70 90 the odd ones (class 0).
;
; Model: score = bias + the sum of the weights of the lit segments a..g; class 1 when score ≥ 0.
; The weights were found with the perceptron rule on the ten digits and get all ten right
; (test/isa.test.ts checks every score against a JS reference).
; Input: one byte per digit, segments a..g in bits 7..1 and a 1 in bit 0 that marks the end.
; ADD R3, R3 shifts the next segment into C; the byte reaches 0 exactly when the marker leaves,
; so the loop runs 7 times. LDRI walks the weights, one per segment, lit or not.

next:   LD   R1, [cur]      ; R1 → the next digit's segment byte
        LDRI R3, [R1+]      ; R3 = segments + marker, and step the pointer
        ST   R1, [cur]
        OR   R3, R3         ; a 0 byte ends the list
        JZ   end
        LDI  R1, model
        LDRI R0, [R1+]      ; score = bias; R1 → the weight of segment a
seg:    ADD  R3, R3         ; C = this segment; Z = all 7 done
        JZ   done
        LDRI R2, [R1+]      ; R2 = its weight
        JC   lit
        JMP  seg
lit:    ADD  R0, R2         ; lit: score += weight
        JMP  seg
done:   LD   R2, [label]    ; R2 = d·16
        LDI  R3, 16
        ADD  R3, R2
        ST   R3, [label]    ; the next digit's label
        ADD  R0, R0         ; C = the sign of the score
        JC   show           ; score < 0: class 0
        LDRI R3, [R2+]      ; class 1: R2 + 1 (only the step of R2 is used)
show:   ST   R2, [OUT]
        JMP  next
end:    HLT

cur:    .db  digits
label:  .db  0
model:  .db  -1                     ; bias
        .db  -3, 1, -3, -3, 7, 3, 1 ; weights of segments a b c d e f g
digits: .db  0b11111101             ; 0  a b c d e f
        .db  0b01100001             ; 1    b c
        .db  0b11011011             ; 2  a b   d e   g
        .db  0b11110011             ; 3  a b c d     g
        .db  0b01100111             ; 4    b c     f g
        .db  0b10110111             ; 5  a   c d   f g
        .db  0b10111111             ; 6  a   c d e f g
        .db  0b11100001             ; 7  a b c
        .db  0b11111111             ; 8  a b c d e f g
        .db  0b11110111             ; 9  a b c d   f g
        .db  0                      ; end of the list
