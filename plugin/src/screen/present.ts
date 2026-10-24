// LANE: screen. Glue between VRAM and the image fill. The UI supplies `encode` (canvas -> PNG, async) and the
// main thread supplies `apply` (figma.createImage -> fills on dev/screen). Both are injected so this is testable.
import { diffDirty, FrameLimiter } from "./vram";

export class ScreenPresenter {
  private last: Uint8Array | null = null;
  private busy = false;
  constructor(
    private encode: (vram: Uint8Array) => Promise<Uint8Array>,
    private apply: (png: Uint8Array) => void,
    private limiter = new FrameLimiter(),
  ) {}

  /** Returns true if a refresh was issued. Skips: unchanged VRAM, frame cap, or a refresh still in flight. */
  present(vram: Uint8Array, force = false): boolean {
    if (this.busy) return false;
    if (!force && !diffDirty(this.last, vram)) return false;
    if (!force && !this.limiter.tryFrame()) return false; // stays dirty: `last` not updated, retried next call
    this.last = vram.slice();
    this.busy = true;
    this.encode(this.last).then((png) => this.apply(png)).finally(() => (this.busy = false));
    return true;
  }
}
