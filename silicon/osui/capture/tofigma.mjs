// Extracted DOM nodes -> Figma layer specs (what a build-time plugin would create), using only
// properties Figma nodes have: absolute x/y/w/h (made parent-relative by the builder), rotation,
// SOLID / GRADIENT_LINEAR / IMAGE fills, strokes with per-side weights and INSIDE/OUTSIDE align,
// dash patterns, per-corner radii, DROP_SHADOW / INNER_SHADOW effects (with spread), opacity,
// blend mode, clipsContent, TEXT (family/style/size/lineHeight/letterSpacing/fill/align) and SVG
// (createNodeFromSvg). Everything the mapping cannot express exactly is tallied in `issues`.

const r2 = (v) => Math.round(v * 100) / 100;
const isGridGradient = (s) => /linear-gradient\((?:90deg, )?(rgba?\([^)]*\)|#\w+) 1px, (?:transparent|rgba\(0, 0, 0, 0\)) 1px\)/.test(s);

export function toFigma(doc, opts = {}) {
  const { nodes } = doc;
  const layers = [];
  const issues = new Map(); // key -> {count, examples}
  const note = (key, n) => {
    const e = issues.get(key) ?? { count: 0, ex: [] };
    e.count++;
    if (e.ex.length < 4) e.ex.push(label(n));
    issues.set(key, e);
  };
  const label = (n) => `${n.tag}${n.el ?? ""}${n.cls ? "." + n.cls.trim().split(/\s+/).join(".") : ""}`;
  const fontFor = opts.fontFor ?? (() => null);
  const mapWeight = opts.mapWeight ?? ((w) => w);
  const skipped = { transparent: 0, clippedOut: 0, empty: 0 };
  const layerOf = new Map(); // node id -> layer id

  const add = (l) => {
    l.id = layers.length;
    layers.push(l);
    return l.id;
  };

  // children by paint order, as Figma stacks siblings
  const kids = new Map();
  for (const n of nodes) if (n.parent != null) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  for (const arr of kids.values()) arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);

  // z-order conflicts: a later-ordered sibling subtree has a node painted before an earlier sibling's node
  const subtreeOrders = new Map();
  const orders = (n) => {
    if (subtreeOrders.has(n.id)) return subtreeOrders.get(n.id);
    let lo = n.order ?? 0, hi = n.order ?? 0;
    for (const k of kids.get(n.id) ?? []) {
      const [a, b] = orders(k);
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    }
    subtreeOrders.set(n.id, [lo, hi]);
    return [lo, hi];
  };
  // Only overlapping boxes can show a stacking difference: count sibling pairs (A before B) where
  // some painted node under B is painted before some painted node under A and the two overlap.
  const flat = new Map();
  const under = (n) => {
    if (flat.has(n.id)) return flat.get(n.id);
    const own = n.svg || n.paint.fill || n.paint.border || n.paint.shadows || n.textRuns.length || n.img || n.input ? [n] : [];
    const all = own.concat(...(n.svg ? [] : (kids.get(n.id) ?? []).map(under)));
    flat.set(n.id, all);
    return all;
  };
  // the ink box: the border box grown by the box-shadows that spill out of it
  const ink = (n) => {
    let [x, y, w, h] = n.box;
    for (const s of n.paint.shadows ?? []) {
      if (s.type !== "DROP_SHADOW") continue;
      const e = s.blur + s.spread;
      x = Math.min(x, n.box[0] + s.x - e); y = Math.min(y, n.box[1] + s.y - e);
      w = Math.max(x + w, n.box[0] + n.box[2] + s.x + e) - x; h = Math.max(y + h, n.box[1] + n.box[3] + s.y + e) - y;
    }
    return [x, y, w, h];
  };
  const overlap = (a, b) => {
    const [ax, ay, aw, ah] = ink(a), [bx, by, bw, bh] = ink(b);
    return Math.min(ax + aw, bx + bw) - Math.max(ax, bx) > 0.5 && Math.min(ay + ah, by + bh) - Math.max(ay, by) > 0.5;
  };
  let zConflicts = 0;
  const zExamples = [];
  for (const [pid, arr] of kids) {
    if (nodes[pid].svg) continue;
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) {
        const A = under(arr[i]), B = under(arr[j]);
        const hit = A.find((a) => B.some((b) => (b.order ?? 0) < (a.order ?? 0) && overlap(a, b)));
        if (hit) {
          zConflicts++;
          if (zExamples.length < 6) zExamples.push(`${label(arr[i])} | ${label(arr[j])} (in ${label(nodes[pid])})`);
        }
      }
  }

  const textLayer = (n, run, parentLayer, synthetic) => {
    const f = n.font;
    const used = fontFor(n) ?? f.family.split(",")[0].replace(/"/g, "").trim();
    const L = f.lineHeight === "normal" ? run.box[3] : f.lineHeight;
    const rot = n.transform?.rotation ?? 0;
    let [x, y, w, h] = run.box;
    if (Math.abs(rot) > 0.01) {
      // The owner's frame carries the rotation (about its centre), so the text goes in the frame's
      // unrotated coordinates: rotate the run's centre back about the owner's centre.
      const [ox, oy, ow, oh] = n.box;
      const ocx = ox + ow / 2, ocy = oy + oh / 2;
      const rcx = x + w / 2 - ocx, rcy = y + h / 2 - ocy;
      const t = (-rot * Math.PI) / 180;
      const lcx = ocx + rcx * Math.cos(t) - rcy * Math.sin(t);
      const lcy = ocy + rcx * Math.sin(t) + rcy * Math.cos(t);
      if (Math.abs(Math.abs(rot) - 90) < 0.5) [w, h] = [h, w];
      return add({
        type: "TEXT", parent: parentLayer, src: n.id, name: run.s.slice(0, 24),
        x: r2(lcx - w / 2), y: r2(lcy - L / 2), w: r2(w), h: r2(L),
        text: { chars: run.s, family: used, weight: mapWeight(f.weight), size: f.size, lineHeight: L, letterSpacing: f.letterSpacing, color: f.color, align: "LEFT" },
      });
    }
    const lineTop = synthetic ? y : y - (L - h) / 2;
    // text-overflow: ellipsis -> a fixed-width text with textTruncation "ENDING"
    const truncate = !synthetic && n.st["text-overflow"] === "ellipsis" && n.clips && x + w > n.box[0] + n.box[2] + 0.5;
    return add({
      type: "TEXT", parent: parentLayer, src: n.id, name: run.s.slice(0, 24),
      x: r2(x), y: r2(lineTop), w: r2(truncate ? n.box[0] + n.box[2] - x : w), h: r2(L),
      text: { chars: run.s, family: used, weight: mapWeight(f.weight), size: f.size, lineHeight: L, letterSpacing: f.letterSpacing, color: synthetic?.color ?? f.color, align: synthetic?.align ?? "LEFT", fixedWidth: synthetic ? r2(w) : truncate ? r2(n.box[0] + n.box[2] - x) : undefined, truncate: truncate || undefined },
    });
  };

  // Chrome paints boxes (backgrounds, borders, replaced elements) on whole pixels, measured from the
  // nearest transformed ancestor; text keeps its fractional position. Snap the same way.
  const snapOrigin = (n) => {
    for (let p = n.parent; p != null; p = nodes[p].parent) if (nodes[p].st.transform && nodes[p].st.transform !== "none") return nodes[p].box;
    return [0, 0];
  };
  // Under a rotated ancestor, Figma wants the box in that ancestor's unrotated frame: rotate the
  // centre back about the ancestor's centre and use the layout (pre-transform) size.
  const rotatedAncestor = (n) => {
    for (let p = n.parent; p != null; p = nodes[p].parent) if (nodes[p].transform && Math.abs(nodes[p].transform.rotation) > 0.01) return nodes[p];
    return null;
  };
  const localBox = (n, box = n.box, size = n.size) => {
    const R = rotatedAncestor(n);
    if (!R) return box;
    const [x, y, w, h] = box;
    const [rx, ry, rw, rh] = R.box;
    const rcx = rx + rw / 2, rcy = ry + rh / 2;
    const dx = x + w / 2 - rcx, dy = y + h / 2 - rcy;
    const t = (-R.transform.rotation * Math.PI) / 180;
    const cx = rcx + dx * Math.cos(t) - dy * Math.sin(t), cy = rcy + dx * Math.sin(t) + dy * Math.cos(t);
    const quarter = Math.abs(Math.abs(R.transform.rotation % 180) - 90) < 0.5;
    const [lw, lh] = size ?? (quarter ? [h, w] : [w, h]);
    return [cx - lw / 2, cy - lh / 2, lw, lh];
  };
  const snap = (n) => {
    const [x, y, w, h] = localBox(n);
    if (opts.snap === false || (n.st.transform && n.st.transform !== "none") || rotatedAncestor(n)) return [x, y, w, h];
    const [ox, oy] = snapOrigin(n);
    const x0 = Math.round(x - ox), y0 = Math.round(y - oy), x1 = Math.round(x + w - ox), y1 = Math.round(y + h - oy);
    return [x0 + ox, y0 + oy, x1 - x0, y1 - y0];
  };

  const visit = (n, parentLayer) => {
    if (n.transparent) return void skipped.transparent++;
    if (n.clippedOut) return void skipped.clippedOut++;
    const p = n.paint;
    const children = kids.get(n.id) ?? [];
    let [x, y, w, h] = snap(n);
    let rotation = 0;
    if (n.transform && Math.abs(n.transform.rotation) > 0.01) {
      rotation = n.transform.rotation;
      const [ow, oh] = n.transform.size ?? [w, h];
      const cx = x + w / 2, cy = y + h / 2;
      [x, y, w, h] = [cx - ow / 2, cy - oh / 2, ow, oh];
      if (children.length) note("rotated container (children placed in its unrotated frame)", n);
    }
    if (n.transform && n.transform.scale !== 1) note("transform: scale", n);
    const own = !n.hiddenSelf;
    const layer = {
      type: "FRAME", parent: parentLayer, src: n.id, name: label(n),
      x: r2(x), y: r2(y), w: r2(w), h: r2(h),
      rotation: rotation || undefined,
      fills: [], strokes: undefined, radius: undefined, effects: [],
      opacity: p.opacity, blend: undefined, clips: !!n.clips,
    };
    if (n.clips && n.clips.some((v) => v === "auto" || v === "scroll")) layer.scroll = true;
    let fillRect = null;
    if (own) {
      if (p.fill) {
        if (p.fillInset) {
          const [t, rr, b, l] = p.fillInset;
          fillRect = { type: "RECTANGLE", name: "bg (background-clip)", x: r2(x + l), y: r2(y + t), w: r2(w - l - rr), h: r2(h - t - b), fills: [{ type: "SOLID", ...p.fill }], radius: p.radius };
        } else layer.fills.push({ type: "SOLID", ...p.fill });
      }
      if (p.bgImage) {
        const layersCss = splitTop(p.bgImage.image);
        const sizes = splitTop(p.bgImage.size ?? "auto");
        const poss = splitTop(p.bgImage.pos ?? "0% 0%");
        for (const [i, img] of layersCss.entries()) {
          const size = sizes[i % sizes.length], pos = poss[i % poss.length];
          if (/^linear-gradient/.test(img) && isGridGradient(img) && size !== "auto") {
            layer.gridLines = (layer.gridLines ?? []).concat([{ css: img, size, pos }]);
            note("CSS tiled gradient (cell grid) -> expanded into 1px line rectangles", n);
          } else if (/^linear-gradient/.test(img)) {
            layer.fills.push({ type: "GRADIENT_LINEAR", css: img });
            note("linear-gradient fill (GRADIENT_LINEAR)", n);
          } else if (/^url\("?data:image\/svg/.test(img)) {
            layer.bgSvg = { css: img, size, pos };
            note("background-image SVG -> SVG child layer", n);
          } else if (/^url/.test(img)) {
            layer.fills.push({ type: "IMAGE", css: img, size: p.bgImage.size });
            note("background-image bitmap -> IMAGE fill", n);
          } else note(`unsupported background-image ${img.slice(0, 30)}`, n);
        }
      }
      if (p.border) {
        const sides = p.border;
        const live = sides.filter(Boolean);
        const sameColor = live.every((s) => JSON.stringify(s.color) === JSON.stringify(live[0].color) && s.style === live[0].style);
        if (sameColor) {
          layer.strokes = { color: live[0].color, align: "INSIDE", weights: sides.map((s) => (s ? s.w : 0)), dash: live[0].style === "solid" ? undefined : live[0].style };
          if (live[0].style !== "solid") note(`border-style ${live[0].style} -> dashPattern`, n);
          if (sides.some((s) => !s)) note("per-side border (strokeTop/Right/Bottom/LeftWeight)", n);
        } else {
          layer.sideRects = sides;
          note("borders of different colours per side -> one rectangle per side", n);
        }
      }
      if (p.radius) layer.radius = p.radius;
      const corners = Array.isArray(p.radius) ? p.radius : p.radius ? [p.radius, p.radius, p.radius, p.radius] : [];
      const half = (v) => (typeof v === "object" ? v.rx >= w / 2 - 0.01 && v.ry >= h / 2 - 0.01 : v >= Math.min(w, h) / 2 - 0.01 && Math.abs(w - h) < 0.01);
      if (corners.length && corners.every(half)) {
        layer.type = "ELLIPSE";
        delete layer.radius;
        if (!corners.every((v) => typeof v === "number")) note("border-radius 50% on a non-square box -> ELLIPSE node", n);
        else note("border-radius 50% on a square -> ELLIPSE node", n);
      } else if (corners.some((v) => typeof v === "object")) note("elliptical corner radius (Figma corners are circular)", n);
      if (p.shadows) {
        layer.effects.push(...p.shadows);
        if (p.shadows.some((s) => s.type === "INNER_SHADOW")) note("inset box-shadow -> INNER_SHADOW", n);
        if (p.shadows.some((s) => s.type === "DROP_SHADOW" && !s.blur)) note("hairline box-shadow (no blur) -> DROP_SHADOW", n);
        if (p.shadows.some((s) => s.type === "DROP_SHADOW" && s.blur)) note("blurred box-shadow -> DROP_SHADOW", n);
      }
      if (p.outline) {
        layer.outline = p.outline;
        note(`outline${p.outline.offset ? " with offset" : ""}${p.outline.style !== "solid" ? " " + p.outline.style : ""} -> ${p.outline.offset || layer.strokes ? "extra stroked rectangle" : "OUTSIDE stroke"}`, n);
      }
      if (p.blend) {
        layer.blend = p.blend;
        note(`mix-blend-mode ${p.blend} -> blendMode`, n);
      }
      if (p.filter) {
        if (/^invert\(1\)$/.test(p.filter) && n.img) {
          layer.bakeInvert = true;
          note("filter: invert(1) on an image -> pixels inverted at extraction", n);
        } else if (/drop-shadow/.test(p.filter)) {
          note("filter: drop-shadow -> DROP_SHADOW effect", n);
          layer.filterShadow = p.filter;
        } else note(`unsupported filter ${p.filter}`, n);
      }
      if (p.clipPath) note("clip-path", n);
    }
    const parentCursor = n.parent != null ? nodes[n.parent].st.cursor : "auto";
    if (n.st.cursor && !["auto", "default"].includes(n.st.cursor) && n.st.cursor !== parentCursor) note(`cursor: ${n.st.cursor} (prototype shows Figma's own cursor)`, n);
    if (n.st["text-overflow"] === "ellipsis" && n.textRuns.length) note("text-overflow: ellipsis -> textTruncation ENDING", n);
    if (n.svg) layer.svg = n.svg.markup;
    if (n.img) layer.image = { src: n.img.src, fit: n.img.fit, natural: n.img.natural, invert: layer.bakeInvert };
    if (n.img && n.img.rendering === "pixelated") note("image-rendering: pixelated -> IMAGE fill with NEAREST? (Figma scales smoothly)", n);

    const empty = !layer.fills.length && !layer.strokes && !layer.sideRects && !layer.effects.length && !layer.outline && !layer.svg && !layer.image && !layer.gridLines && !layer.bgSvg && !n.textRuns.length && !n.input && !fillRect;
    if (empty && !children.length) return void skipped.empty++;
    const id = add(layer);
    layerOf.set(n.id, id);
    if (fillRect) add({ ...fillRect, parent: id, src: n.id });
    if (layer.gridLines) {
      for (const g of layer.gridLines) {
        const vertical = /90deg/.test(g.css);
        const color = rgbaOf(/(rgba?\([^)]*\))/.exec(g.css)?.[1]);
        const [sx, sy] = g.size.split(/\s+/).map(parseFloat);
        const [px0, py0] = g.pos.split(/\s+/).map(parseFloat);
        const step = vertical ? sx : sy || sx;
        const off = vertical ? px0 : py0;
        const len = vertical ? w : h;
        let k0 = Math.ceil(-off / step);
        for (let p0 = off + k0 * step; p0 < len; p0 += step)
          add({ type: "RECTANGLE", parent: id, src: n.id, name: "grid", x: r2(vertical ? x + p0 : x), y: r2(vertical ? y : y + p0), w: vertical ? 1 : w, h: vertical ? h : 1, fills: [{ type: "SOLID", ...color }] });
      }
    }
    if (layer.bgSvg) {
      const m = /url\("?(data:image\/svg\+xml[^")]*)"?\)/.exec(layer.bgSvg.css);
      const size = parseFloat(layer.bgSvg.size) || 16;
      // "right 8px center" / "calc(100% - 8px) 50%"
      const pos = layer.bgSvg.pos;
      let bx = x, by = y + (h - size) / 2;
      const rm = /right (\d+(?:\.\d+)?)px/.exec(pos) ?? /calc\(100% - (\d+(?:\.\d+)?)px\)/.exec(pos);
      if (rm) bx = x + w - parseFloat(rm[1]) - size;
      add({ type: "SVG", parent: id, src: n.id, name: "bg svg", x: r2(bx), y: r2(by), w: size, h: size, svgUrl: m ? decodeURIComponent(m[1].replace(/^data:image\/svg\+xml,?/, "")) : null });
    }
    if (layer.sideRects) {
      const [t, rr, b, l] = layer.sideRects;
      if (t) add({ type: "RECTANGLE", parent: id, name: "border-top", x: r2(x), y: r2(y), w: r2(w), h: t.w, fills: [{ type: "SOLID", ...t.color }] });
      if (b) add({ type: "RECTANGLE", parent: id, name: "border-bottom", x: r2(x), y: r2(y + h - b.w), w: r2(w), h: b.w, fills: [{ type: "SOLID", ...b.color }] });
      if (l) add({ type: "RECTANGLE", parent: id, name: "border-left", x: r2(x), y: r2(y), w: l.w, h: r2(h), fills: [{ type: "SOLID", ...l.color }] });
      if (rr) add({ type: "RECTANGLE", parent: id, name: "border-right", x: r2(x + w - rr.w), y: r2(y), w: rr.w, h: r2(h), fills: [{ type: "SOLID", ...rr.color }] });
    }
    // runs and children interleave in DOM order in a real page; here runs come first (they are
    // never overlapped by their own element's children in os-ui)
    for (const run of n.textRuns) textLayer(n, run, id);
    if (n.input && own) inputLayers(n, id);
    if (n.svg) return; // the markup carries the SVG's own children
    for (const k of children) visit(k, id);
  };

  const inputLayers = (n, id) => {
    const [x, y, w, h] = n.box;
    const st = n.st;
    const num = (v) => parseFloat(v) || 0;
    if (n.input.type === "checkbox") {
      note("native checkbox -> drawn rectangle (approximation of Chrome's control)", n);
      add({ type: "RECTANGLE", parent: id, src: n.id, name: "checkbox", x, y, w, h, fills: [{ type: "SOLID", hex: n.input.checked ? "#0c8ce9" : "#ffffff" }], strokes: { color: { hex: "#767676" }, align: "INSIDE", weights: [1, 1, 1, 1] }, radius: 2.5 });
      return;
    }
    const value = n.input.value || n.input.placeholder;
    if (!value) return;
    const bl = num(st["border-left-width"]), br = num(st["border-right-width"]);
    const bt = num(st["border-top-width"]), bb = num(st["border-bottom-width"]);
    const pl = num(st["padding-left"]), pr = num(st["padding-right"]);
    const pt = num(st["padding-top"]), pb = num(st["padding-bottom"]);
    const cx = x + bl + pl, cw = w - bl - br - pl - pr;
    const cy = y + bt + pt, ch = h - bt - bb - pt - pb;
    const L = n.font.lineHeight === "normal" ? n.font.size * 1.21 : n.font.lineHeight;
    const align = n.font.align === "right" || n.font.align === "end" ? "RIGHT" : n.font.align === "center" ? "CENTER" : "LEFT";
    note(n.input.type === "select" ? "native <select> value -> TEXT layer" : "input value -> TEXT layer", n);
    textLayer(n, { s: value, box: [cx, cy + (ch - L) / 2, cw, L] }, id, { align, color: n.input.value ? n.font.color : n.input.placeholderColor ?? { hex: "#757575" } });
  };

  const roots = nodes.filter((n) => n.parent == null);
  for (const r of roots) visit(r, null);
  return { layers, issues: Object.fromEntries([...issues].sort((a, b) => b[1].count - a[1].count)), skipped, zConflicts, zExamples, layerOf };
}

function splitTop(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) (out.push(cur.trim()), (cur = ""));
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function rgbaOf(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c ?? "");
  if (!m) return { hex: "#000000" };
  const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
  const hex = "#" + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return p.length > 3 && p[3] < 1 ? { hex, a: p[3] } : { hex };
}
