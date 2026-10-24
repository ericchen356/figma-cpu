import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng } from "../src/png";

const PALETTE = ["#000000", "#FF0000", "#00FF00", "#0000FF"];

function chunks(png: Uint8Array) {
  const out: { type: string; data: Buffer }[] = [];
  const buf = Buffer.from(png);
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o);
    out.push({
      type: buf.toString("latin1", o + 4, o + 8),
      data: buf.subarray(o + 8, o + 8 + len),
    });
    o += 12 + len;
  }
  return out;
}

describe("encodePng", () => {
  it("writes a valid indexed PNG with nearest-neighbour upscaling", () => {
    const pixels = new Uint8Array([0, 1, 2, 3]); // 2x2
    const png = encodePng(pixels, 2, 2, PALETTE, 3);
    expect([...png.slice(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const c = chunks(png);
    expect(c.map((x) => x.type)).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
    expect([
      c[0].data.readUInt32BE(0),
      c[0].data.readUInt32BE(4),
      c[0].data[8],
      c[0].data[9],
    ]).toEqual([6, 6, 8, 3]);
    const raw = inflateSync(c[2].data); // also checks the adler32
    expect(raw.length).toBe(6 * 7);
    expect([...raw.subarray(0, 7)]).toEqual([0, 0, 0, 0, 1, 1, 1]);
    expect([...raw.subarray(35, 42)]).toEqual([0, 2, 2, 2, 3, 3, 3]);
  });

  it("splits large images into multiple stored blocks", () => {
    const png = encodePng(
      new Uint8Array(128 * 96).fill(1),
      128,
      96,
      PALETTE,
      6,
    );
    const idat = chunks(png).find((x) => x.type === "IDAT")!;
    expect(inflateSync(idat.data).length).toBe(769 * 576);
  });
});
