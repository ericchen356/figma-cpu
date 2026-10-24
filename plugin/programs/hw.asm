; hw.asm — FigmaCPU v2 hardware map (mirrors spec/memory-map.json). No code, constants only.
.equ VRAM,      0x8000      ; 128x96, 1 byte per pixel: VRAM + y*128 + x
.equ SCREEN_W,  128
.equ SCREEN_H,  96
.equ RAM,       0x4000      ; general RAM (the PINNED window starts here)
.equ MOUSE_X,   0xF000
.equ MOUSE_Y,   0xF001
.equ MOUSE_BTN, 0xF002      ; bit 0 = button down
.equ KEY,       0xF003      ; last key; write 0 to acknowledge
.equ TICK,      0xF004      ; +1 every frame (~30 Hz)
.equ RAND,      0xF005      ; random byte on every read
