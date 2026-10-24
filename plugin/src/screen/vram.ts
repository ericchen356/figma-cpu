// LANE: screen. VRAM (12288 bytes, low nibble = PICO-8 index) -> RGBA at `scale`x with nearest-neighbor.
// The UI iframe then does canvas -> toBlob('image/png') -> posts bytes back as { type: "screen-png" }.
import { MEM } from "../contracts/spec";

export function vramToRgba(_vram: Uint8Array, _scale: number): Uint8ClampedArray {
  void MEM;
  throw new Error("screen lane: vramToRgba not implemented");
}
