// Control panel. Talks to the main thread with postMessage; also turns VRAM into the
// screen preview and into the PNGs that become the screen's image fill on the canvas.
import palette from "../../spec/palette.json";

const SCREEN_W = 128;
const SCREEN_H = 96;
const PNG_SCALE = 6; // matches the 768x576 dev/screen rect

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const send = (msg: object) => parent.postMessage({ pluginMessage: msg }, "*");
const hex = (n: number, w: number) =>
  n.toString(16).toUpperCase().padStart(w, "0");

const editor = $<HTMLTextAreaElement>("editor");
const programs = $<HTMLSelectElement>("programs");
const status = $<HTMLSpanElement>("status");
const messages = $<HTMLDivElement>("messages");
const screen = $<HTMLCanvasElement>("screen");
let library: Record<string, string> = {};
let running = false;

function log(text: string, cls = "") {
  const line = document.createElement("div");
  line.textContent = text;
  if (cls) line.className = cls;
  messages.prepend(line);
  while (messages.childElementCount > 60) messages.lastChild!.remove();
}

// ---- registers readout ----
const REGS = [
  "PC",
  "SP",
  "IR",
  "A",
  "B",
  "C",
  "D",
  "H",
  "L",
  "HL",
  "OP",
  "IPS",
];
$("regs").innerHTML = REGS.map(
  (r) => `<div class="reg"><b>${r}</b><span id="r${r}">–</span></div>`,
).join("");
const setReg = (name: string, text: string) =>
  ($(`r${name}`).textContent = text);

// ---- screen ----
const rgb = palette.colors.map((c) =>
  [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)),
);
const small = document.createElement("canvas");
small.width = SCREEN_W;
small.height = SCREEN_H;
const sctx = small.getContext("2d")!;
const frame = sctx.createImageData(SCREEN_W, SCREEN_H);
const big = document.createElement("canvas");
big.width = SCREEN_W * PNG_SCALE;
big.height = SCREEN_H * PNG_SCALE;
const bctx = big.getContext("2d")!;
const pctx = screen.getContext("2d")!;

function drawVram(pixels: Uint8Array) {
  for (let i = 0; i < pixels.length; i++) {
    const c = rgb[pixels[i] & 15];
    frame.data[i * 4] = c[0];
    frame.data[i * 4 + 1] = c[1];
    frame.data[i * 4 + 2] = c[2];
    frame.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(frame, 0, 0);
  pctx.imageSmoothingEnabled = false;
  pctx.drawImage(small, 0, 0, screen.width, screen.height);
}

async function png(): Promise<Uint8Array> {
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, big.width, big.height);
  const blob = await new Promise<Blob | null>((res) =>
    big.toBlob(res, "image/png"),
  );
  if (!blob) throw new Error("PNG encode failed");
  return new Uint8Array(await blob.arrayBuffer());
}

// ---- mouse + keys → memory-mapped IO ----
let btn = 0;
let lastMove = 0;
function mouse(e: MouseEvent, force = false) {
  const now = performance.now();
  if (!force && now - lastMove < 30) return;
  lastMove = now;
  const r = screen.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * SCREEN_W);
  const y = Math.floor(((e.clientY - r.top) / r.height) * SCREEN_H);
  send({ type: "mouse", x, y, btn });
}
screen.addEventListener("mousedown", (e) => {
  btn = 1;
  screen.focus();
  mouse(e, true);
});
screen.addEventListener("mousemove", (e) => mouse(e));
screen.addEventListener("mouseup", (e) => {
  btn = 0;
  mouse(e, true);
});
screen.addEventListener("mouseleave", (e) => {
  if (!btn) return;
  btn = 0;
  mouse(e, true);
});
screen.addEventListener("keydown", (e) => {
  if (e.key.length !== 1) return;
  e.preventDefault();
  send({ type: "key", code: e.key.charCodeAt(0) });
});
$("palette").innerHTML = palette.colors
  .map(
    (c, i) =>
      `<div title="colour ${i}" data-i="${i}" style="background:${c}"></div>`,
  )
  .join("");
$("palette").addEventListener("click", (e) => {
  const i = (e.target as HTMLElement).dataset.i;
  if (i !== undefined) send({ type: "key", code: 0x80 | Number(i) }); // paint.asm uses the low nibble
});

// ---- controls ----
$("example").onclick = () => (editor.value = library[programs.value] ?? "");
programs.onchange = () => (editor.value = library[programs.value] ?? "");
$("assemble").onclick = () =>
  send({ type: "assemble", source: editor.value, name: programs.value });
$("step").onclick = () => send({ type: "step" });
$("run").onclick = () => send({ type: running ? "pause" : "run" });
$("reset").onclick = () => send({ type: "reset" });
$("focus").onclick = () => send({ type: "focus" });
$("reloadTable").onclick = () => send({ type: "reloadTable" });
for (const m of ["watch", "turbo"])
  $(m).onclick = () => send({ type: "mode", mode: m });
const hz = $<HTMLInputElement>("hz");
hz.oninput = () => {
  $("hzv").textContent = `${hz.value} Hz`;
  send({ type: "hz", hz: Number(hz.value) });
};
const pin = $<HTMLInputElement>("pin");
pin.onchange = () => {
  const addr = parseInt(pin.value.replace(/^0x/i, ""), 16);
  if (Number.isFinite(addr)) send({ type: "pin", addr });
};
editor.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    editor.setRangeText(
      "\t",
      editor.selectionStart,
      editor.selectionEnd,
      "end",
    );
  }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("assemble").click();
});

// ---- messages from the main thread ----
interface State {
  regs: number[];
  pc: number;
  sp: number;
  ir: number;
  mnem: string;
  flags: { Z: boolean; C: boolean; N: boolean };
  cycles: number;
  halted: boolean;
  error: string | null;
  running: boolean;
  mode: "watch" | "turbo";
  ips: number | null;
}

let lastError: string | null = null;

function showState(s: State) {
  running = s.running;
  ["A", "B", "C", "D", "H", "L"].forEach((r, i) =>
    setReg(r, hex(s.regs[i], 2)),
  );
  setReg("PC", hex(s.pc, 4));
  setReg("SP", hex(s.sp, 4));
  setReg("IR", hex(s.ir, 2));
  setReg("HL", hex((s.regs[4] << 8) | s.regs[5], 4));
  setReg("OP", s.mnem);
  setReg(
    "IPS",
    s.ips === null
      ? "–"
      : s.ips >= 1000
        ? `${Math.round(s.ips / 1000)}k`
        : String(s.ips),
  );
  for (const f of ["Z", "C", "N"] as const)
    $(`f${f}`).classList.toggle("on", s.flags[f]);
  $("cycles").textContent = `${s.cycles} cycles`;
  $("run").textContent = s.running ? "Pause ❚❚" : "Run ▶";
  $<HTMLButtonElement>("run").disabled = s.halted && !s.running;
  $<HTMLButtonElement>("step").disabled = s.halted || s.running;
  $("watch").classList.toggle("on", s.mode === "watch");
  $("turbo").classList.toggle("on", s.mode === "turbo");
  status.className = s.error ? "bad" : "ok";
  status.textContent = s.error
    ? "fault"
    : s.halted
      ? "halted"
      : s.running
        ? `running · ${s.mode}`
        : "ready";
  if (s.error && s.error !== lastError) log(`CPU fault: ${s.error}`, "err");
  lastError = s.error;
}

window.onmessage = async (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (!msg) return;
  switch (msg.type) {
    case "init":
      library = msg.programs;
      programs.innerHTML = Object.keys(library)
        .map((n) => `<option>${n}</option>`)
        .join("");
      editor.value = library[programs.value];
      pin.value = hex(msg.pin, 4);
      log(
        msg.restored
          ? "Restored the machine state saved in this file."
          : "Bound to Machine v2. Load a program.",
        "ok",
      );
      break;
    case "state":
      showState(msg);
      break;
    case "vram":
      drawVram(msg.pixels);
      if (msg.png) send({ type: "png", bytes: await png() });
      break;
    case "asm":
      if (msg.ok) {
        $("asm").textContent = `${msg.size} bytes loaded`;
        log(
          `Assembled ${msg.size} bytes in ${msg.segments.length} segment(s).`,
          "ok",
        );
      } else {
        $("asm").textContent = `${msg.errors.length} error(s)`;
        for (const err of [...msg.errors].reverse())
          log(`${err.file}:${err.line}: ${err.message}`, "err");
      }
      break;
    case "table":
      if (msg.errors.length)
        for (const err of msg.errors) log(`Opcode table: ${err}`, "err");
      else log(`Opcode table read from canvas: ${msg.count} instructions.`);
      break;
    case "error":
      log(msg.message, "err");
      break;
    case "fatal":
      $("fatal").style.display = "block";
      $("fatal").textContent =
        (msg.message ? `${msg.message}\n` : "") +
        `Machine v2 is missing or incomplete. Draw it with tools/draw-machine (see STAGELOG Stage 2).` +
        (msg.missing?.length
          ? `\nMissing: ${msg.missing.slice(0, 12).join(", ")}${msg.missing.length > 12 ? "…" : ""}`
          : "");
      status.className = "bad";
      status.textContent = "not bound";
      break;
  }
};
