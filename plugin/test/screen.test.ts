import { describe, it, expect } from "vitest";
import { vramToRgba, screenSize, diffDirty, FrameLimiter } from "../src/screen/vram";
import { crc32, adler32, encodePng, encodePngIndexed, vramToPng } from "../src/screen/png";
import { Io } from "../src/screen/io";
import { ScreenPresenter } from "../src/screen/present";
import { PALETTE, MEM } from "../src/contracts/spec";

const px = (rgba: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
const rgbOf = (i: number) => { const n = parseInt(PALETTE[i].slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };
const blankVram = () => new Uint8Array(MEM.vramW * MEM.vramH);

describe("vramToRgba", () => {
  it("size and exact nearest-neighbor replication at 6x", () => {
    const v = blankVram();
    v[0] = 8; v[1] = 12; v[MEM.vramW] = 3;
    const out = vramToRgba(v, 6);
    const { width, height } = screenSize(6);
    expect([width, height]).toEqual([768, 576]);
    expect(out.length).toBe(768 * 576 * 4);
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
      expect(px(out, width, dx, dy)).toEqual(rgbOf(8));       // pixel (0,0)
      expect(px(out, width, 6 + dx, dy)).toEqual(rgbOf(12));  // pixel (1,0)
      expect(px(out, width, dx, 6 + dy)).toEqual(rgbOf(3));   // pixel (0,1)
    }
    expect(px(out, width, 12, 0)).toEqual(rgbOf(0));          // pixel (2,0) untouched, hard edge (no blending)
  });
  it("uses only the low nibble", () => expect(px(vramToRgba(Object.assign(blankVram(), { 0: 0xf8 }), 1), 128, 0, 0)).toEqual(rgbOf(8)));
  it("scale 1 and rejects bad input", () => {
    expect(vramToRgba(blankVram(), 1).length).toBe(128 * 96 * 4);
    expect(() => vramToRgba(blankVram(), 0)).toThrow();
    expect(() => vramToRgba(blankVram(), 1.5)).toThrow();
    expect(() => vramToRgba(new Uint8Array(10), 2)).toThrow();
  });
});

describe("dirty check and frame limiter", () => {
  it("diffDirty", () => {
    const a = blankVram(), b = blankVram();
    expect(diffDirty(null, a)).toBe(true);
    expect(diffDirty(a, b)).toBe(false);
    b[500] = 5;
    expect(diffDirty(a, b)).toBe(true);
    b[500] = 0xf0; // only the high nibble differs: not visible, not dirty
    expect(diffDirty(a, b)).toBe(false);
  });
  it("FrameLimiter caps the rate", () => {
    let t = 0;
    const l = new FrameLimiter(80, () => t);
    expect(l.tryFrame()).toBe(true);
    t = 79; expect(l.tryFrame()).toBe(false);
    t = 80; expect(l.tryFrame()).toBe(true);
  });
});

// ---- PNG: own minimal decoder (stored blocks only) so we verify real bytes without node types ----
function decode(png: Uint8Array) {
  expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let o = 8, ihdr: Uint8Array | null = null, plte: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let sawEnd = false;
  while (o < png.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(...png.slice(o + 4, o + 8));
    const data = png.slice(o + 8, o + 8 + len);
    expect(dv.getUint32(o + 8 + len)).toBe(crc32(png, o + 4, o + 8 + len)); // every chunk CRC must be valid
    if (type === "IHDR") ihdr = data; else if (type === "PLTE") plte = data; else if (type === "IDAT") idat.push(data); else if (type === "IEND") sawEnd = true;
    o += 12 + len;
  }
  expect(sawEnd).toBe(true);
  const z = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let zo = 0; for (const d of idat) { z.set(d, zo); zo += d.length; }
  const raw: number[] = [];
  let p = 2;
  for (;;) {
    const final = z[p] & 1; expect(z[p] & 6).toBe(0); // stored
    const len = z[p + 1] | (z[p + 2] << 8);
    expect((z[p + 3] | (z[p + 4] << 8))).toBe(~len & 0xffff);
    for (let i = 0; i < len; i++) raw.push(z[p + 5 + i]);
    p += 5 + len;
    if (final) break;
  }
  const rawU = new Uint8Array(raw);
  expect(new DataView(z.buffer, z.byteOffset).getUint32(p)).toBe(adler32(rawU));
  const h = new DataView(ihdr!.buffer, ihdr!.byteOffset);
  return { w: h.getUint32(0), h: h.getUint32(4), depth: ihdr![8], colorType: ihdr![9], raw: rawU, plte };
}

describe("png", () => {
  it("crc32 / adler32 known vectors", () => {
    const s = (t: string) => new Uint8Array([...t].map((c) => c.charCodeAt(0)));
    expect(crc32(s("123456789"))).toBe(0xcbf43926);
    expect(adler32(s("Wikipedia"))).toBe(0x11e60398);
  });
  it("RGBA 2x2 round-trips", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 255]);
    const d = decode(encodePng(rgba, 2, 2));
    expect([d.w, d.h, d.depth, d.colorType]).toEqual([2, 2, 8, 6]);
    expect(Array.from(d.raw)).toEqual([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 1, 2, 3, 255].slice(0, 1).concat([255, 0, 0, 255, 0, 255, 0, 255], [0], [0, 0, 255, 255, 1, 2, 3, 255]));
  });
  it("indexed 4-bit packs two pixels per byte with the PICO-8 palette", () => {
    const d = decode(encodePngIndexed(new Uint8Array([1, 2, 3, 15, 0, 7]), 3, 2, PALETTE));
    expect([d.w, d.h, d.depth, d.colorType]).toEqual([3, 2, 4, 3]);
    expect(Array.from(d.raw)).toEqual([0, 0x12, 0x30, 0, 0xf0, 0x70]);
    expect(d.plte!.length).toBe(48);
    expect(Array.from(d.plte!.slice(3, 6))).toEqual(rgbOf(1).slice(0, 3));
  });
  it("vramToPng makes a valid 768x576 image whose pixels match vramToRgba", () => {
    const v = blankVram(); v[0] = 8; v[127] = 11; v[95 * 128] = 2; v[95 * 128 + 127] = 14;
    const d = decode(vramToPng(v, 6, PALETTE));
    expect([d.w, d.h]).toEqual([768, 576]);
    const rowBytes = 384, get = (x: number, y: number) => { const b = d.raw[y * (1 + rowBytes) + 1 + (x >> 1)]; return x & 1 ? b & 15 : b >> 4; };
    expect(get(0, 0)).toBe(8); expect(get(5, 5)).toBe(8); expect(get(6, 0)).toBe(0);
    expect(get(767, 0)).toBe(11); expect(get(0, 575)).toBe(2); expect(get(767, 575)).toBe(14);
  });
});

describe("Io", () => {
  const A = MEM.io;
  it("non-IO addresses are not handled", () => {
    const io = new Io();
    expect(io.read(0x4000)).toBeUndefined();
    expect(io.write(0x4000, 1)).toBe(false);
  });
  it("mouse clamps to the screen", () => {
    const io = new Io();
    io.setMouse(500, -9, 1);
    expect([io.read(A.MOUSE_X), io.read(A.MOUSE_Y), io.read(A.MOUSE_BTN)]).toEqual([127, 0, 1]);
    io.setMouse(10.9, 95.4, false);
    expect([io.read(A.MOUSE_X), io.read(A.MOUSE_Y), io.read(A.MOUSE_BTN)]).toEqual([10, 95, 0]);
  });
  it("KEY holds until the CPU writes 0", () => {
    const io = new Io();
    io.setKey(65);
    expect(io.read(A.KEY)).toBe(65);
    expect(io.read(A.KEY)).toBe(65);
    io.write(A.KEY, 0);
    expect(io.read(A.KEY)).toBe(0);
  });
  it("TICK counts frames and wraps at 256", () => {
    const io = new Io();
    for (let i = 0; i < 255; i++) io.tickFrame();
    expect(io.read(A.TICK)).toBe(255);
    io.tickFrame();
    expect(io.read(A.TICK)).toBe(0);
  });
  it("RAND is stable per seed, varies per read, different per seed", () => {
    const seq = (s: number) => { const io = new Io(s); return Array.from({ length: 8 }, () => io.read(A.RAND)!); };
    expect(seq(7)).toEqual(seq(7));
    expect(new Set(seq(7)).size).toBeGreaterThan(4);
    expect(seq(7)).not.toEqual(seq(8));
  });
  it("read-only registers ignore CPU writes but are still handled", () => {
    const io = new Io();
    io.setMouse(5, 6);
    expect(io.write(A.MOUSE_X, 99)).toBe(true);
    expect(io.read(A.MOUSE_X)).toBe(5);
  });
});

describe("ScreenPresenter", () => {
  const mk = () => {
    let t = 0;
    const applied: Uint8Array[] = [];
    const resolvers: (() => void)[] = [];
    const p = new ScreenPresenter(
      (v) => new Promise((res) => resolvers.push(() => res(new Uint8Array([v[0]])))),
      (png) => applied.push(png),
      new FrameLimiter(80, () => t),
    );
    return { p, applied, resolvers, tick: (ms: number) => (t += ms) };
  };
  it("refreshes when dirty, skips when unchanged, honors the frame cap and in-flight guard", async () => {
    const { p, applied, resolvers, tick } = mk();
    const v = blankVram(); v[0] = 4;
    expect(p.present(v)).toBe(true);        // first frame
    expect(p.present(v)).toBe(false);       // in flight
    resolvers[0](); await Promise.resolve(); await Promise.resolve();
    expect(applied.length).toBe(1);
    expect(p.present(v)).toBe(false);       // unchanged
    v[1] = 9;
    expect(p.present(v)).toBe(false);       // dirty but within 80 ms
    tick(100);
    expect(p.present(v)).toBe(true);        // allowed now; the earlier change was not lost
  });
  it("force bypasses dirty/limiter", () => {
    const { p } = mk();
    const v = blankVram();
    expect(p.present(v)).toBe(true);
    expect(p.present(v, true)).toBe(false); // still guarded by in-flight
  });
});
