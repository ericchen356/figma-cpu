// make/os-emu.js
var FNS = {
  1: (a, b) => a && b,
  2: (a, b) => a || b,
  3: (a) => !a,
  4: (a, b) => same(a, b),
  5: (a, b) => !same(a, b),
  6: (a, b) => typeof a === "string" || typeof b === "string" ? `${a}${b}` : a + b,
  7: (a, b) => a - b,
  8: (a, b) => a * b,
  9: (a, b) => a / b,
  10: (a) => -a,
  11: (a, b) => a < b,
  12: (a, b) => a <= b,
  13: (a, b) => a > b,
  14: (a, b) => a >= b
};
var same = (a, b) => Array.isArray(a) && Array.isArray(b) ? a.every((x, i) => Math.abs(x - b[i]) < 1e-6) : a === b;
var OsEmulator = class {
  constructor(data, { hopMs = 10, instant = false } = {}) {
    this.data = data;
    this.hopMs = hopMs;
    this.instant = instant;
    this.names = new Map(data.vars.map((v, i) => [v[0], i]));
    this.nodesOf = data.roots.map(() => []);
    this.timeout = data.roots.map(() => 0);
    this.depth = [];
    data.nodes.forEach((n, i) => {
      this.nodesOf[n[0]].push(i);
      this.depth[i] = n[7] < 0 ? 0 : this.depth[n[7]] + 1;
      if (n[7] < 0) {
        for (const [t] of n[8]) if (t[0] === "T") this.timeout[n[0]] = t[1];
      }
    });
    for (const list of this.nodesOf) list.reverse();
    this.dyn = new Map((data.dyn ?? []).map((d) => [d[0], d]));
    this.layout = data.layout ?? [];
    this.lbox = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
    this.restart();
  }
  restart() {
    clearTimeout(this.timer);
    this.values = this.data.vars.map((v) => v[3]);
    this.version = 0;
    this.laidOut = -1;
    this.overlays = [];
    this.held = false;
    this.pressTarget = null;
    this.hover = -1;
    this.changed = new Set(this.values.keys());
    this.emit({ type: "restart" });
  }
  on(f) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  emit(e) {
    for (const f of this.listeners) f(e, this);
  }
  value(name) {
    return this.values[this.names.get(name)];
  }
  // ---- input, in frame coordinates
  press(x, y) {
    this.held = true;
    const d = this.hit("D", x, y);
    this.pressTarget = d < 0 ? this.hit("C", x, y) : -1;
    this.pressTook = d >= 0;
    if (d >= 0) this.fire(d, "D");
  }
  release(x, y) {
    this.held = false;
    const u = this.hit("U", x, y);
    if (u >= 0) this.fire(u, "U");
    else if (!this.pressTook && this.pressTarget >= 0 && this.hit("C", x, y) === this.pressTarget)
      this.fire(this.pressTarget, "C");
    this.pressTarget = null;
  }
  move(x, y) {
    if (this.held) return;
    const e = this.hit("E", x, y);
    if (e !== this.hover && e >= 0) this.fire(e, "E");
    this.hover = e;
  }
  key(codes) {
    const want = [...codes].sort((a, b) => a - b).join(",");
    let best = -1;
    for (const i of this.nodesOf[this.root()]) {
      if (!this.shows(i)) continue;
      if (!this.data.nodes[i][8].some(
        ([t]) => t[0] === "K" && [...t[1]].sort((a, b) => a - b).join(",") === want
      ))
        continue;
      if (best < 0 || this.depth[i] > this.depth[best]) best = i;
    }
    if (best >= 0) this.fire(best, "K", want);
    return best >= 0;
  }
  // ---- the viewer
  root() {
    return this.overlays.length ? this.overlays[this.overlays.length - 1] : 0;
  }
  shows(i) {
    return this.data.nodes[i][6].every((v) => this.values[v] === true);
  }
  reaction(i, type, chord) {
    return this.data.nodes[i][8].find(
      ([t]) => t[0] === type && (type !== "K" || [...t[1]].sort((a, b) => a - b).join(",") === chord)
    );
  }
  hit(type, x, y) {
    for (const i of this.nodesOf[this.root()]) {
      const [bx, by, bw, bh] = this.box(i);
      if (x < bx || y < by || x >= bx + bw || y >= by + bh || !this.shows(i))
        continue;
      for (let j = i; j >= 0; j = this.data.nodes[j][7])
        if (this.reaction(j, type)) return j;
    }
    return -1;
  }
  // A layer's box in root coordinates. The editor stores boxes as laid out at power-on: layers in
  // auto layout move as their siblings show and hide (reflow), and the resize handles move with
  // their slot's spacer bits (tools/build-data.mjs).
  box(i) {
    const d = this.dyn.get(i);
    if (!d) {
      if (this.laidOut !== this.version) this.reflow();
      return this.lbox.get(i) ?? this.data.nodes[i].slice(2, 6);
    }
    const [, right, bottom, w, h, vx, vy, ys, xs, ws, hs] = d;
    const sum = (list) => list.reduce(
      (t, [v, size]) => t + (v < 0 || this.values[v] === true ? size : 0),
      0
    );
    const cx = vx + sum(xs) + (right ? sum(ws) : 0);
    const cy = vy + sum(ys) + (bottom ? sum(hs) : 0);
    const slack = 2;
    return [
      cx - w / 2 - slack,
      cy - h / 2 - slack,
      w + 2 * slack,
      h + 2 * slack
    ];
  }
  // Auto layout as Figma does it, for the trees that hold clickable layers: hidden children take no
  // room, hug sizes add up the shown children, fill children share what is left.
  // row: [node, vis, mode, w, h, ox, oy, sizingH, sizingV, pad, gap, pAlign, cAlign, stretch, grow,
  //       absolute, kids]
  reflow() {
    this.lbox = /* @__PURE__ */ new Map();
    const shown = (n) => n[1] < 0 || this.values[n[1]] === true;
    const flow = (n) => n[16].filter((c) => shown(c) && !c[15]);
    const measure = (n) => {
      if (!n[2]) return [n[3], n[4]];
      const H = n[2] === 1;
      const kids = flow(n);
      const [pl, pr, pt, pb] = n[9];
      let main = kids.length ? n[10] * (kids.length - 1) : 0;
      let cross = 0;
      for (const c of kids) {
        const [cw, ch] = measure(c);
        main += H ? cw : ch;
        cross = Math.max(cross, H ? ch : cw);
      }
      const hugW = H ? main + pl + pr : cross + pl + pr;
      const hugH = H ? cross + pt + pb : main + pt + pb;
      return [n[7] === 1 ? hugW : n[3], n[8] === 1 ? hugH : n[4]];
    };
    const place = (n, x, y, w, h) => {
      if (n[0] >= 0) this.lbox.set(n[0], [x, y, w, h]);
      const kids = n[16].filter(shown);
      if (!n[2]) {
        for (const c of kids) place(c, x + c[5], y + c[6], c[3], c[4]);
        return;
      }
      const H = n[2] === 1;
      const [pl, pr, pt, pb] = n[9];
      for (const c of kids) if (c[15]) place(c, x + c[5], y + c[6], c[3], c[4]);
      const items = kids.filter((c) => !c[15]).map((c) => {
        const [cw, ch] = measure(c);
        return {
          c,
          main: H ? cw : ch,
          cross: H ? ch : cw,
          flex: (H ? c[7] : c[8]) === 2 || c[14] > 0,
          fillCross: c[13] === 1 || (H ? c[8] : c[7]) === 2
        };
      });
      const inner = H ? w - pl - pr : h - pt - pb;
      const innerCross = H ? h - pt - pb : w - pl - pr;
      const nflex = items.filter((t) => t.flex).length;
      const fixed = items.reduce((t, it) => t + (it.flex ? 0 : it.main), 0);
      let gap = n[10];
      const free = inner - fixed - gap * Math.max(0, items.length - 1);
      const flexSize = nflex ? Math.max(0, free / nflex) : 0;
      let pos = 0;
      if (!nflex) {
        if (n[11] === 1) pos = free / 2;
        else if (n[11] === 2) pos = free;
        else if (n[11] === 3 && items.length > 1)
          gap += free / (items.length - 1);
      }
      for (const it of items) {
        const m = it.flex ? flexSize : it.main;
        const cs = it.fillCross ? innerCross : it.cross;
        const off = n[12] === 1 ? (innerCross - cs) / 2 : n[12] === 2 ? innerCross - cs : 0;
        if (H) place(it.c, x + pl + pos, y + pt + off, m, cs);
        else place(it.c, x + pl + off, y + pt + pos, cs, m);
        pos += m + gap;
      }
    };
    for (const t of this.layout) {
      if (!shown(t)) continue;
      const [w, h] = measure(t);
      place(t, t[5], t[6], w, h);
    }
    this.laidOut = this.version;
  }
  fire(i, type, chord) {
    const r = this.reaction(i, type, chord);
    if (!r) return;
    this.emit({ type: "fire", node: i, trigger: type });
    this.chain(r[1]);
  }
  // A trigger's actions, then each timed overlay it opens; a chain already running keeps going
  // (Stop sets a variable the next hop reads).
  chain(list) {
    for (let hop = 0; hop < 1e5; hop++) {
      const { nav, closed } = this.run(this.data.lists[list]);
      if (nav) {
        if (nav.how === "S" && this.overlays.length)
          this.overlays[this.overlays.length - 1] = nav.root;
        else if (nav.how === "O" || nav.how === "S")
          this.overlays.push(nav.root);
        const next = this.data.roots[nav.root][3];
        if (next < 0) break;
        if (!this.instant) {
          this.timer = setTimeout(
            () => this.chain(next),
            this.timeout[nav.root] * 1e3 + this.hopMs
          );
          break;
        }
        list = next;
        continue;
      }
      if (closed) this.overlays.pop();
      break;
    }
    this.flush();
  }
  run(list) {
    let nav = null, closed = false;
    const go = (acts) => {
      for (const a of acts) {
        if (a[0] === 0) {
          const v = this.eval(a[2]);
          if (!same(this.values[a[1]], v)) {
            this.values[a[1]] = v;
            this.changed.add(a[1]);
            this.version++;
          }
        } else if (a[0] === 1) {
          for (const [cond, body] of a[1]) {
            if (cond !== null && this.eval(cond) !== true) continue;
            go(body);
            break;
          }
        } else if (a[0] === 2) {
          if (a[1] >= 0) nav = { root: a[1], how: a[2] };
        } else if (a[0] === 3) closed = true;
      }
    };
    go(list);
    return { nav, closed };
  }
  eval(x) {
    if (typeof x === "number") return this.values[x];
    if (Array.isArray(x))
      return FNS[x[0]](...x.slice(1).map((a) => this.eval(a)));
    if (x && typeof x === "object") return "k" in x ? x.k : x.c;
    return x;
  }
  flush() {
    if (!this.changed.size) return;
    const changed = this.changed;
    this.changed = /* @__PURE__ */ new Set();
    this.emit({ type: "change", changed });
  }
};

// make/realtime.js
function realtimeChannel({
  ref,
  key,
  channel,
  onMessage,
  onStatus = () => {
  }
}) {
  const topic = `realtime:${channel}`;
  let ws = null, joined = false, refNo = 0, heartbeat = null, retry = 0, closed = false;
  const queue = [];
  const raw = (event, payload, t = topic) => {
    const msg = JSON.stringify({
      topic: t,
      event,
      payload,
      ref: String(++refNo),
      join_ref: "1"
    });
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
  };
  function open() {
    if (closed) return;
    onStatus("connecting");
    ws = new WebSocket(
      `wss://${ref}.supabase.co/realtime/v1/websocket?apikey=${key}&vsn=1.0.0`
    );
    ws.onopen = () => {
      retry = 0;
      raw("phx_join", {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: "" },
          private: false
        },
        access_token: key
      });
      heartbeat = setInterval(() => raw("heartbeat", {}, "phoenix"), 2e4);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.event === "phx_reply" && m.topic === topic && m.payload?.status === "ok" && !joined) {
        joined = true;
        onStatus("live");
        while (queue.length) send(...queue.shift());
      } else if (m.event === "broadcast" && m.topic === topic) {
        onMessage?.(m.payload.event, m.payload.payload);
      }
    };
    ws.onclose = () => {
      joined = false;
      clearInterval(heartbeat);
      if (closed) return onStatus("off");
      onStatus("reconnecting");
      setTimeout(open, Math.min(8e3, 500 * 2 ** retry++));
    };
    ws.onerror = () => ws.close();
  }
  function send(event, payload) {
    if (!joined) {
      if (event === "cpu") {
        const i = queue.findIndex(([e]) => e === "cpu");
        if (i >= 0) queue.splice(i, 1);
      }
      queue.push([event, payload]);
      return;
    }
    raw("broadcast", { type: "broadcast", event, payload });
  }
  open();
  return {
    send,
    get live() {
      return joined;
    },
    close() {
      closed = true;
      ws?.close();
    }
  };
}

// make/os-link.js
var SUPABASE_REF = "tyewtrrwvzvginqoqwxs";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5ZXd0cnJ3dnp2Z2lucW9xd3hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4OTIzNjgsImV4cCI6MjEwODQ2ODM2OH0.TGenUQuD1500zlpmvyhv-yUPa8SAVpf4-ebM9yDsMGk";
var BLOCKS = [
  ["Display decode", (b) => b === "disp"],
  ["Editor logic", (b) => b === "u"],
  ["Screen lines", (b) => b === "ui"],
  ["Layer registers L0\u2013L7", (b) => /^L\d$/.test(b)],
  [
    "Datapath \xB7 add, sub, mux, clip",
    (b) => [
      "d",
      "add",
      "sub",
      "neg",
      "mux",
      "clip",
      "r",
      "load",
      "glue",
      "and"
    ].includes(b)
  ],
  ["Toolbar memory", (b) => b === "pick"],
  ["Global registers", (b) => b === "g"],
  ["Inputs and clock", () => true]
];
async function loadOsData(base = "/data/") {
  const { parts } = await (await fetch(`${base}os-index.json`)).json();
  const texts = await Promise.all(
    Array.from({ length: parts }, async (_, k) => {
      const r = await fetch(`${base}os-${k}.txt`);
      if (!r.ok) throw new Error(`Failed to load Figma OS data: os-${k}.txt`);
      return r.text();
    })
  );
  return JSON.parse(texts.join(""));
}
function applyInput(emu, ev) {
  if (ev.k === "r") emu.restart();
  else if (ev.k === "d") emu.press(ev.x, ev.y);
  else if (ev.k === "u") emu.release(ev.x, ev.y);
  else if (ev.k === "m") emu.move(ev.x, ev.y);
  else if (ev.k === "k") emu.key(ev.c);
}
async function connectOsLink({
  channel = new URLSearchParams(location.search).get("channel") || "figma-cpu",
  parent = document.querySelector("#viewport")
} = {}) {
  const data = await loadOsData();
  const emu = new OsEmulator(data);
  const wires = [];
  data.vars.forEach((v, i) => {
    if (v[2] !== "B" || !v[0].startsWith("net/") || !data.colls[v[1]].startsWith("Figma OS \xB7 CPU"))
      return;
    const base = v[0].slice(4).replace(/\[\d+\]$/, "").split(/[_/[]/)[0];
    wires.push({ i, block: BLOCKS.findIndex(([, f]) => f(base)) });
  });
  const P = 4, COLS = 128, W = COLS * P + 24;
  const layout = [];
  let y = 0;
  BLOCKS.forEach(([title], b) => {
    const mine = wires.filter((w) => w.block === b);
    if (!mine.length) return;
    layout.push({ title, y, n: mine.length });
    y += 16;
    mine.forEach((w, k) => {
      w.x = 12 + k % COLS * P;
      w.y = y + Math.floor(k / COLS) * P;
    });
    y += Math.ceil(mine.length / COLS) * P + 8;
  });
  const flash = new Float64Array(data.vars.length);
  const panel = document.createElement("section");
  panel.id = "os-chip";
  panel.style.cssText = "position:absolute;right:18px;top:84px;z-index:6;width:" + W + "px;max-height:calc(100% - 160px);overflow:auto;padding:12px 0 8px;border-radius:14px;background:rgba(7,20,38,.86);border:1px solid rgba(117,179,231,.3);box-shadow:0 18px 50px rgba(0,0,0,.4);backdrop-filter:blur(18px);font:11px -apple-system,BlinkMacSystemFont,sans-serif;color:#bcd6ea";
  panel.innerHTML = `<div style="padding:0 12px 8px;display:flex;justify-content:space-between;gap:8px"><b style="color:#f2f8ff;font-size:12px;letter-spacing:.04em">FIGMA OS CHIP \xB7 ${wires.length.toLocaleString()} wires</b><span id="os-status">connecting\u2026</span></div><div id="os-last" style="padding:0 12px 8px;font:11px monospace;color:#ffe08a;min-height:14px"></div>`;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = y * dpr;
  canvas.style.cssText = `width:${W}px;height:${y}px;display:block`;
  const sync = document.createElement("div");
  sync.style.cssText = "padding:0 12px 8px;font:11px -apple-system,sans-serif;color:#8fb7d6";
  panel.append(sync, canvas);
  parent.append(panel);
  const toggle = document.createElement("button");
  toggle.textContent = "Figma OS chip";
  toggle.title = "Show the Figma OS chip, live from Figma";
  toggle.style.cssText = "position:absolute;top:15px;right:118px;z-index:7;padding:10px 14px;border-radius:12px;background:rgba(73,107,139,.36)";
  toggle.onclick = () => {
    panel.hidden = !panel.hidden;
  };
  parent.append(toggle);
  const hud = document.querySelector("#live-hud");
  if (hud) hud.style.right = "250px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  let dirty = true;
  function draw(now) {
    if (!dirty) return;
    dirty = false;
    ctx.clearRect(0, 0, W, y);
    ctx.font = "600 10px -apple-system,sans-serif";
    for (const l of layout) {
      ctx.fillStyle = "#7fb3d9";
      ctx.fillText(`${l.title.toUpperCase()} \xB7 ${l.n}`, 12, l.y + 11);
    }
    for (const w of wires) {
      const age = now - flash[w.i];
      const on = emu.values[w.i] === true;
      if (age < 600) {
        ctx.fillStyle = on ? "#ffffff" : "#7fd3ff";
        dirty = true;
      } else ctx.fillStyle = on ? "#ffe552" : "#173540";
      ctx.fillRect(w.x, w.y, P - 1, P - 1);
    }
  }
  (function frame(now) {
    draw(now);
    requestAnimationFrame(frame);
  })(performance.now());
  let lastLabel = "", switched = 0;
  const show = (text) => {
    panel.querySelector("#os-last").textContent = text;
  };
  emu.on((e) => {
    if (e.type === "fire") {
      lastLabel = data.labels?.[e.node] ?? lastLabel;
      switched = 0;
    } else if (e.type === "change") {
      const now = performance.now();
      for (const i of e.changed) flash[i] = now;
      switched += e.changed.size;
      show(
        `${lastLabel || "input"} \xB7 ${switched.toLocaleString()} variables switched`
      );
      dirty = true;
    } else if (e.type === "restart") {
      show("prototype started");
      dirty = true;
    }
  });
  let pending = null, buffer = [], lastN = 0;
  const parts = /* @__PURE__ */ new Map();
  const status = (t) => {
    panel.querySelector("#os-status").textContent = t;
  };
  const rt = realtimeChannel({
    ref: SUPABASE_REF,
    key: SUPABASE_ANON_KEY,
    channel,
    onStatus: (s) => {
      status(s === "live" ? "live \xB7 waiting for Figma" : s);
      if (s === "live") {
        pending = Date.now();
        rt.send("os-hello", {});
        setTimeout(() => {
          if (pending) {
            pending = null;
            buffer.forEach(feed);
            buffer = [];
          }
        }, 4e3);
      }
    },
    onMessage: (event, p) => {
      if (event === "os") {
        status("live from Figma");
        if (pending) buffer.push(p);
        else feed(p);
      } else if (event === "os-log" && pending) {
        parts.set(p.i, p.log);
        if (parts.size < p.parts) return;
        const log = [...Array(p.parts).keys()].flatMap((i) => parts.get(i));
        parts.clear();
        pending = null;
        emu.instant = true;
        emu.restart();
        for (const ev of log) feed(ev);
        emu.instant = false;
        for (const ev of buffer) if ((ev.n ?? 0) > lastN) feed(ev);
        buffer = [];
        status("live from Figma");
      }
    }
  });
  function feed(ev) {
    if (ev.n) lastN = Math.max(lastN, ev.n);
    if (ev.k === "c") return void setTimeout(() => check(ev), 600);
    applyInput(emu, ev);
    dirty = true;
  }
  const word = (p, bits) => {
    let v = 0;
    for (let b = 0; b < bits; b++) if (emu.value(`net/${p}[${b}]`) === true) v |= 1 << b;
    return v;
  };
  function check(c) {
    const off = [];
    if (c.n !== void 0 && word("g_n", 4) !== c.n) off.push(`layers ${c.n} in Figma, ${word("g_n", 4)} here`);
    const sel = [...Array(8).keys()].find((k) => emu.value(`net/ui_slots_${k}_sel`) === true);
    if (sel !== void 0) {
      for (const [f, reg] of [["x", "x"], ["y", "y"], ["w", "w"], ["h", "h"]])
        if (c[f] !== void 0 && c[f] >= 0 && c[f] < 32 && word(`L${sel}_${reg}`, 5) !== c[f])
          off.push(`${f.toUpperCase()} ${c[f]} in Figma, ${word(`L${sel}_${reg}`, 5)} here`);
    }
    if (sel !== void 0 && c.fill && emu.value(`ui/L${sel}/fill/hex`) !== c.fill)
      off.push(`fill ${c.fill} in Figma, ${emu.value(`ui/L${sel}/fill/hex`)} here`);
    sync.textContent = off.length ? `\u26A0 out of step with Figma (${off.join(", ")}): press R in Figma's Present to start both over` : "\u2713 in step with Figma";
    sync.style.color = off.length ? "#ff9b8a" : "#7dffb0";
  }
  return { emu, rt, panel };
}
export {
  applyInput,
  connectOsLink,
  loadOsData
};
