// Control panel: editor, clock, status, and the screen: VRAM → crisp PNG for the canvas, plus mouse
// and keyboard input for the memory-mapped IO. UI_DATA (programs, palette, screen size, registers)
// is injected by build.mjs.
const { PROGRAMS, PALETTE, WIDTH, HEIGHT, REGISTERS } = UI_DATA;
const SCALE = 6; // upscale before encoding so Figma's smoothing can't blur the pixels

const $ = (id) => document.getElementById(id);
const post = (msg) => parent.postMessage({ pluginMessage: msg }, "*");
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, "0");

const src = $("src");
const select = $("program");
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

// How each demo is meant to run. bounce waits for the frame tick and paint polls the mouse,
// so both need Turbo; in Watch a single frame takes hundreds of T-states.
const PROGRAM_INFO = {
  count: { mode: "watch", hint: "Runs in Watch: follow each FETCH, DECODE and EXEC on the canvas." },
  fib: { mode: "watch", hint: "Runs in Watch: the pinned RAM window at 4000 fills with Fibonacci numbers." },
  rect: { mode: "turbo", hint: "Runs in Turbo: a red rectangle appears on the screen." },
  bounce: { mode: "turbo", hint: "Runs in Turbo: it waits for the frame tick, so in Watch it looks frozen." },
  paint: { mode: "turbo", hint: "Runs in Turbo. Then draw on the screen below; click it and press 0–9 to change color." },
};
const info = () => PROGRAM_INFO[select.value] || { mode: "watch", hint: "Your own program: Watch to step through it, Turbo to run it fast." };
const showHint = () => ($("hint").textContent = info().hint);

select.onchange = () => {
  if (select.value) src.value = PROGRAMS[select.value];
  showHint();
};
src.oninput = () => {
  select.value = Object.keys(PROGRAMS).find((k) => PROGRAMS[k] === src.value) ?? "";
  showHint();
};
$("loadrun").onclick = () => {
  post({ type: "load", source: src.value, run: info().mode });
  if (select.value === "paint") {
    screen.scrollIntoView({ block: "center" });
    screen.focus();
  }
};
$("load").onclick = () => post({ type: "load", source: src.value });
$("reset").onclick = () => post({ type: "reset" });
$("stept").onclick = () => post({ type: "step-t" });
$("stepi").onclick = () => post({ type: "step-i" });
$("watch").onclick = () => {
  if (info().mode === "turbo") $("hint").textContent = `${info().hint} Watch still steps it, just slowly.`;
  post({ type: "run", mode: "watch" });
};
$("turbo").onclick = () => post({ type: "run", mode: "turbo" });
$("pause").onclick = () => post({ type: "pause" });
const hz = $("hz");
hz.oninput = () => {
  $("hzv").textContent = `${hz.value} Hz`;
  post({ type: "hz", hz: Number(hz.value) });
};
$("pin").onchange = (e) => {
  const v = parseInt(e.target.value, 16);
  if (!Number.isNaN(v)) post({ type: "pin", base: v });
};
src.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") post({ type: "load", source: src.value });
});

const regEls = REGISTERS.map((r) => {
  const d = document.createElement("div");
  d.className = "reg";
  d.innerHTML = `<span class="label">${r}</span><b>00</b>`;
  $("regs").appendChild(d);
  return d.querySelector("b");
});

// ---------- screen ----------

const screen = $("screen");
screen.width = WIDTH;
screen.height = HEIGHT;
const sctx = screen.getContext("2d");
const big = document.createElement("canvas");
big.width = WIDTH * SCALE;
big.height = HEIGHT * SCALE;
const bctx = big.getContext("2d");
bctx.imageSmoothingEnabled = false;
const image = sctx.createImageData(WIDTH, HEIGHT);

function drawVram(vram) {
  for (let i = 0; i < vram.length; i++) {
    const [r, g, b] = PALETTE[vram[i] & 15];
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(image, 0, 0);
}

function encodePng() {
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

/** Every pixel on the line between two points (Bresenham), so fast strokes have no gaps. */
function linePoints(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return pts;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

let mouseDown = false;
let strokeAt = null;
const input = { downs: 0, moves: 0 };
const cursor = $("cursor");

function sendMouse(e) {
  const rect = screen.getBoundingClientRect();
  const toCpu = (ev) => [
    Math.max(0, Math.min(WIDTH - 1, Math.floor(((ev.clientX - rect.left) / rect.width) * WIDTH))),
    Math.max(0, Math.min(HEIGHT - 1, Math.floor(((ev.clientY - rect.top) / rect.height) * HEIGHT))),
  ];
  const [x, y] = toCpu(e);
  let samples = [[x, y, mouseDown]];
  if (mouseDown && e.type === "pointermove") {
    try {
      const all = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (all.length) samples = all.map((ev) => [...toCpu(ev), true]);
    } catch (err) {
      // keep the single sample
    }
  }
  if (mouseDown) {
    const dense = [];
    for (const [sx, sy] of samples) {
      if (!strokeAt) dense.push([sx, sy, true]);
      else for (const [lx, ly] of linePoints(strokeAt[0], strokeAt[1], sx, sy)) dense.push([lx, ly, true]);
      strokeAt = [sx, sy];
    }
    samples = dense;
  } else strokeAt = null;
  if (!samples.length) return;
  const px = rect.width / WIDTH;
  cursor.style.display = "block";
  cursor.style.left = `${screen.offsetLeft + x * px}px`;
  cursor.style.top = `${screen.offsetTop + y * px}px`;
  cursor.style.width = cursor.style.height = `${px * 3}px`;
  cursor.classList.toggle("down", mouseDown);
  post({ type: "mouse", samples });
}

function press(e) {
  if (mouseDown) return;
  mouseDown = true;
  input.downs++;
  if (e.pointerId !== undefined) {
    try { screen.setPointerCapture(e.pointerId); } catch (err) { /* drawing works without capture */ }
  }
  screen.focus();
  sendMouse(e);
}
function release(e) {
  if (!mouseDown) return;
  mouseDown = false;
  sendMouse(e);
}
screen.addEventListener("pointerdown", press);
screen.addEventListener("pointermove", (e) => {
  input.moves++;
  if (mouseDown && (e.buttons & 1) === 0) return release(e);
  sendMouse(e);
});
screen.addEventListener("pointerup", release);
window.addEventListener("mouseup", release);
screen.addEventListener("pointerleave", () => {
  if (!mouseDown) cursor.style.display = "none";
});
screen.addEventListener("keydown", (e) => {
  const special = { Enter: 13, Escape: 27, Backspace: 8, ArrowLeft: 28, ArrowRight: 29, ArrowUp: 30, ArrowDown: 31 };
  const code = e.key.length === 1 ? e.key.charCodeAt(0) : special[e.key];
  if (code !== undefined) {
    post({ type: "key", code });
    e.preventDefault();
  }
});

// ---------- messages from the plugin ----------

let vramReceived = 0;

function showStatus(s) {
  $("pc").textContent = `PC ${hex(s.pc, 4)} · SP ${hex(s.sp, 4)} · IR ${hex(s.ir, 2)} ${s.mnem}${s.line ? ` · line ${s.line}` : ""}`;
  s.regs.forEach((v, i) => (regEls[i].textContent = hex(v, 2)));
  $("flags").innerHTML = ["z", "c", "n"].map((f) => `<span class="${s.flags[f] ? "on" : ""}">${f.toUpperCase()}</span>`).join("");
  $("counts").textContent = `${s.instructions} instr · ${s.tstates} T${s.ips ? ` · ${s.ips.toLocaleString()} IPS` : ""}`;
  $("sigs").textContent = s.t === null ? "—" : `T${s.t}: ${s.sigs.join("  ") || "(idle)"}`;
  const state = $("state");
  state.textContent = s.fault ? `fault: ${s.fault}` : s.halted ? "halted" : s.running ? `running · ${s.running}` : "paused";
  state.className = `pill ${s.fault ? "bad" : s.running ? "ok" : ""}`;
  const [mx, my, mb] = s.mouse;
  $("diag").textContent = `mouse ${mx},${my} ${mb ? "down" : "up"} · ${input.downs} clicks · screen ${vramReceived} sent / ${s.screens} on canvas`;
  $("watch").classList.toggle("active", s.running === "watch");
  $("turbo").classList.toggle("active", s.running === "turbo");
}

onmessage = (e) => {
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
        asmBox.innerHTML = `<div class="err">The drawing on "${msg.page}" is missing ${msg.missing.length} part(s), e.g. ${msg.missing
          .slice(0, 4)
          .join(", ")}. Those parts won't animate.</div>`;
      break;
    case "table": {
      const t = $("table");
      t.textContent = msg.errors.length ? `table: ${msg.rows} ops · ${msg.errors.length} bad` : `table: ${msg.rows} ops ✓`;
      t.className = `pill ${msg.errors.length ? "bad" : "ok"}`;
      t.title = msg.errors.map((x) => `${x.row}: ${x.msg}`).join("\n");
      if (msg.errors.length) asmBox.innerHTML = msg.errors.map((x) => `<div class="err">row ${x.row}: ${x.msg}</div>`).join("");
      break;
    }
    case "asm":
      asmBox.innerHTML = msg.ok
        ? `<div class="ok">✓ ${msg.size} bytes loaded at ${hex(msg.entry, 4)}</div>`
        : msg.errors.map((x) => `<div class="err">line ${x.line}: ${x.msg}</div>`).join("");
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
