// Reads the CPU's clock from Figma Present's screen-reader mirror (Options → Accessibility settings →
// "Adapt content for screen readers"): every shown text layer is a DOM node there, and text bound to
// a variable updates as the prototype runs. Nothing is added to the Figma file.
//
// FINAL CPU's CPU tab (silicon/livetab) shows "<n> ticks" and "<p> phase (of 10)"; while Run plays,
// only its overlay is mirrored ("Running · chunk k of 10"), so ticks are counted from chunk wraps and
// corrected the moment the counters show again. The loaded program is the highlighted chip, which
// only differs by colour, so it is read from a screenshot of the tab.
(() => {
  if (window.__figmaCpuLiveLink) return;
  window.__figmaCpuLiveLink = true;

  // The CPU tab's program chips, in order (livetab: PROGRAMS, then "custom"), 11 per row.
  const PROGRAMS = [
    "count",
    "mul",
    "fib",
    "sub",
    "logic",
    "mem",
    "pow2",
    "triangle",
    "mod",
    "blink",
    "lfsr",
    "echo",
    "keypad",
    "ptrout",
    "copy",
    "dump",
    "custom",
  ];
  // After the extension is reloaded, a copy left in an open tab loses chrome.runtime: it stops.
  let stopped = false;
  let readOsCheck = null; // set below, with the Figma OS part
  const bus = window.__liveLinkBus ?? {
    send: (msg) => {
      if (!chrome.runtime?.id) {
        stopped = true;
        return Promise.resolve(null);
      }
      return chrome.runtime.sendMessage(msg).catch(() => null);
    },
  };

  const state = {
    // FINAL CPU powers on with ptrout loaded; the screenshot corrects it.
    program: "ptrout",
    tick: null,
    phase: 0,
    phases: 10,
    running: false,
    loading: false,
    exact: false,
  };
  let lastChunk = null,
    sentKey = "",
    lastSent = 0,
    anchors = null,
    needProgram = true,
    lastPick = 0,
    picking = false;

  function texts() {
    const root = document.querySelector(
      'main[class*="accessibilitytree--container"]',
    );
    if (!root) return null;
    const out = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walk.nextNode(); el; el = walk.nextNode()) {
      if (el.childElementCount) continue;
      const t = el.textContent.trim();
      if (t) out.push({ el, t });
    }
    return out;
  }

  function read() {
    const L = texts();
    if (!L) return;
    readOsCheck?.(L);
    let tick = null,
      phase = null,
      chunk = null,
      loading = false,
      ticksLabel = null,
      phaseLabel = null;
    L.forEach(({ el, t }, i) => {
      const prev = L[i - 1]?.t;
      let m;
      if (t === "ticks" && /^\d+$/.test(prev)) {
        tick = +prev;
        ticksLabel = el;
      } else if ((m = /^phase \(of (\d+)\)$/.exec(t)) && /^\d+$/.test(prev)) {
        phase = +prev;
        phaseLabel = el;
        state.phases = +m[1];
      } else if ((m = /^Running · chunk (\d+) of (\d+)$/.exec(t))) {
        chunk = +m[1];
        state.phases = +m[2];
      } else if (/^Loading the program/.test(t)) loading = true;
    });

    if (loading && !state.loading) needProgram = true;
    state.loading = loading;
    if (tick !== null && phase !== null) {
      // The counters are on screen: exact.
      if (tick < (state.tick ?? 0)) needProgram = true; // Reset or a program load
      Object.assign(state, { tick, phase, running: false, exact: true });
      lastChunk = null;
      anchors = { ticksLabel, phaseLabel };
    } else if (chunk !== null && state.tick !== null) {
      // Run in place: overlay k runs chunk k, so a lower k than last time means a new tick.
      if (lastChunk !== null && chunk < lastChunk) state.tick++;
      lastChunk = chunk;
      Object.assign(state, {
        phase: (chunk - 1) % state.phases,
        running: true,
        exact: false,
      });
    } else if (!chunk) {
      state.running = false;
    }
    if (
      anchors &&
      tick !== null &&
      !loading &&
      !picking &&
      (needProgram || Date.now() - lastPick > 3000)
    )
      pickProgram();
    publish();
  }

  // The chips sit at fixed offsets from the "ticks" label in the CPU tab's layout (livetab:
  // label at bar x 354, chips from x 424 in steps of 62, rows 22 apart, 58 × 19). The two labels
  // are 70 design px apart, which gives the viewer's scale.
  async function pickProgram() {
    picking = true;
    lastPick = Date.now();
    needProgram = false;
    try {
      const t = anchors.ticksLabel.getBoundingClientRect();
      const p = anchors.phaseLabel.getBoundingClientRect();
      const s = (t.left - p.left) / 70;
      if (!(s > 0.2 && s < 5)) return;
      const shot = await bus.send({ type: "capture" });
      if (!shot?.url) return;
      const img = await createImageBitmap(await (await fetch(shot.url)).blob());
      const c = new OffscreenCanvas(img.width, img.height).getContext("2d", {
        willReadFrequently: true,
      });
      c.drawImage(img, 0, 0);
      const k = img.width / window.innerWidth;
      const blue = (x, y) => {
        const [r, g, b] = c.getImageData(
          Math.round(x * k),
          Math.round(y * k),
          1,
          1,
        ).data;
        return b - (r + g) / 2;
      };
      // Sample each chip's fill inside both ends at mid-height, clear of its centred name.
      const ranked = PROGRAMS.map((name, e) => {
        const x = t.left + (70 + (e % 11) * 62) * s;
        const y = t.top + (Math.floor(e / 11) * 22 + 9.5) * s;
        return [name, Math.min(blue(x + 5 * s, y), blue(x + 53 * s, y))];
      }).sort((a, b) => b[1] - a[1]);
      state.scores = ranked
        .slice(0, 3)
        .map(([n, v]) => `${n}:${Math.round(v)}`)
        .join(" ");
      if (ranked[0][1] > 25 && ranked[0][1] - ranked[1][1] > 15) {
        // "custom" is a copy of the boot program (ptrout) that the user can edit.
        state.program = ranked[0][0] === "custom" ? "ptrout" : ranked[0][0];
        publish();
      }
    } finally {
      picking = false;
    }
  }

  function publish(force = false) {
    if (state.tick === null) return;
    const key = `${state.program}|${state.tick}|${state.phase}|${state.running}`;
    if (!force && key === sentKey) return;
    sentKey = key;
    lastSent = Date.now();
    bus.send({ type: "cpu", state: { ...state, seq: lastSent } });
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (stopped) return observer.disconnect();
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      read();
    });
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  // A keyframe every 2 s, so a listener that joins late catches up.
  const timer = setInterval(() => {
    if (stopped) return clearInterval(timer);
    read();
    if (Date.now() - lastSent > 2000) publish(true);
  }, 1000);

  // ---- the Figma OS: every pointer and key input on the frame, in frame coordinates, so the
  // Make app's emulator (make/os-emu.js) runs the same reactions on the same variables. The
  // prototype starts over when this page loads and on Restart; `log` holds the inputs since then
  // for a listener that joins late.
  const FRAME = "os-ui · live (gate-level CPU)";
  const FW = 1440,
    FH = 900;
  const log = [];
  let inputNo = 0;
  let held = false,
    lastMove = 0,
    lastXY = [-1, -1];
  // The frame's box on screen: the screen-reader mirror's article for it, or a contain-fit in the
  // canvas when the mirror is off.
  function frameBox() {
    const a = document.querySelector(`article[aria-label="${FRAME}"]`);
    const r = a?.getBoundingClientRect();
    if (r && r.width > 0) return r;
    const c = document.querySelector("canvas")?.getBoundingClientRect();
    if (!c) return null;
    const s = Math.min(c.width / FW, c.height / FH);
    return {
      left: c.left + (c.width - FW * s) / 2,
      top: c.top + (c.height - FH * s) / 2,
      width: FW * s,
      height: FH * s,
    };
  }
  const inCanvas = (e) => {
    const c = document.querySelector("canvas")?.getBoundingClientRect();
    return (
      c &&
      e.clientX >= c.left &&
      e.clientX < c.right &&
      e.clientY >= c.top &&
      e.clientY < c.bottom
    );
  };
  const toFrame = (e) => {
    const b = frameBox();
    if (!b) return null;
    return [
      Math.round((((e.clientX - b.left) * FW) / b.width) * 10) / 10,
      Math.round((((e.clientY - b.top) * FH) / b.height) * 10) / 10,
    ];
  };
  function os(ev) {
    if (stopped) return;
    ev.t = Date.now();
    ev.n = ++inputNo;
    if (ev.k === "r") log.length = 0;
    else log.push(ev);
    bus.send({ type: "os", ev });
  }
  os({ k: "r" });
  addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || !inCanvas(e)) return;
      const p = toFrame(e);
      if (!p) return;
      held = true;
      os({ k: "d", x: p[0], y: p[1] });
    },
    true,
  );
  addEventListener(
    "pointerup",
    (e) => {
      if (e.button !== 0 || !held) return;
      held = false;
      const p = toFrame(e);
      if (p) os({ k: "u", x: p[0], y: p[1] });
    },
    true,
  );
  addEventListener(
    "pointermove",
    (e) => {
      if (held || !inCanvas(e) || Date.now() - lastMove < 40) return;
      const p = toFrame(e);
      if (!p || Math.hypot(p[0] - lastXY[0], p[1] - lastXY[1]) < 3) return;
      lastMove = Date.now();
      lastXY = p;
      os({ k: "m", x: p[0], y: p[1] });
    },
    true,
  );
  // Figma's key codes: a chord is the modifiers held plus the key. Only keys the prototype takes
  // count: it stops those, while one it ignores (the first after a click, which goes to the focused
  // screen-reader node) reaches the window's bubble phase.
  let pendingKey = null;
  addEventListener(
    "keydown",
    (e) => {
      if (e.repeat || [16, 17, 18, 91, 93].includes(e.keyCode)) return;
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? ""))
        return;
      const codes = [];
      if (e.shiftKey) codes.push(16);
      if (e.ctrlKey) codes.push(17);
      if (e.altKey) codes.push(18);
      if (e.metaKey) codes.push(91);
      codes.push(e.keyCode);
      pendingKey = e;
      setTimeout(() => {
        if (pendingKey === e) os({ k: "k", c: codes });
        if (pendingKey === e) pendingKey = null;
      }, 0);
    },
    true,
  );
  addEventListener("keydown", (e) => {
    if (pendingKey === e) pendingKey = null;
  });
  // Figma's own Restart button starts the prototype over.
  addEventListener(
    "click",
    (e) => {
      if (e.target.closest?.('button[aria-label="Restart"]')) os({ k: "r" });
    },
    true,
  );
  // What the OS shows, from the mirror, so the Make app can tell it is still in step: the layer
  // count ("2/8") and the selected layer's X, Y, W, H and fill (each value comes just before its
  // label). Sent once the screen has settled.
  let lastCheck = "",
    checkTimer = null;
  readOsCheck = (L) => {
    const c = {};
    L.forEach(({ t }, i) => {
      const prev = L[i - 1]?.t;
      let m;
      if ((m = /^(\d+)\/8$/.exec(t))) c.n = +m[1];
      else if (/^[XYWH]$/.test(t) && /^-?\d+$/.test(prev ?? ""))
        c[t.toLowerCase()] = +prev;
      else if (t === "Fill" && /^[0-9A-F]{6}$/.test(prev ?? "")) c.fill = prev;
    });
    const key = JSON.stringify(c);
    if (key === lastCheck || c.n === undefined) return;
    lastCheck = key;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => os({ k: "c", ...c }), 400);
  };
  chrome.runtime?.onMessage?.addListener((msg, _sender, reply) => {
    if (msg.type === "os-log") reply({ log });
  });
})();
