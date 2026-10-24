// LANE: screen. VRAM (12288 bytes, low nibble = PICO-8 index) -> RGBA at `scale`x with nearest-neighbor.
// The UI iframe then does canvas -> toBlob('image/png') -> posts bytes back as { type: "screen-png" }.
import { MEM, PALETTE } from "../contracts/spec";

const W = MEM.vramW, H = MEM.vramH;

const RGB = PALETTE.map((h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
});

export const screenSize = (scale: number) => ({ width: W * scale, height: H * scale });

/** Exact pixel replication, no smoothing: Figma smooths scaled image fills, so we upscale BEFORE encoding. */
export function vramToRgba(vram: Uint8Array, scale: number): Uint8ClampedArray {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`scale must be a positive integer, got ${scale}`);
  if (vram.length < W * H) throw new Error(`vram needs ${W * H} bytes, got ${vram.length}`);
  const ow = W * scale;
  const out = new Uint8ClampedArray(ow * H * scale * 4);
  for (let y = 0; y < H; y++) {
    const rowStart = y * scale * ow * 4;
    for (let x = 0; x < W; x++) {
      const c = RGB[vram[y * W + x] & 15];
      let o = rowStart + x * scale * 4;
      for (let dx = 0; dx < scale; dx++, o += 4) {
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    }
    // copy the first scaled row down for the remaining scale-1 rows
    const rowLen = ow * 4;
    for (let dy = 1; dy < scale; dy++) out.copyWithin(rowStart + dy * rowLen, rowStart, rowStart + rowLen);
  }
  return out;
}

/** Cheap dirty check so unchanged frames never trigger an image refresh. */
export function diffDirty(prev: Uint8Array | null, next: Uint8Array): boolean {
  if (!prev || prev.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) if ((prev[i] & 15) !== (next[i] & 15)) return true;
  return false;
}

/** Caps refresh rate (PRD: ~10-20 fps). Clock is injectable for tests. */
export class FrameLimiter {
  private last = -Infinity;
  constructor(private minIntervalMs = 80, private now: () => number = () => Date.now()) {}
  /** true if a refresh is allowed now (and records it). */
  tryFrame(): boolean {
    const t = this.now();
    if (t - this.last < this.minIntervalMs) return false;
    this.last = t;
    return true;
  }
}
