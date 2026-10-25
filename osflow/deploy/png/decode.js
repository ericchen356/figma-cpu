// PNG -> bytes -> UTF-8 text, for a plugin sandbox with no zlib or TextDecoder: raw DEFLATE (a port
// of tinf), PNG unfiltering (8-bit grey, grey+alpha, RGB, RGBA; the data is channel 0), and a
// 4-byte length prefix. PNGTEXT(pngBytes) -> string.
const PNGTEXT = (() => {
  const Tree = () => ({ table: new Uint16Array(16), trans: new Uint16Array(288) });
  const sl = Tree(), sd = Tree(), ct = Tree();
  const lb = new Uint8Array(30), lbase = new Uint16Array(30), db = new Uint8Array(30), dbase = new Uint16Array(30);
  const clc = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const lens = new Uint8Array(320), offs = new Uint16Array(16);
  const bitsBase = (bits, base, delta, first) => {
    for (let i = 0; i < delta; ++i) bits[i] = 0;
    for (let i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0;
    for (let s = first, i = 0; i < 30; ++i) { base[i] = s; s += 1 << bits[i]; }
  };
  const build = (t, l, off, num) => {
    t.table.fill(0);
    for (let i = 0; i < num; ++i) t.table[l[off + i]]++;
    t.table[0] = 0;
    for (let s = 0, i = 0; i < 16; ++i) { offs[i] = s; s += t.table[i]; }
    for (let i = 0; i < num; ++i) if (l[off + i]) t.trans[offs[l[off + i]]++] = i;
  };
  sl.table[7] = 24; sl.table[8] = 152; sl.table[9] = 112;
  for (let i = 0; i < 24; ++i) sl.trans[i] = 256 + i;
  for (let i = 0; i < 144; ++i) sl.trans[24 + i] = i;
  for (let i = 0; i < 8; ++i) sl.trans[168 + i] = 280 + i;
  for (let i = 0; i < 112; ++i) sl.trans[176 + i] = 144 + i;
  sd.table[5] = 32;
  for (let i = 0; i < 32; ++i) sd.trans[i] = i;
  bitsBase(lb, lbase, 4, 3);
  bitsBase(db, dbase, 2, 1);
  lb[28] = 0; lbase[28] = 258;
  const inflate = (src, out) => {
    let si = 0, tag = 0, bc = 0, n = 0;
    const getbit = () => { if (!bc--) { tag = src[si++]; bc = 7; } const b = tag & 1; tag >>>= 1; return b; };
    const fill = () => { while (bc < 24) { tag |= (src[si++] | 0) << bc; bc += 8; } };
    const bits = (num, base) => { if (!num) return base; fill(); const v = tag & (0xffff >>> (16 - num)); tag >>>= num; bc -= num; return v + base; };
    const sym = (t) => {
      fill();
      let s = 0, cur = 0, len = 0, g = tag;
      do { cur = 2 * cur + (g & 1); g >>>= 1; ++len; s += t.table[len]; cur -= t.table[len]; } while (cur >= 0);
      tag = g; bc -= len;
      return t.trans[s + cur];
    };
    const lt = Tree(), dt = Tree();
    const data = (l, d) => {
      for (;;) {
        let c = sym(l);
        if (c === 256) return;
        if (c < 256) out[n++] = c;
        else {
          c -= 257;
          const len = bits(lb[c], lbase[c]);
          const k = sym(d);
          const from = n - bits(db[k], dbase[k]);
          for (let i = from; i < from + len; ++i) out[n++] = out[i];
        }
      }
    };
    let last;
    do {
      last = getbit();
      const type = bits(2, 0);
      if (type === 0) {
        while (bc > 8) { si--; bc -= 8; }
        const len = src[si] | (src[si + 1] << 8);
        si += 4;
        for (let i = 0; i < len; ++i) out[n++] = src[si++];
        bc = 0;
      } else if (type === 1) data(sl, sd);
      else {
        const hlit = bits(5, 257), hdist = bits(5, 1), hclen = bits(4, 4);
        for (let i = 0; i < 19; ++i) lens[i] = 0;
        for (let i = 0; i < hclen; ++i) lens[clc[i]] = bits(3, 0);
        build(ct, lens, 0, 19);
        for (let k = 0; k < hlit + hdist; ) {
          const c = sym(ct);
          if (c === 16) { const p = lens[k - 1]; for (let r = bits(2, 3); r; --r) lens[k++] = p; }
          else if (c === 17) for (let r = bits(3, 3); r; --r) lens[k++] = 0;
          else if (c === 18) for (let r = bits(7, 11); r; --r) lens[k++] = 0;
          else lens[k++] = c;
        }
        build(lt, lens, 0, hlit);
        build(dt, lens, hlit, hdist);
        data(lt, dt);
      }
    } while (!last);
    return n;
  };
  return (png) => {
    const u32 = (i) => ((png[i] << 24) | (png[i + 1] << 16) | (png[i + 2] << 8) | png[i + 3]) >>> 0;
    let w = 0, h = 0, depth = 0, ctype = 0, total = 0;
    const idat = [];
    for (let i = 8; i < png.length; ) {
      const len = u32(i);
      const type = String.fromCharCode(png[i + 4], png[i + 5], png[i + 6], png[i + 7]);
      if (type === "IHDR") { w = u32(i + 8); h = u32(i + 12); depth = png[i + 16]; ctype = png[i + 17]; if (png[i + 20]) throw new Error("interlaced PNG"); }
      else if (type === "IDAT") { idat.push(png.subarray(i + 8, i + 8 + len)); total += len; }
      else if (type === "IEND") break;
      i += 12 + len;
    }
    if (depth !== 8) throw new Error(`PNG bit depth ${depth}`);
    const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
    if (!ch) throw new Error(`PNG colour type ${ctype}`);
    const z = new Uint8Array(total);
    let o = 0;
    for (const p of idat) { z.set(p, o); o += p.length; }
    const stride = w * ch;
    const raw = new Uint8Array((stride + 1) * h);
    inflate(z.subarray(2), raw); // after the 2-byte zlib header
    // unfilter in place into rows
    const px = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const cur = px.subarray(y * stride, (y + 1) * stride);
      const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? cur[x - ch] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= ch ? prev[x - ch] : 0;
        let v = row[x];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        cur[x] = v & 255;
      }
    }
    // channel 0 of each pixel; a 4-byte length, then UTF-8
    const at = (k) => px[k * ch];
    const n = ((at(0) << 24) | (at(1) << 16) | (at(2) << 8) | at(3)) >>> 0;
    const parts = [];
    let s = "";
    for (let k = 4; k < 4 + n; ) {
      const a = at(k++);
      let cp;
      if (a < 0x80) cp = a;
      else if (a < 0xe0) cp = ((a & 31) << 6) | (at(k++) & 63);
      else if (a < 0xf0) cp = ((a & 15) << 12) | ((at(k++) & 63) << 6) | (at(k++) & 63);
      else cp = ((a & 7) << 18) | ((at(k++) & 63) << 12) | ((at(k++) & 63) << 6) | (at(k++) & 63);
      s += String.fromCodePoint(cp);
      if (s.length > 8192) { parts.push(s); s = ""; }
    }
    parts.push(s);
    return parts.join("");
  };
})();
