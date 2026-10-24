// Minimal PNG encoder (8-bit indexed, stored deflate blocks). Used where no browser
// canvas exists (the MCP smoke test). The plugin UI uses canvas.toBlob instead.
import { MEMORY, PALETTE } from "./spec";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: Uint8Array): number[] {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 255;
    out[o++] = len >> 8;
    out[o++] = ~len & 255;
    out[o++] = (~len >> 8) & 255;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  out.set(u32(adler32(raw)), o);
  return out;
}

/** Encodes VRAM (one palette index per byte, low nibble) as a PNG upscaled by `scale`. */
export function encodeVramPng(vram: Uint8Array, scale = 2, width = MEMORY.width, height = MEMORY.height): Uint8Array {
  const w = width * scale;
  const h = height * scale;
  const raw = new Uint8Array(h * (w + 1));
  for (let y = 0; y < h; y++) {
    const row = y * (w + 1);
    const src = Math.floor(y / scale) * width;
    for (let x = 0; x < w; x++) raw[row + 1 + x] = vram[src + Math.floor(x / scale)] & 15;
  }
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 3, 0, 0, 0]);
  const plte = new Uint8Array(PALETTE.flat());
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  return new Uint8Array([
    ...sig,
    ...chunk("IHDR", ihdr),
    ...chunk("PLTE", plte),
    ...chunk("IDAT", zlibStored(raw)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}
