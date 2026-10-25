// An emulator of Figma's prototype viewer for the live Figma OS frame, run on tools/export-os.js data.
// Fed the same pointer and key input as the Figma tab, it runs the same reactions on the same
// variables, so every gate of the OS chip (and Leila's CPU, the draw units, the view switches) takes
// the value it has in Figma.
//
// The viewer, as measured (figma-cpu memory "figma-prototype-facts"):
// - only a layer that shows takes input; layers without reactions let clicks through;
// - a press fires MOUSE_DOWN on the topmost layer under the pointer that has one (a layer above
//   with only ON_CLICK does not stop it); a release fires MOUSE_UP on the layer under it then;
//   ON_CLICK fires only when no layer took the press; a trigger a layer lacks bubbles to its parents;
// - no MOUSE_ENTER while the button is held;
// - a key goes to the deepest showing layer with that chord (a layer's key beats the frame's);
// - OVERLAY opens an overlay, SWAP replaces it, CLOSE closes it; an overlay with AFTER_TIMEOUT runs
//   it after its timeout (plus ~10 ms per hop); while an overlay is open only it takes input.
const FNS = {
  1: (a, b) => a && b,
  2: (a, b) => a || b,
  3: (a) => !a,
  4: (a, b) => same(a, b),
  5: (a, b) => !same(a, b),
  6: (a, b) =>
    typeof a === "string" || typeof b === "string" ? `${a}${b}` : a + b,
  7: (a, b) => a - b,
  8: (a, b) => a * b,
  9: (a, b) => a / b,
  10: (a) => -a,
  11: (a, b) => a < b,
  12: (a, b) => a <= b,
  13: (a, b) => a > b,
  14: (a, b) => a >= b,
};
const same = (a, b) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.every((x, i) => Math.abs(x - b[i]) < 1e-6)
    : a === b;

export class OsEmulator {
  constructor(data, { hopMs = 10, instant = false } = {}) {
    this.data = data;
    this.hopMs = hopMs;
    this.instant = instant; // run overlay chains at once (tests)
    this.names = new Map(data.vars.map((v, i) => [v[0], i]));
    this.nodesOf = data.roots.map(() => []);
    this.timeout = data.roots.map(() => 0);
    this.depth = [];
    data.nodes.forEach((n, i) => {
      this.nodesOf[n[0]].push(i);
      this.depth[i] = n[7] < 0 ? 0 : this.depth[n[7]] + 1;
      if (n[7] < 0)
        for (const [t] of n[8]) if (t[0] === "T") this.timeout[n[0]] = t[1];
    });
    for (const list of this.nodesOf) list.reverse(); // topmost first
    this.dyn = new Map((data.dyn ?? []).map((d) => [d[0], d]));
    this.layout = data.layout ?? [];
    this.lbox = new Map();
    this.listeners = new Set();
    this.restart();
  }

  restart() {
    clearTimeout(this.timer);
    this.values = this.data.vars.map((v) => v[3]);
    this.version = 0; // counts variable changes; the layout is redone when it moves
    this.laidOut = -1;
    this.overlays = []; // open roots, last on top
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
    else if (
      !this.pressTook &&
      this.pressTarget >= 0 &&
      this.hit("C", x, y) === this.pressTarget
    )
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
      if (
        !this.data.nodes[i][8].some(
          ([t]) =>
            t[0] === "K" && [...t[1]].sort((a, b) => a - b).join(",") === want,
        )
      )
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
      ([t]) =>
        t[0] === type &&
        (type !== "K" || [...t[1]].sort((a, b) => a - b).join(",") === chord),
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
    const sum = (list) =>
      list.reduce(
        (t, [v, size]) => t + (v < 0 || this.values[v] === true ? size : 0),
        0,
      );
    const cx = vx + sum(xs) + (right ? sum(ws) : 0);
    const cy = vy + sum(ys) + (bottom ? sum(hs) : 0);
    const slack = 2; // a handle is 8 px; the viewer's hit box is a touch larger
    return [
      cx - w / 2 - slack,
      cy - h / 2 - slack,
      w + 2 * slack,
      h + 2 * slack,
    ];
  }
  // Auto layout as Figma does it, for the trees that hold clickable layers: hidden children take no
  // room, hug sizes add up the shown children, fill children share what is left.
  // row: [node, vis, mode, w, h, ox, oy, sizingH, sizingV, pad, gap, pAlign, cAlign, stretch, grow,
  //       absolute, kids]
  reflow() {
    this.lbox = new Map();
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
      const items = kids
        .filter((c) => !c[15])
        .map((c) => {
          const [cw, ch] = measure(c);
          return {
            c,
            main: H ? cw : ch,
            cross: H ? ch : cw,
            flex: (H ? c[7] : c[8]) === 2 || c[14] > 0,
            fillCross: c[13] === 1 || (H ? c[8] : c[7]) === 2,
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
        const off =
          n[12] === 1
            ? (innerCross - cs) / 2
            : n[12] === 2
              ? innerCross - cs
              : 0;
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
    for (let hop = 0; hop < 100000; hop++) {
      const { nav, closed } = this.run(this.data.lists[list]);
      if (nav) {
        if (nav.how === "S" && this.overlays.length)
          this.overlays[this.overlays.length - 1] = nav.root;
        else if (nav.how === "O" || nav.how === "S")
          this.overlays.push(nav.root);
        const next = this.data.roots[nav.root][3];
        if (next < 0) break; // a menu: waits for input
        if (!this.instant) {
          this.timer = setTimeout(
            () => this.chain(next),
            this.timeout[nav.root] * 1000 + this.hopMs,
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
    let nav = null,
      closed = false;
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
    this.changed = new Set();
    this.emit({ type: "change", changed });
  }
}
