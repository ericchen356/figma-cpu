// Control panel: program editor, clock controls, status readout, and the screen
// encoder (VRAM → crisp PNG for the canvas) + mouse/keyboard input for memory-mapped IO.
import bounce from "../programs/bounce.asm";
import count from "../programs/count.asm";
import fib from "../programs/fib.asm";
import paint from "../programs/paint.asm";
import rect from "../programs/rect.asm";
import { MEMORY, PALETTE, REGISTERS } from "../src/core/spec";
import { linePoints } from "./line";

const PROGRAMS: Record<string, string> = { count, fib, rect, bounce, paint };
const SCALE_CANVAS = 6; // upscale before encoding so Figma's smoothing can't blur pixels

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (msg: unknown) => parent.postMessage({ pluginMessage: msg }, "*");
const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, "0");

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

select.onchange = () => {
  if (select.value) src.value = PROGRAMS[select.value];
};
src.oninput = () => {
  select.value = Object.keys(PROGRAMS).find((k) => PROGRAMS[k] === src.value) ?? "";
};
$("load").onclick = () => post({ type: "load", source: src.value });
$("reset").onclick = () => post({ type: "reset" });
$("stept").onclick = () => post({ type: "step-t" });
$("stepi").onclick = () => post({ type: "step-i" });
$("watch").onclick = () => post({ type: "run", mode: "watch" });
$("turbo").onclick = () => post({ type: "run", mode: "turbo" });
$("pause").onclick = () => post({ type: "pause" });
const hz = $<HTMLInputElement>("hz");
hz.oninput = () => {
  $("hzv").textContent = `${hz.value} Hz`;
  post({ type: "hz", hz: Number(hz.value) });
};
$<HTMLInputElement>("pin").onchange = (e) => {
  const v = parseInt((e.target as HTMLInputElement).value, 16);
  if (!Number.isNaN(v)) post({ type: "pin", base: v });
};
src.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") post({ type: "load", source: src.value });
});

// Register tiles
const regsEl = $("regs");
const regEls = REGISTERS.map((r) => {
  const d = document.createElement("div");
  d.className = "reg";
  d.innerHTML = `<span class="label">${r}</span><b>00</b>`;
  regsEl.appendChild(d);
  return d.querySelector("b")!;
});

// ---------- screen ----------

const screen = $<HTMLCanvasElement>("screen");
const sctx = screen.getContext("2d")!;
const big = document.createElement("canvas");
big.width = MEMORY.width * SCALE_CANVAS;
big.height = MEMORY.height * SCALE_CANVAS;
const bctx = big.getContext("2d")!;
bctx.imageSmoothingEnabled = false;
const image = sctx.createImageData(MEMORY.width, MEMORY.height);

function drawVram(vram: Uint8Array): void {
  for (let i = 0; i < vram.length; i++) {
    const [r, g, b] = PALETTE[vram[i] & 15];
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(image, 0, 0);
}

function encodePng(): void {
  bctx.drawImage(screen, 0, 0, big.width, big.height);
  big.toBlob(async (blob) => {
    if (!blob) return post({ type: "png-failed", msg: "toBlob returned null" });
    try {
      post({ type: "png", bytes: new Uint8Array(await blob.arrayBuffer()) });
    } catch (e) {
      post({ type: "png-failed", msg: String(e) });
    }
  }, "image/png");
}

let mouseDown = false;
const input = { downs: 0, moves: 0 };
/** Last pixel sent while the button was down, to fill in the stroke between samples. */
let strokeAt: [number, number] | null = null;
const cursor = $("cursor");
function sendMouse(e: PointerEvent | MouseEvent): void {
  const rect = screen.getBoundingClientRect();
  const toCpu = (ev: MouseEvent): [number, number] => [
    Math.max(0, Math.min(MEMORY.width - 1, Math.floor(((ev.clientX - rect.left) / rect.width) * MEMORY.width))),
    Math.max(0, Math.min(MEMORY.height - 1, Math.floor(((ev.clientY - rect.top) / rect.height) * MEMORY.height))),
  ];
  const [x, y] = toCpu(e);
  // Browsers batch fast pointer moves; getCoalescedEvents() returns the samples in between.
  // Optional: if it's missing or throws in Figma's sandbox, the event itself is enough.
  let samples: [number, number, boolean][] = [[x, y, mouseDown]];
  if (mouseDown && e.type === "pointermove") {
    try {
      const all = (e as PointerEvent).getCoalescedEvents?.() ?? [];
      if (all.length) samples = all.map((ev) => [...toCpu(ev), mouseDown] as [number, number, boolean]);
    } catch {
      // keep the single sample
    }
  }
  if (mouseDown) {
    // Connect the dots: every pixel between consecutive samples becomes a sample.
    const dense: [number, number, boolean][] = [];
    for (const [sx, sy] of samples) {
      if (!strokeAt) dense.push([sx, sy, true]);
      else for (const [lx, ly] of linePoints(strokeAt[0], strokeAt[1], sx, sy)) dense.push([lx, ly, true]);
      strokeAt = [sx, sy];
    }
    samples = dense;
  } else strokeAt = null;
  if (samples.length === 0) return;
  // Local feedback: a box where the CPU will see the mouse (filled while the button is down).
  const px = rect.width / MEMORY.width;
  cursor.style.display = "block";
  cursor.style.left = `${screen.offsetLeft + x * px}px`;
  cursor.style.top = `${screen.offsetTop + y * px}px`;
  cursor.style.width = cursor.style.height = `${px * 3}px`;
  cursor.classList.toggle("down", mouseDown);
  post({ type: "mouse", samples });
}
function press(e: PointerEvent | MouseEvent): void {
  if (mouseDown) return;
  mouseDown = true;
  input.downs++;
  if ("pointerId" in e) {
    try {
      screen.setPointerCapture(e.pointerId);
    } catch {
      // capture is a nicety; drawing works without it
    }
  }
  screen.focus();
  sendMouse(e);
}
function release(e: PointerEvent | MouseEvent): void {
  if (!mouseDown) return;
  mouseDown = false;
  sendMouse(e);
}
screen.addEventListener("pointerdown", press);
screen.addEventListener("mousedown", press);
screen.addEventListener("pointermove", (e) => {
  input.moves++;
  if (mouseDown && (e.buttons & 1) === 0) return release(e); // missed the up event
  sendMouse(e);
});
screen.addEventListener("pointerup", release);
window.addEventListener("mouseup", (e) => release(e));
screen.addEventListener("pointerleave", () => {
  if (!mouseDown) cursor.style.display = "none";
});
screen.addEventListener("keydown", (e) => {
  const special: Record<string, number> = { Enter: 13, Escape: 27, Backspace: 8, ArrowLeft: 28, ArrowRight: 29, ArrowUp: 30, ArrowDown: 31 };
  const code = e.key.length === 1 ? e.key.charCodeAt(0) : special[e.key];
  if (code !== undefined) {
    post({ type: "key", code });
    e.preventDefault();
  }
});

// ---------- messages from the plugin ----------

interface Status {
  running: string | null;
  halted: boolean;
  fault: string | null;
  pc: number;
  sp: number;
  ir: number;
  mnem: string;
  regs: number[];
  flags: { z: boolean; c: boolean; n: boolean };
  instructions: number;
  tstates: number;
  t: number | null;
  sigs: string[];
  ips: number;
  line: number | null;
  pinBase: number;
  mouse: [number, number, number];
  queue: number;
  screens: number;
}

let vramReceived = 0;

function showStatus(s: Status): void {
  $("pc").textContent = `PC ${hex(s.pc, 4)} · SP ${hex(s.sp, 4)} · IR ${hex(s.ir, 2)} ${s.mnem}${s.line ? ` · line ${s.line}` : ""}`;
  s.regs.forEach((v, i) => (regEls[i].textContent = hex(v, 2)));
  $("flags").innerHTML = (["z", "c", "n"] as const)
    .map((f) => `<span class="${s.flags[f] ? "on" : ""}">${f.toUpperCase()}</span>`)
    .join("");
  $("counts").textContent = `${s.instructions} instr · ${s.tstates} T${s.ips ? ` · ${s.ips.toLocaleString()} IPS` : ""}`;
  $("sigs").textContent = s.t === null ? "—" : `T${s.t}: ${s.sigs.join("  ") || "(idle)"}`;
  const state = $("state");
  state.textContent = s.fault ? `fault: ${s.fault}` : s.halted ? "halted" : s.running ? `running · ${s.running}` : "paused";
  state.className = `pill ${s.fault ? "bad" : s.running ? "ok" : ""}`;
  const [mx, my, mb] = s.mouse;
  $("diag").textContent =
    `panel: ${input.downs} clicks, ${input.moves} moves · CPU sees mouse ${mx},${my} ${mb ? "● down" : "○ up"} · queue ${s.queue} · ` +
    `screen ${vramReceived} sent / ${s.screens} on canvas`;
  $("watch").classList.toggle("active", s.running === "watch");
  $("turbo").classList.toggle("active", s.running === "turbo");
}

onmessage = (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (!msg) return;
  switch (msg.type) {
    case "ready":
      if (msg.source) src.value = msg.source;
      else {
        src.value = PROGRAMS.count;
        post({ type: "load", source: src.value });
      }
      src.dispatchEvent(new Event("input"));
      if (msg.missing.length)
        asmBox.innerHTML = `<div class="err">Drawing is missing ${msg.missing.length} contract node(s), e.g. ${msg.missing
          .slice(0, 4)
          .join(", ")} — those parts won't animate.</div>`;
      break;
    case "table": {
      const t = $("table");
      t.textContent = msg.errors.length ? `table: ${msg.rows} ops · ${msg.errors.length} bad row(s)` : `table: ${msg.rows} ops ✓`;
      t.className = `pill ${msg.errors.length ? "bad" : "ok"}`;
      t.title = msg.errors.map((x: { row: string; msg: string }) => `${x.row}: ${x.msg}`).join("\n");
      if (msg.errors.length)
        asmBox.innerHTML = msg.errors
          .map((x: { row: string; msg: string }) => `<div class="err">row ${x.row}: ${x.msg}</div>`)
          .join("");
      break;
    }
    case "asm":
      asmBox.innerHTML = msg.ok
        ? `<div class="ok">✓ ${msg.size} bytes loaded at ${hex(msg.entry, 4)}</div>`
        : msg.errors.map((x: { line: number; msg: string }) => `<div class="err">line ${x.line}: ${x.msg}</div>`).join("");
      break;
    case "status":
      showStatus(msg);
      break;
    case "vram":
      vramReceived++;
      try {
        drawVram(new Uint8Array(msg.vram));
        encodePng();
      } catch (err) {
        post({ type: "png-failed", msg: String(err) });
      }
      break;
    case "warn":
      asmBox.innerHTML = `<div class="err">${msg.msg}</div>`;
      break;
    case "fatal":
      $("fatal").style.display = "block";
      $("fatal").textContent = msg.msg;
      break;
  }
};
