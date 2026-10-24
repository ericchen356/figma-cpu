// DOM -> Figma-layer JSON for a page loaded in headless Chrome.
//
//   1. an in-page pass tags every outermost <svg> and <img> and serializes each SVG with its computed
//      paint (currentColor and CSS stroke rules resolved to hex + opacity attributes, px size set);
//   2. DOMSnapshot.captureSnapshot returns every layout object (elements, ::before/::after, text) with
//      absolute bounds, paint order, offset (pre-transform) rects, per-line inline text boxes and a
//      whitelist of computed styles, plus input values;
//   3. this file joins them into one node per painted box, with fills, strokes, radii, effects,
//      clipping, text runs, SVG markup and images, keeping the DOM nesting.
//
// Usage: import { extract } from "./extract.mjs"; const doc = await extract(cdp);

export const STYLES = [
  "display", "visibility", "opacity", "position", "z-index", "overflow-x", "overflow-y",
  "background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "box-shadow", "outline-width", "outline-style", "outline-color", "outline-offset",
  "transform", "transform-origin", "filter", "backdrop-filter", "mix-blend-mode", "clip-path", "mask-image",
  "color", "font-family", "font-weight", "font-size", "line-height", "letter-spacing", "font-style",
  "font-feature-settings", "font-variation-settings", "text-align", "white-space", "text-overflow",
  "text-transform", "text-decoration-line", "text-shadow", "-webkit-font-smoothing",
  "fill", "stroke", "stroke-width", "object-fit", "image-rendering", "cursor", "pointer-events",
  "padding-top", "padding-right", "padding-bottom", "padding-left", "content", "appearance", "accent-color",
  "width", "height", "aspect-ratio",
];

// ---- page side ---------------------------------------------------------------------------------
const PAGE_PREP = String.raw`(() => {
  const hex = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return { hex: c, a: 1 };
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    const h = '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return { hex: h, a: p.length > 3 ? p[3] : 1 };
  };
  const PAINT = ['fill', 'stroke'];
  const KEEP = ['stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-rule'];
  const out = { svgs: {}, imgs: {}, fonts: [] };
  let n = 0;
  document.querySelectorAll('svg').forEach((svg) => {
    if (svg.parentElement && svg.parentElement.closest('svg')) return;
    const key = 's' + n++;
    svg.setAttribute('data-wk', key);
    const r = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true);
    clone.removeAttribute('data-wk');
    const orig = [svg, ...svg.querySelectorAll('*')];
    const copy = [clone, ...clone.querySelectorAll('*')];
    orig.forEach((o, i) => {
      const cs = getComputedStyle(o);
      const c = copy[i];
      for (const p of PAINT) {
        const v = cs.getPropertyValue(p);
        if (!v || v === 'none') { c.setAttribute(p, 'none'); continue; }
        const { hex: h, a } = hex(v);
        c.setAttribute(p, h);
        if (a < 1) c.setAttribute(p + '-opacity', String(+a.toFixed(3)));
      }
      for (const p of KEEP) {
        const v = cs.getPropertyValue(p);
        if (v && v !== 'none' && v !== 'normal') c.setAttribute(p, v.replace(/px/g, ''));
      }
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(+r.width.toFixed(2)));
    clone.setAttribute('height', String(+r.height.toFixed(2)));
    const cs = getComputedStyle(svg);
    out.svgs[key] = {
      markup: clone.outerHTML.replace(/ (style|class)="[^"]*"/g, ''),
      color: cs.color,
      box: [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(2)),
      overflow: cs.overflow,
    };
  });
  document.querySelectorAll('img').forEach((img, i) => {
    const key = 'i' + i;
    img.setAttribute('data-wk', key);
    out.imgs[key] = { src: img.currentSrc || img.src, natural: [img.naturalWidth, img.naturalHeight], alt: img.alt };
  });
  out.placeholders = {};
  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el, i) => {
    el.setAttribute('data-wp', 'p' + i);
    out.placeholders['p' + i] = getComputedStyle(el, '::placeholder').color;
  });
  document.fonts.forEach((f) => out.fonts.push({ family: f.family, weight: f.weight, style: f.style, status: f.status }));
  out.title = document.title;
  out.viewport = [innerWidth, innerHeight];
  return out;
})()`;

// ---- helpers -----------------------------------------------------------------------------------
const num = (v) => (v == null || v === "" ? 0 : parseFloat(v) || 0);
function rgba(c) {
  if (!c || c === "none" || c === "transparent") return null;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return { raw: c };
  const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
  const a = p.length > 3 ? p[3] : 1;
  if (a === 0) return null;
  const hex = "#" + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return a === 1 ? { hex } : { hex, a: +a.toFixed(3) };
}
/** Splits a comma list at top level (not inside parentheses). */
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
function shadows(v) {
  if (!v || v === "none") return [];
  return splitTop(v).map((s) => {
    const inset = /\binset\b/.test(s);
    const colorM = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(s);
    const rest = s.replace(colorM?.[0] ?? "", "").replace("inset", "").trim().split(/\s+/).map(num);
    const [x = 0, y = 0, blur = 0, spread = 0] = rest;
    return { type: inset ? "INNER_SHADOW" : "DROP_SHADOW", x, y, blur, spread, color: rgba(colorM?.[0]) };
  });
}
function rotationOf(matrix) {
  const m = /matrix\(([^)]+)\)/.exec(matrix ?? "");
  if (!m) return { deg: 0, tx: 0, ty: 0, scale: 1 };
  const [a, b, , , tx, ty] = m[1].split(",").map(Number);
  return { deg: +((Math.atan2(b, a) * 180) / Math.PI).toFixed(3), tx, ty, scale: +Math.hypot(a, b).toFixed(4) };
}
function radius(v, w, h) {
  if (!v) return 0;
  const parts = v.split(/\s+/);
  // one value is both radii; a percentage is of the width for rx and of the height for ry
  const [px, py] = parts.length === 1 ? [parts[0], parts[0]] : parts;
  const rx = px.endsWith("%") ? (num(px) / 100) * w : num(px);
  const ry = py.endsWith("%") ? (num(py) / 100) * h : num(py);
  if (Math.abs(rx - ry) > 0.01) return { rx: +rx.toFixed(2), ry: +ry.toFixed(2) };
  return +rx.toFixed(2);
}

// ---- main --------------------------------------------------------------------------------------
export async function extract(c) {
  const prep = await c.evaluate(PAGE_PREP);
  const snap = await c.send("DOMSnapshot.captureSnapshot", {
    computedStyles: STYLES,
    includePaintOrder: true,
    includeDOMRects: true,
    includeBlendedBackgroundColors: false,
    includeTextColorOpacities: false,
  });
  const S = snap.strings;
  const str = (i) => (i == null || i < 0 ? undefined : S[i]);
  const d = snap.documents[0];
  const N = d.nodes;
  const L = d.layout;
  const T = d.textBoxes;
  const rare = (r) => {
    const m = new Map();
    if (r) r.index.forEach((ix, k) => m.set(ix, r.value ? r.value[k] : true));
    return m;
  };
  const pseudo = rare(N.pseudoType);
  const inputValue = rare(N.inputValue);
  const inputChecked = new Set(N.inputChecked?.index ?? []);
  const optionSelected = new Set(N.optionSelected?.index ?? []);
  const shadowType = rare(N.shadowRootType);
  const attrsOf = (i) => {
    const a = N.attributes[i] ?? [];
    const o = {};
    for (let k = 0; k < a.length; k += 2) o[str(a[k])] = str(a[k + 1]);
    return o;
  };

  // layout objects by DOM node
  const layoutOf = new Map(); // dom index -> [layout indices]
  L.nodeIndex.forEach((di, li) => layoutOf.set(di, [...(layoutOf.get(di) ?? []), li]));
  const boxesOfText = new Map(); // layout index -> text boxes
  T.layoutIndex.forEach((li, k) => {
    const arr = boxesOfText.get(li) ?? [];
    arr.push({ b: T.bounds[k], start: T.start[k], len: T.length[k] });
    boxesOfText.set(li, arr);
  });
  const styleOf = (li) => {
    const o = {};
    L.styles[li].forEach((si, k) => (o[STYLES[k]] = str(si)));
    return o;
  };

  const nodes = [];
  const byDom = new Map(); // dom index -> node
  const nearestNode = (di) => {
    let p = N.parentIndex[di];
    while (p >= 0 && !byDom.has(p)) p = N.parentIndex[p];
    return p >= 0 ? byDom.get(p) : null;
  };
  const viewport = { x: 0, y: 0, w: prep.viewport[0], h: prep.viewport[1] };
  const inUA = (di) => {
    for (let p = di; p >= 0; p = N.parentIndex[p]) if (shadowType.get(p) === "user-agent") return true;
    return false;
  };

  // DOM order walk (node indices are in document order; pseudo elements follow their host)
  for (let di = 0; di < N.parentIndex.length; di++) {
    const type = N.nodeType[di];
    const lis = layoutOf.get(di);
    if (!lis) continue;
    const name = str(N.nodeName[di]);
    if (type === 3) {
      // text: attach runs to the nearest element node
      const owner = nearestNode(di);
      if (!owner) continue;
      for (const li of lis) {
        const full = str(L.text[li]) ?? "";
        for (const tb of boxesOfText.get(li) ?? []) {
          const s = full.substr(tb.start, tb.len);
          if (!s.trim()) continue;
          owner.textRuns.push({ s, box: tb.b.map((v) => +v.toFixed(2)), ua: inUA(di) || undefined });
        }
      }
      continue;
    }
    if (type !== 1) continue;
    const li = lis[0];
    const st = styleOf(li);
    const a = attrsOf(di);
    const tag = (pseudo.get(di) ? `::${str(pseudo.get(di))}` : name).toLowerCase();
    if (tag === "html" || tag === "head") continue;
    const [x, y, w, h] = L.bounds[li];
    const off = L.offsetRects?.[li];
    const parent = nearestNode(di);
    const rot = rotationOf(st.transform);
    const node = {
      id: nodes.length,
      parent: parent ? parent.id : null,
      tag,
      dom: di,
      backend: N.backendNodeId[di],
      el: a.id ? `#${a.id}` : undefined,
      cls: a.class || undefined,
      data: Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith("data-") && k !== "data-wk" && k !== "data-wp")),
      inline: a.style || undefined, // os-ui writes every state-dependent value as an inline style
      box: [x, y, w, h].map((v) => +v.toFixed(2)),
      size: off && off.length === 4 && (off[2] || off[3]) ? [off[2], off[3]] : undefined,
      order: L.paintOrders ? L.paintOrders[li] : undefined,
      st,
      ua: inUA(di) || undefined,
      textRuns: [],
    };
    if (!Object.keys(node.data).length) delete node.data;
    // paint
    const bg = rgba(st["background-color"]);
    const bw = ["top", "right", "bottom", "left"].map((s) => num(st[`border-${s}-width`]));
    const bs = ["top", "right", "bottom", "left"].map((s) => st[`border-${s}-style`]);
    const bc = ["top", "right", "bottom", "left"].map((s) => rgba(st[`border-${s}-color`]));
    const clip = st["background-clip"];
    const pad = ["top", "right", "bottom", "left"].map((s) => num(st[`padding-${s}`]));
    const inset = clip === "padding-box" ? bw : clip === "content-box" ? bw.map((v, i) => v + pad[i]) : [0, 0, 0, 0];
    node.paint = {};
    if (bg) node.paint.fill = bg;
    if (st["background-image"] && st["background-image"] !== "none")
      node.paint.bgImage = { image: st["background-image"], size: st["background-size"], pos: st["background-position"], repeat: st["background-repeat"] };
    if (inset.some(Boolean) && (bg || node.paint.bgImage)) node.paint.fillInset = inset;
    const strokes = bw.map((wd, i) => (wd > 0 && bs[i] !== "none" && bs[i] !== "hidden" && bc[i] ? { w: wd, style: bs[i], color: bc[i] } : null));
    if (strokes.some(Boolean)) node.paint.border = strokes;
    const rr = ["top-left", "top-right", "bottom-right", "bottom-left"].map((cn) => radius(st[`border-${cn}-radius`], off ? off[2] : w, off ? off[3] : h));
    if (rr.some((v) => (typeof v === "number" ? v > 0 : true))) node.paint.radius = rr.every((v) => v === rr[0]) ? rr[0] : rr;
    const fx = shadows(st["box-shadow"]);
    if (fx.length) node.paint.shadows = fx;
    if (num(st["outline-width"]) > 0 && st["outline-style"] !== "none")
      node.paint.outline = { w: num(st["outline-width"]), style: st["outline-style"], color: rgba(st["outline-color"]), offset: num(st["outline-offset"]) };
    if (st.opacity && +st.opacity < 1) node.paint.opacity = +st.opacity;
    if (st.filter && st.filter !== "none") node.paint.filter = st.filter;
    if (st["mix-blend-mode"] && st["mix-blend-mode"] !== "normal") node.paint.blend = st["mix-blend-mode"];
    if (st["clip-path"] && st["clip-path"] !== "none") node.paint.clipPath = st["clip-path"];
    if (rot.deg || rot.scale !== 1) node.transform = { rotation: rot.deg, scale: rot.scale, size: off ? [off[2], off[3]] : undefined };
    if (st["overflow-x"] !== "visible" || st["overflow-y"] !== "visible") node.clips = [st["overflow-x"], st["overflow-y"]];
    if (st.visibility !== "visible") node.hiddenSelf = st.visibility;
    if (a["data-wk"]?.startsWith("s")) node.svg = prep.svgs[a["data-wk"]];
    if (a["data-wk"]?.startsWith("i")) node.img = { ...prep.imgs[a["data-wk"]], fit: st["object-fit"], rendering: st["image-rendering"] };
    if (name === "INPUT" || name === "TEXTAREA" || name === "SELECT") {
      node.input = { type: a.type ?? (name === "SELECT" ? "select" : "text"), value: inputValue.get(di) != null ? str(inputValue.get(di)) : a.value, placeholder: a.placeholder, placeholderColor: a["data-wp"] ? rgba(prep.placeholders[a["data-wp"]]) : undefined, checked: inputChecked.has(di) || undefined };
      if (name === "SELECT") {
        // the shown option's label
        for (let k = di + 1; k < N.parentIndex.length && N.parentIndex[k] >= di; k++)
          if (str(N.nodeName[k]) === "OPTION" && optionSelected.has(k)) {
            for (let t = k + 1; t < N.parentIndex.length && N.parentIndex[t] === k; t++) node.input.value = str(N.nodeValue[t]);
          }
      }
    }
    // text style lives on the element that owns the runs
    node.font = {
      family: st["font-family"], weight: num(st["font-weight"]), size: num(st["font-size"]),
      lineHeight: st["line-height"] === "normal" ? "normal" : num(st["line-height"]),
      letterSpacing: st["letter-spacing"] === "normal" ? 0 : num(st["letter-spacing"]),
      style: st["font-style"], color: rgba(st.color), align: st["text-align"], whiteSpace: st["white-space"],
      overflow: st["text-overflow"], transform: st["text-transform"],
    };
    nodes.push(node);
    byDom.set(di, node);
  }

  // effective clip rects and visibility
  const kids = new Map();
  for (const n of nodes) if (n.parent != null) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
  const clipOf = new Map();
  const isect = (a, b) => {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  for (const n of nodes) {
    const pc = n.parent != null ? clipOf.get(n.parent) : viewport;
    let clip = pc;
    const [x, y, w, h] = n.box;
    if (n.clips) clip = isect(pc, { x, y, w, h });
    clipOf.set(n.id, clip);
    const inherited = n.parent != null ? nodes[n.parent].invisible : false;
    const transparent = n.paint.opacity === 0 || (n.parent != null && nodes[n.parent].transparent);
    n.transparent = transparent || undefined;
    const visBox = isect(pc, { x, y, w: Math.max(w, 0.01), h: Math.max(h, 0.01) });
    n.clippedOut = visBox.w <= 0 || visBox.h <= 0 ? true : undefined;
    n.invisible = inherited || transparent || undefined;
  }
  return { meta: { url: undefined, title: prep.title, viewport: prep.viewport, fonts: prep.fonts }, nodes, kids };
}

/** The font Chrome actually drew each text-owning node with (CSS.getPlatformFontsForNode). */
export async function resolveFonts(c, doc) {
  await c.send("DOM.getDocument", { depth: -1, pierce: false });
  const owners = doc.nodes.filter((n) => n.textRuns.length || n.input);
  const { nodeIds } = await c.send("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: owners.map((n) => n.backend) });
  const used = new Map();
  for (const [k, n] of owners.entries()) {
    if (!nodeIds[k]) continue;
    try {
      const { fonts } = await c.send("CSS.getPlatformFontsForNode", { nodeId: nodeIds[k] });
      if (!fonts.length) continue;
      fonts.sort((a, b) => b.glyphCount - a.glyphCount);
      n.usedFonts = fonts.map((f) => ({ family: f.familyName, ps: f.postScriptName, custom: f.isCustomFont, glyphs: f.glyphCount }));
      used.set(n.id, fonts[0].familyName);
    } catch {}
  }
  return used;
}

/** Whether a node draws anything by itself. */
export function paints(n) {
  if (n.hiddenSelf) return n.textRuns.length > 0 && false;
  return !!(n.paint.fill || n.paint.bgImage || n.paint.border || n.paint.shadows || n.paint.outline || n.svg || n.img || n.textRuns.length || n.input);
}
