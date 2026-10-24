// LANE: screen. Dependency-free PNG encoder (zlib STORE blocks, no compression) that runs in Node, the UI iframe
// and the Figma plugin sandbox (no Buffer / node imports). In production the UI uses canvas.toBlob; this is the
// sandbox-safe fallback and the thing the tests can check byte for byte.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(buf: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32(crc32(out, 4, 8 + data.length)), 8 + data.length);
  return out;
}

function zlibStore(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const s = b * 65535, e = Math.min(raw.length, s + 65535), len = e - s;
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 255; out[o++] = len >> 8;
    out[o++] = ~len & 255; out[o++] = (~len >> 8) & 255;
    out.set(raw.subarray(s, e), o);
    o += len;
  }
  out.set(u32(adler32(raw)), o);
  return out;
}

function assemblePng(w: number, h: number, depth: number, colorType: number, scanlines: Uint8Array, extra: Uint8Array[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(w), 0); ihdr.set(u32(h), 4);
  ihdr[8] = depth; ihdr[9] = colorType;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", zlibStore(scanlines)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 8-bit RGBA, filter 0 on every row. */
export function encodePng(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  if (rgba.length !== w * h * 4) throw new Error(`rgba length ${rgba.length} != ${w}x${h}x4`);
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
  return assemblePng(w, h, 8, 6, raw, []);
}

/** 4-bit indexed (16 colors): ~8x smaller than RGBA for the same upscaled screen. indices = one palette index per pixel. */
export function encodePngIndexed(indices: Uint8Array, w: number, h: number, palette: readonly string[]): Uint8Array {
  if (indices.length !== w * h) throw new Error(`indices length ${indices.length} != ${w}x${h}`);
  const rowBytes = Math.ceil(w / 2);
  const raw = new Uint8Array(h * (1 + rowBytes));
  for (let y = 0; y < h; y++) {
    const base = y * (1 + rowBytes) + 1;
    for (let x = 0; x < w; x++) raw[base + (x >> 1)] |= (indices[y * w + x] & 15) << (x & 1 ? 0 : 4);
  }
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((hx, i) => {
    const n = parseInt(hx.slice(1), 16);
    plte[i * 3] = (n >> 16) & 255; plte[i * 3 + 1] = (n >> 8) & 255; plte[i * 3 + 2] = n & 255;
  });
  return assemblePng(w, h, 4, 3, raw, [chunk("PLTE", plte)]);
}

/** VRAM -> upscaled 4-bit indexed PNG straight from palette indices (no RGBA detour). */
export function vramToPng(vram: Uint8Array, scale: number, palette: readonly string[], vw = 128, vh = 96): Uint8Array {
  const w = vw * scale, h = vh * scale;
  const idx = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < w; x++) idx[y * w + x] = vram[sy * vw + Math.floor(x / scale)] & 15;
  }
  return encodePngIndexed(idx, w, h, palette);
}
