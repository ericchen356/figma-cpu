// Minimal Chrome DevTools Protocol client: launches headless Chrome and talks to one page target
// over the built-in WebSocket (Node >= 22). No puppeteer, no npm deps.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9341, width = 1440, height = 900, profileRoot = `${process.env.TMPDIR ?? "/tmp"}/osui-capture-profiles` } = {}) {
  mkdirSync(profileRoot, { recursive: true });
  const profile = mkdtempSync(`${profileRoot}/chrome-profile-`);
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--font-render-hinting=none",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(100);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
  }
  if (!wsUrl) throw new Error("Chrome did not expose a page target");
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const waiting = new Map();
  const listeners = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(typeof m.data === "string" ? m.data : m.data.toString());
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(`${msg.error.message} ${msg.error.data ?? ""}`)) : res(msg.result);
    } else if (msg.method) (listeners.get(msg.method) ?? []).forEach((f) => f(msg.params));
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const once = (method) =>
    new Promise((res) => {
      const arr = listeners.get(method) ?? [];
      const f = (p) => {
        listeners.set(method, (listeners.get(method) ?? []).filter((g) => g !== f));
        res(p);
      };
      listeners.set(method, [...arr, f]);
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 2000));
    return r.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("CSS.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const close = async () => {
    try { await send("Browser.close"); } catch {}
    proc.kill();
  };
  return { send, once, evaluate, close, sleep };
}

/** Navigates and waits for load plus document.fonts.ready. */
export async function open(c, url) {
  const loaded = c.once("Page.loadEventFired");
  await c.send("Page.navigate", { url });
  await loaded;
  await c.evaluate("document.fonts.ready.then(() => document.fonts.size)");
  await c.sleep(150);
}

export async function screenshot(c, path) {
  const { writeFileSync } = await import("node:fs");
  const r = await c.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(path, Buffer.from(r.data, "base64"));
}

// Real input events (they reach the page as pointer/mouse/key events, like a user's).
export async function mouse(c, type, x, y, buttons = 1) {
  await c.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: type === "mouseMoved" && !buttons ? "none" : "left",
    buttons: type === "mouseReleased" ? 0 : buttons,
    clickCount: type === "mouseMoved" ? 0 : 1,
  });
}
export async function drag(c, x0, y0, x1, y1, steps = 6) {
  await mouse(c, "mouseMoved", x0, y0, 0);
  await mouse(c, "mousePressed", x0, y0);
  for (let i = 1; i <= steps; i++) await mouse(c, "mouseMoved", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, 1);
  await mouse(c, "mouseReleased", x1, y1);
  await c.sleep(30);
}
export async function click(c, x, y) {
  await mouse(c, "mouseMoved", x, y, 0);
  await mouse(c, "mousePressed", x, y);
  await mouse(c, "mouseReleased", x, y);
  await c.sleep(30);
}
/** Clicks the centre of the first element matching `sel`. */
export async function clickSel(c, sel) {
  const r = await c.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error(`no element ${sel}`);
  await click(c, r[0], r[1]);
}
/** Types into an input as the app reads it: set the value, then fire change (Enter/blur commit). */
export async function setField(c, sel, value) {
  await c.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await c.sleep(30);
}
const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
};
export async function key(c, k, modifiers = 0) {
  const spec = KEYS[k] ?? {
    code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : k,
    keyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0,
    text: k.length === 1 && !(modifiers & 2) && !(modifiers & 4) ? k : undefined,
  };
  await c.send("Input.dispatchKeyEvent", { type: spec.text ? "keyDown" : "rawKeyDown", key: k, code: spec.code, windowsVirtualKeyCode: spec.keyCode, text: spec.text, modifiers });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: spec.code, windowsVirtualKeyCode: spec.keyCode, modifiers });
  await c.sleep(20);
}
