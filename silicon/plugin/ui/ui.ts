// The plugin panel (an iframe): buttons → messages to the plugin code, and the plugin's
// progress, stats, clock readout and log back. The program editor assembles as you type.
import helloSrc from "../../os/hello-os.asm";
import helloBindings from "../../os/hello-os.bindings.json";
import helloManifest from "../../os/hello-os.json";
import { assemble, PROGRAMS } from "../../src/isa";
import type { ClockStatus, CompileStats, DocStatus, OsReport, ToMain, ToUi } from "../src/messages";

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

const busyButtons = ["build", "panel", "compile", "load", "verify", "c-step", "c-run", "c-reset", "os-load", "os-run", "os-demo", "live"];
$("build").onclick = () => post({ type: "build", gateLabels: checked("labels"), redraw: checked("redraw"), separatePages: checked("separate") });
$("panel").onclick = () => post({ type: "panel" });
$("live").onclick = () => post({ type: "live" });
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

// ---------- input byte (memory-mapped at RAM[14], see plugin/src/devices.ts) ----------

const inByte = $<HTMLInputElement>("in-byte");
function sendInput(value: number) {
  post({ type: "input", value });
  $("in-last").textContent = hex(value, 2);
}
for (let k = 0; k < 16; k++) {
  const b = document.createElement("button");
  b.textContent = hex(k, 1);
  b.title = `send ${hex(k, 2)}`;
  b.onclick = () => sendInput(k);
  $("keypad").appendChild(b);
}
function sendTyped() {
  const t = inByte.value.trim();
  if (/^[0-9a-f]{1,2}$/i.test(t)) {
    inByte.style.borderColor = "";
    sendInput(parseInt(t, 16));
  } else inByte.style.borderColor = "var(--err)";
}
$("in-send").onclick = sendTyped;
inByte.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendTyped();
});

src.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && checkAsm()) post({ type: "load", source: src.value });
});

// ---------- OS card (plugin/src/os-host.ts) ----------

const osBox = {
  manifest: $<HTMLTextAreaElement>("os-manifest"),
  source: $<HTMLTextAreaElement>("os-source"),
  bindings: $<HTMLTextAreaElement>("os-bindings"),
};
type OsTab = keyof typeof osBox;
function osTab(tab: OsTab) {
  for (const k of Object.keys(osBox) as OsTab[]) {
    osBox[k].style.display = k === tab ? "" : "none";
    $(`os-tab-${k}`).className = k === tab ? "on" : "";
  }
}
for (const k of Object.keys(osBox) as OsTab[]) $(`os-tab-${k}`).onclick = () => osTab(k);
function osDefaults() {
  osBox.manifest.value = JSON.stringify(helloManifest, null, 2);
  osBox.source.value = helloSrc;
  osBox.bindings.value = JSON.stringify(helloBindings, null, 2);
}
osDefaults();
$("os-default").onclick = osDefaults;
$<HTMLInputElement>("os-files").onchange = async (e) => {
  for (const f of Array.from((e.target as HTMLInputElement).files ?? [])) {
    const t = await f.text();
    const tab: OsTab = /\.bindings\.json$/i.test(f.name) ? "bindings" : /\.json$/i.test(f.name) ? "manifest" : "source";
    osBox[tab].value = t;
    osTab(tab);
  }
};
const osFiles = () => ({ manifest: osBox.manifest.value, source: osBox.source.value, bindings: osBox.bindings.value });
$("os-load").onclick = () => post({ type: "os-load", ...osFiles() });
$("os-run").onclick = () => post({ type: "os-run", tps: 0, load: osFiles() });
$("os-pause").onclick = () => post({ type: "clock", action: "pause" });
$("os-demo").onclick = () => post({ type: "os-demo" });

function osEvent(event: Extract<ToMain, { type: "os-event" }>["event"]) {
  post({ type: "os-event", event });
  $("os-pending").textContent = event.type === "click" ? `click ${event.node}` : `key ${event.key}`;
}
const keycatch = $("os-keycatch");
keycatch.addEventListener("keydown", (e) => {
  if (e.key === "Tab") return;
  e.preventDefault();
  osEvent({ type: "key", key: e.key });
});

function showOs(r: OsReport) {
  const msgs = $("os-msgs");
  msgs.innerHTML = "";
  for (const e of r.errors) line(msgs, e, "err");
  for (const w of r.warnings) line(msgs, w, "");
  if (r.loaded) line(msgs, `loaded "${r.name}" · ${r.bytes.map((b) => hex(b, 2)).join(" ")}`, "ok");
  else if (!r.errors.length) line(msgs, "not loaded", "err");
  const cell = (t: string, bold = false) => {
    const td = document.createElement("td");
    if (bold) {
      const b = document.createElement("b");
      b.textContent = t;
      td.appendChild(b);
    } else td.textContent = t;
    return td;
  };
  const table = (id: string, rows: string[][]) => {
    const t = $(id);
    t.innerHTML = "";
    for (const row of rows) {
      const tr = document.createElement("tr");
      row.forEach((c, i) => tr.appendChild(cell(c, i === 0)));
      t.appendChild(tr);
    }
  };
  table(
    "os-regions",
    r.regions.map((g) => [g.name, g.kind, g.start === g.end ? `${g.start}` : `${g.start}–${g.end}`]),
  );
  table(
    "os-binds",
    r.bindings.map((b) => [b.node, b.prop, b.ram, b.map]),
  );
  const keys = $("os-keys");
  keys.innerHTML = "";
  for (const [node, v] of Object.entries(r.keymap.click)) {
    const b = document.createElement("button");
    b.textContent = `click ${node} → ${hex(v, 2)}`;
    b.onclick = () => osEvent({ type: "click", node });
    keys.appendChild(b);
  }
  for (const [key, v] of Object.entries(r.keymap.key)) {
    const b = document.createElement("button");
    b.textContent = `key ${key} → ${hex(v, 2)}`;
    b.onclick = () => osEvent({ type: "key", key });
    keys.appendChild(b);
  }
}

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

/** The task whose progress bar is mid-way, so an error can mark it failed instead of leaving it stuck. */
let activeProgress: string | null = null;

function progress(task: string, done: number, total: number, label: string) {
  const bar = $(`${task}-bar`);
  const text = $(`${task}-prog`);
  if (!bar || !text) return;
  activeProgress = done >= total ? null : task;
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
      if (m.level === "error" && activeProgress) {
        const text = $(`${activeProgress}-prog`);
        if (text) text.textContent = "✗ failed (see the log below)";
        activeProgress = null;
      }
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
    case "os":
      showOs(m.report);
      return;
    case "live": {
      const st = m.stats;
      $("live-prog").textContent =
        `${st.layers} layers · ${st.bound} lit layers bound (${st.magnifierGates} gates in ${st.magnifiers} magnifiers) · ${st.texts} texts` +
        (st.wired ? ` · ${st.frames.length} frames, ${st.eventsPerTick} events/tick · ${(st.ms / 1000).toFixed(1)} s` : ` · not wired: ${st.note ?? "?"}`);
      return;
    }
    case "verify": {
      const v = $("verdict");
      v.textContent = m.text;
      v.className = `verdict ${m.ok ? "ok" : "bad"}`;
      return;
    }
  }
};

post({ type: "init" });
