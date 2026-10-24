// The plugin panel (an iframe): buttons → messages to the plugin code, and the plugin's
// progress, stats, clock readout and log back. The program editor assembles as you type.
import { assemble, PROGRAMS } from "../../src/isa";
import type { ClockStatus, CompileStats, DocStatus, ToMain, ToUi } from "../src/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (msg: ToMain) => parent.postMessage({ pluginMessage: msg }, "*");
const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, "0");
const checked = (id: string) => $<HTMLInputElement>(id).checked;

// ---------- program editor ----------

const src = $<HTMLTextAreaElement>("src");
const select = $<HTMLSelectElement>("program");
const asmBox = $("asm");
for (const name of Object.keys(PROGRAMS)) {
  const o = document.createElement("option");
  o.value = o.textContent = name;
  select.appendChild(o);
}
const custom = document.createElement("option");
custom.value = "";
custom.textContent = "(custom)";
select.appendChild(custom);
select.value = "mul";
src.value = PROGRAMS.mul;

function checkAsm(): boolean {
  const r = assemble(src.value);
  asmBox.innerHTML = "";
  for (const e of r.errors) line(asmBox, `line ${e.line}: ${e.msg}`, "err");
  for (const w of r.warnings) line(asmBox, `line ${w.line}: ${w.msg}`, "");
  if (!r.errors.length) line(asmBox, `ok · ${r.bytes.map((b) => hex(b, 2)).join(" ")}`, "ok");
  return r.errors.length === 0;
}
let asmTimer = 0;
select.onchange = () => {
  if (select.value) src.value = PROGRAMS[select.value];
  checkAsm();
};
src.oninput = () => {
  select.value = Object.keys(PROGRAMS).find((k) => PROGRAMS[k] === src.value) ?? "";
  clearTimeout(asmTimer);
  asmTimer = window.setTimeout(checkAsm, 250);
};
checkAsm();

// ---------- buttons ----------

const busyButtons = ["build", "panel", "compile", "load", "verify", "c-step", "c-run", "c-reset"];
$("build").onclick = () => post({ type: "build", gateLabels: checked("labels"), redraw: checked("redraw"), separatePages: checked("separate") });
$("panel").onclick = () => post({ type: "panel" });
$("compile").onclick = () => {
  const chunk = Number($<HTMLInputElement>("chunk").value);
  if (checkAsm())
    post({
      type: "compile",
      source: src.value,
      flat: checked("flat"),
      runDelayMs: Math.max(1, Number($<HTMLInputElement>("delay").value) || 1),
      ...(chunk > 0 ? { maxActionsPerEvent: Math.round(chunk) } : {}),
    });
};
$("load").onclick = () => {
  if (checkAsm()) post({ type: "load", source: src.value });
};
$("verify").onclick = () => {
  if (checkAsm()) post({ type: "verify", source: src.value });
};
const tps = () => Number($<HTMLSelectElement>("tps").value);
$("c-step").onclick = () => post({ type: "clock", action: "step" });
$("c-run").onclick = () => post({ type: "clock", action: "run", tps: tps() });
$("c-pause").onclick = () => post({ type: "clock", action: "pause" });
$("c-reset").onclick = () => {
  if (checkAsm()) post({ type: "clock", action: "reset", source: src.value });
};
$<HTMLSelectElement>("tps").onchange = () => {
  if (clockRunning) post({ type: "clock", action: "run", tps: tps() });
};
src.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && checkAsm()) post({ type: "load", source: src.value });
});

// ---------- readouts ----------

function line(box: HTMLElement, text: string, cls: string) {
  const d = document.createElement("div");
  d.textContent = text;
  if (cls) d.className = cls;
  box.appendChild(d);
}

function log(text: string, cls: string) {
  const box = $("log");
  line(box, text, cls);
  while (box.childElementCount > 200) box.firstElementChild?.remove();
  box.scrollTop = box.scrollHeight;
}

function pill(id: string, on: boolean, text: string) {
  const p = $(id);
  p.textContent = text;
  p.className = `pill ${on ? "ok" : ""}`;
}

function showStatus(s: DocStatus) {
  pill("s-hw", s.hardware, s.hardware ? "hardware ✓" : "no hardware");
  pill("s-panel", s.panel, s.panel ? "front panel ✓" : "no front panel");
  pill("s-comp", s.compiled, s.compiled ? "prototype ✓" : "not compiled");
  pill("s-prog", !!s.program, `program ${s.program ?? "—"}`);
  $("s-page").textContent = s.page ? `on: ${s.page}` : "Nothing built yet. Start with Build hardware.";
}

function progress(task: string, done: number, total: number, label: string) {
  const bar = $(`${task}-bar`);
  const text = $(`${task}-prog`);
  if (!bar || !text) return;
  bar.style.width = `${total ? Math.round((100 * done) / total) : 0}%`;
  text.textContent = done >= total ? "done" : `${done}/${total} · ${label}`;
}

function showCompile(s: CompileStats) {
  $("st-gates").textContent = String(s.gates);
  $("st-vars").textContent = String(s.variables);
  $("st-apt").textContent = String(s.actionsPerTick);
  $("st-bound").textContent = String(s.bound);
}

const REGS = ["PC", "IR", "T", "MAR", "MDR", "A", "Y", "BUS", "R0", "R1", "R2", "R3"];
const WIDTH: Record<string, number> = { PC: 1, T: 1, MAR: 1 };
let clockRunning = false;
function showClock(s: ClockStatus) {
  clockRunning = s.running;
  const p = s.probes;
  const st = $("c-state");
  st.textContent = s.running ? `running · ${s.tps} ticks/s` : s.halted ? "halted" : "stopped";
  st.className = `pill ${s.running ? "busy" : s.halted ? "bad" : ""}`;
  if (p.OUT === undefined) return;
  $("c-out").textContent = `${hex(p.OUT, 2)} · ${p.OUT}`;
  $("c-counts").innerHTML = `${s.ticks} ticks<br>${s.writes} vars written / frame`;
  $("regs").innerHTML = REGS.map((r) => `<div class="reg">${r} <b>${hex(p[r] ?? 0, WIDTH[r] ?? 2)}</b></div>`).join("");
  $("flags").innerHTML = ["Z", "C", "N", "HALTED"].map((f) => `<span class="${p[f] ? "on" : ""}">${f}</span>`).join("");
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
    case "build":
      $("build-prog").textContent = `${m.stats.drawn} drawn · ${m.stats.reused} reused · ${m.stats.gates} gates · cell/CPU ${m.stats.cpuSize.w}×${m.stats.cpuSize.h} · ${(m.stats.ms / 1000).toFixed(1)} s`;
      return;
    case "compile":
      showCompile(m.stats);
      $("compile-prog").textContent = `${m.stats.actionsPerStep} actions per Step · ${m.stats.collections} collection(s) · ${(m.stats.ms.total / 1000).toFixed(1)} s`;
      return;
    case "asm":
      if (m.errors.length) {
        asmBox.innerHTML = "";
        for (const er of m.errors) line(asmBox, `line ${er.line}: ${er.msg}`, "err");
      }
      return;
    case "clock":
      showClock(m.status);
      return;
    case "verify": {
      const v = $("verdict");
      v.textContent = m.text;
      v.className = `verdict ${m.ok ? "ok" : "bad"}`;
      return;
    }
  }
};

post({ type: "init" });
