// The plugin panel (an iframe): buttons → messages to the plugin code; progress, stats and log back.
import type { DocStatus, ToMain, ToUi } from "../src/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (msg: ToMain) => parent.postMessage({ pluginMessage: msg }, "*");
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const num = (id: string, fallback: number) => {
  const v = Number($<HTMLInputElement>(id).value);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
};

const busyButtons = ["hardware", "os", "selftest", "platform", "clean"];
$("hardware").onclick = () => post({ type: "hardware", gateLabels: checked("labels"), redraw: checked("redraw") });
$("os").onclick = () =>
  post({ type: "os", budget: num("budget", 700), latch: $<HTMLSelectElement>("latch").value as "auto" | "gates" | "compact" | "direct", alias: checked("alias") });
$("selftest").onclick = () => post({ type: "selftest", events: num("events", 300), seed: num("seed", 1) });
$("platform").onclick = () => post({ type: "platform" });
$("clean").onclick = () => post({ type: "clean" });

function line(box: HTMLElement, text: string, cls: string) {
  const d = document.createElement("div");
  d.textContent = text;
  if (cls) d.className = cls;
  box.appendChild(d);
}
function log(text: string, cls: string) {
  const box = $("log");
  line(box, text, cls);
  while (box.childElementCount > 300) box.firstElementChild?.remove();
  box.scrollTop = box.scrollHeight;
}
function pill(id: string, on: boolean, text: string) {
  const p = $(id);
  p.textContent = text;
  p.className = `pill ${on ? "ok" : ""}`;
}
function showStatus(s: DocStatus) {
  pill("s-page", !!s.page, s.page ? `page: ${s.page}` : "no page");
  pill("s-hw", s.hardware, s.hardware ? "hardware ✓" : "no hardware");
  pill("s-os", s.built, s.built ? "OS built ✓" : "not built");
}
function progress(task: string, done: number, total: number, label: string) {
  const bar = $(`${task}-bar`);
  const text = $(`${task}-prog`);
  if (!bar || !text) return;
  bar.style.width = `${total ? Math.round((100 * done) / total) : 0}%`;
  text.textContent = done >= total ? "done" : `${done}/${total} · ${label}`;
}

window.onmessage = (e: MessageEvent) => {
  const m = (e.data as { pluginMessage?: ToUi }).pluginMessage;
  if (!m) return;
  switch (m.type) {
    case "hello":
    case "status":
      showStatus(m.status);
      return;
    case "log":
      log(m.text, m.level === "error" ? "err" : m.level === "ok" ? "ok" : "");
      return;
    case "busy": {
      const b = $("busy");
      b.textContent = m.task ? `${m.task}…` : "idle";
      b.className = `pill ${m.task ? "busy" : ""}`;
      for (const id of busyButtons) $<HTMLButtonElement>(id).disabled = !!m.task;
      return;
    }
    case "progress":
      progress(m.task, m.done, m.total, m.label);
      return;
    case "hardware":
      $("hardware-prog").textContent = `${m.stats.drawn} drawn · ${m.stats.reused} reused · ${m.stats.gates} gates · ENGINE ${m.stats.engineSize.w}×${m.stats.engineSize.h} · ${(m.stats.ms / 1000).toFixed(1)} s`;
      return;
    case "os":
      $("os-prog").textContent = `${m.stats.reactions} reactions · longest event ${m.stats.worstReaction.actions} (${m.stats.worstReaction.name}) · ${m.stats.variables} variables · ${(m.stats.ms / 1000).toFixed(1)} s`;
      return;
    case "selftest": {
      const v = $("verdict");
      v.textContent = m.result.text;
      v.className = `verdict ${m.result.ok ? "ok" : "bad"}`;
      return;
    }
    case "platform": {
      const box = $("tests");
      box.innerHTML = "";
      for (const t of m.tests) line(box, `${t.title}: ${t.how}`, "");
      return;
    }
  }
};

post({ type: "init" });
