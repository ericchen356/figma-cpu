# screen lane notes
**Shipped:** `src/screen/vram.ts` (`vramToRgba` exact nearest-neighbor, `diffDirty`, `FrameLimiter` 80 ms),
`png.ts` (sandbox-safe encoder; `vramToPng(vram, 6, PALETTE)` = 4-bit indexed 768x576, ~221 KB uncompressed),
`io.ts` (`Io`: engine calls `read`/`write` for 0xF000-0xF005; undefined/false = not IO), `present.ts` (`ScreenPresenter`),
`programs/rect.asm`, `programs/bounce.asm`.
**How the engine/UI should wire it:** engine keeps VRAM at 0x8000, calls `presenter.present(vram)` once per frame (Turbo)
or per step (Watch); `encode` = `vramToPng` or the UI canvas `toBlob`; `apply` = `figma.createImage(png).hash` set as the
fill of `dev/screen`. Call `io.tickFrame()` once per presented frame.
**Verified:** exact 6x replication, PNG CRC/Adler/IHDR, IO clamp/ack/wrap/rand, frame cap, rect pixels, bounce hits all 4 walls.
**NOT done:** the actual `figma.createImage` call + engine IO delegation (needs the stepper).
