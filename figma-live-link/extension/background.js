// Holds the Supabase Realtime connection and forwards what the content script reads: the CPU tab's
// clock ("cpu") and every input on the Figma OS frame ("os"). A listener that joins late sends
// "os-hello"; the Figma tab's input log goes back as "os-log".
import { DEFAULT_CHANNEL, SUPABASE_ANON_KEY, SUPABASE_REF } from "./config.js";
import { realtimeChannel } from "./realtime.js";

let rt = null,
  status = "off",
  last = null,
  sent = 0,
  inputs = 0,
  figmaTab = null;
let settings = { channel: DEFAULT_CHANNEL, enabled: true };
const ready = chrome.storage.sync.get(settings).then((s) => {
  settings = s;
  connect();
});

function connect() {
  rt?.close();
  rt = null;
  status = "off";
  if (!settings.enabled) return;
  rt = realtimeChannel({
    ref: SUPABASE_REF,
    key: SUPABASE_ANON_KEY,
    channel: settings.channel,
    onStatus: (s) => {
      status = s;
    },
    onMessage: (event) => {
      if (event === "os-hello") sendLog();
    },
  });
}

async function sendLog() {
  if (figmaTab === null || !rt) return;
  const r = await chrome.tabs
    .sendMessage(figmaTab, { type: "os-log" })
    .catch(() => null);
  if (!r?.log) return;
  // Realtime messages stay well under its size limit in parts of 2,000 inputs.
  const parts = Math.max(1, Math.ceil(r.log.length / 2000));
  const id = Date.now();
  for (let i = 0; i < parts; i++)
    rt.send("os-log", {
      id,
      i,
      parts,
      log: r.log.slice(i * 2000, (i + 1) * 2000),
    });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    await ready;
    switch (msg.type) {
      case "cpu":
        last = { ...msg.state, at: Date.now() };
        if (rt) {
          rt.send("cpu", last);
          sent++;
        }
        return reply({ ok: true });
      case "os":
        figmaTab = sender.tab.id;
        if (rt) {
          rt.send("os", msg.ev);
          inputs++;
        }
        return reply({ ok: true });
      case "capture": {
        // The program buttons only differ by colour, so the content script samples a screenshot.
        const url = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
          format: "png",
        });
        return reply({ url });
      }
      case "status":
        return reply({ status, last, sent, inputs, ...settings });
      case "settings":
        settings = { ...settings, ...msg.settings };
        await chrome.storage.sync.set(settings);
        connect();
        return reply({ ok: true });
    }
  })().catch((e) => reply({ error: String(e) }));
  return true;
});
