// Minimal PNG encoder: 8-bit indexed colour, nearest-neighbour upscale, uncompressed
// ("stored") deflate blocks. Used where there's no UI <canvas> to encode with (the
// headless use_figma verify run). The UI path in screen.ts produces smaller files.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++)
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class Bytes {
  buf: Uint8Array;
  len = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
  }
  u8(v: number) {
    this.buf[this.len++] = v & 0xff;
  }
  u32(v: number) {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }
  bytes(b: ArrayLike<number>) {
    this.buf.set(b as ArrayLike<number>, this.len);
    this.len += b.length;
  }
  chunk(type: string, data: Uint8Array) {
    this.u32(data.length);
    const start = this.len;
    for (let i = 0; i < 4; i++) this.u8(type.charCodeAt(i));
    this.bytes(data);
    this.u32(crc32(this.buf, start, this.len));
  }
}

/** pixels: one palette index per pixel (w*h). palette: "#RRGGBB" strings. */
export function encodePng(
  pixels: Uint8Array,
  w: number,
  h: number,
  palette: string[],
  scale: number,
): Uint8Array {
  const W = w * scale;
  const H = h * scale;
  const rowLen = W + 1; // filter byte + indices
  const raw = new Uint8Array(rowLen * H);
  for (let y = 0; y < H; y++) {
    const src = Math.floor(y / scale) * w;
    const o = y * rowLen;
    for (let x = 0; x < W; x++)
      raw[o + 1 + x] = pixels[src + Math.floor(x / scale)] & 0x0f;
  }

  // zlib stream of stored deflate blocks
  const blocks = Math.ceil(raw.length / 65535);
  const z = new Bytes(2 + raw.length + blocks * 5 + 4);
  z.u8(0x78);
  z.u8(0x01);
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const len = Math.min(65535, raw.length - start);
    z.u8(i === blocks - 1 ? 1 : 0);
    z.u8(len & 0xff);
    z.u8(len >>> 8);
    z.u8(~len & 0xff);
    z.u8((~len >>> 8) & 0xff);
    z.bytes(raw.subarray(start, start + len));
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  z.u32(((b << 16) | a) >>> 0);

  const ihdr = new Bytes(13);
  ihdr.u32(W);
  ihdr.u32(H);
  ihdr.bytes([8, 3, 0, 0, 0]); // 8-bit, indexed, deflate, no filter, no interlace
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((c, i) =>
    [1, 3, 5].forEach(
      (k, j) => (plte[i * 3 + j] = parseInt(c.slice(k, k + 2), 16)),
    ),
  );

  const out = new Bytes(8 + 25 + 12 + plte.length + 12 + z.len + 12);
  out.bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  out.chunk("IHDR", ihdr.buf);
  out.chunk("PLTE", plte);
  out.chunk("IDAT", z.buf.subarray(0, z.len));
  out.chunk("IEND", new Uint8Array(0));
  return out.buf.subarray(0, out.len);
}
