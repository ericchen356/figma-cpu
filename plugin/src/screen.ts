// VRAM → screen. The UI iframe has a <canvas>: it draws the 128x96 VRAM upscaled with
// nearest-neighbour (so Figma's image smoothing can't blur it), encodes a PNG and sends it
// back; the main thread turns that into the `dev/screen` image fill. One PNG in flight at a time.
import { type CPU, VRAM_END, VRAM_START } from "./cpu";

export class ScreenSync {
  private previewVersion = -1;
  private pngVersion = -1;
  private inFlightSince = 0;
  private lastPng = 0;

  constructor(
    private target: RectangleNode,
    private post: (msg: unknown) => void,
  ) {}

  /** Call after rendering a frame. minPngMs throttles how often Figma gets a new image. */
  sync(cpu: CPU, minPngMs: number) {
    const v = cpu.vramVersion;
    if (v === this.previewVersion && v === this.pngVersion) return;
    const now = Date.now();
    if (this.inFlightSince && now - this.inFlightSince > 3000)
      this.inFlightSince = 0; // UI never answered
    const wantPng =
      v !== this.pngVersion &&
      !this.inFlightSince &&
      now - this.lastPng >= minPngMs;
    if (v === this.previewVersion && !wantPng) return;
    this.previewVersion = v;
    if (wantPng) {
      this.pngVersion = v;
      this.inFlightSince = now;
      this.lastPng = now;
    }
    this.post({
      type: "vram",
      pixels: cpu.mem.slice(VRAM_START, VRAM_END + 1),
      png: wantPng,
    });
  }

  onPng(bytes: Uint8Array) {
    this.inFlightSince = 0;
    const image = figma.createImage(bytes);
    this.target.fills = [
      { type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" },
    ];
  }

  /** Forces the next sync to resend everything (e.g. after loading a program). */
  invalidate() {
    this.previewVersion = this.pngVersion = -1;
  }
}
