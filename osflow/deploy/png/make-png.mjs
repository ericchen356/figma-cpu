// Writes the deploy as a greyscale PNG: { runtime, items: [[file, step, json, hash], ...] } as UTF-8,
// after a 4-byte length, one byte per pixel. usage: node make-png.mjs <out dir> <png>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [outDir, pngPath] = process.argv.slice(2);
const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".js")).sort((a, b) => parseInt(a) - parseInt(b));
const MARK = "\nreturn await RT.run(";
let runtime = null;
const items = [];
for (const f of files) {
  const code = fs.readFileSync(path.join(outDir, f), "utf8");
  const i = code.lastIndexOf(MARK);
  const rt = code.slice(0, i);
  if (runtime === null) runtime = rt;
  else if (rt !== runtime) throw new Error(`the runtime differs in ${f}`);
  const m = /^"(\w+)", ([\s\S]*), "([0-9a-z]+)"\);$/.exec(code.slice(i + MARK.length));
  items.push([f, m[1], m[2], m[3]]);
}
const text = Buffer.from(JSON.stringify({ runtime, items }), "utf8");
const W = 2048;
const n = text.length + 4;
const H = Math.ceil(n / W);
const px = Buffer.alloc(W * H);
px.writeUInt32BE(text.length, 0);
text.copy(px, 4);
const raw = Buffer.alloc((W + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (W + 1) + 1, y * W, (y + 1) * W);
const crcTable = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // depth
ihdr[9] = 0; // greyscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(pngPath, png);
console.log(`${items.length} steps, ${text.length} bytes of text -> ${W}x${H} PNG, ${png.length} bytes`);
