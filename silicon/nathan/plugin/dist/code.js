"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __objRest = (source, exclude) => {
    var target = {};
    for (var prop in source)
      if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
        target[prop] = source[prop];
    if (source != null && __getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(source)) {
        if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
          target[prop] = source[prop];
      }
    return target;
  };

  // src/netlist/types.ts
  var GATE_TYPES = ["BUF", "NOT", "AND", "OR", "NAND", "NOR", "XOR", "XNOR"];
  var GATE_ARITY = {
    BUF: 1,
    NOT: 1,
    AND: 2,
    OR: 2,
    NAND: 2,
    NOR: 2,
    XOR: 2,
    XNOR: 2
  };
  var GATE_PREFIX = "gate/";
  var isGateCell = (cell) => cell.startsWith(GATE_PREFIX);
  var gateTypeOf = (cell) => cell.slice(GATE_PREFIX.length);
  function evalGate(type, a, b) {
    switch (type) {
      case "BUF":
        return a ? 1 : 0;
      case "NOT":
        return a ? 0 : 1;
      case "AND":
        return a && b ? 1 : 0;
      case "OR":
        return a || b ? 1 : 0;
      case "NAND":
        return a && b ? 0 : 1;
      case "NOR":
        return a || b ? 0 : 1;
      case "XOR":
        return (a ? 1 : 0) ^ (b ? 1 : 0) ? 1 : 0;
      case "XNOR":
        return (a ? 1 : 0) ^ (b ? 1 : 0) ? 0 : 1;
    }
  }
  var CONST0 = "0";
  var CONST1 = "1";
  function gatePorts(type) {
    return GATE_ARITY[type] === 1 ? [
      { name: "A", dir: "in", width: 1 },
      { name: "Y", dir: "out", width: 1 }
    ] : [
      { name: "A", dir: "in", width: 1 },
      { name: "B", dir: "in", width: 1 },
      { name: "Y", dir: "out", width: 1 }
    ];
  }
  function portBits(p) {
    return p.width === 1 ? [p.name] : Array.from({ length: p.width }, (_, i) => `${p.name}[${i}]`);
  }
  var NET0 = 0;
  var NET1 = 1;

  // src/figma/names.ts
  var CELL_PREFIX = "cell/";
  var PIN_PREFIX = "pin/";
  var PORT_PREFIX = "port/";
  var WIRE_PREFIX = "wire/";
  var LIT = "lit";
  var LIT_SUFFIX = "/lit";
  var gateComponentName = (t) => `${GATE_PREFIX}${t}`;
  var cellComponentName = (module) => `${CELL_PREFIX}${module}`;
  var wireName = (net) => `${WIRE_PREFIX}${net}`;
  var wireLitName = (net) => `${WIRE_PREFIX}${net}${LIT_SUFFIX}`;
  var pinName = (port) => `${PIN_PREFIX}${port}`;
  function cellOfComponent(componentName) {
    if (componentName.startsWith(GATE_PREFIX)) {
      const t = componentName.slice(GATE_PREFIX.length);
      return GATE_TYPES.includes(t) ? componentName : null;
    }
    if (componentName.startsWith(CELL_PREFIX) && componentName.length > CELL_PREFIX.length)
      return componentName.slice(CELL_PREFIX.length);
    return null;
  }
  var portMarkerName = (p) => `${PORT_PREFIX}${p.dir}/${p.name}/${p.width}`;
  var MARKER_RE = /^port\/(in|out)\/([A-Za-z_]\w*)\/([1-9]\d*)$/;
  function parsePortMarker(name) {
    const m = MARKER_RE.exec(name);
    return m ? { name: m[2], dir: m[1], width: Number(m[3]) } : null;
  }
  function wireLitNet(layerName) {
    return layerName.startsWith(WIRE_PREFIX) && layerName.endsWith(LIT_SUFFIX) && layerName.length > WIRE_PREFIX.length + LIT_SUFFIX.length ? layerName.slice(WIRE_PREFIX.length, -LIT_SUFFIX.length) : null;
  }
  function propName(key) {
    const i = key.lastIndexOf("#");
    return i < 0 ? key : key.slice(0, i);
  }
  var BIT_RE = /^(.+)\[(\d+)\]$/;
  var RANGE_RE = /^(.+)\[(\d+):(\d+)\]$/;
  function formatNets(nets) {
    const parts = [];
    let i = 0;
    while (i < nets.length) {
      const m = BIT_RE.exec(nets[i]);
      if (m) {
        const base = m[1];
        const start = Number(m[2]);
        let j = i + 1;
        let step = 0;
        while (j < nets.length) {
          const n = BIT_RE.exec(nets[j]);
          if (!n || n[1] !== base) break;
          const d = Number(n[2]) - Number(BIT_RE.exec(nets[j - 1])[2]);
          if (step === 0 && (d === 1 || d === -1)) step = d;
          if (d !== step) break;
          j++;
        }
        if (j - i >= 2) {
          parts.push(`${base}[${start}:${start + step * (j - i - 1)}]`);
          i = j;
          continue;
        }
      }
      parts.push(nets[i]);
      i++;
    }
    return parts.join(", ");
  }
  function parseNets(text2) {
    const out = [];
    for (const raw of text2.split(",")) {
      const item = raw.trim();
      if (!item) continue;
      const r = RANGE_RE.exec(item);
      if (r) {
        const [a, b] = [Number(r[2]), Number(r[3])];
        const step = b >= a ? 1 : -1;
        for (let k = a; ; k += step) {
          out.push(`${r[1]}[${k}]`);
          if (k === b) break;
        }
      } else out.push(item);
    }
    return out;
  }

  // src/figma/bindings.ts
  function collectBindings(top, net) {
    const gateAt = /* @__PURE__ */ new Map();
    net.gates.forEach((g, i) => gateAt.set(g.path, i));
    const gateLit = /* @__PURE__ */ new Map();
    const wireLit = /* @__PURE__ */ new Map();
    const walk = (node, prefix) => {
      for (const c of node.children) {
        if (c.type === "INSTANCE") {
          const path = prefix + c.name;
          const gi = gateAt.get(path);
          if (gi === void 0) walk(c, `${path}/`);
          else {
            const lit2 = c.children.find((x) => x.name === LIT);
            if (lit2) gateLit.set(gi, lit2);
          }
          continue;
        }
        const local = wireLitNet(c.name);
        if (local !== null) {
          const id2 = net.aliases.get(prefix + local);
          if (id2 !== void 0 && id2 > 1) {
            const list = wireLit.get(id2);
            if (list) list.push(c);
            else wireLit.set(id2, [c]);
          }
          continue;
        }
        if (c.name.startsWith(PORT_PREFIX)) continue;
        if ("children" in c) walk(c, prefix);
      }
    };
    walk(top, "");
    const missing = net.gates.filter((_, i) => !gateLit.has(i)).map((g) => g.path);
    return { gateLit, wireLit, missing };
  }

  // src/figma/style.ts
  var C = {
    bg: "#141414",
    card: "#1E1E1E",
    cell: "#262626",
    stroke: "#333333",
    text: "#E8E8E8",
    dim: "#8C8C8C",
    gate: "#BDBDBD",
    lead: "#8C8C8C",
    wire: "#5E5E5E",
    net: "#D9A441",
    lit: "#F5C542"
  };
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 };
  }
  function solid(hex, opacity = 1) {
    return [{ type: "SOLID", color: rgb(hex), opacity }];
  }
  var fonts = null;
  async function loadFonts() {
    if (fonts) return fonts;
    const sans = { family: "Inter", style: "Regular" };
    const bold = { family: "Inter", style: "Bold" };
    await figma.loadFontAsync(sans);
    await figma.loadFontAsync(bold);
    let mono = { family: "Roboto Mono", style: "Regular" };
    try {
      await figma.loadFontAsync(mono);
    } catch (e) {
      mono = sans;
    }
    fonts = { sans, bold, mono };
    return fonts;
  }
  function addText(parent, name, chars, x, y, o = {}) {
    var _a, _b, _c;
    if (!fonts) throw new Error("addText before loadFonts()");
    const t = figma.createText();
    parent.appendChild(t);
    t.name = name;
    t.fontName = fonts[(_a = o.font) != null ? _a : "sans"];
    t.fontSize = (_b = o.size) != null ? _b : 12;
    t.characters = chars;
    t.fills = solid((_c = o.color) != null ? _c : C.text);
    t.x = x;
    t.y = y;
    return t;
  }
  function textWidth(s, size2) {
    return Math.ceil(s.length * size2 * 0.62);
  }
  function unwrapSvg(parent, svg, x = 0, y = 0) {
    const f = figma.createNodeFromSvg(svg);
    parent.appendChild(f);
    f.x = x;
    f.y = y;
    const out = [];
    for (const c of [...f.children]) {
      const cx = f.x + c.x;
      const cy = f.y + c.y;
      parent.appendChild(c);
      c.x = cx;
      c.y = cy;
      out.push(c);
    }
    f.remove();
    return out;
  }

  // src/figma/layout.ts
  var GRID = 8;
  var PITCH = 16;
  var STUB = 16;
  var BAND = 16;
  var TITLE_H = 48;
  var PAD = 16;
  var NAME_SIZE = 9;
  var NET_SIZE = 8;
  var ROW_GAP = 24;
  var PORT_GAP = 8;
  var MIN_CHANNEL = 32;
  var MAX_CHANNEL = 192;
  var LABEL_CHANNEL = 48;
  var up = (v) => Math.ceil(v / GRID) * GRID;
  var portMarkerHeight = (width) => BAND + width * PITCH;
  var bitOffset = (i) => BAND + PITCH / 2 + i * PITCH;
  function portMarkerWidth(p) {
    const name = textWidth(p.name, NAME_SIZE);
    return up(
      p.dir === "in" ? Math.max(STUB + 8, 2 + name + 4 + textWidth(formatNets(portBits(p)), NET_SIZE) + 4) : Math.max(STUB + 8, 6 + name + 4 + STUB)
    );
  }
  function moduleGeom(ports, w, h, markerY) {
    const pins = /* @__PURE__ */ new Map();
    const outLabels = /* @__PURE__ */ new Map();
    ports.forEach((p, i) => {
      portBits(p).forEach((b, k) => pins.set(b, { x: p.dir === "in" ? 0 : w, y: markerY[i] + bitOffset(k), dir: p.dir }));
      if (p.dir === "out") outLabels.set(p.name, { x: w - STUB + 2, y: markerY[i] + 4, h: 11, size: NET_SIZE });
    });
    return { w, h, ports, pins, outLabels };
  }
  function layoutModule(def, geomOf, opts = {}) {
    var _a, _b, _c, _d;
    const n = def.instances.length;
    const geoms = def.instances.map((i) => geomOf(i.cell));
    const nets = /* @__PURE__ */ new Map();
    const info = (name) => {
      let x = nets.get(name);
      if (!x) nets.set(name, x = { name, driver: null, sinks: [] });
      return x;
    };
    def.ports.forEach(
      (p, pi) => portBits(p).forEach((b, k) => {
        const e = { inst: -1, key: b, port: pi, k };
        const x = info(b);
        if (p.dir === "out") x.sinks.push(e);
        else if (!x.driver) x.driver = e;
      })
    );
    def.instances.forEach((inst, ii) => {
      var _a2;
      for (const p of geoms[ii].ports) {
        const bits2 = portBits(p);
        ((_a2 = inst.conn[p.name]) != null ? _a2 : []).forEach((net, k) => {
          if (net === CONST0 || net === CONST1 || k >= bits2.length) return;
          const e = { inst: ii, key: bits2[k], port: -1, k };
          const x = info(net);
          if (p.dir === "in") x.sinks.push(e);
          else if (!x.driver) x.driver = e;
        });
      }
    });
    const preds = def.instances.map(() => []);
    for (const x of nets.values())
      if (x.driver && x.driver.inst >= 0) {
        for (const s of x.sinks) if (s.inst >= 0) preds[s.inst].push(x.driver.inst);
      }
    const depth = new Int32Array(n).fill(-1);
    const onStack = new Uint8Array(n);
    const visit = (i) => {
      if (depth[i] >= 0) return depth[i];
      if (onStack[i]) return -1;
      onStack[i] = 1;
      let d = 0;
      for (const j of preds[i]) d = Math.max(d, visit(j));
      onStack[i] = 0;
      return depth[i] = d + 1;
    };
    for (const p of def.ports)
      if (p.dir === "out")
        for (const b of portBits(p)) {
          const d = (_a = nets.get(b)) == null ? void 0 : _a.driver;
          if (d && d.inst >= 0) visit(d.inst);
        }
    for (let i = 0; i < n; i++) visit(i);
    const nLogical = n ? Math.max(...depth) : 0;
    const logical = Array.from({ length: nLogical }, () => []);
    for (let i = 0; i < n; i++) logical[depth[i] - 1].push(i);
    let sinkCount = 0;
    for (const x of nets.values()) if (x.driver) sinkCount += x.sinks.length;
    const wired = opts.wires === true || opts.wires !== false && n <= ((_b = opts.maxWiredInstances) != null ? _b : 40) && sinkCount <= ((_c = opts.maxWiredSinks) != null ? _c : 240);
    const area = geoms.reduce((a, g) => a + g.w * g.h, 0);
    const maxColH = wired ? 4800 : Math.max(1200, 1.5 * Math.sqrt(area));
    const cols = [];
    for (const col of logical) {
      const hsum = col.reduce((a, i) => a + geoms[i].h + ROW_GAP, 0);
      const parts = Math.max(1, Math.ceil(hsum / maxColH));
      const per = Math.ceil(col.length / parts);
      for (let k = 0; k < col.length; k += per) cols.push(col.slice(k, k + per));
    }
    const ncol = cols.length;
    const colOf = new Int32Array(n);
    cols.forEach((c, ci) => c.forEach((i) => colOf[i] = ci));
    const tracks = Array.from({ length: ncol + 1 }, () => /* @__PURE__ */ new Set());
    for (const x of nets.values()) {
      if (!x.driver || !x.sinks.length) continue;
      for (const s of x.sinks) tracks[s.inst >= 0 ? colOf[s.inst] : ncol].add(x.name);
      tracks[x.driver.inst >= 0 ? colOf[x.driver.inst] + 1 : 0].add(x.name);
    }
    const chan = tracks.map(
      (t) => wired ? Math.min(MAX_CHANNEL, Math.max(MIN_CHANNEL, up(GRID * (t.size + 3)))) : LABEL_CHANNEL
    );
    const ins = def.ports.map((p, i) => ({ p, i })).filter((x) => x.p.dir === "in");
    const outs = def.ports.map((p, i) => ({ p, i })).filter((x) => x.p.dir === "out");
    const markerW = def.ports.map(portMarkerWidth);
    const inW = Math.max(0, ...ins.map((x) => markerW[x.i]));
    const outW = Math.max(0, ...outs.map((x) => markerW[x.i]));
    const colW = cols.map((c) => Math.max(...c.map((i) => geoms[i].w)));
    const colX = [];
    let cx = up(Math.max(STUB, inW) + chan[0]);
    for (let c = 0; c < ncol; c++) {
      colX.push(cx);
      cx += colW[c] + chan[c + 1];
    }
    const lastRight = ncol ? colX[ncol - 1] + colW[ncol - 1] : Math.max(inW, STUB);
    const W2 = up(Math.max(lastRight + chan[ncol] + Math.max(STUB, outW), inW + outW + 4 * GRID, ((_d = opts.titleWidth) != null ? _d : 0) + 2 * PAD));
    const instY = new Float64Array(n);
    const portY = new Float64Array(def.ports.length);
    const pinY = (e) => e.inst >= 0 ? instY[e.inst] + geoms[e.inst].pins.get(e.key).y : portY[e.port] + bitOffset(e.k);
    const stack = (list, want) => {
      let cursor = TITLE_H;
      for (const { p, i } of list) {
        const w = want(i);
        portY[i] = up(Math.max(cursor, Number.isNaN(w) ? cursor : w));
        cursor = portY[i] + portMarkerHeight(p.width) + PORT_GAP;
      }
    };
    stack(ins, () => NaN);
    stack(outs, () => NaN);
    const pinsOf = (dir) => def.instances.map((inst, ii) => {
      var _a2;
      const out = [];
      for (const p of geoms[ii].ports) {
        if (p.dir !== dir) continue;
        const bits2 = portBits(p);
        ((_a2 = inst.conn[p.name]) != null ? _a2 : []).forEach((net, k) => {
          const x = nets.get(net);
          if (x && k < bits2.length) out.push({ key: bits2[k], net: x });
        });
      }
      return out;
    });
    const inputPins = pinsOf("in");
    const outputPins = pinsOf("out");
    const mean = (v) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
    for (let pass = 0; pass < 3; pass++) {
      for (let c = 0; c < ncol; c++) {
        const items = cols[c].map((i) => {
          const back = [];
          const fwd = [];
          for (const { key, net } of inputPins[i]) {
            const d = net.driver;
            if (d && (d.inst < 0 || colOf[d.inst] < c)) back.push(pinY(d) - geoms[i].pins.get(key).y);
          }
          if (pass > 0) {
            for (const { key, net } of outputPins[i])
              for (const s of net.sinks)
                if (s.inst < 0 || colOf[s.inst] > c) fwd.push(pinY(s) - geoms[i].pins.get(key).y);
          }
          return { i, want: mean([mean(back), mean(fwd)].filter((v) => !Number.isNaN(v))) };
        });
        items.sort((a, b) => (Number.isNaN(a.want) ? 1e12 : a.want) - (Number.isNaN(b.want) ? 1e12 : b.want) || a.i - b.i);
        let cursor = TITLE_H;
        for (const { i, want } of items) {
          instY[i] = up(Math.max(cursor, Number.isNaN(want) ? cursor : want));
          cursor = instY[i] + geoms[i].h + ROW_GAP;
        }
      }
      const portWant = (i) => {
        const p = def.ports[i];
        const ys = [];
        portBits(p).forEach((b, k) => {
          const x = nets.get(b);
          if (!x) return;
          const ends = p.dir === "in" ? x.sinks : x.driver ? [x.driver] : [];
          for (const e of ends) if (e.inst >= 0) ys.push(pinY(e) - bitOffset(k));
        });
        return mean(ys);
      };
      stack(ins, portWant);
      stack(outs, portWant);
    }
    let top = Infinity;
    for (let i = 0; i < n; i++) top = Math.min(top, instY[i]);
    for (let i = 0; i < def.ports.length; i++) top = Math.min(top, portY[i]);
    if (Number.isFinite(top) && top > TITLE_H) {
      for (let i = 0; i < n; i++) instY[i] -= top - TITLE_H;
      for (let i = 0; i < def.ports.length; i++) portY[i] -= top - TITLE_H;
    }
    let bottom = TITLE_H;
    for (let i = 0; i < n; i++) bottom = Math.max(bottom, instY[i] + geoms[i].h);
    def.ports.forEach((p, i) => bottom = Math.max(bottom, portY[i] + portMarkerHeight(p.width)));
    let feedback = 0;
    if (wired)
      for (const x of nets.values()) {
        const d = x.driver;
        if (d && d.inst >= 0 && x.sinks.some((s) => s.inst >= 0 && colOf[s.inst] <= colOf[d.inst])) feedback++;
      }
    const H2 = up(bottom + PAD + feedback * GRID);
    const instances = def.instances.map((d, i) => ({ def: d, x: colX[colOf[i]], y: instY[i], geom: geoms[i], col: colOf[i] }));
    const ports = def.ports.map((p, i) => ({
      def: p,
      x: p.dir === "in" ? 0 : W2 - markerW[i],
      y: portY[i],
      w: markerW[i],
      h: portMarkerHeight(p.width)
    }));
    const geom = moduleGeom(def.ports, W2, H2, Array.from(portY));
    const endPoint = (e) => e.inst >= 0 ? { x: instances[e.inst].x + geoms[e.inst].pins.get(e.key).x, y: pinY(e) } : { x: def.ports[e.port].dir === "in" ? STUB : W2 - STUB, y: pinY(e) };
    const fromRight = (e) => e.inst >= 0 ? geoms[e.inst].pins.get(e.key).dir === "out" : def.ports[e.port].dir === "in";
    const jobs = [...nets.values()].filter((x) => x.driver && x.sinks.length).map((x, id2) => {
      const ends = [x.driver, ...x.sinks];
      const pts = ends.map(endPoint);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { x, id: id2, ends, pts, hpwl: Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) };
    });
    const attempt = (order) => {
      var _a2;
      const router = new Router(W2, H2);
      if (!router.ok) return null;
      router.blockRect(0, 0, W2, TITLE_H - GRID);
      router.blockRect(0, 0, STUB, H2);
      router.blockRect(W2 - STUB, 0, W2, H2);
      for (const pl of ports) router.blockRect(pl.x, pl.y, pl.x + pl.w, pl.y + BAND);
      for (const pi of instances) {
        router.blockRect(pi.x, pi.y, pi.x + pi.geom.w, pi.y + pi.geom.h);
        for (const [port, a] of pi.geom.outLabels) {
          const right = a.x + textWidth(formatNets((_a2 = pi.def.conn[port]) != null ? _a2 : []), a.size);
          if (right > pi.geom.w) router.blockInside(pi.x + pi.geom.w, pi.y + a.y, pi.x + right, pi.y + a.y + a.h);
        }
        for (const [, pin] of pi.geom.pins) router.markPin(pi.x + pin.x, pi.y + pin.y, pin.dir === "out", -1);
      }
      for (const pl of ports)
        portBits(pl.def).forEach(
          (_, k) => router.markPin(pl.def.dir === "in" ? STUB : W2 - STUB, pl.y + bitOffset(k), pl.def.dir === "in", -1)
        );
      for (const j of jobs) j.ends.forEach((e, k) => router.markPin(j.pts[k].x, j.pts[k].y, fromRight(e), j.id));
      const out = /* @__PURE__ */ new Map();
      for (const j of order) {
        const w = router.routeNet(j.id, j.pts[0], j.pts.slice(1));
        if (w) out.set(j.x.name, __spreadValues({ net: j.x.name }, w));
      }
      return out;
    };
    let routed = null;
    if (wired && jobs.length) {
      jobs.sort((a, b) => a.hpwl - b.hpwl || a.id - b.id);
      routed = attempt(jobs);
      if (routed && routed.size < jobs.length) {
        const failed = jobs.filter((j) => !routed.has(j.x.name));
        const retry = attempt([...failed, ...jobs.filter((j) => routed.has(j.x.name))]);
        if (retry.size > routed.size) routed = retry;
      }
    }
    const wires = [];
    const labeled = [];
    for (const x of nets.values()) {
      if (!x.sinks.length) continue;
      const w = routed == null ? void 0 : routed.get(x.name);
      if (w) wires.push(w);
      else labeled.push(x.name);
    }
    const mode = wired && (routed || !jobs.length) ? "wires" : "labels";
    return { name: def.name, w: W2, h: H2, ports, instances, wires, labeled, mode, geom };
  }
  var DX = [1, -1, 0, 0];
  var DY = [0, 0, 1, -1];
  var BEND = 6;
  var CROSS = 10;
  var NOBODY = 2147483647;
  var MAX_NODES = 6e5;
  var WINDOW = 14;
  var Heap = class {
    constructor() {
      this.k = [];
      this.v = [];
    }
    get size() {
      return this.v.length;
    }
    clear() {
      this.k.length = 0;
      this.v.length = 0;
    }
    push(key, val) {
      const { k, v } = this;
      let i = v.length;
      k.push(key);
      v.push(val);
      while (i > 0) {
        const p = i - 1 >> 1;
        if (k[p] <= key) break;
        k[i] = k[p];
        v[i] = v[p];
        i = p;
      }
      k[i] = key;
      v[i] = val;
    }
    pop() {
      const { k, v } = this;
      const top = v[0];
      const lk = k.pop();
      const lv = v.pop();
      const n = v.length;
      if (n) {
        let i = 0;
        for (; ; ) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c];
          v[i] = v[c];
          i = c;
        }
        k[i] = lk;
        v[i] = lv;
      }
      return top;
    }
  };
  var Router = class {
    constructor(w, h) {
      this.stamp = 0;
      this.heap = new Heap();
      this.nx = w / GRID + 1;
      this.ny = h / GRID + 1;
      const size2 = this.nx * this.ny;
      this.ok = size2 <= MAX_NODES;
      if (!this.ok) return;
      this.blocked = new Uint8Array(size2);
      this.pin = new Int32Array(size2);
      this.reserve = new Int32Array(size2);
      this.occH = new Int32Array(size2);
      this.occV = new Int32Array(size2);
      this.corner = new Int32Array(size2);
      this.tree = new Int32Array(size2);
      this.g = new Int32Array(size2 * 4);
      this.prev = new Int32Array(size2 * 4);
      this.seen = new Int32Array(size2 * 4);
      this.closed = new Int32Array(size2 * 4);
    }
    node(x, y) {
      const gx = Math.round(x / GRID);
      const gy = Math.round(y / GRID);
      return gx < 0 || gy < 0 || gx >= this.nx || gy >= this.ny ? -1 : gy * this.nx + gx;
    }
    /** Blocks every grid node in the closed rectangle (px; edges snap outward). */
    blockRect(x0, y0, x1, y1) {
      this.fill(Math.floor(x0 / GRID), Math.floor(y0 / GRID), Math.ceil(x1 / GRID), Math.ceil(y1 / GRID));
    }
    /** Blocks only grid nodes strictly covered by the rectangle (edges snap inward). */
    blockInside(x0, y0, x1, y1) {
      this.fill(Math.ceil(x0 / GRID), Math.ceil(y0 / GRID), Math.floor(x1 / GRID), Math.floor(y1 / GRID));
    }
    fill(gx0, gy0, gx1, gy1) {
      for (let gy = Math.max(0, gy0); gy <= Math.min(this.ny - 1, gy1); gy++)
        for (let gx = Math.max(0, gx0); gx <= Math.min(this.nx - 1, gx1); gx++) this.blocked[gy * this.nx + gx] = 1;
    }
    /** Marks a pin and reserves the grid node in front of it (to its right if `fromRight`) for
     * the pin's net; net = -1 marks it for nobody (unrouted pins stay clear too). */
    markPin(x, y, fromRight, net) {
      const p = this.node(x, y);
      if (p < 0) return;
      const gx = p % this.nx;
      const a = fromRight ? gx + 1 < this.nx ? p + 1 : -1 : gx > 0 ? p - 1 : -1;
      const v = net < 0 ? NOBODY : net + 1;
      if (net >= 0 || !this.pin[p]) this.pin[p] = v;
      if (a >= 0 && (net >= 0 || !this.reserve[a])) this.reserve[a] = v;
    }
    /** Routes one net from its driver pin to each sink pin. Returns null (and leaves the grid
     * untouched) if any sink cannot be reached. */
    routeNet(net, drv, sinks) {
      const K = net + 1;
      const d = this.node(drv.x, drv.y);
      if (d < 0) return null;
      const touched = [d];
      this.tree[d] = K;
      const bb = { x0: d % this.nx, y0: Math.floor(d / this.nx), x1: d % this.nx, y1: Math.floor(d / this.nx) };
      const paths = [];
      const junctions = [];
      const order = sinks.map((s) => ({ s, dist: Math.abs(s.x - drv.x) + Math.abs(s.y - drv.y) })).sort((a, b) => a.dist - b.dist);
      for (const { s } of order) {
        const start = this.node(s.x, s.y);
        let states = start < 0 ? null : this.search(start, K, d, bb, true);
        if (!states && start >= 0) states = this.search(start, K, d, bb, false);
        if (!states) {
          for (const t of touched) {
            if (this.occH[t] === K) this.occH[t] = 0;
            if (this.occV[t] === K) this.occV[t] = 0;
            if (this.corner[t] === K) this.corner[t] = 0;
            if (this.tree[t] === K) this.tree[t] = 0;
          }
          return null;
        }
        const nodes = states.map((x) => x >> 2);
        const dirs = states.map((x) => x & 3);
        const pts = [this.point(nodes[0])];
        for (let i = 1; i < nodes.length; i++) {
          const axis = dirs[i] < 2 ? this.occH : this.occV;
          axis[nodes[i - 1]] = K;
          axis[nodes[i]] = K;
          touched.push(nodes[i]);
          if (i < nodes.length - 1 && dirs[i + 1] !== dirs[i]) {
            this.corner[nodes[i]] = K;
            pts.push(this.point(nodes[i]));
          }
        }
        const end = nodes[nodes.length - 1];
        pts.push(this.point(end));
        if (end !== d) {
          this.corner[end] = K;
          junctions.push(this.point(end));
        }
        for (let i = 1; i < nodes.length; i++) {
          const q = nodes[i];
          this.tree[q] = K;
          const qx = q % this.nx;
          const qy = (q - qx) / this.nx;
          bb.x0 = Math.min(bb.x0, qx);
          bb.x1 = Math.max(bb.x1, qx);
          bb.y0 = Math.min(bb.y0, qy);
          bb.y1 = Math.max(bb.y1, qy);
        }
        paths.push(pts);
      }
      return { paths, junctions };
    }
    point(p) {
      const gx = p % this.nx;
      return { x: gx * GRID, y: (p - gx) / this.nx * GRID };
    }
    /** Can the search stop at tree node p, arriving in direction d? */
    isStop(p, d, K, drv) {
      if (p === drv) return d === 1;
      if (this.pin[p]) return false;
      const h = this.occH[p];
      const v = this.occV[p];
      return !(h && h !== K || v && v !== K);
    }
    enterable(q, nd, K) {
      if (this.blocked[q] || this.pin[q]) return false;
      const r = this.reserve[q];
      if (r && r !== K) return false;
      const c = this.corner[q];
      if (c && c !== K) return false;
      const same = nd < 2 ? this.occH[q] : this.occV[q];
      return !(same && same !== K);
    }
    /** A* from a sink pin (leaving it leftwards) to any node of the net's tree. */
    search(start, K, drv, bb, windowed) {
      const { nx, ny, heap, g, prev, seen, closed } = this;
      const st = ++this.stamp;
      const sx = start % nx;
      const sy = (start - sx) / nx;
      const m = windowed ? WINDOW : nx + ny;
      const wx0 = Math.max(0, Math.min(sx, bb.x0) - m);
      const wx1 = Math.min(nx - 1, Math.max(sx, bb.x1) + m);
      const wy0 = Math.max(0, Math.min(sy, bb.y0) - m);
      const wy1 = Math.min(ny - 1, Math.max(sy, bb.y1) + m);
      const h = (qx, qy) => Math.max(0, bb.x0 - qx, qx - bb.x1) + Math.max(0, bb.y0 - qy, qy - bb.y1);
      heap.clear();
      const s0 = start * 4 + 1;
      seen[s0] = st;
      g[s0] = 0;
      prev[s0] = -1;
      heap.push(h(sx, sy), s0);
      let budget = 4 * (wx1 - wx0 + 1) * (wy1 - wy0 + 1) + 64;
      while (heap.size) {
        const s = heap.pop();
        if (closed[s] === st) continue;
        closed[s] = st;
        const p = s >> 2;
        const d = s & 3;
        if (p !== start && this.tree[p] === K && this.isStop(p, d, K, drv)) {
          const out = [];
          for (let x = s; x !== -1; x = prev[x]) out.push(x);
          return out.reverse();
        }
        if (--budget < 0) return null;
        const px = p % nx;
        const py = (p - px) / nx;
        const bendOk = p !== start && !this.pin[p] && !this.occH[p] && !this.occV[p] && !this.corner[p];
        for (let nd = 0; nd < 4; nd++) {
          if (nd === (d ^ 1) || nd !== d && !bendOk) continue;
          const qx = px + DX[nd];
          const qy = py + DY[nd];
          if (qx < wx0 || qx > wx1 || qy < wy0 || qy > wy1) continue;
          const q = qy * nx + qx;
          let cost = 1 + (nd !== d ? BEND : 0);
          if (!(this.tree[q] === K && this.isStop(q, nd, K, drv))) {
            if (!this.enterable(q, nd, K)) continue;
            const other = nd < 2 ? this.occV[q] : this.occH[q];
            if (other && other !== K) cost += CROSS;
          }
          const ns = q * 4 + nd;
          const ng = g[s] + cost;
          if (seen[ns] !== st || ng < g[ns]) {
            seen[ns] = st;
            g[ns] = ng;
            prev[ns] = s;
            heap.push(ng + h(qx, qy), ns);
          }
        }
      }
      return null;
    }
  };

  // src/figma/symbols.ts
  var GATE_W = 96;
  var GATE_H = 48;
  var PIN_Y = { A: 16, B: 32, Y: 24 };
  var PIN_Y1 = { A: 24, Y: 24 };
  var NET_LABEL_SIZE = 7;
  function gateGeom(type) {
    const ports = gatePorts(type);
    const ys = GATE_ARITY[type] === 1 ? PIN_Y1 : PIN_Y;
    const pins = /* @__PURE__ */ new Map();
    for (const p of ports) pins.set(p.name, { x: p.dir === "in" ? 0 : GATE_W, y: ys[p.name], dir: p.dir });
    const outLabels = /* @__PURE__ */ new Map([["Y", { x: outLead(type) + 2, y: 14, h: 9, size: NET_LABEL_SIZE }]]);
    return { w: GATE_W, h: GATE_H, ports, pins, outLabels };
  }
  var bubble = (cx) => `M ${cx + 4} 24 A 4 4 0 1 1 ${cx - 4} 24 A 4 4 0 1 1 ${cx + 4} 24 Z`;
  var AND_BODY = "M 24 6 L 48 6 A 18 18 0 0 1 48 42 L 24 42 Z";
  var OR_BODY = "M 22 6 Q 52 6 68 24 Q 52 42 22 42 Q 32 24 22 6 Z";
  var BUF_BODY = "M 26 8 L 62 24 L 26 40 Z";
  function body(t) {
    switch (t) {
      case "AND":
        return AND_BODY;
      case "NAND":
        return `${AND_BODY} ${bubble(70)}`;
      case "OR":
      case "XOR":
        return OR_BODY;
      case "NOR":
      case "XNOR":
        return `${OR_BODY} ${bubble(72)}`;
      case "BUF":
        return BUF_BODY;
      case "NOT":
        return `${BUF_BODY} ${bubble(66)}`;
    }
  }
  function outLead(t) {
    return { AND: 66, NAND: 74, OR: 68, XOR: 68, NOR: 76, XNOR: 76, BUF: 62, NOT: 70 }[t];
  }
  var BACK_EDGE = { AND: 24, NAND: 24, OR: 26, NOR: 26, XOR: 20, XNOR: 20 };
  function leads(t) {
    var _a;
    const out = `M ${outLead(t)} 24 L 96 24`;
    if (GATE_ARITY[t] === 1) return `M 0 24 L 26 24 ${out}`;
    const back = (_a = BACK_EDGE[t]) != null ? _a : 24;
    const arc = t === "XOR" || t === "XNOR" ? " M 16 6 Q 26 24 16 42" : "";
    return `M 0 16 L ${back} 16 M 0 32 L ${back} 32 ${out}${arc}`;
  }
  var svgDoc = (paths) => `<svg width="${GATE_W}" height="${GATE_H}" viewBox="0 0 ${GATE_W} ${GATE_H}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  function gateSymbolSvg(t) {
    return svgDoc(
      `<path d="${body(t)}" fill="${C.cell}" stroke="${C.gate}" stroke-width="1.5"/><path d="${leads(t)}" fill="none" stroke="${C.lead}" stroke-width="1.5"/>`
    );
  }
  function gateLitSvg(t) {
    return svgDoc(
      `<path d="${body(t)} M ${outLead(t)} 24 L 96 24" fill="${C.lit}" fill-opacity="0.22" stroke="${C.lit}" stroke-width="2"/>`
    );
  }
  var DOC = {
    BUF: "Buffer. Y = A",
    NOT: "Inverter. Y = \xACA",
    AND: "Y = A\xB7B",
    OR: "Y = A + B",
    NAND: "Y = \xAC(A\xB7B)",
    NOR: "Y = \xAC(A + B)",
    XOR: "Y = A \u2295 B",
    XNOR: "Y = \xAC(A \u2295 B)"
  };
  async function drawGates(page, opts = {}) {
    await figma.setCurrentPageAsync(page);
    await loadFonts();
    const out = /* @__PURE__ */ new Map();
    const existing = /* @__PURE__ */ new Map();
    for (const n of page.children) if (n.type === "COMPONENT") existing.set(n.name, n);
    GATE_TYPES.forEach((t, i) => {
      const name = gateComponentName(t);
      const old = existing.get(name);
      if (old && !opts.redraw) {
        out.set(t, old);
        return;
      }
      const x = old ? old.x : i * (GATE_W + 48);
      const y = old ? old.y : 0;
      if (old) old.remove();
      const comp = drawGate(t, opts.labels !== false);
      page.appendChild(comp);
      comp.x = x;
      comp.y = y;
      out.set(t, comp);
    });
    return out;
  }
  function drawGate(t, labels) {
    const comp = figma.createComponent();
    comp.name = gateComponentName(t);
    comp.resize(GATE_W, GATE_H);
    comp.fills = [];
    comp.clipsContent = false;
    comp.description = DOC[t];
    const [b, l] = unwrapSvg(comp, gateSymbolSvg(t));
    b.name = "body";
    if (l) l.name = "leads";
    const [lit2] = unwrapSvg(comp, gateLitSvg(t));
    lit2.name = LIT;
    lit2.visible = false;
    const geom = gateGeom(t);
    for (const p of geom.ports) {
      const pin = geom.pins.get(p.name);
      const r = figma.createRectangle();
      comp.appendChild(r);
      r.name = pinName(p.name);
      r.resize(4, 4);
      r.x = pin.x - 2;
      r.y = pin.y - 2;
      r.cornerRadius = 1;
      r.fills = solid(C.lead);
    }
    for (const p of geom.ports) {
      const key = comp.addComponentProperty(p.name, "TEXT", p.name);
      if (!labels) continue;
      const pin = geom.pins.get(p.name);
      const x = p.dir === "in" ? 2 : outLead(t) + 2;
      const txt = addText(comp, `label/${p.name}`, p.name, x, pin.y - 10, { size: NET_LABEL_SIZE, font: "mono", color: C.dim });
      txt.componentPropertyReferences = { characters: key };
    }
    return comp;
  }

  // src/figma/draw.ts
  function dependencyOrder(lib, roots = lib.keys()) {
    const out = [];
    const state = /* @__PURE__ */ new Map();
    const visit = (name, from) => {
      if (isGateCell(name)) return;
      const s = state.get(name);
      if (s === 2) return;
      if (s === 1) throw new Error(`module ${name} contains itself (via ${from})`);
      const def = lib.get(name);
      if (!def) throw new Error(`${from}: unknown cell ${name}`);
      state.set(name, 1);
      for (const i of def.instances) visit(i.cell, name);
      state.set(name, 2);
      out.push(name);
    };
    for (const r of roots) visit(r, "(root)");
    return out;
  }
  var ROW_LIMIT = 6e3;
  var GAP = 96;
  async function drawLibrary(lib, pages, opts = {}) {
    var _a, _b, _c;
    const gates = await drawGates(pages.gates, { labels: opts.gateLabels });
    await loadFonts();
    const order = dependencyOrder(lib, opts.only);
    const cpuName = (_a = opts.cpuModule) != null ? _a : "CPU";
    const existing = /* @__PURE__ */ new Map();
    for (const page of /* @__PURE__ */ new Set([pages.cells, pages.cpu])) {
      await page.loadAsync();
      for (const n of page.children)
        if (n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX)) existing.set(n.name.slice(CELL_PREFIX.length), n);
    }
    if (opts.redraw)
      for (const name of order) {
        (_b = existing.get(name)) == null ? void 0 : _b.remove();
        existing.delete(name);
      }
    const cells = /* @__PURE__ */ new Map();
    const geoms = /* @__PURE__ */ new Map();
    const layouts = /* @__PURE__ */ new Map();
    const reused = [];
    const geomOf = (cell) => {
      if (isGateCell(cell)) return gateGeom(gateTypeOf(cell));
      const g = geoms.get(cell);
      if (!g) throw new Error(`no geometry for ${cell}`);
      return g;
    };
    const mainOf = (cell) => {
      const m = isGateCell(cell) ? gates.get(gateTypeOf(cell)) : cells.get(cell);
      if (!m) throw new Error(`no component for ${cell}`);
      return m;
    };
    const shelves = /* @__PURE__ */ new Map();
    let current = null;
    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      const def = lib.get(name);
      const old = existing.get(name);
      if (old) {
        cells.set(name, old);
        geoms.set(name, geomFromComponent(old, def.ports));
        reused.push(name);
        continue;
      }
      (_c = opts.onModule) == null ? void 0 : _c.call(opts, name, i, order.length);
      const page = name === cpuName ? pages.cpu : pages.cells;
      if (current !== page) {
        await figma.setCurrentPageAsync(page);
        current = page;
      }
      const layout = layoutModule(def, geomOf, {
        wires: opts.wires,
        maxWiredInstances: opts.maxWiredInstances,
        maxWiredSinks: opts.maxWiredSinks,
        titleWidth: textWidth(def.name, 12) + 40
      });
      const comp = drawModule(def, layout, mainOf);
      page.appendChild(comp);
      let shelf = shelves.get(page);
      if (!shelf) shelves.set(page, shelf = newShelf(page, comp));
      place(shelf, comp);
      cells.set(name, comp);
      geoms.set(name, layout.geom);
      layouts.set(name, layout);
    }
    return { gates, cells, layouts, reused };
  }
  function newShelf(page, skip) {
    let bottom = -Infinity;
    for (const n of page.children) if (n !== skip) bottom = Math.max(bottom, n.y + n.height);
    return { x: 0, y: bottom === -Infinity ? 0 : bottom + 2 * GAP, rowH: 0 };
  }
  function place(s, n) {
    if (s.x > 0 && s.x + n.width > ROW_LIMIT) {
      s.x = 0;
      s.y += s.rowH + GAP;
      s.rowH = 0;
    }
    n.x = s.x;
    n.y = s.y;
    s.x += n.width + GAP;
    s.rowH = Math.max(s.rowH, n.height);
  }
  var keyCache = /* @__PURE__ */ new WeakMap();
  function propertyKeys(main) {
    let m = keyCache.get(main);
    if (!m) {
      m = /* @__PURE__ */ new Map();
      for (const [key, d] of Object.entries(main.componentPropertyDefinitions)) if (d.type === "TEXT") m.set(propName(key), key);
      keyCache.set(main, m);
    }
    return m;
  }
  function drawModule(def, L, mainOf) {
    var _a, _b;
    const comp = figma.createComponent();
    comp.name = cellComponentName(def.name);
    comp.resize(L.w, L.h);
    comp.fills = solid(C.card);
    comp.strokes = solid(C.stroke);
    comp.strokeWeight = 1;
    comp.cornerRadius = 10;
    comp.clipsContent = false;
    comp.description = (_a = def.doc) != null ? _a : "";
    addText(comp, "title", def.name, 12, 10, { size: 12, font: "bold" });
    const sub = subtitle(def, L);
    if (sub) addText(comp, "subtitle", sub, 12, 28, { size: 9, color: C.dim });
    const keys2 = /* @__PURE__ */ new Map();
    for (const p of def.ports) keys2.set(p.name, comp.addComponentProperty(p.name, "TEXT", formatNets(portBits(p))));
    if (L.wires.length) {
      const wf = figma.createFrame();
      comp.appendChild(wf);
      wf.name = "wires";
      wf.resize(L.w, L.h);
      wf.x = 0;
      wf.y = 0;
      wf.fills = [];
      wf.clipsContent = false;
      for (const w of L.wires) drawWire(wf, w);
    }
    for (const pi of L.instances) {
      const main = mainOf(pi.def.cell);
      const inst = main.createInstance();
      comp.appendChild(inst);
      inst.name = pi.def.name;
      inst.x = pi.x;
      inst.y = pi.y;
      const props = {};
      for (const [port, key] of propertyKeys(main)) props[key] = formatNets((_b = pi.def.conn[port]) != null ? _b : []);
      inst.setProperties(props);
    }
    for (const pl of L.ports) drawPortMarker(comp, pl, keys2.get(pl.def.name));
    return comp;
  }
  function subtitle(def, L) {
    var _a;
    const parts = [(_a = def.doc) != null ? _a : "", `${def.instances.length} parts`];
    if (L.mode === "labels" && L.labeled.length) parts.push("nets by name");
    const s = parts.filter(Boolean).join(" \xB7 ");
    const max = Math.max(8, Math.floor((L.w - 24) / (9 * 0.58)));
    return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
  }
  var num = (v) => String(Math.round(v * 100) / 100);
  var square = (p, r) => `M ${num(p.x - r)} ${num(p.y - r)} L ${num(p.x + r)} ${num(p.y - r)} L ${num(p.x + r)} ${num(p.y + r)} L ${num(p.x - r)} ${num(p.y + r)} Z`;
  function polyVector(parent, name, lines, dots, color, weight) {
    const all = [...lines.flat(), ...dots.flatMap((d) => [{ x: d.x - 2, y: d.y - 2 }, { x: d.x + 2, y: d.y + 2 }])];
    const x0 = Math.min(...all.map((p) => p.x));
    const y0 = Math.min(...all.map((p) => p.y));
    const rel = (p) => ({ x: p.x - x0, y: p.y - y0 });
    const data = lines.map((pts) => pts.map((p, i) => `${i ? "L" : "M"} ${num(p.x - x0)} ${num(p.y - y0)}`).join(" ")).join(" ");
    const paths = [{ windingRule: "NONE", data }];
    if (dots.length) paths.push({ windingRule: "NONZERO", data: dots.map((d) => square(rel(d), 2)).join(" ") });
    const v = figma.createVector();
    parent.appendChild(v);
    v.name = name;
    v.vectorPaths = paths;
    v.x = x0;
    v.y = y0;
    v.strokes = solid(color);
    v.strokeWeight = weight;
    v.strokeJoin = "MITER";
    v.fills = solid(color);
    return v;
  }
  function drawWire(parent, w) {
    polyVector(parent, wireName(w.net), w.paths, w.junctions, C.wire, 1.5);
    const lit2 = polyVector(parent, wireLitName(w.net), w.paths, w.junctions, C.lit, 2);
    lit2.visible = false;
  }
  function drawPortMarker(comp, pl, key) {
    const p = pl.def;
    const isIn = p.dir === "in";
    const f = figma.createFrame();
    comp.appendChild(f);
    f.name = portMarkerName(p);
    f.resize(pl.w, pl.h);
    f.x = pl.x;
    f.y = pl.y;
    f.fills = [];
    f.clipsContent = false;
    const x0 = isIn ? 0 : pl.w - STUB;
    const bits2 = portBits(p).map((_, k) => bitOffset(k));
    polyVector(
      f,
      "stub",
      bits2.map((y) => [
        { x: x0, y },
        { x: x0 + STUB, y }
      ]),
      bits2.map((y) => ({ x: isIn ? 0 : pl.w, y })),
      C.lead,
      1.5
    );
    const name = addText(f, "name", p.name, 2, 3, { size: NAME_SIZE, font: "bold", color: C.dim });
    const net = addText(f, "net", formatNets(portBits(p)), 0, 4, { size: NET_SIZE, font: "mono", color: C.net });
    if (isIn) net.x = 2 + name.width + 4;
    else {
      name.x = pl.w - STUB - 4 - name.width;
      net.x = pl.w - STUB + 2;
    }
    net.componentPropertyReferences = { characters: key };
  }
  function geomFromComponent(comp, ports) {
    const ys = ports.map((p) => {
      const m = comp.children.find((c) => c.name === portMarkerName(p));
      if (!m) throw new Error(`${comp.name}: no port marker ${portMarkerName(p)} (redraw it)`);
      return m.y;
    });
    return moduleGeom(ports, comp.width, comp.height, ys);
  }

  // src/figma/extract.ts
  var ExtractError = class extends Error {
  };
  async function extract(pages) {
    var _a;
    const found = /* @__PURE__ */ new Map();
    for (const page of pages) {
      await page.loadAsync();
      for (const comp of page.findAllWithCriteria({ types: ["COMPONENT"] })) {
        const name = cellOfComponent(comp.name);
        if (!name || isGateCell(name)) continue;
        if (found.has(name)) throw new ExtractError(`two components are named ${comp.name}`);
        found.set(name, await readModule(comp, name));
      }
    }
    for (const def of found.values())
      for (const inst of def.instances) {
        const where = `cell/${def.name} \u203A ${inst.name}`;
        const ports = isGateCell(inst.cell) ? gatePorts(gateTypeOf(inst.cell)) : (_a = found.get(inst.cell)) == null ? void 0 : _a.ports;
        if (!ports) throw new ExtractError(`${where}: its component cell/${inst.cell} is not on the extracted pages`);
        const conn = {};
        for (const p of ports) {
          const nets = inst.conn[p.name];
          if (nets === void 0) continue;
          if (nets.length !== p.width)
            throw new ExtractError(`${where}: ${p.name} needs ${p.width} net${p.width > 1 ? "s" : ""}, got ${nets.length} (${nets.join(", ")})`);
          conn[p.name] = nets;
        }
        inst.conn = conn;
      }
    try {
      return new Map(dependencyOrder(found).map((n) => [n, found.get(n)]));
    } catch (e) {
      throw new ExtractError(e.message);
    }
  }
  async function readModule(comp, name) {
    const ports = [];
    const instances = [];
    const walk = async (node) => {
      for (const c of node.children) {
        if (c.type === "INSTANCE") {
          const inst = await readInstance(c);
          if (inst) instances.push(inst);
          continue;
        }
        const port = parsePortMarker(c.name);
        if (port) {
          ports.push(port);
          continue;
        }
        if ("children" in c) await walk(c);
      }
    };
    await walk(comp);
    const dup = (names) => names.find((n, i) => names.indexOf(n) !== i);
    const dp = dup(ports.map((p) => p.name));
    if (dp) throw new ExtractError(`cell/${name}: two port markers for ${dp}`);
    const di = dup(instances.map((i) => i.name));
    if (di) throw new ExtractError(`cell/${name}: two instances named ${di}`);
    return { name, ports, instances, doc: comp.description || void 0 };
  }
  async function readInstance(node) {
    const main = await node.getMainComponentAsync();
    if (!main) throw new ExtractError(`${node.name}: instance has no main component`);
    const cell = cellOfComponent(main.name);
    if (!cell) return null;
    const conn = {};
    for (const [key, prop] of Object.entries(node.componentProperties)) {
      if (prop.type !== "TEXT") continue;
      const nets = parseNets(String(prop.value));
      if (nets.length) conn[propName(key)] = nets;
    }
    return { name: node.name, cell, conn };
  }

  // src/hdl/builder.ts
  function cellPorts(lib, cell) {
    if (isGateCell(cell)) {
      const t = cell.slice(GATE_PREFIX.length);
      if (!(t in GATE_ARITY)) throw new Error(`unknown gate ${cell}`);
      return gatePorts(t);
    }
    const m = lib.get(cell);
    if (!m) throw new Error(`unknown cell ${cell}`);
    return m.ports;
  }
  var ModuleBuilder = class {
    constructor(lib, name, spec) {
      this.lib = lib;
      this.name = name;
      this.ports = [];
      this.instances = [];
      this.used = /* @__PURE__ */ new Set();
      this.counters = /* @__PURE__ */ new Map();
      this.BUF = (a, out) => this.gate("BUF", [a], out);
      this.NOT = (a, out) => this.gate("NOT", [a], out);
      this.AND = (a, b, out) => this.gate("AND", [a, b], out);
      this.OR = (a, b, out) => this.gate("OR", [a, b], out);
      this.NAND = (a, b, out) => this.gate("NAND", [a, b], out);
      this.NOR = (a, b, out) => this.gate("NOR", [a, b], out);
      this.XOR = (a, b, out) => this.gate("XOR", [a, b], out);
      this.XNOR = (a, b, out) => this.gate("XNOR", [a, b], out);
      var _a, _b;
      for (const [n, w] of Object.entries((_a = spec.in) != null ? _a : {})) this.ports.push({ name: n, dir: "in", width: w });
      for (const [n, w] of Object.entries((_b = spec.out) != null ? _b : {})) this.ports.push({ name: n, dir: "out", width: w });
      for (const p of this.ports) {
        if (!/^[A-Za-z_][\w]*$/.test(p.name)) throw new Error(`${name}: bad port name ${p.name}`);
        for (const b of portBits(p)) this.used.add(b);
      }
    }
    port(name, dir) {
      const p = this.ports.find((x) => x.name === name);
      if (!p) throw new Error(`${this.name}: no port ${name}`);
      if (p.dir !== dir) throw new Error(`${this.name}: port ${name} is ${p.dir}, not ${dir}`);
      return portBits(p);
    }
    /** Bit nets of an input port (LSB first). */
    in(name) {
      return this.port(name, "in");
    }
    /** Bit nets of an output port (LSB first). Drive each bit exactly once. */
    out(name) {
      return this.port(name, "out");
    }
    /** Single-bit helpers. */
    in1(name) {
      return this.in(name)[0];
    }
    out1(name) {
      return this.out(name)[0];
    }
    /** Fresh internal net names (unique within the module). */
    wire(base, width = 1) {
      var _a;
      const out = [];
      for (let i = 0; i < width; i++) {
        let n = width === 1 ? base : `${base}[${i}]`;
        if (this.used.has(n)) {
          let k = (_a = this.counters.get(base)) != null ? _a : 1;
          while (this.used.has(width === 1 ? `${base}_${k}` : `${base}_${k}[${i}]`)) k++;
          this.counters.set(base, k);
          n = width === 1 ? `${base}_${k}` : `${base}_${k}[${i}]`;
        }
        this.used.add(n);
        out.push(n);
      }
      return out;
    }
    wire1(base) {
      return this.wire(base)[0];
    }
    instName(base) {
      var _a;
      const k = ((_a = this.counters.get(`#${base}`)) != null ? _a : 0) + 1;
      this.counters.set(`#${base}`, k);
      return `${base}${k}`;
    }
    /** Places a primitive gate. Returns its output net (`out`, or a fresh net). */
    gate(type, inputs, out, inst) {
      if (inputs.length !== GATE_ARITY[type]) throw new Error(`${this.name}: ${type} takes ${GATE_ARITY[type]} inputs`);
      const y = out != null ? out : this.wire1(type.toLowerCase());
      if (out && !this.used.has(out)) this.used.add(out);
      const conn = { A: [inputs[0]], Y: [y] };
      if (inputs.length === 2) conn.B = [inputs[1]];
      this.instances.push({ name: inst != null ? inst : this.instName(type.toLowerCase()), cell: `${GATE_PREFIX}${type}`, conn });
      return y;
    }
    /** AND/OR/XOR of many nets as a balanced tree of 2-input gates. */
    reduce(type, nets, out) {
      if (nets.length === 0) return type === "AND" ? CONST1 : CONST0;
      if (nets.length === 1) return out ? this.BUF(nets[0], out) : nets[0];
      let level = nets;
      while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
          if (i + 1 === level.length) next.push(level[i]);
          else next.push(this.gate(type, [level[i], level[i + 1]], level.length === 2 ? out : void 0));
        }
        level = next;
      }
      return level[0];
    }
    /** Instantiates another module. `conn` maps child port → parent nets; unconnected
     * child outputs get fresh nets. Returns every child port's nets in this scope. */
    use(cell, conn, inst) {
      const ports = cellPorts(this.lib, cell);
      const name = inst != null ? inst : this.instName(cell.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
      if (this.instances.some((i) => i.name === name)) throw new Error(`${this.name}: duplicate instance ${name}`);
      const out = {};
      const resolved = {};
      for (const p of ports) {
        let nets = conn[p.name];
        if (nets === void 0) {
          if (p.dir === "in") throw new Error(`${this.name}/${name}: input ${p.name} of ${cell} is not connected`);
          nets = this.wire(`${name}_${p.name}`, p.width);
        }
        const bus = typeof nets === "string" ? [nets] : nets;
        if (bus.length !== p.width)
          throw new Error(`${this.name}/${name}: ${cell}.${p.name} is ${p.width} bits, got ${bus.length}`);
        for (const n of bus) if (n !== CONST0 && n !== CONST1) this.used.add(n);
        resolved[p.name] = bus;
        out[p.name] = bus;
      }
      for (const k of Object.keys(conn))
        if (!ports.some((p) => p.name === k)) throw new Error(`${this.name}/${name}: ${cell} has no port ${k}`);
      this.instances.push({ name, cell, conn: resolved });
      return out;
    }
    build(doc) {
      return { name: this.name, ports: this.ports, instances: this.instances, doc };
    }
  };
  function define(lib, name, spec, body2, doc) {
    if (lib.has(name)) throw new Error(`module ${name} defined twice`);
    const b = new ModuleBuilder(lib, name, spec);
    body2(b);
    const m = b.build(doc);
    lib.set(name, m);
    return m;
  }
  function constBus(value, width) {
    return Array.from({ length: width }, (_, i) => value >> i & 1 ? CONST1 : CONST0);
  }

  // src/netlist/flatten.ts
  var NetlistError = class extends Error {
  };
  function flatten(lib, top) {
    const topDef = lib.get(top);
    if (!topDef) throw new NetlistError(`no module ${top}`);
    const netNames = [CONST0, CONST1];
    const aliases = /* @__PURE__ */ new Map([
      [CONST0, NET0],
      [CONST1, NET1]
    ]);
    const gates = [];
    const newNet = (name) => {
      netNames.push(name);
      aliases.set(name, netNames.length - 1);
      return netNames.length - 1;
    };
    const ports = topDef.ports.map((p) => ({ name: p.name, dir: p.dir, nets: portBits(p).map((b) => newNet(b)) }));
    const topBinding = /* @__PURE__ */ new Map();
    topDef.ports.forEach((p, i) => portBits(p).forEach((b, k) => topBinding.set(b, ports[i].nets[k])));
    const expand = (moduleName, prefix, binding, depth) => {
      var _a;
      if (depth > 64) throw new NetlistError(`hierarchy too deep at ${prefix} (recursive module?)`);
      const def = lib.get(moduleName);
      const local = new Map(binding);
      const resolve = (n) => {
        if (n === CONST0) return NET0;
        if (n === CONST1) return NET1;
        let id2 = local.get(n);
        if (id2 === void 0) {
          id2 = newNet(`${prefix}${n}`);
          local.set(n, id2);
        } else if (!aliases.has(`${prefix}${n}`)) aliases.set(`${prefix}${n}`, id2);
        return id2;
      };
      for (const inst of def.instances) {
        const path = `${prefix}${inst.name}`;
        if (isGateCell(inst.cell)) {
          const type = gateTypeOf(inst.cell);
          const ins = (inst.conn.B ? ["A", "B"] : ["A"]).map((p) => {
            var _a2;
            const n = (_a2 = inst.conn[p]) == null ? void 0 : _a2[0];
            if (n === void 0) throw new NetlistError(`${path}: gate input ${p} not connected`);
            return resolve(n);
          });
          const y = (_a = inst.conn.Y) == null ? void 0 : _a[0];
          if (y === void 0) throw new NetlistError(`${path}: gate output Y not connected`);
          gates.push({ type, in: ins, out: resolve(y), path });
          continue;
        }
        if (!lib.has(inst.cell)) throw new NetlistError(`${path}: unknown cell ${inst.cell}`);
        const childBinding = /* @__PURE__ */ new Map();
        for (const p of cellPorts(lib, inst.cell)) {
          const nets = inst.conn[p.name];
          if (!nets) {
            if (p.dir === "in") throw new NetlistError(`${path}: input ${p.name} of ${inst.cell} not connected`);
            continue;
          }
          const bits2 = portBits(p);
          if (nets.length !== bits2.length) throw new NetlistError(`${path}: ${inst.cell}.${p.name} width mismatch`);
          bits2.forEach((b, i) => childBinding.set(b, resolve(nets[i])));
        }
        expand(inst.cell, `${path}/`, childBinding, depth + 1);
        for (const [b, id2] of childBinding) if (!aliases.has(`${path}/${b}`)) aliases.set(`${path}/${b}`, id2);
      }
    };
    expand(top, "", topBinding, 0);
    const driver = new Int32Array(netNames.length).fill(-1);
    gates.forEach((g, i) => {
      if (g.out === NET0 || g.out === NET1) throw new NetlistError(`${g.path}: drives a constant`);
      if (driver[g.out] !== -1)
        throw new NetlistError(`net ${netNames[g.out]} has two drivers: ${gates[driver[g.out]].path} and ${g.path}`);
      driver[g.out] = i;
    });
    const inputNets = new Set(ports.filter((p) => p.dir === "in").flatMap((p) => p.nets));
    for (const n of inputNets) if (driver[n] !== -1) throw new NetlistError(`top input ${netNames[n]} is driven inside the circuit`);
    const undriven = /* @__PURE__ */ new Set();
    for (const g of gates)
      for (const n of g.in) if (n > NET1 && driver[n] === -1 && !inputNets.has(n)) undriven.add(`${netNames[n]} (read by ${g.path})`);
    for (const p of ports)
      if (p.dir === "out") {
        for (const n of p.nets) if (n > NET1 && driver[n] === -1 && !inputNets.has(n)) undriven.add(`${netNames[n]} (top output)`);
      }
    if (undriven.size) throw new NetlistError(`undriven nets: ${[...undriven].slice(0, 12).join(", ")}${undriven.size > 12 ? ` \u2026 (+${undriven.size - 12})` : ""}`);
    return { top, netNames, aliases, gates, ports, driver };
  }
  function netId(n, name) {
    const id2 = n.aliases.get(name);
    if (id2 === void 0) throw new NetlistError(`no net named ${name}`);
    return id2;
  }
  function busIds(n, base, width) {
    return Array.from({ length: width }, (_, i) => netId(n, width === 1 ? base : `${base}[${i}]`));
  }

  // src/sim/reference.ts
  var OscillationError = class extends Error {
  };
  var RefSim = class {
    constructor(net) {
      this.net = net;
      this.ticks = 0;
      this.v = new Uint8Array(net.netNames.length);
      this.v[NET1] = 1;
    }
    port(name) {
      const p = this.net.ports.find((x) => x.name === name);
      if (!p) throw new Error(`no top port ${name}`);
      return p;
    }
    /** Drives a top-level input port (number for buses, LSB = bit 0). Does not settle. */
    set(name, value) {
      const p = this.port(name);
      if (p.dir !== "in") throw new Error(`${name} is an output`);
      p.nets.forEach((n, i) => this.v[n] = value >> i & 1);
    }
    /** Reads a top-level port as a number. */
    get(name) {
      return this.port(name).nets.reduce((acc, n, i) => acc | this.v[n] << i, 0);
    }
    /** Reads any net / bus by hierarchical name. */
    peek(name, width = 1) {
      return busIds(this.net, name, width).reduce((acc, n, i) => acc | this.v[n] << i, 0);
    }
    /** Forces a net value (e.g. preloading RAM latch outputs). */
    poke(name, value, width = 1) {
      busIds(this.net, name, width).forEach((n, i) => this.v[n] = value >> i & 1);
    }
    /** Re-evaluates gates until stable. Returns the number of sweeps. */
    settle(maxSweeps = 500) {
      const { gates } = this.net;
      for (let sweep = 1; sweep <= maxSweeps; sweep++) {
        let changed = false;
        for (const g of gates) {
          const y = evalGate(g.type, this.v[g.in[0]], g.in.length > 1 ? this.v[g.in[1]] : 0);
          if (this.v[g.out] !== y) {
            this.v[g.out] = y;
            changed = true;
          }
        }
        if (!changed) return sweep;
      }
      throw new OscillationError(`circuit did not settle in ${maxSweeps} sweeps (oscillating loop?)`);
    }
    /** One clock cycle: CLK low, settle; CLK high, settle (rising edge). Requires a top input CLK. */
    tick() {
      const clk = netId(this.net, "CLK");
      this.v[clk] = 0;
      this.settle();
      this.v[clk] = 1;
      this.settle();
      this.ticks++;
    }
  };

  // src/prototype/plan.ts
  var ZERO = { const: 0 };
  var ONE = { const: 1 };
  function ref(net) {
    return net === NET0 ? ZERO : net === NET1 ? ONE : { var: net };
  }
  var lit = (v) => v ? ONE : ZERO;
  var sameVar = (a, b) => "var" in a && "var" in b && a.var === b.var;
  function not(e) {
    if ("const" in e) return lit(!e.const);
    if ("not" in e) return e.not;
    return { not: e };
  }
  function and(a, b) {
    if ("const" in a) return a.const ? b : ZERO;
    if ("const" in b) return b.const ? a : ZERO;
    return sameVar(a, b) ? a : { and: [a, b] };
  }
  function or(a, b) {
    if ("const" in a) return a.const ? ONE : b;
    if ("const" in b) return b.const ? ONE : a;
    return sameVar(a, b) ? a : { or: [a, b] };
  }
  function eq(a, b) {
    if ("const" in a) return a.const ? b : not(b);
    if ("const" in b) return b.const ? a : not(a);
    return sameVar(a, b) ? ONE : { eq: [a, b] };
  }
  function neq(a, b) {
    if ("const" in a) return a.const ? not(b) : b;
    if ("const" in b) return b.const ? not(a) : a;
    return sameVar(a, b) ? ZERO : { neq: [a, b] };
  }
  function gateExpr(g) {
    const a = ref(g.in[0]);
    const b = g.in.length > 1 ? ref(g.in[1]) : ZERO;
    switch (g.type) {
      case "BUF":
        return a;
      case "NOT":
        return not(a);
      case "AND":
        return and(a, b);
      case "OR":
        return or(a, b);
      case "NAND":
        return not(and(a, b));
      case "NOR":
        return not(or(a, b));
      case "XOR":
        return neq(a, b);
      case "XNOR":
        return eq(a, b);
    }
  }
  function varName(hier) {
    const clean = hier.replace(/[.{}]/g, "_").split("/").map((s) => s.trim()).filter(Boolean).join("/");
    return `net/${clean || "_"}`;
  }

  // src/prototype/figma-actions.ts
  var boolData = (value) => ({
    type: "BOOLEAN",
    resolvedType: "BOOLEAN",
    value
  });
  var floatData = (value) => ({
    type: "FLOAT",
    resolvedType: "FLOAT",
    value
  });
  var aliasData = (id2, resolvedType = "BOOLEAN") => ({
    type: "VARIABLE_ALIAS",
    resolvedType,
    value: { type: "VARIABLE_ALIAS", id: id2 }
  });
  var exprData = (expressionFunction, expressionArguments, resolvedType = "BOOLEAN") => ({
    type: "EXPRESSION",
    resolvedType,
    value: { expressionFunction, expressionArguments }
  });
  var setVariable = (variableId, variableValue) => ({
    type: "SET_VARIABLE",
    variableId,
    variableValue
  });
  var conditional = (condition, then, otherwise) => ({
    type: "CONDITIONAL",
    conditionalBlocks: otherwise ? [{ condition, actions: then }, { actions: otherwise }] : [{ condition, actions: then }]
  });
  var navigate = (destinationId) => ({
    type: "NODE",
    destinationId,
    navigation: "NAVIGATE",
    transition: null
  });
  var increment = (variableId, by = 1) => setVariable(
    variableId,
    exprData(
      "ADDITION",
      [aliasData(variableId, "FLOAT"), floatData(by)],
      "FLOAT"
    )
  );
  var strData = (value) => ({
    type: "STRING",
    resolvedType: "STRING",
    value
  });
  var concatText = (textId, numberId, prefix = "") => setVariable(
    textId,
    exprData(
      "ADDITION",
      [strData(prefix), aliasData(numberId, "FLOAT")],
      "STRING"
    )
  );
  var onClick = () => ({ type: "ON_CLICK" });
  var mouseDown = (delay = 0) => ({
    type: "MOUSE_DOWN",
    delay
  });
  var mouseUp = (delay = 0) => ({ type: "MOUSE_UP", delay });
  var mouseEnter = (delay = 0) => ({ type: "MOUSE_ENTER", delay });
  var keyDown = (keyCodes) => ({
    type: "ON_KEY_DOWN",
    device: "KEYBOARD",
    keyCodes
  });
  var afterTimeout = (timeout) => ({
    type: "AFTER_TIMEOUT",
    timeout
  });
  var navigateWith = (destinationId, navigation) => ({
    type: "NODE",
    destinationId,
    navigation,
    transition: null
  });
  function lookup(varIds) {
    return (n) => {
      const id2 = varIds instanceof Map ? varIds.get(n) : varIds[n];
      if (id2 === void 0) throw new Error(`no Figma variable for net ${n}`);
      return id2;
    };
  }
  function figmaExpr(e, id2) {
    if ("var" in e) return aliasData(id2(e.var));
    if ("const" in e) return boolData(e.const === 1);
    if ("not" in e) return exprData("NOT", [figmaExpr(e.not, id2)]);
    const [fn, [a, b]] = "and" in e ? ["AND", e.and] : "or" in e ? ["OR", e.or] : "eq" in e ? ["EQUALS", e.eq] : ["NOT_EQUAL", e.neq];
    return exprData(fn, [figmaExpr(a, id2), figmaExpr(b, id2)]);
  }
  function setValue(to, id2, opts) {
    if ("var" in to && opts.copy !== "alias")
      return exprData("EQUALS", [aliasData(id2(to.var)), boolData(true)]);
    return figmaExpr(to, id2);
  }
  function figmaActions(list, varIds, opts = {}) {
    const id2 = lookup(varIds);
    const conv = (l) => l.map(
      (a) => "set" in a ? setVariable(id2(a.set), setValue(a.to, id2, opts)) : conditional(
        figmaExpr(a.if, id2),
        conv(a.then),
        a.else ? conv(a.else) : void 0
      )
    );
    return conv(list);
  }

  // src/prototype/emulate.ts
  var isExpression = (v) => typeof v === "object" && v !== null && "expressionFunction" in v && "expressionArguments" in v;
  function typeOf(v) {
    return typeof v === "boolean" ? "BOOLEAN" : typeof v === "number" ? "FLOAT" : "STRING";
  }
  function evalVariableData(d, vars) {
    if (!d.type || !d.resolvedType) throw new Error(`VariableData without type/resolvedType: ${JSON.stringify(d)}`);
    let out;
    if (d.type === "VARIABLE_ALIAS") {
      const a = d.value;
      if (!a || a.type !== "VARIABLE_ALIAS" || typeof a.id !== "string") throw new Error(`bad alias ${JSON.stringify(d)}`);
      const v = vars.get(a.id);
      if (v === void 0) throw new Error(`alias to unknown variable ${a.id}`);
      out = v;
    } else if (d.type === "EXPRESSION") {
      if (!isExpression(d.value)) throw new Error(`EXPRESSION without an Expression value: ${JSON.stringify(d)}`);
      out = evalExpression(d.value, vars);
    } else if (d.type === "BOOLEAN" || d.type === "FLOAT" || d.type === "STRING") {
      const v = d.value;
      if (typeof v !== "boolean" && typeof v !== "number" && typeof v !== "string") throw new Error(`bad literal ${JSON.stringify(d)}`);
      out = v;
      if (typeOf(out) !== d.type) throw new Error(`literal ${JSON.stringify(v)} is not ${d.type}`);
    } else throw new Error(`unsupported VariableData type ${d.type}`);
    if (typeOf(out) !== d.resolvedType) throw new Error(`value ${out} does not resolve to ${d.resolvedType}`);
    return out;
  }
  function evalExpression(x, vars) {
    const args = x.expressionArguments.map((a) => evalVariableData(a, vars));
    const unary = x.expressionFunction === "NOT" || x.expressionFunction === "NEGATE";
    if (args.length !== (unary ? 1 : 2)) throw new Error(`${x.expressionFunction} with ${args.length} arguments`);
    const bools = () => {
      if (args.some((a) => typeof a !== "boolean")) throw new Error(`${x.expressionFunction} needs booleans, got ${args}`);
      return args;
    };
    const nums = () => {
      if (args.some((a) => typeof a !== "number")) throw new Error(`${x.expressionFunction} needs numbers, got ${args}`);
      return args;
    };
    switch (x.expressionFunction) {
      case "AND":
        return bools()[0] && bools()[1];
      case "OR":
        return bools()[0] || bools()[1];
      case "NOT":
        return !bools()[0];
      case "EQUALS":
        return args[0] === args[1];
      case "NOT_EQUAL":
        return args[0] !== args[1];
      case "ADDITION":
        if (typeof args[0] === "string" || typeof args[1] === "string") return `${args[0]}${args[1]}`;
        return nums()[0] + nums()[1];
      case "SUBTRACTION":
        return nums()[0] - nums()[1];
      case "MULTIPLICATION":
        return nums()[0] * nums()[1];
      case "DIVISION":
        return nums()[0] / nums()[1];
      case "NEGATE":
        return -nums()[0];
      case "LESS_THAN":
        return nums()[0] < nums()[1];
      case "LESS_THAN_OR_EQUAL":
        return nums()[0] <= nums()[1];
      case "GREATER_THAN":
        return nums()[0] > nums()[1];
      case "GREATER_THAN_OR_EQUAL":
        return nums()[0] >= nums()[1];
      default:
        throw new Error(`unsupported expression function ${x.expressionFunction}`);
    }
  }
  function runFigmaActions(actions, vars, hooks = {}) {
    var _a;
    let executed = 0;
    for (const a of actions) {
      executed++;
      switch (a.type) {
        case "SET_VARIABLE": {
          if (!a.variableId || !a.variableValue) throw new Error(`SET_VARIABLE without variable/value`);
          const old = vars.get(a.variableId);
          if (old === void 0) throw new Error(`SET_VARIABLE on unknown variable ${a.variableId}`);
          const v = evalVariableData(a.variableValue, vars);
          if (typeOf(v) !== typeOf(old)) throw new Error(`SET_VARIABLE ${a.variableId}: ${typeOf(v)} into ${typeOf(old)}`);
          vars.set(a.variableId, v);
          break;
        }
        case "CONDITIONAL": {
          for (const block of a.conditionalBlocks) {
            if (block.condition) {
              const c = evalVariableData(block.condition, vars);
              if (typeof c !== "boolean") throw new Error(`condition is not boolean`);
              if (!c) continue;
            }
            executed += runFigmaActions(block.actions, vars, hooks);
            break;
          }
          break;
        }
        case "NODE":
          (_a = hooks.navigate) == null ? void 0 : _a.call(hooks, a.destinationId);
          break;
        default:
          throw new Error(`emulator does not support ${a.type}`);
      }
    }
    return executed;
  }

  // src/prototype/draw.ts
  var FONT = { family: "Inter", style: "Regular" };
  var FONT_BOLD = { family: "Inter", style: "Bold" };
  var COLORS = {
    bg: "#16181d",
    panel: "#1f232b",
    text: "#e6e6e6",
    dim: "#8a8f98",
    lampOff: "#33363d",
    lampOn: "#3ddc84",
    amber: "#ffb000",
    step: "#2f6fed",
    run: "#1f9d55",
    stop: "#d64545",
    reset: "#555b66"
  };
  async function loadFonts2(api) {
    await api.loadFontAsync(FONT);
    await api.loadFontAsync(FONT_BOLD);
  }
  function rgb2(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 };
  }
  var solid2 = (hex) => [{ type: "SOLID", color: rgb2(hex) }];
  function text(api, characters, o = {}) {
    var _a, _b, _c, _d, _e;
    const t = api.createText();
    t.fontName = o.bold ? FONT_BOLD : FONT;
    t.fontSize = (_a = o.size) != null ? _a : 12;
    t.characters = characters;
    t.fills = solid2((_b = o.color) != null ? _b : COLORS.text);
    t.name = (_c = o.name) != null ? _c : characters.slice(0, 40);
    t.x = (_d = o.x) != null ? _d : 0;
    t.y = (_e = o.y) != null ? _e : 0;
    return t;
  }
  function box(api, name, w, h, fill = COLORS.panel, radius = 0) {
    const f = api.createFrame();
    f.name = name;
    f.resize(w, h);
    f.fills = solid2(fill);
    f.cornerRadius = radius;
    f.clipsContent = false;
    return f;
  }
  function button(api, label2, color, w = 132, h = 44) {
    const f = box(api, `button/${label2}`, w, h, color, 8);
    const t = text(api, label2, { size: 15, bold: true, color: "#ffffff", name: "label" });
    t.textAlignHorizontal = "CENTER";
    t.textAlignVertical = "CENTER";
    t.resize(w, h);
    f.appendChild(t);
    return f;
  }
  function put(parent, child, x, y) {
    parent.appendChild(child);
    child.x = x;
    child.y = y;
    return child;
  }
  var chunkName = (name, i) => i === 0 ? name : `${name} \xB7 ${i + 1}`;
  var isChunkOf = (coll, name) => coll === name || new RegExp(`^${escapeRe(name)} \xB7 \\d+$`).test(coll);
  var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  async function removeCollections(api, name) {
    const all = await api.variables.getLocalVariableCollectionsAsync();
    let n = 0;
    for (const c of all)
      if (isChunkOf(c.name, name)) {
        c.remove();
        n++;
      }
    return n;
  }
  async function createVariables(api, name, specs, o = {}) {
    var _a, _b, _c;
    const max = (_a = o.max) != null ? _a : 4e3;
    const yieldEvery = (_b = o.yieldEvery) != null ? _b : 500;
    const collections = [];
    const vars = [];
    for (let i = 0; i < specs.length; i++) {
      if (i % max === 0) collections.push(api.variables.createVariableCollection(chunkName(name, collections.length)));
      const coll = collections[collections.length - 1];
      const s = specs[i];
      let v;
      try {
        v = api.variables.createVariable(s.name, coll, s.type);
      } catch (e) {
        const safe = s.name.replace(/[^\w/ -]/g, "_");
        if (safe === s.name) throw new Error(`createVariable(${s.name}): ${e}`);
        v = api.variables.createVariable(safe, coll, s.type);
      }
      v.setValueForMode(coll.defaultModeId, s.init);
      vars.push(v);
      if ((i + 1) % yieldEvery === 0) {
        (_c = o.log) == null ? void 0 : _c.call(o, `  ${name}: ${i + 1}/${specs.length} variables`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return { collections, vars };
  }
  function setFlows(page, add) {
    const top = new Set(page.children.map((c) => c.id));
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    const names = new Set(add.map((f) => f.name));
    const push = (f) => {
      seen.add(f.nodeId);
      out.push({ nodeId: f.nodeId, name: f.name });
    };
    for (const f of add) if (!seen.has(f.nodeId)) push(f);
    for (const f of page.flowStartingPoints) if (top.has(f.nodeId) && !seen.has(f.nodeId) && !names.has(f.name)) push(f);
    page.flowStartingPoints = out;
  }
  function bindVisible(node, v) {
    if (typeof v === "boolean") node.visible = v;
    else node.setBoundVariable("visible", v);
  }

  // src/cells/util.ts
  function place2(b, type, name, inputs, out) {
    if (b.instances.some((i) => i.name === name)) throw new Error(`${b.name}: duplicate instance ${name}`);
    return b.gate(type, inputs, out != null ? out : b.wire1(name), name);
  }
  function orTree(b, name, nets, out) {
    if (nets.length === 0) throw new Error(`${b.name}: empty OR tree ${name}`);
    if (nets.length === 1) return place2(b, "BUF", name, nets, out);
    let level = nets;
    let k = 0;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 === level.length) next.push(level[i]);
        else next.push(place2(b, "OR", `${name}${++k}`, [level[i], level[i + 1]], level.length === 2 ? out : void 0));
      }
      level = next;
    }
    return level[0];
  }

  // src/cells/arith.ts
  function defineHalfAdder(lib) {
    define(
      lib,
      "HALF_ADDER",
      { in: { A: 1, B: 1 }, out: { S: 1, CO: 1 } },
      (b) => {
        const [A, B] = [b.in1("A"), b.in1("B")];
        place2(b, "XOR", "sum", [A, B], b.out1("S"));
        place2(b, "AND", "carry", [A, B], b.out1("CO"));
      },
      "Half adder: S = A \u2295 B, CO = A\xB7B"
    );
  }
  function defineFullAdder(lib) {
    define(
      lib,
      "FULL_ADDER",
      { in: { A: 1, B: 1, CI: 1 }, out: { S: 1, CO: 1 } },
      (b) => {
        const [A, B, CI] = [b.in1("A"), b.in1("B"), b.in1("CI")];
        const p = place2(b, "XOR", "p", [A, B]);
        place2(b, "XOR", "sum", [p, CI], b.out1("S"));
        const gen = place2(b, "AND", "gen", [A, B]);
        const pc = place2(b, "AND", "pc", [p, CI]);
        place2(b, "OR", "carry", [gen, pc], b.out1("CO"));
      },
      "Full adder: S = A \u2295 B \u2295 CI, CO = A\xB7B + (A \u2295 B)\xB7CI"
    );
  }
  function defineAdder(lib, width) {
    define(
      lib,
      `ADDER_W${width}`,
      { in: { A: width, B: width, CI: 1 }, out: { S: width, CO: 1 } },
      (b) => {
        const [A, B, S] = [b.in("A"), b.in("B"), b.out("S")];
        let carry = b.in1("CI");
        for (let i = 0; i < width; i++) {
          const co = i === width - 1 ? b.out1("CO") : b.wire1(`c${i + 1}`);
          b.use("FULL_ADDER", { A: A[i], B: B[i], CI: carry, S: S[i], CO: co }, `fa${i}`);
          carry = co;
        }
      },
      `${width}-bit ripple-carry adder: {CO, S} = A + B + CI`
    );
  }
  function defineInc(lib, width) {
    if (width < 2) throw new Error(`INC_W${width}: width must be \u2265 2`);
    define(
      lib,
      `INC_W${width}`,
      { in: { A: width }, out: { Y: width, CO: 1 } },
      (b) => {
        const [A, Y] = [b.in("A"), b.out("Y")];
        place2(b, "NOT", "b0", [A[0]], Y[0]);
        let carry = A[0];
        for (let i = 1; i < width; i++) {
          const co = i === width - 1 ? b.out1("CO") : b.wire1(`c${i + 1}`);
          b.use("HALF_ADDER", { A: A[i], B: carry, S: Y[i], CO: co }, `b${i}`);
          carry = co;
        }
      },
      `${width}-bit incrementer: {CO, Y} = A + 1`
    );
  }
  function defineZero(lib, width) {
    if (width < 2) throw new Error(`ZERO_W${width}: width must be \u2265 2`);
    define(
      lib,
      `ZERO_W${width}`,
      { in: { A: width }, out: { Z: 1 } },
      (b) => {
        let level = b.in("A");
        let depth = 1;
        while (level.length > 2) {
          const next = [];
          for (let i = 0; i < level.length; i += 2)
            next.push(i + 1 === level.length ? level[i] : place2(b, "OR", `or${depth}_${i / 2}`, [level[i], level[i + 1]]));
          level = next;
          depth++;
        }
        place2(b, "NOR", "nor", [level[0], level[1]], b.out1("Z"));
      },
      `${width}-bit zero detector: Z = 1 iff A = 0`
    );
  }

  // src/cells/decode.ts
  function minterms2(b, p, [lo, nlo], [hi, nhi], en, outs) {
    const h = en ? [place2(b, "AND", `${en.name}0`, [en.net, nhi]), place2(b, "AND", `${en.name}1`, [en.net, hi])] : [nhi, hi];
    return [0, 1, 2, 3].map((v) => place2(b, "AND", `${p}${v}`, [h[v >> 1], v & 1 ? lo : nlo], outs == null ? void 0 : outs[v]));
  }
  var inverters = (b, A) => A.map((a, i) => place2(b, "NOT", `n${i}`, [a]));
  function defineDec2(lib) {
    define(
      lib,
      "DEC2",
      { in: { A: 2, EN: 1 }, out: { Y: 4 } },
      (b) => {
        const A = b.in("A");
        const n = inverters(b, A);
        minterms2(b, "y", [A[0], n[0]], [A[1], n[1]], { net: b.in1("EN"), name: "en" }, b.out("Y"));
      },
      "2\u21924 one-hot decoder: Y[A] = EN, all other outputs 0"
    );
  }
  function defineDec3(lib) {
    define(
      lib,
      "DEC3",
      { in: { A: 3, EN: 1 }, out: { Y: 8 } },
      (b) => {
        const [A, EN, Y] = [b.in("A"), b.in1("EN"), b.out("Y")];
        const n = inverters(b, A);
        const lo = minterms2(b, "lo", [A[0], n[0]], [A[1], n[1]]);
        const hi = [place2(b, "AND", "hi0", [EN, n[2]]), place2(b, "AND", "hi1", [EN, A[2]])];
        for (let v = 0; v < 8; v++) place2(b, "AND", `y${v}`, [hi[v >> 2], lo[v & 3]], Y[v]);
      },
      "3\u21928 one-hot decoder: Y[A] = EN, all other outputs 0"
    );
  }
  function defineDec4(lib) {
    define(
      lib,
      "DEC4",
      { in: { A: 4, EN: 1 }, out: { Y: 16 } },
      (b) => {
        const [A, EN, Y] = [b.in("A"), b.in1("EN"), b.out("Y")];
        const n = inverters(b, A);
        const lo = minterms2(b, "lo", [A[0], n[0]], [A[1], n[1]]);
        const hi = minterms2(b, "hi", [A[2], n[2]], [A[3], n[3]], { net: EN, name: "hi_en" });
        for (let v = 0; v < 16; v++) place2(b, "AND", `y${v}`, [hi[v >> 2], lo[v & 3]], Y[v]);
      },
      "4\u219216 one-hot decoder: Y[A] = EN, all other outputs 0"
    );
  }

  // src/cells/display.ts
  var PRODUCTS = [
    // 2-literal
    ["a2a1", "a2", "a1"],
    ["n2n0", "n2", "n0"],
    ["n2n1", "n2", "n1"],
    ["a3n2", "a3", "n2"],
    ["n3a2", "n3", "a2"],
    ["a3n1", "a3", "n1"],
    ["a3a2", "a3", "a2"],
    ["a3a1", "a3", "a1"],
    ["n1n0", "n1", "n0"],
    ["a3a0", "a3", "a0"],
    ["n2a1", "n2", "a1"],
    ["a3n0", "a3", "n0"],
    ["a1a0", "a1", "a0"],
    // 3-literal, each built on a shared pair
    ["a3n2n1", "a3n2", "n1"],
    ["n3a1a0", "n3", "a1a0"],
    ["n3n1n0", "n3", "n1n0"],
    ["a3n1a0", "a3n1", "a0"],
    ["n2a1a0", "n2a1", "a0"],
    ["n3n2n0", "n3", "n2n0"],
    ["a2a1n0", "a2a1", "n0"],
    ["n3a2n1", "n3a2", "n1"],
    // 4-literal (digit 5 only)
    ["n3a2n1a0", "n3a2n1", "a0"]
  ];
  var SEGMENTS = [
    /* a */
    ["n2n0", "a2a1", "n3a1a0", "a3n0", "a3n2n1", "n3a2n1a0"],
    /* b */
    ["n2n0", "n2n1", "n3a1a0", "n3n1n0", "a3n1a0"],
    /* c */
    ["n2n1", "n3a2", "a3n2", "n3a1a0", "a3n1a0"],
    /* d */
    ["a3n1", "n3n2n0", "n2a1a0", "a2a1n0", "n3a2n1a0"],
    /* e */
    ["n2n0", "a3a2", "a3a1", "a2a1n0"],
    /* f */
    ["n1n0", "a3n2", "a3a1", "a2a1n0", "n3a2n1a0"],
    /* g */
    ["n2a1", "a3a0", "a3n2n1", "n3a2n1", "a2a1n0"]
  ];
  function defineHex7Seg(lib) {
    define(
      lib,
      "HEX7SEG",
      { in: { A: 4 }, out: { SEG: 7 } },
      (b) => {
        const [A, SEG] = [b.in("A"), b.out("SEG")];
        const net = /* @__PURE__ */ new Map();
        A.forEach((a, k) => {
          net.set(`a${k}`, a);
          net.set(`n${k}`, place2(b, "NOT", `n${k}`, [a]));
        });
        const get = (x) => {
          const n = net.get(x);
          if (!n) throw new Error(`HEX7SEG: unknown term ${x}`);
          return n;
        };
        for (const [name, x, y] of PRODUCTS) net.set(name, place2(b, "AND", name, [get(x), get(y)]));
        SEGMENTS.forEach((terms, s) => orTree(b, `seg_${"abcdefg"[s]}`, terms.map(get), SEG[s]));
      },
      "Hex to 7-segment decoder: SEG[0..6] = segments a..g, glyphs 0-9 A b C d E F"
    );
  }

  // src/cells/latches.ts
  function defineDLatch(lib) {
    define(
      lib,
      "DLATCH",
      { in: { D: 1, EN: 1 }, out: { Q: 1 } },
      (b) => {
        const [D, EN, Q] = [b.in1("D"), b.in1("EN"), b.out1("Q")];
        const nen = place2(b, "NOT", "nen", [EN]);
        const take = place2(b, "AND", "take", [D, EN]);
        const hold = place2(b, "AND", "hold", [Q, nen]);
        place2(b, "OR", "merge", [take, hold], Q);
      },
      "Gated D latch, feedback mux Q = D\xB7EN + Q\xB7\xACEN: transparent while EN=1, holds while EN=0"
    );
  }
  function defineDff(lib) {
    define(
      lib,
      "DFF",
      { in: { D: 1, CLK: 1 }, out: { Q: 1 } },
      (b) => {
        const CLK = b.in1("CLK");
        const nclk = place2(b, "NOT", "nclk", [CLK]);
        const m = b.wire1("m");
        b.use("DLATCH", { D: b.in1("D"), EN: nclk, Q: m }, "master");
        b.use("DLATCH", { D: m, EN: CLK, Q: b.out1("Q") }, "slave");
      },
      "Rising-edge D flip-flop: master latch open while CLK=0, slave latch open while CLK=1"
    );
  }
  function defineDffe(lib) {
    define(
      lib,
      "DFFE",
      { in: { D: 1, LOAD: 1, CLK: 1 }, out: { Q: 1 } },
      (b) => {
        const CLK = b.in1("CLK");
        const nclk = place2(b, "NOT", "nclk", [CLK]);
        const men = place2(b, "AND", "men", [nclk, b.in1("LOAD")]);
        const m = b.wire1("m");
        b.use("DLATCH", { D: b.in1("D"), EN: men, Q: m }, "master");
        b.use("DLATCH", { D: m, EN: CLK, Q: b.out1("Q") }, "slave");
      },
      "Load-enable flip-flop: master EN = \xACCLK\xB7LOAD, slave EN = CLK; takes D on the rising edge when LOAD=1"
    );
  }
  function defineReg(lib, width) {
    define(
      lib,
      `REG_W${width}`,
      { in: { D: width, LOAD: 1, CLK: 1 }, out: { Q: width } },
      (b) => {
        const [D, Q, LOAD, CLK] = [b.in("D"), b.out("Q"), b.in1("LOAD"), b.in1("CLK")];
        for (let i = 0; i < width; i++) b.use("DFFE", { D: D[i], LOAD, CLK, Q: Q[i] }, `b${i}`);
      },
      `${width}-bit register (${width} \xD7 DFFE sharing LOAD, CLK): loads D on the rising edge when LOAD=1`
    );
  }

  // src/cells/mux.ts
  function defineMux2(lib) {
    define(
      lib,
      "MUX2",
      { in: { A: 1, B: 1, S: 1 }, out: { Y: 1 } },
      (b) => {
        const S = b.in1("S");
        const ns = place2(b, "NOT", "ns", [S]);
        const pa = place2(b, "AND", "pass_a", [b.in1("A"), ns]);
        const pb = place2(b, "AND", "pass_b", [b.in1("B"), S]);
        place2(b, "OR", "join", [pa, pb], b.out1("Y"));
      },
      "2:1 multiplexer: Y = S ? B : A"
    );
  }
  function defineMux2W(lib, width) {
    define(
      lib,
      `MUX2_W${width}`,
      { in: { A: width, B: width, S: 1 }, out: { Y: width } },
      (b) => {
        const [A, B, S, Y] = [b.in("A"), b.in("B"), b.in1("S"), b.out("Y")];
        const ns = place2(b, "NOT", "ns", [S]);
        const pa = b.wire("pass_a", width);
        const pb = b.wire("pass_b", width);
        for (let i = 0; i < width; i++) {
          place2(b, "AND", `pass_a${i}`, [A[i], ns], pa[i]);
          place2(b, "AND", `pass_b${i}`, [B[i], S], pb[i]);
          place2(b, "OR", `join${i}`, [pa[i], pb[i]], Y[i]);
        }
      },
      `${width}-bit 2:1 multiplexer: Y = S ? B : A`
    );
  }
  function defineMux4W(lib, width) {
    define(
      lib,
      `MUX4_W${width}`,
      { in: { A: width, B: width, C: width, D: width, S: 2 }, out: { Y: width } },
      (b) => {
        const ins = [b.in("A"), b.in("B"), b.in("C"), b.in("D")];
        const [s0, s1] = b.in("S");
        const Y = b.out("Y");
        const ns0 = place2(b, "NOT", "ns0", [s0]);
        const ns1 = place2(b, "NOT", "ns1", [s1]);
        const sel = [
          place2(b, "AND", "sel_a", [ns1, ns0]),
          place2(b, "AND", "sel_b", [ns1, s0]),
          place2(b, "AND", "sel_c", [s1, ns0]),
          place2(b, "AND", "sel_d", [s1, s0])
        ];
        const pass = ["a", "b", "c", "d"].map((x) => b.wire(`pass_${x}`, width));
        const ab = b.wire("ab", width);
        const cd = b.wire("cd", width);
        for (let i = 0; i < width; i++) {
          ["a", "b", "c", "d"].forEach((x, k) => place2(b, "AND", `pass_${x}${i}`, [ins[k][i], sel[k]], pass[k][i]));
          place2(b, "OR", `ab${i}`, [pass[0][i], pass[1][i]], ab[i]);
          place2(b, "OR", `cd${i}`, [pass[2][i], pass[3][i]], cd[i]);
          place2(b, "OR", `join${i}`, [ab[i], cd[i]], Y[i]);
        }
      },
      `${width}-bit 4:1 multiplexer: Y = [A, B, C, D][S]`
    );
  }

  // src/cells/index.ts
  function buildCells(lib) {
    defineDLatch(lib);
    defineDff(lib);
    defineDffe(lib);
    for (const w of [3, 4, 8]) defineReg(lib, w);
    defineMux2(lib);
    defineMux2W(lib, 4);
    defineMux2W(lib, 8);
    defineMux4W(lib, 8);
    defineHalfAdder(lib);
    defineFullAdder(lib);
    defineAdder(lib, 8);
    defineInc(lib, 3);
    defineInc(lib, 4);
    defineDec2(lib);
    defineDec3(lib);
    defineDec4(lib);
    defineZero(lib, 8);
    defineHex7Seg(lib);
  }

  // src/compile/fastsim.ts
  function pokeIds(net, name) {
    const id2 = net.aliases.get(name);
    if (id2 !== void 0) return [id2];
    const ids = [];
    for (let i = 0; net.aliases.has(`${name}[${i}]`); i++) ids.push(net.aliases.get(`${name}[${i}]`));
    if (!ids.length) throw new NetlistError(`no net named ${name}`);
    return ids;
  }
  function powerOn(net, pokes = {}) {
    const sim = new RefSim(net);
    for (const [name, value] of Object.entries(pokes)) pokeIds(net, name).forEach((id2, i) => sim.v[id2] = value >> i & 1);
    const clk = net.aliases.get("CLK");
    if (clk !== void 0) sim.v[clk] = 1;
    sim.settle();
    return sim.v.slice();
  }

  // nathan/src/model/reference.ts
  var GRID_W = 14;
  var GRID_H = 10;
  var MAX_LAYERS = 8;
  var PALETTE_SIZE = 16;
  var INITIAL_FILL = 12;
  var FRAME_FILL = 7;
  var TOOLS = ["move", "frame", "rect", "ellipse", "pen"];
  var KINDS = ["frame", "rect", "ellipse"];
  function initialState2() {
    return {
      layers: [],
      selected: null,
      tool: "move",
      fill: INITIAL_FILL,
      nextId: 1,
      drag: null,
      penDown: false,
      erase: false,
      ink: blank()
    };
  }
  var blank = () => new Array(GRID_W * GRID_H).fill(0);
  var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  var getSelected = (s) => s.layers.find((l) => l.id === s.selected);
  function hitTest(s, x, y) {
    for (let i = s.layers.length - 1; i >= 0; i--) {
      const l = s.layers[i];
      if (l.visible && x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h)
        return l;
    }
    return void 0;
  }
  var patch = (s, id2, p) => __spreadProps(__spreadValues({}, s), {
    layers: s.layers.map((l) => l.id === id2 ? __spreadValues(__spreadValues({}, l), p) : l)
  });
  function span(ax, ay, bx, by) {
    const x0 = clamp(Math.min(ax, bx), 0, GRID_W - 1);
    const y0 = clamp(Math.min(ay, by), 0, GRID_H - 1);
    const x1 = clamp(Math.max(ax, bx), x0, GRID_W - 1);
    const y1 = clamp(Math.max(ay, by), y0, GRID_H - 1);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function addLayer(s, kind, x, y) {
    const layer = {
      id: s.nextId,
      kind,
      x: clamp(x, 0, GRID_W - 1),
      y: clamp(y, 0, GRID_H - 1),
      w: 1,
      h: 1,
      fill: kind === "frame" ? FRAME_FILL : s.fill,
      visible: true
    };
    return __spreadProps(__spreadValues({}, s), {
      layers: [...s.layers, layer],
      selected: layer.id,
      nextId: s.nextId + 1
    });
  }
  function reorder(s, dir) {
    const i = s.layers.findIndex((l) => l.id === s.selected);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.layers.length) return s;
    const layers = [...s.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    return __spreadProps(__spreadValues({}, s), { layers });
  }
  function remove(s) {
    if (s.selected === null) return s;
    return __spreadProps(__spreadValues({}, s), {
      layers: s.layers.filter((l) => l.id !== s.selected),
      selected: null
    });
  }
  function duplicate(s) {
    const src = getSelected(s);
    if (!src || s.layers.length >= MAX_LAYERS) return s;
    const copy = __spreadProps(__spreadValues({}, src), {
      id: s.nextId,
      x: clamp(src.x + 1, 0, GRID_W - src.w),
      y: clamp(src.y + 1, 0, GRID_H - src.h)
    });
    return __spreadProps(__spreadValues({}, s), {
      layers: [...s.layers, copy],
      selected: copy.id,
      nextId: s.nextId + 1
    });
  }
  function nudge(s, dx, dy) {
    const l = getSelected(s);
    if (!l) return s;
    return patch(s, l.id, {
      x: clamp(l.x + dx, 0, GRID_W - l.w),
      y: clamp(l.y + dy, 0, GRID_H - l.h)
    });
  }
  var setTool = (s, tool) => __spreadProps(__spreadValues({}, s), { tool, penDown: false });
  function plot(s, x, y) {
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return s;
    const i = y * GRID_W + x;
    const v = s.erase ? 0 : 1;
    if (s.ink[i] === v) return s;
    const ink = s.ink.slice();
    ink[i] = v;
    return __spreadProps(__spreadValues({}, s), { ink });
  }
  function onDown(s, a) {
    const { x, y } = a;
    const sel = getSelected(s);
    if (a.handle && sel) {
      const ax = a.handle.includes("w") ? sel.x + sel.w - 1 : sel.x;
      const ay = a.handle.includes("n") ? sel.y + sel.h - 1 : sel.y;
      return __spreadProps(__spreadValues({}, s), { drag: { mode: "resize", ax, ay } });
    }
    if (s.tool === "pen") return s;
    if (s.tool !== "move") {
      if (s.layers.length >= MAX_LAYERS) return __spreadProps(__spreadValues({}, s), { tool: "move" });
      return __spreadProps(__spreadValues({}, addLayer(
        s,
        s.tool === "frame" ? "frame" : s.tool === "rect" ? "rect" : "ellipse",
        x,
        y
      )), {
        drag: { mode: "create", sx: x, sy: y }
      });
    }
    const hit = hitTest(s, x, y);
    if (!hit) return __spreadProps(__spreadValues({}, s), { selected: null });
    return __spreadProps(__spreadValues({}, s), {
      selected: hit.id,
      drag: { mode: "move", ox: x - hit.x, oy: y - hit.y }
    });
  }
  function onMove(s, x, y) {
    const d = s.drag;
    const l = getSelected(s);
    if (!d || !l) return s;
    if (d.mode === "create") return patch(s, l.id, span(d.sx, d.sy, x, y));
    if (d.mode === "resize") return patch(s, l.id, span(d.ax, d.ay, x, y));
    return patch(s, l.id, {
      x: clamp(x - d.ox, 0, GRID_W - l.w),
      y: clamp(y - d.oy, 0, GRID_H - l.h)
    });
  }
  var TOOL_KEYS = {
    v: "move",
    f: "frame",
    r: "rect",
    o: "ellipse",
    p: "pen"
  };
  function onKey(s, key, meta) {
    if (meta) return key === "d" ? duplicate(s) : s;
    if (key in TOOL_KEYS) return setTool(s, TOOL_KEYS[key]);
    switch (key) {
      case "e":
        return reduce(s, { t: "erase" });
      case "c":
        return reduce(s, { t: "clear" });
      case "Delete":
      case "Backspace":
        return remove(s);
      case "]":
        return reorder(s, 1);
      case "[":
        return reorder(s, -1);
      case "ArrowLeft":
        return nudge(s, -1, 0);
      case "ArrowRight":
        return nudge(s, 1, 0);
      case "ArrowUp":
        return nudge(s, 0, -1);
      case "ArrowDown":
        return nudge(s, 0, 1);
      case "Escape":
        return __spreadProps(__spreadValues({}, s), { selected: null, tool: "move", drag: null, penDown: false });
      default:
        return s;
    }
  }
  function reduce(s, a) {
    var _a, _b;
    switch (a.t) {
      case "down":
        return onDown(s, a);
      case "move":
        return onMove(s, a.x, a.y);
      case "up":
        return ((_a = s.drag) == null ? void 0 : _a.mode) === "create" ? __spreadProps(__spreadValues({}, s), { drag: null, tool: "move" }) : __spreadProps(__spreadValues({}, s), { drag: null });
      case "tool":
        return setTool(s, a.tool);
      case "fill": {
        const l = getSelected(s);
        const next = __spreadProps(__spreadValues({}, s), { fill: a.color });
        return l ? patch(next, l.id, { fill: a.color }) : next;
      }
      case "select":
        return __spreadProps(__spreadValues({}, s), { selected: a.id });
      case "visible":
        return patch(s, a.id, {
          visible: !((_b = s.layers.find((l) => l.id === a.id)) == null ? void 0 : _b.visible)
        });
      case "paint":
        return s.tool === "pen" && s.penDown && !s.drag ? plot(s, a.x, a.y) : s;
      case "erase":
        return __spreadProps(__spreadValues({}, s), { erase: !s.erase });
      case "clear":
        return __spreadProps(__spreadValues({}, s), { ink: blank() });
      case "key":
        return onKey(s, a.key, !!a.meta);
    }
  }
  function click(s, x, y) {
    if (s.drag) return reduce(reduce(s, { t: "move", x, y }), { t: "up" });
    if (s.tool === "pen") return __spreadProps(__spreadValues({}, plot(s, x, y)), { penDown: !s.penDown });
    return reduce(s, { t: "down", x, y });
  }

  // nathan/src/hw/cells.ts
  function defineRegS(lib, n) {
    if (lib.has(`REGS${n}`)) return;
    define(
      lib,
      `REGS${n}`,
      { in: { D: n, LOAD: 1, CLK: 1, NCLK: 1 }, out: { Q: n } },
      (b) => {
        const [D, Q, LOAD, CLK, NCLK] = [
          b.in("D"),
          b.out("Q"),
          b.in1("LOAD"),
          b.in1("CLK"),
          b.in1("NCLK")
        ];
        const men = place2(b, "AND", "men", [NCLK, LOAD]);
        const nmen = place2(b, "NOT", "nmen", [men]);
        for (let i = 0; i < n; i++) {
          const m = b.wire1(`m${i}`);
          const take = place2(b, "AND", `m${i}_take`, [D[i], men]);
          const hold = place2(b, "AND", `m${i}_hold`, [m, nmen]);
          place2(b, "OR", `m${i}_merge`, [take, hold], m);
          const st = place2(b, "AND", `s${i}_take`, [m, CLK]);
          const sh = place2(b, "AND", `s${i}_hold`, [Q[i], NCLK]);
          place2(b, "OR", `s${i}_merge`, [st, sh], Q[i]);
        }
      },
      `${n}-bit register, shared enable: master open while \xACCLK\xB7LOAD, slave open while CLK`
    );
  }
  function defineRamWord(lib, n) {
    if (lib.has(`RAMW${n}`)) return;
    define(
      lib,
      `RAMW${n}`,
      { in: { D: n, ROW: 1, COL: 1 }, out: { Q: n } },
      (b) => {
        const [D, Q] = [b.in("D"), b.out("Q")];
        const men = place2(b, "AND", "men", [b.in1("ROW"), b.in1("COL")]);
        const nmen = place2(b, "NOT", "nmen", [men]);
        for (let i = 0; i < n; i++) {
          const take = place2(b, "AND", `m${i}_take`, [D[i], men]);
          const hold = place2(b, "AND", `m${i}_hold`, [Q[i], nmen]);
          place2(b, "OR", `m${i}_merge`, [take, hold], Q[i]);
        }
      },
      `${n}-bit RAM word: one latch per bit, open while ROW\xB7COL (ROW = \xACCLK \xB7 word line)`
    );
  }
  function defineGe4(lib) {
    if (lib.has("GE4")) return;
    define(
      lib,
      "GE4",
      { in: { A: 4, B: 4 }, out: { GE: 1 } },
      (b) => {
        const [A, B] = [b.in("A"), b.in("B")];
        const nb = B.map((x, i) => place2(b, "NOT", `nb${i}`, [x]));
        let c = place2(b, "OR", "c1", [A[0], nb[0]]);
        for (let i = 1; i < 4; i++) {
          const gen = place2(b, "AND", `g${i}`, [A[i], nb[i]]);
          const prop = place2(b, "OR", `p${i}`, [A[i], nb[i]]);
          const carry = place2(b, "AND", `t${i}`, [c, prop]);
          c = place2(
            b,
            "OR",
            `c${i + 1}`,
            [gen, carry],
            i === 3 ? b.out1("GE") : void 0
          );
        }
      },
      "4-bit unsigned A >= B (carry out of A + \xACB + 1)"
    );
  }

  // nathan/src/hw/dsl.ts
  function logic(b) {
    let n = 0;
    const g = (t, ins, out) => place2(b, t, `g${n++}`, ins, out);
    const AND = (x, y, out) => g("AND", [x, y], out);
    const OR = (x, y, out) => g("OR", [x, y], out);
    const NOT = (x) => g("NOT", [x]);
    const buf = (x, out) => g("BUF", [x], out);
    const tree = (op, xs, empty, out) => {
      if (!xs.length) return out ? buf(empty, out) : empty;
      if (xs.length === 1) return out ? buf(xs[0], out) : xs[0];
      let level = xs;
      while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2)
          next.push(
            i + 1 < level.length ? op(level[i], level[i + 1], level.length === 2 ? out : void 0) : level[i]
          );
        level = next;
      }
      return level[0];
    };
    const orAll = (xs, out) => tree(OR, xs, CONST0, out);
    const andAll = (xs, out) => tree(AND, xs, CONST1, out);
    return {
      g,
      AND: (x, y) => AND(x, y),
      OR: (x, y) => OR(x, y),
      NOT,
      and3: (x, y, z) => AND(AND(x, y), z),
      orAll,
      andAll,
      mux2(A, B, S, outs) {
        const ns = NOT(S);
        return A.map((a, i) => OR(AND(a, ns), AND(B[i], S), outs == null ? void 0 : outs[i]));
      },
      andOr(terms, width, outs) {
        return Array.from(
          { length: width },
          (_, i) => orAll(
            terms.map(([s, bus]) => AND(s, bus[i])),
            outs == null ? void 0 : outs[i]
          )
        );
      },
      dec(A, name, outs) {
        return b.use(
          `DEC${A.length}`,
          outs ? { A, EN: CONST1, Y: outs } : { A, EN: CONST1 },
          name
        ).Y;
      },
      buf
    };
  }
  var slice = (bus, k, width) => bus.slice(k * width, (k + 1) * width);
  var zeros = (n) => Array(n).fill(CONST0);

  // nathan/src/hw/layout.ts
  var EV = {
    NOP: 0,
    TOOL: 1,
    // ARG = tool (0 move, 1 frame, 2 rectangle, 3 ellipse, 4 pen)
    FILL: 2,
    // ARG = palette index
    DOWN: 3,
    MOVE: 4,
    UP: 5,
    SELECT: 6,
    // ARG = layer slot
    HANDLE: 7,
    // ARG bit0 = west handle, bit1 = north handle
    VIS: 8,
    // ARG = layer slot (eye icon)
    DELETE: 9,
    DUP: 10,
    FWD: 11,
    // "]" bring forward
    BACK: 12,
    // "[" send backward
    NUDGE: 13,
    // ARG = 0 left, 1 right, 2 up, 3 down
    ESC: 14,
    CLICK: 15,
    // a canvas click: DOWN when nothing is pending, MOVE then UP while a drag is pending;
    //            with the pen and nothing pending: ink the cell and put the pen down / lift it
    PAINT: 16,
    // the pointer entered cell (PX, PY): inked while the pen is down
    ERASE: 17,
    // the Erase toggle: the pen inks 0 instead of 1
    CLEAR: 18
    // every pixel of the paint plane to 0, in one event
  };
  var EVT_BITS = 5;
  var LAYERS = 8;
  var PALETTE_SIZE2 = 16;
  var REC = {
    used: 0,
    vis: 1,
    kind: 2,
    x0: 4,
    x1: 8,
    y0: 12,
    y1: 16,
    fill: 20,
    bits: 24,
    geom: 4,
    geomBits: 16
  };
  var TOOL_BITS = 3;
  var STATE_NETS = {
    used: (k) => `used${k}`,
    vis: (k) => `vis${k}`,
    kind: (k) => `kind${k}`,
    x0: (k) => `x0_${k}`,
    x1: (k) => `x1_${k}`,
    y0: (k) => `y0_${k}`,
    y1: (k) => `y1_${k}`,
    fill: (k) => `fill${k}`,
    sel: "sel",
    hassel: "hassel",
    tool: "tool",
    cur: "cur",
    drag: "drag",
    r1: "r1",
    r2: "r2",
    pendown: "pendown",
    // the pen is down: hovering a cell inks it
    erase: "erase",
    // the pen inks 0
    pix: "pix"
    // [140] the paint plane, pixel (x, y) = bit y·14 + x
  };
  var SCREEN_NETS = {
    nsel: "nsel",
    // [3] ¬sel
    nkind: "nkind",
    // [16] ¬kind bits, layer-major
    nfill: "nfill",
    // [32] ¬fill bits, layer-major
    ncur: "ncur",
    // [4] ¬cur
    ell: "ell",
    // [8] kind = ellipse: the layer's body is round
    nell: "nell",
    // [8] ¬ell
    hot: "hot"
    // [6] hotspot sets: idle+move tool, idle+creation tool, drag=move, drag=create/resize, pen up, pen down
  };
  var HOT = [
    "idle-move",
    "idle-create",
    "drag-move",
    "drag-span",
    "pen-up",
    "pen-down"
  ];
  var INITIAL_FILL2 = 12;

  // nathan/src/hw/units.ts
  function defineUnits(lib) {
    if (!lib.has("ADDER_W4")) defineAdder(lib, 4);
    if (!lib.has("ADDER_W5")) defineAdder(lib, 5);
    defineGe4(lib);
    if (lib.has("HIT8")) return;
    define(
      lib,
      "COVERS",
      {
        in: { PX: 4, PY: 4, USED: 1, X0: 4, Y0: 4, X1: 4, Y1: 4 },
        out: { C: 1 }
      },
      (b) => {
        const ge = (a2, bb, n) => b.use("GE4", { A: a2, B: bb }, n).GE[0];
        const gx0 = ge(b.in("PX"), b.in("X0"), "gx0");
        const gx1 = ge(b.in("PX"), b.in("X1"), "gx1");
        const gy0 = ge(b.in("PY"), b.in("Y0"), "gy0");
        const gy1 = ge(b.in("PY"), b.in("Y1"), "gy1");
        const ltx = place2(b, "NOT", "ltx", [gx1]);
        const lty = place2(b, "NOT", "lty", [gy1]);
        const a = place2(b, "AND", "a", [b.in1("USED"), gx0]);
        const c = place2(b, "AND", "b", [a, ltx]);
        const d = place2(b, "AND", "c", [c, gy0]);
        place2(b, "AND", "d", [d, lty], b.out1("C"));
      },
      "does this layer cover the pointer cell?"
    );
    define(
      lib,
      "HIT8",
      {
        in: { PX: 4, PY: 4, USED: 8, X0: 32, Y0: 32, X1: 32, Y1: 32 },
        out: { IDX: 3, ANY: 1 }
      },
      (b) => {
        const c = [];
        for (let k = 0; k < 8; k++) {
          const s = (bus) => bus.slice(4 * k, 4 * k + 4);
          c.push(
            b.use(
              "COVERS",
              {
                PX: b.in("PX"),
                PY: b.in("PY"),
                USED: b.in("USED")[k],
                X0: s(b.in("X0")),
                Y0: s(b.in("Y0")),
                X1: s(b.in("X1")),
                Y1: s(b.in("Y1"))
              },
              `l${k}`
            ).C[0]
          );
        }
        const pre = new Array(8);
        pre[7] = c[7];
        for (let k = 6; k >= 0; k--)
          pre[k] = place2(b, "OR", `pre${k}`, [pre[k + 1], c[k]]);
        const h = new Array(8);
        h[7] = c[7];
        for (let k = 0; k < 7; k++)
          h[k] = place2(b, "AND", `h${k}`, [
            c[k],
            place2(b, "NOT", `npre${k}`, [pre[k + 1]])
          ]);
        const idx = b.out("IDX");
        b.reduce("OR", [h[1], h[3], h[5], h[7]], idx[0]);
        b.reduce("OR", [h[2], h[3], h[6], h[7]], idx[1]);
        b.reduce("OR", [h[4], h[5], h[6], h[7]], idx[2]);
        place2(b, "BUF", "any", [pre[0]], b.out1("ANY"));
      },
      "topmost layer under the pointer, all 8 layers compared in parallel"
    );
    const moveAxis = (name, limit) => define(
      lib,
      name,
      { in: { P: 4, O: 4, LO: 4, HI: 4 }, out: { NLO: 4, NHI: 4 } },
      (b) => {
        const [P, O, LO, HI] = [b.in("P"), b.in("O"), b.in("LO"), b.in("HI")];
        const nLO = LO.map((x, i) => place2(b, "NOT", `nlo${i}`, [x]));
        const w = b.use("ADDER_W4", { A: HI, B: nLO, CI: CONST1 }, "w").S;
        const nO = O.map((x, i) => place2(b, "NOT", `no${i}`, [x]));
        const t = b.use(
          "ADDER_W5",
          { A: [...P, CONST0], B: [...nO, CONST1], CI: CONST1 },
          "t"
        ).S;
        const nW = w.map((x, i) => place2(b, "NOT", `nw${i}`, [x]));
        const lim = b.use(
          "ADDER_W4",
          { A: constBus(limit, 4), B: nW, CI: CONST1 },
          "lim"
        ).S;
        const ok = b.use("GE4", { A: lim, B: t.slice(0, 4) }, "cmp").GE[0];
        const pick2 = b.use(
          "MUX2_W4",
          { A: lim, B: t.slice(0, 4), S: ok },
          "pick"
        ).Y;
        const notNeg = place2(b, "NOT", "notneg", [t[4]]);
        const nlo = pick2.map(
          (x, i) => place2(b, "AND", `nlo_${i}`, [x, notNeg], b.out("NLO")[i])
        );
        b.use("ADDER_W4", { A: nlo, B: w, CI: CONST0, S: b.out("NHI") }, "hi");
      },
      `drag-move on one axis: LO' = clamp(P - O, 0, ${limit} - w), HI' = LO' + w`
    );
    moveAxis("MOVE_X", GRID_W);
    moveAxis("MOVE_Y", GRID_H);
    define(
      lib,
      "MOVE",
      {
        in: { PX: 4, PY: 4, OX: 4, OY: 4, X0: 4, X1: 4, Y0: 4, Y1: 4 },
        out: { NX0: 4, NX1: 4, NY0: 4, NY1: 4 }
      },
      (b) => {
        b.use(
          "MOVE_X",
          {
            P: b.in("PX"),
            O: b.in("OX"),
            LO: b.in("X0"),
            HI: b.in("X1"),
            NLO: b.out("NX0"),
            NHI: b.out("NX1")
          },
          "x"
        );
        b.use(
          "MOVE_Y",
          {
            P: b.in("PY"),
            O: b.in("OY"),
            LO: b.in("Y0"),
            HI: b.in("Y1"),
            NLO: b.out("NY0"),
            NHI: b.out("NY1")
          },
          "y"
        );
      },
      "drag-move a layer, clamped to the canvas"
    );
    define(
      lib,
      "SPAN_AXIS",
      { in: { A: 4, P: 4 }, out: { LO: 4, HI: 4 } },
      (b) => {
        const [A, P] = [b.in("A"), b.in("P")];
        const ge = b.use("GE4", { A, B: P }, "cmp").GE[0];
        b.use("MUX2_W4", { A, B: P, S: ge, Y: b.out("LO") }, "lo");
        const mx = b.use("MUX2_W4", { A: P, B: A, S: ge }, "hi").Y;
        b.use("INC_W4", { A: mx, Y: b.out("HI") }, "inc");
      },
      "two corner cells on one axis: LO = min, HI = max + 1"
    );
    define(
      lib,
      "SPAN",
      { in: { AX: 4, AY: 4, PX: 4, PY: 4 }, out: { X0: 4, X1: 4, Y0: 4, Y1: 4 } },
      (b) => {
        b.use(
          "SPAN_AXIS",
          { A: b.in("AX"), P: b.in("PX"), LO: b.out("X0"), HI: b.out("X1") },
          "x"
        );
        b.use(
          "SPAN_AXIS",
          { A: b.in("AY"), P: b.in("PY"), LO: b.out("Y0"), HI: b.out("Y1") },
          "y"
        );
      },
      "rectangle from two corner cells (create-drag, resize)"
    );
    define(
      lib,
      "NUDGE",
      {
        in: { X0: 4, X1: 4, Y0: 4, Y1: 4, R: 1, L: 1, D: 1, U: 1 },
        out: { NX0: 4, NX1: 4, NY0: 4, NY1: 4 }
      },
      (b) => {
        const L = logic(b);
        const ones = [CONST1, CONST1, CONST1, CONST1];
        const axis = (lo, hi, plus, minus, limit, tag, outLo, outHi) => {
          const edge = L.andAll(
            hi.map((x, i) => limit >> i & 1 ? x : L.NOT(x))
          );
          const goP = L.AND(plus, L.NOT(edge));
          const goM = L.AND(minus, L.orAll(lo));
          const stay = L.NOT(L.OR(goP, goM));
          const incLo = b.use("INC_W4", { A: lo }, `${tag}il`).Y;
          const incHi = b.use("INC_W4", { A: hi }, `${tag}ih`).Y;
          const decLo = b.use(
            "ADDER_W4",
            { A: lo, B: ones, CI: CONST0 },
            `${tag}dl`
          ).S;
          const decHi = b.use(
            "ADDER_W4",
            { A: hi, B: ones, CI: CONST0 },
            `${tag}dh`
          ).S;
          L.andOr(
            [
              [goP, incLo],
              [goM, decLo],
              [stay, lo]
            ],
            4
          ).forEach((x, i) => place2(b, "BUF", `${tag}ol${i}`, [x], outLo[i]));
          L.andOr(
            [
              [goP, incHi],
              [goM, decHi],
              [stay, hi]
            ],
            4
          ).forEach((x, i) => place2(b, "BUF", `${tag}oh${i}`, [x], outHi[i]));
        };
        axis(
          b.in("X0"),
          b.in("X1"),
          b.in1("R"),
          b.in1("L"),
          GRID_W,
          "x",
          b.out("NX0"),
          b.out("NX1")
        );
        axis(
          b.in("Y0"),
          b.in("Y1"),
          b.in1("D"),
          b.in1("U"),
          GRID_H,
          "y",
          b.out("NY0"),
          b.out("NY1")
        );
      },
      "step a rectangle one cell (R/L/D/U), stopping at the canvas edge"
    );
  }

  // nathan/src/hw/engine.ts
  function defineEvdec(lib) {
    define(
      lib,
      "EVDEC",
      {
        in: { EVT: EVT_BITS, TOOL: TOOL_BITS, DRAG: 2 },
        out: {
          EV_TOOL: 1,
          EV_FILL: 1,
          EV_DOWN: 1,
          EV_MOVE: 1,
          EV_UP: 1,
          EV_SELECT: 1,
          EV_HANDLE: 1,
          EV_VIS: 1,
          EV_DEL: 1,
          EV_DUP: 1,
          EV_FWD: 1,
          EV_BACK: 1,
          EV_NUDGE: 1,
          EV_ESC: 1,
          EV_PAINT: 1,
          EV_ERASE: 1,
          EV_CLEAR: 1,
          IS_MOVE_TOOL: 1,
          CREATING: 1,
          IS_PEN: 1,
          PEN_CLICK: 1,
          DG: 4,
          DRAGGING: 1
        }
      },
      (b) => {
        const L = logic(b);
        const [EVT, TOOL2, DRAG] = [b.in("EVT"), b.in("TOOL"), b.in("DRAG")];
        const pick2 = (name) => b.out1(name);
        const evNets = Array.from({ length: 20 }, (_, i) => b.wire1(`ev${i}`));
        const named = {
          1: "EV_TOOL",
          2: "EV_FILL",
          6: "EV_SELECT",
          7: "EV_HANDLE",
          8: "EV_VIS",
          9: "EV_DEL",
          10: "EV_DUP",
          11: "EV_FWD",
          12: "EV_BACK",
          13: "EV_NUDGE",
          14: "EV_ESC",
          16: "EV_PAINT",
          17: "EV_ERASE",
          18: "EV_CLEAR"
        };
        for (const [i, n] of Object.entries(named)) evNets[Number(i)] = pick2(n);
        b.use(
          "DEC4",
          { A: EVT.slice(0, 4), EN: L.NOT(EVT[4]), Y: evNets.slice(0, 16) },
          "evdec"
        );
        b.use(
          "DEC2",
          {
            A: EVT.slice(0, 2),
            EN: L.AND(EVT[4], L.g("NOR", [EVT[2], EVT[3]])),
            Y: evNets.slice(16, 20)
          },
          "pendec"
        );
        b.use("DEC2", { A: DRAG, EN: CONST1, Y: b.out("DG") }, "dragdec");
        const dg2 = b.out("DG");
        place2(b, "OR", "creating", [TOOL2[0], TOOL2[1]], b.out1("CREATING"));
        place2(
          b,
          "NOR",
          "is_move_tool",
          [b.out1("CREATING"), TOOL2[2]],
          b.out1("IS_MOVE_TOOL")
        );
        place2(b, "BUF", "is_pen", [TOOL2[2]], b.out1("IS_PEN"));
        L.orAll([dg2[1], dg2[2], dg2[3]], b.out1("DRAGGING"));
        const click2 = evNets[15];
        const dragging = b.out1("DRAGGING");
        const idleClick = L.AND(click2, dg2[0]);
        L.g("OR", [evNets[3], idleClick], b.out1("EV_DOWN"));
        L.g("OR", [evNets[4], L.AND(click2, dragging)], b.out1("EV_MOVE"));
        L.g("OR", [evNets[5], L.AND(click2, dragging)], b.out1("EV_UP"));
        L.g("AND", [idleClick, b.out1("IS_PEN")], b.out1("PEN_CLICK"));
      },
      "event and mode decode: one line per event, tool and drag mode; CLICK = DOWN, or MOVE + UP while a drag is pending, or the pen's"
    );
  }
  function defineFreeslot(lib) {
    define(
      lib,
      "FREESLOT",
      { in: { USED: 8 }, out: { FF: 8, IDX: 3, ANY: 1 } },
      (b) => {
        const L = logic(b);
        const used = b.in("USED");
        const free = used.map((u) => L.NOT(u));
        const pfx = [];
        free.forEach((f, k) => pfx.push(k === 0 ? f : L.OR(pfx[k - 1], f)));
        const ff = b.out("FF");
        free.forEach(
          (f, k) => k === 0 ? L.buf(f, ff[0]) : L.g("AND", [f, L.NOT(pfx[k - 1])], ff[k])
        );
        const idx = b.out("IDX");
        L.orAll([ff[1], ff[3], ff[5], ff[7]], idx[0]);
        L.orAll([ff[2], ff[3], ff[6], ff[7]], idx[1]);
        L.orAll([ff[4], ff[5], ff[6], ff[7]], idx[2]);
        L.buf(pfx[7], b.out1("ANY"));
      },
      "lowest unused layer slot: one-hot FF, its index, and whether any slot is free"
    );
  }
  function defineReadplane(lib) {
    define(
      lib,
      "READPLANE",
      {
        in: { SEL: 3, HIT_IDX: 3, USE_HIT: 1, REC: LAYERS * REC.bits },
        out: { OUT: REC.bits }
      },
      (b) => {
        const L = logic(b);
        const idx = L.mux2(b.in("SEL"), b.in("HIT_IDX"), b.in1("USE_HIT"));
        const pl = L.dec(idx, "pldec");
        const rec = b.in("REC");
        const out = b.out("OUT");
        for (let bit3 = 0; bit3 < REC.bits; bit3++)
          L.orAll(
            pl.map((p, k) => L.AND(p, rec[k * REC.bits + bit3])),
            out[bit3]
          );
      },
      "reads one layer record: the layer under the pointer on DOWN, the selected layer otherwise"
    );
  }
  function defineGeom(lib) {
    define(
      lib,
      "GEOM",
      {
        in: {
          PX: 4,
          PY: 4,
          R1: 4,
          R2: 4,
          SELG: 16,
          EV_DOWN: 1,
          USE_MOVE: 1,
          USE_SPAN: 1,
          USE_NUDGE: 1,
          NR: 1,
          NL: 1,
          ND: 1,
          NU: 1,
          ARG: 2
        },
        out: { G: 16, OFFS: 8, ANCH: 8 }
      },
      (b) => {
        const L = logic(b);
        const [PX, PY, R1, R2, SELG] = [
          b.in("PX"),
          b.in("PY"),
          b.in("R1"),
          b.in("R2"),
          b.in("SELG")
        ];
        const [x0, x1, y0, y1] = [
          slice(SELG, 0, 4),
          slice(SELG, 1, 4),
          slice(SELG, 2, 4),
          slice(SELG, 3, 4)
        ];
        const mv = b.use(
          "MOVE",
          { PX, PY, OX: R1, OY: R2, X0: x0, X1: x1, Y0: y0, Y1: y1 },
          "move"
        );
        const sp = b.use(
          "SPAN",
          {
            AX: L.mux2(R1, PX, b.in1("EV_DOWN")),
            AY: L.mux2(R2, PY, b.in1("EV_DOWN")),
            PX,
            PY
          },
          "span"
        );
        const nd = b.use(
          "NUDGE",
          {
            X0: x0,
            X1: x1,
            Y0: y0,
            Y1: y1,
            R: b.in1("NR"),
            L: b.in1("NL"),
            D: b.in1("ND"),
            U: b.in1("NU")
          },
          "nudge"
        );
        const cat = (u, k) => [...u[k[0]], ...u[k[1]], ...u[k[2]], ...u[k[3]]];
        L.andOr(
          [
            [b.in1("USE_MOVE"), cat(mv, ["NX0", "NX1", "NY0", "NY1"])],
            [b.in1("USE_SPAN"), cat(sp, ["X0", "X1", "Y0", "Y1"])],
            [b.in1("USE_NUDGE"), cat(nd, ["NX0", "NX1", "NY0", "NY1"])]
          ],
          16,
          b.out("G")
        );
        const sub4 = (A, B, name) => b.use("ADDER_W4", { A, B: B.map((n) => L.NOT(n)), CI: CONST1 }, name).S;
        const dec1 = (A, name) => b.use(
          "ADDER_W4",
          { A, B: [CONST1, CONST1, CONST1, CONST1], CI: CONST0 },
          name
        ).S;
        const offs = b.out("OFFS");
        sub4(PX, x0, "oxn").forEach((n, i) => L.buf(n, offs[i]));
        sub4(PY, y0, "oyn").forEach((n, i) => L.buf(n, offs[4 + i]));
        const anch = b.out("ANCH");
        const arg = b.in("ARG");
        L.mux2(x0, dec1(x1, "x1m1"), arg[0], anch.slice(0, 4));
        L.mux2(y0, dec1(y1, "y1m1"), arg[1], anch.slice(4, 8));
      },
      "rectangle units (MOVE, SPAN, NUDGE) and their bus; also the grab offsets and the resize anchors"
    );
  }
  function defineConds(lib) {
    define(
      lib,
      "CONDS",
      {
        in: {
          EV_DOWN: 1,
          EV_MOVE: 1,
          EV_DEL: 1,
          EV_DUP: 1,
          EV_FWD: 1,
          EV_BACK: 1,
          EV_NUDGE: 1,
          EV_HANDLE: 1,
          IS_MOVE_TOOL: 1,
          CREATING: 1,
          DG: 4,
          HASSEL: 1,
          SEL: 3,
          USED: 8,
          HIT_ANY: 1,
          ANY_FREE: 1,
          ARG: 3
        },
        out: {
          HIT_MOVE: 1,
          GRAB: 1,
          CREATE_OK: 1,
          DUP_OK: 1,
          HANDLE_OK: 1,
          DEL_OK: 1,
          FWD_OK: 1,
          BACK_OK: 1,
          NUDGE_OK: 1,
          MOVE_OK: 1,
          USE_MOVE: 1,
          USE_SPAN: 1,
          USE_NUDGE: 1,
          NR: 1,
          NL: 1,
          ND: 1,
          NU: 1,
          S1H: 8,
          ARGDEC: 8,
          USED_ARG: 1
        }
      },
      (b) => {
        const L = logic(b);
        const dg2 = b.in("DG");
        const hassel = b.in1("HASSEL");
        const used = b.in("USED");
        const s1h = L.dec(b.in("SEL"), "seldec", b.out("S1H"));
        const argDec = L.dec(b.in("ARG"), "argdec", b.out("ARGDEC"));
        const usedNext = L.orAll(
          s1h.slice(0, 7).map((s, k) => L.AND(s, used[k + 1]))
        );
        L.g("AND", [b.in1("EV_DOWN"), b.in1("IS_MOVE_TOOL")], b.out1("HIT_MOVE"));
        L.g("AND", [b.out1("HIT_MOVE"), b.in1("HIT_ANY")], b.out1("GRAB"));
        L.g(
          "AND",
          [L.AND(b.in1("EV_DOWN"), b.in1("CREATING")), b.in1("ANY_FREE")],
          b.out1("CREATE_OK")
        );
        L.g(
          "AND",
          [L.AND(b.in1("EV_DUP"), hassel), b.in1("ANY_FREE")],
          b.out1("DUP_OK")
        );
        L.g("AND", [b.in1("EV_HANDLE"), hassel], b.out1("HANDLE_OK"));
        L.g("AND", [b.in1("EV_DEL"), hassel], b.out1("DEL_OK"));
        L.g("AND", [L.AND(b.in1("EV_FWD"), hassel), usedNext], b.out1("FWD_OK"));
        L.g(
          "AND",
          [L.AND(b.in1("EV_BACK"), hassel), L.NOT(s1h[0])],
          b.out1("BACK_OK")
        );
        L.g("AND", [b.in1("EV_NUDGE"), hassel], b.out1("NUDGE_OK"));
        L.g(
          "AND",
          [L.AND(b.in1("EV_MOVE"), L.orAll([dg2[1], dg2[2], dg2[3]])), hassel],
          b.out1("MOVE_OK")
        );
        L.g("AND", [b.in1("EV_MOVE"), dg2[1]], b.out1("USE_MOVE"));
        L.g(
          "OR",
          [L.AND(b.in1("EV_MOVE"), L.OR(dg2[2], dg2[3])), b.out1("CREATE_OK")],
          b.out1("USE_SPAN")
        );
        L.g("OR", [b.in1("EV_NUDGE"), b.out1("DUP_OK")], b.out1("USE_NUDGE"));
        const arg = b.in("ARG");
        const argIs = (v) => L.andAll([
          b.in1("EV_NUDGE"),
          ...[0, 1, 2].map((k) => v >> k & 1 ? arg[k] : L.NOT(arg[k]))
        ]);
        L.g("OR", [argIs(1), b.out1("DUP_OK")], b.out1("NR"));
        L.buf(argIs(0), b.out1("NL"));
        L.g("OR", [argIs(3), b.out1("DUP_OK")], b.out1("ND"));
        L.buf(argIs(2), b.out1("NU"));
        L.orAll(
          used.map((u, k) => L.AND(u, argDec[k])),
          b.out1("USED_ARG")
        );
      },
      "what this event does to the layer stack: create / duplicate / delete / reorder / move are allowed?"
    );
  }
  function defineLayerctl(lib) {
    define(
      lib,
      "LAYERCTL",
      {
        in: {
          CREATE_OK: 1,
          DUP_OK: 1,
          DEL_OK: 1,
          FWD_OK: 1,
          BACK_OK: 1,
          MOVE_OK: 1,
          NUDGE_OK: 1,
          EV_FILL: 1,
          EV_VIS: 1,
          HASSEL: 1,
          S1H: 8,
          ARGDEC: 8,
          USED: 8,
          FF: 8
        },
        out: { SBUS: 8, SNEXT: 8, SPREV: 8, WSEL: 8, WFILL: 8, WVIS: 8 }
      },
      (b) => {
        const L = logic(b);
        const [s1h, used, ff, argDec] = [
          b.in("S1H"),
          b.in("USED"),
          b.in("FF"),
          b.in("ARGDEC")
        ];
        const [del, fwd, back] = [
          b.in1("DEL_OK"),
          b.in1("FWD_OK"),
          b.in1("BACK_OK")
        ];
        const create = L.OR(b.in1("CREATE_OK"), b.in1("DUP_OK"));
        const writeSel = L.OR(b.in1("MOVE_OK"), b.in1("NUDGE_OK"));
        const prefix = [];
        s1h.forEach((s, k) => prefix.push(k === 0 ? s : L.OR(prefix[k - 1], s)));
        const [sbus, snext, sprev, wsel, wfill, wvis] = [
          "SBUS",
          "SNEXT",
          "SPREV",
          "WSEL",
          "WFILL",
          "WVIS"
        ].map((n) => b.out(n));
        for (let k = 0; k < LAYERS; k++) {
          L.g("AND", [create, ff[k]], sbus[k]);
          const shiftDown = L.AND(L.AND(del, prefix[k]), used[k]);
          if (k === 7) L.buf(shiftDown, snext[k]);
          else
            L.orAll(
              [shiftDown, L.AND(fwd, s1h[k]), L.AND(back, s1h[k + 1])],
              snext[k]
            );
          if (k === 0) L.buf(CONST0, sprev[k]);
          else L.g("OR", [L.AND(fwd, s1h[k - 1]), L.AND(back, s1h[k])], sprev[k]);
          L.g("AND", [s1h[k], writeSel], wsel[k]);
          L.g(
            "AND",
            [L.AND(b.in1("EV_FILL"), b.in1("HASSEL")), s1h[k]],
            wfill[k]
          );
          L.g("AND", [L.AND(b.in1("EV_VIS"), argDec[k]), used[k]], wvis[k]);
        }
      },
      "one write enable per layer: new record, take the upper / lower neighbour (delete, reorder), rectangle, fill, eye"
    );
  }
  function defineNewrec(lib) {
    define(
      lib,
      "NEWREC",
      {
        in: { TOOL: 2, CUR: 4, EV_DUP: 1, EV_FILL: 1, ARG: 4, PREC: REC.bits },
        out: { FILLD: 4, KINDD: 2, VISD: 1 }
      },
      (b) => {
        const L = logic(b);
        const [tool, cur, arg, prec] = [
          b.in("TOOL"),
          b.in("CUR"),
          b.in("ARG"),
          b.in("PREC")
        ];
        const dup = b.in1("EV_DUP");
        const isFrame = L.AND(tool[0], L.NOT(tool[1]));
        const fresh = L.mux2(cur, [CONST1, CONST1, CONST1, CONST0], isFrame);
        const fromPlane = L.mux2(fresh, prec.slice(REC.fill, REC.fill + 4), dup);
        L.mux2(fromPlane, arg, b.in1("EV_FILL"), b.out("FILLD"));
        L.mux2(tool, prec.slice(REC.kind, REC.kind + 2), dup, b.out("KINDD"));
        L.g("OR", [L.NOT(dup), prec[REC.vis]], b.out1("VISD"));
      },
      "the data a new record starts with: colour (frame = white), kind = tool, visible; a duplicate copies the selected record"
    );
  }
  function defineState(lib) {
    define(
      lib,
      "STATE",
      {
        in: {
          CLK: 1,
          NCLK: 1,
          PX: 4,
          PY: 4,
          ARG: 4,
          EV_TOOL: 1,
          EV_FILL: 1,
          EV_SELECT: 1,
          EV_UP: 1,
          EV_ESC: 1,
          EV_DOWN: 1,
          CREATING: 1,
          DG2: 1,
          HIT_MOVE: 1,
          GRAB: 1,
          CREATE_OK: 1,
          DUP_OK: 1,
          HANDLE_OK: 1,
          DEL_OK: 1,
          FWD_OK: 1,
          BACK_OK: 1,
          ANY_FREE: 1,
          USED_ARG: 1,
          HIT_IDX: 3,
          FREE_IDX: 3,
          OFFS: 8,
          ANCH: 8
        },
        out: { SEL: 3, HASSEL: 1, TOOL: TOOL_BITS, CUR: 4, DRAG: 2, R1: 4, R2: 4 }
      },
      (b) => {
        const L = logic(b);
        const [CLK, NCLK, PX, PY, ARG] = [
          b.in1("CLK"),
          b.in1("NCLK"),
          b.in("PX"),
          b.in("PY"),
          b.in("ARG")
        ];
        const reg = (name, D, LOAD, Q) => b.use(`REGS${Q.length}`, { D, LOAD, CLK, NCLK, Q }, name);
        const i1 = (n) => b.in1(n);
        const sel = b.out("SEL");
        const create = L.OR(i1("CREATE_OK"), i1("DUP_OK"));
        const selLoad = L.orAll([
          i1("HIT_MOVE"),
          i1("CREATE_OK"),
          i1("DUP_OK"),
          i1("EV_SELECT"),
          i1("FWD_OK"),
          i1("BACK_OK")
        ]);
        const inc3 = b.use("INC_W3", { A: sel }, "selinc").Y;
        const dec3 = b.use(
          "ADDER_W4",
          {
            A: [...sel, CONST0],
            B: [CONST1, CONST1, CONST1, CONST1],
            CI: CONST0
          },
          "seldecr"
        ).S.slice(0, 3);
        reg(
          "sel",
          L.andOr(
            [
              [i1("HIT_MOVE"), b.in("HIT_IDX")],
              [create, b.in("FREE_IDX")],
              [i1("EV_SELECT"), ARG.slice(0, 3)],
              [i1("FWD_OK"), inc3],
              [i1("BACK_OK"), dec3]
            ],
            3
          ),
          selLoad,
          sel
        );
        reg(
          "hassel",
          [
            L.orAll([
              i1("GRAB"),
              i1("CREATE_OK"),
              i1("DUP_OK"),
              L.AND(i1("EV_SELECT"), i1("USED_ARG")),
              i1("FWD_OK"),
              i1("BACK_OK")
            ])
          ],
          L.orAll([selLoad, i1("DEL_OK"), i1("EV_ESC")]),
          [b.out1("HASSEL")]
        );
        reg(
          "drag",
          [
            L.OR(i1("GRAB"), i1("HANDLE_OK")),
            L.OR(i1("CREATE_OK"), i1("HANDLE_OK"))
          ],
          L.orAll([
            i1("GRAB"),
            i1("CREATE_OK"),
            i1("HANDLE_OK"),
            i1("EV_UP"),
            i1("EV_ESC")
          ]),
          b.out("DRAG")
        );
        const noSlot = L.and3(
          i1("EV_DOWN"),
          i1("CREATING"),
          L.NOT(i1("ANY_FREE"))
        );
        reg(
          "tool",
          L.andOr([[i1("EV_TOOL"), ARG.slice(0, TOOL_BITS)]], TOOL_BITS),
          L.orAll([
            i1("EV_TOOL"),
            noSlot,
            L.AND(i1("EV_UP"), i1("DG2")),
            i1("EV_ESC")
          ]),
          b.out("TOOL")
        );
        reg("cur", ARG, i1("EV_FILL"), b.out("CUR"));
        const offs = b.in("OFFS");
        const anch = b.in("ANCH");
        const rLoad = L.orAll([i1("GRAB"), i1("CREATE_OK"), i1("HANDLE_OK")]);
        reg(
          "r1",
          L.andOr(
            [
              [i1("GRAB"), offs.slice(0, 4)],
              [i1("CREATE_OK"), PX],
              [i1("HANDLE_OK"), anch.slice(0, 4)]
            ],
            4
          ),
          rLoad,
          b.out("R1")
        );
        reg(
          "r2",
          L.andOr(
            [
              [i1("GRAB"), offs.slice(4, 8)],
              [i1("CREATE_OK"), PY],
              [i1("HANDLE_OK"), anch.slice(4, 8)]
            ],
            4
          ),
          rLoad,
          b.out("R2")
        );
      },
      "selection, tool, current colour, pending drag and the grab offset / resize anchor"
    );
  }
  function definePen(lib) {
    define(
      lib,
      "PEN",
      {
        in: {
          CLK: 1,
          NCLK: 1,
          PEN_CLICK: 1,
          EV_PAINT: 1,
          EV_ERASE: 1,
          EV_TOOL: 1,
          EV_ESC: 1,
          IS_PEN: 1,
          IDLE: 1
        },
        out: { PENDOWN: 1, ERASE: 1, PLOT: 1, DIN: 1 }
      },
      (b) => {
        const L = logic(b);
        const [CLK, NCLK] = [b.in1("CLK"), b.in1("NCLK")];
        const reg = (name, D, LOAD, Q) => b.use(`REGS${Q.length}`, { D, LOAD, CLK, NCLK, Q }, name);
        const i1 = (n) => b.in1(n);
        const [down, erase] = [b.out1("PENDOWN"), b.out1("ERASE")];
        reg(
          "pendown",
          [L.AND(i1("PEN_CLICK"), L.NOT(down))],
          L.orAll([i1("PEN_CLICK"), i1("EV_TOOL"), i1("EV_ESC")]),
          [down]
        );
        const nerase = L.NOT(erase);
        reg("erase", [nerase], i1("EV_ERASE"), [erase]);
        const hover2 = L.andAll([i1("EV_PAINT"), i1("IS_PEN"), down, i1("IDLE")]);
        L.g("OR", [i1("PEN_CLICK"), hover2], b.out1("PLOT"));
        L.g("AND", [b.out1("PLOT"), nerase], b.out1("DIN"));
      },
      "the pen: down or up, ink or erase, and whether this event plots the pixel under the pointer"
    );
  }
  function definePaint(lib) {
    define(
      lib,
      "PAINTROW",
      { in: { ROW: 1, COL: GRID_W, D: 1 }, out: { Q: GRID_W } },
      (b) => {
        const [col, Q] = [b.in("COL"), b.out("Q")];
        for (let x = 0; x < GRID_W; x++)
          b.use(
            "RAMW1",
            { D: [b.in1("D")], ROW: b.in1("ROW"), COL: col[x], Q: [Q[x]] },
            `p${x}`
          );
      },
      `one row of the paint plane: ${GRID_W} one-bit RAM words on one word line`
    );
    define(
      lib,
      "PAINT",
      {
        in: { PX: 4, PY: 4, NCLK: 1, PLOT: 1, CLEAR: 1, DIN: 1 },
        out: { PIX: GRID_W * GRID_H }
      },
      (b) => {
        const L = logic(b);
        const [nclk, clear] = [b.in1("NCLK"), b.in1("CLEAR")];
        const lines = (A, n, en, forceHi, forceLo) => {
          const nA = A.map((a) => L.NOT(a));
          const h = en ? [L.AND(en, nA[3]), L.AND(en, A[3])] : [nA[3], A[3]];
          const lo = [0, 1, 2, 3].map(
            (v) => L.OR(L.AND(v & 2 ? A[1] : nA[1], v & 1 ? A[0] : nA[0]), forceLo)
          );
          const hi = Array.from(
            { length: Math.ceil(n / 4) },
            (_, v) => L.OR(L.AND(h[v >> 1], v & 1 ? A[2] : nA[2]), forceHi)
          );
          return Array.from({ length: n }, (_, v) => L.AND(hi[v >> 2], lo[v & 3]));
        };
        const rows = lines(
          b.in("PY"),
          GRID_H,
          L.AND(b.in1("PLOT"), nclk),
          L.AND(clear, nclk),
          clear
        );
        const cols = lines(b.in("PX"), GRID_W, null, clear, clear);
        const pix = b.out("PIX");
        rows.forEach(
          (row, y) => b.use(
            "PAINTROW",
            {
              ROW: row,
              COL: cols,
              D: b.in1("DIN"),
              Q: pix.slice(y * GRID_W, (y + 1) * GRID_W)
            },
            `r${y}`
          )
        );
      },
      `the paint plane: a ${GRID_W} \xD7 ${GRID_H} bitmap of one-bit RAM words, word line PY, bit line PX; Clear selects them all`
    );
  }
  function defineLayer(lib) {
    define(
      lib,
      "LAYER",
      {
        in: {
          CLK: 1,
          NCLK: 1,
          SBUS: 1,
          SNEXT: 1,
          SPREV: 1,
          WSEL: 1,
          WFILL: 1,
          WVIS: 1,
          GBUS: REC.geomBits,
          FILLD: 4,
          KINDD: 2,
          VISD: 1,
          NEXT: REC.bits,
          PREV: REC.bits
        },
        out: { REC: REC.bits }
      },
      (b) => {
        const L = logic(b);
        const [CLK, NCLK] = [b.in1("CLK"), b.in1("NCLK")];
        const [sbus, snext, sprev] = [
          b.in1("SBUS"),
          b.in1("SNEXT"),
          b.in1("SPREV")
        ];
        const rec = b.out("REC");
        const [next, prev] = [b.in("NEXT"), b.in("PREV")];
        const moves = L.orAll([sbus, snext, sprev]);
        const reg = (name, D, LOAD, at, width) => b.use(
          `REGS${width}`,
          { D, LOAD, CLK, NCLK, Q: rec.slice(at, at + width) },
          name
        );
        const field = (bus, at, w) => bus.slice(at, at + w);
        const gather = (bus, nb, pv, at, w, own = []) => L.andOr(
          [
            ...own,
            [snext, field(nb, at, w)],
            [sprev, field(pv, at, w)],
            ...bus ? [[sbus, bus]] : []
          ],
          w
        );
        reg(
          "used",
          L.andOr(
            [
              [sbus, [CONST1]],
              [snext, [next[REC.used]]],
              [sprev, [prev[REC.used]]]
            ],
            1
          ),
          moves,
          REC.used,
          1
        );
        reg(
          "vis",
          L.andOr(
            [
              [sbus, [b.in1("VISD")]],
              [snext, [next[REC.vis]]],
              [sprev, [prev[REC.vis]]],
              [b.in1("WVIS"), [L.NOT(rec[REC.vis])]]
            ],
            1
          ),
          L.OR(moves, b.in1("WVIS")),
          REC.vis,
          1
        );
        reg(
          "kind",
          gather(b.in("KINDD"), next, prev, REC.kind, 2),
          moves,
          REC.kind,
          2
        );
        reg(
          "geom",
          L.andOr(
            [
              [L.OR(sbus, b.in1("WSEL")), b.in("GBUS")],
              [snext, field(next, REC.geom, REC.geomBits)],
              [sprev, field(prev, REC.geom, REC.geomBits)]
            ],
            REC.geomBits
          ),
          L.OR(moves, b.in1("WSEL")),
          REC.geom,
          REC.geomBits
        );
        reg(
          "fill",
          L.andOr(
            [
              [L.OR(sbus, b.in1("WFILL")), b.in("FILLD")],
              [snext, field(next, REC.fill, 4)],
              [sprev, field(prev, REC.fill, 4)]
            ],
            4
          ),
          L.OR(moves, b.in1("WFILL")),
          REC.fill,
          4
        );
      },
      "one layer record in registers (used, vis, kind, rectangle, fill); loads a new record or its neighbour's"
    );
  }
  function defineDisplay(lib) {
    define(
      lib,
      "DISPLAY",
      {
        in: {
          REC: LAYERS * REC.bits,
          SEL: 3,
          TOOL: TOOL_BITS,
          DRAG: 2,
          CUR: 4,
          PENDOWN: 1
        },
        out: { NSEL: 3, NKIND: 16, NFILL: 32, NCUR: 4, ELL: 8, NELL: 8, HOT: 6 }
      },
      (b) => {
        const L = logic(b);
        const rec = b.in("REC");
        const f = (k, at, w = 1) => rec.slice(k * REC.bits + at, k * REC.bits + at + w);
        const inv = (bus, out) => bus.forEach((n, i) => L.g("NOT", [n], out[i]));
        inv(b.in("SEL"), b.out("NSEL"));
        for (let k = 0; k < LAYERS; k++) {
          inv(f(k, REC.kind, 2), b.out("NKIND").slice(2 * k, 2 * k + 2));
          const [k0, k1] = f(k, REC.kind, 2);
          const ell = L.g("AND", [k0, k1], b.out("ELL")[k]);
          L.g("NOT", [ell], b.out("NELL")[k]);
          inv(f(k, REC.fill, 4), b.out("NFILL").slice(4 * k, 4 * k + 4));
        }
        inv(b.in("CUR"), b.out("NCUR"));
        const [t0, t1, t2] = b.in("TOOL");
        const [d0, d1] = b.in("DRAG");
        const idle = L.g("NOR", [d0, d1]);
        const creating = L.g("OR", [t0, t1]);
        const moveTool = L.g("NOR", [creating, t2]);
        const hot = b.out("HOT");
        L.g("AND", [idle, moveTool], hot[0]);
        L.g("AND", [idle, creating], hot[1]);
        L.g("AND", [d0, L.NOT(d1)], hot[2]);
        L.buf(d1, hot[3]);
        const pen = L.AND(idle, t2);
        const down = b.in1("PENDOWN");
        L.g("AND", [pen, L.NOT(down)], hot[4]);
        L.g("AND", [pen, down], hot[5]);
      },
      "the screen: the few lines the UI layers need besides the registers (inverted bits pick a colour, a kind, the selected layer; hot picks the click layer)"
    );
  }
  function defineEngine(lib) {
    defineUnits(lib);
    for (const n of [1, 2, 3, 4, 16]) defineRegS(lib, n);
    defineRamWord(lib, 1);
    if (lib.has("ENGINE")) return;
    defineEvdec(lib);
    defineFreeslot(lib);
    defineReadplane(lib);
    defineGeom(lib);
    defineConds(lib);
    defineLayerctl(lib);
    defineNewrec(lib);
    defineState(lib);
    definePen(lib);
    definePaint(lib);
    defineLayer(lib);
    defineDisplay(lib);
    define(
      lib,
      "ENGINE",
      { in: { CLK: 1, PX: 4, PY: 4, EVT: EVT_BITS, ARG: 4 }, out: { HIT: 1 } },
      (b) => {
        const L = logic(b);
        const [CLK, PX, PY, EVT, ARG] = [
          b.in1("CLK"),
          b.in("PX"),
          b.in("PY"),
          b.in("EVT"),
          b.in("ARG")
        ];
        const NCLK = place2(b, "NOT", "nclk", [CLK]);
        const layers = Array.from({ length: LAYERS }, (_, k) => ({
          used: b.wire1(`used${k}`),
          vis: b.wire1(`vis${k}`),
          kind: b.wire(`kind${k}`, 2),
          x0: b.wire(`x0_${k}`, 4),
          x1: b.wire(`x1_${k}`, 4),
          y0: b.wire(`y0_${k}`, 4),
          y1: b.wire(`y1_${k}`, 4),
          fill: b.wire(`fill${k}`, 4)
        }));
        const recBus = (l) => [
          l.used,
          l.vis,
          ...l.kind,
          ...l.x0,
          ...l.x1,
          ...l.y0,
          ...l.y1,
          ...l.fill
        ];
        const sel = b.wire("sel", 3);
        const hassel = b.wire1("hassel");
        const tool = b.wire("tool", TOOL_BITS);
        const cur = b.wire("cur", 4);
        const drag = b.wire("drag", 2);
        const r1 = b.wire("r1", 4);
        const r2 = b.wire("r2", 4);
        const allRecs = layers.flatMap(recBus);
        const used = layers.map((l) => l.used);
        const ev = Object.fromEntries(
          [
            "TOOL",
            "FILL",
            "DOWN",
            "MOVE",
            "UP",
            "SELECT",
            "HANDLE",
            "VIS",
            "DEL",
            "DUP",
            "FWD",
            "BACK",
            "NUDGE",
            "ESC",
            "PAINT",
            "ERASE",
            "CLEAR"
          ].map((n) => [n, b.wire1(`ev_${n.toLowerCase()}`)])
        );
        const isMoveTool = b.wire1("is_move_tool");
        const creating = b.wire1("creating");
        const isPen = b.wire1("is_pen");
        const penClick = b.wire1("pen_click");
        const dg2 = b.wire("dg", 4);
        const dragging = b.wire1("dragging");
        b.use(
          "EVDEC",
          __spreadValues({
            EVT,
            TOOL: tool,
            DRAG: drag,
            IS_MOVE_TOOL: isMoveTool,
            CREATING: creating,
            IS_PEN: isPen,
            PEN_CLICK: penClick,
            DG: dg2,
            DRAGGING: dragging
          }, Object.fromEntries(
            Object.entries(ev).map(([n, w]) => [`EV_${n}`, w])
          )),
          "evdec"
        );
        const usable = layers.map((l) => L.AND(l.used, l.vis));
        const hit = b.use(
          "HIT8",
          {
            PX,
            PY,
            USED: usable,
            X0: layers.flatMap((l) => l.x0),
            Y0: layers.flatMap((l) => l.y0),
            X1: layers.flatMap((l) => l.x1),
            Y1: layers.flatMap((l) => l.y1)
          },
          "hit"
        );
        const ff = b.wire("ff", 8);
        const freeIdx = b.wire("free_idx", 3);
        const anyFree = b.wire1("any_free");
        b.use(
          "FREESLOT",
          { USED: used, FF: ff, IDX: freeIdx, ANY: anyFree },
          "free"
        );
        const c = Object.fromEntries(
          [
            "HIT_MOVE",
            "GRAB",
            "CREATE_OK",
            "DUP_OK",
            "HANDLE_OK",
            "DEL_OK",
            "FWD_OK",
            "BACK_OK",
            "NUDGE_OK",
            "MOVE_OK",
            "USE_MOVE",
            "USE_SPAN",
            "USE_NUDGE",
            "NR",
            "NL",
            "ND",
            "NU",
            "USED_ARG"
          ].map((n) => [n, b.wire1(n.toLowerCase())])
        );
        const s1h = b.wire("s1h", 8);
        const argdec = b.wire("argdec", 8);
        b.use(
          "CONDS",
          __spreadValues({
            EV_DOWN: ev.DOWN,
            EV_MOVE: ev.MOVE,
            EV_DEL: ev.DEL,
            EV_DUP: ev.DUP,
            EV_FWD: ev.FWD,
            EV_BACK: ev.BACK,
            EV_NUDGE: ev.NUDGE,
            EV_HANDLE: ev.HANDLE,
            IS_MOVE_TOOL: isMoveTool,
            CREATING: creating,
            DG: dg2,
            HASSEL: hassel,
            SEL: sel,
            USED: used,
            HIT_ANY: hit.ANY[0],
            ANY_FREE: anyFree,
            ARG: ARG.slice(0, 3),
            S1H: s1h,
            ARGDEC: argdec
          }, c),
          "conds"
        );
        const prec = b.wire("prec", REC.bits);
        b.use(
          "READPLANE",
          {
            SEL: sel,
            HIT_IDX: hit.IDX,
            USE_HIT: ev.DOWN,
            REC: allRecs,
            OUT: prec
          },
          "plane"
        );
        const g = b.wire("g", REC.geomBits);
        const offs = b.wire("offs", 8);
        const anch = b.wire("anch", 8);
        b.use(
          "GEOM",
          {
            PX,
            PY,
            R1: r1,
            R2: r2,
            SELG: prec.slice(REC.geom, REC.geom + REC.geomBits),
            EV_DOWN: ev.DOWN,
            USE_MOVE: c.USE_MOVE,
            USE_SPAN: c.USE_SPAN,
            USE_NUDGE: c.USE_NUDGE,
            NR: c.NR,
            NL: c.NL,
            ND: c.ND,
            NU: c.NU,
            ARG: ARG.slice(0, 2),
            G: g,
            OFFS: offs,
            ANCH: anch
          },
          "geom"
        );
        const lc = Object.fromEntries(
          ["SBUS", "SNEXT", "SPREV", "WSEL", "WFILL", "WVIS"].map((n) => [
            n,
            b.wire(n.toLowerCase(), LAYERS)
          ])
        );
        b.use(
          "LAYERCTL",
          __spreadValues({
            CREATE_OK: c.CREATE_OK,
            DUP_OK: c.DUP_OK,
            DEL_OK: c.DEL_OK,
            FWD_OK: c.FWD_OK,
            BACK_OK: c.BACK_OK,
            MOVE_OK: c.MOVE_OK,
            NUDGE_OK: c.NUDGE_OK,
            EV_FILL: ev.FILL,
            EV_VIS: ev.VIS,
            HASSEL: hassel,
            S1H: s1h,
            ARGDEC: argdec,
            USED: used,
            FF: ff
          }, lc),
          "layerctl"
        );
        const filld = b.wire("filld", 4);
        const kindd = b.wire("kindd", 2);
        const visd = b.wire1("visd");
        b.use(
          "NEWREC",
          {
            TOOL: tool.slice(0, 2),
            CUR: cur,
            EV_DUP: ev.DUP,
            EV_FILL: ev.FILL,
            ARG,
            PREC: prec,
            FILLD: filld,
            KINDD: kindd,
            VISD: visd
          },
          "newrec"
        );
        layers.forEach((l, k) => {
          b.use(
            "LAYER",
            {
              CLK,
              NCLK,
              SBUS: lc.SBUS[k],
              SNEXT: lc.SNEXT[k],
              SPREV: lc.SPREV[k],
              WSEL: lc.WSEL[k],
              WFILL: lc.WFILL[k],
              WVIS: lc.WVIS[k],
              GBUS: g,
              FILLD: filld,
              KINDD: kindd,
              VISD: visd,
              NEXT: k < LAYERS - 1 ? recBus(layers[k + 1]) : zeros(REC.bits),
              PREV: k > 0 ? recBus(layers[k - 1]) : zeros(REC.bits),
              REC: recBus(l)
            },
            `l${k}`
          );
        });
        b.use(
          "STATE",
          {
            CLK,
            NCLK,
            PX,
            PY,
            ARG,
            EV_TOOL: ev.TOOL,
            EV_FILL: ev.FILL,
            EV_SELECT: ev.SELECT,
            EV_UP: ev.UP,
            EV_ESC: ev.ESC,
            EV_DOWN: ev.DOWN,
            CREATING: creating,
            DG2: dg2[2],
            HIT_MOVE: c.HIT_MOVE,
            GRAB: c.GRAB,
            CREATE_OK: c.CREATE_OK,
            DUP_OK: c.DUP_OK,
            HANDLE_OK: c.HANDLE_OK,
            DEL_OK: c.DEL_OK,
            FWD_OK: c.FWD_OK,
            BACK_OK: c.BACK_OK,
            ANY_FREE: anyFree,
            USED_ARG: c.USED_ARG,
            HIT_IDX: hit.IDX,
            FREE_IDX: freeIdx,
            OFFS: offs,
            ANCH: anch,
            SEL: sel,
            HASSEL: hassel,
            TOOL: tool,
            CUR: cur,
            DRAG: drag,
            R1: r1,
            R2: r2
          },
          "state"
        );
        const pendown = b.wire1("pendown");
        const plot2 = b.wire1("plot");
        const din = b.wire1("din");
        b.use(
          "PEN",
          {
            CLK,
            NCLK,
            PEN_CLICK: penClick,
            EV_PAINT: ev.PAINT,
            EV_ERASE: ev.ERASE,
            EV_TOOL: ev.TOOL,
            EV_ESC: ev.ESC,
            IS_PEN: isPen,
            IDLE: dg2[0],
            PENDOWN: pendown,
            ERASE: b.wire1("erase"),
            PLOT: plot2,
            DIN: din
          },
          "pen"
        );
        b.use(
          "PAINT",
          {
            PX,
            PY,
            NCLK,
            PLOT: plot2,
            CLEAR: ev.CLEAR,
            DIN: din,
            PIX: b.wire("pix", GRID_W * GRID_H)
          },
          "paint"
        );
        b.use(
          "DISPLAY",
          {
            REC: allRecs,
            SEL: sel,
            TOOL: tool,
            DRAG: drag,
            CUR: cur,
            PENDOWN: pendown,
            NSEL: b.wire("nsel", 3),
            NKIND: b.wire("nkind", 16),
            NFILL: b.wire("nfill", 32),
            NCUR: b.wire("ncur", 4),
            ELL: b.wire("ell", 8),
            NELL: b.wire("nell", 8),
            HOT: b.wire("hot", 6)
          },
          "disp"
        );
        L.buf(hit.ANY[0], b.out1("HIT"));
      },
      "CPU NATHAN: the Figma OS editor as a gate-level machine; one tick = one editor event"
    );
  }

  // nathan/src/hw/index.ts
  function nathanLibrary() {
    const lib = /* @__PURE__ */ new Map();
    buildCells(lib);
    defineEngine(lib);
    return lib;
  }
  function nathanNetlist(lib = nathanLibrary()) {
    return flatten(lib, "ENGINE");
  }
  function nathanPowerOn(net) {
    const pokes = {};
    const name = STATE_NETS.cur;
    for (let i = 0; i < 4; i++) {
      const bit3 = INITIAL_FILL2 >> i & 1;
      pokes[`${name}[${i}]`] = bit3;
      pokes[`state/${name}/m${i}`] = bit3;
    }
    return powerOn(net, pokes);
  }

  // nathan/src/react/synth.ts
  function eval32(t, a, b) {
    switch (t) {
      case "BUF":
        return a;
      case "NOT":
        return a === 2 ? 2 : a ^ 1;
      case "AND":
        return a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : 2;
      case "OR":
        return a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : 2;
      case "NAND":
        return a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : 2;
      case "NOR":
        return a === 1 || b === 1 ? 0 : a === 0 && b === 0 ? 1 : 2;
      default:
        return a === 2 || b === 2 ? 2 : evalGate(t, a, b);
    }
  }
  var RE_M = /^(.*)\/m\d+_(take|hold|merge)$/;
  var RE_S = /^(.*)\/s\d+_(take|hold|merge)$/;
  var RE_C = /^(.*)\/(men|nmen)$/;
  var DISPLAY_PREFIX = "disp/";
  var NCLK_PATH = "nclk";
  function classify(g) {
    let m = RE_M.exec(g.path);
    if (m) return { c: "M", group: m[1] };
    m = RE_S.exec(g.path);
    if (m) return { c: "S", group: m[1] };
    m = RE_C.exec(g.path);
    if (m) return { c: "C", group: m[1] };
    if (g.path.startsWith(DISPLAY_PREFIX)) return { c: "D", group: "" };
    return { c: "X", group: "" };
  }
  function synthesize(net, tie, opts = {}) {
    var _a, _b, _c, _d, _e, _f;
    const nNets = net.netNames.length;
    const clk = net.aliases.get("CLK");
    const givenNet = /* @__PURE__ */ new Map();
    for (const [name, value] of Object.entries((_a = opts.given) != null ? _a : {})) {
      const one = net.aliases.get(name);
      const ids = one !== void 0 ? [one] : Array.from({ length: 32 }, (_, i) => net.aliases.get(`${name}[${i}]`)).filter(
        (id2) => id2 !== void 0
      );
      if (!ids.length) throw new Error(`cannot assume ${name}: no such net`);
      ids.forEach((id2, i) => givenNet.set(id2, value >> i & 1 ? NET1 : NET0));
    }
    const source = givenNet.size ? net.gates.map(
      (g) => classify(g).c === "D" || !g.in.some((n) => givenNet.has(n)) ? g : __spreadProps(__spreadValues({}, g), { in: g.in.map((n) => {
        var _a2;
        return (_a2 = givenNet.get(n)) != null ? _a2 : n;
      }) })
    ) : net.gates;
    const slaved = slaveGroups(net);
    const Kv = new Int8Array(nNets).fill(2);
    Kv[NET0] = 0;
    Kv[NET1] = 1;
    for (const [name, value] of Object.entries(tie)) {
      const port = net.ports.find((p) => p.name === name);
      if (port) port.nets.forEach((id2, i) => Kv[id2] = value >> i & 1);
      else {
        const id2 = net.aliases.get(name);
        if (id2 === void 0) throw new Error(`cannot tie ${name}: no such net`);
        Kv[id2] = value & 1;
      }
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (const g of source) {
        const y = eval32(
          g.type,
          Kv[g.in[0]],
          g.in.length > 1 ? Kv[g.in[1]] : 0
        );
        if (y !== 2 && Kv[g.out] !== y) {
          Kv[g.out] = y;
          changed = true;
        }
      }
    }
    const lit2 = (id2) => Kv[id2] === 0 ? NET0 : Kv[id2] === 1 ? NET1 : id2;
    const inert = /* @__PURE__ */ new Set();
    const live = /* @__PURE__ */ new Set();
    for (const g of source) {
      const c = classify(g);
      if (c.c === "C" && g.path.endsWith("/men"))
        (Kv[g.out] === 0 ? inert : live).add(c.group);
    }
    let gates = [];
    let folded = 0;
    for (const g of source) {
      if (Kv[g.out] !== 2) {
        folded++;
        continue;
      }
      const c = classify(g);
      if ((c.c === "M" || c.c === "S" || c.c === "C") && inert.has(c.group))
        continue;
      gates.push(__spreadProps(__spreadValues({}, g), { in: g.in.map(lit2) }));
    }
    const alias = Int32Array.from({ length: nNets }, (_, i) => i);
    const find = (x) => {
      while (alias[x] !== x) {
        alias[x] = alias[alias[x]];
        x = alias[x];
      }
      return x;
    };
    let aliased = 0;
    let merged = 0;
    const COMMUTES = /* @__PURE__ */ new Set([
      "AND",
      "OR",
      "NAND",
      "NOR",
      "XOR",
      "XNOR"
    ]);
    if (opts.alias !== false) {
      const dead = new Uint8Array(gates.length);
      for (let changed = true; changed; ) {
        changed = false;
        const first = /* @__PURE__ */ new Map();
        gates.forEach((g, i) => {
          if (dead[i] || classify(g).c !== "X" || g.path === NCLK_PATH) return;
          const ins = g.in.map(find);
          if (COMMUTES.has(g.type)) ins.sort((x, y) => x - y);
          const key = `${g.type}:${ins.join(",")}`;
          const to = first.get(key);
          if (to === void 0) first.set(key, g.out);
          else if (find(to) !== find(g.out)) {
            alias[g.out] = find(to);
            dead[i] = 1;
            merged++;
            changed = true;
          }
        });
        gates.forEach((g, i) => {
          if (dead[i] || classify(g).c !== "X" || g.path === NCLK_PATH) return;
          const a = find(g.in[0]);
          const b = g.in.length > 1 ? find(g.in[1]) : -1;
          let to = -1;
          if (g.type === "BUF") to = a;
          else if (g.type === "AND")
            to = a === NET1 ? b : b === NET1 ? a : a === b ? a : -1;
          else if (g.type === "OR")
            to = a === NET0 ? b : b === NET0 ? a : a === b ? a : -1;
          else if (g.type === "XOR") to = a === NET0 ? b : b === NET0 ? a : -1;
          else if (g.type === "XNOR") to = a === NET1 ? b : b === NET1 ? a : -1;
          if (to >= 0 && to !== g.out) {
            alias[g.out] = find(to);
            dead[i] = 1;
            aliased++;
            changed = true;
          }
        });
      }
      gates = gates.filter((_, i) => !dead[i]);
    }
    gates.forEach((g) => g.in = g.in.map(find));
    const info = gates.map(classify);
    const driver = new Int32Array(nNets).fill(-1);
    gates.forEach((g, i) => driver[g.out] = i);
    const keep = new Uint8Array(gates.length);
    const stack = [];
    gates.forEach((_, i) => {
      if (info[i].c === "M" || info[i].c === "S" || info[i].c === "C") {
        keep[i] = 1;
        stack.push(i);
      }
    });
    while (stack.length) {
      const i = stack.pop();
      for (const inp of gates[i].in) {
        const d = driver[inp];
        if (d >= 0 && !keep[d] && (info[d].c === "X" || info[d].c === "C")) {
          keep[d] = 1;
          stack.push(d);
        }
      }
    }
    const groupOfQ = /* @__PURE__ */ new Map();
    for (const g of net.gates) {
      const c = classify(g);
      if (c.c === "S" && g.path.endsWith("_merge")) groupOfQ.set(g.out, c.group);
    }
    for (const g of net.gates) {
      const c = classify(g);
      if (c.c === "M" && g.path.endsWith("_merge") && !slaved.has(c.group))
        groupOfQ.set(g.out, c.group);
    }
    const support = /* @__PURE__ */ new Map();
    const supportOf = (i) => {
      const hit = support.get(i);
      if (hit) return hit;
      const s = /* @__PURE__ */ new Set();
      support.set(i, s);
      for (const inp of gates[i].in) {
        const grp = groupOfQ.get(inp);
        if (grp !== void 0) s.add(grp);
        const d = driver[inp];
        if (d >= 0 && info[d].c === "D") for (const x of supportOf(d)) s.add(x);
      }
      return s;
    };
    const displayKept = [];
    gates.forEach((_, i) => {
      if (info[i].c !== "D") return;
      const s = [...supportOf(i)].filter((grp) => live.has(grp));
      if (s.length) {
        keep[i] = 1;
        displayKept.push(i);
      }
    });
    const kept = gates.map((g, i) => keep[i] ? i : -1).filter((i) => i >= 0);
    const set = (g) => ({ set: g.out, to: gateExpr(g) });
    const comb = (gi) => info[gi].c === "X" || info[gi].c === "C";
    const nclkGate = gates.findIndex((g) => g.path === NCLK_PATH);
    const C0 = { const: 0 };
    const C1 = { const: 1 };
    const order = [];
    const seen = new Uint8Array(gates.length);
    const visit = (gi) => {
      if (seen[gi]) return;
      seen[gi] = 1;
      for (const inp of gates[gi].in) {
        const d = driver[inp];
        if (d >= 0 && keep[d] && comb(d) && d !== nclkGate) visit(d);
      }
      order.push(gi);
    };
    for (const gi of kept) if (comb(gi) && gi !== nclkGate) visit(gi);
    const groups = /* @__PURE__ */ new Map();
    for (const gi of kept) {
      const c = info[gi];
      if (c.c !== "M" && c.c !== "S" && c.c !== "C") continue;
      const e = (_b = groups.get(c.group)) != null ? _b : {
        m: [],
        s: [],
        men: -1,
        nmen: -1,
        bits: /* @__PURE__ */ new Map()
      };
      groups.set(c.group, e);
      const leaf = gates[gi].path.slice(c.group.length + 1);
      const bitOf = () => {
        var _a2;
        const i = Number(/\d+/.exec(leaf)[0]);
        const b = (_a2 = e.bits.get(i)) != null ? _a2 : { take: -1, mmerge: -1, smerge: -1 };
        e.bits.set(i, b);
        return b;
      };
      if (c.c === "M") {
        e.m.push(gi);
        if (leaf.endsWith("_take")) bitOf().take = gi;
        else if (leaf.endsWith("_merge")) bitOf().mmerge = gi;
      } else if (c.c === "S") {
        e.s.push(gi);
        if (leaf.endsWith("_merge")) bitOf().smerge = gi;
      } else if (leaf === "men") e.men = gi;
      else e.nmen = gi;
    }
    const menOf = /* @__PURE__ */ new Map();
    for (const [grp, e] of groups) {
      if (e.men < 0) throw new Error(`register group ${grp} has no enable gate`);
      menOf.set(grp, gates[e.men].out);
    }
    const moved = new Uint8Array(gates.length);
    const inside = /* @__PURE__ */ new Map();
    let implied = 0;
    if (opts.alias !== false && opts.inside !== false) {
      const readers = /* @__PURE__ */ new Map();
      for (const gi of kept)
        for (const n of gates[gi].in) {
          const r = readers.get(n);
          if (r) r.push(gi);
          else readers.set(n, [gi]);
        }
      const position = new Int32Array(gates.length).fill(-1);
      order.forEach((gi, k) => position[gi] = k);
      const nclkNet = nclkGate >= 0 ? gates[nclkGate].out : -1;
      const plain = (d) => d >= 0 && keep[d] && info[d].c === "X" && d !== nclkGate && !moved[d];
      for (const [grp, e] of groups) {
        const load = gates[e.men].in.find((n) => n !== nclkNet);
        if (load === void 0 || load <= NET1) continue;
        const takes = /* @__PURE__ */ new Set();
        for (const b of e.bits.values()) if (b.take >= 0) takes.add(b.take);
        const mine = /* @__PURE__ */ new Set();
        let frontier = [...takes].map((t) => driver[gates[t].in[0]]).filter(plain);
        while (frontier.length) {
          const next = [];
          for (const gi of frontier) {
            if (mine.has(gi)) continue;
            const rs = (_c = readers.get(gates[gi].out)) != null ? _c : [];
            if (!rs.every((r) => takes.has(r) || mine.has(r))) continue;
            mine.add(gi);
            for (const n of gates[gi].in)
              if (plain(driver[n])) next.push(driver[n]);
          }
          frontier = next;
        }
        if (!mine.size) continue;
        const known = /* @__PURE__ */ new Map();
        const imply = (n, v) => {
          if (n <= NET1 || known.has(n)) return;
          known.set(n, v);
          const d = driver[n];
          if (d < 0) return;
          const g = gates[d];
          if (g.type === "AND" && v === 1) g.in.forEach((x) => imply(x, 1));
          else if (g.type === "OR" && v === 0) g.in.forEach((x) => imply(x, 0));
          else if (g.type === "NOT") imply(g.in[0], v === 1 ? 0 : 1);
          else if (g.type === "BUF") imply(g.in[0], v);
        };
        imply(load, 1);
        const same = /* @__PURE__ */ new Map();
        const res = (n) => {
          var _a2;
          const v = known.get(n);
          if (v !== void 0) return v ? NET1 : NET0;
          return (_a2 = same.get(n)) != null ? _a2 : n;
        };
        const kOf = (n) => n === NET0 ? 0 : n === NET1 ? 1 : 2;
        const body2 = [];
        for (const gi of [...mine].sort((a, b) => position[a] - position[b])) {
          const g = gates[gi];
          const ins = g.in.map(res);
          const [a, b] = [ins[0], ins.length > 1 ? ins[1] : -1];
          const y = eval32(g.type, kOf(a), b < 0 ? 0 : kOf(b));
          let to = -1;
          if (y !== 2) to = y ? NET1 : NET0;
          else if (g.type === "BUF") to = a;
          else if (g.type === "AND")
            to = a === NET1 ? b : b === NET1 ? a : a === b ? a : -1;
          else if (g.type === "OR")
            to = a === NET0 ? b : b === NET0 ? a : a === b ? a : -1;
          else if (g.type === "XOR") to = a === NET0 ? b : b === NET0 ? a : -1;
          else if (g.type === "XNOR") to = a === NET1 ? b : b === NET1 ? a : -1;
          if (to >= 0) {
            same.set(g.out, to);
            implied++;
          } else body2.push(__spreadProps(__spreadValues({}, g), { in: ins }));
        }
        for (const gi of mine) moved[gi] = 1;
        inside.set(grp, { gates: body2, res });
      }
    }
    const blockOf = (grp) => {
      var _a2;
      return (_a2 = inside.get(grp)) != null ? _a2 : { gates: [], res: (n) => n };
    };
    const var_ = (n) => ({ var: n });
    const isOn = (n) => ({ eq: [{ var: n }, { const: 1 }] });
    const blocks = /* @__PURE__ */ new Map();
    const dorder = [];
    const dseen = new Uint8Array(gates.length);
    const dvisit = (gi) => {
      if (dseen[gi]) return;
      dseen[gi] = 1;
      for (const inp of gates[gi].in) {
        const d = driver[inp];
        if (d >= 0 && keep[d] && info[d].c === "D") dvisit(d);
      }
      dorder.push(gi);
    };
    for (const gi of displayKept) dvisit(gi);
    for (const gi of dorder) {
      const sup = [...supportOf(gi)].filter((grp) => live.has(grp)).sort();
      const key = sup.join("|");
      const b = (_d = blocks.get(key)) != null ? _d : { groups: sup, gates: [] };
      blocks.set(key, b);
      b.gates.push(gi);
    }
    const screen = [];
    [...blocks.values()].sort((a, b) => a.groups.length - b.groups.length).forEach((b) => {
      const guard = b.groups.map((grp) => isOn(menOf.get(grp))).reduce((x, y) => ({ or: [x, y] }));
      screen.push({ if: guard, then: b.gates.map((gi) => set(gates[gi])) });
    });
    const emit = (commit2) => {
      const nclk = nclkGate >= 0 ? [set(gates[nclkGate])] : [];
      const low = [
        { set: clk, to: C0 },
        ...nclk,
        ...order.filter(
          (gi) => !moved[gi] && !(commit2 !== "gates" && info[gi].c === "C" && gates[gi].path.endsWith("/nmen"))
        ).map((gi) => set(gates[gi]))
      ];
      const high = [{ set: clk, to: C1 }, ...nclk];
      if (commit2 === "direct") {
        const { early, writes } = directCommit();
        low.push(...early);
        const commitAt2 = low.length;
        low.push(...writes);
        return {
          actions: [...low, ...high, ...screen],
          screenAt: low.length + high.length,
          commitAt: commitAt2
        };
      }
      const commitAt = low.length;
      for (const [grp, e] of groups) {
        const men = menOf.get(grp);
        const { gates: cone, res } = blockOf(grp);
        const first = cone.map(set);
        if (commit2 === "gates") {
          low.push({
            if: isOn(men),
            then: [
              ...first,
              ...e.m.map(
                (gi) => set(__spreadProps(__spreadValues({}, gates[gi]), { in: gates[gi].in.map(res) }))
              )
            ]
          });
          if (e.s.length)
            high.push({ if: isOn(men), then: e.s.map((gi) => set(gates[gi])) });
          continue;
        }
        const bits2 = latchBits(grp, e);
        low.push({
          if: isOn(men),
          then: [
            ...first,
            ...bits2.map((b) => ({ set: b.m, to: litExpr(b.d) }))
          ]
        });
        if (slaved.has(grp))
          high.push({
            if: isOn(men),
            then: bits2.map((b) => ({ set: b.q, to: var_(b.m) }))
          });
      }
      return {
        actions: [...low, ...high, ...screen],
        screenAt: low.length + high.length,
        commitAt
      };
    };
    const latchBits = (grp, e) => {
      const { res } = blockOf(grp);
      return [...e.bits.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => ({
        d: b.take >= 0 ? res(gates[b.take].in[0]) : NET0,
        m: gates[b.mmerge].out,
        q: gates[b.smerge >= 0 ? b.smerge : b.mmerge].out
      }));
    };
    const directCommit = () => {
      const list = [...groups.entries()].map(([grp, e]) => ({
        men: menOf.get(grp),
        bits: latchBits(grp, e),
        cone: blockOf(grp).gates
      }));
      const all = list.map((_, i) => i);
      const owner = /* @__PURE__ */ new Map();
      list.forEach((g, i) => g.bits.forEach((b) => owner.set(b.q, i)));
      const before = list.map(() => []);
      const reads = list.map(() => []);
      const viaMaster = new Uint8Array(list.length);
      list.forEach((g, i) => {
        g.bits.forEach((b) => {
          const j = owner.get(b.d);
          if (j === void 0) return;
          if (j !== i) before[i].push(j);
          else if (b.d !== b.q) viaMaster[i] = 1;
        });
        for (const cg of g.cone)
          for (const n of cg.in) {
            const j = owner.get(n);
            if (j !== void 0 && j !== i) reads[i].push(j);
          }
      });
      const cycles = (nodes, edges2) => {
        const index = new Int32Array(list.length).fill(-1);
        const low = new Int32Array(list.length);
        const onStack = new Uint8Array(list.length);
        const stack2 = [];
        const out = [];
        let next = 0;
        const strong = (v) => {
          index[v] = low[v] = next++;
          stack2.push(v);
          onStack[v] = 1;
          for (const w2 of edges2(v)) {
            if (index[w2] < 0) {
              strong(w2);
              low[v] = Math.min(low[v], low[w2]);
            } else if (onStack[w2]) low[v] = Math.min(low[v], index[w2]);
          }
          if (low[v] !== index[v]) return;
          const scc = [];
          let w;
          do {
            w = stack2.pop();
            onStack[w] = 0;
            scc.push(w);
          } while (w !== v);
          if (scc.length > 1) out.push(scc);
        };
        nodes.forEach((v) => index[v] < 0 && strong(v));
        return out;
      };
      for (const scc of cycles(all, (v) => before[v]))
        for (const x of scc) viaMaster[x] = 1;
      const rest = all.filter((v) => !viaMaster[v]);
      const early = new Uint8Array(list.length);
      const edges = (v) => [...before[v], ...early[v] ? [] : reads[v]].filter((w) => !viaMaster[w]);
      for (const scc of cycles(rest, edges)) {
        const inside2 = new Set(scc);
        for (const x of scc) if (reads[x].some((w) => inside2.has(w))) early[x] = 1;
      }
      const seen2 = new Uint8Array(list.length);
      const post2 = [];
      const visit2 = (v) => {
        if (seen2[v]) return;
        seen2[v] = 1;
        for (const w of edges(v)) visit2(w);
        post2.push(v);
      };
      rest.forEach(visit2);
      const block = (i, f, withCone) => ({
        if: isOn(list[i].men),
        then: [
          ...withCone ? list[i].cone.map(set) : [],
          ...list[i].bits.map(f)
        ]
      });
      const cyc = all.filter((i) => viaMaster[i]);
      return {
        early: all.filter((i) => early[i]).map((i) => ({ if: isOn(list[i].men), then: list[i].cone.map(set) })),
        writes: [
          ...cyc.map(
            (i) => block(i, (b) => ({ set: b.m, to: litExpr(b.d) }), true)
          ),
          ...post2.reverse().map(
            (i) => block(i, (b) => ({ set: b.q, to: litExpr(b.d) }), !early[i])
          ),
          ...cyc.filter((i) => list[i].bits.some((b) => b.q !== b.m)).map((i) => block(i, (b) => ({ set: b.q, to: var_(b.m) }), false))
        ]
      };
    };
    const litExpr = (n) => n === NET0 ? C0 : n === NET1 ? C1 : { var: n };
    const mode = (_e = opts.latch) != null ? _e : "auto";
    let commit = mode === "auto" ? "gates" : mode;
    let emitted = emit(commit);
    if (mode === "auto" && staticSize(emitted.actions) > ((_f = opts.budget) != null ? _f : 900)) {
      commit = "direct";
      emitted = emit(commit);
    }
    return {
      actions: emitted.actions,
      screenAt: emitted.screenAt,
      commitAt: emitted.commitAt,
      men: menOf,
      stats: {
        kept: kept.length,
        folded,
        aliased,
        merged,
        implied,
        groupsLive: live.size,
        groupsInert: inert.size,
        displayGates: displayKept.length,
        displayBlocks: blocks.size,
        latch: commit
      }
    };
  }
  var slavedOf = /* @__PURE__ */ new WeakMap();
  function slaveGroups(net) {
    let out = slavedOf.get(net);
    if (out) return out;
    out = /* @__PURE__ */ new Set();
    for (const g of net.gates) {
      const c = classify(g);
      if (c.c === "S") out.add(c.group);
    }
    slavedOf.set(net, out);
    return out;
  }
  function masterToQ(net) {
    const q = /* @__PURE__ */ new Map();
    for (const g of net.gates) {
      const m = /^(.*)\/s(\d+)_merge$/.exec(g.path);
      if (m) q.set(`${m[1]}/${m[2]}`, g.out);
    }
    const out = /* @__PURE__ */ new Map();
    for (const g of net.gates) {
      const m = /^(.*)\/m(\d+)_merge$/.exec(g.path);
      const to = m ? q.get(`${m[1]}/${m[2]}`) : void 0;
      if (to !== void 0) out.set(g.out, to);
    }
    return out;
  }
  var staticSize = (a) => a.reduce(
    (n, x) => {
      var _a;
      return n + ("set" in x ? 1 : 1 + staticSize(x.then) + staticSize((_a = x.else) != null ? _a : []));
    },
    0
  );

  // nathan/src/react/catalog.ts
  var always = () => true;
  var dg = (v0, v1, v2, v3) => __spreadValues(__spreadValues({
    "dg[0]": v0,
    "dg[1]": v1
  }, v2 === void 0 ? {} : { "dg[2]": v2 }), v3 === void 0 ? {} : { "dg[3]": v3 });
  var PEN_TIES = __spreadProps(__spreadValues({}, dg(1, 0, 0, 0)), {
    dragging: 0,
    is_move_tool: 0,
    creating: 0,
    is_pen: 1
  });
  var HOTSPOT_SETS = [
    {
      name: "click/idle-move",
      ties: __spreadProps(__spreadValues({
        EVT: EV.CLICK
      }, dg(1, 0, 0, 0)), {
        dragging: 0,
        is_move_tool: 1,
        creating: 0,
        is_pen: 0
      }),
      valid: (s) => !s.drag && s.tool === "move"
    },
    {
      name: "click/idle-create",
      ties: __spreadProps(__spreadValues({
        EVT: EV.CLICK
      }, dg(1, 0, 0, 0)), {
        dragging: 0,
        is_move_tool: 0,
        creating: 1,
        is_pen: 0
      }),
      valid: (s) => !s.drag && s.tool !== "move" && s.tool !== "pen"
    },
    {
      name: "click/drag-move",
      ties: __spreadProps(__spreadValues({ EVT: EV.CLICK }, dg(0, 1, 0, 0)), { dragging: 1 }),
      valid: (s) => {
        var _a;
        return ((_a = s.drag) == null ? void 0 : _a.mode) === "move";
      }
    },
    {
      name: "click/drag-span",
      ties: __spreadProps(__spreadValues({ EVT: EV.CLICK }, dg(0, 0)), { dragging: 1 }),
      valid: (s) => {
        var _a, _b;
        return ((_a = s.drag) == null ? void 0 : _a.mode) === "create" || ((_b = s.drag) == null ? void 0 : _b.mode) === "resize";
      }
    },
    ...[0, 1].map(() => ({
      name: "click/pen",
      ties: __spreadValues({ EVT: EV.CLICK }, PEN_TIES),
      valid: (s) => !s.drag && s.tool === "pen"
    }))
  ];
  var HOTSPOT_REACTIONS = HOTSPOT_SETS.map((h) => h.name);
  var PAINT_SET = HOT.indexOf("pen-down");
  var HOTSPOT_GRAIN = ["cell", "row", "cell", "cell", "cell", "cell"];
  var HOTSPOT_GESTURE = ["down", "down", "up", "up", "down", "down"];
  var clickRun = (set, row, col = 0, sel = 0) => `${HOTSPOT_REACTIONS[set]}/${row}` + (HOTSPOT_GRAIN[set] === "cell" ? `/${col}` : "") + (HOTSPOT_GRAIN[set] === "row@sel" ? `@${sel}` : "");
  var hoverRun = (set, row, col) => set === PAINT_SET ? `paint/${row}/${col}` : `pointer/${col}`;
  var CLICK_SPECS = HOTSPOT_SETS.flatMap(
    (h, set) => Array.from({ length: GRID_H }, (_, y) => {
      const grain = HOTSPOT_GRAIN[set];
      if (grain === "cell")
        return Array.from({ length: GRID_W }, (_2, x) => __spreadProps(__spreadValues({}, h), {
          name: clickRun(set, y, x),
          ties: __spreadProps(__spreadValues({}, h.ties), { PY: y, PX: x }),
          event: () => ({ k: "click", x, y })
        }));
      if (grain === "row@sel")
        return Array.from({ length: LAYERS }, (_2, sel) => __spreadProps(__spreadValues({}, h), {
          name: clickRun(set, y, 0, sel),
          ties: __spreadProps(__spreadValues({}, h.ties), { PY: y }),
          given: { sel },
          event: (rnd) => ({ k: "click", x: rnd(GRID_W), y })
        }));
      return [
        __spreadProps(__spreadValues({}, h), {
          name: clickRun(set, y),
          ties: __spreadProps(__spreadValues({}, h.ties), { PY: y }),
          event: (rnd) => ({ k: "click", x: rnd(GRID_W), y })
        })
      ];
    }).flat()
    // two sets that run the same reactions (the pen's) make them once
  ).filter((spec, i, all) => all.findIndex((o) => o.name === spec.name) === i);
  var PAINT_SPECS = Array.from(
    { length: GRID_H },
    (_, y) => Array.from({ length: GRID_W }, (_2, x) => ({
      name: `paint/${y}/${x}`,
      ties: __spreadValues({ EVT: EV.PAINT, PX: x, PY: y }, PEN_TIES),
      given: { pendown: 1 },
      valid: (s) => !s.drag && s.tool === "pen" && s.penDown,
      event: () => ({ k: "paint", x, y })
    }))
  ).flat();
  function reactionSpecs() {
    const out = [...CLICK_SPECS, ...PAINT_SPECS];
    for (let t = 0; t < TOOLS.length; t++)
      out.push({
        name: `tool/${t}`,
        ties: { EVT: EV.TOOL, ARG: t },
        valid: always,
        event: () => ({ k: "tool", t })
      });
    for (let c = 0; c < PALETTE_SIZE2; c++)
      for (let sel = 0; sel < LAYERS; sel++)
        out.push({
          name: `fill/${c}@${sel}`,
          ties: { EVT: EV.FILL, ARG: c },
          given: { sel },
          valid: always,
          event: () => ({ k: "fill", c })
        });
    for (let k = 0; k < LAYERS; k++) {
      out.push({
        name: `select/${k}`,
        ties: { EVT: EV.SELECT, ARG: k },
        valid: (s) => s.layers.length > k,
        event: () => ({ k: "select", slot: k })
      });
      out.push({
        name: `vis/${k}`,
        ties: { EVT: EV.VIS, ARG: k },
        valid: (s) => s.layers.length > k,
        event: () => ({ k: "vis", slot: k })
      });
    }
    for (let c = 0; c < 4; c++)
      for (let sel = 0; sel < LAYERS; sel++)
        out.push({
          name: `handle/${c}@${sel}`,
          ties: { EVT: EV.HANDLE, ARG: c },
          given: { sel },
          valid: (s) => s.selected !== null,
          event: () => ({ k: "handle", corner: c })
        });
    for (let d = 0; d < 4; d++)
      for (let sel = 0; sel < LAYERS; sel++)
        out.push({
          name: `nudge/${d}@${sel}`,
          ties: { EVT: EV.NUDGE, ARG: d },
          given: { sel },
          valid: always,
          event: () => ({ k: "nudge", dir: d })
        });
    out.push({
      name: "delete",
      ties: { EVT: EV.DELETE },
      valid: always,
      event: () => ({ k: "delete" })
    });
    for (const [name, evt, k] of [
      ["dup", EV.DUP, "dup"],
      ["fwd", EV.FWD, "fwd"],
      ["back", EV.BACK, "back"]
    ]) {
      for (let sel = 0; sel < LAYERS; sel++)
        out.push({
          name: `${name}@${sel}`,
          ties: { EVT: evt },
          given: { sel },
          valid: always,
          event: () => ({ k })
        });
    }
    out.push({
      name: "esc",
      ties: { EVT: EV.ESC },
      valid: always,
      event: () => ({ k: "esc" })
    });
    out.push({
      name: "erase",
      ties: { EVT: EV.ERASE },
      valid: always,
      event: () => ({ k: "erase" })
    });
    out.push({
      name: "clear",
      ties: { EVT: EV.CLEAR },
      valid: always,
      event: () => ({ k: "clear" })
    });
    return out;
  }
  async function buildCatalogGently(net, specs, opts, rest) {
    const out = /* @__PURE__ */ new Map();
    for (const [i, spec] of specs.entries()) {
      out.set(spec.name, entryOf(net, spec, opts));
      if (i % 4 === 3) await rest();
    }
    return out;
  }
  var entryOf = (net, spec, opts) => ({
    spec,
    reaction: synthesize(net, spec.ties, __spreadProps(__spreadValues({}, opts), { given: spec.given }))
  });

  // nathan/src/react/stroke.ts
  function lineCells(x0, y0, x1, y1) {
    const out = [];
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let [x, y] = [x0, y0];
    for (; ; ) {
      out.push([x, y]);
      if (x === x1 && y === y1) return out;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  var pixOf = (x, y) => y * GRID_W + x;
  function strokePlan(row, col) {
    const lines = [];
    for (let y = 0; y < GRID_H; y++)
      for (let x = 0; x < GRID_W; x++) {
        if (x === col && y === row) continue;
        const cells = lineCells(x, y, col, row).slice(1, -1);
        lines.push({ x, y, bits: cells.map(([cx, cy]) => pixOf(cx, cy)) });
      }
    return { at: pixOf(col, row), lines };
  }
  var strokeRun = (row, col) => `stroke/${row}/${col}`;

  // nathan/src/ui/render.ts
  var BREATHE_EVERY = 150;
  function make(api, s) {
    switch (s.type) {
      case "frame":
        return api.createFrame();
      case "rect":
        return api.createRectangle();
      case "ellipse":
        return api.createEllipse();
      case "text":
        return api.createText();
      case "svg":
        return api.createNodeFromSvg(s.svg);
    }
  }
  async function render(ctx, parent, spec) {
    const out = {
      root: void 0,
      nodes: /* @__PURE__ */ new Map(),
      created: 0,
      bound: 0,
      missing: [],
      reactions: 0
    };
    const pending = [];
    const build = async (s, into, parentSpec, path) => {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
      const api = ctx.api;
      const node = make(api, s);
      node.name = s.name;
      out.created++;
      if (ctx.breathe && out.created % BREATHE_EVERY === 0) await ctx.breathe();
      if (s.type === "svg") {
      } else if (node.type === "TEXT") {
        const t = s.text;
        node.fontName = t.bold ? FONT_BOLD : FONT;
        node.fontSize = (_a = t.size) != null ? _a : 12;
        node.characters = t.chars;
        node.fills = solid2((_b = t.color) != null ? _b : "#FFFFFF");
      } else {
        const shape = node;
        if (s.w !== void 0 || s.h !== void 0)
          shape.resize(
            Math.max((_c = s.w) != null ? _c : shape.width, 0.01),
            Math.max((_d = s.h) != null ? _d : shape.height, 0.01)
          );
        shape.fills = s.fill ? solid2(s.fill) : [];
        shape.strokes = s.stroke ? solid2(s.stroke) : [];
        if (s.stroke) {
          shape.strokeWeight = (_e = s.strokeWeight) != null ? _e : 1;
          shape.strokeAlign = "INSIDE";
        }
        if (s.radius) shape.cornerRadius = s.radius;
        if (node.type === "FRAME") {
          node.clipsContent = !!s.clip;
          if (s.layout) {
            node.layoutMode = s.layout.dir === "H" ? "HORIZONTAL" : "VERTICAL";
            node.itemSpacing = (_f = s.layout.gap) != null ? _f : 0;
            const pad = (_g = s.layout.pad) != null ? _g : 0;
            node.paddingLeft = node.paddingRight = node.paddingTop = node.paddingBottom = pad;
            node.primaryAxisAlignItems = (_h = s.layout.main) != null ? _h : "MIN";
            node.counterAxisAlignItems = (_i = s.layout.cross) != null ? _i : "MIN";
          }
        }
      }
      if (s.hidden) node.visible = false;
      into.appendChild(node);
      const inAutoLayout = !!(parentSpec == null ? void 0 : parentSpec.layout);
      if (!inAutoLayout && s.x !== void 0 && s.y !== void 0) {
        node.x = s.x;
        node.y = s.y;
      }
      if (inAutoLayout) {
        if (s.absolute) {
          node.layoutPositioning = "ABSOLUTE";
          node.x = (_j = s.x) != null ? _j : 0;
          node.y = (_k = s.y) != null ? _k : 0;
        } else {
          node.layoutSizingHorizontal = (_l = s.sizeH) != null ? _l : "FIXED";
          node.layoutSizingVertical = (_m = s.sizeV) != null ? _m : "FIXED";
        }
      } else if (node.type === "FRAME" && s.layout) {
        node.layoutSizingHorizontal = s.sizeH === "HUG" ? "HUG" : "FIXED";
        node.layoutSizingVertical = s.sizeV === "HUG" ? "HUG" : "FIXED";
      }
      if (s.visibleNet) {
        const v = ctx.variable(s.visibleNet);
        if (v) {
          node.setBoundVariable("visible", v);
          out.bound++;
        } else out.missing.push(s.visibleNet);
      }
      if ((_n = s.reactions) == null ? void 0 : _n.length) {
        pending.push([
          node,
          s.reactions.flatMap((r) => ctx.reactionsFor(r))
        ]);
        out.reactions += s.reactions.length;
      }
      const here = `${path}/${s.name}`;
      out.nodes.set(here, node);
      for (const c of (_o = s.children) != null ? _o : [])
        await build(c, node, s, here);
      return node;
    };
    out.root = await build(spec, parent, null, "");
    for (let i = 0; i < pending.length; i++) {
      await pending[i][0].setReactionsAsync(pending[i][1]);
      if (ctx.breathe && i % 25 === 24) await ctx.breathe();
    }
    return out;
  }

  // nathan/src/ui/icons.ts
  var ICON = {
    // the toolbar (os-ui's drawings)
    move: '<path d="M5.5 4.5 19.5 10.2l-6.9 2.2-2.4 7z"/>',
    frame: '<path d="M8.5 3.5v17M15.5 3.5v17M3.5 8.5h17M3.5 15.5h17"/>',
    rect: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
    ellipse: '<circle cx="12" cy="12" r="8"/>',
    pen: '<g transform="rotate(45 12 12)"><path d="M12 21 7.6 12.6c-.7-1.5-.5-3.4.5-4.7L12 3l3.9 4.9c1 1.3 1.2 3.2.5 4.7z"/><circle cx="12" cy="10.6" r="1.6"/><path d="M12 12.2V21"/></g>',
    // Lucide
    erase: '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
    clear: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
    assets: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    cpu: '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    chevDown: '<path d="m6 9 6 6 6-6"/>',
    sidebar: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    // the Figma mark, in outline: two half-pills, a half-pill and a circle, a drop
    logo: '<path d="M12 2.5H9a3 3 0 0 0 0 6h3z"/><path d="M12 2.5h3a3 3 0 0 1 0 6h-3z"/><path d="M12 8.5H9a3 3 0 0 0 0 6h3z"/><circle cx="15" cy="11.5" r="3"/><path d="M12 14.5H9a3 3 0 1 0 3 3z"/>'
  };
  function svgIcon(name, size2, color, weight = 1.5) {
    return `<svg width="${size2}" height="${size2}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
  }

  // nathan/src/ui/spec.ts
  var PALETTE_HEX = [
    "#000000",
    "#1D2B53",
    "#7E2553",
    "#008751",
    "#AB5236",
    "#5F574F",
    "#C2C3C7",
    "#FFF1E8",
    "#FF004D",
    "#FFA300",
    "#FFEC27",
    "#00E436",
    "#29ADFF",
    "#83769C",
    "#FF77A8",
    "#FFCCAA"
  ];
  var COLOR = {
    canvas: "#1E1E1E",
    panel: "#2C2C2C",
    field: "#383838",
    selected: "#394360",
    accent: "#0C8CE9",
    text: "#FFFFFF",
    dim: "#B3B3B3",
    faint: "#808080",
    line: "#444444",
    grid: "#2A2A2A",
    frame: "#1E1E1E",
    /** The pen's ink. */
    ink: "#F5F5F5"
  };
  var CELL = 56;
  var CANVAS_W = GRID_W * CELL;
  var CANVAS_H = GRID_H * CELL;
  var RAIL_W = 56;
  var LEFT_W = 240;
  var RIGHT_W = 242;
  var RULER = 20;
  var UI_W = 1440;
  var UI_H = 810;
  var MID_X = RAIL_W + LEFT_W;
  var MID_W = UI_W - MID_X - RIGHT_W;
  var CANVAS_X = MID_X + RULER + Math.round((MID_W - RULER - CANVAS_W) / 2);
  var CANVAS_Y = 84;
  var BAR_H = 48;
  var BAR_Y = UI_H - 16 - BAR_H;
  var frame = (name, p = {}) => __spreadValues({
    type: "frame",
    name
  }, p);
  var rect = (name, p = {}) => __spreadValues({
    type: "rect",
    name
  }, p);
  var label = (name, chars, p = {}) => {
    const _a = p, { size: size2, bold, color } = _a, rest = __objRest(_a, ["size", "bold", "color"]);
    return __spreadValues({ type: "text", name, text: { chars, size: size2, bold, color } }, rest);
  };
  var bit = (bus, i) => `${bus}[${i}]`;
  var THIN = 0.01;
  var bits = (net) => (i) => bit(net, i);
  function spacer(prefix, dir, unit, n, netOf) {
    return Array.from(
      { length: n },
      (_, i) => frame(`${prefix}${i}`, {
        w: dir === "H" ? unit << i : THIN,
        h: dir === "H" ? THIN : unit << i,
        visibleNet: netOf(i)
      })
    );
  }
  var layerNets = (k) => ({
    x0: bits(STATE_NETS.x0(k)),
    x1: bits(STATE_NETS.x1(k)),
    y0: bits(STATE_NETS.y0(k)),
    y1: bits(STATE_NETS.y1(k))
  });
  function placedBy(name, nets, unit, body2, inner = {}) {
    return frame(name, {
      x: 0,
      y: 0,
      layout: { dir: "H" },
      sizeH: "HUG",
      sizeV: "HUG",
      children: [
        frame("y1", {
          layout: { dir: "V" },
          sizeH: "HUG",
          sizeV: "HUG",
          children: spacer("y1/", "V", unit, 4, nets.y1)
        }),
        frame("col", __spreadProps(__spreadValues({
          layout: { dir: "V" },
          sizeH: "HUG",
          sizeV: "FILL"
        }, inner), {
          children: [
            ...spacer("y0/", "V", unit, 4, nets.y0),
            frame("xbox", {
              layout: { dir: "V" },
              sizeH: "HUG",
              sizeV: "FILL",
              children: [
                frame("x1", {
                  layout: { dir: "H" },
                  sizeH: "HUG",
                  sizeV: "HUG",
                  children: spacer("x1/", "H", unit, 4, nets.x1)
                }),
                frame("row", {
                  layout: { dir: "H" },
                  sizeH: "FILL",
                  sizeV: "FILL",
                  children: [
                    ...spacer("x0/", "H", unit, 4, nets.x0),
                    __spreadProps(__spreadValues({}, body2), { sizeH: "FILL", sizeV: "FILL" })
                  ]
                })
              ]
            })
          ]
        }))
      ]
    });
  }
  var placed = (name, k, body2, inner = {}) => placedBy(name, layerNets(k), CELL, body2, inner);
  function pick(n, bitNet, invNet, node, leaf) {
    const level = (i, v) => i < 0 ? leaf(v) : node(`pick/${i}`, [
      __spreadProps(__spreadValues({}, level(i - 1, v)), { visibleNet: invNet(i) }),
      __spreadProps(__spreadValues({}, level(i - 1, v | 1 << i)), { visibleNet: bitNet(i) })
    ]);
    return level(n - 1, 0);
  }
  var fillNode = (name, children) => frame(name, { layout: { dir: "H" }, sizeH: "FILL", sizeV: "FILL", children });
  function colourPick(bitNet, invNet, radius = 0, leaf) {
    return pick(
      4,
      bitNet,
      invNet,
      fillNode,
      leaf != null ? leaf : ((c) => rect(`swatch/${c}`, {
        fill: PALETTE_HEX[c],
        radius,
        sizeH: "FILL",
        sizeV: "FILL"
      }))
    );
  }
  function layerBox(k) {
    return __spreadProps(__spreadValues({}, placed(
      `layer/${k}`,
      k,
      __spreadProps(__spreadValues({}, colourPick(
        bits(STATE_NETS.fill(k)),
        (i) => bit(SCREEN_NETS.nfill, 4 * k + i),
        0,
        (c) => fillNode(`swatch/${c}`, [
          rect("rect", {
            fill: PALETTE_HEX[c],
            sizeH: "FILL",
            sizeV: "FILL",
            visibleNet: bit(SCREEN_NETS.nell, k)
          }),
          {
            type: "ellipse",
            name: "ellipse",
            fill: PALETTE_HEX[c],
            sizeH: "FILL",
            sizeV: "FILL",
            visibleNet: bit(SCREEN_NETS.ell, k)
          }
        ])
      )), {
        name: "body"
      }),
      { visibleNet: STATE_NETS.vis(k) }
    )), {
      visibleNet: STATE_NETS.used(k)
    });
  }
  var HANDLE = 12;
  function overlayBox(k) {
    const handle = (corner, code) => frame(`handle/${corner}`, {
      w: HANDLE,
      h: HANDLE,
      fill: COLOR.text,
      stroke: COLOR.accent,
      strokeWeight: 2,
      reactions: [{ trigger: { on: "down" }, run: `handle/${code}@${k}` }]
    });
    const handleRow = (a, b) => frame("handles", {
      sizeH: "FILL",
      h: HANDLE,
      layout: { dir: "H", main: "SPACE_BETWEEN" },
      children: [a, b]
    });
    return placed(
      `overlay/${k}`,
      k,
      frame("outline", {
        stroke: COLOR.accent,
        strokeWeight: 2,
        layout: { dir: "V", main: "SPACE_BETWEEN" },
        // corner codes: bit0 = west handle, bit1 = north handle
        children: [
          handleRow(handle("nw", 3), handle("ne", 2)),
          handleRow(handle("sw", 1), handle("se", 0))
        ]
      })
    );
  }
  function selection() {
    const level = (name, children) => frame(name, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, children });
    return __spreadProps(__spreadValues({}, pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, overlayBox)), {
      name: "selection",
      visibleNet: STATE_NETS.hassel
    });
  }
  function hotspotSet(i) {
    const grain = HOTSPOT_GRAIN[i];
    const gesture = HOTSPOT_GESTURE[i];
    const cellReactions = (r, c) => {
      const hover2 = hoverRun(i, r, c);
      const own = grain === "cell" ? clickRun(i, r, c) : null;
      const up2 = own && gesture === "up" ? own : i === PAINT_SET ? strokeRun(r, c) : `pointer/${c}`;
      const storing = (run) => run.startsWith("pointer/") ? {} : { pointer: c };
      const anchoring = i === PEN_UP_SET ? { anchor: { x: c, y: r } } : {};
      return [
        ...own && gesture === "down" ? [__spreadValues({ trigger: { on: "down" }, run: own }, anchoring)] : [],
        __spreadValues({ trigger: { on: "enter" }, run: hover2 }, storing(hover2)),
        // a per-row set's row takes its release itself
        ...grain !== "cell" && gesture === "up" ? [] : [__spreadValues({ trigger: { on: "up" }, run: up2 }, storing(up2))]
      ];
    };
    const rows = (sel) => Array.from(
      { length: GRID_H },
      (_, r) => frame(`row/${r}`, __spreadProps(__spreadValues({
        x: 0,
        y: r * CELL,
        w: CANVAS_W,
        h: CELL
      }, grain === "cell" ? {} : { reactions: [{ trigger: { on: gesture }, run: clickRun(i, r, 0, sel) }] }), {
        children: Array.from(
          { length: GRID_W },
          (_2, c) => frame(`cell/${c}`, {
            x: c * CELL,
            y: 0,
            w: CELL,
            h: CELL,
            reactions: cellReactions(r, c)
          })
        )
      }))
    );
    const level = (name, children) => frame(name, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, children });
    return frame(`hot/${HOT[i]}`, {
      x: 0,
      y: 0,
      w: CANVAS_W,
      h: CANVAS_H,
      visibleNet: bit(SCREEN_NETS.hot, i),
      children: grain === "row@sel" ? [__spreadProps(__spreadValues({}, pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, (k) => level(`sel/${k}`, rows(k)))), { name: "slots" })] : rows(0)
    });
  }
  var PEN_UP_SET = HOT.indexOf("pen-up");
  function inkLayer() {
    return frame("ink", {
      x: 0,
      y: 0,
      w: CANVAS_W,
      h: CANVAS_H,
      children: Array.from(
        { length: GRID_W * GRID_H },
        (_, i) => rect(`ink/${i}`, {
          x: i % GRID_W * CELL,
          y: Math.floor(i / GRID_W) * CELL,
          w: CELL,
          h: CELL,
          fill: COLOR.ink,
          visibleNet: bit(STATE_NETS.pix, i)
        })
      )
    });
  }
  function canvas() {
    const grid = [];
    for (let c = 1; c < GRID_W; c++)
      grid.push(
        rect(`grid/x${c}`, {
          x: c * CELL,
          y: 0,
          w: 1,
          h: CANVAS_H,
          fill: COLOR.grid
        })
      );
    for (let r = 1; r < GRID_H; r++)
      grid.push(
        rect(`grid/y${r}`, {
          x: 0,
          y: r * CELL,
          w: CANVAS_W,
          h: 1,
          fill: COLOR.grid
        })
      );
    return frame("canvas", {
      x: CANVAS_X,
      y: CANVAS_Y,
      w: CANVAS_W,
      h: CANVAS_H,
      fill: COLOR.canvas,
      stroke: COLOR.line,
      strokeWeight: 1,
      clip: true,
      children: [
        ...grid,
        ...Array.from({ length: LAYERS }, (_, k) => layerBox(k)),
        inkLayer(),
        ...HOT.map((_, i) => hotspotSet(i)),
        selection()
      ]
    });
  }
  var icon = (name, ic, x, y, size2 = 24, color = COLOR.text, p = {}) => __spreadValues({ type: "svg", name, svg: svgIcon(ic, size2, color), x, y, w: size2, h: size2 }, p);
  var rule = (name, x, y, w, h) => rect(name, { x, y, w, h, fill: COLOR.line });
  function rail() {
    const tab = (name, ic, text2, y, on = false, run) => {
      const parts = [
        ...on ? [rect(`${name}/on`, { x: 12, y, w: 32, h: 32, radius: 8, fill: COLOR.selected })] : [],
        icon(`${name}/icon`, ic, 18, y + 6, 20, on ? COLOR.text : COLOR.dim),
        label(`${name}/label`, text2, { x: 28 - text2.length * 2.6, y: y + 36, size: 10, color: on ? COLOR.text : COLOR.dim })
      ];
      if (!run) return parts;
      return [
        frame(`tab/${name}`, {
          x: 0,
          y,
          w: RAIL_W - 1,
          h: 52,
          reactions: [{ trigger: { on: "click" }, run }],
          children: parts.map((p) => {
            var _a;
            return __spreadProps(__spreadValues({}, p), { y: ((_a = p.y) != null ? _a : 0) - y });
          })
        })
      ];
    };
    return frame("rail", {
      x: 0,
      y: 0,
      w: RAIL_W,
      h: UI_H,
      fill: COLOR.panel,
      children: [
        icon("logo", "logo", 16, 12, 24, COLOR.text),
        rule("divider", 18, 48, 20, 1),
        ...tab("file", "file", "File", 60, true),
        ...tab("assets", "assets", "Assets", 116),
        ...tab("machine", "cpu", "Gates", 172, false, "go/machine"),
        rule("edge", RAIL_W - 1, 0, 1, UI_H)
      ]
    });
  }
  var ROW_H = 32;
  var ROWS_Y = 104;
  function layerRow(k, r) {
    const ICONS = ["rect", "frame", "rect", "ellipse"];
    const entry = (v) => frame(`name/${KIND_NAMES[v]}`, {
      layout: { dir: "H", gap: 8, cross: "CENTER" },
      sizeH: "HUG",
      sizeV: "HUG",
      children: [
        icon("icon", ICONS[v], 0, 0, 14, COLOR.dim),
        label("text", `${KIND_NAMES[v]} ${k + 1}`, {
          size: 11,
          color: COLOR.text,
          sizeH: "HUG",
          sizeV: "HUG"
        })
      ]
    });
    const hug = (name2, children) => frame(name2, { layout: { dir: "H" }, sizeH: "HUG", sizeV: "HUG", children });
    const name = __spreadProps(__spreadValues({}, pick(2, bits(STATE_NETS.kind(k)), (i) => bit(SCREEN_NETS.nkind, 2 * k + i), hug, entry)), {
      name: "name",
      x: 24,
      y: 9,
      sizeH: "HUG",
      sizeV: "HUG"
    });
    return frame(`row/${k}`, {
      x: 0,
      y: ROWS_Y + r * ROW_H,
      w: LEFT_W,
      h: ROW_H,
      visibleNet: STATE_NETS.used(k),
      reactions: [{ trigger: { on: "click" }, run: `select/${k}` }],
      children: [
        name,
        frame("eye-hit", {
          x: LEFT_W - 44,
          y: 0,
          w: 32,
          h: ROW_H,
          reactions: [{ trigger: { on: "click" }, run: `vis/${k}` }],
          // a hidden layer's eye stays, dimmed; a visible layer's lights over it
          children: [
            icon("eye-dim", "eyeOff", 8, 8, 16, COLOR.faint),
            frame("eye", {
              x: 8,
              y: 8,
              w: 16,
              h: 16,
              fill: COLOR.panel,
              visibleNet: STATE_NETS.vis(k),
              children: [icon("glyph", "eye", 0, 0, 16, COLOR.dim)]
            })
          ]
        })
      ]
    });
  }
  var KIND_NAMES = ["Layer", "Frame", "Rectangle", "Ellipse"];
  function leftPanel() {
    return frame("layers", {
      x: RAIL_W,
      y: 0,
      w: LEFT_W,
      h: UI_H,
      fill: COLOR.panel,
      children: [
        label("file", "Untitled", { x: 16, y: 15, size: 13, bold: true, color: COLOR.text }),
        icon("file-menu", "chevDown", 80, 18, 14, COLOR.dim),
        label("project", "Drafts", { x: 16, y: 40, size: 11, color: COLOR.dim }),
        icon("sidebar", "sidebar", LEFT_W - 36, 14, 20, COLOR.dim),
        rule("rule", 0, 64, LEFT_W, 1),
        label("title", "Layers", { x: 16, y: 78, size: 11, bold: true, color: COLOR.text }),
        // the selected row's highlight: rows are listed top = slot 7, so its row is ¬sel
        frame("highlight", {
          x: 8,
          y: ROWS_Y + 4,
          w: LEFT_W - 16,
          h: 24,
          layout: { dir: "V" },
          sizeH: "FIXED",
          sizeV: "HUG",
          visibleNet: STATE_NETS.hassel,
          children: [
            ...spacer("nsel/", "V", ROW_H, 3, bits(SCREEN_NETS.nsel)),
            rect("bar", { w: LEFT_W - 16, h: 24, radius: 5, fill: COLOR.selected })
          ]
        }),
        ...Array.from({ length: LAYERS }, (_, r) => layerRow(LAYERS - 1 - r, r)),
        rule("edge", LEFT_W - 1, 0, 1, UI_H)
      ]
    });
  }
  function rulers() {
    const top = [];
    const left = [];
    for (let c = 0; c <= GRID_W; c += 2) {
      const x = CANVAS_X - MID_X + c * CELL;
      top.push(rule(`tick/${c}`, x, RULER - 6, 1, 6));
      top.push(label(`n/${c}`, String(c), { x: x + 3, y: 3, size: 9, color: COLOR.faint }));
    }
    for (let r = 0; r <= GRID_H; r += 2) {
      const y = CANVAS_Y + r * CELL;
      left.push(rule(`tick/${r}`, RULER - 6, y, 6, 1));
      left.push(label(`n/${r}`, String(r), { x: 3, y: y + 3, size: 9, color: COLOR.faint }));
    }
    return [
      frame("ruler/top", {
        x: MID_X,
        y: 0,
        w: MID_W,
        h: RULER,
        fill: COLOR.panel,
        children: [...top, rule("edge", 0, RULER - 1, MID_W, 1)]
      }),
      frame("ruler/left", {
        x: MID_X,
        y: RULER,
        w: RULER,
        h: UI_H - RULER,
        fill: COLOR.panel,
        children: [...left.map((n) => {
          var _a;
          return __spreadProps(__spreadValues({}, n), { y: ((_a = n.y) != null ? _a : 0) - RULER });
        }), rule("edge", RULER - 1, 0, 1, UI_H - RULER)]
      }),
      label("canvas-name", "Canvas \xB7 14 \xD7 10", { x: CANVAS_X, y: CANVAS_Y - 20, size: 11, color: COLOR.dim })
    ];
  }
  function rightPanel() {
    const sw = 24;
    const pitch = 26;
    const swatch = (c, k) => frame(`sel/${k}`, {
      x: 0,
      y: 0,
      w: sw,
      h: sw,
      radius: 4,
      fill: PALETTE_HEX[c],
      stroke: COLOR.line,
      strokeWeight: 1,
      reactions: [{ trigger: { on: "click" }, run: `fill/${c}@${k}` }]
    });
    const level = (n, children) => frame(n, { x: 0, y: 0, w: sw, h: sw, children });
    const swatches = Array.from({ length: PALETTE_SIZE2 }, (_, c) => __spreadProps(__spreadValues({}, pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, (k) => swatch(c, k))), {
      name: `color/${c}`,
      x: 16 + c % 8 * pitch,
      y: 204 + Math.floor(c / 8) * pitch
    }));
    const section = (name, text2, y) => label(name, text2, { x: 16, y, size: 11, bold: true, color: COLOR.text });
    return frame("design", {
      x: UI_W - RIGHT_W,
      y: 0,
      w: RIGHT_W,
      h: UI_H,
      fill: COLOR.panel,
      children: [
        rule("edge", 0, 0, 1, UI_H),
        // the header: who is here, Present, and the way to the gates
        { type: "ellipse", name: "avatar", x: 16, y: 12, w: 24, h: 24, fill: "#0FA958" },
        label("avatar-initial", "N", { x: 24, y: 17, size: 11, bold: true, color: COLOR.text }),
        icon("account", "chevDown", 44, 18, 12, COLOR.dim),
        icon("present", "play", 120, 16, 16, COLOR.text),
        icon("present-menu", "chevDown", 138, 18, 12, COLOR.dim),
        frame("button/machine", {
          x: RIGHT_W - 8 - 76,
          y: 10,
          w: 76,
          h: 28,
          radius: 6,
          fill: COLOR.accent,
          reactions: [{ trigger: { on: "click" }, run: "go/machine" }],
          children: [label("label", "See gates", { x: 12, y: 7, size: 11, bold: true, color: COLOR.text })]
        }),
        frame("tab/design", {
          x: 8,
          y: 50,
          w: 56,
          h: 24,
          radius: 6,
          fill: COLOR.field,
          children: [label("label", "Design", { x: 9, y: 5, size: 11, bold: true, color: COLOR.text })]
        }),
        label("tab/prototype", "Prototype", { x: 74, y: 55, size: 11, color: COLOR.dim }),
        label("zoom", "100%", { x: RIGHT_W - 52, y: 55, size: 11, color: COLOR.dim }),
        icon("zoom-menu", "chevDown", RIGHT_W - 22, 56, 12, COLOR.dim),
        rule("rule/tabs", 0, 84, RIGHT_W, 1),
        section("fill", "Fill", 98),
        frame("fill-field", {
          x: 16,
          y: 122,
          w: RIGHT_W - 32,
          h: 28,
          radius: 5,
          fill: COLOR.field,
          children: [
            __spreadProps(__spreadValues({}, colourPick(bits(STATE_NETS.cur), bits(SCREEN_NETS.ncur), 3)), {
              name: "current",
              x: 6,
              y: 6,
              w: 16,
              h: 16,
              radius: 3,
              clip: true,
              sizeH: "FIXED",
              sizeV: "FIXED"
            }),
            __spreadProps(__spreadValues({}, colourPick(
              bits(STATE_NETS.cur),
              bits(SCREEN_NETS.ncur),
              0,
              (c) => label(`hex/${c}`, PALETTE_HEX[c].slice(1), { size: 11, color: COLOR.text, sizeH: "HUG", sizeV: "HUG" })
            )), {
              name: "hex",
              x: 32,
              y: 7,
              sizeH: "HUG",
              sizeV: "HUG"
            }),
            label("opacity", "100%", { x: RIGHT_W - 32 - 40, y: 7, size: 11, color: COLOR.dim })
          ]
        }),
        rule("rule/fill", 0, 164, RIGHT_W, 1),
        section("colours", "Colours", 176),
        ...swatches,
        label("colours-hint", "Fills the selection and the next shape.", {
          x: 16,
          y: 262,
          size: 11,
          color: COLOR.faint
        }),
        rule("rule/colours", 0, 288, RIGHT_W, 1),
        section("arrange", "Arrange", 300),
        ...arrangeButtons(),
        rule("rule/arrange", 0, 470, RIGHT_W, 1),
        section("shortcuts", "Shortcuts", 482),
        label(
          "keys",
          "V  move     F  frame     R  rectangle\nO  ellipse     P  pen     E  erase\nC  clear ink     D  duplicate     \u232B  delete\n[ ]  order     Arrows  nudge     Esc  cancel",
          { x: 16, y: 504, size: 11, color: COLOR.faint }
        ),
        label(
          "how",
          "Drag a layer to move it.\nDrag on the canvas to draw a shape.\nDrag a corner handle to resize.\nPen: press to start drawing, move\nthe mouse to ink, press to stop.",
          { x: 16, y: 584, size: 11, color: COLOR.dim }
        )
      ]
    });
  }
  function pushButton(name, text2, x, y, w, run) {
    return frame(`button/${name}`, {
      x,
      y,
      w,
      h: 28,
      radius: 5,
      fill: COLOR.field,
      reactions: [{ trigger: { on: "click" }, run }],
      children: [
        label("label", text2, {
          x: 10,
          y: 7,
          size: 11,
          color: COLOR.text
        })
      ]
    });
  }
  function slotButton(name, text2, x, y, w, run) {
    const level = (n, children) => frame(n, { x: 0, y: 0, w, h: 28, children });
    return __spreadProps(__spreadValues({}, pick(3, bits(STATE_NETS.sel), bits(SCREEN_NETS.nsel), level, (k) => __spreadProps(__spreadValues({}, pushButton(name, text2, 0, 0, w, `${run}@${k}`)), {
      name: `sel/${k}`
    }))), {
      name: `button/${name}`,
      x,
      y
    });
  }
  function arrangeButtons() {
    const big2 = [
      ["duplicate", "Duplicate", "dup", true],
      ["delete", "Delete", "delete", false],
      ["forward", "Bring forward", "fwd", true],
      ["backward", "Send backward", "back", true]
    ];
    const out = big2.map(
      ([n, t, run, perSlot], i) => (perSlot ? slotButton : pushButton)(
        n,
        t,
        16 + i % 2 * 107,
        324 + Math.floor(i / 2) * 36,
        103,
        run
      )
    );
    const arrows = [
      ["left", "\u2190", "nudge/0"],
      ["right", "\u2192", "nudge/1"],
      ["up", "\u2191", "nudge/2"],
      ["down", "\u2193", "nudge/3"]
    ];
    out.push(
      label("nudge", "Nudge one cell", {
        x: 16,
        y: 402,
        size: 11,
        color: COLOR.faint
      })
    );
    arrows.forEach(
      ([n, t, run], i) => out.push(slotButton(n, t, 16 + i * 53, 422, 49, run))
    );
    return out;
  }
  var TOOL = 40;
  var TOOL_PITCH = 44;
  var TOOLS_W = 4 + 5 * TOOL_PITCH;
  var OPTIONS_W = 4 + 2 * TOOL_PITCH;
  var BAR_X = MID_X + RULER + Math.round((MID_W - RULER - (TOOLS_W + 8 + OPTIONS_W)) / 2);
  function toolbar() {
    const tools = [
      { name: "Move", icon: "move" },
      { name: "Frame", icon: "frame" },
      { name: "Rectangle", icon: "rect" },
      { name: "Ellipse", icon: "ellipse" },
      { name: "Pen", icon: "pen" }
    ];
    return frame("toolbar", {
      x: BAR_X,
      y: BAR_Y,
      w: TOOLS_W,
      h: BAR_H,
      radius: 12,
      fill: COLOR.panel,
      stroke: COLOR.line,
      strokeWeight: 1,
      children: [
        frame("highlight", {
          x: 4,
          y: 4,
          layout: { dir: "H" },
          sizeH: "HUG",
          sizeV: "HUG",
          children: [
            ...spacer("t/", "H", TOOL_PITCH, TOOL_BITS, bits(STATE_NETS.tool)),
            rect("active", { w: TOOL, h: TOOL, radius: 8, fill: COLOR.accent })
          ]
        }),
        ...tools.map(
          (t, i) => frame(`tool/${t.name}`, {
            x: 4 + i * TOOL_PITCH,
            y: 4,
            w: TOOL,
            h: TOOL,
            radius: 8,
            reactions: [{ trigger: { on: "click" }, run: `tool/${i}` }],
            children: [icon("icon", t.icon, 8, 8, 24)]
          })
        )
      ]
    });
  }
  function penOptions() {
    const option = (name, ic, x, on) => frame(`button/${name}`, {
      x,
      y: 4,
      w: TOOL,
      h: TOOL,
      radius: 8,
      reactions: [{ trigger: { on: "click" }, run: name }],
      children: [...on ? [on] : [], icon("icon", ic, 8, 8, 24)]
    });
    return frame("pen", {
      x: BAR_X + TOOLS_W + 8,
      y: BAR_Y,
      w: OPTIONS_W,
      h: BAR_H,
      radius: 12,
      fill: COLOR.panel,
      stroke: COLOR.line,
      strokeWeight: 1,
      children: [
        option(
          "erase",
          "erase",
          4,
          rect("on", { x: 0, y: 0, w: TOOL, h: TOOL, radius: 8, fill: COLOR.accent, visibleNet: STATE_NETS.erase })
        ),
        option("clear", "trash", 4 + TOOL_PITCH)
      ]
    });
  }
  function drawingBanner() {
    return frame("drawing", {
      x: MID_X + RULER,
      y: 32,
      w: MID_W - RULER,
      h: 28,
      layout: { dir: "H", main: "CENTER", cross: "CENTER" },
      visibleNet: bit(SCREEN_NETS.hot, PAINT_SET),
      children: [
        frame("pill", {
          layout: { dir: "H", gap: 8, pad: 6, cross: "CENTER" },
          sizeH: "HUG",
          sizeV: "HUG",
          radius: 14,
          fill: COLOR.accent,
          children: [
            icon("icon", "pen", 0, 0, 16, COLOR.text),
            label("text", "Drawing \xB7 move the mouse to ink \xB7 click to stop", {
              size: 12,
              bold: true,
              color: COLOR.text,
              sizeH: "HUG",
              sizeV: "HUG"
            })
          ]
        })
      ]
    });
  }
  function status() {
    const hint = [
      "Drag a layer to move it \xB7 click empty canvas to deselect",
      "Drag on the canvas to draw it \xB7 a click makes one cell",
      "Release where it goes \xB7 Esc cancels",
      "Release at the opposite corner \xB7 Esc cancels",
      "Pen: drag to draw a straight line \xB7 click to draw freehand",
      "Drawing: move the mouse to ink \xB7 click to stop \xB7 E erases \xB7 C clears"
    ];
    return frame("status", {
      x: MID_X + RULER,
      y: BAR_Y - 30,
      w: MID_W - RULER,
      h: 20,
      layout: { dir: "H", main: "CENTER", cross: "CENTER" },
      children: hint.map(
        (t, i) => label(`hint/${HOT[i]}`, t, {
          size: 12,
          color: COLOR.dim,
          sizeH: "HUG",
          sizeV: "HUG",
          visibleNet: bit(SCREEN_NETS.hot, i)
        })
      )
    });
  }
  var KEYS = [
    { codes: [86], run: "tool/0" },
    { codes: [70], run: "tool/1" },
    { codes: [82], run: "tool/2" },
    { codes: [79], run: "tool/3" },
    { codes: [80], run: "tool/4" },
    { codes: [69], run: "erase" },
    { codes: [67], run: "clear" },
    // one key per reaction: Figma reads a keyCodes list as a chord (all held at once)
    { codes: [46], run: "delete" },
    { codes: [8], run: "delete" },
    { codes: [27], run: "esc" }
  ];
  var SLOT_KEYS = [
    { code: 68, run: "dup" },
    { code: 219, run: "back" },
    { code: 221, run: "fwd" },
    { code: 37, run: "nudge/0" },
    { code: 39, run: "nudge/1" },
    { code: 38, run: "nudge/2" },
    { code: 40, run: "nudge/3" }
  ];
  function slotKeys(fill) {
    const level = (name, children) => frame(name, { x: 0, y: 0, w: 8, h: 8, children });
    return __spreadProps(__spreadValues({}, pick(
      3,
      bits(STATE_NETS.sel),
      bits(SCREEN_NETS.nsel),
      level,
      (k) => frame(`keys/${k}`, {
        x: 0,
        y: 0,
        w: 8,
        h: 8,
        fill,
        reactions: SLOT_KEYS.map((s) => ({
          trigger: { on: "key", codes: [s.code] },
          run: `${s.run}@${k}`
        }))
      })
    )), {
      name: "shortcuts",
      x: 0,
      y: 0
    });
  }
  function uiSpec() {
    return frame("editor", {
      x: 0,
      y: 0,
      w: UI_W,
      h: UI_H,
      fill: COLOR.frame,
      clip: true,
      children: [
        canvas(),
        ...rulers(),
        rail(),
        leftPanel(),
        status(),
        drawingBanner(),
        toolbar(),
        penOptions(),
        rightPanel(),
        slotKeys(COLOR.panel)
      ]
    });
  }

  // nathan/src/platform/tests.ts
  var TEST_COLLECTION = "NATHAN tests";
  var TEST_PREFIX = "NATHAN test ";
  var W = 520;
  var H = 340;
  var id = (ctx, name) => ctx.v.get(name).id;
  function variableSpecs() {
    const specs = [];
    const counter = (n) => specs.push(
      { name: `${n}`, type: "FLOAT", init: 0 },
      { name: `${n}/text`, type: "STRING", init: "0" }
    );
    counter("t1/n");
    counter("t2/n");
    counter("t3/n");
    specs.push(
      { name: "t3/a", type: "BOOLEAN", init: true },
      { name: "t3/b", type: "BOOLEAN", init: true },
      { name: "t3/c", type: "BOOLEAN", init: false }
    );
    specs.push(
      { name: "t4/cx", type: "FLOAT", init: -1 },
      { name: "t4/cy", type: "FLOAT", init: -1 },
      { name: "t4/text", type: "STRING", init: "pointer: \u2013" }
    );
    counter("t5/parent");
    counter("t5/control");
    counter("t6/n");
    specs.push(
      { name: "t7/sel", type: "BOOLEAN", init: true },
      { name: "t7/notsel", type: "BOOLEAN", init: false }
    );
    counter("t7/a");
    counter("t7/b");
    for (let i = 0; i < 4; i++)
      specs.push({ name: `t8/b${i}`, type: "BOOLEAN", init: false });
    for (const k of ["a", "delete", "left", "bracket"]) counter(`t9/${k}`);
    specs.push({ name: "t10/seq", type: "STRING", init: "" });
    for (const r of PLACE_REGS)
      for (let i = 0; i < 4; i++)
        specs.push({ name: `t11/${r}/${i}`, type: "BOOLEAN", init: r === "nf" });
    for (const c of PLACE_CASES)
      specs.push({ name: `t11/case/${c.name}`, type: "BOOLEAN", init: false });
    for (const k of KEY_LAYERS) counter(`t12/${k.name}`);
    specs.push({ name: "t12/off", type: "BOOLEAN", init: false });
    for (let i = 0; i < 3; i++)
      specs.push(
        { name: `t13/b${i}`, type: "BOOLEAN", init: false },
        { name: `t13/n${i}`, type: "BOOLEAN", init: true }
      );
    specs.push({ name: "t13/which", type: "STRING", init: "\u2013" });
    return specs;
  }
  var bindText = (t, v) => t.setBoundVariable("characters", v);
  var num2 = (ctx, f, name, x, y, size2 = 28) => {
    const t = put(
      f,
      text(ctx.api, "0", {
        size: size2,
        bold: true,
        color: COLORS.amber,
        name: `value/${name}`
      }),
      x,
      y
    );
    bindText(t, ctx.v.get(`${name}/text`));
    return t;
  };
  function testFrame(ctx, n, title, how, pass) {
    const f = box(ctx.api, `${TEST_PREFIX}${n} \xB7 ${title}`, W, H, COLORS.bg, 12);
    f.clipsContent = true;
    const col = (n - 1) % 3;
    const row = Math.floor((n - 1) / 3);
    put(ctx.page, f, ctx.at.x + col * (W + 60), ctx.at.y + row * (H + 60));
    put(f, text(ctx.api, `${n} \xB7 ${title}`, { size: 18, bold: true }), 20, 16);
    put(
      f,
      text(ctx.api, how, { size: 12, color: COLORS.dim, name: "how" }),
      20,
      46
    );
    put(
      f,
      text(ctx.api, `PASS: ${pass}`, {
        size: 12,
        bold: true,
        color: COLORS.lampOn,
        name: "pass"
      }),
      20,
      H - 34
    );
    ctx.frames.push(f);
    ctx.info.push({
      id: String(n),
      title: `${n} \xB7 ${title}`,
      how: `${how} PASS: ${pass}`
    });
    return f;
  }
  var react = (node, trigger, actions) => node.setReactionsAsync([{ trigger, actions }]);
  var bump = (ctx, name) => [
    increment(id(ctx, name)),
    concatText(id(ctx, `${name}/text`), id(ctx, name))
  ];
  async function size(ctx) {
    const f = testFrame(
      ctx,
      1,
      "actions per click",
      "Click each button once, smallest first. The number must grow by the button's N. Note the largest N that works and the first that fails (a crash, or nothing).",
      "the number grows by N, with no error"
    );
    num2(ctx, f, "t1/n", 400, 16);
    const ladder = [100, 300, 500, 800, 1100, 1500, 2e3];
    for (let i = 0; i < ladder.length; i++) {
      const b = put(
        f,
        button(ctx.api, `${ladder[i]}`, COLORS.step, 112, 40),
        20 + i % 4 * 124,
        100 + Math.floor(i / 4) * 56
      );
      const acts = [];
      for (let k = 0; k < ladder[i] - 1; k++)
        acts.push(increment(id(ctx, "t1/n")));
      acts.push(concatText(id(ctx, "t1/n/text"), id(ctx, "t1/n")));
      await react(b, onClick(), acts);
    }
    const reset = put(
      f,
      button(ctx.api, "reset", COLORS.reset, 112, 36),
      20,
      250
    );
    await react(reset, onClick(), [
      setVariable(id(ctx, "t1/n"), floatData(0)),
      setVariable(id(ctx, "t1/n/text"), strData("0"))
    ]);
  }
  async function big(ctx) {
    const f = testFrame(
      ctx,
      2,
      "a big reaction that mostly does not run",
      "Click each button once. Each reaction is that many actions long, but all except one sit behind an `if` that is false.",
      "the number grows by 1 per click and the file stays responsive"
    );
    num2(ctx, f, "t2/n", 400, 16);
    const sizes = [2e3, 1e4, 3e4];
    for (let i = 0; i < sizes.length; i++) {
      const b = put(
        f,
        button(ctx.api, `${sizes[i]}`, COLORS.run, 112, 40),
        20 + i * 124,
        100
      );
      const skipped = [];
      for (let k = 0; k < sizes[i]; k++) skipped.push(increment(id(ctx, "t2/n")));
      await react(b, onClick(), [
        ...bump(ctx, "t2/n"),
        conditional(boolData(false), skipped)
      ]);
    }
  }
  async function nesting(ctx) {
    const f = testFrame(
      ctx,
      3,
      "if inside if, and else-if",
      "Click each button. The number grows by 1 when the reaction ran its innermost action. (The editor cannot author these; the plugin can, but does the viewer run them?)",
      "all four buttons add 1"
    );
    num2(ctx, f, "t3/n", 400, 16);
    const yes = (name) => exprData("EQUALS", [aliasData(id(ctx, name)), boolData(true)]);
    const cases = [
      ["if", [conditional(yes("t3/a"), bump(ctx, "t3/n"))]],
      [
        "if in if",
        [conditional(yes("t3/a"), [conditional(yes("t3/b"), bump(ctx, "t3/n"))])]
      ],
      [
        "3 deep",
        [
          conditional(yes("t3/a"), [
            conditional(yes("t3/b"), [
              conditional(yes("t3/a"), bump(ctx, "t3/n"))
            ])
          ])
        ]
      ],
      [
        "else-if",
        [
          {
            type: "CONDITIONAL",
            conditionalBlocks: [
              { condition: yes("t3/c"), actions: [] },
              { condition: yes("t3/b"), actions: bump(ctx, "t3/n") },
              { actions: [] }
            ]
          }
        ]
      ]
    ];
    for (let i = 0; i < cases.length; i++) {
      const b = put(
        f,
        button(ctx.api, cases[i][0], COLORS.step, 112, 40),
        20 + i % 4 * 124,
        110
      );
      try {
        await react(b, onClick(), cases[i][1]);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        put(f, text(ctx.api, `refused by Figma:
${why.slice(0, 60)}`, { size: 10, color: COLORS.stop, name: "refused" }), 20 + i % 4 * 124, 156);
      }
    }
  }
  async function hover(ctx) {
    const f = testFrame(
      ctx,
      4,
      "hover stores the cell",
      "Move the pointer over the grid.",
      "the text follows the pointer and shows the cell under it"
    );
    const t = put(
      f,
      text(ctx.api, "pointer: \u2013", {
        size: 22,
        bold: true,
        color: COLORS.amber,
        name: "value"
      }),
      300,
      100
    );
    bindText(t, ctx.v.get("t4/text"));
    const n = 5;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const cell = put(
          f,
          box(
            ctx.api,
            `cell/${c},${r}`,
            44,
            44,
            (c + r) % 2 ? COLORS.panel : COLORS.lampOff,
            4
          ),
          20 + c * 48,
          80 + r * 48
        );
        await react(cell, mouseEnter(0), [
          setVariable(id(ctx, "t4/cx"), floatData(c)),
          setVariable(id(ctx, "t4/cy"), floatData(r)),
          setVariable(id(ctx, "t4/text"), strData(`pointer: ${c}, ${r}`))
        ]);
      }
  }
  async function bubbling(ctx) {
    const f = testFrame(
      ctx,
      5,
      "a click on a child reaches the parent",
      "Click the cells of the left grid (their only reaction is a hover). Then click the cells of the right grid (no reaction at all).",
      "BOTH numbers grow with every click (the click reached the parent frame)"
    );
    num2(ctx, f, "t5/parent", 340, 16, 24);
    num2(ctx, f, "t5/control", 440, 16, 24);
    const makeGrid = async (name, x, withHover, counter) => {
      const parent = put(
        f,
        box(ctx.api, name, 150, 150, COLORS.panel, 6),
        x,
        100
      );
      parent.clipsContent = true;
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) {
          const cell = put(
            parent,
            box(ctx.api, `cell/${c},${r}`, 44, 44, COLORS.lampOff, 4),
            2 + c * 48,
            2 + r * 48
          );
          if (withHover)
            await react(cell, mouseEnter(0), [
              setVariable(id(ctx, "t4/cx"), floatData(c))
            ]);
        }
      await react(parent, onClick(), bump(ctx, counter));
    };
    await makeGrid("grid-with-hover-children", 20, true, "t5/parent");
    await makeGrid("grid-plain-children", 200, false, "t5/control");
  }
  async function passThrough(ctx) {
    const f = testFrame(
      ctx,
      6,
      "click through a layer with no reactions",
      "Click the blue button, and the part of it that a see-through overlay covers.",
      "the number grows for clicks on the covered part too"
    );
    num2(ctx, f, "t6/n", 400, 16);
    const b = put(
      f,
      button(ctx.api, "button (click me)", COLORS.step, 240, 120),
      40,
      100
    );
    await react(b, onClick(), bump(ctx, "t6/n"));
    const overlay = put(
      f,
      box(ctx.api, "overlay (no reactions)", 160, 120, COLORS.panel, 0),
      40,
      100
    );
    overlay.fills = [];
    overlay.strokes = [{ type: "SOLID", color: { r: 1, g: 0.7, b: 0 } }];
    overlay.strokeWeight = 2;
    put(
      f,
      text(ctx.api, "orange outline = the covering overlay", {
        size: 11,
        color: COLORS.dim
      }),
      40,
      228
    );
  }
  async function switching(ctx) {
    const f = testFrame(
      ctx,
      7,
      "only the visible click layer takes the click",
      "Click the square again and again, always on the same spot. It changes colour each time.",
      "the two numbers alternate: 1,0 then 1,1 then 2,1 \u2026"
    );
    num2(ctx, f, "t7/a", 340, 16, 24);
    num2(ctx, f, "t7/b", 440, 16, 24);
    const a = put(
      f,
      box(ctx.api, "A (visible while sel)", 160, 160, "#2f6fed", 8),
      60,
      100
    );
    const b = put(
      f,
      box(ctx.api, "B (visible while not sel)", 160, 160, "#1f9d55", 8),
      60,
      100
    );
    a.setBoundVariable("visible", ctx.v.get("t7/sel"));
    b.setBoundVariable("visible", ctx.v.get("t7/notsel"));
    await react(a, onClick(), [
      ...bump(ctx, "t7/a"),
      setVariable(id(ctx, "t7/sel"), boolData(false)),
      setVariable(id(ctx, "t7/notsel"), boolData(true))
    ]);
    await react(b, onClick(), [
      ...bump(ctx, "t7/b"),
      setVariable(id(ctx, "t7/sel"), boolData(true)),
      setVariable(id(ctx, "t7/notsel"), boolData(false))
    ]);
  }
  async function spacers(ctx) {
    const f = testFrame(
      ctx,
      8,
      "hidden frames take no room",
      "Toggle the four bits. The orange bar must start at 20 px \xD7 (value of the bits: b0=1 b1=2 b2=4 b3=8). The dark bar is the scale, 20 px per step.",
      "the bar slides when you toggle, as the bits' value \xD7 20 px"
    );
    const scale = put(
      f,
      box(ctx.api, "scale", 16 * 20, 6, COLORS.lampOff, 0),
      40,
      150
    );
    scale.name = "scale (0 \u2026 15 steps of 20 px)";
    const row = ctx.api.createFrame();
    row.name = "row";
    row.fills = [];
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = 0;
    row.paddingLeft = row.paddingRight = row.paddingTop = row.paddingBottom = 0;
    put(f, row, 40, 110);
    row.resize(340, 30);
    row.layoutSizingHorizontal = "FIXED";
    row.layoutSizingVertical = "FIXED";
    for (let i = 0; i < 4; i++) {
      const seg = ctx.api.createFrame();
      seg.name = `seg${i}`;
      seg.fills = [];
      seg.resize(20 << i, 30);
      row.appendChild(seg);
      seg.layoutSizingHorizontal = "FIXED";
      seg.layoutSizingVertical = "FIXED";
      seg.setBoundVariable("visible", ctx.v.get(`t8/b${i}`));
    }
    const bar = ctx.api.createRectangle();
    bar.name = "bar";
    bar.fills = [{ type: "SOLID", color: { r: 1, g: 0.65, b: 0 } }];
    bar.resize(60, 30);
    row.appendChild(bar);
    bar.layoutSizingHorizontal = "FIXED";
    bar.layoutSizingVertical = "FIXED";
    for (let i = 0; i < 4; i++) {
      const b = put(
        f,
        button(ctx.api, `b${i} = ${1 << i}`, COLORS.step, 100, 40),
        40 + i * 110,
        200
      );
      await react(b, onClick(), [
        setVariable(
          id(ctx, `t8/b${i}`),
          exprData("NOT", [aliasData(id(ctx, `t8/b${i}`))])
        )
      ]);
    }
  }
  async function keys(ctx) {
    const f = testFrame(
      ctx,
      9,
      "keyboard shortcuts",
      "Click once inside the frame so it has focus, then press: A, Delete, \u2190 (left arrow), ] (right bracket).",
      "each key adds 1 to its own number"
    );
    const table = [
      ["A", [[65]], "t9/a"],
      ["Delete or Backspace", [[46], [8]], "t9/delete"],
      ["\u2190", [[37]], "t9/left"],
      ["]", [[221]], "t9/bracket"]
    ];
    const reactions = [];
    table.forEach(([label2, keys2, name], i) => {
      put(
        f,
        text(ctx.api, label2, { size: 13, color: COLORS.dim }),
        40,
        100 + i * 44
      );
      num2(ctx, f, name, 240, 92 + i * 44, 24);
      for (const codes of keys2)
        reactions.push({ trigger: keyDown(codes), actions: bump(ctx, name) });
    });
    await f.setReactionsAsync(reactions);
  }
  async function triple(ctx) {
    const f = testFrame(
      ctx,
      10,
      "one click is two events",
      "Click each button a few times.",
      "button 1 appends D U for every click (button 2 shows whether C also fires)"
    );
    const t = put(f, text(ctx.api, "", { size: 22, bold: true, color: COLORS.amber, name: "value" }), 20, 160);
    t.setBoundVariable("characters", ctx.v.get("t10/seq"));
    const add = (letter) => [
      setVariable(
        id(ctx, "t10/seq"),
        exprData("ADDITION", [aliasData(id(ctx, "t10/seq"), "STRING"), strData(letter)], "STRING")
      )
    ];
    const one = put(f, button(ctx.api, "1: down + up", COLORS.step, 160, 44), 20, 100);
    await one.setReactionsAsync([
      { trigger: mouseDown(0), actions: add("D") },
      { trigger: mouseUp(0), actions: add("U ") }
    ]);
    const two = put(f, button(ctx.api, "2: down + up + click", COLORS.run, 200, 44), 200, 100);
    await two.setReactionsAsync([
      { trigger: mouseDown(0), actions: add("d") },
      { trigger: mouseUp(0), actions: add("u") },
      { trigger: onClick(), actions: add("c") }
    ]);
  }
  var PLACE_REGS = ["x0", "x1", "y0", "y1", "f", "nf"];
  var PLACE_CASES = [
    { name: "A", x0: 1, x1: 5, y0: 1, y1: 4, f: 8, colour: "red" },
    { name: "B", x0: 3, x1: 11, y0: 5, y1: 7, f: 10, colour: "yellow" },
    { name: "C", x0: 0, x1: 14, y0: 0, y1: 10, f: 3, colour: "green" }
  ];
  async function placement(ctx) {
    const f = testFrame(
      ctx,
      11,
      "a rectangle from register bits",
      "Click case A, B and C. Each sets 24 bits; the layout alone draws the rectangle.",
      "the coloured rectangle exactly fills the dashed outline, in the colour named"
    );
    const U = 20;
    const grid = put(f, box(ctx.api, "grid", 14 * U, 10 * U, COLORS.lampOff, 0), 20, 96);
    grid.clipsContent = false;
    const net = (r) => (i) => `t11/${r}/${i}`;
    await render(
      { api: ctx.api, variable: (n) => ctx.v.get(n), reactionsFor: () => [] },
      grid,
      placedBy("rect", { x0: net("x0"), x1: net("x1"), y0: net("y0"), y1: net("y1") }, U, __spreadProps(__spreadValues({}, colourPick(net("f"), net("nf"))), {
        name: "body"
      }))
    );
    for (const c of PLACE_CASES) {
      const show = ctx.v.get(`t11/case/${c.name}`);
      const outline = put(grid, box(ctx.api, `expect ${c.name}`, (c.x1 - c.x0) * U, (c.y1 - c.y0) * U, COLORS.bg, 0), c.x0 * U, c.y0 * U);
      outline.fills = [];
      outline.strokes = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      outline.strokeWeight = 2;
      outline.dashPattern = [6, 4];
      outline.setBoundVariable("visible", show);
      const note = put(f, text(ctx.api, `${c.name}: ${c.colour} (${PALETTE_HEX[c.f]})`, { size: 12, bold: true, name: `colour ${c.name}` }), 320, 150);
      note.setBoundVariable("visible", show);
    }
    for (let n = 0; n < PLACE_CASES.length; n++) {
      const c = PLACE_CASES[n];
      const value = { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, f: c.f, nf: ~c.f };
      const b = put(f, button(ctx.api, `case ${c.name}`, COLORS.step, 60, 36), 320 + n * 64, 96);
      await react(b, onClick(), [
        ...PLACE_REGS.flatMap(
          (r) => [0, 1, 2, 3].map((i) => setVariable(id(ctx, `t11/${r}/${i}`), boolData((value[r] >> i & 1) === 1)))
        ),
        ...PLACE_CASES.map((o) => setVariable(id(ctx, `t11/case/${o.name}`), boolData(o === c)))
      ]);
    }
  }
  var KEY_LAYERS = [
    { name: "frame", label: "the frame itself" },
    { name: "shown", label: "a layer in it" },
    { name: "deep", label: "a layer 3 frames deep" },
    { name: "hidden", label: "a hidden layer (bound to false)" },
    { name: "inside", label: "a shown layer in a hidden frame" },
    { name: "only", label: "J: only on the shown layer" }
  ];
  async function keyLayers(ctx) {
    const f = testFrame(
      ctx,
      12,
      "keys on layers inside the frame",
      "Click once on the frame's background for focus (not on a box), then press K once, then J once. Each number counts its own reaction.",
      "write down which numbers grew: K on the frame, shown, deep, hidden, inside; J"
    );
    KEY_LAYERS.forEach((k, i) => {
      put(f, text(ctx.api, k.label, { size: 12, color: COLORS.dim }), 40, 96 + i * 30);
      num2(ctx, f, `t12/${k.name}`, 300, 90 + i * 30, 20);
    });
    const K = 75;
    const J = 74;
    const at = (parent, name, x) => put(parent, box(ctx.api, name, 28, 28, COLORS.panel, 4), x, 0);
    const tray = put(f, box(ctx.api, "tray", 200, 28, COLORS.bg, 0), 300, H - 76);
    const shown = at(tray, "shown", 0);
    const deep1 = at(tray, "deep 1", 36);
    const deep2 = put(deep1, box(ctx.api, "deep 2", 28, 28, COLORS.panel, 4), 0, 0);
    const deep = put(deep2, box(ctx.api, "deep", 28, 28, COLORS.lampOff, 4), 0, 0);
    const hidden = at(tray, "hidden", 72);
    hidden.setBoundVariable("visible", ctx.v.get("t12/off"));
    const hider = at(tray, "hidden frame", 108);
    hider.setBoundVariable("visible", ctx.v.get("t12/off"));
    const inside = put(hider, box(ctx.api, "inside", 28, 28, COLORS.lampOff, 4), 0, 0);
    await f.setReactionsAsync([{ trigger: keyDown([K]), actions: bump(ctx, "t12/frame") }]);
    await shown.setReactionsAsync([
      { trigger: keyDown([K]), actions: bump(ctx, "t12/shown") },
      { trigger: keyDown([J]), actions: bump(ctx, "t12/only") }
    ]);
    await react(deep, keyDown([K]), bump(ctx, "t12/deep"));
    await react(hidden, keyDown([K]), bump(ctx, "t12/hidden"));
    await react(inside, keyDown([K]), bump(ctx, "t12/inside"));
  }
  async function keyPick(ctx) {
    const f = testFrame(
      ctx,
      13,
      "a shortcut picked by 3 bits",
      "Click the frame's background, press P: the big number says which of 8 stacked layers took it. Toggle bits with the buttons (the square shows the layer that is up) and press P again, a few times.",
      "after every P the number equals the number in the square"
    );
    const t = put(f, text(ctx.api, "\u2013", { size: 40, bold: true, color: COLORS.amber, name: "which" }), 400, 90);
    t.setBoundVariable("characters", ctx.v.get("t13/which"));
    put(f, text(ctx.api, "P went to:", { size: 13, color: COLORS.dim }), 300, 108);
    const level = (name, children) => ({
      type: "frame",
      name,
      x: 0,
      y: 0,
      w: 72,
      h: 72,
      children
    });
    const leaf = (k) => ({
      type: "frame",
      name: `leaf/${k}`,
      x: 0,
      y: 0,
      w: 72,
      h: 72,
      fill: "#2f6fed",
      radius: 6,
      reactions: [{ trigger: { on: "key", codes: [80] }, run: `t13/${k}` }],
      children: [{ type: "text", name: "n", x: 26, y: 18, text: { chars: String(k), size: 28, bold: true, color: "#ffffff" } }]
    });
    const holder = put(f, box(ctx.api, "stack", 72, 72, COLORS.bg, 0), 40, 100);
    await render(
      {
        api: ctx.api,
        variable: (n) => ctx.v.get(n),
        reactionsFor: (ref2) => [
          {
            trigger: keyDown([80]),
            actions: [setVariable(id(ctx, "t13/which"), strData(ref2.run.slice("t13/".length)))]
          }
        ]
      },
      holder,
      pick(3, (i) => `t13/b${i}`, (i) => `t13/n${i}`, level, leaf)
    );
    for (let i = 0; i < 3; i++) {
      const b = put(f, button(ctx.api, `bit ${i} (${1 << i})`, COLORS.step, 100, 36), 40 + i * 110, 200);
      await react(b, onClick(), [
        setVariable(id(ctx, `t13/b${i}`), exprData("NOT", [aliasData(id(ctx, `t13/b${i}`))])),
        setVariable(id(ctx, `t13/n${i}`), exprData("NOT", [aliasData(id(ctx, `t13/n${i}`))]))
      ]);
    }
  }
  async function buildPlatformTests(api, page, log = () => {
  }) {
    await loadFonts2(api);
    await page.loadAsync();
    await removeCollections(api, TEST_COLLECTION);
    for (const n of [...page.children])
      if (n.name.startsWith(TEST_PREFIX)) n.remove();
    const specs = variableSpecs();
    const { vars } = await createVariables(api, TEST_COLLECTION, specs, { log });
    const v = new Map(specs.map((s, i) => [s.name, vars[i]]));
    let bottom = 0;
    for (const n of page.children) bottom = Math.max(bottom, n.y + n.height);
    const ctx = {
      api,
      page,
      v,
      frames: [],
      info: [],
      at: { x: 0, y: bottom + 1200 }
    };
    for (const t of [size, big, nesting, hover, bubbling, passThrough, switching, spacers, keys, triple, placement, keyLayers, keyPick])
      try {
        await t(ctx);
      } catch (e) {
        log(`platform test ${t.name} could not be built: ${e instanceof Error ? e.message : e}`);
      }
    setFlows(
      page,
      ctx.frames.map((fr) => ({ nodeId: fr.id, name: fr.name }))
    );
    log(
      `built ${ctx.frames.length} platform tests below everything on "${page.name}"`
    );
    return { frames: ctx.frames, tests: ctx.info };
  }

  // nathan/src/ui/gatemap.ts
  var ORDER = [
    "evdec",
    "conds",
    "hit",
    "free",
    "plane",
    "geom",
    "layerctl",
    "newrec",
    "pen",
    "paint",
    "l0",
    "l1",
    "l2",
    "l3",
    "l4",
    "l5",
    "l6",
    "l7",
    "state",
    "disp"
  ];
  var GLUE = "glue";
  var TITLE_H2 = 18;
  var PAD2 = 6;
  var BLOCK_GAP = 10;
  function gateMap(net, o) {
    var _a, _b;
    const groups = /* @__PURE__ */ new Map();
    net.gates.forEach((g, i) => {
      const top = g.path.includes("/") ? g.path.split("/")[0] : GLUE;
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top).push(i);
    });
    const rank = (n) => n === GLUE ? ORDER.length + 1 : ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length;
    const names = [...groups.keys()].sort(
      (a, b) => rank(a) - rank(b) || a.localeCompare(b)
    );
    const colW = (o.width - (o.columns - 1) * BLOCK_GAP) / o.columns;
    const pitch = o.lamp + o.gap;
    const perRow = Math.max(1, Math.floor((colW - 2 * PAD2 + o.gap) / pitch));
    const heights = new Array(o.columns).fill(0);
    const blocks = [];
    for (const name of names) {
      const gates = groups.get(name).sort(
        (a, b) => net.gates[a].path.localeCompare(net.gates[b].path, void 0, {
          numeric: true
        })
      );
      const rows = Math.ceil(gates.length / perRow);
      const h = TITLE_H2 + rows * pitch - o.gap + PAD2;
      const col = heights.indexOf(Math.min(...heights));
      blocks.push({
        type: "frame",
        name: `block/${name}`,
        x: col * (colW + BLOCK_GAP),
        y: heights[col],
        w: colW,
        h,
        fill: o.colours.block,
        radius: 4,
        children: [
          {
            type: "text",
            name: "title",
            x: PAD2,
            y: 3,
            text: {
              chars: (_b = (_a = o.title) == null ? void 0 : _a.call(o, name, gates.length)) != null ? _b : `${name} \xB7 ${gates.length}`,
              size: 10,
              bold: true,
              color: o.colours.text
            }
          },
          // every gate is a dark square; its lamp lights over it while its output is 1
          ...gates.flatMap((gi, k) => {
            var _a2, _b2;
            const x = PAD2 + k % perRow * pitch;
            const y = TITLE_H2 + Math.floor(k / perRow) * pitch;
            const square2 = {
              type: "rect",
              x,
              y,
              w: o.lamp,
              h: o.lamp,
              radius: 1
            };
            return [
              __spreadProps(__spreadValues({}, square2), { name: "off", fill: o.colours.off }),
              __spreadProps(__spreadValues({}, square2), {
                name: `gate/${net.gates[gi].path}`,
                fill: o.colours.lamp,
                visibleNet: (_b2 = (_a2 = o.netOf) == null ? void 0 : _a2.call(o, gi)) != null ? _b2 : net.netNames[net.gates[gi].out]
              })
            ];
          })
        ]
      });
      heights[col] += h + BLOCK_GAP;
    }
    return {
      type: "frame",
      name: "gate map",
      x: 0,
      y: 0,
      w: o.width,
      h: Math.max(...heights) - BLOCK_GAP,
      children: blocks
    };
  }

  // nathan/plugin/src/names.ts
  var PAGE_NAME = "CPU NATHAN";
  var PRESENT = "NATHAN \xB7 Figma OS";
  var MACHINE = "NATHAN \xB7 the machine";
  var CIRCUIT = "NATHAN \xB7 the circuit";
  var FLOW = "CPU NATHAN";
  var COLLECTION = "NATHAN";
  var UI_COLLECTION = "NATHAN \xB7 UI";
  var TOP = "ENGINE";

  // nathan/src/model/oracle.ts
  var ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  function applyRef(s, ev) {
    const idOf = (slot) => {
      var _a, _b;
      return (_b = (_a = s.layers[slot]) == null ? void 0 : _a.id) != null ? _b : -1;
    };
    switch (ev.k) {
      case "tool":
        return reduce(s, { t: "tool", tool: TOOLS[ev.t] });
      case "fill":
        return reduce(s, { t: "fill", color: ev.c });
      case "down":
        return reduce(s, { t: "down", x: ev.x, y: ev.y });
      case "move":
        return reduce(s, { t: "move", x: ev.x, y: ev.y });
      case "up":
        return reduce(s, { t: "up" });
      case "select":
        return reduce(s, { t: "select", id: idOf(ev.slot) });
      case "handle":
        return reduce(s, {
          t: "down",
          x: 0,
          y: 0,
          handle: `${ev.corner & 2 ? "n" : "s"}${ev.corner & 1 ? "w" : "e"}`
        });
      case "vis":
        return reduce(s, { t: "visible", id: idOf(ev.slot) });
      case "delete":
        return reduce(s, { t: "key", key: "Delete" });
      case "dup":
        return reduce(s, { t: "key", key: "d", meta: true });
      case "fwd":
        return reduce(s, { t: "key", key: "]" });
      case "back":
        return reduce(s, { t: "key", key: "[" });
      case "nudge":
        return reduce(s, { t: "key", key: ARROWS[ev.dir] });
      case "esc":
        return reduce(s, { t: "key", key: "Escape" });
      case "click":
        return click(s, ev.x, ev.y);
      case "paint":
        return reduce(s, { t: "paint", x: ev.x, y: ev.y });
      case "erase":
        return reduce(s, { t: "erase" });
      case "clear":
        return reduce(s, { t: "clear" });
    }
  }
  var DRAGS = [null, "move", "create", "resize"];
  function compare(ref2, p) {
    var _a, _b;
    const n = ref2.layers.length;
    for (let k = 0; k < LAYERS; k++) {
      const used = p.peek(STATE_NETS.used(k));
      if (used !== (k < n ? 1 : 0))
        return `layer ${k}: used=${used}, the spec has ${n} layer(s)`;
    }
    for (let k = 0; k < n; k++) {
      const l = ref2.layers[k];
      const got = [
        p.peek(STATE_NETS.x0(k), 4),
        p.peek(STATE_NETS.x1(k), 4),
        p.peek(STATE_NETS.y0(k), 4),
        p.peek(STATE_NETS.y1(k), 4),
        p.peek(STATE_NETS.fill(k), 4),
        p.peek(STATE_NETS.kind(k), 2),
        p.peek(STATE_NETS.vis(k))
      ];
      const want = [
        l.x,
        l.x + l.w,
        l.y,
        l.y + l.h,
        l.fill,
        KINDS.indexOf(l.kind) + 1,
        l.visible ? 1 : 0
      ];
      if (got.join() !== want.join())
        return `layer ${k} (x0 x1 y0 y1 fill kind vis): machine ${got.join(" ")}, spec ${want.join(" ")}`;
    }
    const selWant = ref2.selected === null ? -1 : ref2.layers.findIndex((l) => l.id === ref2.selected);
    const selGot = p.peek(STATE_NETS.hassel) ? p.peek(STATE_NETS.sel, 3) : -1;
    if (selGot !== selWant)
      return `selection: machine ${selGot}, spec ${selWant}`;
    if (p.peek(STATE_NETS.tool, TOOL_BITS) !== TOOLS.indexOf(ref2.tool))
      return `tool: machine ${p.peek(STATE_NETS.tool, TOOL_BITS)}, spec ${ref2.tool}`;
    if (p.peek(STATE_NETS.cur, 4) !== ref2.fill)
      return `current colour: machine ${p.peek(STATE_NETS.cur, 4)}, spec ${ref2.fill}`;
    const dm = (_b = (_a = ref2.drag) == null ? void 0 : _a.mode) != null ? _b : null;
    const dg2 = DRAGS[p.peek(STATE_NETS.drag, 2)];
    if (dg2 !== dm) return `pending drag: machine ${dg2}, spec ${dm}`;
    if (p.peek(STATE_NETS.pendown) !== +ref2.penDown)
      return `pen down: machine ${p.peek(STATE_NETS.pendown)}, spec ${ref2.penDown}`;
    if (p.peek(STATE_NETS.erase) !== +ref2.erase)
      return `erase: machine ${p.peek(STATE_NETS.erase)}, spec ${ref2.erase}`;
    for (let i = 0; i < ref2.ink.length; i++) {
      const got = p.peek(`${STATE_NETS.pix}[${i}]`);
      if (got !== ref2.ink[i])
        return `pixel (${i % GRID_W}, ${Math.floor(i / GRID_W)}): machine ${got}, spec ${ref2.ink[i]}`;
    }
    return null;
  }
  function prng(seed) {
    let a = seed | 0;
    return (n) => {
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * n);
    };
  }

  // nathan/src/model/screen.ts
  var bit2 = (p, bus, i) => p.peek(`${bus}[${i}]`);
  var onehot = (p, bus, at, n) => {
    const on = [];
    for (let i = 0; i < n; i++) if (bit2(p, bus, at + i)) on.push(i);
    return on.length === 1 ? on[0] : -1;
  };
  function picked(p, bus, inv, at, n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const b = bit2(p, bus, i);
      if (b === bit2(p, inv, at + i)) return -1;
      v |= b << i;
    }
    return v;
  }
  function readScreen(p) {
    const layers = [];
    const sel = p.peek(STATE_NETS.hassel) ? picked(p, STATE_NETS.sel, SCREEN_NETS.nsel, 0, 3) : -1;
    for (let k = 0; k < LAYERS; k++) {
      const x0 = p.peek(STATE_NETS.x0(k), 4);
      const y0 = p.peek(STATE_NETS.y0(k), 4);
      const used = p.peek(STATE_NETS.used(k)) === 1;
      const kind = picked(p, STATE_NETS.kind(k), SCREEN_NETS.nkind, 2 * k, 2);
      layers.push({
        slot: k,
        shown: used && p.peek(STATE_NETS.vis(k)) === 1,
        x: x0,
        y: y0,
        w: p.peek(STATE_NETS.x1(k), 4) - x0,
        h: p.peek(STATE_NETS.y1(k), 4) - y0,
        color: picked(p, STATE_NETS.fill(k), SCREEN_NETS.nfill, 4 * k, 4),
        kind: kind > 0 ? KINDS[kind - 1] : null,
        shape: bit2(p, SCREEN_NETS.ell, k) === bit2(p, SCREEN_NETS.nell, k) ? null : bit2(p, SCREEN_NETS.ell, k) ? "ellipse" : "rect",
        selected: sel === k,
        row: used
      });
    }
    return {
      layers,
      tool: p.peek(STATE_NETS.tool, TOOL_BITS),
      color: picked(p, STATE_NETS.cur, SCREEN_NETS.ncur, 0, 4),
      hot: onehot(p, SCREEN_NETS.hot, 0, HOT.length),
      ink: Array.from({ length: GRID_W * GRID_H }, (_, i) => bit2(p, STATE_NETS.pix, i)),
      erase: p.peek(STATE_NETS.erase) === 1
    };
  }
  function hotOf(s) {
    if (s.drag) return s.drag.mode === "move" ? 2 : 3;
    if (s.tool === "move") return 0;
    if (s.tool === "pen") return s.penDown ? 5 : 4;
    return 1;
  }
  function expectedScreen(s) {
    var _a, _b, _c, _d, _e, _f;
    const layers = [];
    for (let k = 0; k < LAYERS; k++) {
      const l = s.layers[k];
      layers.push({
        slot: k,
        shown: !!l && l.visible,
        x: (_a = l == null ? void 0 : l.x) != null ? _a : NaN,
        y: (_b = l == null ? void 0 : l.y) != null ? _b : NaN,
        w: (_c = l == null ? void 0 : l.w) != null ? _c : NaN,
        h: (_d = l == null ? void 0 : l.h) != null ? _d : NaN,
        color: (_e = l == null ? void 0 : l.fill) != null ? _e : NaN,
        kind: (_f = l == null ? void 0 : l.kind) != null ? _f : null,
        shape: l ? l.kind === "ellipse" ? "ellipse" : "rect" : null,
        selected: !!l && l.id === s.selected,
        row: !!l
      });
    }
    return {
      layers,
      tool: TOOLS.indexOf(s.tool),
      color: s.fill,
      hot: hotOf(s),
      ink: s.ink,
      erase: s.erase
    };
  }
  function compareScreen(s, p) {
    const got = readScreen(p);
    const want = expectedScreen(s);
    for (let k = 0; k < LAYERS; k++) {
      const [g, w] = [got.layers[k], want.layers[k]];
      if (g.row !== w.row) return `slot ${k}: row ${g.row}, spec ${w.row}`;
      if (!w.row) {
        if (g.shown) return `slot ${k}: shown although empty`;
        if (g.selected) return `slot ${k}: selected although empty`;
        continue;
      }
      if (g.shown !== w.shown)
        return `slot ${k}: shown ${g.shown}, spec ${w.shown}`;
      if (g.selected !== w.selected)
        return `slot ${k}: selected ${g.selected}, spec ${w.selected}`;
      if (g.kind !== w.kind) return `slot ${k}: kind ${g.kind}, spec ${w.kind}`;
      if (g.shape !== w.shape)
        return `slot ${k}: drawn ${g.shape}, spec ${w.shape}`;
      if (g.color !== w.color)
        return `slot ${k}: colour ${g.color}, spec ${w.color}`;
      if (g.x !== w.x || g.y !== w.y || g.w !== w.w || g.h !== w.h)
        return `slot ${k}: rectangle ${g.x},${g.y} ${g.w}\xD7${g.h}, spec ${w.x},${w.y} ${w.w}\xD7${w.h}`;
    }
    if (got.tool !== want.tool) return `tool lamp ${got.tool}, spec ${want.tool}`;
    if (got.color !== want.color)
      return `current colour lamp ${got.color}, spec ${want.color}`;
    if (got.hot !== want.hot) return `hotspot set ${got.hot}, spec ${want.hot}`;
    return compareInk(got, want);
  }
  function compareInk(got, want) {
    const i = want.ink.findIndex((v, k) => got.ink[k] !== v);
    if (i >= 0)
      return `ink at (${i % GRID_W}, ${Math.floor(i / GRID_W)}): shown ${got.ink[i]}, spec ${want.ink[i]}`;
    if (got.erase !== want.erase) return `Erase shows ${got.erase}, spec ${want.erase}`;
    return null;
  }

  // nathan/plugin/src/where.ts
  var DOC_PAGE = "nathan.page";
  async function ensurePage(api, log = () => {
  }) {
    const byName = api.root.children.find((p) => p.name === PAGE_NAME);
    if (byName) return { page: byName, how: "existing" };
    const stored = api.root.getPluginData(DOC_PAGE);
    if (stored) {
      const n = await api.getNodeByIdAsync(stored);
      if (n && n.type === "PAGE" && !n.removed)
        return { page: n, how: "existing" };
    }
    try {
      const p = api.createPage();
      p.name = PAGE_NAME;
      return { page: p, how: "created" };
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      for (const p of api.root.children) {
        if (!/^Page \d+$/.test(p.name)) continue;
        await p.loadAsync();
        if (p.children.length === 0) {
          p.name = PAGE_NAME;
          log(
            `could not create a page (${why}); renamed the empty page to "${PAGE_NAME}"`
          );
          return { page: p, how: "renamed" };
        }
      }
      log(
        `could not create a page (${why}) and there is no empty one; building on "${api.currentPage.name}"`
      );
      return { page: api.currentPage, how: "current" };
    }
  }
  function remember(api, page) {
    api.root.setPluginData(DOC_PAGE, page.id);
  }
  async function findPage(api) {
    const byName = api.root.children.find((p) => p.name === PAGE_NAME);
    if (byName) return byName;
    const stored = api.root.getPluginData(DOC_PAGE);
    if (stored) {
      const n = await api.getNodeByIdAsync(stored);
      if (n && n.type === "PAGE" && !n.removed) return n;
    }
    return null;
  }
  var onePage = (page) => ({
    gates: page,
    cells: page,
    cpu: page
  });
  var isGate = (n) => n.type === "COMPONENT" && n.name.startsWith(GATE_PREFIX);
  var isCell = (n) => n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX);
  function origin(page) {
    const gates = page.children.filter(isGate);
    if (gates.length)
      return {
        x: Math.min(...gates.map((g) => g.x)),
        y: Math.min(...gates.map((g) => g.y)) - GATES_DY
      };
    const content = page.children;
    if (!content.length) return { x: 0, y: 0 };
    return {
      x: Math.round(Math.min(...content.map((n) => n.x))),
      y: Math.round(Math.max(...content.map((n) => n.y + n.height)) + 800)
    };
  }
  var GATES_DY = 80;
  var CELLS_DY = 360;
  var MACHINE_GAP = 1500;
  var GATE_PITCH = 144;
  function placeGates(gates, at) {
    gates.forEach((g, i) => {
      g.x = at.x + i * GATE_PITCH;
      g.y = at.y + GATES_DY;
    });
  }
  function cellsBottom(page, except = "") {
    let b = -Infinity;
    for (const n of page.children)
      if (isCell(n) && n.name !== except) b = Math.max(b, n.y + n.height);
    return b;
  }
  var Shelf = class {
    constructor(x0, y) {
      this.x0 = x0;
      this.y = y;
      this.rowH = 0;
      this.x = x0;
    }
    place(n) {
      if (this.x > this.x0 && this.x - this.x0 + n.width > 6e3) {
        this.x = this.x0;
        this.y += this.rowH + 96;
        this.rowH = 0;
      }
      n.x = this.x;
      n.y = this.y;
      this.x += n.width + 96;
      this.rowH = Math.max(this.rowH, n.height);
    }
  };

  // nathan/plugin/src/selftest.ts
  var TOOL_NAMES = ["Move", "Frame", "Rectangle", "Ellipse", "Pen"];
  var TOOL_CODES = [86, 70, 82, 79, 80];
  var ARROW_CODES = [37, 39, 38, 40];
  var ARROW_BUTTONS = ["left", "right", "up", "down"];
  var CORNER = ["se", "sw", "ne", "nw"];
  var PEN_SCRIPT = [
    { k: "tool", t: 4 },
    { k: "click", x: 2, y: 2 },
    { k: "paint", x: 3, y: 2 },
    { k: "paint", x: 4, y: 3 },
    { k: "paint", x: 5, y: 3 },
    { k: "paint", x: 6, y: 4 },
    { k: "click", x: 6, y: 4 },
    { k: "erase" },
    { k: "click", x: 4, y: 3 },
    { k: "paint", x: 5, y: 3 },
    { k: "click", x: 5, y: 3 },
    { k: "erase" },
    { k: "tool", t: 2 },
    { k: "click", x: 1, y: 1 },
    { k: "click", x: 5, y: 4 },
    { k: "tool", t: 4 },
    { k: "click", x: 9, y: 6 },
    { k: "paint", x: 10, y: 6 },
    { k: "esc" },
    { k: "clear" }
  ];
  async function selfTest(api, o) {
    var _a, _b, _c;
    const page = await findPage(api);
    if (!page)
      throw new Error(
        "no CPU NATHAN page: Build hardware and Build the OS first"
      );
    await page.loadAsync();
    const present = page.children.find((n) => n.name === PRESENT);
    if (!present) throw new Error(`no "${PRESENT}" frame: Build the OS first`);
    const editor = present.children.find((n) => n.name === "editor");
    if (!editor) throw new Error("the editor frame is missing");
    const net = nathanNetlist();
    const colls = (await api.variables.getLocalVariableCollectionsAsync()).filter(
      (c) => c.name === COLLECTION || c.name.startsWith(`${COLLECTION} \xB7 `)
    );
    if (!colls.length)
      throw new Error(`no "${COLLECTION}" variables: Build the OS first`);
    const mode = new Map(colls.map((c) => [c.id, c.defaultModeId]));
    const byName = /* @__PURE__ */ new Map();
    for (const v of await api.variables.getLocalVariablesAsync())
      if (mode.has(v.variableCollectionId)) byName.set(v.name, v);
    const values = /* @__PURE__ */ new Map();
    for (const v of byName.values())
      values.set(
        v.id,
        v.valuesByMode[mode.get(v.variableCollectionId)]
      );
    const varOfNet = (id2) => {
      const v = byName.get(varName(net.netNames[id2]));
      if (!v)
        throw new Error(
          `no variable for net ${net.netNames[id2]}: Build the OS again`
        );
      return v.id;
    };
    const probe = {
      peek(name, width = 1) {
        let out = 0;
        for (let i = 0; i < width; i++) {
          const id2 = net.aliases.get(width === 1 ? name : `${name}[${i}]`);
          if (id2 === void 0) throw new Error(`no net ${name}`);
          if (values.get(varOfNet(id2)) === true) out |= 1 << i;
        }
        return out;
      }
    };
    const find = (root, ...path) => path.reduce(
      (n, name) => {
        var _a2, _b2;
        return (_b2 = (_a2 = n == null ? void 0 : n.children) == null ? void 0 : _a2.find((c) => c.name === name)) != null ? _b2 : null;
      },
      root
    );
    const canvas2 = find(editor, "canvas");
    const shown = (n) => {
      var _a2, _b2;
      const id2 = (_b2 = (_a2 = n.boundVariables) == null ? void 0 : _a2.visible) == null ? void 0 : _b2.id;
      return id2 !== void 0 ? values.get(id2) === true : n.visible;
    };
    const stored = /* @__PURE__ */ new Map();
    const reactionsOf = (n) => {
      var _a2;
      let r = stored.get(n.id);
      if (!r) {
        r = (_a2 = n.reactions) != null ? _a2 : [];
        stored.set(n.id, r);
      }
      return r;
    };
    const fire = (n, type, key) => {
      const r = reactionsOf(n).find(
        (x) => {
          var _a2, _b2;
          return ((_a2 = x.trigger) == null ? void 0 : _a2.type) === type && (key === void 0 || ((_b2 = x.trigger.keyCodes) == null ? void 0 : _b2.includes(key)));
        }
      );
      if (!(r == null ? void 0 : r.actions))
        throw new Error(
          `${n.name} has no ${type} reaction${key !== void 0 ? ` for key ${key}` : ""}`
        );
      return runChain(r.actions);
    };
    const runChain = (first) => {
      var _a2;
      let acts = first;
      let worst2 = 0;
      for (let hop = 0; hop < 64; hop++) {
        const last = acts[acts.length - 1];
        const control = (last == null ? void 0 : last.type) === "NODE" || (last == null ? void 0 : last.type) === "CLOSE" ? last : void 0;
        const body2 = control ? acts.slice(0, -1) : acts;
        worst2 = Math.max(worst2, runFigmaActions(body2, values) + (control ? 1 : 0));
        if (hop > 0 && !control)
          throw new Error("an overlay's timer neither swaps in the next overlay nor closes");
        if (!control || control.type !== "NODE") return worst2;
        const nav = String(control.navigation);
        if (nav !== (hop === 0 ? "OVERLAY" : "SWAP"))
          throw new Error(`a reaction ${hop === 0 ? "opens" : "continues with"} ${nav}`);
        const overlay = page.children.find(
          (n) => n.id === control.destinationId
        );
        const timed = overlay ? reactionsOf(overlay).find((x) => {
          var _a3;
          return ((_a3 = x.trigger) == null ? void 0 : _a3.type) === "AFTER_TIMEOUT";
        }) : void 0;
        if (!(timed == null ? void 0 : timed.actions))
          throw new Error(
            `a reaction continues to ${(_a2 = overlay == null ? void 0 : overlay.name) != null ? _a2 : control.destinationId}, which has no timer`
          );
        acts = timed.actions;
      }
      throw new Error("a reaction's chain of overlays never closes");
    };
    const press = (n) => {
      const stages = ["MOUSE_DOWN", "MOUSE_UP", "ON_CLICK"].filter(
        (type) => reactionsOf(n).some((x) => {
          var _a2;
          return ((_a2 = x.trigger) == null ? void 0 : _a2.type) === type;
        })
      );
      if (!stages.length) throw new Error(`${n.name} has no click reaction`);
      return Math.max(...stages.map((type) => fire(n, type)));
    };
    const spacers2 = (n, prefix) => {
      var _a2;
      return ((_a2 = n.children) != null ? _a2 : []).reduce(
        (v, c) => c.name.startsWith(prefix) && shown(c) ? v + (1 << Number(c.name.slice(prefix.length))) : v,
        0
      );
    };
    const pickedLeaf = (root) => {
      var _a2;
      let n = root;
      do {
        const on = ((_a2 = n.children) != null ? _a2 : []).filter(shown);
        if (on.length !== 1) return null;
        n = on[0];
      } while (n.name.startsWith("pick/"));
      return n;
    };
    const leafIndex = (leaf) => leaf ? Number(leaf.name.split("/")[1]) : -1;
    const readUi = () => {
      const selection2 = find(canvas2, "selection");
      const outlined = shown(selection2) ? pickedLeaf(selection2) : null;
      const highlight = find(editor, "layers", "highlight");
      const lit2 = shown(highlight) ? LAYERS - 1 - spacers2(highlight, "nsel/") : -1;
      const layers = [];
      for (let k = 0; k < LAYERS; k++) {
        const box2 = find(canvas2, `layer/${k}`);
        const col = find(box2, "col");
        const row = find(col, "xbox", "row");
        const x0 = spacers2(row, "x0/");
        const y0 = spacers2(col, "y0/");
        const panelRow = find(editor, "layers", `row/${k}`);
        const name = pickedLeaf(find(panelRow, "name"));
        const swatch = pickedLeaf(find(row, "body"));
        const [square2, round] = ["rect", "ellipse"].map(
          (s) => swatch ? shown(find(swatch, s)) : false
        );
        const kind = name ? KIND_NAMES.indexOf(name.name.slice("name/".length)) : -1;
        layers.push({
          slot: k,
          shown: shown(box2) && shown(col),
          x: x0,
          y: y0,
          w: spacers2(find(col, "xbox", "x1"), "x1/") - x0,
          h: spacers2(find(box2, "y1"), "y1/") - y0,
          color: leafIndex(swatch),
          kind: kind > 0 ? KINDS[kind - 1] : null,
          shape: square2 === round ? null : round ? "ellipse" : "rect",
          selected: (outlined == null ? void 0 : outlined.name) === `overlay/${k}` && lit2 === k,
          row: shown(panelRow)
        });
      }
      const sets = canvas2.children.filter((c) => c.name.startsWith("hot/"));
      const ink = find(canvas2, "ink");
      return {
        layers,
        tool: spacers2(find(editor, "toolbar", "highlight"), "t/"),
        color: leafIndex(pickedLeaf(find(editor, "design", "fill-field", "current"))),
        hot: sets.filter((s) => shown(s)).length === 1 ? sets.findIndex((s) => shown(s)) : -1,
        ink: Array.from(
          { length: GRID_W * GRID_H },
          (_, i) => shown(find(ink, `ink/${i}`)) ? 1 : 0
        ),
        erase: shown(find(editor, "pen", "button/erase", "on"))
      };
    };
    const keyed = (n, code) => reactionsOf(n).some(
      (x) => {
        var _a2;
        return ((_a2 = x.trigger) == null ? void 0 : _a2.type) === "ON_KEY_DOWN" && x.trigger.keyCodes.includes(code);
      }
    );
    const shortcuts = find(editor, "shortcuts");
    const holderOf = (code) => {
      if (keyed(present, code)) return present;
      const leaf = shortcuts ? pickedLeaf(shortcuts) : null;
      return leaf && keyed(leaf, code) ? leaf : null;
    };
    let viaKeys = 0;
    let held = false;
    const act = (ev, spec2, next, preferKey) => {
      var _a2, _b2;
      if (held && ev.k !== "click") held = false;
      const keyOr = (code, button3) => {
        if (!preferKey) return button3();
        const holder = holderOf(code);
        if (!holder) throw new Error(`no layer that shows takes key ${code}`);
        viaKeys++;
        return fire(holder, "ON_KEY_DOWN", code);
      };
      const hotspots = (state = spec2) => {
        const sets = canvas2.children.filter(
          (c) => c.name.startsWith("hot/") && shown(c)
        );
        if (sets.length !== 1)
          throw new Error(
            `${sets.length} click layers are visible, expected exactly 1`
          );
        const name = `hot/${HOT[hotOf(state)]}`;
        if (sets[0].name !== name)
          throw new Error(
            `the visible click layer is ${sets[0].name}, expected ${name}`
          );
        return sets[0];
      };
      const button2 = (name) => () => {
        var _a3;
        const b = find(present, "editor", "design", `button/${name}`);
        const leaf = ((_a3 = b.children) == null ? void 0 : _a3.some((c) => c.name.startsWith("pick/"))) ? pickedLeaf(b) : b;
        if (!leaf) throw new Error(`button/${name}: no single slot button shows`);
        return press(leaf);
      };
      switch (ev.k) {
        case "tool":
          return keyOr(
            TOOL_CODES[ev.t],
            () => press(
              find(present, "editor", "toolbar", `tool/${TOOL_NAMES[ev.t]}`)
            )
          );
        case "fill": {
          const s = find(present, "editor", "design", `color/${ev.c}`);
          const leaf = ((_a2 = s.children) == null ? void 0 : _a2.some((c) => c.name.startsWith("pick/"))) ? pickedLeaf(s) : s;
          if (!leaf) throw new Error(`color/${ev.c}: no single swatch shows`);
          return press(leaf);
        }
        case "select":
          return press(find(present, "editor", "layers", `row/${ev.slot}`));
        case "vis":
          return press(
            find(present, "editor", "layers", `row/${ev.slot}`, "eye-hit")
          );
        case "click": {
          const cellOf = (state) => {
            const set = hotspots(state);
            const slots = find(set, "slots");
            const holder = slots ? pickedLeaf(slots) : set;
            if (!holder) throw new Error(`${set.name}: no single slot copy shows`);
            const row = find(holder, `row/${ev.y}`);
            return { row, cell: find(row, `cell/${ev.x}`) };
          };
          const has = (n, type) => reactionsOf(n).some((x) => {
            var _a3;
            return ((_a3 = x.trigger) == null ? void 0 : _a3.type) === type;
          });
          const taker = (at, type) => has(at.cell, type) ? at.cell : has(at.row, type) ? at.row : null;
          const release = (state) => {
            const on = taker(cellOf(state), "MOUSE_UP");
            return on ? fire(on, "MOUSE_UP") : 0;
          };
          if (held) {
            held = false;
            return release(spec2);
          }
          const here = cellOf(spec2);
          let most = fire(here.cell, "MOUSE_ENTER");
          const down = taker(here, "MOUSE_DOWN");
          if (down) most = Math.max(most, fire(down, "MOUSE_DOWN"));
          if (down && next.drag) {
            held = true;
            return most;
          }
          return Math.max(most, release(down ? next : spec2));
        }
        case "paint": {
          const set = hotspots();
          if (set.name !== `hot/pen-down`)
            throw new Error(`a stroke over ${set.name}, which does not paint`);
          return fire(find(set, `row/${ev.y}`, `cell/${ev.x}`), "MOUSE_ENTER");
        }
        case "erase":
          return keyOr(69, () => press(find(present, "editor", "pen", "button/erase")));
        case "clear":
          return keyOr(67, () => press(find(present, "editor", "pen", "button/clear")));
        case "handle": {
          const k = spec2.layers.findIndex((l) => l.id === spec2.selected);
          const selection2 = find(canvas2, "selection");
          const overlay = shown(selection2) ? pickedLeaf(selection2) : null;
          if ((overlay == null ? void 0 : overlay.name) !== `overlay/${k}`)
            throw new Error(
              `the visible selection outline is ${(_b2 = overlay == null ? void 0 : overlay.name) != null ? _b2 : "none"}, expected overlay/${k}`
            );
          const walk = (n) => {
            var _a3, _b3;
            return n.name === `handle/${CORNER[ev.corner]}` ? n : (_b3 = ((_a3 = n.children) != null ? _a3 : []).map(walk).find(Boolean)) != null ? _b3 : null;
          };
          const most = fire(walk(overlay), "MOUSE_DOWN");
          held = !!next.drag;
          return most;
        }
        case "delete":
          return keyOr(46, button2("delete"));
        case "dup":
          return keyOr(68, button2("duplicate"));
        case "fwd":
          return keyOr(221, button2("forward"));
        case "back":
          return keyOr(219, button2("backward"));
        case "nudge":
          return keyOr(ARROW_CODES[ev.dir], button2(ARROW_BUTTONS[ev.dir]));
        case "esc":
          viaKeys++;
          return fire(present, "ON_KEY_DOWN", 27);
        default:
          throw new Error(`the editor has no control for ${ev.k}`);
      }
    };
    const rnd = prng(o.seed);
    let spec = initialState2();
    let worst = 0;
    const cov = /* @__PURE__ */ new Set();
    const pointer = { x: 0, y: 0 };
    const script = (_a = o.script) != null ? _a : PEN_SCRIPT;
    const total = script.length + o.events;
    for (let i = 0; i < total; i++) {
      const ev = i < script.length ? script[i] : uiEvent(rnd, spec, pointer);
      const next = applyRef(spec, ev);
      try {
        worst = Math.max(worst, act(ev, spec, next, rnd(2) === 1));
      } catch (e) {
        return {
          ok: false,
          events: i,
          text: `event ${i} ${JSON.stringify(ev)}: ${e instanceof Error ? e.message : e}`
        };
      }
      spec = next;
      cov.add(ev.k);
      const err = (_c = (_b = compare(spec, probe)) != null ? _b : compareScreen(spec, probe)) != null ? _c : uiDiff(spec, readUi());
      if (err)
        return {
          ok: false,
          events: i + 1,
          text: `after event ${i} ${JSON.stringify(ev)}: ${err}`
        };
    }
    return {
      ok: true,
      events: total,
      text: `\u2713 ${script.length ? `a pen session (${script.length}) and ` : ""}${o.events} random user actions through the stored reactions: registers, screen lines and UI layers all match the editor spec (heaviest single event: ${worst} actions executed; used: ${[...cov].sort().join(", ")}; ${viaKeys} by shortcut key)`
    };
  }
  function uiDiff(spec, ui) {
    const want = expectedScreen(spec);
    for (let k = 0; k < LAYERS; k++) {
      const [g, w] = [ui.layers[k], want.layers[k]];
      if (g.row !== w.row)
        return `UI: layer row ${k} is ${g.row ? "visible" : "hidden"}, the spec says ${w.row}`;
      if (!w.row) {
        if (g.shown || g.selected) return `UI: empty slot ${k} is drawn`;
        continue;
      }
      if (g.shown !== w.shown)
        return `UI: layer ${k} shown=${g.shown}, spec ${w.shown}`;
      if (g.selected !== w.selected)
        return `UI: layer ${k} selected=${g.selected}, spec ${w.selected}`;
      if (g.kind !== w.kind)
        return `UI: layer ${k} name ${g.kind}, spec ${w.kind}`;
      if (g.shape !== w.shape)
        return `UI: layer ${k} drawn ${g.shape}, spec ${w.shape}`;
      if (g.color !== w.color)
        return `UI: layer ${k} colour ${g.color}, spec ${w.color}`;
      if (g.x !== w.x || g.y !== w.y || g.w !== w.w || g.h !== w.h)
        return `UI: layer ${k} drawn at ${g.x},${g.y} ${g.w}\xD7${g.h}, spec ${w.x},${w.y} ${w.w}\xD7${w.h}`;
    }
    if (ui.tool !== want.tool) return `UI: tool ${ui.tool}, spec ${want.tool}`;
    if (ui.color !== want.color)
      return `UI: current colour ${ui.color}, spec ${want.color}`;
    if (ui.hot !== want.hot) return `UI: click layer ${ui.hot}, spec ${want.hot}`;
    const ink = compareInk(ui, want);
    return ink ? `UI: ${ink}` : null;
  }
  function uiEvent(rnd, s, at) {
    const n = s.layers.length;
    const move = (ev) => {
      if ("x" in ev) [at.x, at.y] = [ev.x, ev.y];
      return ev;
    };
    if (s.tool === "pen" && !s.drag && rnd(100) < 80) {
      const step = (v, d, n2) => Math.max(0, Math.min(n2 - 1, v + d - 1));
      const near = () => ({ x: step(at.x, rnd(3), GRID_W), y: step(at.y, rnd(3), GRID_H) });
      const r = rnd(100);
      if (s.penDown && r < 80) return move(__spreadValues({ k: "paint" }, near()));
      if (r < 92) return move(__spreadValues({ k: "click" }, s.penDown ? near() : { x: rnd(GRID_W), y: rnd(GRID_H) }));
      if (r < 97) return { k: "erase" };
      return { k: "clear" };
    }
    const x = rnd(GRID_W);
    const y = rnd(GRID_H);
    for (; ; ) {
      const q = rnd(100);
      if (q < 45) return move({ k: "click", x, y });
      if (q < 52) return { k: "tool", t: rnd(TOOLS.length) };
      if (q < 58) return { k: "fill", c: rnd(PALETTE_SIZE) };
      if (q < 63 && n) return { k: "select", slot: rnd(n) };
      if (q < 67 && n) return { k: "vis", slot: rnd(n) };
      if (q < 71) return { k: "delete" };
      if (q < 76) return { k: "dup" };
      if (q < 80) return { k: "fwd" };
      if (q < 84) return { k: "back" };
      if (q < 90) return { k: "nudge", dir: rnd(4) };
      if (q < 92) return { k: "esc" };
      if (s.selected !== null && q < 97) return { k: "handle", corner: rnd(4) };
      if (q === 98) return { k: "erase" };
      if (q === 99) return { k: "clear" };
    }
  }

  // nathan/plugin/src/app.ts
  var PAD3 = 48;
  var HEADER = 132;
  var GAP2 = 160;
  var CHAIN_PREFIX = "NATHAN \xB7 then ";
  var WARMUP = "NATHAN \xB7 warm-up";
  var errText = (e) => e instanceof Error ? e.message : String(e);
  var NathanApp = class {
    constructor(api, post2, opts = {}) {
      this.api = api;
      this.post = post2;
      this.busy = null;
      var _a, _b;
      this.now = (_a = opts.now) != null ? _a : (() => Date.now());
      this.breathe = (_b = opts.yield) != null ? _b : (() => new Promise((r) => setTimeout(r, 0)));
    }
    // ---------- messages ----------
    /** Handles one panel message. Never throws: errors go to the panel log. */
    async handle(msg) {
      try {
        switch (msg.type) {
          case "init":
            this.post({ type: "hello", status: await this.status() });
            return;
          case "hardware":
            await this.task(
              "Build hardware",
              () => this.hardware({ gateLabels: msg.gateLabels, redraw: msg.redraw })
            );
            return;
          case "os":
            await this.task(
              "Build the OS",
              () => this.os({
                latch: msg.latch,
                budget: msg.budget,
                alias: msg.alias
              })
            );
            return;
          case "selftest":
            await this.task(
              "Self-test",
              () => this.selftest(msg.events, msg.seed)
            );
            return;
          case "platform":
            await this.task("Platform tests", () => this.platform());
            return;
          case "clean":
            await this.task("Clean", () => this.clean());
            return;
        }
      } catch (e) {
        this.log("error", errText(e));
      }
    }
    async task(name, fn) {
      if (this.busy) {
        this.log("error", `busy: ${this.busy} is still running`);
        return void 0;
      }
      this.busy = name;
      this.post({ type: "busy", task: name });
      try {
        return await fn();
      } catch (e) {
        this.log("error", `${name} failed: ${errText(e)}`);
        return void 0;
      } finally {
        this.busy = null;
        this.post({ type: "busy", task: null });
        try {
          this.post({ type: "status", status: await this.status() });
        } catch (e) {
        }
      }
    }
    log(level, text2) {
      this.post({ type: "log", level, text: text2 });
    }
    progress(task, done, total, label2) {
      this.post({ type: "progress", task, done, total, label: label2 });
    }
    async phase(name, fn) {
      try {
        return await fn();
      } catch (e) {
        throw new Error(`${name}: ${errText(e)}`);
      }
    }
    /** What the document holds (cheap checks only). */
    async status() {
      const page = await findPage(this.api);
      if (!page) return { page: null, hardware: false, built: false };
      await page.loadAsync();
      const colls = await this.api.variables.getLocalVariableCollectionsAsync();
      return {
        page: page.name,
        hardware: !!findCell(page, TOP),
        built: !!page.children.find((n) => n.name === PRESENT) && colls.some((c) => c.name === COLLECTION)
      };
    }
    // ---------- 1. hardware ----------
    async hardware(o = {}) {
      var _a, _b;
      const t0 = this.now();
      const gateLabels = o.gateLabels !== false;
      const lib = nathanLibrary();
      const { page, how } = await ensurePage(
        this.api,
        (m) => this.log("info", m)
      );
      if (how === "created") this.log("info", `created the page "${page.name}"`);
      remember(this.api, page);
      await page.loadAsync();
      await this.api.setCurrentPageAsync(page);
      const pages = onePage(page);
      await this.releaseMachine(page, !!o.redraw);
      if (o.redraw) {
        let removed = 0;
        for (const n of [...page.children])
          if (n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX) && lib.has(n.name.slice(CELL_PREFIX.length))) {
            n.remove();
            removed++;
          }
        if (removed)
          this.log("info", `redraw: removed ${removed} old cell components`);
      }
      const at = origin(page);
      const order = dependencyOrder(lib);
      this.progress("hardware", 0, order.length, "gates");
      const before = new Set(
        page.children.filter((n) => n.type === "COMPONENT" && n.name.startsWith(GATE_PREFIX)).map((n) => n.name)
      );
      const gates = await this.phase(
        "drawing gates",
        () => drawGates(page, { labels: gateLabels, redraw: o.redraw })
      );
      if ([...gates.values()].some((g) => !before.has(g.name)))
        placeGates([...gates.values()], at);
      await this.breathe();
      const existing = /* @__PURE__ */ new Set();
      for (const n of page.children)
        if (n.type === "COMPONENT" && n.name.startsWith(CELL_PREFIX))
          existing.add(n.name.slice(CELL_PREFIX.length));
      let shelf = null;
      let drawn = 0;
      let reused = 0;
      for (let i = 0; i < order.length; i++) {
        const name = order[i];
        this.progress("hardware", i, order.length, name);
        if (existing.has(name)) {
          reused++;
          continue;
        }
        const r = await this.phase(
          `drawing ${name}`,
          () => drawLibrary(lib, pages, { only: [name], gateLabels })
        );
        const comp = r.cells.get(name);
        if (!comp || r.reused.includes(name)) {
          reused++;
          continue;
        }
        drawn++;
        if (name === TOP) {
          const below = Math.max(cellsBottom(page, comp.name), at.y + CELLS_DY) + MACHINE_GAP;
          comp.x = at.x;
          comp.y = Math.round(below);
        } else {
          if (!shelf)
            shelf = new Shelf(
              at.x,
              Math.max(
                at.y + CELLS_DY,
                cellsBottom(page, `${CELL_PREFIX}${TOP}`) + 192
              )
            );
          shelf.place(comp);
        }
        await this.breathe();
      }
      const engine = findCell(page, TOP);
      const stats = {
        modules: order.length,
        drawn,
        reused,
        gates: flatten(lib, TOP).gates.length,
        ms: this.now() - t0,
        engineSize: {
          w: Math.round((_a = engine == null ? void 0 : engine.width) != null ? _a : 0),
          h: Math.round((_b = engine == null ? void 0 : engine.height) != null ? _b : 0)
        },
        page: page.name
      };
      this.progress("hardware", order.length, order.length, "done");
      this.post({ type: "hardware", stats });
      this.log(
        "ok",
        `hardware on the page "${page.name}": ${drawn} module(s) drawn, ${reused} reused, ${stats.gates} gates (${(stats.ms / 1e3).toFixed(1)} s). Next: Build the OS.`
      );
      try {
        if (engine) this.api.viewport.scrollAndZoomIntoView([engine]);
      } catch (e) {
      }
      return stats;
    }
    /** Takes the machine out of the editor / machine frames (where Build the OS put it) and removes
     * those frames. The machine keeps its place on the page. */
    async releaseMachine(page, alsoRemove) {
      for (const f of page.children.filter(
        (n) => n.name.startsWith(CHAIN_PREFIX) || n.name === WARMUP
      ))
        f.remove();
      for (const f of page.children.filter(
        (n) => n.name === PRESENT || n.name === MACHINE || n.name === CIRCUIT
      )) {
        for (const c of f.findAllWithCriteria({
          types: ["COMPONENT"]
        })) {
          if (c.name !== `${CELL_PREFIX}${TOP}`) continue;
          let x = 0;
          let y = 0;
          for (let n = c; n && n !== page; n = n.parent) {
            x += n.x;
            y += n.y;
          }
          page.appendChild(c);
          c.x = x;
          c.y = y;
          if (alsoRemove) c.remove();
        }
        f.remove();
      }
    }
    // ---------- 2. the OS ----------
    async os(o) {
      var _a;
      const t0 = this.now();
      const page = await findPage(this.api);
      if (!page) throw new Error(`no "CPU NATHAN" page: Build hardware first`);
      await page.loadAsync();
      await this.api.setCurrentPageAsync(page);
      if (!findCell(page, TOP))
        throw new Error(`no cell/${TOP} on the page: Build hardware first`);
      const steps = 7;
      this.progress("os", 0, steps, "reading the circuit off the canvas");
      const lib = await this.phase("extract", () => extract([page]));
      if (!lib.has(TOP))
        throw new Error(`no cell/${TOP} component found: Build hardware first`);
      const net = await this.phase(
        "flatten",
        () => flatten(lib, TOP)
      );
      await this.breathe();
      this.progress(
        "os",
        1,
        steps,
        `one reaction per control (${net.gates.length} gates)`
      );
      const catalog = await this.phase(
        "reactions",
        () => {
          var _a2;
          return buildCatalogGently(
            net,
            reactionSpecs(),
            { latch: o.latch, budget: (_a2 = o.gatesUpTo) != null ? _a2 : o.budget, alias: o.alias },
            () => this.breathe()
          );
        }
      );
      await this.breathe();
      this.progress("os", 2, steps, "variables");
      await this.removeGently(COLLECTION);
      await this.removeGently(UI_COLLECTION);
      const init = nathanPowerOn(net);
      const used = /* @__PURE__ */ new Set();
      for (const g of net.gates) {
        used.add(g.out);
        for (const n of g.in) used.add(n);
      }
      for (const p of net.ports) for (const n of p.nets) used.add(n);
      used.delete(NET0);
      used.delete(NET1);
      const ids = [...used].sort((a, b) => a - b);
      const specs = ids.map((id2) => ({
        name: varName(net.netNames[id2]),
        type: "BOOLEAN",
        init: init[id2] === 1
      }));
      const { collections, vars } = await this.phase(
        "variables",
        () => createVariables(this.api, COLLECTION, specs, {
          log: (m) => this.log("info", m),
          yieldEvery: 250
        })
      );
      const variables = new Map(
        ids.map((id2, i) => [id2, vars[i]])
      );
      const ptrSpecs = [
        ...[0, 1, 2, 3].map((i) => ({
          name: `ui/px/${i}`,
          type: "BOOLEAN",
          init: false
        })),
        // the warm-up when ▶ Present opens: done once, and a bit it flips to get the viewer going
        { name: "ui/warm", type: "BOOLEAN", init: false },
        { name: "ui/scratch", type: "BOOLEAN", init: false },
        // the pen's anchor: the cell its press went down on (column, row), for the stroke's line
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
          name: `ui/anchor/${i}`,
          type: "BOOLEAN",
          init: false
        }))
      ];
      const ptr = await this.phase(
        "hover variables",
        () => createVariables(this.api, UI_COLLECTION, ptrSpecs)
      );
      const pxh = ptr.vars.slice(0, 4);
      const [warmed, scratch] = [ptr.vars[4], ptr.vars[5]];
      const anchorVars = ptr.vars.slice(6, 14);
      await this.breathe();
      this.progress("os", 3, steps, "lamps on the gates and wires");
      const engine = findCell(page, TOP);
      const lits = collectBindings(engine, net);
      const shadow = masterToQ(net);
      let bound = 0;
      const bindNet = (node, wire) => {
        var _a2;
        const id2 = (_a2 = shadow.get(wire)) != null ? _a2 : wire;
        const v = id2 <= 1 ? id2 === 1 : variables.get(id2);
        if (v === void 0) return;
        bindVisible(node, v);
        bound++;
      };
      for (const [gi, node] of lits.gateLit) {
        bindNet(node, net.gates[gi].out);
        if (bound % 400 === 399) await this.breathe();
      }
      for (const [id2, nodes] of lits.wireLit)
        for (const node of nodes) {
          bindNet(node, id2);
          if (bound % 400 === 399) await this.breathe();
        }
      this.log(
        "info",
        `bound ${bound} lit layers${lits.missing.length ? `, ${lits.missing.length} gate(s) without a lit layer` : ""}`
      );
      await this.breathe();
      const varIds = new Map(
        [...variables].map(([id2, v]) => [id2, v.id])
      );
      const port = (n) => net.ports.find((p) => p.name === n).nets;
      const copyPointer = port("PX").map((n, i) => ({ to: n, from: pxh[i] })).map(
        (c) => setVariable(
          varIds.get(c.to),
          exprData("EQUALS", [aliasData(c.from.id), boolData(true)])
        )
      );
      const convert = (a) => figmaActions(a, varIds);
      const eventSizes = /* @__PURE__ */ new Map();
      this.progress("os", 4, steps, "reactions, cut into events");
      await loadFonts2(this.api);
      await this.releaseMachine(page, false);
      const triggered = /* @__PURE__ */ new Map();
      const chainFrames = [];
      const torn = [];
      const greedy = (list, first) => {
        const out = [[]];
        let size2 = first + 1;
        for (const a of list) {
          const n = staticSize([a]);
          if (out[out.length - 1].length && size2 + n > o.budget) {
            out.push([]);
            size2 = 1;
          }
          out[out.length - 1].push(a);
          size2 += n;
        }
        return out;
      };
      for (const [run, entry] of catalog) {
        const lead = run.startsWith("click/") && !("PX" in entry.spec.ties) ? copyPointer : [];
        const first = lead.length + (run.startsWith("click/") || run.startsWith("paint/") ? pxh.length : 0);
        const eventsOf = (r) => {
          const acts = r.actions;
          if (first + staticSize(acts) <= o.budget) return [acts];
          const [head, tail] = [acts.slice(0, r.commitAt), acts.slice(r.commitAt)];
          const tailSize = staticSize(tail);
          if (tailSize + 1 > o.budget) return null;
          const parts2 = greedy(head, first);
          const last = parts2[parts2.length - 1];
          const lastSize = staticSize(last) + (parts2.length === 1 ? first : 0) + 1;
          if (lastSize + tailSize <= o.budget)
            parts2[parts2.length - 1] = [...last, ...tail];
          else parts2.push(tail);
          return parts2;
        };
        let parts = eventsOf(entry.reaction);
        if (!parts || parts.length > 1)
          for (const alt of [
            { latch: "direct" },
            { latch: "direct", inside: false }
          ]) {
            const r = synthesize(net, entry.spec.ties, __spreadProps(__spreadValues({}, alt), {
              alias: o.alias,
              given: entry.spec.given
            }));
            const p = eventsOf(r);
            if (p && (!parts || p.length < parts.length)) {
              entry.reaction = r;
              parts = p;
            }
          }
        if (!parts) {
          torn.push(run);
          parts = greedy(entry.reaction.actions, first);
        }
        const chained = parts.length > 1;
        eventSizes.set(
          run,
          parts.map((p, k) => staticSize(p) + (k ? 0 : first) + (chained ? 1 : 0))
        );
        if (!chained) {
          triggered.set(run, [...lead, ...convert(parts[0])]);
          continue;
        }
        const frames = parts.slice(1).map((_, k) => {
          const f = box(this.api, `${CHAIN_PREFIX}${run} ${k + 1}`, 1, 1, COLORS.bg);
          f.fills = [];
          chainFrames.push(f);
          return f;
        });
        for (let k = 1; k < parts.length; k++)
          await frames[k - 1].setReactionsAsync([
            {
              trigger: afterTimeout(1e-3),
              actions: [
                ...convert(parts[k]),
                k + 1 < parts.length ? navigateWith(frames[k].id, "SWAP") : { type: "CLOSE" }
              ]
            }
          ]);
        triggered.set(run, [
          ...lead,
          ...convert(parts[0]),
          navigateWith(frames[0].id, "OVERLAY")
        ]);
        await this.breathe();
      }
      const store = (c) => pxh.map((v, i) => setVariable(v.id, boolData((c >> i & 1) === 1)));
      const goTo = /* @__PURE__ */ new Map();
      const triggerOf = (t) => t.on === "key" ? keyDown(t.codes) : t.on === "enter" ? mouseEnter(0) : t.on === "down" ? mouseDown(0) : t.on === "up" ? mouseUp(0) : onClick();
      const anchorStore = (x, y) => anchorVars.map(
        (v, i) => setVariable(v.id, boolData(((i < 4 ? x : y) >> i % 4 & 1) === 1))
      );
      const netVar = (name) => {
        const id2 = net.aliases.get(name);
        const v = id2 === void 0 ? void 0 : variables.get(id2);
        if (!v) throw new Error(`no variable for net ${name}`);
        return v;
      };
      const isAnchor = (x, y) => anchorVars.map(
        (v, i) => ((i < 4 ? x : y) >> i % 4 & 1) === 1 ? aliasData(v.id) : exprData("NOT", [aliasData(v.id)])
      ).reduceRight((acc, lit2) => exprData("AND", [lit2, acc]));
      const strokes = /* @__PURE__ */ new Map();
      const strokeActions = (run) => {
        var _a2;
        const known = strokes.get(run);
        if (known) return known;
        const [r, c] = run.slice("stroke/".length).split("/").map(Number);
        const plan2 = strokePlan(r, c);
        const ink = (bit3) => setVariable(netVar(`pix[${bit3}]`).id, exprData("NOT", [aliasData(netVar("erase").id)]));
        const pendown = net.aliases.get("pendown");
        const master = (_a2 = [...shadow].find(([, q]) => q === pendown)) == null ? void 0 : _a2[0];
        const acts = [
          ink(plan2.at),
          ...plan2.lines.filter((l) => l.bits.length).map((l) => conditional(isAnchor(l.x, l.y), l.bits.map(ink))),
          conditional(exprData("NOT", [isAnchor(c, r)]), [
            setVariable(netVar("pendown").id, boolData(false)),
            ...master !== void 0 && variables.get(master) ? [setVariable(variables.get(master).id, boolData(false))] : [],
            setVariable(netVar("hot[4]").id, boolData(true)),
            setVariable(netVar("hot[5]").id, boolData(false))
          ])
        ];
        strokes.set(run, acts);
        return acts;
      };
      const reactionsFor = (ref2) => {
        const t = ref2.trigger;
        if (ref2.run.startsWith("pointer/"))
          return [
            {
              trigger: triggerOf(t),
              actions: store(Number(ref2.run.slice("pointer/".length)))
            }
          ];
        if (ref2.run.startsWith("go/")) {
          const to = goTo.get(ref2.run.slice("go/".length));
          if (!to) throw new Error(`the screen jumps to a frame that does not exist: ${ref2.run}`);
          return [{ trigger: triggerOf(t), actions: [navigate(to)] }];
        }
        const actions = ref2.run.startsWith("stroke/") ? strokeActions(ref2.run) : triggered.get(ref2.run);
        if (!actions)
          throw new Error(
            `the screen refers to a reaction that does not exist: ${ref2.run}`
          );
        return [
          {
            trigger: triggerOf(t),
            actions: [
              ...ref2.pointer === void 0 ? [] : store(ref2.pointer),
              ...ref2.anchor ? anchorStore(ref2.anchor.x, ref2.anchor.y) : [],
              ...actions
            ]
          }
        ];
      };
      this.progress("os", 5, steps, "the editor, machine and circuit frames");
      const engineNow = findCell(page, TOP);
      const ctx = {
        api: this.api,
        variable: (netName) => {
          const id2 = net.aliases.get(netName);
          return id2 === void 0 ? void 0 : variables.get(id2);
        },
        reactionsFor,
        breathe: () => this.breathe()
      };
      const frame2 = (name) => {
        const f = box(this.api, name, UI_W + 2 * PAD3, HEADER + UI_H + PAD3, COLORS.bg);
        f.clipsContent = true;
        return f;
      };
      const present = box(this.api, PRESENT, UI_W, UI_H, COLORS.bg);
      present.clipsContent = true;
      const machine = frame2(MACHINE);
      const circuit = frame2(CIRCUIT);
      goTo.set("machine", machine.id);
      put(page, circuit, engineNow.x - PAD3, engineNow.y - HEADER);
      put(page, present, circuit.x, circuit.y - GAP2 - present.height);
      put(page, machine, present.x + present.width + GAP2, present.y);
      chainFrames.forEach(
        (f, i) => put(page, f, machine.x + machine.width + GAP2, machine.y + i * 8)
      );
      const view = box(this.api, "view", UI_W, UI_H, COLORS.bg);
      view.clipsContent = true;
      view.overflowDirection = "BOTH";
      put(circuit, view, PAD3, HEADER);
      put(view, engineNow, 0, 0);
      const result = await this.phase(
        "editor",
        () => (
          // the gates are in their own frame here, one button away
          render(
            ctx,
            present,
            uiSpec()
          )
        )
      );
      result.root.x = 0;
      result.root.y = 0;
      const blocks = new Map(lib.get(TOP).instances.map((i) => [i.name, i.cell]));
      const map = await this.phase(
        "gate map",
        () => render(
          ctx,
          machine,
          gateMap(net, {
            width: UI_W,
            columns: 5,
            lamp: 7,
            gap: 2,
            netOf: (gi) => {
              var _a2;
              return net.netNames[(_a2 = shadow.get(net.gates[gi].out)) != null ? _a2 : net.gates[gi].out];
            },
            title: (b, n) => `${b}${blocks.has(b) ? ` \xB7 ${blocks.get(b).replace(CELL_PREFIX, "")}` : ""} \xB7 ${n} gates`,
            colours: {
              block: COLORS.panel,
              text: COLORS.dim,
              lamp: COLORS.lampOn,
              off: COLORS.lampOff
            }
          })
        )
      );
      map.root.x = PAD3;
      map.root.y = HEADER;
      let keysBound = 0;
      for (const f of [machine, circuit])
        keysBound += (await render(ctx, f, slotKeys(COLORS.bg))).bound;
      const go = async (from, to, label2, slot = 0) => {
        const b = put(from, button(this.api, label2, COLORS.step, 200, 40), from.width - PAD3 - 200 - slot * 216, 32);
        await b.setReactionsAsync([{ trigger: onClick(), actions: [navigate(to.id)] }]);
      };
      await go(machine, present, "\u25C2 back to the editor");
      await go(machine, circuit, "the circuit \u25B8", 1);
      await go(circuit, machine, "\u25C2 back to the machine");
      let bx = PAD3;
      for (const part of engineNow.children) {
        if (part.type !== "INSTANCE" || !blocks.has(part.name) || /^g\d+$/.test(part.name)) continue;
        const w = 16 + part.name.length * 9;
        const b = put(circuit, button(this.api, part.name, COLORS.panel, w, 28), bx, 92);
        await b.setReactionsAsync([
          { trigger: onClick(), actions: [navigateWith(part.id, "SCROLL_TO")] }
        ]);
        bx += w + 6;
      }
      this.progress("os", 6, steps, "shortcut keys and the flow");
      const keyReactions = KEYS.flatMap(
        (k) => reactionsFor({ trigger: { on: "key", codes: k.codes }, run: k.run })
      );
      let warmup = null;
      if (chainFrames.length) {
        warmup = box(this.api, WARMUP, 1, 1, COLORS.bg);
        warmup.fills = [];
        put(page, warmup, machine.x + machine.width + GAP2, machine.y - 40);
        await warmup.setReactionsAsync([
          { trigger: afterTimeout(1e-3), actions: [{ type: "CLOSE" }] }
        ]);
      }
      const flip = setVariable(
        scratch.id,
        exprData("NOT", [aliasData(scratch.id)])
      );
      const warm = {
        trigger: afterTimeout(1e-3),
        actions: [
          conditional(exprData("EQUALS", [aliasData(warmed.id), boolData(false)]), [
            setVariable(warmed.id, boolData(true)),
            ...Array.from({ length: Math.min(500, o.budget - 3) }, () => flip),
            ...warmup ? [navigateWith(warmup.id, "OVERLAY")] : []
          ])
        ]
      };
      await present.setReactionsAsync([...keyReactions, warm]);
      for (const f of [machine, circuit]) await f.setReactionsAsync(keyReactions);
      setFlows(page, [{ nodeId: present.id, name: FLOW }]);
      const overlayIds = new Set(
        [...chainFrames, ...warmup ? [warmup] : []].map((f) => f.id)
      );
      page.flowStartingPoints = page.flowStartingPoints.filter(
        (f) => !overlayIds.has(f.nodeId)
      );
      const worst = (_a = [...eventSizes.entries()].map(([name, sizes]) => ({ name, actions: Math.max(...sizes) })).sort((a, b) => b.actions - a.actions)[0]) != null ? _a : { name: "-", actions: 0 };
      const heading = (f, title, sub) => {
        put(f, text(this.api, title, { size: 24, bold: true }), PAD3, 28);
        put(f, text(this.api, sub, { size: 13, color: COLORS.dim }), PAD3, 64);
      };
      heading(
        machine,
        "CPU NATHAN \u2014 the machine",
        `All ${net.gates.length} gates, one lamp each, by module \xB7 ${ids.length} wires (variables) \xB7 ${catalog.size} reactions, longest ${worst.actions} actions in one event (${worst.name}). Press the editor's shortcut keys here and watch them compute.`
      );
      heading(
        circuit,
        "CPU NATHAN \u2014 the circuit",
        `Every gate and wire, live. Pick a module to scroll the window to it, or scroll inside the window.`
      );
      remember(this.api, page);
      this.progress("os", steps, steps, "done");
      if (torn.length)
        this.log(
          "error",
          `the register writes of ${torn.join(", ")} do not fit one event of ${o.budget}: they are cut, so a fast second input could see them half done`
        );
      const chainedRuns = [...eventSizes.entries()].filter(([, sizes]) => sizes.length > 1);
      if (chainedRuns.length)
        this.log(
          "info",
          `${chainedRuns.length} reaction(s) longer than ${o.budget} actions run as a few events through timed overlays: ${chainedRuns.map(([n, sizes]) => `${n} (${sizes.length})`).join(", ")}`
        );
      const tooLong = [...eventSizes.entries()].filter(([, sizes]) => Math.max(...sizes) > o.budget);
      if (tooLong.length)
        this.log(
          "error",
          `${tooLong.length} reaction(s) have a single step longer than ${o.budget} actions: ${tooLong.map(([n]) => n).join(", ")}`
        );
      if (result.missing.length)
        this.log(
          "error",
          `${result.missing.length} screen binding(s) have no variable, e.g. ${result.missing.slice(0, 3).join(", ")}`
        );
      const stats = {
        gates: net.gates.length,
        variables: ids.length + ptrSpecs.length,
        collections: collections.length + 1,
        reactions: catalog.size,
        worstReaction: worst,
        bound: bound + result.bound + map.bound + keysBound,
        missing: result.missing.length + map.missing.length,
        uiLayers: result.created + map.created,
        ms: this.now() - t0
      };
      this.post({ type: "os", stats });
      this.log(
        "ok",
        `built: ${stats.uiLayers} editor layers, ${stats.variables} variables, ${stats.bound} bindings, longest event ${worst.actions} actions (${(stats.ms / 1e3).toFixed(1)} s). \u25B6 Present the flow "${FLOW}" (from the frame "${PRESENT}"), or press Self-test.`
      );
      try {
        this.api.viewport.scrollAndZoomIntoView([present]);
      } catch (e) {
      }
      return stats;
    }
    /** Removes the collections `createVariables(name)` made, a few hundred variables at a time with a
     * breath in between: removing thousands at once can drop Figma's connection to its server. */
    async removeGently(name) {
      const isOurs = (c) => c === name || new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \xB7 \\d+$`).test(c);
      const colls = (await this.api.variables.getLocalVariableCollectionsAsync()).filter((c) => isOurs(c.name));
      if (!colls.length) return;
      const ids = new Set(colls.map((c) => c.id));
      const vars = (await this.api.variables.getLocalVariablesAsync()).filter((v) => ids.has(v.variableCollectionId));
      for (let i = 0; i < vars.length; i++) {
        vars[i].remove();
        if (i % 250 === 249) await this.breathe();
      }
      for (const c of colls) c.remove();
      await this.breathe();
    }
    // ---------- 3. self-test ----------
    async selftest(events, seed) {
      const r = await this.phase(
        "self-test",
        () => selfTest(this.api, { events, seed })
      );
      this.post({ type: "selftest", result: r });
      this.log(r.ok ? "ok" : "error", r.text);
      return r;
    }
    // ---------- 4. platform tests ----------
    async platform() {
      const { page } = await ensurePage(this.api, (m) => this.log("info", m));
      remember(this.api, page);
      await page.loadAsync();
      await this.api.setCurrentPageAsync(page);
      const { frames, tests } = await this.phase(
        "platform tests",
        () => buildPlatformTests(this.api, page, (m) => this.log("info", m))
      );
      this.post({ type: "platform", tests });
      this.log(
        "ok",
        `${frames.length} platform tests built. \u25B6 Present, choose a flow named "${TEST_PREFIX}\u2026", follow the text in its frame. The first one finds your viewer's real limit.`
      );
      try {
        this.api.viewport.scrollAndZoomIntoView(frames);
      } catch (e) {
      }
      return tests;
    }
    // ---------- 5. clean ----------
    async clean() {
      const page = await findPage(this.api);
      let removed = 0;
      if (page) {
        await page.loadAsync();
        await this.releaseMachine(page, false);
        for (const n of [...page.children])
          if (n.name === PRESENT || n.name === MACHINE || n.name === CIRCUIT || n.name.startsWith(TEST_PREFIX)) {
            n.remove();
            removed++;
          }
      }
      for (const c of [COLLECTION, UI_COLLECTION, TEST_COLLECTION])
        removed += await removeCollections(this.api, c);
      this.log(
        "ok",
        `removed ${removed} thing(s) (frames and variable collections); the drawn hardware stays`
      );
    }
  };
  function findCell(page, name) {
    var _a;
    const full = `${CELL_PREFIX}${name}`;
    const top = page.children.find(
      (n) => n.type === "COMPONENT" && n.name === full
    );
    if (top) return top;
    return (_a = page.findAllWithCriteria({ types: ["COMPONENT"] }).find((n) => n.name === full)) != null ? _a : null;
  }

  // nathan/plugin/src/main.ts
  figma.showUI(__html__, { width: 420, height: 720, title: "CPU NATHAN" });
  var post = (m) => {
    if (m.type === "log") console.log(`[nathan] ${m.level}: ${m.text}`);
    figma.ui.postMessage(m);
  };
  var app = new NathanApp(figma, post);
  figma.ui.onmessage = (msg) => {
    void app.handle(msg);
  };
})();
