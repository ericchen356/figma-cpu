// Live link to the Figma OS: what is done in FINAL CPU's Present tab (clicks, drags, keys on the OS
// frame, streamed by the "Figma CPU Live Link" extension) runs here on the same reactions and the same
// variables (os-emu.js), and the OS chip's gates are drawn as they switch.
import { OsEmulator } from "./os-emu.js";
import { realtimeChannel } from "./realtime.js";

const SUPABASE_REF = "tyewtrrwvzvginqoqwxs";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5ZXd0cnJ3dnp2Z2lucW9xd3hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4OTIzNjgsImV4cCI6MjEwODQ2ODM2OH0.TGenUQuD1500zlpmvyhv-yUPa8SAVpf4-ebM9yDsMGk";

// The OS chip's wires by block, as silicon/osui names them.
const BLOCKS = [
  ["Display decode", (b) => b === "disp"],
  ["Editor logic", (b) => b === "u"],
  ["Screen lines", (b) => b === "ui"],
  ["Layer registers L0–L7", (b) => /^L\d$/.test(b)],
  [
    "Datapath · add, sub, mux, clip",
    (b) =>
      [
        "d",
        "add",
        "sub",
        "neg",
        "mux",
        "clip",
        "r",
        "load",
        "glue",
        "and",
      ].includes(b),
  ],
  ["Toolbar memory", (b) => b === "pick"],
  ["Global registers", (b) => b === "g"],
  ["Inputs and clock", () => true],
];

export async function loadOsData(base = "/data/") {
  const { parts } = await (await fetch(`${base}os-index.json`)).json();
  const texts = await Promise.all(
    Array.from({ length: parts }, async (_, k) => {
      const r = await fetch(`${base}os-${k}.txt`);
      if (!r.ok) throw new Error(`Failed to load Figma OS data: os-${k}.txt`);
      return r.text();
    }),
  );
  return JSON.parse(texts.join(""));
}

// Applies one streamed input to the emulator.
export function applyInput(emu, ev) {
  if (ev.k === "r") emu.restart();
  else if (ev.k === "d") emu.press(ev.x, ev.y);
  else if (ev.k === "u") emu.release(ev.x, ev.y);
  else if (ev.k === "m") emu.move(ev.x, ev.y);
  else if (ev.k === "k") emu.key(ev.c);
}

export async function connectOsLink({
  channel = new URLSearchParams(location.search).get("channel") || "figma-cpu",
  parent = document.querySelector("#viewport"),
} = {}) {
  const data = await loadOsData();
  const emu = new OsEmulator(data);

  // ---- the panel: every OS chip wire a dot, lit while it is 1, white for a moment when it switches
  const wires = [];
  data.vars.forEach((v, i) => {
    if (
      v[2] !== "B" ||
      !v[0].startsWith("net/") ||
      !data.colls[v[1]].startsWith("Figma OS · CPU")
    )
      return;
    const base = v[0]
      .slice(4)
      .replace(/\[\d+\]$/, "")
      .split(/[_/[]/)[0];
    wires.push({ i, block: BLOCKS.findIndex(([, f]) => f(base)) });
  });
  const P = 4,
    COLS = 128,
    W = COLS * P + 24;
  const layout = [];
  let y = 0;
  BLOCKS.forEach(([title], b) => {
    const mine = wires.filter((w) => w.block === b);
    if (!mine.length) return;
    layout.push({ title, y, n: mine.length });
    y += 16;
    mine.forEach((w, k) => {
      w.x = 12 + (k % COLS) * P;
      w.y = y + Math.floor(k / COLS) * P;
    });
    y += Math.ceil(mine.length / COLS) * P + 8;
  });
  const flash = new Float64Array(data.vars.length);
  const panel = document.createElement("section");
  panel.id = "os-chip";
  panel.style.cssText =
    "position:absolute;right:18px;top:84px;z-index:6;width:" +
    W +
    "px;max-height:calc(100% - 160px);overflow:auto;padding:12px 0 8px;border-radius:14px;background:rgba(7,20,38,.86);border:1px solid rgba(117,179,231,.3);box-shadow:0 18px 50px rgba(0,0,0,.4);backdrop-filter:blur(18px);font:11px -apple-system,BlinkMacSystemFont,sans-serif;color:#bcd6ea";
  panel.innerHTML = `<div style="padding:0 12px 8px;display:flex;justify-content:space-between;gap:8px"><b style="color:#f2f8ff;font-size:12px;letter-spacing:.04em">FIGMA OS CHIP · ${wires.length.toLocaleString()} wires</b><span id="os-status">connecting…</span></div><div id="os-last" style="padding:0 12px 8px;font:11px monospace;color:#ffe08a;min-height:14px"></div>`;
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
  toggle.style.cssText =
    "position:absolute;top:15px;right:118px;z-index:7;padding:10px 14px;border-radius:12px;background:rgba(73,107,139,.36)";
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
      ctx.fillText(`${l.title.toUpperCase()} · ${l.n}`, 12, l.y + 11);
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

  // ---- the emulator's events
  let lastLabel = "",
    switched = 0;
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
        `${lastLabel || "input"} · ${switched.toLocaleString()} variables switched`,
      );
      dirty = true;
    } else if (e.type === "restart") {
      show("prototype started");
      dirty = true;
    }
  });

  // ---- the stream: inputs as they happen; on joining, the Figma tab's log of inputs since its start
  let pending = null,
    buffer = [],
    lastN = 0;
  const parts = new Map();
  const status = (t) => {
    panel.querySelector("#os-status").textContent = t;
  };
  const rt = realtimeChannel({
    ref: SUPABASE_REF,
    key: SUPABASE_ANON_KEY,
    channel,
    onStatus: (s) => {
      status(s === "live" ? "live · waiting for Figma" : s);
      if (s === "live") {
        pending = Date.now();
        rt.send("os-hello", {});
        setTimeout(() => {
          if (pending) {
            pending = null;
            buffer.forEach(feed);
            buffer = [];
          }
        }, 4000);
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
        emu.instant = true; // catch up at once, overlay chains included
        emu.restart();
        for (const ev of log) feed(ev);
        emu.instant = false;
        for (const ev of buffer) if ((ev.n ?? 0) > lastN) feed(ev);
        buffer = [];
        status("live from Figma");
      }
    },
  });
  function feed(ev) {
    if (ev.n) lastN = Math.max(lastN, ev.n);
    if (ev.k === "c") return void setTimeout(() => check(ev), 600);
    applyInput(emu, ev);
    dirty = true;
  }
  // Figma's own screen, read by the extension: the layer count and the selected layer's box and
  // fill, against the same values here. A miss means an input was taken differently.
  const word = (p, bits) => {
    let v = 0;
    for (let b = 0; b < bits; b++) if (emu.value(`net/${p}[${b}]`) === true) v |= 1 << b;
    return v;
  };
  function check(c) {
    const off = [];
    if (c.n !== undefined && word("g_n", 4) !== c.n) off.push(`layers ${c.n} in Figma, ${word("g_n", 4)} here`);
    const sel = [...Array(8).keys()].find((k) => emu.value(`net/ui_slots_${k}_sel`) === true);
    if (sel !== undefined)
      for (const [f, reg] of [["x", "x"], ["y", "y"], ["w", "w"], ["h", "h"]])
        if (c[f] !== undefined && c[f] >= 0 && c[f] < 32 && word(`L${sel}_${reg}`, 5) !== c[f])
          off.push(`${f.toUpperCase()} ${c[f]} in Figma, ${word(`L${sel}_${reg}`, 5)} here`);
    if (sel !== undefined && c.fill && emu.value(`ui/L${sel}/fill/hex`) !== c.fill)
      off.push(`fill ${c.fill} in Figma, ${emu.value(`ui/L${sel}/fill/hex`)} here`);
    sync.textContent = off.length
      ? `⚠ out of step with Figma (${off.join(", ")}): press R in Figma's Present to start both over`
      : "✓ in step with Figma";
    sync.style.color = off.length ? "#ff9b8a" : "#7dffb0";
  }
  return { emu, rt, panel };
}
